from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, require_course_admin, slugify
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.markdown import render_markdown
from mathion.models import Block, CourseVersion, Sequence
from mathion.models_auth import User
from mathion.schemas import (
    BlockCreate,
    BlockResponse,
    BlockUpdate,
    ReorderRequest,
    SequenceCreate,
    SequenceResponse,
    SequenceUpdate,
)

router = APIRouter(tags=["blocks"])

MAX_BLOCKS = 8
MAX_SEQUENCES = 8

# ---------- Editable fields by state ----------
_BLOCK_EDITABLE_PUBLISHED = {"title", "info"}
_SEQUENCE_EDITABLE_PUBLISHED = {"title"}


def _get_version_state(db: Session, version_id: int) -> str:
    version = get_or_404(db, CourseVersion, version_id)
    return version.state


# ==================== BLOCKS ====================


@router.post("/api/versions/{version_id}/blocks", status_code=201, response_model=BlockResponse)
def create_block(version_id: int, data: BlockCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only add blocks to versions in 'created' state")
    count = db.scalar(select(func.count()).where(Block.version_id == version_id))
    if count >= MAX_BLOCKS:
        raise HTTPException(status_code=409, detail=f"Maximum {MAX_BLOCKS} blocks per version")

    slug = slugify(data.title)
    if not slug:
        raise HTTPException(
            status_code=422,
            detail=[{
                "loc": ["body", "title"],
                "msg": "Title must contain at least one Latin letter or digit",
                "type": "value_error",
            }],
        )
    if len(slug) > 80:
        raise HTTPException(
            status_code=422,
            detail=[{
                "loc": ["body", "title"],
                "msg": "Title is too long — the auto-generated slug exceeds the 80-character limit. Please shorten the title.",
                "type": "value_error",
            }],
        )

    # NOTE: order assignment is not safe under concurrent writes.
    # For PostgreSQL, consider SELECT ... FOR UPDATE or a serializable transaction.
    next_order = (db.scalar(select(func.max(Block.order)).where(Block.version_id == version_id)) or 0) + 1
    block = Block(
        version_id=version_id,
        title=data.title,
        slug=slug,
        order=next_order,
        info=data.info,
        info_html=render_markdown(data.info or ""),
    )
    db.add(block)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A block with the same auto-generated slug already exists in this version — choose a different title.",
        )
    db.refresh(block)
    return block


