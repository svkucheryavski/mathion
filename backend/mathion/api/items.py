import os
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.text_utils import bump_content_updated_at, slugify
from mathion.api.lookups import INT4_MAX, get_or_404
from mathion.api.authz import require_course_admin
from mathion.api.asset_render import render_with_assets, sync_asset_references, sync_script_reference
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Block, CourseVersion, Item, Sequence
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
    """Render markdown with asset resolution and sync AssetReference rows for the item."""
    html = render_with_assets(db, version.id, content_md)
    sync_asset_references(db, version.id, [content_md], {"item_id": item_id})
    return html


@router.post("/api/sequences/{sequence_id}/items", status_code=201, response_model=ItemResponse)
def create_item(sequence_id: int, data: ItemCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = _get_version_for_sequence(db, sequence_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only add items to versions in 'created' state")

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
    current_max_order = db.scalar(select(func.max(Item.order)).where(Item.sequence_id == sequence_id)) or 0
    if current_max_order >= INT4_MAX:
        raise HTTPException(
            status_code=409,
            detail="Cannot add another item: the order sequence is exhausted.",
        )
    next_order = current_max_order + 1
    item = Item(
        sequence_id=sequence_id, title=data.title, slug=slug, order=next_order,
        type=data.type, content_md=data.content_md, content_html="",
        video_url=data.video_url, script_url=data.script_url,
    )
    db.add(item)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="An item with the same auto-generated slug already exists in this sequence — choose a different title.",
        )
    item.content_html = _process_content_md(db, version, item.id, data.content_md)
    bump_content_updated_at(version)
    db.commit()
    db.refresh(item)
    return item


@router.get("/api/sequences/{sequence_id}/items", response_model=list[ItemResponse])
def list_items(sequence_id: int, limit: int = 100, offset: int = 0, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = _get_version_for_sequence(db, sequence_id)
    require_course_admin(db, user, version.course_id)
    items = db.execute(
        select(Item).where(Item.sequence_id == sequence_id).order_by(Item.order, Item.id).offset(offset).limit(limit)
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

    stored_title = item.title

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

    if "script_url" in updates and item.type != "interactive_app" and updates["script_url"] is not None:
        raise HTTPException(
            status_code=422,
            detail="script_url can only be set on interactive_app items",
        )

    # interactive_app has no markdown surface. Reject content_md by KEY PRESENCE
    # (not value): even content_md=null would otherwise reach _process_content_md,
    # whose sync_asset_references deletes ALL of the item's AssetReferences —
    # wiping the attached script's reference. Forbidding the key outright keeps an
    # interactive_app item's only asset reference its uploaded script, so the
    # script-asset GC in sync_script_reference can never wipe/delete a
    # markdown-referenced asset.
    if item.type == "interactive_app" and "content_md" in updates:
        raise HTTPException(
            status_code=422,
            detail="content_md cannot be set on interactive_app items",
        )

    for field, value in updates.items():
        setattr(item, field, value)

    # If slug changed, flush now so the uq_item_sequence_slug constraint
    # fires deterministically *here* — before _process_content_md runs
    # render_with_assets / sync_asset_references, both of which issue
    # db.execute(...) queries that would autoflush the pending slug write
    # and surface the IntegrityError outside our try/except.
    if "slug" in updates:
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail="An item with the same auto-generated slug already exists in this sequence — choose a different title.",
            )

    if "content_md" in updates:
        # _process_content_md calls render_with_assets, which raises 422
        # if content_md references an asset that doesn't exist in this
        # version. After the earlier explicit db.flush() (when slug
        # changed), pending mutations are already in the session — if
        # render_with_assets raises here, those pending mutations would
        # be left in the test session (production get_db() rolls back
        # on close, but tests share the session). Rollback before
        # re-raising so the slug/title write doesn't leak.
        try:
            item.content_html = _process_content_md(db, version, item.id, item.content_md)
        except HTTPException:
            db.rollback()
            raise
        bump_content_updated_at(version)

    # Validate type invariants after applying patch.
    #
    # When slug changed earlier, we explicitly db.flush()ed so the
    # IntegrityError surfaced inside our 409 wrapper. That flush also
    # committed any other pending mutations (new title, new content_html,
    # etc.) to the session. The production get_db() rolls back on close,
    # but tests use a session override that does NOT rollback per-request
    # — and even in production it is more conservative to explicitly
    # rollback before any post-flush 422 so the partially-applied state
    # never has a chance to be observed.
    removed_script_files: list[str] = []
    if item.type == "interactive_app" and "script_url" in updates:
        filename = updates["script_url"]
        if filename is not None and (
            not re.fullmatch(r"[a-z0-9][a-z0-9.-]*\.js", filename) or ".." in filename
        ):
            db.rollback()
            raise HTTPException(
                status_code=422,
                detail="script_url must be the filename of an uploaded .js asset",
            )
        try:
            removed_script_files = sync_script_reference(db, version.id, item.id, filename)
        except HTTPException:
            db.rollback()
            raise

    if item.type == "static_page" and item.content_md is None:
        db.rollback()
        raise HTTPException(status_code=422, detail="content_md cannot be null for static_page items")
    if item.type == "video" and item.video_url is None:
        db.rollback()
        raise HTTPException(status_code=422, detail="video_url cannot be null for video items")

    db.commit()
    db.refresh(item)
    # Unlink GC'd interactive_app script files after the DB commit — best-effort,
    # mirroring delete_asset (a leftover file is harmless; a row without its file
    # is worse). The rows were deleted inside the committed transaction above.
    for path in removed_script_files:
        if os.path.isfile(path):
            try:
                os.remove(path)
            except OSError:
                pass
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
    # interactive_app JS is item-owned: clear the script reference and GC the
    # now-unreferenced backing asset (row now, file after commit) before deleting
    # the item, so its filename is freed for re-upload. Reuses the same
    # ref_count==0-guarded path as Remove/Replace. Non-interactive items keep
    # their (reusable) markdown assets — only the reference cascades away.
    removed_script_files: list[str] = []
    if item.type == "interactive_app":
        removed_script_files = sync_script_reference(db, version.id, item.id, None)
    db.delete(item)
    db.commit()
    for path in removed_script_files:
        if os.path.isfile(path):
            try:
                os.remove(path)
            except OSError:
                pass


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
