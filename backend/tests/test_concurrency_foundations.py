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
