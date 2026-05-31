import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, require_run_admin_or_teacher
from mathion.api.mini_projects import mini_project_title
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import (
    AnswerOption,
    Block,
    Evaluation,
    Group,
    Item,
    MiniProject,
    Question,
    Run,
    RunStudent,
    Sequence,
    Submission,
)
from mathion.models_auth import User, UserItemState
from mathion.schemas import (
    SequenceItemScore,
    SequenceItemState,
    SequenceItemStateResponse,
    _SequenceMeta,
    _StudentMeta,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["dashboard"])


def _load_sequences(db: Session, version_id: int) -> list[dict]:
    """Return ordered sequence metadata for a course version."""
    rows = db.execute(
        select(
            Block.id, Block.order, Block.title,
            Sequence.id, Sequence.order, Sequence.title,
            func.count(Item.id),
            func.coalesce(
                func.max(case((Item.type == "quiz", 1), else_=0)),
                0,
            ),
        )
        .select_from(Sequence)
        .join(Block, Block.id == Sequence.block_id)
        .outerjoin(Item, Item.sequence_id == Sequence.id)
        .where(Block.version_id == version_id)
        .group_by(Block.id, Block.order, Block.title,
                  Sequence.id, Sequence.order, Sequence.title)
        .order_by(Block.order, Sequence.order)
    ).all()

    return [
        {
            "block_id": b_id,
            "block_order": b_order,
            "block_title": b_title,
            "sequence_id": s_id,
            "sequence_order": s_order,
            "sequence_title": s_title,
            "total_items": int(total),
            "has_quiz_items": bool(has_quiz),
        }
        for (b_id, b_order, b_title, s_id, s_order, s_title, total, has_quiz) in rows
    ]


def _load_quiz_max_per_sequence(db: Session, version_id: int) -> dict[int, int]:
    """Map sequence_id -> sum of per-quiz-item max-possible-score.

    Per-question max:
      - 1 for single_choice / numeric_answer / text_answer
      - count(correct AnswerOptions) for multiple_choice
    Sequences without quiz items are absent from the dict.
    """
    correct_count_subq = (
        select(
            Question.id.label("qid"),
            func.count(AnswerOption.id).label("correct_count"),
        )
        .join(AnswerOption, (AnswerOption.question_id == Question.id) & (AnswerOption.is_correct == True))
        .group_by(Question.id)
        .subquery()
    )

    rows = db.execute(
        select(
            Sequence.id,
            func.sum(
                case(
                    (Question.type == "multiple_choice",
                     func.coalesce(correct_count_subq.c.correct_count, 0)),
                    else_=1,
                )
            ),
        )
        .select_from(Sequence)
        .join(Block, Block.id == Sequence.block_id)
        .join(Item, Item.sequence_id == Sequence.id)
        .join(Question, Question.item_id == Item.id)
        .outerjoin(correct_count_subq, correct_count_subq.c.qid == Question.id)
        .where(Block.version_id == version_id, Item.type == "quiz")
        .group_by(Sequence.id)
    ).all()

    return {sid: int(total) for (sid, total) in rows if total is not None}


def _load_student_aggregates(db: Session, run_id: int, version_id: int) -> list[dict]:
    """Return one row per (RunStudent x Sequence) with covered count and quiz_correct sum."""
    rows = db.execute(
        select(
            RunStudent.user_id,
            Sequence.id,
            func.count(Item.id),
            func.sum(case((UserItemState.is_covered == True, 1), else_=0)),
            func.sum(
                case(
                    (Item.type == "quiz", func.coalesce(UserItemState.last_score_correct, 0)),
                    else_=0,
                )
            ),
        )
        .select_from(RunStudent)
        .join(Block, Block.version_id == version_id)
        .join(Sequence, Sequence.block_id == Block.id)
        .outerjoin(Item, Item.sequence_id == Sequence.id)
        .outerjoin(
            UserItemState,
            (UserItemState.item_id == Item.id) & (UserItemState.user_id == RunStudent.user_id),
        )
        .where(RunStudent.run_id == run_id)
        .group_by(RunStudent.user_id, Sequence.id)
    ).all()

    return [
        {
            "user_id": uid,
            "sequence_id": sid,
            "total_items": int(total or 0),
            "covered": int(covered or 0),
            "quiz_correct": int(quiz_correct or 0),
        }
        for (uid, sid, total, covered, quiz_correct) in rows
    ]


