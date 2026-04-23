from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, require_course_admin
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Block, CourseVersion, Item, Question, Sequence
from mathion.models_auth import User
from mathion.schemas import QuestionCreate, QuestionResponse, QuestionUpdate

router = APIRouter(tags=["questions"])

_QUESTION_EDITABLE_PUBLISHED = {"text_md", "explanation_md", "correct_numeric", "precision", "correct_text"}


def _get_version_for_item(db: Session, item_id: int) -> tuple[Item, CourseVersion]:
    item = get_or_404(db, Item, item_id)
    seq = get_or_404(db, Sequence, item.sequence_id)
    block = get_or_404(db, Block, seq.block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    return item, version


def _get_version_for_question(db: Session, question_id: int) -> tuple[Question, CourseVersion]:
    question = get_or_404(db, Question, question_id)
    item = get_or_404(db, Item, question.item_id)
    seq = get_or_404(db, Sequence, item.sequence_id)
    block = get_or_404(db, Block, seq.block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    return question, version


@router.post("/api/items/{item_id}/questions", status_code=201, response_model=QuestionResponse)
def create_question(item_id: int, data: QuestionCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item, version = _get_version_for_item(db, item_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only add questions in 'created' state")
    if item.type != "quiz":
        raise HTTPException(status_code=409, detail="Can only add questions to quiz items")

    next_order = (db.scalar(select(func.max(Question.order)).where(Question.item_id == item_id)) or 0) + 1
    question = Question(
        item_id=item_id,
        text_md=data.text_md,
        text_html="",
        type=data.type,
        order=next_order,
        explanation_md=data.explanation_md,
        explanation_html="",
        correct_numeric=data.correct_numeric,
        precision=data.precision,
        correct_text=data.correct_text,
    )
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


@router.get("/api/items/{item_id}/questions", response_model=list[QuestionResponse])
def list_questions(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item, version = _get_version_for_item(db, item_id)
    require_course_admin(db, user, version.course_id)
    questions = db.execute(
        select(Question).where(Question.item_id == item_id).order_by(Question.order)
    ).scalars().all()
    return questions


@router.patch("/api/questions/{question_id}", response_model=QuestionResponse)
def update_question(question_id: int, data: QuestionUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    question, version = _get_version_for_question(db, question_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state == "archived":
        raise HTTPException(status_code=409, detail="Cannot edit questions in archived versions")

    updates = data.model_dump(exclude_unset=True)
    if version.state == "published":
        disallowed = set(updates.keys()) - _QUESTION_EDITABLE_PUBLISHED
        if disallowed:
            raise HTTPException(status_code=409, detail=f"Cannot edit {disallowed} in published state")

    for field, value in updates.items():
        setattr(question, field, value)
    db.commit()
    db.refresh(question)
    return question


@router.delete("/api/questions/{question_id}", status_code=204)
def delete_question(question_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    question, version = _get_version_for_question(db, question_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only delete questions in 'created' state")
    db.delete(question)
    db.commit()
