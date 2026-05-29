from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Course, CourseVersion, Run, RunStudent, RunTeacher
from mathion.models_auth import User
from mathion.schemas import RunResponse, TeachingRunRow

router = APIRouter(tags=["teaching"])


@router.get("/api/teaching/runs", response_model=list[TeachingRunRow])
def list_teaching_runs(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TeachingRunRow]:
    """Return all runs where the current user holds a RunTeacher row.

    Authorization: requires authentication only. There is NO superuser bypass —
    superusers see only the runs they actually teach. Result ordered by
    Run.id ASC; the frontend re-groups and re-sorts client-side.
    """
    rows = db.execute(
        select(
            Run,
            Course.id,
            Course.name,
            Course.slug,
            func.count(RunStudent.id),
        )
        .select_from(RunTeacher)
        .join(Run, Run.id == RunTeacher.run_id)
        .join(CourseVersion, CourseVersion.id == Run.version_id)
        .join(Course, Course.id == CourseVersion.course_id)
        .outerjoin(RunStudent, RunStudent.run_id == Run.id)
        .where(RunTeacher.user_id == user.id)
        .group_by(Run.id, Course.id)
        .order_by(Run.id.asc())
    ).all()

    return [
        TeachingRunRow(
            run=RunResponse.model_validate(run),
            course_id=course_id,
            course_name=course_name,
            course_slug=course_slug,
            student_count=student_count,
        )
        for (run, course_id, course_name, course_slug, student_count) in rows
    ]