def _load_run_students(db: Session, run_id: int) -> list[dict]:
    """Return ordered student row scaffolding (without cells)."""
    rows = db.execute(
        select(RunStudent, User, Group)
        .join(User, User.id == RunStudent.user_id)
        .outerjoin(Group, Group.id == RunStudent.group_id)
        .where(RunStudent.run_id == run_id)
        .order_by(RunStudent.created_at)
    ).all()

    return [
        {
            "user_id": rs.user_id,
            "email": u.email,
            "full_name": u.full_name,
            "user_is_disabled": u.is_disabled,
            "group_id": g.id if g else None,
            "group_name": g.name if g else None,
            "group_is_disabled": g.is_disabled if g else False,
        }
        for (rs, u, g) in rows
    ]


@router.get("/api/runs/{run_id}/dashboard/progress")
def get_progress(
    run_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)

    sequences = _load_sequences(db, run.version_id)
    quiz_max_by_seq = _load_quiz_max_per_sequence(db, run.version_id)
    aggs = _load_student_aggregates(db, run.id, run.version_id)
    students_meta = _load_run_students(db, run.id)

    by_us = {(a["user_id"], a["sequence_id"]): a for a in aggs}
    has_quiz_by_seq = {s["sequence_id"]: s["has_quiz_items"] for s in sequences}

    students = []
    for sm in students_meta:
        coverage = []
        quizzes = []
        for s in sequences:
            seq_id = s["sequence_id"]
            agg = by_us.get((sm["user_id"], seq_id), {"covered": 0, "total_items": 0, "quiz_correct": 0})
            coverage.append({
                "sequence_id": seq_id,
                "covered": agg["covered"],
                "total": s["total_items"],
            })
            if has_quiz_by_seq.get(seq_id):
                quizzes.append({
                    "sequence_id": seq_id,
                    "correct": agg["quiz_correct"],
                    "total": quiz_max_by_seq.get(seq_id, 0),
                })
            else:
                quizzes.append({"sequence_id": seq_id, "correct": None, "total": None})
        students.append({**sm, "coverage": coverage, "quizzes": quizzes})

    return {
        "run": {
            "id": run.id,
            "title": run.title,
            "groups_enabled": run.groups_enabled,
            "version_is_disabled": run.version.is_disabled,
        },
        "sequences": sequences,
        "students": students,
    }


def _derive_status(latest_sub, latest_eval) -> str:
    if latest_sub is None:
        return "not_submitted"
    if latest_eval is None:
        return "awaiting_eval"
    r = latest_eval.result
    if r in ("major_revision", "minor_revision"):
        return "needs_revision"
    if r == "accepted":
        return "accepted"
    if r == "rejected":
        return "rejected"
    return "awaiting_eval"  # defensive


def _serialize_user_ref(user_id: int | None, full_name: str | None) -> dict | None:
    if user_id is None:
        return None
    return {"user_id": user_id, "full_name": full_name}


def _serialize_submission(sub, submitter_user_id, submitter_full_name) -> dict | None:
    if sub is None:
        return None
    return {
        "id": sub.id,
        "submission_number": sub.submission_number,
        "submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else None,
        "submitted_by": _serialize_user_ref(submitter_user_id, submitter_full_name),
        "is_late": sub.is_late,
        "is_resubmission": sub.is_resubmission,
        "file_size": sub.file_size,
    }


def _serialize_evaluation(ev, evaluator_user_id, evaluator_full_name) -> dict | None:
    if ev is None:
        return None
    return {
        "id": ev.id,
        "evaluated_at": ev.evaluated_at.isoformat() if ev.evaluated_at else None,
        "evaluated_by": _serialize_user_ref(evaluator_user_id, evaluator_full_name),
        "result": ev.result,
        "score": ev.score,
        "feedback_text": ev.feedback_text,
        "has_feedback_file": ev.feedback_file is not None,
    }


