from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.lookups import get_or_404
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import AnswerOption, Block, CourseVersion, Item, Question, Sequence
from mathion.models_auth import StudentEnrollment, User, UserItemState
from mathion.quiz import evaluate_question
from mathion.schemas import QuestionReveal, QuizRevealResponse, QuizSubmitRequest, QuizSubmitResponse

router = APIRouter(tags=["quiz"])


def _check_quiz_access(db: Session, user: User, item_id: int) -> tuple[Item, CourseVersion]:
    """Verify user is enrolled and item is in a published version."""
    item = get_or_404(db, Item, item_id)
    seq = get_or_404(db, Sequence, item.sequence_id, detail="Item not found")
    block = get_or_404(db, Block, seq.block_id, detail="Item not found")
    version = get_or_404(db, CourseVersion, block.version_id)

    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state not in ("published", "archived"):
        raise HTTPException(status_code=403, detail="Version not published")

    if not user.is_superuser:
        is_enrolled = db.execute(
            select(StudentEnrollment).where(
                StudentEnrollment.version_id == version.id,
                StudentEnrollment.user_id == user.id,
                StudentEnrollment.is_active == True,
            )
        ).scalar_one_or_none()
        if not is_enrolled:
            raise HTTPException(status_code=403, detail="Not enrolled")

    return item, version


@router.post("/api/items/{item_id}/submit", response_model=QuizSubmitResponse)
def submit_quiz(item_id: int, data: QuizSubmitRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item, version = _check_quiz_access(db, user, item_id)

    if item.type != "quiz":
        raise HTTPException(status_code=409, detail="Can only submit answers to quiz items")

    # Load questions for this item
    questions = db.execute(
        select(Question).where(Question.item_id == item_id)
    ).scalars().all()

    if not questions:
        raise HTTPException(status_code=409, detail="Quiz has no questions")

    # Validate all questions are answered
    q_ids = {str(q.id) for q in questions}
    submitted_ids = set(data.answers.keys())
    if submitted_ids != q_ids:
        missing = q_ids - submitted_ids
        raise HTTPException(status_code=422, detail=f"Missing answers for questions: {missing}")

    # Get or create user state
    state = db.execute(
        select(UserItemState).where(
            UserItemState.user_id == user.id,
            UserItemState.item_id == item_id,
        )
    ).scalar_one_or_none()

    if not state:
        state = UserItemState(user_id=user.id, item_id=item_id, is_covered=False, time_spent=0)
        db.add(state)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            state = db.execute(
                select(UserItemState).where(
                    UserItemState.user_id == user.id,
                    UserItemState.item_id == item_id,
                )
            ).scalar_one()

    # Check max attempts — atomic increment to prevent race condition
    max_attempts = version.max_quiz_attempts
    if state.attempt_count >= max_attempts:
        raise HTTPException(status_code=409, detail="Max attempts reached")

    # Evaluate each question — option-level scoring (Phase 7c)
    score_correct = 0
    score_total = 0
    for q in questions:
        student_answer = data.answers[str(q.id)]

        correct_ids: set[int] = set()
        all_ids: set[int] = set()
        if q.type in ("single_choice", "multiple_choice"):
            rows = db.execute(
                select(AnswerOption.id, AnswerOption.is_correct).where(
                    AnswerOption.question_id == q.id,
                )
            ).all()
            all_ids = {r.id for r in rows}
            correct_ids = {r.id for r in rows if r.is_correct}

        picks, total = evaluate_question(
            q_type=q.type,
            student_answer=student_answer,
            correct_option_ids=correct_ids,
            all_option_ids=all_ids,
            correct_numeric=q.correct_numeric,
            precision=q.precision,
            correct_text=q.correct_text,
        )
        score_correct += picks
        score_total += total

    # Atomic increment: only succeeds if attempt_count < max_attempts
    rows_updated = db.execute(
        update(UserItemState)
        .where(
            UserItemState.id == state.id,
            UserItemState.attempt_count < max_attempts,
        )
        .values(
            attempt_count=UserItemState.attempt_count + 1,
            last_answers=dict(data.answers),
            last_score_correct=score_correct,
            last_score_total=score_total,
            last_visited_at=datetime.now(timezone.utc),
            is_covered=True,
        )
    ).rowcount

    if rows_updated == 0:
        db.rollback()
        raise HTTPException(status_code=409, detail="Max attempts reached")

    db.commit()
    db.refresh(state)

    return QuizSubmitResponse(
        item_id=item_id,
        attempt_count=state.attempt_count,
        max_attempts=max_attempts,
        score_correct=score_correct,
        score_total=score_total,
        can_retry=state.attempt_count < max_attempts,
    )


@router.get("/api/items/{item_id}/reveal", response_model=QuizRevealResponse)
def reveal_quiz(item_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item, version = _check_quiz_access(db, user, item_id)

    if item.type != "quiz":
        raise HTTPException(status_code=409, detail="Not a quiz item")

    # Get user state
    state = db.execute(
        select(UserItemState).where(
            UserItemState.user_id == user.id,
            UserItemState.item_id == item_id,
        )
    ).scalar_one_or_none()

    if not state or state.attempt_count < version.max_quiz_attempts:
        raise HTTPException(status_code=403, detail="Answers revealed only after all attempts are used")

    # Load questions
    questions = db.execute(
        select(Question).where(Question.item_id == item_id).order_by(Question.order, Question.id)
    ).scalars().all()

    last_answers = state.last_answers or {}

    reveals = []
    for q in questions:
        correct_ids = []
        if q.type in ("single_choice", "multiple_choice"):
            correct_ids = list(db.scalars(
                select(AnswerOption.id).where(
                    AnswerOption.question_id == q.id,
                    AnswerOption.is_correct == True,
                )
            ).all())

        reveals.append(QuestionReveal(
            id=q.id,
            type=q.type,
            text_html=q.text_html,
            explanation_html=q.explanation_html,
            correct_option_ids=correct_ids,
            correct_numeric=q.correct_numeric,
            correct_text=q.correct_text,
            student_answer=last_answers.get(str(q.id)),
        ))

    return QuizRevealResponse(
        item_id=item_id,
        attempt_count=state.attempt_count,
        score_correct=state.last_score_correct or 0,
        score_total=state.last_score_total or 0,
        questions=reveals,
    )