@router.get("/api/versions/{version_id}/blocks", response_model=list[BlockResponse])
def list_blocks(version_id: int, limit: int = 100, offset: int = 0, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
    blocks = db.execute(
        select(Block).where(Block.version_id == version_id).order_by(Block.order).offset(offset).limit(limit)
    ).scalars().all()
    return blocks


@router.patch("/api/blocks/{block_id}", response_model=BlockResponse)
def update_block(block_id: int, data: BlockUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    block = get_or_404(db, Block, block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    state = version.state

    if state == "archived":
        raise HTTPException(status_code=409, detail="Cannot edit blocks in archived versions")

    updates = data.model_dump(exclude_unset=True)
    if state == "published":
        disallowed = set(updates.keys()) - _BLOCK_EDITABLE_PUBLISHED
        if disallowed:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot edit {disallowed} in published state",
            )

    # Snapshot stored title BEFORE mutating, so the title-diff rule has a
    # stable reference even if loops below run in any order.
    stored_title = block.title

    if "title" in updates:
        if updates["title"] is None:
            raise HTTPException(
                status_code=422,
                detail=[{
                    "loc": ["body", "title"],
                    "msg": "Title must be a non-null string",
                    "type": "value_error",
                }],
            )
        if updates["title"] != stored_title:
            new_slug = slugify(updates["title"])
            if not new_slug:
                raise HTTPException(
                    status_code=422,
                    detail=[{
                        "loc": ["body", "title"],
                        "msg": "Title must contain at least one Latin letter or digit",
                        "type": "value_error",
                    }],
                )
            if len(new_slug) > 80:
                raise HTTPException(
                    status_code=422,
                    detail=[{
                        "loc": ["body", "title"],
                        "msg": "Title is too long — the auto-generated slug exceeds the 80-character limit. Please shorten the title.",
                        "type": "value_error",
                    }],
                )
            updates["slug"] = new_slug

    for field, value in updates.items():
        setattr(block, field, value)
        if field == "info":
            block.info_html = render_markdown(value or "")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A block with the same auto-generated slug already exists in this version — choose a different title.",
        )
    db.refresh(block)
    return block


@router.delete("/api/blocks/{block_id}", status_code=204)
def delete_block(block_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    block = get_or_404(db, Block, block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only delete blocks in 'created' state")
    has_seq = db.scalar(select(Sequence.id).where(Sequence.block_id == block_id).limit(1))
    if has_seq is not None:
        raise HTTPException(status_code=409, detail="Cannot delete block: remove its sequences first")
    db.delete(block)
    db.commit()


@router.post("/api/versions/{version_id}/blocks/reorder")
def reorder_blocks(version_id: int, data: ReorderRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only reorder in 'created' state")

    incoming_ids = {e.id for e in data.order}
    incoming_orders = [e.order for e in data.order]
    if len(set(incoming_orders)) != len(incoming_orders):
        raise HTTPException(status_code=400, detail="Duplicate order values in request")
    real_ids = set(db.scalars(select(Block.id).where(Block.version_id == version_id)).all())
    if incoming_ids != real_ids:
        raise HTTPException(status_code=400, detail="Reorder list must include every block in this version")

    for entry in data.order:
        block = db.get(Block, entry.id)
        block.order = entry.order
    db.commit()
    return {"status": "ok"}


# ==================== SEQUENCES ====================


@router.post("/api/blocks/{block_id}/sequences", status_code=201, response_model=SequenceResponse)
def create_sequence(block_id: int, data: SequenceCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    block = get_or_404(db, Block, block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only add sequences to versions in 'created' state")
    count = db.scalar(select(func.count()).where(Sequence.block_id == block_id))
    if count >= MAX_SEQUENCES:
        raise HTTPException(status_code=409, detail=f"Maximum {MAX_SEQUENCES} sequences per block")

    slug = slugify(data.title)
    if not slug:
        raise HTTPException(
            status_code=422,
            detail=[{
                "loc": ["body", "title"],
                "msg": "Title must contain at least one Latin letter or digit",
                "type": "value_error",
            }],
        )
    if len(slug) > 80:
        raise HTTPException(
            status_code=422,
            detail=[{
                "loc": ["body", "title"],
                "msg": "Title is too long — the auto-generated slug exceeds the 80-character limit. Please shorten the title.",
                "type": "value_error",
            }],
        )

    # NOTE: order assignment is not safe under concurrent writes.
    # For PostgreSQL, consider SELECT ... FOR UPDATE or a serializable transaction.
    next_order = (db.scalar(select(func.max(Sequence.order)).where(Sequence.block_id == block_id)) or 0) + 1
    seq = Sequence(block_id=block_id, title=data.title, slug=slug, order=next_order)
    db.add(seq)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A sequence with the same auto-generated slug already exists in this block — choose a different title.",
        )
    db.refresh(seq)
    return seq


@router.get("/api/blocks/{block_id}/sequences", response_model=list[SequenceResponse])
def list_sequences(block_id: int, limit: int = 100, offset: int = 0, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    block = get_or_404(db, Block, block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    require_course_admin(db, user, version.course_id)
    sequences = db.execute(
        select(Sequence).where(Sequence.block_id == block_id).order_by(Sequence.order).offset(offset).limit(limit)
    ).scalars().all()
    return sequences


@router.patch("/api/sequences/{sequence_id}", response_model=SequenceResponse)
def update_sequence(sequence_id: int, data: SequenceUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    seq = get_or_404(db, Sequence, sequence_id)
    block = get_or_404(db, Block, seq.block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    state = version.state

    if state == "archived":
        raise HTTPException(status_code=409, detail="Cannot edit sequences in archived versions")

    updates = data.model_dump(exclude_unset=True)
    if state == "published":
        disallowed = set(updates.keys()) - _SEQUENCE_EDITABLE_PUBLISHED
        if disallowed:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot edit {disallowed} in published state",
            )

    for field, value in updates.items():
        setattr(seq, field, value)
    db.commit()
    db.refresh(seq)
    return seq


@router.delete("/api/sequences/{sequence_id}", status_code=204)
def delete_sequence(sequence_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    seq = get_or_404(db, Sequence, sequence_id)
    block = get_or_404(db, Block, seq.block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only delete sequences in 'created' state")
    from mathion.models import Item
    has_item = db.scalar(select(Item.id).where(Item.sequence_id == sequence_id).limit(1))
    if has_item is not None:
        raise HTTPException(status_code=409, detail="Cannot delete sequence: remove its items first")
    db.delete(seq)
    db.commit()


@router.post("/api/blocks/{block_id}/sequences/reorder")
def reorder_sequences(block_id: int, data: ReorderRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    block = get_or_404(db, Block, block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only reorder in 'created' state")

    incoming_ids = {e.id for e in data.order}
    incoming_orders = [e.order for e in data.order]
    if len(set(incoming_orders)) != len(incoming_orders):
        raise HTTPException(status_code=400, detail="Duplicate order values in request")
    real_ids = set(db.scalars(select(Sequence.id).where(Sequence.block_id == block_id)).all())
    if incoming_ids != real_ids:
        raise HTTPException(status_code=400, detail="Reorder list must include every sequence in this block")

    for entry in data.order:
        seq = db.get(Sequence, entry.id)
        seq.order = entry.order
    db.commit()
    return {"status": "ok"}