@router.get("/api/runs/{run_id}/dashboard/mini-projects")
def get_mini_projects(
    run_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)

    # 1. MPs and groups for this run
    mps = db.execute(
        select(MiniProject, Block)
        .join(Block, Block.id == MiniProject.block_id)
        .where(MiniProject.run_id == run_id)
        .order_by(Block.order)
    ).all()

    groups = db.execute(
        select(Group).where(Group.run_id == run_id).order_by(Group.id)
    ).scalars().all()

    # 2. Latest submission + evaluation per (mp, group). One pass.
    if mps:
        sub_rows = db.execute(
            select(Submission, Evaluation, User.id, User.full_name)
            .outerjoin(Evaluation, Evaluation.submission_id == Submission.id)
            .outerjoin(User, User.id == Submission.submitted_by)
            .where(Submission.mini_project_id.in_([mp.id for mp, _ in mps]))
            .order_by(Submission.mini_project_id, Submission.group_id, Submission.submission_number.desc())
        ).all()
    else:
        sub_rows = []

    # Reduce to latest per (mp_id, group_id). Iteration is in DESC submission_number order
    # so the first-seen (mp, group) pair is the latest.
    latest_by_pair: dict[tuple[int, int], tuple] = {}
    for sub, ev, sub_by_id, sub_by_name in sub_rows:
        key = (sub.mini_project_id, sub.group_id)
        if key not in latest_by_pair:
            latest_by_pair[key] = (sub, ev, sub_by_id, sub_by_name)

    # Pre-load evaluator user names
    evaluator_ids = {ev.evaluated_by for (_, ev, _, _) in latest_by_pair.values() if ev is not None}
    evaluators = {u.id: u for u in db.execute(
        select(User).where(User.id.in_(evaluator_ids))
    ).scalars().all()} if evaluator_ids else {}

    # 3. Build response
    mp_entries = []
    for mp, block in mps:
        group_entries = []
        counts = {"total_groups": 0, "not_submitted": 0, "awaiting_eval": 0,
                  "needs_revision": 0, "accepted": 0, "rejected": 0}
        for g in groups:
            entry = latest_by_pair.get((mp.id, g.id))
            sub = ev = None
            sub_by_id = sub_by_name = None
            if entry is not None:
                sub, ev, sub_by_id, sub_by_name = entry
            status = _derive_status(sub, ev)

            evaluator_id = evaluator_name = None
            if ev is not None:
                evaluator = evaluators.get(ev.evaluated_by)
                if evaluator is not None:
                    evaluator_id = evaluator.id
                    evaluator_name = evaluator.full_name

            group_entries.append({
                "group_id": g.id,
                "group_name": g.name,
                "group_is_disabled": g.is_disabled,
                "status": status,
                "latest_submission": _serialize_submission(sub, sub_by_id, sub_by_name),
                "latest_evaluation": _serialize_evaluation(ev, evaluator_id, evaluator_name),
            })
            counts["total_groups"] += 1
            counts[status] += 1

        mp_entries.append({
            "id": mp.id,
            "block_id": block.id,
            "block_order": block.order,
            "block_title": block.title,
            "title": mini_project_title(block),
            "is_published": mp.is_published,
            "first_submitted_at": mp.first_submitted_at.isoformat() if mp.first_submitted_at else None,
            "soft_deadline": mp.soft_deadline.isoformat() if mp.soft_deadline else None,
            "hard_deadline": mp.hard_deadline.isoformat() if mp.hard_deadline else None,
            "resubmission_deadline": mp.resubmission_deadline.isoformat() if mp.resubmission_deadline else None,
            "counts": counts,
            "groups": group_entries,
        })

    return {
        "run": {
            "id": run.id,
            "title": run.title,
            "groups_enabled": run.groups_enabled,
        },
        "mini_projects": mp_entries,
    }


# ============================================================================
# Teacher Dashboards (T1): per-(student, sequence) item drilldown
# Spec: docs/superpowers/specs/2026-05-31-teacher-dashboards-design.md §5.1
# ============================================================================


