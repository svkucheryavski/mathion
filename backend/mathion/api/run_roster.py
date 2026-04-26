import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.api.helpers import (
    _enroll_user_in_run,
    get_or_create_user,
    require_run_admin_or_teacher,
)
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import CourseVersion, Group, Run, RunStudent
from mathion.models_auth import StudentEnrollment, User
from mathion.schemas import (
    RunStudentBatchRequest,
    RunStudentBatchResponse,
    RunStudentCreate,
    RunStudentResponse,
    RunStudentUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["run_roster"])


def _to_response(rs: RunStudent) -> dict:
    return {
        "id": rs.id, "run_id": rs.run_id, "user_id": rs.user_id,
        "user_email": rs.user.email, "user_full_name": rs.user.full_name,
        "group_id": rs.group_id, "created_at": rs.created_at,
    }


@router.post("/api/runs/{run_id}/students", status_code=201, response_model=RunStudentResponse)
def add_student(run_id: int, data: RunStudentCreate, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    require_run_admin_or_teacher(db, user, run_id)
    run = db.get(Run, run_id)
    if data.group_id is not None:
        g = db.get(Group, data.group_id)
        if g is None or g.run_id != run_id:
            raise HTTPException(status_code=400, detail="Group not in this run")

    target = get_or_create_user(db, data.email)
    rs = _enroll_user_in_run(db, target, run, data.group_id)
    db.commit()
    db.refresh(rs)
    return _to_response(rs)


@router.get("/api/runs/{run_id}/students", response_model=list[RunStudentResponse])
def list_students(run_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_run_admin_or_teacher(db, user, run_id)
    rows = db.execute(
        select(RunStudent).where(RunStudent.run_id == run_id).order_by(RunStudent.created_at)
    ).scalars().all()
    return [_to_response(rs) for rs in rows]


@router.patch("/api/runs/{run_id}/students/{user_id}", response_model=RunStudentResponse)
def patch_student(run_id: int, user_id: int, data: RunStudentUpdate,
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_run_admin_or_teacher(db, user, run_id)
    rs = db.execute(
        select(RunStudent).where(RunStudent.run_id == run_id, RunStudent.user_id == user_id)
    ).scalar_one_or_none()
    if not rs:
        raise HTTPException(status_code=404, detail="Student not in run")

    updates = data.model_dump(exclude_unset=True)
    if "group_id" in updates:
        new_gid = updates["group_id"]
        if new_gid is not None:
            g = db.get(Group, new_gid)
            if g is None or g.run_id != run_id:
                raise HTTPException(status_code=400, detail="Group not in this run")
            count = db.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == new_gid))
            if count >= 10 and rs.group_id != new_gid:
                raise HTTPException(status_code=409, detail="Group capacity reached")
        rs.group_id = new_gid

    db.commit()
    db.refresh(rs)
    return _to_response(rs)


@router.delete("/api/runs/{run_id}/students/{user_id}", status_code=204)
def remove_student(run_id: int, user_id: int, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    require_run_admin_or_teacher(db, user, run_id)
    run = db.get(Run, run_id)
    rs = db.execute(
        select(RunStudent).where(RunStudent.run_id == run_id, RunStudent.user_id == user_id)
    ).scalar_one_or_none()
    if not rs:
        raise HTTPException(status_code=404, detail="Student not in run")

    db.delete(rs)
    db.flush()

    # Deactivate StudentEnrollment iff no other RunStudent rows remain on this course's runs
    # Joins CourseVersion so we also catch runs on OTHER versions of the same course.
    # Use limit(1) + first() — scalar_one_or_none() would raise MultipleResultsFound
    # when the user has 2+ other runs on this course.
    other = db.execute(
        select(RunStudent.id)
        .join(Run, Run.id == RunStudent.run_id)
        .join(CourseVersion, CourseVersion.id == Run.version_id)
        .where(
            RunStudent.user_id == user_id,
            CourseVersion.course_id == run.version.course_id,
        )
        .limit(1)
    ).first()
    if other is None:
        enrollment = db.execute(
            select(StudentEnrollment).where(
                StudentEnrollment.user_id == user_id,
                StudentEnrollment.version_id == run.version_id,
            )
        ).scalar_one_or_none()
        if enrollment:
            enrollment.is_active = False
    db.commit()


@router.post(
    "/api/runs/{run_id}/students/batch",
    status_code=207,
    response_model=RunStudentBatchResponse,
)
def add_students_batch(
    run_id: int,
    data: RunStudentBatchRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_run_admin_or_teacher(db, user, run_id)
    run = db.get(Run, run_id)
    results = []

    for row in data.rows:
        # User creation happens at the outer transaction; safe to keep even if
        # the per-row enrollment later fails.
        target = get_or_create_user(db, row.email)

        sp = db.begin_nested()
        try:
            if row.name and not target.full_name:
                target.full_name = row.name
            gid: int | None = None
            if row.group:
                g = db.execute(
                    select(Group).where(Group.run_id == run_id, Group.name == row.group)
                ).scalar_one_or_none()
                if g is None:
                    g = Group(run_id=run_id, name=row.group)
                    db.add(g)
                    db.flush()
                gid = g.id

            rs = _enroll_user_in_run(db, target, run, gid)
            sp.commit()
            results.append({"email": row.email, "status": "added", "group_id": rs.group_id})
        except HTTPException as e:
            sp.rollback()
            results.append({"email": row.email, "status": "error", "detail": e.detail})
        except Exception:  # noqa: BLE001
            logger.exception("Unexpected error in batch student add for %s", row.email)
            sp.rollback()
            results.append({"email": row.email, "status": "error", "detail": "internal error"})

    db.commit()
    return {"results": results}
