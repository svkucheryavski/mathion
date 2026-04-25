import os

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, require_course_admin
from mathion.assets import get_mime_type, sanitize_filename, validate_extension
from mathion.config import settings
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Asset, AssetReference, CourseVersion
from mathion.models_auth import User
from mathion.schemas import AssetResponse

router = APIRouter(tags=["assets"])


def _asset_dir(version_id: int) -> str:
    return os.path.join(settings.asset_path, "courses", str(version_id))


@router.post("/api/versions/{version_id}/assets", status_code=201, response_model=AssetResponse)
def upload_asset(
    version_id: int,
    file: UploadFile,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = validate_extension(file.filename)
    if ext is None:
        raise HTTPException(status_code=400, detail=f"File extension not allowed: {file.filename}")

    content = file.file.read()
    if len(content) > settings.max_file_size:
        raise HTTPException(
            status_code=400,
            detail=f"File size {len(content)} exceeds max {settings.max_file_size}",
        )

    # Check total version size
    current_total = db.scalar(
        select(func.coalesce(func.sum(Asset.file_size), 0)).where(Asset.version_id == version_id)
    )
    if current_total + len(content) > settings.max_course_size:
        raise HTTPException(
            status_code=400,
            detail=f"Total version asset size would exceed limit ({settings.max_course_size} bytes)",
        )

    filename = sanitize_filename(file.filename)
    mime_type = get_mime_type(ext)

    asset = Asset(
        version_id=version_id,
        filename=filename,
        file_size=len(content),
        mime_type=mime_type,
        uploaded_by=user.id,
    )
    db.add(asset)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Asset '{filename}' already exists in this version")

    # Write file to disk
    dirpath = _asset_dir(version_id)
    os.makedirs(dirpath, exist_ok=True)
    filepath = os.path.join(dirpath, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    db.commit()
    db.refresh(asset)
    return asset


@router.get("/api/versions/{version_id}/assets", response_model=list[AssetResponse])
def list_assets(
    version_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)

    assets = db.execute(
        select(Asset).where(Asset.version_id == version_id).order_by(Asset.filename)
    ).scalars().all()

    # Annotate with reference status
    result = []
    for a in assets:
        ref_count = db.scalar(
            select(func.count()).where(AssetReference.asset_id == a.id)
        )
        resp = AssetResponse.model_validate(a)
        resp.is_referenced = ref_count > 0
        result.append(resp)
    return result
