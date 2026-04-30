import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.api.helpers import (
    get_or_404,
    mini_project_visible_to_student,
    render_with_run_assets,
    require_course_admin,
    require_run_admin_or_teacher,
    submission_storage_dir,
    sync_run_asset_references,
)
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import (
    Block,
    CourseVersion,
    Evaluation,
    MiniProject,
    Run,
    RunAssetReference,
    Submission,
)
from mathion.models_auth import User
from mathion.schemas import MiniProjectCreate, MiniProjectResponse, MiniProjectUpdate


def _to_utc_aware(dt: datetime | None) -> datetime | None:
    """Normalize a datetime read from the DB (which may be tz-naive on SQLite
    or tz-aware on Postgres) to a tz-aware UTC datetime for safe comparisons."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

router = APIRouter(tags=["mini-projects"])


def _serialize_mini_project(db: Session, mp: MiniProject) -> dict:
    """Return mini-project response dict with derived `title`."""
    block = db.get(Block, mp.block_id)
    return {
        "id": mp.id,
        "run_id": mp.run_id,
        "block_id": mp.block_id,
        "title": f"Mini project for Block {block.order}",
        "assignment_md": mp.assignment_md,
        "assignment_html": mp.assignment_html,
        "soft_deadline": mp.soft_deadline,
        "hard_deadline": mp.hard_deadline,
        "resubmission_deadline": mp.resubmission_deadline,
        "is_published": mp.is_published,
        "first_submitted_at": mp.first_submitted_at,
        "created_at": mp.created_at,
        "updated_at": mp.updated_at,
    }


def _is_admin_or_teacher(db: Session, user: User, run: Run) -> bool:
    """Return True if user is course admin of run.course OR run teacher OR superuser."""
    from mathion.models import CourseAdmin, RunTeacher

    if user.is_superuser:
        return True
    version = db.get(CourseVersion, run.version_id)
    is_admin = db.execute(
        select(CourseAdmin).where(
            CourseAdmin.course_id == version.course_id,
            CourseAdmin.user_id == user.id,
        )
    ).scalar_one_or_none() is not None
    if is_admin:
        return True
    is_teacher = db.execute(
        select(RunTeacher).where(
            RunTeacher.run_id == run.id,
            RunTeacher.user_id == user.id,
        )
    ).scalar_one_or_none() is not None
    return is_teacher


@router.post("/api/runs/{run_id}/mini-projects", status_code=201, response_model=MiniProjectResponse)
def create_mini_project(
    run_id: int,
    data: MiniProjectCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    if not run.groups_enabled:
        raise HTTPException(status_code=409, detail="Run must have groups_enabled to host mini-projects")

    block = get_or_404(db, Block, data.block_id)
    if block.version_id != run.version_id:
        raise HTTPException(status_code=400, detail="Block does not belong to this run's course version")

    # UNIQUE(run_id, block_id) — pre-check for clean error
    exists = db.execute(
        select(MiniProject).where(
            MiniProject.run_id == run_id,
            MiniProject.block_id == data.block_id,
        )
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Mini-project already exists for this block")

    assignment_html = render_with_run_assets(db, run_id, data.assignment_md)
    mp = MiniProject(
        run_id=run_id,
        block_id=data.block_id,
        assignment_md=data.assignment_md,
        assignment_html=assignment_html,
        soft_deadline=data.soft_deadline,
        hard_deadline=data.hard_deadline,
        resubmission_deadline=data.resubmission_deadline,
        is_published=False,
    )
    db.add(mp)
    db.flush()
    sync_run_asset_references(db, run_id, data.assignment_md, mp.id)
    db.commit()
    db.refresh(mp)
    return _serialize_mini_project(db, mp)


@router.get("/api/runs/{run_id}/mini-projects", response_model=list[MiniProjectResponse])
def list_mini_projects(
    run_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    is_priv = _is_admin_or_teacher(db, user, run)

    mps = db.execute(
        select(MiniProject).where(MiniProject.run_id == run_id).order_by(MiniProject.block_id)
    ).scalars().all()
    if not is_priv:
        mps = [mp for mp in mps if mini_project_visible_to_student(run, mp)]
    return [_serialize_mini_project(db, mp) for mp in mps]


@router.get("/api/mini-projects/{mp_id}", response_model=MiniProjectResponse)
def get_mini_project(
    mp_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mp = get_or_404(db, MiniProject, mp_id)
    run = db.get(Run, mp.run_id)
    is_priv = _is_admin_or_teacher(db, user, run)

    if not is_priv and not mini_project_visible_to_student(run, mp):
        raise HTTPException(status_code=403, detail="Mini-project not visible")
    return _serialize_mini_project(db, mp)


@router.patch("/api/mini-projects/{mp_id}", response_model=MiniProjectResponse)
def patch_mini_project(
    mp_id: int,
    data: MiniProjectUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mp = get_or_404(db, MiniProject, mp_id)
    run = get_or_404(db, Run, mp.run_id)
    require_run_admin_or_teacher(db, user, run)

    locked = mp.first_submitted_at is not None
    updates = data.model_dump(exclude_unset=True)
    violations = []
    if locked:
        if "assignment_md" in updates:
            violations.append("assignment_md is locked")
        for field in ("soft_deadline", "hard_deadline", "resubmission_deadline"):
            if field in updates:
                old = _to_utc_aware(getattr(mp, field))
                new = _to_utc_aware(updates[field])
                # Allow NULL → non-NULL transition (only meaningful for soft_deadline)
                if old is not None and new is not None and new <= old:
                    violations.append(f"{field} can only be extended (new must be > old)")
                if old is not None and new is None:
                    violations.append(f"{field} cannot be set to NULL once locked")
    if violations:
        raise HTTPException(status_code=409, detail="; ".join(violations))

    soft_changed = "soft_deadline" in updates and updates["soft_deadline"] != mp.soft_deadline
    for field, value in updates.items():
        setattr(mp, field, value)

    if "assignment_md" in updates:
        mp.assignment_html = render_with_run_assets(db, mp.run_id, updates["assignment_md"])
        sync_run_asset_references(db, mp.run_id, updates["assignment_md"], mp.id)

    if soft_changed:
        # Recompute is_late on existing submissions
        new_soft = updates["soft_deadline"]
        if new_soft is None:
            db.execute(
                Submission.__table__.update()
                .where(Submission.mini_project_id == mp.id)
                .values(is_late=False)
            )
        else:
            db.execute(
                Submission.__table__.update()
                .where(Submission.mini_project_id == mp.id)
                .values(is_late=(Submission.submitted_at > new_soft))
            )

    db.commit()
    db.refresh(mp)
    return _serialize_mini_project(db, mp)


@router.delete("/api/mini-projects/{mp_id}", status_code=204)
def delete_mini_project(
    mp_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mp = get_or_404(db, MiniProject, mp_id)
    run = get_or_404(db, Run, mp.run_id)
    require_run_admin_or_teacher(db, user, run)

    has_subs = mp.first_submitted_at is not None
    if has_subs and not force:
        raise HTTPException(status_code=409, detail="Mini-project has submissions; use ?force=true")
    if has_subs and force:
        # Course-admin only for force delete
        version = db.get(CourseVersion, run.version_id)
        require_course_admin(db, user, version.course_id)

    # Pre-flight #1: collect file paths BEFORE deleting (paths come from sub.file_path / ev.feedback_file)
    submissions = db.execute(
        select(Submission).where(Submission.mini_project_id == mp_id)
    ).scalars().all()

    sub_file_paths: list[str] = []
    fb_file_paths: list[str] = []
    for sub in submissions:
        sub_file_paths.append(
            os.path.join(submission_storage_dir(run.id, sub.group_id), os.path.basename(sub.file_path))
        )
        ev = db.execute(
            select(Evaluation).where(Evaluation.submission_id == sub.id)
        ).scalar_one_or_none()
        if ev and ev.feedback_file:
            fb_file_paths.append(
                os.path.join(submission_storage_dir(run.id, sub.group_id), os.path.basename(ev.feedback_file))
            )

    # Pre-flight #1: DB cascade delete + commit FIRST
    sub_ids = [s.id for s in submissions]
    if sub_ids:
        db.execute(Evaluation.__table__.delete().where(Evaluation.submission_id.in_(sub_ids)))
    db.execute(Submission.__table__.delete().where(Submission.mini_project_id == mp_id))
    db.execute(RunAssetReference.__table__.delete().where(RunAssetReference.mini_project_id == mp_id))
    db.delete(mp)
    db.commit()

    # Pre-flight #1: best-effort file cleanup post-commit
    for path in sub_file_paths + fb_file_paths:
        if os.path.isfile(path):
            try:
                os.remove(path)
            except OSError:
                pass


@router.post("/api/mini-projects/{mp_id}/publish", response_model=MiniProjectResponse)
def publish_mini_project(
    mp_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mp = get_or_404(db, MiniProject, mp_id)
    run = get_or_404(db, Run, mp.run_id)
    require_run_admin_or_teacher(db, user, run)

    violations = []
    if not run.is_published:
        violations.append("Cannot publish mini-project on unpublished run")
    if mp.hard_deadline is None:
        violations.append("hard_deadline required at publish")
    if mp.resubmission_deadline is None:
        violations.append("resubmission_deadline required at publish")
    now = datetime.now(timezone.utc)
    hard_aware = _to_utc_aware(mp.hard_deadline)
    soft_aware = _to_utc_aware(mp.soft_deadline)
    resub_aware = _to_utc_aware(mp.resubmission_deadline)
    if hard_aware is not None and hard_aware <= now:
        violations.append("hard_deadline must be in the future")
    if hard_aware is not None and hard_aware.date() > run.end_date:
        violations.append("hard_deadline must fall within run end_date")
    if resub_aware is not None and resub_aware.date() > run.end_date:
        violations.append("resubmission_deadline must fall within run end_date")
    if soft_aware is not None and hard_aware is not None and soft_aware > hard_aware:
        violations.append("soft_deadline must be <= hard_deadline")
    if hard_aware is not None and resub_aware is not None and hard_aware > resub_aware:
        violations.append("hard_deadline must be <= resubmission_deadline")

    if violations:
        raise HTTPException(status_code=409, detail="; ".join(violations))

    mp.is_published = True
    db.commit()
    db.refresh(mp)
    return _serialize_mini_project(db, mp)
