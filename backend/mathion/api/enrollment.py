from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, require_course_admin
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Course, CourseVersion
from mathion.models_auth import StudentEnrollment, User
from mathion.schemas import EnrollBatchRequest, EnrollmentResponse, EnrollRequest

router = APIRouter(tags=["enrollment"])


def _get_newest_published_version(db: Session, course_id: int) -> CourseVersion:
    """Return the most recently published version for the course, or raise 409."""
    version = db.execute(
        select(CourseVersion)
        .where(CourseVersion.course_id == course_id, CourseVersion.state == "published")
        .order_by(CourseVersion.published_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=409, detail="No published version exists for this course")
    return version


def _get_or_create_user(db: Session, email: str) -> User:
    """Return existing user by email, or create a new one with email only."""
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        user = User(email=email, full_name=None)
        db.add(user)
        db.flush()
    return user


def _enroll_user(db: Session, user: User, course_id: int, version: CourseVersion) -> StudentEnrollment:
    """Deactivate any existing active enrollment for this user+course, then create new one."""
    # Deactivate existing active enrollments for this user on any version of this course
    existing = db.execute(
        select(StudentEnrollment)
        .join(CourseVersion, StudentEnrollment.version_id == CourseVersion.id)
        .where(
            StudentEnrollment.user_id == user.id,
            StudentEnrollment.is_active == True,  # noqa: E712
            CourseVersion.course_id == course_id,
        )
    ).scalars().all()
    for enrollment in existing:
        enrollment.is_active = False

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
    version = _get_newest_published_version(db, course_id)
    user = _get_or_create_user(db, data.email)
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
    get_or_404(db, Course, course_id)
    require_course_admin(db, current_user, course_id)
    version = _get_newest_published_version(db, course_id)
    results = []
    for email in data.emails:
        user = _get_or_create_user(db, email)
        enrollment = _enroll_user(db, user, course_id, version)
        results.append(enrollment)
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
