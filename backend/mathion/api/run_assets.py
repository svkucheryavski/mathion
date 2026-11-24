import os
import shutil
import tempfile
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from pydantic import BaseModel

from mathion.api import advisory
from mathion.api.lookups import get_or_404
from mathion.api.authz import require_course_admin_for_run, require_run_admin_or_teacher
from mathion.api.asset_render import reference_new_run_asset, render_with_run_assets
from mathion.api.submission_files import run_asset_storage_dir
from mathion.assets import get_mime_type, sanitize_filename, validate_extension
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import (
    CourseAdmin, CourseVersion, MiniProject, Run, RunAsset, RunAssetReference, RunStudent, RunTeacher,
)
from mathion.models_auth import User
from mathion.schemas import RunAssetResponse
from mathion.site_settings import file_over_limit, load as load_site, total_over_limit

router = APIRouter(tags=["run-assets"])


def _row_gone(db: Session, run_id: int) -> HTTPException:
    """The asset row went while its file was written; a deleted run leaves no folder."""
    if db.get(Run, run_id) is None:
        shutil.rmtree(os.path.dirname(run_asset_storage_dir(run_id)), ignore_errors=True)
        return HTTPException(status_code=404, detail="Run not found")
    return HTTPException(status_code=404, detail="Asset not found")


def _responses(db: Session, assets: list[RunAsset]) -> list[RunAssetResponse]:
    """Response rows with usage and uploader email, one query for each."""
    ids = [a.id for a in assets]
    refs: dict[int, list[int]] = {}
    if ids:
        rows = db.execute(
            select(RunAssetReference.run_asset_id, RunAssetReference.mini_project_id)
            .where(RunAssetReference.run_asset_id.in_(ids))
            .distinct()
            .order_by(RunAssetReference.mini_project_id)
        )
        for asset_id, mp_id in rows:
            refs.setdefault(asset_id, []).append(mp_id)
    user_ids = {a.uploaded_by for a in assets if a.uploaded_by is not None}
    emails = dict(db.execute(select(User.id, User.email).where(User.id.in_(user_ids))).all()) if user_ids else {}
    out = []
    for a in assets:
        resp = RunAssetResponse.model_validate(a)
        resp.referenced_by = refs.get(a.id, [])
        resp.is_referenced = bool(resp.referenced_by)
        resp.uploaded_by_email = emails.get(a.uploaded_by)
        out.append(resp)
    return out


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

    site = load_site(db)
    content = file.file.read(site.max_file_bytes + 1)
    if len(content) > site.max_file_bytes:
        raise HTTPException(status_code=413, detail=file_over_limit(site))

    current_total = db.scalar(
        select(func.coalesce(func.sum(RunAsset.file_size), 0)).where(RunAsset.run_id == run_id)
    )
    if current_total + len(content) > site.max_total_bytes:
        raise HTTPException(status_code=413, detail=total_over_limit(site, "run"))

    filename = sanitize_filename(file.filename)
    # Lock before the insert, as delete_run and saves do, so usage reads settled text.
    mp_ids = list(db.scalars(
        select(MiniProject.id).where(MiniProject.run_id == run_id).order_by(MiniProject.id)
    ))
    for mp_id in mp_ids:
        advisory.advisory_xact_lock(db, advisory.LOCK_NS_MINIPROJECT, mp_id)
    advisory.interleave_hook("asset_upload_locked")
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
        get_or_404(db, Run, run_id)
        raise HTTPException(status_code=409, detail=f"Asset '{filename}' already exists in this run")
    new_id = asset.id
    reference_new_run_asset(db, asset, mp_ids)
    db.flush()  # rows before the file, so a failure leaves nothing on disk

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
    asset = db.get(RunAsset, new_id)
    if asset is None:
        raise _row_gone(db, run_id)
    return _responses(db, [asset])[0]


@router.put("/api/runs/{run_id}/assets/{asset_id}", response_model=RunAssetResponse)
def replace_run_asset(
    run_id: int,
    asset_id: int,
    file: UploadFile,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Replace the file content of an existing RunAsset.

    Preserves the row's filename so all RunAssetReference rows stay valid
    (the incoming file's name is intentionally ignored). Operation ordering
    guarantees no orphan temp file on any pre-rename failure:
    `get_or_404` -> ownership check -> extension match (case-insensitive)
    -> per-file size -> quota delta -> tempfile.mkstemp -> os.replace
    -> DB commit.
    """
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)

    asset = get_or_404(db, RunAsset, asset_id)
    if asset.run_id != run_id:
        raise HTTPException(status_code=404, detail="Asset not found in this run")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    incoming_ext = validate_extension(file.filename)
    if incoming_ext is None:
        raise HTTPException(
            status_code=400, detail=f"File extension not allowed: {file.filename}"
        )

    existing_ext = (
        asset.filename.rsplit(".", 1)[-1].lower() if "." in asset.filename else ""
    )
    if incoming_ext != existing_ext:
        raise HTTPException(
            status_code=422,
            detail=f"Extension must match the existing asset's extension ({existing_ext}).",
        )

    site = load_site(db)
    content = file.file.read(site.max_file_bytes + 1)
    if len(content) > site.max_file_bytes:
        raise HTTPException(status_code=413, detail=file_over_limit(site))

    size_delta = len(content) - asset.file_size
    if size_delta > 0:
        current_total = db.scalar(
            select(func.coalesce(func.sum(RunAsset.file_size), 0)).where(
                RunAsset.run_id == run_id
            )
        )
        if (current_total or 0) + size_delta > site.max_total_bytes:
            raise HTTPException(status_code=413, detail=total_over_limit(site, "run"))

    dirpath = run_asset_storage_dir(run_id)
    filepath = os.path.join(dirpath, asset.filename)
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
        raise HTTPException(status_code=500, detail="Failed to write asset file")

    asset.file_size = len(content)
    asset.mime_type = get_mime_type(incoming_ext)
    asset.uploaded_at = datetime.now(timezone.utc)
    asset.uploaded_by = user.id
    try:
        db.commit()
    except StaleDataError:
        db.rollback()
        raise _row_gone(db, run_id)
    asset = db.get(RunAsset, asset_id)
    if asset is None:
        raise _row_gone(db, run_id)
    return _responses(db, [asset])[0]


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
    return _responses(db, list(assets))


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
    return FileResponse(
        filepath,
        media_type=asset.mime_type,
        filename=filename,
        content_disposition_type="inline",
        headers={"X-Content-Type-Options": "nosniff"},  # Polish 3 C12
    )


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
    `render_with_run_assets` validates each against the run's RunAsset pool and points
    those image and link targets at `/api/runs/{run_id}/assets/{filename}`.
    Side-effect-free: SELECTs only; no RunAssetReference rows are written here
    (sync_run_asset_references runs only on PATCH/POST of mini-projects).
    422 raised internally by render_with_run_assets when any referenced asset
    is not in the run pool (asset_render.render_with_run_assets).

    Gating: matches the rest of this router — `require_run_admin_or_teacher` is
    a plain helper function (authz.py), NOT a FastAPI dependency; called
    imperatively after loading the run.
    """
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    html = render_with_run_assets(db, run_id, body.content_md)
    return RunRenderResponse(html=html)
