from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, require_course_admin
from mathion.markdown import extract_asset_filenames, render_markdown, resolve_asset_urls
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Asset, AssetReference, Block, CourseVersion, Item, Sequence
from mathion.models_auth import User
from mathion.schemas import ItemCreate, ItemResponse, ItemUpdate, ReorderRequest

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


def _process_content_md(db: Session, version: CourseVersion, item_id: int, content_md: str | None) -> str:
    """Render markdown, validate asset refs, resolve URLs, sync AssetReference rows."""
    if not content_md:
        db.execute(sa_delete(AssetReference).where(AssetReference.item_id == item_id))
        return render_markdown(content_md)

    html = render_markdown(content_md)
    ref_filenames = extract_asset_filenames(content_md)
    if not ref_filenames:
        db.execute(sa_delete(AssetReference).where(AssetReference.item_id == item_id))
        return html

    existing = db.execute(
        select(Asset).where(
            Asset.version_id == version.id,
            Asset.filename.in_(ref_filenames),
        )
    ).scalars().all()
    existing_map = {a.filename: a for a in existing}
    missing = ref_filenames - set(existing_map.keys())
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Referenced assets not found in version: {', '.join(sorted(missing))}",
        )

    html = resolve_asset_urls(html, version.id, ref_filenames)
    db.execute(sa_delete(AssetReference).where(AssetReference.item_id == item_id))
    for asset in existing_map.values():
        db.add(AssetReference(asset_id=asset.id, item_id=item_id))
    return html


@router.post("/api/sequences/{sequence_id}/items", status_code=201, response_model=ItemResponse)
def create_item(sequence_id: int, data: ItemCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = _get_version_for_sequence(db, sequence_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only add items to versions in 'created' state")
    # NOTE: order assignment is not safe under concurrent writes.
    # For PostgreSQL, consider SELECT ... FOR UPDATE or a serializable transaction.
    next_order = (db.scalar(select(func.max(Item.order)).where(Item.sequence_id == sequence_id)) or 0) + 1
    item = Item(
        sequence_id=sequence_id, title=data.title, slug=data.slug, order=next_order,
        type=data.type, content_md=data.content_md, content_html="",
        video_url=data.video_url, script_url=data.script_url,
    )
    db.add(item)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An item with this slug already exists in this sequence")
    item.content_html = _process_content_md(db, version, item.id, data.content_md)
    db.commit()
    db.refresh(item)
    return item


@router.get("/api/sequences/{sequence_id}/items", response_model=list[ItemResponse])
def list_items(sequence_id: int, limit: int = 100, offset: int = 0, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = _get_version_for_sequence(db, sequence_id)
    require_course_admin(db, user, version.course_id)
    items = db.execute(
        select(Item).where(Item.sequence_id == sequence_id).order_by(Item.order).offset(offset).limit(limit)
    ).scalars().all()
    return items


@router.patch("/api/items/{item_id}", response_model=ItemResponse)
def update_item(item_id: int, data: ItemUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = get_or_404(db, Item, item_id)
    version = _get_version_for_item(db, item)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")

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

    if "content_md" in updates:
        item.content_html = _process_content_md(db, version, item.id, item.content_md)

    # Validate type invariants after applying patch
    if item.type == "static_page" and item.content_md is None:
        raise HTTPException(status_code=422, detail="content_md cannot be null for static_page items")
    if item.type == "video" and item.video_url is None:
        raise HTTPException(status_code=422, detail="video_url cannot be null for video items")
    if item.type == "interactive_app" and item.script_url is None:
        raise HTTPException(status_code=422, detail="script_url cannot be null for interactive_app items")

    db.commit()
    db.refresh(item)
    return item


@router.delete("/api/items/{item_id}", status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = get_or_404(db, Item, item_id)
    version = _get_version_for_item(db, item)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only delete items in 'created' state")
    db.delete(item)
    db.commit()


@router.post("/api/sequences/{sequence_id}/items/reorder")
def reorder_items(sequence_id: int, data: ReorderRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = _get_version_for_sequence(db, sequence_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only reorder in 'created' state")

    incoming_ids = {e.id for e in data.order}
    incoming_orders = [e.order for e in data.order]
    if len(set(incoming_orders)) != len(incoming_orders):
        raise HTTPException(status_code=400, detail="Duplicate order values in request")
    real_ids = set(db.scalars(select(Item.id).where(Item.sequence_id == sequence_id)).all())
    if incoming_ids != real_ids:
        raise HTTPException(status_code=400, detail="Reorder list must include every item in this sequence")

    for entry in data.order:
        item = db.get(Item, entry.id)
        item.order = entry.order
    db.commit()
    return {"status": "ok"}
