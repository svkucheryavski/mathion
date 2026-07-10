import os
import shutil

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.config import settings
from mathion.models import Asset


def copy_version_assets(db: Session, src_version_id: int, dst_version_id: int, uploaded_by: int | None) -> None:
    """Copy every Asset row + on-disk file from src_version_id to dst_version_id.

    Preflights that every source file exists on disk BEFORE writing any row or
    file (raises HTTPException 500 if any is missing). Does NOT roll back the
    session — each caller owns rollback (create_version wraps this with its own
    rollback; the /duplicate endpoint wraps it in a broader try/except). Flushes
    the inserted Asset rows before returning.
    """
    source_assets = db.execute(
        select(Asset).where(Asset.version_id == src_version_id)
    ).scalars().all()
    if not source_assets:
        return

    source_dir = os.path.join(settings.asset_path, "courses", str(src_version_id))
    dest_dir = os.path.join(settings.asset_path, "courses", str(dst_version_id))
    missing = [
        a.filename for a in source_assets
        if not os.path.isfile(os.path.join(source_dir, a.filename))
    ]
    if missing:
        raise HTTPException(
            status_code=500,
            detail=f"Source asset files missing on disk: {', '.join(sorted(missing))}",
        )

    os.makedirs(dest_dir, exist_ok=True)
    for src_asset in source_assets:
        db.add(Asset(
            version_id=dst_version_id,
            filename=src_asset.filename,
            file_size=src_asset.file_size,
            mime_type=src_asset.mime_type,
            uploaded_by=uploaded_by,
        ))
        shutil.copy2(
            os.path.join(source_dir, src_asset.filename),
            os.path.join(dest_dir, src_asset.filename),
        )
    db.flush()
