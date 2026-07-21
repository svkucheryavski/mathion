# Phase 9-A2 — PostgreSQL Concurrency Hardening (student/roster races) — Design

**Status:** rev 3 (post 2× 5-reviewer Opus panel)
**Date:** 2026-07-21
**Predecessor:** Phase 9-A1 PostgreSQL migration (merged `dc60688`, 2026-07-19) — dev+test+prod on PostgreSQL 17, giving real advisory locks + concurrent-connection testability.
**Branch:** `feat/phase9-a2-concurrency`

**rev 2 → rev 3 (Round-2 panel: pg-mechanics APPROVE; four others CHANGES REQUIRED — 4 Critical, 3 Important, 8 Minor; full record in `scratchpad/a2-spec-review-round2-adjudication.md`):**
- **`get_or_create_user` made lock-safe (C1).** Its `IntegrityError` handler does a **top-level `db.rollback()`** then continues (`helpers.py:71-77`) — which, once a lock is held across it, silently drops every advisory lock mid-critical-section, and in the batch (called at `run_roster.py:196`, *outside* the per-row `begin_nested()` at `:214`) also discards all previously-added rows. Fixed by a SAVEPOINT wrap; now in scope (T1).
- **Mini-project-lifecycle race pulled into scope (C2, user decision).** `create_submission` sets `first_submitted_at` atomically, but `delete_mini_project`/`patch_mini_project` read it unlocked then act — the delete non-force path skips the course-admin escalation (`mini_projects.py:216-222`), a permission bypass + file loss. New `MINIPROJECT(mp_id)` lock domain + Task 6.
- **Test model corrected (C3, C4).** The forced-interleave seam is engaged **only in the lock-removed RED fail-first** — engaging it under the lock deadlocks (lock precedes the seam). The #3 fail-first uses an **asymmetric** protocol (A commits fully, then B) because a symmetric release hits a `UNIQUE(mp,group,number)` collision, not a double-pending.
- **Error-surface & test wording fixed (I1):** `_enroll_user` never raises — it enforces single-active by **deactivation**; that leg is tested by active-row **count**, at the `_enroll_user` level with two versions (the endpoint path is already `UNIQUE(user_id,version_id)`-guarded). The enrollment-conflict 409 comes only from the caller `JSONResponse` (RunStudent layer).
- **Deadlock test made non-vacuous (I2):** a monkeypatch that reverses one site's acquisition order, proving `DeadlockDetected` would appear — the by-construction order can't otherwise be exercised. **Wiring assertions enumerated at every locked site (I3).** Plus Minors: NullPool fixture + `rollback()` teardown, precise SAVEPOINT/advisory wording, line-ref fixes, PIN-deferral security rationale.

## 1. Scope

