import os
import tempfile

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from pydantic import BaseModel

from mathion.api.helpers import (
    get_or_404,
    render_with_run_assets,
    require_course_admin_for_run,
    require_run_admin_or_teacher,
    run_asset_storage_dir,
)
from mathion.assets import get_mime_type, sanitize_filename, validate_extension
from mathion.config import settings
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import CourseAdmin, CourseVersion, Run, RunAsset, RunAssetReference, RunStudent, RunTeacher
from mathion.models_auth import User
from mathion.schemas import RunAssetResponse

router = APIRouter(tags=["run-assets"])


@router.post("/api/runs/{run_id}/assets", status_code=201, response_model=RunAssetResponse)
def upload_run_asset(
    run_id: int,
    file: UploadFile,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    ext = validate_extension(file.filename)
    if ext is None:
        raise HTTPException(status_code=400, detail=f"File extension not allowed: {file.filename}")

    content = file.file.read(settings.max_file_size + 1)
    if len(content) > settings.max_file_size:
        raise HTTPException(
            status_code=400,
            detail=f"File size {len(content)} exceeds max {settings.max_file_size}",
        )

    current_total = db.scalar(
        select(func.coalesce(func.sum(RunAsset.file_size), 0)).where(RunAsset.run_id == run_id)
    )
    if current_total + len(content) > settings.max_course_size:
        raise HTTPException(
            status_code=400,
            detail=f"Total run asset size would exceed limit ({settings.max_course_size} bytes)",
        )

    filename = sanitize_filename(file.filename)
    asset = RunAsset(
        run_id=run_id,
        filename=filename,
        file_size=len(content),
        mime_type=get_mime_type(ext),
        uploaded_by=user.id,
    )
    db.add(asset)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Asset '{filename}' already exists in this run")

    # Write file via temp+rename for atomicity
    dirpath = run_asset_storage_dir(run_id)
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
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to write asset file")

    db.commit()
    db.refresh(asset)
    resp = RunAssetResponse.model_validate(asset)
    resp.is_referenced = False
    resp.uploaded_by_email = (
        db.scalar(select(User.email).where(User.id == asset.uploaded_by))
        if asset.uploaded_by is not None
        else None
    )
    return resp


@router.get("/api/runs/{run_id}/assets", response_model=list[RunAssetResponse])
def list_run_assets(
    run_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)

    assets = db.execute(
        select(RunAsset).where(RunAsset.run_id == run_id).order_by(RunAsset.filename)
    ).scalars().all()
    result = []
    for a in assets:
        ref_count = db.scalar(
            select(func.count()).where(RunAssetReference.run_asset_id == a.id)
        )
        resp = RunAssetResponse.model_validate(a)
        resp.is_referenced = ref_count > 0
        resp.uploaded_by_email = (
            db.scalar(select(User.email).where(User.id == a.uploaded_by))
            if a.uploaded_by is not None
            else None
        )
        result.append(resp)
    return result


@router.get("/api/runs/{run_id}/assets/{filename}")
def serve_run_asset(
    run_id: int,
    filename: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = get_or_404(db, Run, run_id)
    version = db.get(CourseVersion, run.version_id)
    # Admin or teacher always allowed; student access requires run published.
    # (Phase 7b: per-mini-project visibility check is at the higher endpoint level;
    # for raw asset serve we use a coarse run.is_published check here.)
    if not user.is_superuser:
        is_admin = db.execute(
            select(CourseAdmin).where(
                CourseAdmin.course_id == version.course_id,
                CourseAdmin.user_id == user.id,
            )
        ).scalar_one_or_none() is not None
        is_teacher = db.execute(
            select(RunTeacher).where(
                RunTeacher.run_id == run_id,
                RunTeacher.user_id == user.id,
            )
        ).scalar_one_or_none() is not None
        if not (is_admin or is_teacher):
            # Student path
            if not run.is_published:
                raise HTTPException(status_code=403, detail="Run not visible")
            is_enrolled = db.execute(
                select(RunStudent).where(
                    RunStudent.run_id == run_id,
                    RunStudent.user_id == user.id,
                )
            ).scalar_one_or_none() is not None
            if not is_enrolled:
                raise HTTPException(status_code=403, detail="Not enrolled in this run")

    asset = db.execute(
        select(RunAsset).where(RunAsset.run_id == run_id, RunAsset.filename == filename)
    ).scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    dirpath = run_asset_storage_dir(run_id)
    filepath = os.path.join(dirpath, filename)
    real_dir = os.path.realpath(dirpath)
    real_path = os.path.realpath(filepath)
    if os.path.commonpath([real_dir, real_path]) != real_dir:
        raise HTTPException(status_code=404, detail="Asset not found")
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Asset file missing")
    return FileResponse(filepath, media_type=asset.mime_type, filename=filename)


@router.delete("/api/runs/{run_id}/assets/{asset_id}", status_code=204)
def delete_run_asset(
    run_id: int,
    asset_id: int,
    force: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    if force:
        require_course_admin_for_run(db, user, run)
    asset = get_or_404(db, RunAsset, asset_id)
    if asset.run_id != run_id:
        raise HTTPException(status_code=404, detail="Asset not found in this run")

    if not force:
        ref_count = db.scalar(
            select(func.count()).where(RunAssetReference.run_asset_id == asset_id)
        )
        if ref_count > 0:
            raise HTTPException(
                status_code=409,
                detail=f"Asset '{asset.filename}' is referenced by {ref_count} mini-project(s). Use ?force=true to delete.",
            )

    filepath = os.path.join(run_asset_storage_dir(run_id), asset.filename)
    db.delete(asset)
    db.commit()
    if os.path.isfile(filepath):
        try:
            os.remove(filepath)
        except OSError:
            pass


class RunRenderRequest(BaseModel):
    content_md: str


class RunRenderResponse(BaseModel):
    html: str


@router.post("/api/runs/{run_id}/render", response_model=RunRenderResponse)
def render_run_markdown(
    run_id: int,
    body: RunRenderRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Render markdown with bare-filename asset refs resolved against this run's asset pool.

    Convention is `![alt](filename.png)` (markdown.py:52-68 extracts non-URL refs);
    `render_with_run_assets` validates each against the run's RunAsset pool and rewrites
    `src="{filename}"` / `href="{filename}"` to `/api/runs/{run_id}/assets/{filename}`.
    Side-effect-free: SELECTs only; no RunAssetReference rows are written here
    (sync_run_asset_references runs only on PATCH/POST of mini-projects).
    422 raised internally by render_with_run_assets when any referenced asset
    is not in the run pool (helpers.py:448-450).

    Gating: matches the rest of this router — `require_run_admin_or_teacher` is
    a plain helper function (helpers.py:105), NOT a FastAPI dependency; called
    imperatively after loading the run.
    """
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    html = render_with_run_assets(db, run_id, body.content_md)
    return RunRenderResponse(html=html)
