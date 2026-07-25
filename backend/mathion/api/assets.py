import os
import tempfile

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.lookups import get_or_404
from mathion.api.authz import has_run_pinned_to_version, require_course_admin
from mathion.assets import get_mime_type, sanitize_filename, validate_extension
from mathion.config import settings
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Asset, AssetReference, CourseAdmin, CourseVersion
from mathion.models_auth import StudentEnrollment, User
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
    if not content.strip():
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

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
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Asset '{filename}' already exists in this version")

    # Registry committed; now write file via temp+rename for atomicity.
    # On any disk failure, roll back the registry row to avoid orphans.
    dirpath = _asset_dir(version_id)
    filepath = os.path.join(dirpath, filename)
    tmp_path: str | None = None
    try:
        os.makedirs(dirpath, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=dirpath, prefix=".upload-", suffix=".tmp")
        with os.fdopen(fd, "wb") as f:
            f.write(content)
        os.replace(tmp_path, filepath)
        tmp_path = None
    except Exception:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        db.delete(asset)
        db.commit()
        raise HTTPException(status_code=500, detail="Failed to write asset to disk")

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


@router.get("/assets/{version_id}/{filename}")
def serve_asset(
    version_id: int,
    filename: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    version = get_or_404(db, CourseVersion, version_id)

    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")

    if not user.is_superuser:
        is_admin = db.execute(
            select(CourseAdmin).where(
                CourseAdmin.course_id == version.course_id,
                CourseAdmin.user_id == user.id,
            )
        ).scalar_one_or_none()
        if not is_admin:
            is_enrolled = db.execute(
                select(StudentEnrollment).where(
                    StudentEnrollment.version_id == version_id,
                    StudentEnrollment.user_id == user.id,
                    StudentEnrollment.is_active == True,  # noqa: E712
                )
            ).scalar_one_or_none()
            if not is_enrolled:
                # 4th branch (spec §3.1.3a): allow run-teachers pinned to this
                # exact version. Reached only after admin/enrolment checks fail
                # — never used as a write-path gate.
                if not has_run_pinned_to_version(db, user, version_id):
                    raise HTTPException(status_code=403, detail="No access to this version")

    asset = db.execute(
        select(Asset).where(
            Asset.version_id == version_id,
            Asset.filename == filename,
        )
    ).scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    dirpath = _asset_dir(version_id)
    filepath = os.path.join(dirpath, filename)
    # Defense in depth: ensure the resolved path stays inside the version's
    # asset directory. Sanitization at upload already enforces this, but a
    # belt-and-suspenders check costs one realpath call and prevents arbitrary
    # file read if any future codepath persists a non-sanitized filename.
    real_dir = os.path.realpath(dirpath)
    real_path = os.path.realpath(filepath)
    if os.path.commonpath([real_dir, real_path]) != real_dir:
        raise HTTPException(status_code=404, detail="Asset not found")
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Asset file missing")

    return FileResponse(filepath, media_type=asset.mime_type, filename=filename)


@router.delete("/api/assets/{asset_id}", status_code=204)
def delete_asset(
    asset_id: int,
    force: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    asset = get_or_404(db, Asset, asset_id)
    version = get_or_404(db, CourseVersion, asset.version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")

    if not force:
        ref_count = db.scalar(
            select(func.count()).where(AssetReference.asset_id == asset_id)
        )
        if ref_count > 0:
            raise HTTPException(
                status_code=409,
                detail=f"Asset '{asset.filename}' is referenced by {ref_count} item(s). Use ?force=true to delete.",
            )

    filepath = os.path.join(_asset_dir(asset.version_id), asset.filename)
    db.delete(asset)
    db.commit()
    # Registry is the source of truth: a leftover file is harmless and
    # can be reaped by ops; a row pointing to a missing file is worse.
    if os.path.isfile(filepath):
        try:
            os.remove(filepath)
        except OSError:
            pass
