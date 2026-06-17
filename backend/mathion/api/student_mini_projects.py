"""Student-facing mini-project discovery + detail endpoints.

The router is created here but is intentionally not yet included in
`mathion.main` — the read-side endpoints are added in subsequent tasks
(B2/B3) and the router is wired into the app in B4.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.models import Course, CourseVersion, Run, RunStudent
from mathion.models_auth import StudentEnrollment, User

logger = logging.getLogger(__name__)
router = APIRouter(tags=["student-mini-projects"])


def _resolve_student_run(db: Session, user: User, course_slug: str) -> Run:
    """Resolve the student's active Run for this course slug.

    - 404 if course slug doesn't exist OR user has no active
      StudentEnrollment on any non-disabled version of this course.
    - 403 if user has an active StudentEnrollment but no RunStudent on any
      published run of the course.

    D2: requires `StudentEnrollment.is_active == True` (intentional
    divergence from `/my-version`, which lacks this filter — inactive
    enrollments must NOT see mini-projects).

    D6: if 2+ RunStudent rows exist for the same user across published
    runs of the same course (legacy data), pick by `Run.start_date DESC`
    and emit a warning.
    """
    course = db.execute(
        select(Course).where(Course.slug == course_slug)
    ).scalar_one_or_none()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")

    enrolled_versions = db.execute(
        select(CourseVersion.id)
        .join(StudentEnrollment, StudentEnrollment.version_id == CourseVersion.id)
        .where(
            CourseVersion.course_id == course.id,
            CourseVersion.is_disabled == False,  # noqa: E712 — SQL boolean comparison
            StudentEnrollment.user_id == user.id,
            StudentEnrollment.is_active == True,  # noqa: E712
        )
    ).scalars().all()
    if not enrolled_versions:
        raise HTTPException(status_code=404, detail="Not enrolled in this course")

    runs = db.execute(
        select(Run)
        .join(CourseVersion, CourseVersion.id == Run.version_id)
        .join(RunStudent, RunStudent.run_id == Run.id)
        .where(
            CourseVersion.course_id == course.id,
            CourseVersion.is_disabled == False,  # noqa: E712 — SQL boolean comparison
            Run.is_published == True,  # noqa: E712
            RunStudent.user_id == user.id,
        )
        .order_by(Run.start_date.desc())
    ).scalars().all()
    if not runs:
        raise HTTPException(
            status_code=403, detail="No active run for this course"
        )
    if len(runs) > 1:
        logger.warning(
            "Multiple active RunStudent rows for user=%s course_slug=%s "
            "(legacy data); picking most recent by start_date.",
            user.id, course_slug,
        )
    return runs[0]
