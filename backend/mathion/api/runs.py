from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.api.enrollment import _get_newest_published_version
from mathion.api.helpers import get_or_404, require_course_admin, require_run_admin_or_teacher
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Course, CourseVersion, Run
from mathion.models_auth import User
from mathion.schemas import RunCreate, RunResponse, RunUpdate

router = APIRouter(tags=["runs"])


@router.post("/api/courses/{course_id}/runs", status_code=201, response_model=RunResponse)
def create_run(course_id: int, data: RunCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_or_404(db, Course, course_id)
    require_course_admin(db, user, course_id)
    version = _get_newest_published_version(db, course_id)
    run = Run(
        version_id=version.id,
        title=data.title,
        start_date=data.start_date,
        end_date=data.end_date,
        groups_enabled=data.groups_enabled,
        created_by=user.id,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


@router.get("/api/courses/{course_id}/runs", response_model=list[RunResponse])
def list_runs(course_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_or_404(db, Course, course_id)
    require_course_admin(db, user, course_id)
    runs = db.execute(
        select(Run).join(CourseVersion, CourseVersion.id == Run.version_id)
        .where(CourseVersion.course_id == course_id)
        .order_by(Run.start_date)
    ).scalars().all()
    return runs


@router.get("/api/runs/{run_id}", response_model=RunResponse)
def get_run(run_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_run_admin_or_teacher(db, user, run_id)
    run = db.get(Run, run_id)
    return run


@router.patch("/api/runs/{run_id}", response_model=RunResponse)
def patch_run(run_id: int, data: RunUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_run_admin_or_teacher(db, user, run_id)
    run = db.get(Run, run_id)
    updates = data.model_dump(exclude_unset=True)

    if "groups_enabled" in updates and run.is_published:
        raise HTTPException(status_code=409, detail="Cannot change groups_enabled on published run")

    for field, value in updates.items():
        setattr(run, field, value)

    if run.end_date < run.start_date:
        raise HTTPException(status_code=422, detail="end_date must be on or after start_date")

    db.commit()
    db.refresh(run)
    return run


@router.delete("/api/runs/{run_id}", status_code=204)
def delete_run(run_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    version = get_or_404(db, CourseVersion, run.version_id)
    require_course_admin(db, user, version.course_id)
    if run.is_published:
        raise HTTPException(status_code=409, detail="Unpublish run before deleting")
    db.delete(run)
    db.commit()