Close the high-impact **check-then-act** races A1 made fixable and testable. **Four lock-enforced invariants** across four advisory-lock domains (a fifth backlog item, `submission_number`, folds into #3):

| # | Invariant at risk | Trigger | Lock domain |
|---|-------------------|---------|-------------|
| 1 | a group must not exceed `MAX_GROUP_SIZE` (10) | admin roster writes (esp. bulk) | `CAPACITY(run_id)` |
| 2 | ≤ 1 active enrollment per (student, course) — **both** the `RunStudent` (run) and `StudentEnrollment` (version) tables | admin add / enroll / batch / publish | `ENROLLMENT(course_id)` |
| 3 | ≤ 1 *pending* submission per revision cycle per (mini-project, group); `submission_number` gap-free | student (group members) | `SUBMISSION(mp_id, group_id)` |
| 5 | a mini-project locked by its first submission stays immutable except by course-admin `force` | student first-submit vs admin patch/delete | `MINIPROJECT(mp_id)` |

**Concurrency profile (honest):** #3 is student-triggered (deadline rush); #5 crosses a student submit and an admin edit; #1/#2 race during **bulk** admin ops. This is a **correctness** slice — contention at a class's scale (≤200 students) is negligible, so coarse locks are the right trade.

**Already race-safe — explicitly NOT in scope:**
- **quiz max-attempts** — `quiz.py:123-141` already does an atomic `UPDATE UserItemState SET attempt_count=attempt_count+1 … WHERE id=:id AND attempt_count < :max` + `rowcount==0 → rollback → 409`. Under READ COMMITTED the blocked writer re-evaluates the `WHERE` against the committed row (EvalPlanQual). No lock needed.
- **insert races caught by UNIQUE + retry:** `submission_number` collision (`UNIQUE(mp,group,number)`, `models.py:296`); get-or-create `UserItemState` (unique `user_id,item_id`). **`get_or_create_user` is NOW in scope** — see §3.1 (its recovery path must become SAVEPOINT-based before any lock is held across it).

## 2. Background — why these race, and why now

Each site does **read (check) → decide → write (act)** across multiple statements with no lock across the gap. Under READ COMMITTED (Postgres default; the app sets no isolation level), two transactions each read the pre-write state, both pass the guard, both write → invariant violated. SQLite's single-writer lock masked this; Postgres does not. A1 shipped the engine + harness that make advisory locks available and concurrent connections testable.

## 3. Mechanism — pessimistic advisory locking (no `FOR UPDATE`)

### 3.1 The primitive + the `get_or_create_user` prerequisite (Task 1)

```python
LOCK_NS_ENROLLMENT  = 1   # key: (course_id)
LOCK_NS_CAPACITY    = 2   # key: (run_id)
LOCK_NS_MINIPROJECT = 3   # key: (mp_id)
LOCK_NS_SUBMISSION  = 4   # key: (mp_id, group_id)

def advisory_xact_lock(db: Session, namespace: int, *ids: int) -> None:
    """Transaction-scoped PostgreSQL advisory lock.

    Folds (namespace, *ids) into a deterministic signed 64-bit key via BLAKE2b
    (stable across processes — NOT Python's salted hash()), then calls
    pg_advisory_xact_lock(bigint). Released automatically on COMMIT/ROLLBACK.
    Distinct namespaces cannot collide (namespace is folded into the payload);
    a ~2⁻⁶⁴ BLAKE2b collision would only cause harmless spurious serialization.
    """
    payload = ":".join(str(x) for x in (namespace, *ids)).encode()
    key = int.from_bytes(hashlib.blake2b(payload, digest_size=8).digest(), "big", signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": key})
```
`digest_size=8` → exactly the `bigint` range `[-2⁶³, 2⁶³-1]`; psycopg3 adapts it straight to `int8`. Empirically verified against SQLAlchemy 2.0 / psycopg 3.3.4 / PG17 (overload resolution, driver adaptation, xact-scope release).

**`MAX_GROUP_SIZE = 10`** — unify **four** literals: `helpers.py:197`, `run_roster.py:149`, `run_roster.py:358`, and the publish readiness gate `runs.py:209` (`having(count > 10)`) + its `:212` message.

**Prerequisite — `get_or_create_user` must not do a top-level rollback (C1).** Its concurrent-insert recovery (`helpers.py:71-77`) currently calls **`db.rollback()`** (ends the transaction → releases every advisory lock) and then *continues*. Every enrollment path calls it while a lock is (or will be) held, so it must recover via a SAVEPOINT that unwinds only the failed insert:
```python
user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
if user is None:
    try:
        with db.begin_nested():           # SAVEPOINT — NOT a top-level rollback
            user = User(email=email, full_name=None)
            db.add(user)
            db.flush()
    except IntegrityError:
        user = db.execute(select(User).where(User.email == email)).scalar_one()
return user
```
After `ROLLBACK TO SAVEPOINT` the transaction (and any advisory lock acquired *before* the savepoint) survives, and the re-query runs on a usable connection. This is Task 1 and gates every enrollment task.

### 3.2 Global lock-acquisition order (deadlock-freedom by construction)

> **Acquire locks in ascending namespace order: `ENROLLMENT(1)` → `CAPACITY(2)` → `MINIPROJECT(3)` → `SUBMISSION(4)`.**

Each domain's key is a single well-defined value per request, so there is no intra-domain ordering to manage. Only two request types take two locks, and both obey the order:
- `add_student` / `add_students_batch`: `ENROLLMENT(course_id)` then `CAPACITY(run_id)`.
- `create_submission`: `MINIPROJECT(mp_id)` then `SUBMISSION(mp_id, group_id)`.

Single-lock paths trivially comply: `patch_student`/`bulk_move` → CAPACITY only; `publish_run`/`enroll_student`/`enroll_batch` → ENROLLMENT only; `patch_mini_project`/`delete_mini_project` → MINIPROJECT only. The roster cluster (1,2) and the submission cluster (3,4) never intersect in one request, so no cross-cluster cycle exists. **No `FOR UPDATE` anywhere** → no advisory-vs-row-lock ordering hazard. Deadlock-freedom is by construction; §6 proves the guard has teeth via a deliberate order-reversal test.

### 3.3 Correctness dependencies & honest cost

- **READ COMMITTED required:** after a blocked waiter acquires the lock, its *next* statement (the conflict re-check / capacity `count` / `first_submitted_at` re-read) takes a fresh snapshot seeing the winner's committed rows. Under REPEATABLE READ the re-check would read stale — keep the app on the default READ COMMITTED (it sets none).
- **Lock hold duration:** `create_submission` holds `MINIPROJECT`+`SUBMISSION` across a ≤20 MB file write + auto-eval + notifications + commit (`config.py:11`). A same-group co-submitter's (or an admin patch/delete's) wait is bounded by the session `statement_timeout=30000` (`database.py:23`) — a wait exceeding 30 s raises `QueryCanceled` (a 500), reproduced empirically. A 20 MB write is far under 30 s and contention is narrow, so it does not trigger. An `add_students_batch` holds its two locks for the whole batch (bounded likewise). No `lock_timeout` is set; §6 tests assert blocking via `pg_try_advisory_xact_lock`, not by waiting.
- **No Alembic migration** — every lock is a runtime construct; no schema change.

