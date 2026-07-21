# Phase 9-A2 — PostgreSQL Concurrency Hardening (student-facing races) — Design

**Status:** draft rev 1
**Date:** 2026-07-20
**Predecessor:** Phase 9-A1 PostgreSQL migration (merged `dc60688`, 2026-07-19) — dev+test+prod now PostgreSQL 17, giving us real row-level locking + advisory locks.
**Branch:** `feat/phase9-a2-concurrency` (to be created)

## 1. Scope

Close the high-impact **check-then-act** race conditions that A1 made both fixable (real Postgres locking) and testable (real concurrent connections). Five race sites, chosen for correctness impact during real usage bursts:

| # | Invariant at risk | Trigger |
|---|-------------------|---------|
| 1 | quiz attempts must not exceed `version.max_quiz_attempts` | student (quiz submit rush) |
| 2 | a group must not exceed `MAX_GROUP_SIZE` (10) students | admin roster writes (esp. **bulk**) |
| 3 | ≤ 1 active enrollment per (student, course) across runs | admin add-student / batch / publish |
| 4 | ≤ 1 pending submission per revision cycle per (mini-project, group) | student (group members submitting) |
| 5 | `submission_number` must be gap-free & collision-free per (mini-project, group) | student (same as #4) |

**Concurrency profile (stated honestly):** #1, #4, #5 are student-triggered and fire during deadline rushes. #2 and #3 are enforced at **admin** write points but race during **bulk** operations and automation — they are correctness invariants worth making airtight, not throughput concerns. Contention at the scale of a single class (≤200 students) is negligible; this work is about **correctness**, not performance.

**Already mitigated — NOT in scope** (insert races already caught by a UNIQUE constraint + retry): `get_or_create_user` (`helpers.py:70`, unique email), get-or-create `UserItemState` (`student.py:108`, unique `user_id,item_id`).

## 2. Background — why these race, and why now

Each site does a **read (check) → decide → write (act)** across more than one statement, with no lock held across the gap. Under READ COMMITTED (Postgres default), two concurrent transactions each read the pre-write state, both pass the guard, and both write — violating the invariant. On SQLite this was largely masked by the single-writer lock; on Postgres these are live. A1 shipped the engine + harness that make row/advisory locks available and concurrent connections testable, so A2 is the natural follow-on.

## 3. Mechanism design

**House style: pessimistic locking.** Acquire a lock that serializes the concurrent writers, held for the whole read→write critical section, released automatically at transaction end. No optimistic retry harness (avoids idempotency hazards — notably the submission endpoint's file write).

### 3.1 Two shared primitives (Task 1)

**(a) `FOR UPDATE` on an anchor row** — where a single row represents the contended resource:
```python
row = db.execute(
    select(Model).where(Model.id == some_id).with_for_update()
).scalar_one_or_none()
```
Any concurrent writer that also locks that row blocks until the holder commits/rolls back. Used for #1 (the `UserItemState` row) and #2 (the parent `Group` row — locking the parent serializes child `RunStudent` inserts/moves).

**(b) `advisory_xact_lock(db, namespace, *ids)`** — where the invariant spans multiple rows/tables with no single anchor:
```python
def advisory_xact_lock(db: Session, namespace: int, *ids: int) -> None:
    """Transaction-scoped PostgreSQL advisory lock.

    Folds (namespace, *ids) into a deterministic signed 64-bit key via BLAKE2b
    (stable across processes — NOT Python's salted hash()), then calls
    pg_advisory_xact_lock(bigint). Released automatically on commit/rollback;
    no manual unlock, no leak path. Distinct domains never collide unless
    BLAKE2b-64 collides.
    """
    payload = ":".join(str(x) for x in (namespace, *ids)).encode()
    key = int.from_bytes(hashlib.blake2b(payload, digest_size=8).digest(), "big", signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": key})
```
Namespace constants (module-level): `LOCK_NS_ENROLLMENT = 1` (keyed on `user_id, course_id`), `LOCK_NS_SUBMISSION = 2` (keyed on `mp_id, group_id`). Used for #3 and #4/#5.

**`MAX_GROUP_SIZE = 10`** constant extracted from the three hardcoded `10`s (`run_roster.py:149`, `:358`, `helpers.py` add path) — targeted cleanup while we're in these functions.

### 3.2 Deadlock avoidance (design invariant)

- A site that takes **both** locks (add-student = enrollment advisory + group `FOR UPDATE`) always acquires **advisory first, then `FOR UPDATE`**, in that fixed global order.
- A site locking **multiple** group rows in one transaction (batch add) acquires them in **ascending `group_id`** order.
- Advisory locks are acquired before any `FOR UPDATE` in the same transaction.
- **Batch enrollment (`add_students_batch`) processes its rows in a deterministic order — sorted by normalized email — so two concurrent, overlapping batches acquire per-student enrollment locks (which are transaction-scoped and therefore accumulate across the batch) in the same global order and cannot deadlock.** Email is the sort key because it is known before `get_or_create_user` resolves a `user_id`, and the email→user mapping is stable.

### 3.3 `statement_timeout` interaction

The A1 engine sets a session `statement_timeout`. A blocked waiter that exceeded it would raise a clean error rather than hang — but the critical sections here are millisecond-scale (a count + an insert, then commit), so real waits stay far under any reasonable timeout. The deterministic tests prove blocking via `NOWAIT` and therefore do **not** depend on the timeout value.

## 4. Error semantics — no new surface

Every guard already returns the correct `409` today; the races only let a second writer slip past non-atomically. Holding the lock across the read→write makes the **existing** guard atomic, so **no new messages, error codes, or response shapes are introduced**:

- #1 → existing `409 "Max attempts reached"`.
- #2 → existing `409 "Group capacity reached"` (bulk keeps `error_code: capacity_reached`).
- #3 → existing `409 student_already_active_in_course` + conflicts payload.
- #4 → existing `409 "Previous submission pending evaluation"` (the re-read by the unblocked second member now sees the first member's row).
- #5 → serialization makes `max(submission_number)+1` always accurate → the one-shot retry at `submissions.py:154` is **deleted** as dead code.

## 5. Per-site specifications

References are current line numbers (2026-07-20); implementers verify against the code.

### 5.1 max-attempts (`api/quiz.py`, ~submit handler)
After the `UserItemState` row is ensured to exist (existing get-or-create), **re-fetch it `with_for_update()`** before the `state.attempt_count >= max_attempts` check (currently `quiz.py:89`). The check + the later increment then run inside the row lock. Loser: existing `409`.

### 5.2 group capacity (`api/helpers.py` `_enroll_user_in_run`; `api/run_roster.py` `patch_student` :125, bulk-move :330+)
**When a group is specified** (enrollment/assignment may be group-less — no lock needed then), **lock the target `Group` row `with_for_update()`** before `count(RunStudent WHERE group_id=…)`. Replace the literal `10` with `MAX_GROUP_SIZE`. The no-op carve-out (already-in-target) in move/bulk-move is preserved. Loser: existing `409` / `capacity_reached`.

### 5.3 one-active-enrollment (`api/run_roster.py` add-student + `add_students_batch`; `api/runs.py` `publish_run` :217+)
Acquire `advisory_xact_lock(db, LOCK_NS_ENROLLMENT, user_id, course_id)` **before** `find_student_active_conflicts(...)`, held through the insert/publish decision. `publish_run` participates for **this invariant only**. For batch, take the per-student enrollment lock inside the per-row critical section, iterating rows in the deterministic email-sorted order (§3.2) so overlapping batches cannot deadlock. Loser: existing `409` conflicts.

### 5.4 resubmission gate + submission_number (`api/submissions.py` `create_submission`)
Immediately after the group-membership/disabled checks (`submissions.py:66`), acquire `advisory_xact_lock(db, LOCK_NS_SUBMISSION, mp_id, group_id)`. The entire gate (`_latest_evaluation_result` → precondition 409s → `submission_number` derivation → insert) then runs atomically. **Delete** the `except IntegrityError` one-shot retry block (`:151–170`) — unreachable under the lock. Loser: existing `409 "Previous submission pending evaluation"`.

## 6. Testing strategy

**New concurrency-test fixture (Task 1):** a helper that opens N **independent** `Session`s on **separate real connections** to `mathion_test` (real commits, mutually visible), with explicit `TRUNCATE ... RESTART IDENTITY CASCADE` cleanup. It is additive — the existing single-session/TRUNCATE harness is untouched.

**Layer 1 — deterministic interleaving (primary, non-flaky).** Per lock, two sessions stepped by hand:
- *primitive proof:* A holds the lock; B requests it `NOWAIT` → proven to fail/block; A commits → B succeeds.
- *guard-under-lock proof:* A locks → checks → writes → commits; then B locks → re-reads → gets the correct existing `409`.

**Layer 2 — real-thread invariant tests (2–3, belt-and-suspenders).** A thread pool, each thread with its **own** session, fires the operation concurrently (e.g. 20 threads adding to a 9-full group; N threads submitting a quiz at attempt cap; two threads submitting for one cycle; two threads enrolling into different runs of one course). Assert the **invariant held**: group ≤ 10, `attempt_count` ≤ max, exactly one submission per cycle, exactly one active enrollment. These call the router/service functions directly with per-thread sessions (real concurrent DB transactions, no HTTP-server flakiness).

## 7. Task decomposition

TDD throughout; each task ends with an independently testable deliverable.

- **Task 1 — Foundations:** `advisory_xact_lock` helper + namespace constants + `MAX_GROUP_SIZE` + the concurrency-test fixture; proven by the primitive `NOWAIT`-blocking tests for both `FOR UPDATE` and the advisory helper.
- **Task 2 — max-attempts:** `FOR UPDATE` on `UserItemState`; deterministic guard-under-lock + real-thread invariant tests.
- **Task 3 — group capacity:** `FOR UPDATE` on `Group` at the 3 sites + `MAX_GROUP_SIZE` swap; deterministic + real-thread tests.
- **Task 4 — one-active-enrollment:** advisory `(user_id, course_id)` at add / batch / publish; deterministic + real-thread tests.
- **Task 5 — resubmission + submission_number:** advisory `(mp_id, group_id)` in `create_submission`, delete the dead retry; deterministic + real-thread tests.

Order 1 → 2 → 3 → 4 → 5. A final whole-branch dual-gate review closes the slice.

## 8. Non-goals (deferred to a later A2b)

Admin **structure** ordering races (`block`/`sequence`/`item`/`question` `max(order)+1` — already int4-overflow-guarded in A1's review), `publish_run`'s structural readiness re-validation, and the `auth.py` PIN rate-limit lock. These are admin-only, low-concurrency, low-consequence; batched separately to keep this slice reviewable.

## 9. Success criteria

- Each of the 5 invariants holds under the Layer-2 real-thread tests (previously violable — proven by a fail-first run without the lock).
- Each lock proven to block a second session in a Layer-1 deterministic test.
- Full suite green on Postgres; no new error surface (Section 4); the dead submission retry removed.
- No deadlocks (ordering rules §3.2); no manual advisory-unlock anywhere (all `_xact_` scoped).
