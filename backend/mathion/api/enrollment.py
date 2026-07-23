from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.api import advisory
from mathion.api.helpers import get_newest_published_version, get_or_404, get_or_create_user, require_course_admin
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Course, CourseVersion
from mathion.models_auth import StudentEnrollment, User
from mathion.schemas import EnrollBatchRequest, EnrollmentResponse, EnrollRequest

router = APIRouter(tags=["enrollment"])


def _enroll_user(db: Session, user: User, course_id: int, version: CourseVersion) -> StudentEnrollment:
    """Deactivate any existing active enrollment for this user+course, then create new one.

    NOTE: The (user_id, version_id) unique constraint already blocks duplicate rows on a
    single version. The unguarded invariant is one ACTIVE enrollment per (user, course)
    across versions — under READ COMMITTED, two concurrent enrollments on different
    versions each read only committed rows, so neither sees the other's not-yet-committed
    active row before inserting its own, leaving two active. DB-level enforcement is
    deferred to the concurrency-hardening slice; for now the deactivate-then-insert below
    mitigates it in application code.
    """
    # Check for any existing row (active or inactive) on the target version.
    # The (user_id, version_id) unique constraint requires that we reactivate
    # an existing inactive row rather than inserting a duplicate.
    target_existing = db.execute(
        select(StudentEnrollment).where(
            StudentEnrollment.user_id == user.id,
            StudentEnrollment.version_id == version.id,
        )
    ).scalar_one_or_none()
    if target_existing and target_existing.is_active:
        return target_existing

    # Deactivate any other active enrollments for this user across this course's versions
    other_active = db.execute(
        select(StudentEnrollment)
        .join(CourseVersion, StudentEnrollment.version_id == CourseVersion.id)
        .where(
            StudentEnrollment.user_id == user.id,
            StudentEnrollment.is_active == True,  # noqa: E712
            CourseVersion.course_id == course_id,
            StudentEnrollment.version_id != version.id,
        )
    ).scalars().all()
    for enrollment in other_active:
        enrollment.is_active = False

    if target_existing:
        # Reactivate inactive row
        target_existing.is_active = True
        db.flush()
        return target_existing

    enrollment = StudentEnrollment(user_id=user.id, version_id=version.id, is_active=True)
    db.add(enrollment)
    db.flush()
    return enrollment


def _enrollment_to_response(enrollment: StudentEnrollment) -> EnrollmentResponse:
    return EnrollmentResponse(
        id=enrollment.id,
        user_id=enrollment.user_id,
        version_id=enrollment.version_id,
        is_active=enrollment.is_active,
        user_email=enrollment.user.email,
        user_full_name=enrollment.user.full_name,
    )


@router.post("/api/courses/{course_id}/enroll", status_code=201, response_model=EnrollmentResponse)
def enroll_student(
    course_id: int,
    data: EnrollRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_or_404(db, Course, course_id)
    require_course_admin(db, current_user, course_id)
    version = get_newest_published_version(db, course_id)
    # Phase 9-A2 invariant #2 (spec §5.2): ENROLLMENT(course_id) BEFORE
    # get_or_create_user (advisory-before-index) so the deactivate-then-insert in
    # _enroll_user is atomic and the users index INSERT sits inside the lock.
    advisory.advisory_xact_lock(db, advisory.LOCK_NS_ENROLLMENT, course_id)
    user = get_or_create_user(db, data.email)
    enrollment = _enroll_user(db, user, course_id, version)
    db.commit()
    db.refresh(enrollment)
    return _enrollment_to_response(enrollment)


@router.post("/api/courses/{course_id}/enroll-batch", status_code=201, response_model=list[EnrollmentResponse])
def enroll_batch(
    course_id: int,
    data: EnrollBatchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if len(data.emails) > advisory.MAX_BATCH_SIZE:
        raise HTTPException(status_code=422, detail="Batch too large (max 300); split into smaller chunks")
    get_or_404(db, Course, course_id)
    require_course_admin(db, current_user, course_id)
    version = get_newest_published_version(db, course_id)
    unique_emails = list(dict.fromkeys(e.strip().lower() for e in data.emails))
    # Phase 9-A2 invariant #2 (spec §5.2/§5.3): ENROLLMENT(course_id) once BEFORE
    # the loop, before any get_or_create_user (advisory-before-index).
    advisory.advisory_xact_lock(db, advisory.LOCK_NS_ENROLLMENT, course_id)
    # Deadlock-freedom (spec §3.2/§5.3): touch the shared `users` rows in a stable
    # normalized-email order, but return results in the client's INPUT order.
    order = sorted(range(len(unique_emails)), key=lambda i: unique_emails[i])
    by_index: dict[int, StudentEnrollment] = {}
    for i in order:
        user = get_or_create_user(db, unique_emails[i])
        by_index[i] = _enroll_user(db, user, course_id, version)
    results = [by_index[i] for i in range(len(unique_emails))]
    db.commit()
    for enrollment in results:
        db.refresh(enrollment)
    return [_enrollment_to_response(e) for e in results]


@router.get("/api/courses/{course_id}/students", response_model=list[EnrollmentResponse])
def list_students(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_or_404(db, Course, course_id)
    require_course_admin(db, current_user, course_id)
    enrollments = db.execute(
        select(StudentEnrollment)
        .join(CourseVersion, StudentEnrollment.version_id == CourseVersion.id)
        .where(
            CourseVersion.course_id == course_id,
            StudentEnrollment.is_active == True,  # noqa: E712
        )
        .order_by(StudentEnrollment.id)
    ).scalars().all()
    return [_enrollment_to_response(e) for e in enrollments]


@router.delete("/api/courses/{course_id}/students/{user_id}", status_code=204)
def remove_student(
    course_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_or_404(db, Course, course_id)
    require_course_admin(db, current_user, course_id)
    enrollments = db.execute(
        select(StudentEnrollment)
        .join(CourseVersion, StudentEnrollment.version_id == CourseVersion.id)
        .where(
            StudentEnrollment.user_id == user_id,
            StudentEnrollment.is_active == True,  # noqa: E712
            CourseVersion.course_id == course_id,
        )
    ).scalars().all()
    if not enrollments:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    for enrollment in enrollments:
        enrollment.is_active = False
    db.commit()
