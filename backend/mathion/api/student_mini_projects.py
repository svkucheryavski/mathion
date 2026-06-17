"""Student-facing mini-project discovery + detail endpoints.

Router is included in `mathion.main`. The detail endpoint lands in B3;
this module currently exposes the list endpoint added in B2.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.api.helpers import get_submitter_group
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import (
    Block,
    Course,
    CourseVersion,
    Evaluation,
    MiniProject,
    Run,
    RunStudent,
    Submission,
)
from mathion.models_auth import StudentEnrollment, User
from mathion.schemas import StudentMiniProjectListItem

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


def _derive_latest_status(db: Session, mp: MiniProject, group) -> str:
    """Per spec §3.1 derivation rules.

    - No group on the run → 'pending_group_assignment'.
    - No Submission rows for (mp, group) → 'not_submitted'.
    - Latest Submission has no Evaluation → 'awaiting_evaluation'.
    - Otherwise the Evaluation.result value verbatim:
      'rejected' | 'major_revision' | 'minor_revision' | 'accepted'.
    """
    if group is None:
        return "pending_group_assignment"
    latest_sub = db.execute(
        select(Submission)
        .where(
            Submission.mini_project_id == mp.id,
            Submission.group_id == group.id,
        )
        .order_by(Submission.submission_number.desc())
        .limit(1)
    ).scalar_one_or_none()
    if latest_sub is None:
        return "not_submitted"
    eval_row = db.execute(
        select(Evaluation).where(Evaluation.submission_id == latest_sub.id)
    ).scalar_one_or_none()
    if eval_row is None:
        return "awaiting_evaluation"
    return eval_row.result


def _serialize_list_item(
    db: Session, run: Run, mp: MiniProject, user: User
) -> StudentMiniProjectListItem:
    group = get_submitter_group(db, run.id, user.id)
    status = _derive_latest_status(db, mp, group)
    return StudentMiniProjectListItem(
        mp_id=mp.id,
        block_id=mp.block.id,
        block_slug=mp.block.slug,
        block_order=mp.block.order,
        block_title=mp.block.title,
        hard_deadline=mp.hard_deadline,
        soft_deadline=mp.soft_deadline,
        resubmission_deadline=mp.resubmission_deadline,
        latest_status=status,
    )


@router.get(
    "/api/courses/{slug}/mini-projects",
    response_model=list[StudentMiniProjectListItem],
)
def list_student_mini_projects(
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[StudentMiniProjectListItem]:
    """Per spec §3.1: list one row per published MP for the student's active
    run on this course, sorted by `Block.order` ASC, each with a derived
    `latest_status` from the 7-value enum.

    Errors mirror `_resolve_student_run`: 401 (no session, via dependency),
    404 (course slug missing or no active enrollment), 403 (enrolled but no
    RunStudent on any published run of this course).
    """
    run = _resolve_student_run(db, user, slug)

    mps = db.execute(
        select(MiniProject)
        .join(Block, Block.id == MiniProject.block_id)
        .where(
            MiniProject.run_id == run.id,
            MiniProject.is_published == True,  # noqa: E712 — SQL boolean comparison
        )
        .order_by(Block.order.asc())
    ).scalars().all()

    return [_serialize_list_item(db, run, mp, user) for mp in mps]