def _resolve_run_student_with_user(
    db: Session, run: Run, user_id: int
) -> tuple[RunStudent, User] | None:
    """Return (RunStudent, User) iff the user is a student of this run, else None.

    Returns BOTH so the endpoint can populate _StudentMeta.{full_name, email}
    without a second query. Caller raises probe-safe 404 on None.
    """
    row = db.execute(
        select(RunStudent, User)
        .join(User, User.id == RunStudent.user_id)
        .where(
            RunStudent.run_id == run.id,
            RunStudent.user_id == user_id,
        )
    ).one_or_none()
    if row is None:
        return None
    # SQLAlchemy 2.x Row unpacks directly; .tuple() is deprecated.
    rs, user = row
    return rs, user


def _resolve_sequence_in_version(
    db: Session, version_id: int, sequence_id: int
) -> tuple[Sequence, Block] | None:
    """Return (Sequence, Block) iff the sequence belongs to a block in the given
    course version, else None.

    Returns BOTH so the endpoint can populate _SequenceMeta.{block_id, block_title}
    without a second query / lazy-load. Caller raises probe-safe 404 on None.
    """
    row = db.execute(
        select(Sequence, Block)
        .join(Block, Block.id == Sequence.block_id)
        .where(
            Sequence.id == sequence_id,
            Block.version_id == version_id,
        )
    ).one_or_none()
    if row is None:
        return None
    seq, block = row
    return seq, block


@router.get(
    "/api/runs/{run_id}/students/{user_id}/sequences/{sequence_id}/items",
    response_model=SequenceItemStateResponse,
)
def get_sequence_item_state(
    run_id: int,
    user_id: int,
    sequence_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Per-item state drilldown for one (run, student, sequence) tuple.

    Auth: admin of the course OR teacher of the run OR superuser.
    All 404 responses use detail="Resource not found" to prevent enumeration.
    """
    # Step 1: resolve run (probe-safe 404). Fires BEFORE the role check
    # (uniform with the rest of the FastAPI codebase — see spec §5.1).
    run = get_or_404(db, Run, run_id, detail="Resource not found")

    # Step 2: authorize (403 if not admin/teacher/superuser).
    require_run_admin_or_teacher(db, current_user, run)

    # Step 3: resolve student (probe-safe 404 if not enrolled).
    student_pair = _resolve_run_student_with_user(db, run, user_id)
    if student_pair is None:
        raise HTTPException(status_code=404, detail="Resource not found")
    _rs, student_user = student_pair

    # Step 4: resolve sequence within the run's pinned version (probe-safe 404).
    seq_pair = _resolve_sequence_in_version(db, run.version_id, sequence_id)
    if seq_pair is None:
        raise HTTPException(status_code=404, detail="Resource not found")
    seq, block = seq_pair

    # Step 5: items LEFT JOIN UserItemState, ordered by Item.order.
    rows = db.execute(
        select(Item, UserItemState)
        .outerjoin(
            UserItemState,
            (UserItemState.item_id == Item.id) & (UserItemState.user_id == user_id),
        )
        .where(Item.sequence_id == seq.id)
        .order_by(Item.order.asc())
    ).all()

    item_states: list[SequenceItemState] = []
    for row in rows:
        item, uis = row  # Row unpacks directly in SQLA 2.x.
        is_covered = bool(uis is not None and uis.is_covered)
        # Spec §5.1 Cell conventions: last_score is null when:
        #   (a) item is NOT quiz, OR
        #   (b) no UIS row exists, OR
        #   (c) row exists but BOTH score columns are None (visited but not attempted).
        last_score: SequenceItemScore | None = None
        if item.type == "quiz" and uis is not None:
            c, t = uis.last_score_correct, uis.last_score_total
            if c is not None and t is not None:
                last_score = SequenceItemScore(correct=c, total=t)
        # last_visited_at is a top-level field (NOT nested under last_score).
        last_visited_at = uis.last_visited_at if uis is not None else None
        item_states.append(SequenceItemState(
            item_id=item.id,
            item_order=item.order,
            item_title=item.title,
            item_type=item.type,
            is_covered=is_covered,
            last_score=last_score,
            last_visited_at=last_visited_at,
        ))

    return SequenceItemStateResponse(
        sequence=_SequenceMeta(
            sequence_id=seq.id,
            sequence_title=seq.title,
            block_id=block.id,
            block_title=block.title,
        ),
        student=_StudentMeta(
            user_id=student_user.id,
            full_name=student_user.full_name,
            email=student_user.email,
        ),
        items=item_states,
    )
