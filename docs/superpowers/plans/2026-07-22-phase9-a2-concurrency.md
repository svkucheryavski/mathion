# Phase 9-A2 — PostgreSQL Concurrency Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close ~13 check-then-act race sites in the Mathion backend by holding transaction-scoped PostgreSQL advisory locks across each read→decide→write, enforcing four data invariants that SQLite's single-writer lock previously masked and PostgreSQL does not.

**Architecture:** A single new module `mathion/api/advisory.py` provides the primitive `advisory_xact_lock(db, namespace, *ids)` (BLAKE2b-folded `pg_advisory_xact_lock(bigint)`), four namespace constants, and the size constants. Each racing endpoint acquires its lock(s) in a fixed ascending namespace order immediately before its guard-read, so the read→write is atomic. Batch enrollment endpoints avoid a cross-course users-index deadlock by ordering their `users`-table writes by normalized email (no global lock). No schema/Alembic change — every lock is a runtime construct.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, psycopg3, PostgreSQL 17. Tests use a dedicated `NullPool` concurrency engine yielding real separate connections + a monkeypatchable interleave seam. Backend tooling runs through `backend/.venv`.

**Design spec (READ FIRST for rationale):** `docs/superpowers/specs/2026-07-20-phase9-a2-concurrency-design.md` (rev 11, APPROVED by both review gates). Dual-gate adjudication trail: `scratchpad/a2-spec-review-codex-round{1..5}-adjudication.md`.

## Global Constraints

Every task's requirements implicitly include this section. Exact values, copied from the spec:

