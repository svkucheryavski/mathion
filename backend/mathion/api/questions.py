from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.api.helpers import bump_content_updated_at, get_or_404, render_with_assets, require_course_admin, sync_asset_references
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import AnswerOption, Block, CourseVersion, Item, Question, Sequence
from mathion.models_auth import User
from mathion.schemas import OptionCreate, OptionResponse, OptionUpdate, QuestionCreate, QuestionResponse, QuestionUpdate, ReorderRequest

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
    text_html = render_with_assets(db, version.id, data.text_md)
    explanation_html = render_with_assets(db, version.id, data.explanation_md)
    question = Question(
        item_id=item_id,
        text_md=data.text_md,
        text_html=text_html,
        type=data.type,
        order=next_order,
        explanation_md=data.explanation_md,
        explanation_html=explanation_html,
        correct_numeric=data.correct_numeric,
        precision=data.precision,
        correct_text=data.correct_text,
    )
    db.add(question)
    db.flush()
    sync_asset_references(db, version.id, [data.text_md, data.explanation_md], {"question_id": question.id})
    bump_content_updated_at(version)
    db.commit()
    db.refresh(question)
    return question


@router.get("/api/items/{item_id}/questions", response_model=list[QuestionResponse])
def list_questions(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item, version = _get_version_for_item(db, item_id)
    require_course_admin(db, user, version.course_id)
    questions = db.execute(
        select(Question).where(Question.item_id == item_id).order_by(Question.order, Question.id)
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

    if "text_md" in updates:
        question.text_html = render_with_assets(db, version.id, question.text_md)
    if "explanation_md" in updates:
        question.explanation_html = render_with_assets(db, version.id, question.explanation_md)
    if "text_md" in updates or "explanation_md" in updates:
        sync_asset_references(db, version.id, [question.text_md, question.explanation_md], {"question_id": question.id})
        bump_content_updated_at(version)

    # Validate invariants after update (prevent breaking published quiz)
    if question.type == "numeric_answer" and question.correct_numeric is None:
        raise HTTPException(status_code=422, detail="correct_numeric cannot be null for numeric_answer questions")
    if question.type == "text_answer" and not (question.correct_text or "").strip():
        raise HTTPException(status_code=422, detail="correct_text cannot be empty for text_answer questions")

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


@router.post("/api/items/{item_id}/questions/reorder")
def reorder_questions(item_id: int, data: ReorderRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item, version = _get_version_for_item(db, item_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only reorder questions in 'created' state")

    # Validate: all children must be present, no duplicate orders
    incoming_ids = {e.id for e in data.order}
    incoming_orders = [e.order for e in data.order]
    if len(set(incoming_orders)) != len(incoming_orders):
        raise HTTPException(status_code=400, detail="Duplicate order values in request")
    real_ids = set(db.scalars(select(Question.id).where(Question.item_id == item_id)).all())
    if incoming_ids != real_ids:
        raise HTTPException(status_code=400, detail="Reorder list must include every question in this item")

    for entry in data.order:
        q = db.get(Question, entry.id)
        q.order = entry.order
    db.commit()
    return {"status": "ok"}


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
        select(AnswerOption).where(AnswerOption.question_id == question_id).order_by(AnswerOption.order, AnswerOption.id)
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

    # Validate: cannot remove the last correct option
    if "is_correct" in updates and not option.is_correct:
        # Option was just set to False — check at least one correct remains
        all_options = db.execute(
            select(AnswerOption).where(AnswerOption.question_id == option.question_id)
        ).scalars().all()
        correct_count = sum(1 for o in all_options if o.is_correct)
        if correct_count == 0:
            raise HTTPException(status_code=422, detail="At least one option must be correct")

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


@router.post("/api/questions/{question_id}/options/reorder")
def reorder_options(question_id: int, data: ReorderRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    question, version = _get_version_for_question(db, question_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only reorder options in 'created' state")

    incoming_ids = {e.id for e in data.order}
    incoming_orders = [e.order for e in data.order]
    if len(set(incoming_orders)) != len(incoming_orders):
        raise HTTPException(status_code=400, detail="Duplicate order values in request")
    real_ids = set(db.scalars(select(AnswerOption.id).where(AnswerOption.question_id == question_id)).all())
    if incoming_ids != real_ids:
        raise HTTPException(status_code=400, detail="Reorder list must include every option in this question")

    for entry in data.order:
        opt = db.get(AnswerOption, entry.id)
        opt.order = entry.order
    db.commit()
    return {"status": "ok"}
