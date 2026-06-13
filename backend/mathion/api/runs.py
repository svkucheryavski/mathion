import os
import shutil

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.api.helpers import (
    get_newest_published_version,
    get_or_404,
    has_submissions,
    require_course_admin,
    require_course_admin_for_run,
    require_run_admin_or_teacher,
)
from mathion.config import settings
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import (
    Course,
    CourseVersion,
    Evaluation,
    Group,
    MiniProject,
    Run,
    RunAsset,
    RunAssetReference,
    RunStudent,
    RunTeacher,
    Submission,
)
from mathion.models_auth import User
from mathion.schemas import RunCreate, RunResponse, RunUpdate

router = APIRouter(tags=["runs"])


@router.post("/api/courses/{course_id}/runs", status_code=201, response_model=RunResponse)
def create_run(course_id: int, data: RunCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_or_404(db, Course, course_id)
    require_course_admin(db, user, course_id)
    version = get_newest_published_version(db, course_id)
    if version.is_disabled:
        raise HTTPException(status_code=409, detail="Cannot create run on a disabled course version")
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

    # Phase 7b: block disabling groups when mini-projects exist
    if "groups_enabled" in updates and updates["groups_enabled"] is False:
        mp_count = db.scalar(select(func.count(MiniProject.id)).where(MiniProject.run_id == run_id))
        if mp_count and mp_count > 0:
            raise HTTPException(status_code=409, detail="Cannot disable groups; mini-projects exist")

    new_end = updates.get("end_date", run.end_date)
    if new_end < run.start_date:
        raise HTTPException(status_code=422, detail="end_date must be on or after start_date")

    # Phase 7b: lowering end_date blocked when submissions exist
    if "end_date" in updates and updates["end_date"] < run.end_date:
        if has_submissions(db, run):
            raise HTTPException(status_code=409, detail="Cannot shorten run while submissions exist")

    # Phase 7b: extending end_date blocked when version is disabled (would re-activate
    # a run pinned to a disabled version, contradicting the disabled-version invariant)
    if "end_date" in updates and updates["end_date"] > run.end_date:
        version = db.get(CourseVersion, run.version_id)
        if version is not None and version.is_disabled:
            raise HTTPException(
                status_code=409,
                detail="Cannot extend end_date on a run pinned to a disabled course version",
            )

    for field, value in updates.items():
        setattr(run, field, value)

    db.commit()
    db.refresh(run)
    return run


@router.delete("/api/runs/{run_id}", status_code=204)
def delete_run(
    run_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_course_admin_for_run(db, user, run)

    if not force:
        if run.is_published:
            raise HTTPException(status_code=409, detail="Unpublish run before deleting")
        student_count = db.scalar(select(func.count(RunStudent.id)).where(RunStudent.run_id == run_id))
        if student_count and student_count > 0:
            raise HTTPException(status_code=409, detail="Run has students; clear roster or use ?force=true")
        if has_submissions(db, run):
            raise HTTPException(status_code=409, detail="Run has submissions; use ?force=true to override")
        # Simple delete (cascade via FKs handles teachers/groups/students)
        db.delete(run)
        db.commit()
        return

    # ?force=true: course-admin only AND override all blocks
    # Cascade order: evaluations -> submissions -> run_asset_refs -> mini_projects -> groups -> teachers/students -> run_assets -> run
    sub_ids = db.execute(
        select(Submission.id).join(MiniProject, MiniProject.id == Submission.mini_project_id)
        .where(MiniProject.run_id == run_id)
    ).scalars().all()
    if sub_ids:
        db.execute(Evaluation.__table__.delete().where(Evaluation.submission_id.in_(sub_ids)))
        db.execute(Submission.__table__.delete().where(Submission.id.in_(sub_ids)))
    mp_ids = db.execute(select(MiniProject.id).where(MiniProject.run_id == run_id)).scalars().all()
    if mp_ids:
        db.execute(RunAssetReference.__table__.delete().where(RunAssetReference.mini_project_id.in_(mp_ids)))
        db.execute(MiniProject.__table__.delete().where(MiniProject.id.in_(mp_ids)))
    # Group and run_student/teacher cascade via FK on run delete; just delete RunAsset rows + files explicitly.
    # Storage layout puts everything under a single per-run tree, so one rmtree wipes both
    # run-asset files and submission/feedback PDFs.
    run_tree = os.path.join(settings.asset_path, "runs", str(run_id))
    db.execute(RunAsset.__table__.delete().where(RunAsset.run_id == run_id))
    db.delete(run)
    db.commit()
    # Disk cleanup last (after DB commit so we don't end up with files but no rows)
    if os.path.isdir(run_tree):
        try:
            shutil.rmtree(run_tree)
        except OSError:
            pass


@router.post("/api/runs/{run_id}/publish", response_model=RunResponse)
def publish_run(run_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # TODO(phase 9): publish-gate validation is read-then-write; a teacher
    # could be removed concurrently between the count check and is_published
    # update. Fix via SAVEPOINT-wrapped re-check in Phase 9.
    run = get_or_404(db, Run, run_id)
    require_course_admin_for_run(db, user, run)
    version = db.get(CourseVersion, run.version_id)
    if version is not None and version.is_disabled:
        raise HTTPException(status_code=409, detail="Cannot publish run on a disabled course version")
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