## 4. Error semantics — no new surface

Holding the lock across read→write makes the **existing** guard atomic — **no new messages, codes, or shapes**, and (per §3.2) **no `deadlock detected` 500s**:
- #1 capacity → existing `409 "Group capacity reached"` (bulk keeps `error_code: capacity_reached`).
- #2 enrollment — **two enforcement styles, one 409 source.** The conflict **409** (`student_already_active_in_course` + conflicts payload) is raised **only** by the callers via `JSONResponse` on the **RunStudent** layer (`run_roster.py:101`, `:205-211`, `runs.py:253`). `enroll_user_in_run`'s only `HTTPException(409)` is `"Group capacity reached"` (helpers.py:198 — that is domain **#1**). The **StudentEnrollment** layer (`enroll_student`/`enroll_batch` → `_enroll_user`, `enrollment.py:15-61`) **raises nothing** — it enforces single-active by *deactivating* other active rows then inserting/reactivating; the lock merely makes that deactivate-then-insert atomic. So that leg has **no error surface** and is verified by row-state (§6), not a 409.
- #3 submission → existing `409 "Previous submission pending evaluation"` (`submissions.py:85`) or `"Already accepted; no further submission"` (`:74-75`); `submission_number` stays accurate → the dead retry is removed (§5.4).
- #5 mini-project → existing `409 "Mini-project is locked (has submissions); use ?force=true"` (`mini_projects.py:218`) + course-admin escalation on force (`:219-222`); the lock closes the read-then-act window so the gate can no longer be bypassed.

Lock release on every exit is airtight: `get_db` (`database.py:33-38`) closes the session in `finally`, rolling back → all advisory locks freed on every `raise` / `return JSONResponse` / commit (reinforced by pool `reset_on_return='rollback'`).

## 5. Per-site specifications

Line numbers are current (2026-07-21); implementers verify against the code.

### 5.1 group capacity — `advisory_xact_lock(db, LOCK_NS_CAPACITY, run_id)`
- `helpers.enroll_user_in_run` (`~197`) acquires it **internally**, before the `count(RunStudent WHERE group_id=…) >= MAX_GROUP_SIZE` check — covering single `add_student` and (re-entrantly) each batch row.
- `run_roster.patch_student` move (`~148-150`): acquire before the count check. Preserve the already-in-target no-op carve-out.
- `run_roster.bulk_move` (count at `~352`, check at `~358`): acquire **once before the row loop** (the count sits inside the loop; one run-keyed acquire covers all groups).
Replace the four literals with `MAX_GROUP_SIZE`.

