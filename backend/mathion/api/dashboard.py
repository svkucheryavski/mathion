import logging

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, require_run_admin_or_teacher
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import AnswerOption, Block, Group, Item, Question, Run, RunStudent, Sequence
from mathion.models_auth import User, UserItemState

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


@router.get("/api/runs/{run_id}/dashboard/mini-projects")
def get_mini_projects(
    run_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    # Stub — full body added in Tasks 8-9.
    return {
        "run": {
            "id": run.id,
            "title": run.title,
            "groups_enabled": run.groups_enabled,
        },
        "mini_projects": [],
    }
