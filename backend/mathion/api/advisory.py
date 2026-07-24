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