### 5.2 one-active-enrollment — `advisory_xact_lock(db, LOCK_NS_ENROLLMENT, course_id)`
The invariant spans two tables; lock both layers on the same course key:
- **`RunStudent` layer:** `add_student` (`run_roster.py:~77`) — reorder to: acquire `ENROLLMENT(course_id)` → `get_or_create_user` (now SAVEPOINT-safe, §3.1) → `find_student_active_conflicts` under the lock → `enroll_user_in_run`. (This fixes the new-user bypass where a brand-new email skipped the conflict check.) `publish_run` (`runs.py:231-234`) acquires it once (one course key) held through the `is_published` flip; its conflict display order is unchanged.
- **`StudentEnrollment` layer:** wrap the `_enroll_user` call in `enroll_student` (`enrollment.py:~86`) and `enroll_batch` (`:~106`, once before its loop) under `ENROLLMENT(course_id)`; update the now-satisfied `enrollment.py:~24` comment. Note the endpoint path is already `UNIQUE(user_id, version_id)`-guarded against same-version double-active (both endpoints resolve the *same* newest version); the lock is belt-and-suspenders for the cross-version deactivate-then-insert interleave (tested at the `_enroll_user` level, §6).
- **Deactivate-only paths are intentionally excluded:** `remove_run_student` (`helpers.py:223-267`, via `remove_student`/`bulk_delete`) and enrollment `remove_student` only *decrease* active counts — they cannot over-activate invariant #2. (Their own lost-update-to-zero-active concern is a separate low-severity item, §8.)

### 5.3 batch — `add_students_batch` (takes both roster domains)
Acquire, once, up front, before the per-row loop, in §3.2 order: `ENROLLMENT(course_id)` then `CAPACITY(run_id)`. **Up-front acquisition is load-bearing:** advisory-xact locks acquired *before* the per-row `db.begin_nested()` savepoints survive `ROLLBACK TO SAVEPOINT`, so a failed row cannot drop the batch's locks — whereas a lock acquired *inside* a rolled-back subtransaction **is** released (hence the helper's per-row `CAPACITY` re-acquire is a harmless re-entrant no-op, not the batch's real hold). Then run the existing per-row loop (its `begin_nested()` SAVEPOINTs + 207 reporting) unchanged in structure. `get_or_create_user` (called at `:196`, outside the per-row savepoint) is now SAVEPOINT-safe (§3.1), so its recovery no longer rolls back the batch. No per-row locking, no email ordering.

### 5.4 pending-submission + submission_number — `advisory_xact_lock(db, LOCK_NS_SUBMISSION, mp_id, group_id)`
Acquire after the group-membership/disabled checks (after `submissions.py:~70`) and after `MINIPROJECT` (§5.5), **before** `_latest_evaluation_result` (`:73`). The gate → `max(submission_number)+1` (`:127`) → insert → file write → commit then runs atomically. **Delete the dead retry:** remove the `except IntegrityError` handler at `submissions.py:152-173` and collapse `try: db.flush()` (`:150-151`) to a bare `db.flush()` (the lock makes the collision unreachable; without the lock, deletion alone would turn a collision into a 500 — they land together).

### 5.5 mini-project lifecycle lock — `advisory_xact_lock(db, LOCK_NS_MINIPROJECT, mp_id)`
Serialize the atomic `first_submitted_at` *setter* against its unlocked *readers*:
- `create_submission`: acquire `MINIPROJECT(mp_id)` at the top of the write section (before `SUBMISSION`, §3.2), held across the `first_submitted_at` conditional UPDATE (`submissions.py:176-180`) through commit.
- `patch_mini_project` (`mini_projects.py:~154`): acquire `MINIPROJECT(mp_id)` after authz, then **re-read** `first_submitted_at` (fresh statement) for the `locked` decision (`:158`) — so an edit can no longer land against a stale "unlocked" read.
- `delete_mini_project` (`mini_projects.py:~214`): acquire `MINIPROJECT(mp_id)` after authz, then **re-read** `first_submitted_at` for the `is_locked` gate (`:216`) — closing the window where the non-force path skipped the course-admin escalation (`:217-222`).

## 6. Testing

