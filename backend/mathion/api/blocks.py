from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.database import get_db
from mathion.models import Block, CourseVersion, Sequence
from mathion.schemas import BlockCreate, BlockResponse, SequenceCreate, SequenceResponse

router = APIRouter(tags=["blocks"])

MAX_BLOCKS = 8
MAX_SEQUENCES = 8


@router.post("/api/versions/{version_id}/blocks", status_code=201, response_model=BlockResponse)
def create_block(version_id: int, data: BlockCreate, db: Session = Depends(get_db)):
    version = db.get(CourseVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only add blocks to versions in 'created' state")
    count = db.scalar(select(func.count()).where(Block.version_id == version_id))
    if count >= MAX_BLOCKS:
        raise HTTPException(status_code=409, detail=f"Maximum {MAX_BLOCKS} blocks per version")
    next_order = (db.scalar(select(func.max(Block.order)).where(Block.version_id == version_id)) or 0) + 1
    block = Block(version_id=version_id, title=data.title, slug=data.slug, order=next_order, info=data.info)
    db.add(block)
    db.commit()
    db.refresh(block)
    return block


@router.get("/api/versions/{version_id}/blocks", response_model=list[BlockResponse])
def list_blocks(version_id: int, db: Session = Depends(get_db)):
    blocks = db.execute(select(Block).where(Block.version_id == version_id).order_by(Block.order)).scalars().all()
    return blocks


@router.post("/api/blocks/{block_id}/sequences", status_code=201, response_model=SequenceResponse)
def create_sequence(block_id: int, data: SequenceCreate, db: Session = Depends(get_db)):
    block = db.get(Block, block_id)
    if not block:
        raise HTTPException(status_code=404, detail="Block not found")
    version = db.get(CourseVersion, block.version_id)
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only add sequences to versions in 'created' state")
    count = db.scalar(select(func.count()).where(Sequence.block_id == block_id))
    if count >= MAX_SEQUENCES:
        raise HTTPException(status_code=409, detail=f"Maximum {MAX_SEQUENCES} sequences per block")
    next_order = (db.scalar(select(func.max(Sequence.order)).where(Sequence.block_id == block_id)) or 0) + 1
    seq = Sequence(block_id=block_id, title=data.title, slug=data.slug, order=next_order)
    db.add(seq)
    db.commit()
    db.refresh(seq)
    return seq


@router.get("/api/blocks/{block_id}/sequences", response_model=list[SequenceResponse])
def list_sequences(block_id: int, db: Session = Depends(get_db)):
    sequences = db.execute(select(Sequence).where(Sequence.block_id == block_id).order_by(Sequence.order)).scalars().all()
    return sequences
