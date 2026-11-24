from sqlalchemy.orm import Session

from mathion.api import advisory


def lock_draft(db: Session, version_id: int) -> None:
    """The per-version write lock publish also takes first; rows read before it are re-read after."""
    advisory.advisory_xact_lock(db, advisory.LOCK_NS_VERSION_INFO, version_id)
    db.expire_all()