**Concurrency fixture (Task 1)** — its **own dedicated `Engine`** with `poolclass=NullPool` (not `pool_size≥N`: NullPool fails fast instead of masking a leak behind `pool_timeout`), **never** the app `SessionLocal` (pool `5+5=10`; N>10 mutually-blocked threads would exhaust it). Yields N `Session`s on separate real connections. Teardown **`rollback()`+`close()` every worker session and `engine.dispose()` BEFORE** the autouse `_isolation` TRUNCATE — declare the fixture dependent on `_isolation` for LIFO order. **`rollback()` is required, not just `close()`:** an open worker txn's `ACCESS SHARE` (from any SELECT) is what would block the TRUNCATE's `ACCESS EXCLUSIVE` (it waits 5 s under `SET LOCAL lock_timeout='5s'` then `LockNotAvailable`). One test: a worker raising mid-critical-section still leaves the DB truncatable.

**Forced-interleave seam** — each critical section gets a test-only monkeypatchable no-op hook **between the guard-read and the write**. **Engage the seam ONLY in the lock-removed RED fail-first.** In the lock-PRESENT (GREEN) run the seam is a plain no-op and the test relies on **natural lock serialization** — the threads run, one wins, the rest 409 (or, for the StudentEnrollment leg, the row-count stays 1). (Engaging a blocking seam under the lock would deadlock: the lock precedes the seam, so a blocked thread never reaches its seam while the winner parks at the seam holding the lock.)

**RED fail-first protocol per invariant** (deterministic; drop the lock, drive the exact interleave, assert the invariant violated — then restore the lock and assert it holds):
- **#1 capacity — symmetric.** Two threads add distinct users to a 9-member group; both pass the count check at the seam; release both → both insert → 11 members (`RunStudent` unique is `(run_id,user_id)`, so no insert collision masks it).
- **#2 RunStudent — symmetric.** Two threads add the *same* student to two different runs of one course; both `find_student_active_conflicts` empty at the seam; release both → student active in two runs.
- **#2 StudentEnrollment — count-based, at `_enroll_user` level.** Call `_enroll_user` directly with **two distinct versions** of one course (the endpoints can't, being `UNIQUE(user_id,version_id)`-guarded on the same newest version); without the lock the deactivate-then-insert interleave yields **2 active rows** for the course; assert the active-row **count**, not a 409.
- **#3 pending-submission — asymmetric.** Hold thread B at a seam placed **after the pending-gate (`~:85`) but before `max()+1` (`:127`)**; let thread A run to a **full commit** of submission #1; then release B → B computes `max+1=2`, inserts a second **pending** row (no `UNIQUE` collision) → 2 pending. (A symmetric release would instead collide on `submission_number` and leave 1 pending — a false fail-first.)
- **#5 mini-project — asymmetric.** Thread A = `delete_mini_project` (non-force, run-teacher not course-admin) reads `is_locked=False` at the seam; thread B = `create_submission` commits `first_submitted_at`; release A → A deletes the now-locked mini-project + files without escalation (bypass). With the lock: A blocks, re-reads `is_locked=True`, and hits the `force`/course-admin gate.

**Layer-1 primitive proof (deterministic):** per domain, session A holds the advisory lock, session B's `SELECT pg_try_advisory_xact_lock(:k)` returns `false`; A commits → B's retry returns `true`. (There is no `NOWAIT` form of the blocking acquire; `pg_try_*` is the primitive.)