- **Four advisory-lock namespaces, acquired in ASCENDING order** (deadlock-freedom by construction): `LOCK_NS_ENROLLMENT = 0` (key `course_id`) → `LOCK_NS_CAPACITY = 1` (key `run_id`) → `LOCK_NS_MINIPROJECT = 2` (key `mp_id`) → `LOCK_NS_SUBMISSION = 3` (key `mp_id, group_id`). Never acquire a lower namespace after a higher one in the same request.
- **Primitive:** `advisory_xact_lock` folds `(namespace, *ids)` via `hashlib.blake2b(payload, digest_size=8)` → signed int8 → `SELECT pg_advisory_xact_lock(:k)`. BLAKE2b (NOT Python's salted `hash()`) so the key is process-stable. `digest_size=8` = exactly the `bigint` range.
- **`MAX_GROUP_SIZE = 10`**, **`MAX_BATCH_SIZE = 300`** — both live in `advisory.py`; replace every literal `10` group-capacity check and add the `300` batch cap.
- **`isolation_level="READ COMMITTED"` pinned explicitly** on the app engine AND the concurrency-test engine — the post-lock re-read depends on it; do not rely on the server default.
- **`get_or_create_user` must recover via SAVEPOINT (`db.begin_nested`), never a top-level `db.rollback()`** — every enrollment path holds an advisory lock across it, and a top-level rollback would release the lock.
- **Advisory-before-index in every enrollment path:** acquire `ENROLLMENT(course_id)` BEFORE `get_or_create_user` (the `users.email` unique-index insert must sit inside the advisory lock), never merely wrapping the inner enroll call.
- **Batch endpoints order their `users`-table writes by normalized email** (both the new-email INSERT and the `full_name` UPDATE) — this removes the cross-course batch deadlock with NO global lock. Restore per-row response ordering to input order.
- **The `MINIPROJECT` critical section must be I/O-free:** in `create_submission`, the ≤20 MB file read + PDF validation + temp-file write happen BEFORE any lock; only the DB gates + `os.replace` + commit run under the locks.
- **Error semantics — no NEW concurrency surface.** Holding a lock across read→write makes the EXISTING guard atomic; keep every existing 409/404/400 message and code. The slice's ONLY new response is an input-validation `422 "Batch too large (max 300); split into smaller chunks"`. A blocked advisory acquire that exceeds `statement_timeout=30000` raises `QueryCanceled`/SQLSTATE `57014` (a 500) — this is the SAME pre-existing infrastructural backstop every lock shares (`database.py:23`), NOT a new surface; the batch cap keeps it rare, it is not eliminated. No `deadlock detected` (40P01) 500s in production paths.
- **No Alembic migration** — runtime locks only.
- **Every locked site gets a wiring + ordering assertion** (lock called with the expected `(namespace, *ids)`, recorded BEFORE that site's guard-read). Deadlock-freedom is proven by a deliberate order-reversal regression test.
- **Conventions:** run pytest/alembic/python via `backend/.venv` (never bare). `git add` exact named paths (never `-A`/`.`). Commit trailer EXACTLY: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Branch `feat/phase9-a2-concurrency` (already checked out).

---

### Task 1: Foundations — primitive, constants, `get_or_create_user` SAVEPOINT, isolation pin, concurrency harness

**Files:**
- Create: `backend/mathion/api/advisory.py`
- Modify: `backend/mathion/api/helpers.py` (`get_or_create_user`, currently `:63-77`)
- Modify: `backend/mathion/database.py` (`create_engine` call, `:13-25`)
- Modify: `backend/tests/conftest.py` (add concurrency fixture + spy helpers)
- Test: `backend/tests/test_concurrency_foundations.py` (create)

**Interfaces:**
- Produces: `advisory.advisory_xact_lock(db: Session, namespace: int, *ids: int) -> None`; constants `LOCK_NS_ENROLLMENT=0`, `LOCK_NS_CAPACITY=1`, `LOCK_NS_MINIPROJECT=2`, `LOCK_NS_SUBMISSION=3`, `MAX_GROUP_SIZE=10`, `MAX_BATCH_SIZE=300`; test seam `advisory.interleave_hook(label: str) -> None` (no-op in prod).
- Produces (conftest): fixture `concurrency` yielding a `_Concurrency` helper with `.make_sessions(n) -> list[Session]` and `.spawn(target, *args, **kwargs) -> Thread`; helper `record_lock_calls(monkeypatch) -> list[tuple]`.
- Consumes: nothing from later tasks. **All later tasks call sites via the module** (`from mathion.api import advisory` then `advisory.advisory_xact_lock(...)` / `advisory.interleave_hook(...)`) so tests can monkeypatch them.

- [ ] **Step 1: Write the failing test — primitive blocks a second session, releases on commit**

Create `backend/tests/test_concurrency_foundations.py`:

```python
from sqlalchemy import text

from mathion.api import advisory


def test_advisory_xact_lock_blocks_second_session_until_commit(concurrency):
    """Session A holds LOCK_NS_CAPACITY(run_id=1); B's pg_try_advisory_xact_lock
    on the SAME key returns False; after A commits, B's retry returns True."""
    sa, sb = concurrency.make_sessions(2)

    # Compute the same folded key the primitive uses, for B's pg_try probe.
    import hashlib
    payload = ":".join(str(x) for x in (advisory.LOCK_NS_CAPACITY, 1)).encode()
    key = int.from_bytes(hashlib.blake2b(payload, digest_size=8).digest(), "big", signed=True)

    sa.begin()
    advisory.advisory_xact_lock(sa, advisory.LOCK_NS_CAPACITY, 1)  # A holds it
    got = sb.execute(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": key}).scalar()
    assert got is False  # B cannot acquire while A holds

    sa.commit()  # releases the xact lock
    sb.rollback()  # end B's aborted-probe txn cleanly
    got2 = sb.execute(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": key}).scalar()
    assert got2 is True
    sb.rollback()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_foundations.py::test_advisory_xact_lock_blocks_second_session_until_commit -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'mathion.api.advisory'` (and the `concurrency` fixture does not exist yet).

- [ ] **Step 3: Create `advisory.py`**

Create `backend/mathion/api/advisory.py`:

```python
import hashlib

from sqlalchemy import text
from sqlalchemy.orm import Session

# --- Advisory-lock namespaces. Acquire in ASCENDING numeric order (deadlock-
# freedom by construction). See design spec section 3.2.
LOCK_NS_ENROLLMENT = 0   # key: (course_id)
LOCK_NS_CAPACITY = 1     # key: (run_id)
LOCK_NS_MINIPROJECT = 2  # key: (mp_id)
LOCK_NS_SUBMISSION = 3   # key: (mp_id, group_id)

MAX_GROUP_SIZE = 10      # a group must not exceed this many RunStudents
MAX_BATCH_SIZE = 300     # enrollment-batch input cap (UX/resource guardrail)


def advisory_xact_lock(db: Session, namespace: int, *ids: int) -> None:
    """Transaction-scoped PostgreSQL advisory lock.

    Folds (namespace, *ids) into a deterministic signed 64-bit key via BLAKE2b
    (process-stable, unlike Python's salted hash()), then blocks on
    pg_advisory_xact_lock(bigint). Released automatically on COMMIT/ROLLBACK.
    """
    payload = ":".join(str(x) for x in (namespace, *ids)).encode()
    key = int.from_bytes(hashlib.blake2b(payload, digest_size=8).digest(), "big", signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": key})


def interleave_hook(label: str) -> None:
    """Test-only seam placed BETWEEN a guarded read and its write. No-op in
    production; concurrency tests monkeypatch this module attribute to block a
    worker thread at a chosen critical section (identified by `label`)."""
    return None
```

- [ ] **Step 4: Add the `concurrency` fixture + `record_lock_calls` helper to `conftest.py`**

Append to `backend/tests/conftest.py` (after the existing fixtures; it references `settings`, already imported at the top):

```python
class _Concurrency:
    """Owns a dedicated NullPool engine + the worker sessions/threads a
    concurrency test spawns, so teardown can join threads and release
    connections BEFORE the autouse _isolation TRUNCATE."""

    def __init__(self, maker):
        self._maker = maker
        self.sessions = []
        self.threads = []

    def make_sessions(self, n):
        made = [self._maker() for _ in range(n)]
        self.sessions.extend(made)
        return made

    def spawn(self, target, *args, **kwargs):
        import threading
        t = threading.Thread(target=target, args=args, kwargs=kwargs)
        t.start()
        self.threads.append(t)
        return t


@pytest.fixture
def concurrency(_isolation):
    """Dedicated NullPool engine (never the app pool) yielding real separate
    connections for multi-thread race tests. Depends on _isolation so pytest
    LIFO-finalizes this fixture (join threads -> release locks) BEFORE the
    autouse TRUNCATE runs."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import NullPool

    eng = create_engine(
        settings.database_url,
        poolclass=NullPool,
        isolation_level="READ COMMITTED",
        connect_args={
            "connect_timeout": 10,
            "options": "-c statement_timeout=30000 -c TimeZone=UTC",
        },
    )
    helper = _Concurrency(sessionmaker(bind=eng))
    yield helper
    for t in helper.threads:
        t.join(timeout=10)
        if t.is_alive():
            raise RuntimeError("concurrency worker thread did not finish within 10s")
    for s in helper.sessions:
        s.rollback()
        s.close()
    eng.dispose()


def record_lock_calls(monkeypatch):
    """Spy on advisory.advisory_xact_lock: append ('lock', namespace, ids) to a
    shared ordered list, then delegate to the real implementation. Returned list
    lets a wiring/ordering test assert the lock args AND that the lock precedes a
    later-recorded ('read', ...) event."""
    from mathion.api import advisory
    events = []
    real = advisory.advisory_xact_lock

    def spy(db, namespace, *ids):
        events.append(("lock", namespace, tuple(ids)))
        return real(db, namespace, *ids)

    monkeypatch.setattr(advisory, "advisory_xact_lock", spy)
    return events
```

Also add this fixture teardown-safety test to `backend/tests/test_concurrency_foundations.py` (spec §6 — "a worker raising mid-critical-section still leaves the DB truncatable"; it proves the fixture releases locks so the autouse TRUNCATE cannot hang):

```python
def test_worker_raising_mid_section_leaves_db_truncatable(concurrency):
    """A worker that acquires an advisory lock then RAISES mid-critical-section
    must not leave its lock held: closing its session (what fixture teardown does)
    releases it, so a fresh connection can re-acquire (and the autouse TRUNCATE
    that follows every test will not block on a leaked lock)."""
    import hashlib

    payload = ":".join(str(x) for x in (advisory.LOCK_NS_CAPACITY, 4242)).encode()
    key = int.from_bytes(hashlib.blake2b(payload, digest_size=8).digest(), "big", signed=True)

    (sw,) = concurrency.make_sessions(1)

    def worker():
        sw.begin()
        advisory.advisory_xact_lock(sw, advisory.LOCK_NS_CAPACITY, 4242)
        raise RuntimeError("boom mid-critical-section")  # thread swallows it; lock still held by sw

    concurrency.spawn(worker).join(timeout=10)  # deterministic: worker has finished

    # While sw is still open the lock is held; closing sw (teardown's job) frees it.
    (probe,) = concurrency.make_sessions(1)
    assert probe.execute(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": key}).scalar() is False
    sw.rollback()
    sw.close()
    assert probe.execute(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": key}).scalar() is True
    probe.rollback()
```

- [ ] **Step 5: Run the primitive + teardown-safety tests to verify they pass**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_foundations.py::test_advisory_xact_lock_blocks_second_session_until_commit backend/tests/test_concurrency_foundations.py::test_worker_raising_mid_section_leaves_db_truncatable -v`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/mathion/api/advisory.py backend/tests/conftest.py backend/tests/test_concurrency_foundations.py
git commit -m "$(cat <<'EOF'
feat(a2): advisory-lock primitive + constants + concurrency test harness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Write the failing test — isolation level is pinned READ COMMITTED**

Add to `backend/tests/test_concurrency_foundations.py`:

```python
from mathion.database import engine as app_engine


def test_app_engine_isolation_is_read_committed():
    with app_engine.connect() as conn:
        level = conn.execute(text("SHOW transaction_isolation")).scalar()
    assert level == "read committed"


def test_concurrency_engine_isolation_is_read_committed(concurrency):
    (s,) = concurrency.make_sessions(1)
    level = s.execute(text("SHOW transaction_isolation")).scalar()
    assert level == "read committed"
    s.rollback()
```

- [ ] **Step 8: Run to verify the app-engine test fails**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_foundations.py::test_app_engine_isolation_is_read_committed -v`
Expected: the concurrency-engine test PASSES (fixture already pins it); the app-engine test may PASS if the server default is already `read committed`. To make the guard load-bearing regardless of server default, still pin it explicitly in Step 9. If it already passes, treat Step 9 as making the guarantee independent of the server/role/db default (the spec's requirement) and keep the test as a regression.

- [ ] **Step 9: Pin `isolation_level` on the app engine**

In `backend/mathion/database.py`, add `isolation_level="READ COMMITTED"` to the `create_engine(...)` call (after `echo=False`):

```python
engine = create_engine(
    settings.database_url,
    echo=False,
    isolation_level="READ COMMITTED",  # A2: post-lock re-read depends on this; do not rely on server default
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_size=5,
    max_overflow=5,
    pool_timeout=30,
    connect_args={
        "connect_timeout": 10,
        "options": "-c statement_timeout=30000 -c TimeZone=UTC",
    },
)
```

- [ ] **Step 10: Run both isolation tests to verify they pass**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_foundations.py -k isolation -v`
Expected: both PASS.

- [ ] **Step 11: Write the failing test — `get_or_create_user` recovers via SAVEPOINT while a lock is held**

Add to `backend/tests/test_concurrency_foundations.py`:

```python
from mathion.api.helpers import get_or_create_user
from mathion.models_auth import User


def test_get_or_create_user_savepoint_preserves_advisory_lock(concurrency):
    """A holds an advisory lock, then loses the users.email insert race to B;
    get_or_create_user must recover via SAVEPOINT (returning B's row) WITHOUT a
    top-level rollback — so A's advisory lock is still held afterwards."""
    sa, sb = concurrency.make_sessions(2)
    email = "race@example.com"

    sa.begin()
    advisory.advisory_xact_lock(sa, advisory.LOCK_NS_ENROLLMENT, 999)  # A holds it

    # B creates the user first and commits (the winner).
    sb.begin()
    sb.add(User(email=email, full_name=None))
    sb.commit()

    # A now runs get_or_create_user: its INSERT hits the unique index -> IntegrityError
    # -> SAVEPOINT recovery -> re-SELECT returns B's row. A's txn stays open.
    user = get_or_create_user(sa, email)
    assert user.email == email

    # Prove A's advisory lock is STILL held: a fresh session's pg_try must fail.
    (sc,) = concurrency.make_sessions(1)
    import hashlib
    payload = ":".join(str(x) for x in (advisory.LOCK_NS_ENROLLMENT, 999)).encode()
    key = int.from_bytes(hashlib.blake2b(payload, digest_size=8).digest(), "big", signed=True)
    assert sc.execute(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": key}).scalar() is False
    sc.rollback()

    sa.commit()
```

- [ ] **Step 12: Run to verify it fails**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_foundations.py::test_get_or_create_user_savepoint_preserves_advisory_lock -v`
Expected: FAIL — the current `get_or_create_user` calls `db.rollback()` (helpers.py:74), ending A's transaction and releasing the advisory lock, so the final `pg_try` returns `True` (assertion fails).

- [ ] **Step 13: Rewrite `get_or_create_user` to use a SAVEPOINT**

In `backend/mathion/api/helpers.py`, replace `get_or_create_user` (`:63-77`) with:

```python
def get_or_create_user(db: Session, email: str):
    """Return existing user by email, or create a new one with email only.

    Concurrent-insert recovery uses a SAVEPOINT (db.begin_nested), NOT a
    top-level db.rollback(): every enrollment path now holds an advisory lock
    across this call, and a top-level rollback would end the transaction and
    release that lock. The SAVEPOINT unwinds only the failed INSERT; an advisory
    lock acquired before the savepoint survives ROLLBACK TO SAVEPOINT.
    """
    from mathion.models_auth import User

    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        try:
            with db.begin_nested():
                user = User(email=email, full_name=None)
                db.add(user)
                db.flush()  # detect a concurrent insert on the unique email index
        except IntegrityError:
            # The other request already created the user — re-query the winner.
            user = db.execute(select(User).where(User.email == email)).scalar_one()
    return user
```

Confirm `IntegrityError` is imported at the top of `helpers.py` (`from sqlalchemy.exc import IntegrityError`); it already is (used by the current implementation). `select` is already imported.

- [ ] **Step 14: Run the SAVEPOINT test + the full existing helpers/enrollment suite**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_foundations.py::test_get_or_create_user_savepoint_preserves_advisory_lock backend/tests/test_enrollment.py backend/tests/test_run_roster.py -v`
Expected: the SAVEPOINT test PASSES; no regressions in the existing enrollment/roster suites (get_or_create_user is still correct in the non-locked call paths).

- [ ] **Step 15: Write the #3 race RED fail-first (de-risks the fixture + seam)**

This proves the pending-submission race reproduces with the harness, and stays valid after Task 5 adds the lock (it monkeypatches the lock to a no-op). Add `backend/tests/test_concurrency_submission.py`:

```python
import threading

from sqlalchemy import func, select

from mathion.api import advisory
from mathion.models import MiniProject, Submission


def test_pending_submission_race_reproduces_without_lock(concurrency, monkeypatch, seed_run_with_published_mp):
    """RED: two group members submit concurrently; both pass the pending-gate at
    the seam, both insert a pending submission -> 2 pending rows. Proves the race
    (and exercises the fixture + interleave seam). Monkeypatches advisory locks to
    no-ops so this remains the lock-removed RED after Task 5 adds the SUBMISSION lock."""
    run, ga, gb, mp = seed_run_with_published_mp()
    # ... arrange two RunStudents in group ga who will submit (see test_submissions.py
    # helpers for building an UploadFile of b"%PDF-1.4" bytes and calling create_submission
    # directly with a per-thread session). Full arrangement is specified in Task 5, Step 1;
    # here we only need the RED to demonstrate the double-pending race.

    monkeypatch.setattr(advisory, "advisory_xact_lock", lambda db, ns, *ids: None)

    # A barrier released AFTER both threads pass the pending gate. Engage the seam
    # ONLY for label == "submission_pending" (the create_submission critical section).
    barrier = threading.Barrier(2)
    real_hook = advisory.interleave_hook

    def hook(label):
        if label == "submission_pending":
            barrier.wait(timeout=10)
        return real_hook(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)

    # spawn two create_submission calls on separate sessions via concurrency.spawn(...),
    # each fabricating a %PDF-1.4 UploadFile (arrangement detailed in Task 5).
    # After join, assert two PENDING submissions exist for (mp, ga):
    # count == 2 proves the race. (Task 5's GREEN asserts the lock forces count/409.)
```

> Note for the implementer: this Task-1 RED needs the `create_submission` interleave seam, which is ADDED in Task 5, Step 3 (the `advisory.interleave_hook("submission_pending")` call between the pending gate and the insert). Since Task 1 runs first, land the seam call as part of Task 1 here too: add `from mathion.api import advisory` and `advisory.interleave_hook("submission_pending")` immediately after the pending-gate block in `submissions.py` (`:73-92`, right after `is_resubmission` is decided and before the deadline gates), so this RED can drive the interleave. Task 5 builds the full restructure around it.

- [ ] **Step 16: Land the `create_submission` pending seam + run the #3 RED**

Add `from mathion.api import advisory` to `submissions.py` imports, and insert `advisory.interleave_hook("submission_pending")` immediately after the pending-gate block (`submissions.py:92`, after `is_resubmission` is set, before `# Deadline gates`).
Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_submission.py::test_pending_submission_race_reproduces_without_lock -v`
Expected: PASS (2 pending rows — the race reproduces; the seam + fixture work).

- [ ] **Step 17: Run the full backend suite to confirm no regressions, then commit**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: all pass (baseline 1109+ passing; +new foundation tests).

```bash
git add backend/mathion/database.py backend/mathion/api/helpers.py backend/mathion/api/submissions.py backend/tests/test_concurrency_foundations.py backend/tests/test_concurrency_submission.py
git commit -m "$(cat <<'EOF'
feat(a2): pin READ COMMITTED, SAVEPOINT get_or_create_user, #3 race harness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Group capacity (invariant #1) — `CAPACITY(run_id)`

**Files:**
- Modify: `backend/mathion/api/helpers.py` (`enroll_user_in_run`, `:169-220`)
- Modify: `backend/mathion/api/run_roster.py` (`patch_student` move `:137-151`; `bulk_move` count `:348-368`)
- Modify: `backend/mathion/api/runs.py` (`publish_run` readiness `having(count > 10)` `:209` + message `:212`)
- Test: `backend/tests/test_concurrency_capacity.py` (create)

**Interfaces:**
- Consumes: `advisory.advisory_xact_lock`, `advisory.LOCK_NS_CAPACITY`, `advisory.MAX_GROUP_SIZE`, `advisory.interleave_hook` (Task 1).
- Produces: nothing new for later tasks.

Invariant #1: a group must not exceed `MAX_GROUP_SIZE`. Every group-count-then-write is guarded by `CAPACITY(run_id)`. Replace the four literal `10`s with `MAX_GROUP_SIZE`.

- [ ] **Step 1: Write the #1 capacity RED fail-first**

Create `backend/tests/test_concurrency_capacity.py`:

```python
import threading

from sqlalchemy import func, select

from mathion.api import advisory
from mathion.api.helpers import enroll_user_in_run
from mathion.models import Group, Run, RunStudent


def test_capacity_race_two_adds_overflow_without_lock(concurrency, monkeypatch, seed_run_with_groups, make_user):
    """RED: a group with MAX_GROUP_SIZE-1 members; two threads each add a distinct
    user; both read count=9 at the seam; both insert -> 11 members. Lock removed."""
    run, ga, gb = seed_run_with_groups()
    # fill Group A to 9 members (arrange via direct RunStudent inserts on the db fixture)
    # ... (implementer fills ga to MAX_GROUP_SIZE-1; see seed_run_with_groups: alice already in ga)

    monkeypatch.setattr(advisory, "advisory_xact_lock", lambda db, ns, *ids: None)
    barrier = threading.Barrier(2)
    real_hook = advisory.interleave_hook

    def hook(label):
        if label == "capacity":
            barrier.wait(timeout=10)
        return real_hook(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)

    u1, u2 = make_user(), make_user()
    (s1,), (s2,) = concurrency.make_sessions(1), concurrency.make_sessions(1)

    def add(sess, uid):
        sess.begin()
        run_obj = sess.get(Run, run["id"])
        user = sess.get(type(u1), uid)
        enroll_user_in_run(sess, user, run_obj, ga["id"])
        sess.commit()

    concurrency.spawn(add, s1, u1.id)
    concurrency.spawn(add, s2, u2.id)
    # join happens in fixture teardown; assert after explicit joins:
    for t in list(concurrency.threads):
        t.join(timeout=10)

    (verify,) = concurrency.make_sessions(1)
    count = verify.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == ga["id"]))
    verify.rollback()
    assert count == advisory.MAX_GROUP_SIZE + 1  # 11 — overflow proven
```

- [ ] **Step 2: Run to verify it fails-as-RED (proves the race)**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_capacity.py::test_capacity_race_two_adds_overflow_without_lock -v`
Expected: PASS as a RED (count == 11) — but ONLY if the `capacity` seam exists. It does not yet, so first add the seam in Step 3, then this passes.

- [ ] **Step 3: Add `CAPACITY(run_id)` lock + seam + `MAX_GROUP_SIZE` in `enroll_user_in_run`**

In `backend/mathion/api/helpers.py`, edit `enroll_user_in_run` so the capacity block acquires the lock BEFORE the count read, fires the seam between read and write, and uses `MAX_GROUP_SIZE`:

```python
    from mathion.api import advisory

    version = db.get(CourseVersion, run.version_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Run version is disabled")

    if group_id is not None:
        advisory.advisory_xact_lock(db, advisory.LOCK_NS_CAPACITY, run.id)
        count = db.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == group_id))
        advisory.interleave_hook("capacity")
        if count >= advisory.MAX_GROUP_SIZE:
            raise HTTPException(status_code=409, detail="Group capacity reached")
```

(Keep the rest of `enroll_user_in_run` unchanged. The lock is keyed on `run.id`; a batch that re-enters this helper per row re-acquires the SAME run key — a harmless re-entrant no-op under the batch's up-front hold, see Task 4.)

- [ ] **Step 4: Run the #1 RED to confirm the race reproduces (lock no-op'd)**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_capacity.py::test_capacity_race_two_adds_overflow_without_lock -v`
Expected: PASS (count == 11 with the lock monkeypatched to a no-op).

- [ ] **Step 5: Write the #1 capacity GREEN**

Add to `test_concurrency_capacity.py` — same arrangement but WITHOUT the lock monkeypatch (real lock) and a free-running race (no seam block):

```python
def test_capacity_lock_prevents_overflow(concurrency, seed_run_with_groups, make_user):
    """GREEN: real CAPACITY lock -> one add wins, the other 409s; count stays <= MAX_GROUP_SIZE."""
    run, ga, gb = seed_run_with_groups()
    # fill ga to MAX_GROUP_SIZE-1 ... (same setup as the RED)
    u1, u2 = make_user(), make_user()
    (s1,), (s2,) = concurrency.make_sessions(1), concurrency.make_sessions(1)
    errors = []

    def add(sess, uid):
        from fastapi import HTTPException
        try:
            sess.begin()
            run_obj = sess.get(Run, run["id"])
            user = sess.get(type(u1), uid)
            enroll_user_in_run(sess, user, run_obj, ga["id"])
            sess.commit()
        except HTTPException as e:
            sess.rollback()
            errors.append(e.status_code)

    concurrency.spawn(add, s1, u1.id)
    concurrency.spawn(add, s2, u2.id)
    for t in list(concurrency.threads):
        t.join(timeout=10)

    (verify,) = concurrency.make_sessions(1)
    count = verify.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == ga["id"]))
    verify.rollback()
    assert count == advisory.MAX_GROUP_SIZE          # exactly 10, no overflow
    assert errors == [409]                            # exactly one loser, a 409
```

- [ ] **Step 6: Run the GREEN to verify it passes**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_capacity.py -v`
Expected: both RED and GREEN PASS.

- [ ] **Step 7: Add `CAPACITY` lock + `MAX_GROUP_SIZE` to `patch_student` move**

In `backend/mathion/api/run_roster.py`, `patch_student` (`:137-151`), acquire the lock before the count and use `MAX_GROUP_SIZE`:

```python
    if "group_id" in updates:
        new_gid = updates["group_id"]
        if new_gid is not None:
            g = db.get(Group, new_gid)
            if g is None or g.run_id != run_id:
                raise HTTPException(status_code=400, detail="Group not in this run")
            if g.is_disabled:
                raise HTTPException(status_code=409, detail="Cannot move student into disabled group")
            advisory.advisory_xact_lock(db, advisory.LOCK_NS_CAPACITY, run_id)
            count = db.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == new_gid))
            advisory.interleave_hook("capacity")
            if count >= advisory.MAX_GROUP_SIZE and rs.group_id != new_gid:
                raise HTTPException(status_code=409, detail="Group capacity reached")
        rs.group_id = new_gid
```

Add `from mathion.api import advisory` to `run_roster.py` imports if absent. Remove the stale `# TODO(phase 9)` comment above the count.

- [ ] **Step 8: Add `CAPACITY` lock (once, before the row loop) + `MAX_GROUP_SIZE` to `bulk_move`**

In `backend/mathion/api/run_roster.py`, `bulk_move`: acquire `advisory.advisory_xact_lock(db, advisory.LOCK_NS_CAPACITY, run_id)` ONCE immediately before the per-row loop begins (the count at `:352` sits inside the loop; one run-keyed acquire covers every row). Replace the `count >= 10` at `:358` with `count >= advisory.MAX_GROUP_SIZE`. (No per-row seam needed here; the move-site ordering assertion in Step 11 covers wiring.)

- [ ] **Step 9: Replace the `publish_run` readiness literal**

In `backend/mathion/api/runs.py`, `publish_run`: change `.having(func.count(RunStudent.id) > 10)` (`:209`) to `.having(func.count(RunStudent.id) > advisory.MAX_GROUP_SIZE)` and the message `"(max 10)"` (`:212`) to `f"(max {advisory.MAX_GROUP_SIZE})"`. Add `from mathion.api import advisory` if absent. (This is a read-gate, not a locked write — no lock here; the literal-unification is the only change.)

- [ ] **Step 10: Write the `patch_student` forced-interleave RED/GREEN + the wiring/ordering assertions**

Add to `test_concurrency_capacity.py`: (a) a `patch_student` move RED (two concurrent moves into a 9-member group both pass the seam → 11; lock no-op'd) + GREEN (real lock → one 409, count 10); (b) a single-threaded wiring/ordering test using `record_lock_calls`:

```python
def test_capacity_wiring_and_ordering(client, monkeypatch, seed_run_with_groups, make_user, db):
    """Single-threaded: enroll_user_in_run records a CAPACITY(run_id) lock, and the
    lock is recorded BEFORE the group-count guard read."""
    from mathion.api import advisory
    from tests.conftest import record_lock_calls  # or import the helper directly
    events = record_lock_calls(monkeypatch)

    read_seen = {"after_lock": None}
    real_scalar = db.scalar

    def scalar_spy(*a, **k):
        # Record that the FIRST count read happens with a lock already recorded.
        if read_seen["after_lock"] is None:
            read_seen["after_lock"] = len(events) > 0
        return real_scalar(*a, **k)

    monkeypatch.setattr(db, "scalar", scalar_spy)
    # ... call enroll_user_in_run(db, user, run_obj, ga["id"]) into a group with room
    assert ("lock", advisory.LOCK_NS_CAPACITY, (run_obj.id,)) in events
    assert read_seen["after_lock"] is True   # count read happened AFTER the lock
```

(For `bulk_move`, assert `("lock", LOCK_NS_CAPACITY, (run_id,))` appears exactly once, before the first per-row count.)

- [ ] **Step 11: Run the capacity suite + the group/roster regression suites**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_capacity.py backend/tests/test_groups.py backend/tests/test_run_roster.py -v`
Expected: all PASS.

- [ ] **Step 12: Commit**

```bash
git add backend/mathion/api/helpers.py backend/mathion/api/run_roster.py backend/mathion/api/runs.py backend/tests/test_concurrency_capacity.py
git commit -m "$(cat <<'EOF'
feat(a2): CAPACITY(run_id) lock on group-capacity writes (invariant #1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: One-active-enrollment (invariant #2) — `ENROLLMENT(course_id)`

**Files:**
- Modify: `backend/mathion/api/run_roster.py` (`add_student`, `:59-112`)
- Modify: `backend/mathion/api/enrollment.py` (`enroll_student` `:75-89`; `enroll_batch` `:92-111`)
- Modify: `backend/mathion/api/runs.py` (`publish_run`, `:174-263`)
- Test: `backend/tests/test_concurrency_enrollment.py` (create)

**Interfaces:**
- Consumes: `advisory.advisory_xact_lock`, `advisory.LOCK_NS_ENROLLMENT`, `advisory.interleave_hook`; `get_or_create_user` (SAVEPOINT-safe, Task 1); `find_student_active_conflicts`.
- Produces: nothing new for later tasks. (Task 4 relies on the same ENROLLMENT ordering in `add_students_batch`.)

Invariant #2: ≤1 active enrollment per (student, course), enforced per-table on BOTH `RunStudent` (via `add_student`/`publish_run`) AND `StudentEnrollment` (via `enroll_student`/`enroll_batch` → `_enroll_user`). **Advisory-before-index:** every path acquires `ENROLLMENT(course_id)` BEFORE `get_or_create_user`.

- [ ] **Step 1: Write the #2 RunStudent RED/GREEN (pre-existing student)**

Create `backend/tests/test_concurrency_enrollment.py`. RED: two threads add the SAME existing student to two DIFFERENT runs of ONE course; both `find_student_active_conflicts` empty at the seam; both enroll → active in two runs. GREEN: real lock → one wins, the other 409s. Use the `add_student` router function via per-thread sessions, engaging the seam `"enrollment_runstudent"`. Assert: RED → 2 active `RunStudent` rows across the two runs; GREEN → exactly 1 active + one 409. (Follow the exact protocol in spec §6, "#2 RunStudent — symmetric".)

- [ ] **Step 2: Run to verify the GREEN fails / RED demonstrates the race (no lock yet)**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_enrollment.py -v`
Expected: FAIL — no ENROLLMENT lock nor seam exists yet in `add_student`.

- [ ] **Step 3: Reorder `add_student` — `ENROLLMENT` before `get_or_create_user`, conflict check under the lock**

In `backend/mathion/api/run_roster.py`, replace the resolve-only block + conflict check + create (`:74-112`) with (keeps the input-validation block `:62-72` unchanged, adds `from mathion.api import advisory` at the top if absent):

```python
    course_id = run.version.course_id
    advisory.advisory_xact_lock(db, advisory.LOCK_NS_ENROLLMENT, course_id)
    # get_or_create FIRST (SAVEPOINT-safe) so a brand-new email is also conflict-checked
    # under the lock — fixes the pre-reorder bypass where existing_user=None skipped it.
    target = get_or_create_user(db, data.email)
    conflicts = find_student_active_conflicts(
        db, target.id, course_id=course_id, exclude_run_id=run.id
    )
    advisory.interleave_hook("enrollment_runstudent")
    if conflicts:
        conflict_dicts = [
            {
                "user_id": target.id,
                "email": target.email,
                "run_id": rid_other,
                "run_title": title,
            }
            for (rid_other, title) in conflicts
        ]
        detail = (
            f"{data.email} is already active in run "
            f"\"{conflict_dicts[0]['run_title']}\" of the same course."
        )
        return JSONResponse(
            status_code=409,
            content=make_already_active_409_body(conflict_dicts, summary_override=detail),
        )

    rs = enroll_user_in_run(db, target, run, data.group_id)
    db.commit()
    db.refresh(rs)
    return _to_response(rs)
```

- [ ] **Step 4: Run the #2 RunStudent RED/GREEN to verify they pass**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_enrollment.py -v`
Expected: RED (lock no-op'd → 2 active) and GREEN (real lock → 1 active + one 409) both PASS.

- [ ] **Step 5: Write the #2 new-email-variant RED/GREEN**

Add to `test_concurrency_enrollment.py`: two threads add the SAME BRAND-NEW email into two runs of one course. RED (lock no-op'd → get_or_create races, both enroll) → 2 active. GREEN (real lock → one 409). This is a distinct interleave from Step 1 (proves the get-or-create-first reorder closes the new-user bypass). Full protocol: spec §6, "New-email variant".

- [ ] **Step 6: Add `ENROLLMENT` to `enroll_student` (StudentEnrollment layer)**

In `backend/mathion/api/enrollment.py`, `enroll_student` (`:75-89`), acquire the lock before `get_or_create_user` (add `from mathion.api import advisory` at the top):

```python
    get_or_404(db, Course, course_id)
    require_course_admin(db, current_user, course_id)
    version = get_newest_published_version(db, course_id)
    advisory.advisory_xact_lock(db, advisory.LOCK_NS_ENROLLMENT, course_id)
    user = get_or_create_user(db, data.email)
    enrollment = _enroll_user(db, user, course_id, version)
    db.commit()
    db.refresh(enrollment)
    return _enrollment_to_response(enrollment)
```

- [ ] **Step 7: Add `ENROLLMENT` + email-ordering to `enroll_batch`**

In `backend/mathion/api/enrollment.py`, `enroll_batch` (`:92-111`), acquire the lock once before the loop and process the users-table writes in normalized-email order, restoring the response to input order:

```python
    get_or_404(db, Course, course_id)
    require_course_admin(db, current_user, course_id)
    version = get_newest_published_version(db, course_id)
    unique_emails = list(dict.fromkeys(e.strip().lower() for e in data.emails))
    advisory.advisory_xact_lock(db, advisory.LOCK_NS_ENROLLMENT, course_id)
    # Deadlock-freedom (spec 3.2/5.3): touch the shared `users` rows in a stable
    # normalized-email order, but return results in the client's INPUT order.
    order = sorted(range(len(unique_emails)), key=lambda i: unique_emails[i])
    by_index: dict[int, StudentEnrollment] = {}
    for i in order:
        user = get_or_create_user(db, unique_emails[i])
        by_index[i] = _enroll_user(db, user, course_id, version)
    results = [by_index[i] for i in range(len(unique_emails))]
    db.commit()
    for enrollment in results:
        db.refresh(enrollment)
    return [_enrollment_to_response(e) for e in results]
```

- [ ] **Step 8: Add `ENROLLMENT` to `publish_run`**

In `backend/mathion/api/runs.py`, `publish_run`: immediately after the `if run.is_published: raise ...` guard (`:185`), acquire the lock held through the flip (remove the stale `# TODO(phase 9)` comment `:176-178`):

```python
    advisory.advisory_xact_lock(db, advisory.LOCK_NS_ENROLLMENT, run.version.course_id)
```

The existing readiness + conflict-aggregation reads and the `run.is_published = True` flip (`:187-261`) stay unchanged; they now run atomically under the lock.

- [ ] **Step 9: Write the `_enroll_user` two-version count-based test + cross-endpoint deadlock fail-first**

Add to `test_concurrency_enrollment.py`:
- `_enroll_user` two-version test: call `_enroll_user` directly with TWO DISTINCT versions of one course (endpoints can't — they resolve the same newest version). RED (no lock, seam interleave) → 2 active `StudentEnrollment` rows; GREEN (each thread wraps its `_enroll_user` in `advisory.advisory_xact_lock(db, LOCK_NS_ENROLLMENT, course_id)`) → 1 active. Assert the active-row COUNT, not a 409 (spec §6, "#2 StudentEnrollment").
- Cross-endpoint advisory-vs-index deadlock fail-first: race `add_student` (correct order `ENROLLMENT`→`get_or_create_user`) against `enroll_student` monkeypatched to the buggy order (`get_or_create_user`→`ENROLLMENT`), same brand-new email + course. Park `enroll_student` after its users insert (holding the uncommitted email index) but before its `ENROLLMENT`; let `add_student` take `ENROLLMENT` then block on the index; release → assert `DeadlockDetected` (`40P01`). Control (both correct order): both complete, exactly ONE `User`, one active `RunStudent`, one active `StudentEnrollment`, NO roster 409 (invariant #2 is per-table). Full protocol: spec §6, "Cross-endpoint advisory-vs-index deadlock".

- [ ] **Step 10: Write wiring/ordering assertions for every enrollment path**

Add single-threaded wiring tests (using `record_lock_calls`): `add_student`, `enroll_student`, `enroll_batch`, `publish_run` each record `("lock", LOCK_NS_ENROLLMENT, (course_id,))`, and for `add_student`/`enroll_student`/`enroll_batch` assert the lock is recorded BEFORE `get_or_create_user` (spy `helpers.get_or_create_user` to append a `("read", ...)` marker and assert order).

- [ ] **Step 11: Run the enrollment suite + regressions, then commit**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_enrollment.py backend/tests/test_enrollment.py backend/tests/test_run_roster.py backend/tests/test_runs.py -v`
Expected: all PASS.

```bash
git add backend/mathion/api/run_roster.py backend/mathion/api/enrollment.py backend/mathion/api/runs.py backend/tests/test_concurrency_enrollment.py
git commit -m "$(cat <<'EOF'
feat(a2): ENROLLMENT(course_id) lock across enrollment paths (invariant #2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Batch enrollment — `add_students_batch` locks + email-ordering + `MAX_BATCH_SIZE` cap

**Files:**
- Modify: `backend/mathion/api/run_roster.py` (`add_students_batch`, `:177-243`)
- Modify: `backend/mathion/schemas.py` (`EnrollBatchRequest.emails` `:258`; `RunStudentBatchRequest.rows` `:531`)
- Test: `backend/tests/test_concurrency_batch.py` (create)

**Interfaces:**
- Consumes: `advisory.advisory_xact_lock`, `advisory.LOCK_NS_ENROLLMENT`, `advisory.LOCK_NS_CAPACITY`, `advisory.MAX_BATCH_SIZE`.
- Produces: nothing new for later tasks.

`add_students_batch` acquires `ENROLLMENT(course_id)` then `CAPACITY(run_id)` ONCE up front (advisory-xact locks acquired before the per-row `begin_nested` savepoints survive `ROLLBACK TO SAVEPOINT`), then processes its per-row `users`-table writes in normalized-email order (deadlock-freedom, no global lock), restoring the 207 results to input order. Both batch schemas are capped at `MAX_BATCH_SIZE`.

- [ ] **Step 1: Write the `422` cap-reject test**

Create `backend/tests/test_concurrency_batch.py`:

```python
from mathion.api import advisory


def test_batch_rows_over_cap_rejected_422(admin_client, seed_publishable_version, db):
    course, version = seed_publishable_version()
    run = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2030-01-01"},
    ).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/publish")
    rows = [{"email": f"u{i}@example.com"} for i in range(advisory.MAX_BATCH_SIZE + 1)]
    resp = admin_client.post(f"/api/runs/{run['id']}/students/batch", json={"rows": rows})
    assert resp.status_code == 422


def test_enroll_batch_emails_over_cap_rejected_422(admin_client, seed_publishable_version):
    course, version = seed_publishable_version()
    emails = [f"u{i}@example.com" for i in range(advisory.MAX_BATCH_SIZE + 1)]
    resp = admin_client.post(f"/api/courses/{course['id']}/enroll-batch", json={"emails": emails})
    assert resp.status_code == 422
```

- [ ] **Step 2: Run to verify it fails (no cap yet)**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_batch.py -k cap -v`
Expected: FAIL — a 301-row batch is currently accepted (200/207), not 422.

- [ ] **Step 3: Cap both batch schemas at `MAX_BATCH_SIZE`**

In `backend/mathion/schemas.py`: import the constant (`from mathion.api.advisory import MAX_BATCH_SIZE`) — or hard-code `300` with a comment referencing `advisory.MAX_BATCH_SIZE` if an import cycle arises (schemas is imported broadly; verify no cycle, else inline the literal `300`). Add `max_length=MAX_BATCH_SIZE` to `EnrollBatchRequest.emails` (`:258`) and `RunStudentBatchRequest.rows` (`:531`), each keeping `min_length=1`. Pydantic v2 `Field(min_length=1, max_length=MAX_BATCH_SIZE)` on the list yields a `422` for over-cap input before any handler runs.

> If importing `advisory` into `schemas.py` creates a cycle (advisory imports nothing from schemas, so it should not), prefer the import. Confirm with `backend/.venv/bin/python -c "import mathion.schemas"`.

- [ ] **Step 4: Run the cap tests to verify they pass**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_batch.py -k cap -v`
Expected: both PASS (422).

- [ ] **Step 5: Add up-front locks + email-ordering to `add_students_batch`**

In `backend/mathion/api/run_roster.py`, `add_students_batch` (`:190-243`): acquire the two locks up front, then iterate rows in normalized-email order while emitting results in input order. Replace `results = []` … the `for row in data.rows:` loop with:

```python
    results: list[dict | None] = [None] * len(data.rows)
    course_id = run.version.course_id
    advisory.advisory_xact_lock(db, advisory.LOCK_NS_ENROLLMENT, course_id)
    advisory.advisory_xact_lock(db, advisory.LOCK_NS_CAPACITY, run.id)

    # Deadlock-freedom (spec 3.2/5.3): visit rows in normalized-email order so any
    # two batches acquire the shared `users` index/row locks in one global order.
    # Emit results in INPUT order (results[i]) so the response shape is unchanged.
    visit_order = sorted(range(len(data.rows)), key=lambda i: data.rows[i].email.strip().lower())
    for i in visit_order:
        row = data.rows[i]
        target = get_or_create_user(db, row.email)
        conflicts = find_student_active_conflicts(
            db, target.id, course_id=course_id, exclude_run_id=run.id
        )
        if conflicts:
            results[i] = {
                "email": row.email,
                "status": "error",
                "detail": f"Already active in '{conflicts[0][1]}'",
                "error_code": STUDENT_ALREADY_ACTIVE_ERROR_CODE,
            }
            continue

        sp = db.begin_nested()
        try:
            if row.name and not target.full_name:
                target.full_name = row.name
            gid: int | None = None
            if row.group:
                g = db.execute(
                    select(Group).where(Group.run_id == run_id, Group.name == row.group)
                ).scalar_one_or_none()
                if g is None:
                    g = Group(run_id=run_id, name=row.group)
                    db.add(g)
                    db.flush()
                elif g.is_disabled:
                    raise HTTPException(status_code=409, detail=f"Cannot add students to disabled group '{row.group}'")
                gid = g.id

            rs = enroll_user_in_run(db, target, run, gid)
            sp.commit()
            results[i] = {"email": row.email, "status": "added", "group_id": rs.group_id}
        except HTTPException as e:
            sp.rollback()
            results[i] = {"email": row.email, "status": "error", "detail": e.detail}
        except Exception:  # noqa: BLE001
            logger.exception("Unexpected error in batch student add for %s", row.email)
            sp.rollback()
            results[i] = {"email": row.email, "status": "error", "detail": "internal error"}

    db.commit()
    return {"results": results}
```

Notes: the per-row internal sequence (conflict-check → `full_name` → group → `enroll_user_in_run`) is unchanged — only the visitation order and result-slot indexing change, so a conflicting row still never mutates user state. `enroll_user_in_run` re-acquires `CAPACITY(run.id)` per row — a harmless re-entrant no-op under the batch's up-front hold (the up-front acquire, before the savepoints, is the load-bearing hold). Add `from mathion.api import advisory` if absent.

- [ ] **Step 6: Write the cross-course batch email-ordering fail-first (Finding 3 proof)**

Add to `test_concurrency_batch.py`: race two `add_students_batch` calls on DIFFERENT courses with overlapping brand-new emails in OPPOSITE input order (course A rows `[x, y]`, course B rows `[y, x]`), each parked at a between-users seam (after inserting its first new user, before its second). RED (monkeypatch off the email sort, e.g. patch the module to iterate `range(len(data.rows))` instead of `visit_order` — or monkeypatch `sorted` at the call to identity): A holds `x`'s index waits `y`; B holds `y` waits `x` → `DeadlockDetected` (`40P01`) for one batch. GREEN (email-ordered): both visit `x` then `y` → one-directional wait → both complete, exactly one `User` per email. Full protocol: spec §6, "Cross-course batch deadlock (the email-ordering proof)".

> Seam for "between users": add `advisory.interleave_hook("batch_between_users")` inside the `add_students_batch` visit loop right after `get_or_create_user`. Engage it in the RED to park each batch after its first user.

- [ ] **Step 7: Write the deadlock order-reversal regression + 57014 backstop documentation + sorted-email + up-front-lock wiring**

Add to `test_concurrency_batch.py`:
- **Deadlock order-reversal regression** (proves the §3.2 ascending order is load-bearing): monkeypatch ONE two-lock site to reverse its acquisition order (`add_student` takes `CAPACITY` then `ENROLLMENT`) and race it against a correct-order `add_student`, using a between-acquisitions barrier (park each thread holding its first lock before its second; the two correct paths take disjoint first locks so neither blocks the other's first acquire). Assert `DeadlockDetected`. Control (patch removed) → both complete, WITHOUT the barrier. Full protocol: spec §6, "Deadlock regression".
- **Batch `57014` backstop documentation** (spec §6 "Batch-size cap + shared timeout backstop", §9): a deterministic contention test proving the batch shares the design's `statement_timeout` backstop — it **documents** the `57014`, it does NOT assert unreachability. Build a dedicated **low-`statement_timeout`** engine inline (mirror the `concurrency` fixture's `create_engine`: `poolclass=NullPool`, `isolation_level="READ COMMITTED"`, but `connect_args={"connect_timeout": 10, "options": "-c statement_timeout=500 -c TimeZone=UTC"}`) and open one session on it. Park batch A mid-loop at the `"batch_between_users"` seam (from Step 6) holding its `ENROLLMENT` lock + a shared user's just-flushed `users` index lock; on the low-timeout session fire a contending same-course `enroll_student` (or a different-course batch sharing A's lowest email) that blocks on that lock → assert it is canceled at ~500 ms and the raised exception is SQLSTATE `57014` (`sqlalchemy.exc.OperationalError` wrapping `psycopg.errors.QueryCanceled`; assert `err.orig.sqlstate == "57014"`). Then release A (barrier/seam) so A commits and teardown is clean. Comment that email-ordering removes the `40P01` deadlock but not this `57014`, which `MAX_BATCH_SIZE=300` keeps rare.
- **Wiring**: `add_students_batch` records `("lock", LOCK_NS_ENROLLMENT, (course_id,))` THEN `("lock", LOCK_NS_CAPACITY, (run_id,))` (assert ENROLLMENT before CAPACITY, both before the first row's `get_or_create_user`); and a single-threaded assertion that a batch with rows in non-sorted email order visits `get_or_create_user` in sorted-email order (spy `get_or_create_user`, assert the recorded email sequence is sorted).

- [ ] **Step 8: Run the batch suite + roster regression, then commit**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_batch.py backend/tests/test_run_roster.py -v`
Expected: all PASS (including the existing batch 207 behavior tests — response order preserved).

```bash
git add backend/mathion/api/run_roster.py backend/mathion/schemas.py backend/tests/test_concurrency_batch.py
git commit -m "$(cat <<'EOF'
feat(a2): batch email-ordering + up-front locks + MAX_BATCH_SIZE cap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Submission pending/number (invariant #3) — `SUBMISSION(mp_id, group_id)` + file-I/O-before-lock

**Files:**
- Modify: `backend/mathion/api/submissions.py` (`create_submission`, `:54-239`)
- Test: `backend/tests/test_concurrency_submission.py` (extend — the RED already exists from Task 1)

**Interfaces:**
- Consumes: `advisory.advisory_xact_lock`, `advisory.LOCK_NS_SUBMISSION`, `advisory.interleave_hook`.
- Produces: the restructured `create_submission` body that Task 6 layers `MINIPROJECT` + the `mp` re-fetch onto.

Invariant #3: ≤1 pending submission per cycle per (mp, group) + gap-free `submission_number`. Restructure so the ≤20 MB file read + validation + temp-write happen BEFORE the lock (the `MINIPROJECT` critical section, added in Task 6, must be I/O-free); acquire `SUBMISSION(mp_id, group_id)` around the pending-gate → number → insert; narrow the file-error catch to `OSError`; guarantee temp cleanup via `try/finally`; delete the dead `IntegrityError` retry.

- [ ] **Step 1: Complete the Task-1 #3 RED arrangement (make it fully runnable)**

Fill in the arrangement stub left in `test_concurrency_submission.py::test_pending_submission_race_reproduces_without_lock`: seed a published MP with two RunStudents in group `ga`, fabricate a `starlette.datastructures.UploadFile` over a `SpooledTemporaryFile` of `b"%PDF-1.4"` bytes per thread, and call `create_submission(mp_id=mp["id"], file=..., db=<per-thread session>, user=<member>)` directly (off-HTTP). Both threads park at the `"submission_pending"` seam, then release together. Assert exactly **2 pending** `Submission` rows for `(mp, ga)`. (See `test_submissions.py` for the existing UploadFile fabrication pattern.)

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_submission.py::test_pending_submission_race_reproduces_without_lock -v`
Expected: PASS (race reproduces — 2 pending; the lock is monkeypatched to a no-op).

- [ ] **Step 2: Restructure `create_submission` — file-I/O first, `SUBMISSION` lock, narrowed catch, try/finally, drop dead retry**

Replace the body of `create_submission` (`backend/mathion/api/submissions.py:60-239`) with (add `from mathion.api import advisory` to the imports):

```python
    mp = get_or_404(db, MiniProject, mp_id)
    run = get_or_404(db, Run, mp.run_id)

    if not mini_project_visible_to_student(run, mp):
        raise HTTPException(status_code=403, detail="Mini-project not visible")

    group = get_submitter_group(db, run.id, user.id)
    if group is None:
        raise HTTPException(status_code=403, detail="Must be a member of a group on this run to submit")
    if group.is_disabled:
        raise HTTPException(status_code=409, detail="Group is disabled")

    # --- File read + validation + temp-write BEFORE the locks (no 20MB I/O under a
    # lock; the MINIPROJECT critical section added in Task 6 must be I/O-free). ---
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    ext = validate_extension(file.filename)
    if ext is None:
        raise HTTPException(status_code=400, detail="File extension not allowed")
    if ext != "pdf":
        raise HTTPException(status_code=400, detail="Submission must be a PDF")
    content = file.file.read(settings.max_file_size + 1)
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > settings.max_file_size:
        raise HTTPException(status_code=400, detail=f"File size {len(content)} exceeds max {settings.max_file_size}")
    if not looks_like_pdf(content):
        raise HTTPException(status_code=400, detail="Submission is not a valid PDF (missing %PDF- header)")

    abs_dir = submission_storage_dir(run.id, group.id)
    tmp_path: str | None = None
    try:
        try:
            os.makedirs(abs_dir, exist_ok=True)
            fd, tmp_path = tempfile.mkstemp(dir=abs_dir, prefix=".upload-", suffix=".tmp")
            with os.fdopen(fd, "wb") as f:
                f.write(content)
        except OSError:
            raise HTTPException(status_code=500, detail="Failed to write submission to disk")

        # --- Lock, then the DB-only critical section ---
        advisory.advisory_xact_lock(db, advisory.LOCK_NS_SUBMISSION, mp.id, group.id)

        latest_result, prev_evaluator = _latest_evaluation_result(db, mp.id, group.id)
        if latest_result == "accepted":
            raise HTTPException(status_code=409, detail="Already accepted; no further submission")
        if latest_result is None:
            prior_sub = db.execute(
                select(Submission)
                .where(Submission.mini_project_id == mp.id, Submission.group_id == group.id)
                .order_by(Submission.submission_number.desc())
                .limit(1)
            ).scalar_one_or_none()
            if prior_sub is not None:
                raise HTTPException(status_code=409, detail="Previous submission pending evaluation")
            is_resubmission = False
        elif latest_result == "rejected":
            is_resubmission = False
        elif latest_result in ("major_revision", "minor_revision"):
            is_resubmission = True
        else:
            raise HTTPException(status_code=500, detail=f"Unexpected evaluation result: {latest_result}")

        advisory.interleave_hook("submission_pending")

        now = datetime.now(timezone.utc)
        hard_aware = to_utc_aware(mp.hard_deadline)
        soft_aware = to_utc_aware(mp.soft_deadline)
        resub_aware = to_utc_aware(mp.resubmission_deadline)
        if not is_resubmission:
            if hard_aware is not None and now > hard_aware:
                raise HTTPException(status_code=409, detail="Initial submission deadline passed")
        else:
            if resub_aware is not None and now > resub_aware:
                raise HTTPException(status_code=409, detail="Resubmission deadline passed")

        block = db.get(Block, mp.block_id)
        next_num = (db.scalar(
            select(func.max(Submission.submission_number)).where(
                Submission.mini_project_id == mp.id,
                Submission.group_id == group.id,
            )
        ) or 0) + 1
        filename = build_submission_filename(block.order, group.name, next_num)
        is_late = soft_aware is not None and now > soft_aware

        sub = Submission(
            mini_project_id=mp.id, group_id=group.id, submission_number=next_num,
            submitted_by=user.id, file_path=filename, file_size=len(content),
            is_late=is_late, is_resubmission=is_resubmission, submitted_at=now,
        )
        db.add(sub)
        db.flush()  # SUBMISSION lock makes the submission_number collision unreachable — no retry

        db.execute(
            MiniProject.__table__.update()
            .where(MiniProject.id == mp.id, MiniProject.first_submitted_at.is_(None))
            .values(first_submitted_at=now)
        )

        if is_resubmission:
            if prev_evaluator is None:
                raise HTTPException(status_code=500, detail="Auto-evaluation failed: no prior evaluator")
            auto_eval = Evaluation(submission_id=sub.id, evaluated_by=prev_evaluator, result="accepted")
            db.add(auto_eval)
            try:
                db.flush()
            except IntegrityError:
                db.rollback()
                raise HTTPException(status_code=500, detail="Auto-evaluation failed; submission rejected")
            member_ids = db.execute(
                select(RunStudent.user_id).where(
                    RunStudent.run_id == run.id,
                    RunStudent.group_id == group.id,
                )
            ).scalars().all()
            for uid in member_ids:
                db.add(NotificationLogEntry(
                    user_id=uid,
                    kind="evaluation_received",
                    payload={
                        "run_id": run.id, "mini_project_id": mp.id,
                        "submission_id": sub.id, "evaluation_id": auto_eval.id,
                        "result": "accepted",
                    },
                ))

        abs_path = os.path.join(abs_dir, filename)
        try:
            os.replace(tmp_path, abs_path)
            tmp_path = None
        except OSError:
            raise HTTPException(status_code=500, detail="Failed to write submission to disk")

        db.commit()
        return sub
    finally:
        if tmp_path is not None and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
```

Notes: gate `HTTPException`s (409/404/400/500) raised inside the outer `try` propagate through the `finally` (which unlinks the orphan temp) and out; `get_db`'s `finally` then rolls back the uncommitted DB work and frees the lock. The two `except OSError` blocks are narrow (only the pre-lock write and `os.replace`), so a gate result is never masked as a 500. The old submission_number `IntegrityError` retry (`:150-173`) is gone. The auto-eval `db.rollback()` on its own failure is intentional (the whole submission is rejected); the `finally` still cleans the temp.

- [ ] **Step 3: Write the #3 GREEN (SUBMISSION lock forces one 409)**

Add to `test_concurrency_submission.py`: same arrangement as the RED but WITHOUT the lock monkeypatch (real `SUBMISSION` lock) and free-running (no seam block). Two group members submit concurrently → exactly **1 pending** submission committed, the other gets **409 "Previous submission pending evaluation"**. Assert 1 pending row + one 409 status. (Spec §6, "#3 pending-submission — asymmetric": the deterministic RED holds B after the pending gate until A fully commits; the GREEN blocks B on the lock → re-reads → 409.)

- [ ] **Step 4: Write the orphan-temp regression test + wiring/ordering**

Add to `test_concurrency_submission.py`:
- **Orphan-temp regression**: force a gate `409` between the temp-write and `os.replace` (e.g. submit twice so the second hits "Previous submission pending evaluation"), then assert NO `.upload-*.tmp` file remains under `submission_storage_dir(run.id, group.id)` (the `try/finally` unlinked it). Also a file-error test: monkeypatch `os.replace` to raise `OSError` → assert `500 "Failed to write submission to disk"` AND no orphan temp.
- **Wiring/ordering**: `create_submission` records `("lock", LOCK_NS_SUBMISSION, (mp_id, group_id))`, recorded BEFORE the pending-gate read (spy `_latest_evaluation_result`).

- [ ] **Step 5: Run the submission suite + regressions, then commit**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_submission.py backend/tests/test_submissions.py backend/tests/test_evaluations.py -v`
Expected: all PASS (existing submission behavior — deadlines, resubmission auto-accept, PDF screen, file-write 500 — unchanged).

```bash
git add backend/mathion/api/submissions.py backend/tests/test_concurrency_submission.py
git commit -m "$(cat <<'EOF'
feat(a2): SUBMISSION lock + file-I/O-before-lock + temp cleanup (invariant #3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Mini-project lifecycle (invariant #5) — `MINIPROJECT(mp_id)` across submit / patch / delete / delete-run

**Files:**
- Modify: `backend/mathion/api/submissions.py` (`create_submission` — add `MINIPROJECT` before `SUBMISSION` + the `mp` re-fetch)
- Modify: `backend/mathion/api/mini_projects.py` (`patch_mini_project` `:154`; `delete_mini_project` `:212`)
- Modify: `backend/mathion/api/runs.py` (`delete_run`, `:123-171`)
- Test: `backend/tests/test_concurrency_mini_project.py` (create); extend `test_concurrency_submission.py` for the stale-`mp` submit-side test

**Interfaces:**
- Consumes: `advisory.advisory_xact_lock`, `advisory.LOCK_NS_MINIPROJECT`, `advisory.interleave_hook`.
- Produces: nothing new.

Invariant #5: a mini-project locked by its first submission stays immutable except by course-admin `force`. All first-submitted-at setters and readers serialize on `MINIPROJECT(mp_id)`; patch/delete re-fetch the WHOLE entity under the lock (fresh deadlines/lock-flag); `delete_run` holds every run mini-project's `MINIPROJECT` lock (ascending `mp_id`).

- [ ] **Step 1: Add `MINIPROJECT` + `mp` re-fetch to `create_submission`**

In `backend/mathion/api/submissions.py`, inside the locked region of the Task-5 body, acquire `MINIPROJECT` BEFORE `SUBMISSION` and re-fetch `mp` under the lock (so the deadline gates read the fresh row). Change the lock lines to:

```python
        advisory.advisory_xact_lock(db, advisory.LOCK_NS_MINIPROJECT, mp.id)
        advisory.advisory_xact_lock(db, advisory.LOCK_NS_SUBMISSION, mp.id, group.id)
        mp = db.get(MiniProject, mp.id, populate_existing=True)  # fresh row under the lock
        if mp is None:
            raise HTTPException(status_code=404, detail="Mini-project not found")
```

(These replace the single `SUBMISSION`-only acquire from Task 5. Everything below reads the refreshed `mp`. `run.id` is stable — a mini-project never changes runs — so only `mp` needs refreshing; the pre-lock visibility/group checks are not part of invariant #5 and stay pre-lock.)

- [ ] **Step 2: Write the stale-`mp` submit-side RED/GREEN**

Add to `test_concurrency_submission.py`: RED (no refresh — monkeypatch the `MINIPROJECT` lock + the refetch off, or hold the pre-lock snapshot): thread B `patch_mini_project` shortens `hard_deadline` to the past and commits; thread A `create_submission` built with the pre-shorten `mp` accepts past the new deadline. GREEN (real lock + refetch, sequenced): run B to full commit, then launch A → A acquires `MINIPROJECT`, re-fetches `mp`, reads the shortened deadline → **409 "Initial submission deadline passed"** (delete variant: `mp is None` → **404**). Full protocol: spec §6, "#5 stale-`mp` on the submit side".

- [ ] **Step 3: Add `MINIPROJECT` + whole-entity re-fetch to `patch_mini_project`**

In `backend/mathion/api/mini_projects.py`, `patch_mini_project` (`:154-158`), after authz acquire the lock and re-fetch the whole entity; derive ALL decisions from the refreshed instance (add `from mathion.api import advisory`):

```python
    mp = get_or_404(db, MiniProject, mp_id)
    run = get_or_404(db, Run, mp.run_id)
    require_run_admin_or_teacher(db, user, run)

    advisory.advisory_xact_lock(db, advisory.LOCK_NS_MINIPROJECT, mp_id)
    mp = db.get(MiniProject, mp_id, populate_existing=True)
    if mp is None:
        raise HTTPException(status_code=404, detail="Mini-project not found")

    locked = mp.first_submitted_at is not None
    # ... rest of patch_mini_project UNCHANGED — the `locked` flag, the extension-guard
    # `getattr(mp, field)` old-deadline reads, and `soft_changed` now all read the fresh row.
```

- [ ] **Step 4: Add `MINIPROJECT` + whole-entity re-fetch to `delete_mini_project`**

In `backend/mathion/api/mini_projects.py`, `delete_mini_project` (`:212-216`), after authz:

```python
    mp = get_or_404(db, MiniProject, mp_id)
    run = get_or_404(db, Run, mp.run_id)
    require_run_admin_or_teacher(db, user, run)

    advisory.advisory_xact_lock(db, advisory.LOCK_NS_MINIPROJECT, mp_id)
    mp = db.get(MiniProject, mp_id, populate_existing=True)
    if mp is None:
        raise HTTPException(status_code=404, detail="Mini-project not found")

    is_locked = mp.first_submitted_at is not None
    # ... rest UNCHANGED (the force/course-admin escalation now reads the fresh lock flag).
```

- [ ] **Step 5: Add per-mini-project `MINIPROJECT` locks to `delete_run`**

In `backend/mathion/api/runs.py`, `delete_run` (`:130-133`), after authz and before the `if not force` branch, lock every mini-project of the run in ascending `mp_id` order (add `from mathion.api import advisory`):

```python
    run = get_or_404(db, Run, run_id)
    require_course_admin_for_run(db, user, run)

    # Lock every mini-project of the run (ascending id) so a concurrent create_submission
    # cannot commit a first submission mid-delete: the non-force has_submissions re-check is
    # then atomic, and the force cascade cannot race a stale insert (spec 5.5).
    mp_ids_to_lock = db.execute(
        select(MiniProject.id).where(MiniProject.run_id == run_id).order_by(MiniProject.id)
    ).scalars().all()
    for locked_mp_id in mp_ids_to_lock:
        advisory.advisory_xact_lock(db, advisory.LOCK_NS_MINIPROJECT, locked_mp_id)

    if not force:
        ...  # UNCHANGED
```

- [ ] **Step 6: Write the #5 delete-mini-project bypass RED/GREEN + patch two-PATCH deadline lost-update RED/GREEN**

Create `backend/tests/test_concurrency_mini_project.py`:
- **delete-mp bypass** (spec §6, "#5 mini-project — asymmetric, sequenced GREEN"): RED — thread A `delete_mini_project` (non-force, run-teacher not course-admin) reads `is_locked=False` at the seam; thread B `create_submission` commits `first_submitted_at`; release A → A deletes the now-locked MP without escalation. GREEN — run B to full commit, then launch A → A acquires `MINIPROJECT`, re-reads `is_locked=True`, hits the force/course-admin gate (**409**). Add an `advisory.interleave_hook("mp_delete")` between the `is_locked` read and the delete.
- **patch two-PATCH deadline lost-update** (spec §6, "#5 patch — symmetric, two-PATCH"): RED (re-read only `first_submitted_at`, not whole entity) — locked MP `hard_deadline=D0`; both PATCHes load `D0`; A extends to `D2` commits; B (stale `D0`) proposes `D1` (`D0<D1<D2`), passes its stale `new>old` check, commits → shortens `D2` to `D1`. GREEN (whole-entity refetch) — B blocks on `MINIPROJECT`, re-fetches → sees `D2`, compares `D1<=D2` → **409 "… can only be extended"**. Add an `advisory.interleave_hook("mp_patch")` between the refetch and the extension guard for the RED interleave.

- [ ] **Step 7: Write both `delete_run` fail-firsts (non-force FK-23503-rollback-intact + force FK-23503)**

Add to `test_concurrency_mini_project.py` (spec §6, "#5 `delete_run` — both paths reachable"):
- **Non-force RED**: hold B (`create_submission`) at a seam AFTER its up-front visibility/group checks; with B parked, unpublish the run + clear its roster (so non-force `delete_run` passes its published/student-count gates); A (`delete_run` non-force) parks after `has_submissions=False`; release B → B `os.replace`s + commits its row (referencing its group via `ON DELETE RESTRICT`); release A → `db.delete(run); db.commit()` cascades to the run's groups and is rejected by B's submission's `group_id RESTRICT` → assert A raises **FK `23503`** (`psycopg.errors.ForeignKeyViolation` / SQLSTATE `23503`) AND its txn rolled back: run, mini-project, submission row, and file **all still present**. **Non-force GREEN**: A acquires the run's `MINIPROJECT` locks first; B blocks; A re-reads `has_submissions=False` → deletes the empty run → commits → B unblocks, re-fetches `mp` → None → **404**; assert A `204`, B `404`, no 500, no orphan.
- **Force RED**: A `delete_run` force runs its cascade to a full commit (mini-projects gone); release B → its `Submission` insert hits the now-dangling `mini_project_id` → assert FK **`23503`**. **Force GREEN**: A (force) parks holding the `MINIPROJECT` locks; B blocks; release A → force cascade commits + releases; B unblocks, re-fetches `mp` → None → **404**; assert A `204`, no orphan, B `404`.

> Reachability note: `create_submission` checks visibility + group ONCE up front (`submissions.py:63-70`) and never re-checks under the lock, so an in-flight submit past those checks can commit even after the run is unpublished + roster-cleared — that is what makes both REDs reachable (spec §5.5).

- [ ] **Step 8: Write the wiring/ordering assertions for all four #5 sites**

Add wiring tests: `create_submission` records `("lock", LOCK_NS_MINIPROJECT, (mp_id,))` THEN `("lock", LOCK_NS_SUBMISSION, (mp_id, group_id))`, with the `mp` re-fetch after `MINIPROJECT` and before the deadline gates; `patch_mini_project` / `delete_mini_project` each record `MINIPROJECT(mp_id)` with the whole-entity `populate_existing` re-fetch after the lock and before the guard reads; `delete_run` records one `MINIPROJECT` per run mini-project in ascending `mp_id` order, all before the `has_submissions` read.

- [ ] **Step 9: Run the full mini-project + submission + runs + suite, then commit**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_concurrency_mini_project.py backend/tests/test_concurrency_submission.py backend/tests/test_mini_projects.py backend/tests/test_runs.py backend/tests/test_submissions.py -v`
Then the whole suite: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: all PASS.

```bash
git add backend/mathion/api/submissions.py backend/mathion/api/mini_projects.py backend/mathion/api/runs.py backend/tests/test_concurrency_mini_project.py backend/tests/test_concurrency_submission.py
git commit -m "$(cat <<'EOF'
feat(a2): MINIPROJECT lock across submit/patch/delete/delete_run (invariant #5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final whole-branch review

After Task 6, run the whole-branch dual-gate review (Opus xhigh whole-branch + codex high) over `git diff main...feat/phase9-a2-concurrency`, per the strict per-task cadence. Focus areas: the ascending lock order holds at every multi-lock site (no reversal); the `get_or_create_user` SAVEPOINT is used under every held lock; the `MINIPROJECT` critical section carries no ≤20 MB I/O; the batch email-ordering preserves the 207 response shape; the four invariants each have a deterministic RED (previously violable) + GREEN; the counts reconcile (4 namespaces, 13 fixed-arity acquisitions across 11 sites + `delete_run`, 6 tasks); no new concurrency error surface beyond the one input-validation `422`. Then a manual smoke (optional, human) and the finishing-a-development-branch flow.

