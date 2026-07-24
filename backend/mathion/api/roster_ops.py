from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.models import CourseVersion, Run, RunStudent


STUDENT_ALREADY_ACTIVE_ERROR_CODE = "student_already_active_in_course"


def enroll_user_in_run(db: Session, user, run, group_id: int | None):
    """Enroll a user in a run.

    1. Group capacity check (rejects a full target group if group_id given).
    2. Activate StudentEnrollment for run.version_id (deactivates other active
       enrollments on this course via the existing `_enroll_user`).
    3. Create or update RunStudent row. If a RunStudent row already exists for
       this (run, user), its `group_id` is OVERWRITTEN with the new value.
       None means "unassign".
    4. Write a `run_enrolled` notification log row.

    Caller must commit. Raises HTTPException on capacity / disabled-version.

    Note: the group-capacity check holds CAPACITY(run.id) across the count-read
    and the insert (Phase 9-A2), so two concurrent adds into the same near-full
    group serialize — the second re-reads the committed count and 409s.
    """
    from sqlalchemy import func
    from mathion.api import advisory
    from mathion.api.enrollment import _enroll_user
    from mathion.models import CourseVersion, RunStudent
    from mathion.models_auth import NotificationLogEntry

    version = db.get(CourseVersion, run.version_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Run version is disabled")

    if group_id is not None:
        advisory.advisory_xact_lock(db, advisory.LOCK_NS_CAPACITY, run.id)
        count = db.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == group_id))
        advisory.interleave_hook("capacity")
        if count >= advisory.MAX_GROUP_SIZE:
            raise HTTPException(status_code=409, detail="Group capacity reached")

    _enroll_user(db, user, version.course_id, version)

    rs = db.execute(
        select(RunStudent).where(RunStudent.run_id == run.id, RunStudent.user_id == user.id)
    ).scalar_one_or_none()
    if rs:
        rs.group_id = group_id
    else:
        rs = RunStudent(run_id=run.id, user_id=user.id, group_id=group_id)
        db.add(rs)
        db.flush()
        db.add(NotificationLogEntry(
            user_id=user.id,
            kind="run_enrolled",
            payload={
                "run_id": run.id,
                "course_slug": version.course.slug,
                "title": run.title,
            },
        ))
    return rs


def remove_run_student(db: Session, run, user_id: int) -> bool:
    """Remove a student from a run.

    1. Look up RunStudent for (run.id, user_id). Return False if not found.
    2. Delete the RunStudent row and flush.
    3. Check whether the user has any other RunStudent on any version of
       the same course (joins Run -> CourseVersion -> course_id).
    4. If no siblings remain, set StudentEnrollment.is_active = False
       for (user_id, run.version_id).
    5. Caller must commit.

    Returns True if a row was deleted, False if no matching RunStudent.
    """
    from mathion.models import CourseVersion, Run, RunStudent
    from mathion.models_auth import StudentEnrollment

    rs = db.execute(
        select(RunStudent).where(RunStudent.run_id == run.id, RunStudent.user_id == user_id)
    ).scalar_one_or_none()
    if rs is None:
        return False

    db.delete(rs)
    db.flush()

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
    return True


def find_student_active_conflicts(
    db: Session,
    user_id: int,
    *,
    course_id: int,
    exclude_run_id: int,
) -> list[tuple[int, str]]:
    """Return [(conflicting_run_id, conflicting_run_title), ...] for OTHER
    published runs of the same course where the user is an active RunStudent.
    BOTH course_id and exclude_run_id are required keyword args."""
    rows = db.execute(
        select(RunStudent.run_id, Run.title)
        .join(Run, Run.id == RunStudent.run_id)
        .join(CourseVersion, CourseVersion.id == Run.version_id)
        .where(
            RunStudent.user_id == user_id,
            CourseVersion.course_id == course_id,
            Run.is_published == True,
            Run.id != exclude_run_id,
        )
        # §7a: deterministic tie-breaker so the user-facing 409 names a stable
        # conflicting run (run_roster.py reads conflict_dicts[0]['run_title']).
        .order_by(Run.id)
    ).all()
    return [(row[0], row[1]) for row in rows]


def make_already_active_409_body(
    conflicts: list[dict], *, summary_override: str | None = None
) -> dict:
    """Build the JSONResponse content for the 409. Top-level `error_code` so
    ApiError in frontend/src/lib/api.ts:46 picks it up."""
    if summary_override is not None:
        detail = summary_override
    elif conflicts:
        c = conflicts[0]
        detail = (
            f"Student is already active in run \"{c['run_title']}\" of the same course."
        )
    else:
        detail = "Student is already active in another run of the same course."
    return {
        "detail": detail,
        "error_code": STUDENT_ALREADY_ACTIVE_ERROR_CODE,
        "conflicts": conflicts,
    }
