"""Student-facing mini-project discovery + detail endpoints.

Router is included in `mathion.main`. Exposes:
- GET /api/courses/{slug}/mini-projects (B2 list)
- GET /api/courses/{slug}/blocks/{block_slug}/mini-project (B3 detail)
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from mathion.api.helpers import (
    get_submitter_group,
    mini_project_visible_to_student,
    to_utc_aware,
)
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import (
    Block,
    Course,
    CourseVersion,
    Evaluation,
    Group,
    MiniProject,
    Run,
    RunStudent,
    Submission,
)
from mathion.models_auth import StudentEnrollment, User
from mathion.schemas import (
    StudentGroupMember,
    StudentGroupSummary,
    StudentMiniProjectDetail,
    StudentMiniProjectListItem,
    StudentSubmissionHistoryEntry,
    StudentSubmissionHistoryEvaluation,
)

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

    Used by the B2 list endpoint, which loads many MPs in a loop and does
    NOT precompute submissions/evaluations per MP. The B3 detail endpoint
    uses `_derive_latest_status_from_snapshot` instead so its
    `latest_status` cannot disagree with `submission_history` (a teacher
    evaluating mid-request would otherwise produce a self-contradictory
    response).
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


def _derive_latest_status_from_snapshot(
    group: Group | None,
    submissions: list[Submission],
    evaluations_by_sub_id: dict[int, Evaluation],
) -> str:
    """Snapshot-based variant of `_derive_latest_status` used by the B3
    detail endpoint.

    Derives `latest_status` from the ALREADY-LOADED `submissions` list and
    `evaluations_by_sub_id` map rather than re-querying. Pins
    `latest_status` and `submission_history` to a single read-consistency
    boundary — so a teacher evaluating between the history-batch query
    and the status derivation can no longer produce a self-contradictory
    response (e.g. `latest_status='accepted'` while
    `submission_history[0].evaluation` is null).

    `submissions` MUST be ordered DESC by submission_number (caller's
    contract); `submissions[0]` is treated as the latest.
    """
    if group is None:
        return "pending_group_assignment"
    if not submissions:
        return "not_submitted"
    latest = submissions[0]
    eval_row = evaluations_by_sub_id.get(latest.id)
    if eval_row is None:
        return "awaiting_evaluation"
    return eval_row.result


def _serialize_list_item(
    db: Session, mp: MiniProject, group
) -> StudentMiniProjectListItem:
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
    group = get_submitter_group(db, run.id, user.id)

    mps = db.execute(
        select(MiniProject)
        .options(joinedload(MiniProject.block))
        .join(Block, Block.id == MiniProject.block_id)
        .where(
            MiniProject.run_id == run.id,
            MiniProject.is_published == True,  # noqa: E712 — SQL boolean comparison
        )
        .order_by(Block.order.asc())
    ).scalars().all()

    return [_serialize_list_item(db, mp, group) for mp in mps]


# ============================================================================
# Task B3: detail endpoint
# ============================================================================


def _display_name(user: User) -> str:
    """Return a user-facing display name.

    Falls back to the email LOCAL part (chars before '@') when full_name is
    None / blank. The detail endpoint pre-composes every `*_full_name`
    field via this helper so the response model never contains nulls in
    those slots (and `@computed_field` isn't an option — the source
    `User` row isn't on the response model).
    """
    name = (user.full_name or "").strip()
    if name:
        return name
    return user.email.split("@", 1)[0]


def _resolve_block(db: Session, run: Run, block_slug: str) -> Block:
    """Resolve `block_slug` against the run's version_id (IDOR-safe).

    Per spec §4.2: the lookup is scoped to `run.version_id` so a block
    slug that exists on a DIFFERENT version of the same course (or any
    other version) cannot be reached. Mismatch → 404.
    """
    block = db.execute(
        select(Block).where(
            Block.version_id == run.version_id,
            Block.slug == block_slug,
        )
    ).scalar_one_or_none()
    if block is None:
        raise HTTPException(status_code=404, detail="Block not found")
    return block


def _compute_can_submit(
    *,
    run: Run,
    mp: MiniProject,
    group: Group | None,
    latest_result: str | None,
    has_any_submission: bool,
    now: datetime | None = None,
) -> tuple[bool, str | None]:
    """7-step `can_submit` ladder per spec §3.2.

    Mirrors POST /submissions enforcement at
    `backend/mathion/api/submissions.py:53-104` exactly; ORDER MATTERS.
    Each step short-circuits with the matching reason code.

    `now` is injected for testability; defaults to UTC-aware `datetime.now`.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    # 1. visibility (run.is_published AND mp.is_published)
    if not mini_project_visible_to_student(run, mp):
        return False, "mp_not_visible"
    # 2. group required
    if group is None:
        return False, "pending_group_assignment"
    # 3. group not disabled
    if group.is_disabled:
        return False, "group_disabled"
    # 4. already accepted is terminal
    if latest_result == "accepted":
        return False, "already_accepted"
    # 5. pending evaluation: a prior submission exists but no eval yet
    if latest_result is None and has_any_submission:
        return False, "awaiting_evaluation"
    # 6. initial-submission path (no prior eval OR last eval=rejected)
    if latest_result in (None, "rejected"):
        hard_aware = to_utc_aware(mp.hard_deadline)
        if hard_aware is not None and now > hard_aware:
            return False, "hard_deadline_passed"
        return True, None
    # 7. resubmission path (last eval = major/minor revision)
    if latest_result in ("major_revision", "minor_revision"):
        resub_aware = to_utc_aware(mp.resubmission_deadline)
        if resub_aware is not None and now > resub_aware:
            return False, "resubmission_deadline_passed"
        return True, None
    # Defensive fallback: unexpected result string.
    return False, "mp_not_visible"


def _serialize_member(db: Session, rs: RunStudent, me_id: int) -> StudentGroupMember:
    user = db.get(User, rs.user_id)
    return StudentGroupMember(
        user_id=user.id,
        full_name=_display_name(user),
        is_me=(user.id == me_id),
    )


def _serialize_group(
    db: Session,
    group: Group,
    members: list[RunStudent],
    me_id: int,
) -> StudentGroupSummary:
    """Build the group summary from an already-loaded `members` list.

    Members are loaded at step 5 of the §3.2 8-step read ordering
    (alongside submissions + evaluations) so the whole grouped-state
    snapshot lands inside a single read-consistency window before
    can_submit / latest_status derivation.
    """
    return StudentGroupSummary(
        id=group.id,
        name=group.name,
        is_disabled=group.is_disabled,
        members=[_serialize_member(db, rs, me_id) for rs in members],
    )


def _serialize_history_entry(
    db: Session,
    sub: Submission,
    ev: Evaluation | None,
    me_id: int,
) -> StudentSubmissionHistoryEntry:
    submitter = db.get(User, sub.submitted_by)
    eval_payload: StudentSubmissionHistoryEvaluation | None = None
    if ev is not None:
        evaluator = db.get(User, ev.evaluated_by)
        eval_payload = StudentSubmissionHistoryEvaluation(
            eval_id=ev.id,
            result=ev.result,
            score=ev.score,
            feedback_text=ev.feedback_text,
            has_feedback_file=ev.feedback_file is not None,
            evaluated_by_full_name=_display_name(evaluator),
            evaluated_at=ev.evaluated_at,
        )
    return StudentSubmissionHistoryEntry(
        submission_id=sub.id,
        submission_number=sub.submission_number,
        filename=os.path.basename(sub.file_path),
        submitted_by_full_name=_display_name(submitter),
        submitter_is_me=(sub.submitted_by == me_id),
        submitted_at=sub.submitted_at,
        file_size=sub.file_size,
        is_late=sub.is_late,
        is_resubmission=sub.is_resubmission,
        evaluation=eval_payload,
    )


@router.get(
    "/api/courses/{slug}/blocks/{block_slug}/mini-project",
    response_model=StudentMiniProjectDetail,
)
def get_student_mini_project_detail(
    slug: str,
    block_slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StudentMiniProjectDetail:
    """Per spec §3.2: detail endpoint synthesizes the MP assignment, group
    context (with `is_disabled` UI cue), submission history (DESC by
    submission_number), `latest_status`, and `can_submit` + reason code in
    one round-trip.

    Read ordering (spec §3.2 step list) avoids partial-update races:
    1. Resolve run (§4.1).
    2. Resolve block (§4.2, version-scoped to prevent IDOR).
    3. Load MP for (run, block); 404 if missing or not visible.
    4. Resolve student's group (may be None).
    5. If group: load members, submissions DESC, evaluations — together,
       so the grouped-state snapshot lands inside one read-consistency
       window before derivation.
    6. Compute can_submit per ladder.
    7. Derive `latest_status` from the SAME snapshot (via
       `_derive_latest_status_from_snapshot`) so it can't disagree with
       `submission_history` if a teacher evaluates mid-request.
    8. Return.

    Errors: 401 (no session, via dependency), 403 (no active run, via
    resolver), 404 (course/block/MP missing or unpublished).
    """
    run = _resolve_student_run(db, user, slug)
    block = _resolve_block(db, run, block_slug)

    mp = db.execute(
        select(MiniProject).where(
            MiniProject.run_id == run.id,
            MiniProject.block_id == block.id,
        )
    ).scalar_one_or_none()
    if mp is None or not mini_project_visible_to_student(run, mp):
        raise HTTPException(status_code=404, detail="Mini-project not found")

    group = get_submitter_group(db, run.id, user.id)

    # Step 5: load members + submissions DESC + evaluations TOGETHER, before
    # any derivation, so the whole grouped-state snapshot is taken inside
    # one read-consistency window. Members go in the same step (even
    # though they don't affect the can_submit ladder) to match spec §3.2.
    members: list[RunStudent] = []
    submissions: list[Submission] = []
    eval_by_sub: dict[int, Evaluation] = {}
    if group is not None:
        members = db.execute(
            select(RunStudent).where(
                RunStudent.run_id == run.id,
                RunStudent.group_id == group.id,
            )
        ).scalars().all()
        submissions = db.execute(
            select(Submission)
            .where(
                Submission.mini_project_id == mp.id,
                Submission.group_id == group.id,
            )
            .order_by(Submission.submission_number.desc())
        ).scalars().all()
        if submissions:
            sub_ids = [s.id for s in submissions]
            evals = db.execute(
                select(Evaluation).where(Evaluation.submission_id.in_(sub_ids))
            ).scalars().all()
            eval_by_sub = {ev.submission_id: ev for ev in evals}

    # `latest_result` drives the can_submit ladder. `submissions` is DESC,
    # so submissions[0] is the newest. `has_any_submission` is needed to
    # distinguish "no prior submission" from "submission pending eval"
    # in ladder step 5.
    latest_result: str | None = None
    has_any_submission = bool(submissions)
    if has_any_submission:
        latest_ev = eval_by_sub.get(submissions[0].id)
        if latest_ev is not None:
            latest_result = latest_ev.result

    can_submit, reason = _compute_can_submit(
        run=run, mp=mp, group=group,
        latest_result=latest_result,
        has_any_submission=has_any_submission,
    )
    # Snapshot-based status derivation: reuse the already-loaded
    # `submissions` + `eval_by_sub` so latest_status cannot disagree with
    # submission_history within the same response.
    latest_status = _derive_latest_status_from_snapshot(
        group, submissions, eval_by_sub,
    )

    group_summary: StudentGroupSummary | None = None
    if group is not None:
        group_summary = _serialize_group(db, group, members, user.id)

    history = [
        _serialize_history_entry(db, sub, eval_by_sub.get(sub.id), user.id)
        for sub in submissions
    ]

    return StudentMiniProjectDetail(
        mp_id=mp.id,
        run_id=run.id,
        block_id=block.id,
        block_slug=block.slug,
        block_title=block.title,
        assignment_html=mp.assignment_html,
        soft_deadline=mp.soft_deadline,
        hard_deadline=mp.hard_deadline,
        resubmission_deadline=mp.resubmission_deadline,
        group=group_summary,
        submission_history=history,
        latest_status=latest_status,
        can_submit=can_submit,
        can_submit_reason_if_not=reason,
    )
