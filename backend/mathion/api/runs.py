from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.api.helpers import (
    get_newest_published_version,
    get_or_404,
    require_course_admin,
    require_course_admin_for_run,
    require_run_admin_or_teacher,
)
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Course, CourseVersion, Group, Run, RunStudent, RunTeacher
from mathion.models_auth import NotificationLogEntry, User
from mathion.schemas import RunCreate, RunResponse, RunUpdate

router = APIRouter(tags=["runs"])


@router.post("/api/courses/{course_id}/runs", status_code=201, response_model=RunResponse)
def create_run(course_id: int, data: RunCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_or_404(db, Course, course_id)
    require_course_admin(db, user, course_id)
    version = get_newest_published_version(db, course_id)
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
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    return run


@router.patch("/api/runs/{run_id}", response_model=RunResponse)
def patch_run(run_id: int, data: RunUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
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
    require_course_admin_for_run(db, user, run)
    if run.is_published:
        raise HTTPException(status_code=409, detail="Unpublish run before deleting")
    db.delete(run)
    db.commit()


@router.post("/api/runs/{run_id}/publish", response_model=RunResponse)
def publish_run(run_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # TODO(phase 9): publish-gate validation is read-then-write; a teacher
    # could be removed concurrently between the count check and is_published
    # update. Fix via SAVEPOINT-wrapped re-check in Phase 9.
    run = get_or_404(db, Run, run_id)
    require_course_admin_for_run(db, user, run)
    if run.is_published:
        raise HTTPException(status_code=409, detail="Run is already published")

    violations: list[str] = []

    teacher_count = db.scalar(
        select(func.count(RunTeacher.id)).where(RunTeacher.run_id == run_id)
    )
    if teacher_count == 0:
        violations.append("at least one teacher required")

    if run.groups_enabled:
        unassigned = db.scalar(
            select(func.count(RunStudent.id)).where(
                RunStudent.run_id == run_id, RunStudent.group_id.is_(None)
            )
        )
        if unassigned > 0:
            violations.append(f"{unassigned} student(s) unassigned to a group")

        oversized = db.execute(
            select(Group.id, Group.name, func.count(RunStudent.id))
            .outerjoin(RunStudent, RunStudent.group_id == Group.id)
            .where(Group.run_id == run_id)
            .group_by(Group.id)
            .having(func.count(RunStudent.id) > 10)
        ).all()
        for _, gname, cnt in oversized:
            violations.append(f"group '{gname}' has {cnt} students (max 10)")

    if violations:
        raise HTTPException(status_code=409, detail="; ".join(violations))

    run.is_published = True
    db.flush()

    # Lazy-load course slug for notification payload
    course_slug = run.version.course.slug

    students = db.execute(
        select(RunStudent).where(RunStudent.run_id == run_id)
    ).scalars().all()
    for rs in students:
        db.add(NotificationLogEntry(
            user_id=rs.user_id,
            kind="run_published",
            payload={
                "run_id": run.id,
                "course_slug": course_slug,
                "title": run.title,
            },
        ))

    db.commit()
    db.refresh(run)
    return run


@router.post("/api/runs/{run_id}/unpublish", response_model=RunResponse)
def unpublish_run(run_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    require_course_admin_for_run(db, user, run)
    if not run.is_published:
        raise HTTPException(status_code=409, detail="Run is not published")
    run.is_published = False
    db.commit()
    db.refresh(run)
    return run
