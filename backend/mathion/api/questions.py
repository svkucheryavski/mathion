from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, require_course_admin
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import AnswerOption, Block, CourseVersion, Item, Question, Sequence
from mathion.models_auth import User
from mathion.schemas import OptionCreate, OptionResponse, OptionUpdate, QuestionCreate, QuestionResponse, QuestionUpdate

router = APIRouter(tags=["questions"])

_QUESTION_EDITABLE_PUBLISHED = {"text_md", "explanation_md", "correct_numeric", "precision", "correct_text"}
_OPTION_EDITABLE_PUBLISHED = {"text", "is_correct"}


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


def _get_version_for_option(db: Session, option_id: int) -> tuple[AnswerOption, CourseVersion]:
    option = get_or_404(db, AnswerOption, option_id)
    question = get_or_404(db, Question, option.question_id)
    item = get_or_404(db, Item, question.item_id)
    seq = get_or_404(db, Sequence, item.sequence_id)
    block = get_or_404(db, Block, seq.block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    return option, version


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


@router.post("/api/questions/{question_id}/options", status_code=201, response_model=OptionResponse)
def create_option(question_id: int, data: OptionCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    question, version = _get_version_for_question(db, question_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only add options in 'created' state")
    if question.type not in ("single_choice", "multiple_choice"):
        raise HTTPException(status_code=409, detail="Options are only for choice-type questions")

    next_order = (db.scalar(select(func.max(AnswerOption.order)).where(AnswerOption.question_id == question_id)) or 0) + 1
    option = AnswerOption(
        question_id=question_id,
        text=data.text,
        is_correct=data.is_correct,
        order=next_order,
    )
    db.add(option)
    db.commit()
    db.refresh(option)
    return option


@router.get("/api/questions/{question_id}/options", response_model=list[OptionResponse])
def list_options(question_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    question, version = _get_version_for_question(db, question_id)
    require_course_admin(db, user, version.course_id)
    options = db.execute(
        select(AnswerOption).where(AnswerOption.question_id == question_id).order_by(AnswerOption.order)
    ).scalars().all()
    return options


@router.patch("/api/options/{option_id}", response_model=OptionResponse)
def update_option(option_id: int, data: OptionUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    option, version = _get_version_for_option(db, option_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state == "archived":
        raise HTTPException(status_code=409, detail="Cannot edit options in archived versions")

    updates = data.model_dump(exclude_unset=True)
    if version.state == "published":
        disallowed = set(updates.keys()) - _OPTION_EDITABLE_PUBLISHED
        if disallowed:
            raise HTTPException(status_code=409, detail=f"Cannot edit {disallowed} in published state")

    for field, value in updates.items():
        setattr(option, field, value)
    db.commit()
    db.refresh(option)
    return option


@router.delete("/api/options/{option_id}", status_code=204)
def delete_option(option_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    option, version = _get_version_for_option(db, option_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only delete options in 'created' state")
    db.delete(option)
    db.commit()