**Wiring assertions — at EVERY locked site.** Spy/monkeypatch `advisory_xact_lock` and assert the expected `(namespace, *ids)` call during each of the eleven acquisition sites: `enroll_user_in_run`, `patch_student` move, `bulk_move` (CAPACITY); `add_student`, `add_students_batch`, `enroll_student`, `enroll_batch`, `publish_run` (ENROLLMENT); `create_submission` (MINIPROJECT **and** SUBMISSION); `patch_mini_project`, `delete_mini_project` (MINIPROJECT). Wiring proves the call + args but **not** lock *position* relative to the guard-read — so every site that has a reachable race also gets a Layer-2 forced-interleave test; sites whose safety is construction-only (e.g. `publish_run`'s readiness gate) are explicitly noted as position-unverified.

**Deadlock regression (non-vacuous, I2):** because every path shares one acquisition order, two real paths can never cycle — so the test **monkeypatches one site to reverse its order** and asserts `DeadlockDetected` surfaces when `add_student` (ENR→CAP) races the reversed site (CAP→ENR); with the patch removed, both complete. This proves the order is load-bearing and the guard has teeth.

**Off-HTTP semantics & fabrication:** thread bodies call the router/service functions directly with per-thread sessions. Handlers **raise `HTTPException`** (`enroll_user_in_run` capacity, `create_submission`, `patch_mini_project`, `delete_mini_project`) or **return `JSONResponse(409)`** (`add_student` conflict) — assert `status_code`, not an HTTP response; `_enroll_user` neither raises nor returns a 409 (assert row-count). `create_submission` takes a bare `UploadFile` → each thread fabricates a `starlette.datastructures.UploadFile` over a `SpooledTemporaryFile` of `%PDF-` bytes.

Task 1 lands the fixture + seam + wiring helper + one real fail-first (the #3 asymmetric protocol) to de-risk the approach early — no threading/advisory precedent exists in the suite.

## 7. Task decomposition (TDD throughout)

- **Task 1 — Foundations:** `advisory_xact_lock` + the four namespace constants + `MAX_GROUP_SIZE`; the **`get_or_create_user` SAVEPOINT fix (C1)**; the NullPool concurrency fixture; the forced-interleave seam + wiring-assert helper; proven by the Layer-1 `pg_try` primitive test + the #3 asymmetric fail-first.
- **Task 2 — capacity:** `CAPACITY(run_id)` in `enroll_user_in_run` (covers single add + batch rows) + `patch_student` move + `bulk_move` (once before loop) + the four `MAX_GROUP_SIZE` swaps; #1 forced-interleave + fail-first.
- **Task 3 — enrollment:** `ENROLLMENT(course_id)` at `add_student` (get_or_create-first), `enroll_student`, `enroll_batch`, `publish_run`; #2 RunStudent forced-interleave + fail-first, and the `_enroll_user` two-version count-based test.
- **Task 4 — batch:** `add_students_batch` acquires `ENROLLMENT`+`CAPACITY` up front (§5.3) + the deadlock order-reversal regression test.
- **Task 5 — submission:** `SUBMISSION(mp_id, group_id)` in `create_submission` fixing double-pending + delete the dead retry (§5.4); #3 forced-interleave.
- **Task 6 — mini-project lifecycle:** `MINIPROJECT(mp_id)` in `create_submission` (before `SUBMISSION`) + `patch_mini_project`/`delete_mini_project` re-read (§5.5); the #5 delete-bypass fail-first.

Order 1 → 2 → 3 → 4 → 5 → 6. A final whole-branch dual-gate review closes the slice.

## 8. Non-goals (deferred to a later A2b)

- Admin **structure** ordering races (`block`/`sequence`/`item`/`question` `max(order)+1` — already int4-overflow-guarded in A1).
- `publish_run`'s **structural** readiness re-validation (teacher-count / oversized-group at `runs.py:176`+) — a read-gate, admin-only.
- run-asset quota check-then-act.
- **`auth.py` PIN rate-limit.** Deferred not because it is low-consequence — a concurrent check-then-act on the throttle counter lets N parallel requests each read the pre-increment value and multiply allowed attempts — but because the exposure is bounded by the short PIN TTL, the off-path PIN send, and single-node deployment; it earns its own focused slice.
- **Enrollment deactivate-path lost-update** (`remove_run_student` vs concurrent enroll racing `is_active` toward 0-active-while-rostered) — cannot over-activate #2; low-severity, batched with the PIN item.

## 9. Success criteria

- Each of the four lock-enforced invariants (#1 capacity, #2 enrollment across BOTH tables, #3 pending-submission, #5 mini-project lock) holds under its forced-interleave test, and is proven **previously violable** by a deterministic RED fail-first with the lock removed (using the per-invariant protocol in §6). max-attempts and `submission_number` are excluded (already atomic / UNIQUE-guarded).
- Each of the four advisory domains proven to block a second session in a Layer-1 `pg_try_advisory_xact_lock` test; each of the eleven sites proven to call the lock via a wiring assertion.
- The deadlock order-reversal regression test proves the §3.2 order is load-bearing (reversed → `DeadlockDetected`; correct → both complete).
- `get_or_create_user` recovers via SAVEPOINT (no top-level rollback under a held lock), proven by a lock-survives-concurrent-same-email-insert assertion.
- Full suite green on Postgres; no new error surface (§4); dead submission retry removed; the four `MAX_GROUP_SIZE` literals unified.
