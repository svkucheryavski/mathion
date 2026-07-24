from typing import TYPE_CHECKING

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.api.lookups import get_or_404

if TYPE_CHECKING:
    from mathion.models_auth import User


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


def require_course_admin_for_run(db: Session, user, run) -> None:
    """Verify user is course admin for the run's course (or superuser).
    Caller must have already loaded `run` (via get_or_404 etc)."""
    from mathion.models import CourseVersion

    version = get_or_404(db, CourseVersion, run.version_id)
    require_course_admin(db, user, version.course_id)


def require_run_admin_or_teacher(db: Session, user, run) -> None:
    """Verify user is a course admin of the run's course OR a RunTeacher of
    the run OR a superuser. Raises 403 if no access. Caller is expected to
    have already loaded `run` (via `get_or_404` or similar)."""
    from mathion.models import CourseAdmin, CourseVersion, RunTeacher

    if user.is_superuser:
        return

    version = db.get(CourseVersion, run.version_id)
    is_course_admin = db.execute(
        select(CourseAdmin).where(
            CourseAdmin.course_id == version.course_id,
            CourseAdmin.user_id == user.id,
        )
    ).scalar_one_or_none() is not None
    is_run_teacher = db.execute(
        select(RunTeacher).where(
            RunTeacher.run_id == run.id,
            RunTeacher.user_id == user.id,
        )
    ).scalar_one_or_none() is not None
    if not (is_course_admin or is_run_teacher):
        raise HTTPException(status_code=403, detail="Run admin or teacher access required")


def is_run_admin_or_teacher(db: Session, user, run) -> bool:
    """Return True if user is course admin of run.course OR run teacher OR superuser."""
    from mathion.models import CourseAdmin, CourseVersion, RunTeacher

    if user.is_superuser:
        return True
    version = db.get(CourseVersion, run.version_id)
    is_admin = db.execute(
        select(CourseAdmin).where(
            CourseAdmin.course_id == version.course_id,
            CourseAdmin.user_id == user.id,
        )
    ).scalar_one_or_none() is not None
    if is_admin:
        return True
    is_teacher = db.execute(
        select(RunTeacher).where(
            RunTeacher.run_id == run.id,
            RunTeacher.user_id == user.id,
        )
    ).scalar_one_or_none() is not None
    return is_teacher


def has_run_teacher_on_course(db: Session, user: "User", course_id: int) -> bool:
    """Return True iff the user has a RunTeacher row on any run of any version of the course.

    WARNING: READ-ONLY UI predicate. Do NOT use as a write-path authorization gate —
    write paths must use a raising gate (`require_course_admin` /
    `require_run_admin_or_teacher`), or, for privacy-preserving routes that hide
    existence, the boolean `is_run_admin_or_teacher` mapping failure to a uniform 404.

    Used by `GET /api/courses/by-slug/{slug}` only. The version-list and block-list
    endpoints use tighter predicates (IN-subquery / has_run_pinned_to_version).
    """
    from sqlalchemy import exists
    from mathion.models import CourseVersion, Run, RunTeacher

    return bool(db.scalar(
        select(exists().where(
            RunTeacher.user_id == user.id,
            RunTeacher.run_id == Run.id,
            Run.version_id == CourseVersion.id,
            CourseVersion.course_id == course_id,
        ))
    ))


def has_run_pinned_to_version(db: Session, user: "User", version_id: int) -> bool:
    """Return True iff the user has a RunTeacher row on a run whose version_id matches.

    WARNING: READ-ONLY UI predicate. Do NOT use as a write-path authorization gate —
    write paths must use a raising gate (`require_course_admin` /
    `require_run_admin_or_teacher`), or, for privacy-preserving routes that hide
    existence, the boolean `is_run_admin_or_teacher` mapping failure to a uniform 404.

    Used by `GET /api/versions/{vid}/blocks` and `GET /assets/{vid}/{filename}`.
    No `course_id` parameter required — CourseVersion.id is globally unique.
    """
    from sqlalchemy import exists
    from mathion.models import Run, RunTeacher

    return bool(db.scalar(
        select(exists().where(
            RunTeacher.user_id == user.id,
            RunTeacher.run_id == Run.id,
            Run.version_id == version_id,
        ))
    ))
