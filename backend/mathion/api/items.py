from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404
from mathion.database import get_db
from mathion.models import Block, CourseVersion, Item, Sequence
from mathion.schemas import ItemCreate, ItemResponse, ItemUpdate

router = APIRouter(tags=["items"])

# Text/content fields editable in published state
_ITEM_EDITABLE_PUBLISHED = {"title", "content_md", "video_url", "script_url"}


def _get_version_for_sequence(db: Session, sequence_id: int) -> CourseVersion:
    seq = get_or_404(db, Sequence, sequence_id)
    block = get_or_404(db, Block, seq.block_id)
    return get_or_404(db, CourseVersion, block.version_id)


def _get_version_for_item(db: Session, item: Item) -> CourseVersion:
    seq = get_or_404(db, Sequence, item.sequence_id)
    block = get_or_404(db, Block, seq.block_id)
    return get_or_404(db, CourseVersion, block.version_id)


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
def list_items(sequence_id: int, limit: int = 100, offset: int = 0, db: Session = Depends(get_db)):
    get_or_404(db, Sequence, sequence_id)
    items = db.execute(
        select(Item).where(Item.sequence_id == sequence_id).order_by(Item.order).offset(offset).limit(limit)
    ).scalars().all()
    return items


@router.patch("/api/items/{item_id}", response_model=ItemResponse)
def update_item(item_id: int, data: ItemUpdate, db: Session = Depends(get_db)):
    item = get_or_404(db, Item, item_id)
    version = _get_version_for_item(db, item)

    if version.state == "archived":
        raise HTTPException(status_code=409, detail="Cannot edit items in archived versions")

    updates = data.model_dump(exclude_unset=True)
    if version.state == "published":
        disallowed = set(updates.keys()) - _ITEM_EDITABLE_PUBLISHED
        if disallowed:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot edit {disallowed} in published state",
            )

    for field, value in updates.items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/api/items/{item_id}", status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db)):
    item = get_or_404(db, Item, item_id)
    version = _get_version_for_item(db, item)
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only delete items in 'created' state")
    db.delete(item)
    db.commit()
