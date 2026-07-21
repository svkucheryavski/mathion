# Phase 9-A2 — PostgreSQL Concurrency Hardening (student/roster races) — Design

**Status:** rev 4 (post 3× 5-reviewer Opus panel — Round 3: pg-mechanics APPROVE, no Criticals)
**Date:** 2026-07-21
**Predecessor:** Phase 9-A1 PostgreSQL migration (merged `dc60688`, 2026-07-19) — dev+test+prod on PostgreSQL 17, giving real advisory locks + concurrent-connection testability.
**Branch:** `feat/phase9-a2-concurrency`

**rev 3 → rev 4 (Round-3 panel — zero Criticals, no invariant-safety defect; two reviewers empirically re-validated the locking mechanism on live PG17; record in `scratchpad/a2-spec-review-round3-adjudication.md`):**
- **Shrink the `MINIPROJECT` critical section (R1.1).** `MINIPROJECT(mp_id)` serializes **all groups** submitting to a mini-project (class-wide during a deadline rush — the very scenario #3/#5 target), not just a same-group co-submitter. Holding it across the 20 MB read + 20 MB temp-write could push the class-wide tail past `statement_timeout` → an opaque 500. rev 4 moves the file I/O outside the locks; only the DB gate → number → insert → `first_submitted_at` UPDATE → `os.replace` → commit run under them (§3.3, §5.4).
- **Deadlock-freedom wording (R3.1):** "no `FOR UPDATE` **at any advisory-locked site**" — `publish_mini_project` does hold `.with_for_update()` on the `MiniProject` row (`mini_projects.py:301`) but takes no advisory lock, so it can't be in an advisory wait-cycle (§3.2).
- **Test model tightened:** the batch's up-front `CAPACITY` gets its own wiring assertion (flagged by four reviewers); every locked site gets an **ordering** assertion (lock precedes its guard-read), plus a forced-interleave for `patch_mini_project`; the #5 and #2-StudentEnrollment GREEN tests are made deterministic; the deadlock test uses a between-acquisitions barrier; the fixture joins worker threads before teardown (§6).
- Minors: `reset_on_return` is the pool default; quiz range `:123-142`; the batch conflict reports a 207 per-row entry (not a `JSONResponse`); the `#4` numbering gap is explained; two further low-severity admin races noted in §8.

## 1. Scope

Close the high-impact **check-then-act** races A1 made fixable and testable. **Four lock-enforced invariants** across four advisory-lock domains. (Invariant **#4**, `submission_number` collision, is already `UNIQUE`-enforced and folds into #3 — hence the table skips from #3 to #5, which keeps its original backlog number.)

| # | Invariant at risk | Trigger | Lock domain |
|---|-------------------|---------|-------------|
| 1 | a group must not exceed `MAX_GROUP_SIZE` (10) | admin roster writes (esp. bulk) | `CAPACITY(run_id)` |
| 2 | ≤ 1 active enrollment per (student, course) — **both** the `RunStudent` (run) and `StudentEnrollment` (version) tables | admin add / enroll / batch / publish | `ENROLLMENT(course_id)` |
| 3 | ≤ 1 *pending* submission per revision cycle per (mini-project, group); `submission_number` gap-free (folds in #4) | student (group members) | `SUBMISSION(mp_id, group_id)` |
| 5 | a mini-project locked by its first submission stays immutable except by course-admin `force` | student first-submit vs admin patch/delete | `MINIPROJECT(mp_id)` |

**Concurrency profile (honest):** #3 is student-triggered (deadline rush); #5 crosses a student submit and an admin edit; #1/#2 race during **bulk** admin ops. This is a **correctness** slice — contention at a class's scale (≤200 students) is negligible once the `MINIPROJECT` hold is kept short (§3.3), so coarse locks are the right trade.

**Already race-safe — explicitly NOT in scope:**
- **quiz max-attempts** — `quiz.py:123-142` already does an atomic `UPDATE UserItemState SET attempt_count=attempt_count+1 … WHERE id=:id AND attempt_count < :max` + `rowcount==0 → rollback → 409`. Under READ COMMITTED the blocked writer re-evaluates the `WHERE` against the committed row (EvalPlanQual). No lock needed.
- **insert races caught by UNIQUE + retry:** `submission_number` collision (`UNIQUE(mp,group,number)`, `models.py:296`); get-or-create `UserItemState` (unique `user_id,item_id`). **`get_or_create_user` is NOW in scope** — see §3.1 (its recovery path must become SAVEPOINT-based before any lock is held across it).

## 2. Background — why these race, and why now

Each site does **read (check) → decide → write (act)** across multiple statements with no lock across the gap. Under READ COMMITTED (Postgres default; the app sets no isolation level), two transactions each read the pre-write state, both pass the guard, both write → invariant violated. SQLite's single-writer lock masked this; Postgres does not. A1 shipped the engine + harness that make advisory locks available and concurrent connections testable.

## 3. Mechanism — pessimistic advisory locking (no `FOR UPDATE` at any locked site)

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
`digest_size=8` → exactly the `bigint` range `[-2⁶³, 2⁶³-1]`; psycopg3 adapts it straight to `int8`. Empirically verified against SQLAlchemy 2.0.49 / psycopg 3.3.4 / PG17 (overload resolution, driver adaptation, xact-scope release, 4-key hold).

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
Empirically confirmed on PG17: after the flush's `IntegrityError` the context manager issues `ROLLBACK TO SAVEPOINT`, the connection stays usable, `session.new` is empty (the failed `User` is expunged), the re-query returns the winner, and an advisory lock acquired *before* the savepoint is still held. This is Task 1 and gates every enrollment task.

### 3.2 Global lock-acquisition order (deadlock-freedom by construction)

> **Acquire locks in ascending namespace order: `ENROLLMENT(1)` → `CAPACITY(2)` → `MINIPROJECT(3)` → `SUBMISSION(4)`.**

Each domain's key is a single well-defined value per request. Only two request types take two locks, and both ascend:
- `add_student` / `add_students_batch`: `ENROLLMENT(course_id)` then `CAPACITY(run_id)`.
- `create_submission`: `MINIPROJECT(mp_id)` then `SUBMISSION(mp_id, group_id)`.

Single-lock paths trivially comply: `patch_student`/`bulk_move` → CAPACITY only; `publish_run`/`enroll_student`/`enroll_batch` → ENROLLMENT only; `patch_mini_project`/`delete_mini_project` → MINIPROJECT only. The roster cluster (1,2) and the submission cluster (3,4) never intersect in one request, so no cross-cluster cycle exists. **No `FOR UPDATE` at any advisory-locked site** → no advisory-vs-row-lock ordering hazard. (One `FOR UPDATE` exists in the tree — `publish_mini_project`'s `.with_for_update()` on the `MiniProject` row, `mini_projects.py:301` — but that path takes **no** advisory lock, so it can never be part of an advisory wait-for cycle; it interacts with `create_submission`/patch/delete only via the ordinary `MiniProject` row lock, which resolves independently.) Deadlock-freedom is by construction; §6 proves the order is load-bearing via a deliberate order-reversal test.

### 3.3 Correctness dependencies & honest cost

- **READ COMMITTED required:** after a blocked waiter acquires the lock, its *next* statement (the conflict re-check / capacity `count` / `first_submitted_at` re-read) takes a fresh snapshot seeing the winner's committed rows. Under REPEATABLE READ the re-check would read stale — keep the app on the default READ COMMITTED (it sets none).
- **`MINIPROJECT` is class-wide — so the critical section must be I/O-free.** `MINIPROJECT(mp_id)` is keyed on the mini-project, so **every group** submitting to it serializes on one key; during a deadline rush the whole class contends on the mini-project that just hit its deadline. Because a blocked `pg_advisory_xact_lock` acquire is itself a statement, it is bounded by `statement_timeout=30000` (`database.py:23`; no `lock_timeout` is set) — a wait exceeding 30 s would raise `QueryCanceled` (a 500). To keep the class-wide tail far under that, the ≤20 MB file read + PDF validation + temp-file write are done **before** acquiring the locks (§5.4); the locked region is DB-only (gate → `max()+1` → insert → `first_submitted_at` UPDATE → `os.replace` → commit), so each holder's critical section is ~commit latency, not ~40 MB of I/O. With that shrink, N groups × ~commit-latency stays well under 30 s at class scale. (A bounded `lock_timeout` to convert saturation into a retryable response was considered but omitted — it would add an error surface, §4; the shrunk region makes it unnecessary.)
- **No Alembic migration** — every lock is a runtime construct; no schema change.

## 4. Error semantics — no new surface

Holding the lock across read→write makes the **existing** guard atomic — **no new messages, codes, or shapes**, and (per §3.2) **no `deadlock detected` 500s**:
- #1 capacity → existing `409 "Group capacity reached"` (bulk keeps `error_code: capacity_reached`).
- #2 enrollment — **two enforcement styles, one 409 source.** The conflict **409** (`student_already_active_in_course`) is surfaced **only** by the callers on the **RunStudent** layer: `add_student` and `publish_run` return `JSONResponse(409, make_already_active_409_body(...))` (`run_roster.py:101`, `runs.py:253`), and `add_students_batch` reports the same `error_code` as a per-row error entry under its **207 Multi-Status** (`run_roster.py:205-211`). `enroll_user_in_run`'s only `HTTPException(409)` is `"Group capacity reached"` (helpers.py:198 — domain **#1**). The **StudentEnrollment** layer (`enroll_student`/`enroll_batch` → `_enroll_user`, `enrollment.py:15-61`) **raises nothing** — it enforces single-active by *deactivating* other active rows then inserting/reactivating; the lock merely makes that deactivate-then-insert atomic. That leg has **no error surface** and is verified by row-state (§6), not a 409.
- #3 submission → existing `409 "Previous submission pending evaluation"` (`submissions.py:85`) or `"Already accepted; no further submission"` (`:74-75`); `submission_number` stays accurate → the dead retry is removed (§5.4).
- #5 mini-project → existing `409 "Mini-project is locked (has submissions); use ?force=true"` (`mini_projects.py:218`) + course-admin escalation on force (`:219-222`); the lock closes the read-then-act window so the gate can no longer be bypassed.

Lock release on every exit is airtight: `get_db` (`database.py:33-38`) closes the session in `finally`, rolling back → all advisory locks freed on every `raise` / `return JSONResponse` / commit (reinforced by the pool's default `reset_on_return='rollback'`).

## 5. Per-site specifications

Line numbers are current (2026-07-21); implementers verify against the code.

### 5.1 group capacity — `advisory_xact_lock(db, LOCK_NS_CAPACITY, run_id)`
- `helpers.enroll_user_in_run` (`~197`) acquires it **internally**, before the `count(RunStudent WHERE group_id=…) >= MAX_GROUP_SIZE` check — covering single `add_student` and (re-entrantly) each batch row.
- `run_roster.patch_student` move (`~148-150`): acquire before the count check. Preserve the already-in-target no-op carve-out.
- `run_roster.bulk_move` (count at `~352`, check at `~358`): acquire **once before the row loop** (the count sits inside the loop; one run-keyed acquire covers all groups).
Replace the four literals with `MAX_GROUP_SIZE`.

### 5.2 one-active-enrollment — `advisory_xact_lock(db, LOCK_NS_ENROLLMENT, course_id)`
The invariant spans two tables; lock both layers on the same course key:
- **`RunStudent` layer:** `add_student` (`run_roster.py:~77`) — reorder to: acquire `ENROLLMENT(course_id)` → `get_or_create_user` (now SAVEPOINT-safe, §3.1) → `find_student_active_conflicts` under the lock → `enroll_user_in_run`. (This fixes the new-user bypass where a brand-new email skipped the conflict check at `run_roster.py:80`.) `publish_run` (`runs.py:231-234`) acquires it once (one course key) held through the `is_published` flip; its conflict display order is unchanged.
- **`StudentEnrollment` layer:** wrap the `_enroll_user` call in `enroll_student` (`enrollment.py:~86`) and `enroll_batch` (`:~106`, once before its loop) under `ENROLLMENT(course_id)`; update the now-satisfied `enrollment.py:~24` comment. Note the endpoint path is already `UNIQUE(user_id, version_id)`-guarded against same-version double-active (both endpoints resolve the *same* newest version); the lock is belt-and-suspenders for the cross-version deactivate-then-insert interleave (tested at the `_enroll_user` level, §6).
- **Deactivate-only paths are intentionally excluded:** `remove_run_student` (`helpers.py:223-267`, via `remove_student`/`bulk_delete`) and enrollment `remove_student` only *decrease* active counts — they cannot over-activate invariant #2. (Their own lost-update-to-zero-active concern is a separate low-severity item, §8.)

### 5.3 batch — `add_students_batch` (takes both roster domains)
Acquire, once, up front, before the per-row loop, in §3.2 order: `ENROLLMENT(course_id)` then `CAPACITY(run_id)`. **Up-front acquisition is load-bearing:** advisory-xact locks acquired *before* the per-row `db.begin_nested()` savepoints survive `ROLLBACK TO SAVEPOINT`, so a failed row cannot drop the batch's locks — whereas a lock acquired *inside* a rolled-back subtransaction **is** released (hence the helper's per-row `CAPACITY` re-acquire is a harmless re-entrant no-op, **not** the batch's real hold — both empirically confirmed on PG17). Then run the existing per-row loop (its `begin_nested()` SAVEPOINTs + 207 reporting) unchanged in structure. `get_or_create_user` (called at `:196`, outside the per-row savepoint) is now SAVEPOINT-safe (§3.1), so its recovery no longer rolls back the batch. No per-row locking, no email ordering. (Because the up-front `CAPACITY` acquire — not the per-row re-acquire — is the real hold, it carries its **own** wiring assertion, §6.)

### 5.4 pending-submission + submission_number — `advisory_xact_lock(db, LOCK_NS_SUBMISSION, mp_id, group_id)`
**Do the file work first, then lock.** Move the ≤20 MB `file.file.read()` + extension/PDF validation (`submissions.py:106-123`) **and** the temp-file write (`mkstemp` + write bytes, currently `:222-227`) to **before** lock acquisition, so no 20 MB I/O runs under a lock (§3.3). Then acquire `MINIPROJECT(mp_id)` (§5.5) then `SUBMISSION(mp_id, group_id)`, and run under both: the pending gate (`_latest_evaluation_result` + `prior_sub`, `submissions.py:73-92`) → deadline gates → `max(submission_number)+1` (`:127`) → build final filename → insert → `first_submitted_at` UPDATE (§5.5) → `os.replace(tmp, final)` → commit. (Reading the file before the gate means a gate-rejected request has read the upload; that wasted I/O is the price of a short class-wide hold — acceptable.) **Delete the dead retry:** remove the `except IntegrityError` handler at `submissions.py:152-173` and collapse `try: db.flush()` (`:150-151`) to a bare `db.flush()` (the lock makes the collision unreachable; without the lock, deletion alone would turn a collision into a 500 — they land together).

### 5.5 mini-project lifecycle lock — `advisory_xact_lock(db, LOCK_NS_MINIPROJECT, mp_id)`
Serialize the atomic `first_submitted_at` *setter* against its unlocked *readers*:
- `create_submission`: acquire `MINIPROJECT(mp_id)` first (before `SUBMISSION`, §3.2), held across the `first_submitted_at` conditional UPDATE (`submissions.py:176-180`) through commit — with the file I/O already done (§5.4), the hold is DB-only.
- `patch_mini_project` (`mini_projects.py:~154`): acquire `MINIPROJECT(mp_id)` after authz, then **re-read** `first_submitted_at` (fresh statement) for the `locked` decision (`:158`) — so an edit can no longer land against a stale "unlocked" read.
- `delete_mini_project` (`mini_projects.py:~214`): acquire `MINIPROJECT(mp_id)` after authz, then **re-read** `first_submitted_at` for the `is_locked` gate (`:216`) — closing the window where the non-force path skipped the course-admin escalation (`:217-222`).

## 6. Testing

**Concurrency fixture (Task 1)** — its **own dedicated `Engine`** with `poolclass=NullPool` (fails fast instead of masking a leak behind `pool_timeout`), **never** the app `SessionLocal` (pool `5+5=10`; N>10 mutually-blocked threads would exhaust it). Yields N `Session`s on separate real connections. Teardown, in order: **(1) join/await all worker threads** (SQLAlchemy `Session`s are not thread-safe, and a still-blocked worker holds `ACCESS SHARE` that would fail the autouse TRUNCATE after its 5 s `lock_timeout`); **(2) `rollback()`+`close()` each worker session; (3) `engine.dispose()`** — all **before** the autouse `_isolation` TRUNCATE (declare the fixture dependent on `_isolation` for LIFO). On NullPool, `close()`+`dispose()` physically close the DBAPI connections (releasing locks server-side); the `rollback()` is a defensive belt and the **thread-join** is the load-bearing step. One test: a worker raising mid-critical-section still leaves the DB truncatable.

**Forced-interleave seam** — each critical section gets a test-only monkeypatchable no-op hook **between the guard-read and the write**. **Engage the blocking seam ONLY in the lock-removed RED fail-first.** In the lock-PRESENT (GREEN) run the seam is a plain no-op; the test proves the fix by an arrangement that is **deterministic** for that invariant (below) — never by hoping a free-running race lands a particular way. (Engaging a blocking seam under the lock would deadlock: the lock precedes the seam, so a blocked thread never reaches its seam while the winner parks at the seam holding the lock.)

**Per-invariant fail-first + GREEN arrangement:**
- **#1 capacity — symmetric.** RED: two threads add distinct users to a 9-member group; both pass the count check at the seam; release both → 11 members (`RunStudent` unique is `(run_id,user_id)`, no insert collision masks it). GREEN: free-running race → exactly one 409, count stays ≤10 (outcome deterministic regardless of winner).
- **#2 RunStudent — symmetric.** RED: two threads add the *same* student to two different runs of one course; both `find_student_active_conflicts` empty at the seam; release both → active in two runs. GREEN: one wins, the other 409s.
- **#2 StudentEnrollment — count-based, at `_enroll_user` level, GREEN must wrap the lock.** Call `_enroll_user` directly with **two distinct versions** of one course (endpoints can't — they resolve the same newest version, `UNIQUE(user_id,version_id)`-guarded). RED: no lock, seam-driven interleave → **2 active rows**. GREEN: wrap each thread's `_enroll_user` in `advisory_xact_lock(db, LOCK_NS_ENROLLMENT, course_id)` (mimicking the production caller — `_enroll_user` itself holds no lock) → natural serialization → **1 active row**. Assert the active-row **count**, not a 409.
- **#3 pending-submission — asymmetric.** RED: hold thread B at a seam **after the pending-gate (`~:85`) but before `max()+1` (`:127`)** (the `86-126` region is a valid seam location); let thread A run to a **full commit** of submission #1; then release B → B's fresh READ COMMITTED snapshot reads A's row, computes `max+1=2`, inserts a second **pending** row (no `UNIQUE` collision) → 2 pending. (A symmetric release would collide on `submission_number` and leave 1 pending — a false fail-first.) GREEN: B blocks on `SUBMISSION`, re-reads after A commits → 409.
- **#5 mini-project — asymmetric in operation, GREEN must be sequenced.** RED: thread A = `delete_mini_project` (non-force, run-teacher not course-admin) reads `is_locked=False` at the seam; thread B = `create_submission` commits `first_submitted_at`; release A → A deletes the now-locked mini-project + files without escalation (bypass). GREEN: **run B (submit) to full commit, then launch A (delete)** → A acquires `MINIPROJECT`, re-reads `is_locked=True`, hits the `force`/course-admin gate. (A free-running GREEN race is non-deterministic — A-wins-lock would legally delete the not-yet-locked mini-project — so the GREEN arrangement is sequenced, not raced.)

**Layer-1 primitive proof (deterministic):** per domain, session A holds the advisory lock, session B's `SELECT pg_try_advisory_xact_lock(:k)` returns `false`; A commits → B's retry returns `true`. (No `NOWAIT` form of the blocking acquire exists; `pg_try_*` is the primitive.)

**Wiring + ordering assertions — at EVERY locked site.** Spy/monkeypatch `advisory_xact_lock` and assert the expected `(namespace, *ids)` **and** that the call is recorded **before** that site's guard-read (instrument the guard-read — the `count`/`find_student_active_conflicts`/`_latest_evaluation_result`/`first_submitted_at` read — and assert ordering; single-threaded, cheap, so it verifies lock *position* everywhere, which wiring alone cannot). Cover all **13 lock acquisitions across 11 sites**: `enroll_user_in_run`, `patch_student` move, `bulk_move` (CAPACITY); `add_student` (ENROLLMENT), `add_students_batch` (**ENROLLMENT and CAPACITY** — assert the CAPACITY acquire fires before the row loop, after ENROLLMENT), `enroll_student`, `enroll_batch`, `publish_run` (ENROLLMENT); `create_submission` (**MINIPROJECT and SUBMISSION**); `patch_mini_project`, `delete_mini_project` (MINIPROJECT). Each raceable site also gets a forced-interleave test — including `patch_mini_project` (its read→act at `:158` is distinct from delete's) and the capacity movers; `publish_run`'s readiness gate is explicitly documented as position-verified-by-ordering-assertion only (no thread race).

**Deadlock regression (non-vacuous):** because every path shares one order, two real paths can't cycle — so the test **monkeypatches one site to reverse its order** and races it against `add_student`. It uses a **between-acquisitions barrier** (park each thread holding its first lock before requesting its second) — hang-free because the two paths take *disjoint* first locks (ENR vs CAP), so neither blocks the other's first acquire — then releases both and asserts `DeadlockDetected` surfaces; with the patch removed, both complete. (The guard-read seam sits after both acquisitions on `add_student`, so it can't drive this — a dedicated barrier is required.)

**Off-HTTP semantics & fabrication:** thread bodies call the router/service functions directly with per-thread sessions. Handlers **raise `HTTPException`** (`enroll_user_in_run` capacity, `create_submission`, `patch_mini_project`, `delete_mini_project`) or **return `JSONResponse(409)`** (`add_student` conflict) — assert `status_code`, not an HTTP response; `_enroll_user` neither raises nor returns a 409 (assert row-count). `create_submission` takes a bare `UploadFile` → each thread fabricates a `starlette.datastructures.UploadFile` over a `SpooledTemporaryFile` of `%PDF-` bytes.

Task 1 lands the fixture + seam + wiring/ordering helper + one real fail-first (the #3 asymmetric protocol) to de-risk the approach early — no threading/advisory precedent exists in the suite.

## 7. Task decomposition (TDD throughout)

- **Task 1 — Foundations:** `advisory_xact_lock` + the four namespace constants + `MAX_GROUP_SIZE`; the **`get_or_create_user` SAVEPOINT fix (C1)**; the NullPool concurrency fixture (with thread-join teardown); the forced-interleave seam + wiring/ordering-assert helper; proven by the Layer-1 `pg_try` primitive test + the #3 asymmetric fail-first.
- **Task 2 — capacity:** `CAPACITY(run_id)` in `enroll_user_in_run` (covers single add + batch rows) + `patch_student` move + `bulk_move` (once before loop) + the four `MAX_GROUP_SIZE` swaps; #1 forced-interleave + fail-first + move-site ordering assertions.
- **Task 3 — enrollment:** `ENROLLMENT(course_id)` at `add_student` (get_or_create-first), `enroll_student`, `enroll_batch`, `publish_run`; #2 RunStudent forced-interleave + fail-first, and the `_enroll_user` two-version count-based test (GREEN wraps the lock).
- **Task 4 — batch:** `add_students_batch` acquires `ENROLLMENT`+`CAPACITY` up front (§5.3, both wired) + the deadlock order-reversal regression test (between-acquisitions barrier).
- **Task 5 — submission:** move file I/O ahead of the lock; `SUBMISSION(mp_id, group_id)` in `create_submission` fixing double-pending + delete the dead retry (§5.4); #3 forced-interleave.
- **Task 6 — mini-project lifecycle:** `MINIPROJECT(mp_id)` in `create_submission` (before `SUBMISSION`) + `patch_mini_project`/`delete_mini_project` re-read (§5.5); the #5 delete-bypass fail-first (sequenced GREEN) + a `patch_mini_project` forced-interleave.

Order 1 → 2 → 3 → 4 → 5 → 6. A final whole-branch dual-gate review closes the slice.

## 8. Non-goals (deferred to a later A2b)

- Admin **structure** ordering races (`block`/`sequence`/`item`/`question` `max(order)+1` — already int4-overflow-guarded in A1).
- `publish_run`'s **structural** readiness re-validation (teacher-count / oversized-group at `runs.py:176`+) — a read-gate, admin-only.
- run-asset quota check-then-act.
- **`auth.py` PIN rate-limit.** Deferred not because it is low-consequence — a concurrent check-then-act on the throttle counter lets N parallel requests each read the pre-increment value and multiply allowed attempts — but because the exposure is bounded by the short PIN TTL, the off-path PIN send, and single-node deployment; it earns its own focused slice.
- **Enrollment deactivate-path lost-update** (`remove_run_student` vs concurrent enroll racing `is_active` toward 0-active-while-rostered) — cannot over-activate #2; low-severity.
- **Two further low-severity admin races** (for exhaustive accounting): `patch_run` lowering `end_date` vs a concurrent submit (`runs.py:100` reads `has_submissions`), and `create_mini_project`'s `UNIQUE(run_id, block_id)` pre-check race (`mini_projects.py:86-94`, loser gets a 500 with no retry). Admin-only, low-severity; batched with the above.

## 9. Success criteria

- Each of the four lock-enforced invariants (#1 capacity, #2 enrollment across BOTH tables, #3 pending-submission, #5 mini-project lock) holds under its GREEN arrangement (§6), and is proven **previously violable** by a deterministic RED fail-first with the lock removed (per-invariant protocol in §6). max-attempts and `submission_number` are excluded (already atomic / UNIQUE-guarded).
- Each of the four advisory domains proven to block a second session in a Layer-1 `pg_try_advisory_xact_lock` test; all **13 acquisitions across 11 sites** proven via wiring **and ordering** (lock-precedes-guard-read) assertions.
- The deadlock order-reversal regression test (between-acquisitions barrier) proves the §3.2 order is load-bearing (reversed → `DeadlockDetected`; correct → both complete).
- `get_or_create_user` recovers via SAVEPOINT (no top-level rollback under a held lock), proven by a lock-survives-concurrent-same-email-insert assertion.
- The `MINIPROJECT` critical section holds no ≤20 MB file I/O (file read/validate/temp-write precede the lock, §5.4).
- Full suite green on Postgres; no new error surface (§4); dead submission retry removed; the four `MAX_GROUP_SIZE` literals unified.
