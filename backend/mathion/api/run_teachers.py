from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.api.lookups import get_or_404, get_or_create_user
from mathion.api.authz import require_course_admin_for_run, require_run_admin_or_teacher
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Run, RunTeacher
from mathion.models_auth import NotificationLogEntry, User
from mathion.schemas import RunTeacherCreate, RunTeacherResponse

router = APIRouter(tags=["run_teachers"])


def _to_response(rt: RunTeacher) -> dict:
    return {
        "id": rt.id,
        "run_id": rt.run_id,
        "user_id": rt.user_id,
        "user_email": rt.user.email,
        "user_full_name": rt.user.full_name,
        "created_at": rt.created_at,
    }


@router.post("/api/runs/{run_id}/teachers", status_code=201, response_model=RunTeacherResponse)
def add_teacher(run_id: int, data: RunTeacherCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    require_course_admin_for_run(db, user, run)

    target = get_or_create_user(db, data.email)
    existing = db.execute(
        select(RunTeacher).where(RunTeacher.run_id == run_id, RunTeacher.user_id == target.id)
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="User already a teacher on this run")

    rt = RunTeacher(run_id=run_id, user_id=target.id)
    db.add(rt)
    db.flush()

    db.add(NotificationLogEntry(
        user_id=target.id,
        kind="run_teacher_assigned",
        payload={"run_id": run_id, "title": run.title},
    ))
    db.commit()
    db.refresh(rt)
    return _to_response(rt)


@router.get("/api/runs/{run_id}/teachers", response_model=list[RunTeacherResponse])
def list_teachers(run_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    rows = db.execute(
        select(RunTeacher).where(RunTeacher.run_id == run_id).order_by(RunTeacher.created_at, RunTeacher.id)
    ).scalars().all()
    return [_to_response(rt) for rt in rows]


@router.delete("/api/runs/{run_id}/teachers/{user_id}", status_code=204)
def remove_teacher(run_id: int, user_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    require_course_admin_for_run(db, user, run)
    rt = db.execute(
        select(RunTeacher).where(RunTeacher.run_id == run_id, RunTeacher.user_id == user_id)
    ).scalar_one_or_none()
    if not rt:
        raise HTTPException(status_code=404, detail="Teacher not assigned to this run")
    db.delete(rt)
    db.commit()
