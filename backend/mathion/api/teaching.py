from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Course, CourseAdmin, CourseVersion, Run, RunStudent, RunTeacher
from mathion.models_auth import User
from mathion.schemas import RunResponse, TeachingRunRow

router = APIRouter(tags=["teaching"])


@router.get("/api/teaching/runs", response_model=list[TeachingRunRow])
def list_teaching_runs(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TeachingRunRow]:
    """Return the runs the current user teaches or administers.

    A run is listed when the user holds a RunTeacher row on it OR a
    CourseAdmin row on its course. Superusers see every run. Each run appears
    once and its student count is not multiplied by the role join (the role
    test is a WHERE ... IN, not a join). Ordered by Run.id ASC; the frontend
    re-groups and re-sorts client-side.
    """
    stmt = (
        select(
            Run,
            Course.id,
            Course.name,
            Course.slug,
            func.count(RunStudent.id),
        )
        .select_from(Run)
        .join(CourseVersion, CourseVersion.id == Run.version_id)
        .join(Course, Course.id == CourseVersion.course_id)
        .outerjoin(RunStudent, RunStudent.run_id == Run.id)
    )
    if not user.is_superuser:
        stmt = stmt.where(
            or_(
                Run.id.in_(select(RunTeacher.run_id).where(RunTeacher.user_id == user.id)),
                CourseVersion.course_id.in_(
                    select(CourseAdmin.course_id).where(CourseAdmin.user_id == user.id)
                ),
            )
        )
    rows = db.execute(stmt.group_by(Run.id, Course.id).order_by(Run.id.asc())).all()

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
