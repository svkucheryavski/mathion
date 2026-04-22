from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.database import Base


def get_or_404(db: Session, model: type[Base], id: int, detail: str | None = None):
    obj = db.get(model, id)
    if not obj:
        name = model.__name__
        raise HTTPException(status_code=404, detail=detail or f"{name} not found")
    return obj


def require_course_admin(db: Session, user, course_id: int):
    """Verify user is course admin or superuser. Raises 403 if not."""
    if user.is_superuser:
        return
    from mathion.models import CourseAdmin
    admin = db.execute(
        select(CourseAdmin).where(
            CourseAdmin.course_id == course_id,
            CourseAdmin.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not admin:
        raise HTTPException(status_code=403, detail="Course admin access required")
