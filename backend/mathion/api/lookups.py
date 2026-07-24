from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.database import Base


# Upper bound of a PostgreSQL int4 column. Derived-order create sites guard
# against overflowing the `order` column when the current max is already here.
INT4_MAX = 2_147_483_647


def get_or_404(db: Session, model: type[Base], id: int, detail: str | None = None):
    obj = db.get(model, id)
    if not obj:
        name = model.__name__
        raise HTTPException(status_code=404, detail=detail or f"{name} not found")
    return obj


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


def get_newest_published_version(db: Session, course_id: int):
    """Return the most recently published version for the course, or raise 409."""
    from mathion.models import CourseVersion

    version = db.execute(
        select(CourseVersion)
        .where(CourseVersion.course_id == course_id, CourseVersion.state == "published")
        .order_by(CourseVersion.published_at.desc(), CourseVersion.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=409, detail="No published version exists for this course")
    return version
