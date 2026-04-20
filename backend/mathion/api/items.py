from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.database import get_db
from mathion.models import Block, CourseVersion, Item, Sequence
from mathion.schemas import ItemCreate, ItemResponse

router = APIRouter(tags=["items"])


def _get_version_for_sequence(db: Session, sequence_id: int) -> CourseVersion:
    seq = db.get(Sequence, sequence_id)
    if not seq:
        raise HTTPException(status_code=404, detail="Sequence not found")
    block = db.get(Block, seq.block_id)
    return db.get(CourseVersion, block.version_id)


@router.post("/api/sequences/{sequence_id}/items", status_code=201, response_model=ItemResponse)
def create_item(sequence_id: int, data: ItemCreate, db: Session = Depends(get_db)):
    version = _get_version_for_sequence(db, sequence_id)
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only add items to versions in 'created' state")
    next_order = (db.scalar(select(func.max(Item.order)).where(Item.sequence_id == sequence_id)) or 0) + 1
    item = Item(
        sequence_id=sequence_id, title=data.title, slug=data.slug, order=next_order,
        type=data.type, content_md=data.content_md, content_html="",
        video_url=data.video_url, script_url=data.script_url,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/api/sequences/{sequence_id}/items", response_model=list[ItemResponse])
def list_items(sequence_id: int, db: Session = Depends(get_db)):
    items = db.execute(select(Item).where(Item.sequence_id == sequence_id).order_by(Item.order)).scalars().all()
    return items
