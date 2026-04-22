from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, require_course_admin
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Block, CourseVersion, Sequence
from mathion.models_auth import User
from mathion.schemas import (
    BlockCreate,
    BlockResponse,
    BlockUpdate,
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
    # NOTE: order assignment is not safe under concurrent writes.
    # For PostgreSQL, consider SELECT ... FOR UPDATE or a serializable transaction.
    next_order = (db.scalar(select(func.max(Block.order)).where(Block.version_id == version_id)) or 0) + 1
    block = Block(version_id=version_id, title=data.title, slug=data.slug, order=next_order, info=data.info)
    db.add(block)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A block with this slug already exists in this version")
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

    for field, value in updates.items():
        setattr(block, field, value)
    db.commit()
    db.refresh(block)
    return block


@router.delete("/api/blocks/{block_id}", status_code=204)
def delete_block(block_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    block = get_or_404(db, Block, block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    state = version.state
    if state != "created":
        raise HTTPException(status_code=409, detail="Can only delete blocks in 'created' state")
    db.delete(block)
    db.commit()


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
    # NOTE: order assignment is not safe under concurrent writes.
    # For PostgreSQL, consider SELECT ... FOR UPDATE or a serializable transaction.
    next_order = (db.scalar(select(func.max(Sequence.order)).where(Sequence.block_id == block_id)) or 0) + 1
    seq = Sequence(block_id=block_id, title=data.title, slug=data.slug, order=next_order)
    db.add(seq)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A sequence with this slug already exists in this block")
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
    state = version.state
    if state != "created":
        raise HTTPException(status_code=409, detail="Can only delete sequences in 'created' state")
    db.delete(seq)
    db.commit()
