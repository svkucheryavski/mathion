import pytest
from sqlalchemy import text

from mathion.api import advisory
from mathion.api.lookups import get_or_create_user
from mathion.database import engine as app_engine
from mathion.models_auth import User


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


@pytest.mark.filterwarnings("ignore::pytest.PytestUnhandledThreadExceptionWarning")
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


def test_app_engine_isolation_is_read_committed():
    with app_engine.connect() as conn:
        level = conn.execute(text("SHOW transaction_isolation")).scalar()
    assert level == "read committed"


def test_concurrency_engine_isolation_is_read_committed(concurrency):
    (s,) = concurrency.make_sessions(1)
    level = s.execute(text("SHOW transaction_isolation")).scalar()
    assert level == "read committed"
    s.rollback()


def test_get_or_create_user_savepoint_preserves_advisory_lock(concurrency):
    """A holds an advisory lock, then loses the users.email insert race to B;
    get_or_create_user must recover via SAVEPOINT (returning B's row) WITHOUT a
    top-level rollback — so A's advisory lock is still held afterwards.

    NOTE ON ARRANGEMENT: under READ COMMITTED, if B *commits* before A calls
    get_or_create_user, A's SELECT already sees B's row and returns early —
    the concurrent-insert recovery path (the thing under test) never runs, so
    such a test passes on the OLD top-level-rollback code too (vacuous). To hit
    the recovery path deterministically, B inserts+FLUSHES the row uncommitted
    (holding the unique-index tuple) so A's SELECT misses and A's INSERT BLOCKS
    on B's tuple; once A is confirmed blocked (pg_blocking_pids), B commits, and
    A's blocked INSERT resolves to a unique_violation -> the recovery path.
    OLD code: db.rollback() ends A's txn -> advisory lock released (RED).
    NEW code: ROLLBACK TO SAVEPOINT keeps A's txn -> lock still held (GREEN)."""
    import hashlib
    import time

    email = "race@example.com"
    sa, sb, sc = concurrency.make_sessions(3)

    payload = ":".join(str(x) for x in (advisory.LOCK_NS_ENROLLMENT, 999)).encode()
    key = int.from_bytes(hashlib.blake2b(payload, digest_size=8).digest(), "big", signed=True)

    sa.begin()
    advisory.advisory_xact_lock(sa, advisory.LOCK_NS_ENROLLMENT, 999)  # A holds it

    # B inserts the SAME email and FLUSHES (uncommitted) — it now holds the
    # unique-index tuple, so A's SELECT sees no row and A's INSERT collides on it.
    sb.begin()
    sb.add(User(email=email, full_name=None))
    sb.flush()

    # Capture both connections' backend PIDs on the main thread (both sessions
    # already have a live connection; each NullPool session keeps one stable
    # connection whose backend PID is fixed for its life). a_pid is captured from
    # sa BEFORE spawning run_a, so it equals the PID thread A's INSERT runs on.
    a_pid = sa.execute(text("SELECT pg_backend_pid()")).scalar()
    b_pid = sb.execute(text("SELECT pg_backend_pid()")).scalar()

    result = {}

    def run_a():
        try:
            result["user"] = get_or_create_user(sa, email)
        except Exception as exc:  # surface a thread failure via result
            result["error"] = repr(exc)

    ta = concurrency.spawn(run_a)  # A: SELECT -> None, then INSERT blocks on B's tuple

    # Wait until A is actually blocked (by B) before committing B, so A is
    # guaranteed onto the INSERT/recovery path — not a hoped-for interleave.
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        blocked = sc.execute(
            text("SELECT :b = ANY(pg_blocking_pids(:a))"),
            {"a": a_pid, "b": b_pid},
        ).scalar()
        sc.rollback()  # fresh snapshot on the next poll
        if blocked:
            break
        time.sleep(0.05)
    else:
        raise AssertionError("thread A never blocked on B's uncommitted insert")

    sb.commit()  # B wins -> A unblocks -> IntegrityError -> recovery path
    ta.join(timeout=10)

    assert result.get("error") is None, f"thread A failed: {result.get('error')}"
    assert result["user"].email == email

    # Prove A's advisory lock is STILL held: a fresh session's pg_try must fail.
    # (Old top-level-rollback recovery would have released it -> pg_try True.)
    assert sc.execute(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": key}).scalar() is False
    sc.rollback()

    sa.commit()
