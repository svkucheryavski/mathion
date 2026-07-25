from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import exists, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.lookups import get_or_404
from mathion.api.authz import has_run_teacher_on_course, require_course_admin
from mathion.database import get_db
from mathion.dependencies import get_current_user, require_superuser
from mathion.models import Course, CourseAdmin, CourseVersion
from mathion.models_auth import StudentEnrollment, User
from mathion.schemas import CourseCreate, CourseResponse, CourseUpdate

router = APIRouter(tags=["courses"])


def _is_admin_for(db: Session, user: User, course_id: int) -> bool:
    if user.is_superuser:
        return True
    return db.execute(
        select(CourseAdmin.user_id).where(
            CourseAdmin.course_id == course_id,
            CourseAdmin.user_id == user.id,
        )
    ).scalar_one_or_none() is not None


@router.post("/api/courses", status_code=201, response_model=CourseResponse)
def create_course(data: CourseCreate, db: Session = Depends(get_db), user: User = Depends(require_superuser)):
    course = Course(slug=data.slug, name=data.name, description=data.description)
    db.add(course)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Course with this slug already exists")
    db.refresh(course)
    out = CourseResponse.model_validate(course)
    out.is_admin = True  # creator is the superuser per require_superuser
    return out


@router.get("/api/courses", response_model=list[CourseResponse])
def list_courses(limit: int = 100, offset: int = 0, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.is_superuser:
        courses = db.execute(select(Course).order_by(Course.id).offset(offset).limit(limit)).scalars().all()
        return [
            CourseResponse.model_validate(c).model_copy(update={"is_admin": _is_admin_for(db, user, c.id)})
            for c in courses
        ]

    # Non-superuser: show courses where user is admin or has an active enrollment
    admin_course_ids = db.execute(
        select(CourseAdmin.course_id).where(CourseAdmin.user_id == user.id)
    ).scalars().all()

    enrolled_course_ids = db.execute(
        select(CourseVersion.course_id)
        .join(StudentEnrollment, StudentEnrollment.version_id == CourseVersion.id)
        .where(StudentEnrollment.user_id == user.id, StudentEnrollment.is_active == True)  # noqa: E712
    ).scalars().all()

    visible_ids = set(admin_course_ids) | set(enrolled_course_ids)
    if not visible_ids:
        return []
    courses = db.execute(select(Course).where(Course.id.in_(visible_ids)).order_by(Course.id).offset(offset).limit(limit)).scalars().all()
    return [
        CourseResponse.model_validate(c).model_copy(update={"is_admin": _is_admin_for(db, user, c.id)})
        for c in courses
    ]


@router.get("/api/courses/by-slug/{slug}", response_model=CourseResponse)
def get_course_by_slug(slug: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    course = db.execute(select(Course).where(Course.slug == slug)).scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Not found")

    # Compute role precedence ONCE — superuser > course-admin > run-teacher.
    # `out.is_admin` is assigned exactly once at the end so a teacher branch
    # cannot accidentally inherit an admin flag from a copy-paste omission
    # (spec §3.1.1).
    is_admin_role: bool = False
    if user.is_superuser:
        is_admin_role = True
    elif db.scalar(select(exists().where(
        CourseAdmin.user_id == user.id,
        CourseAdmin.course_id == course.id,
    ))):
        is_admin_role = True
    elif has_run_teacher_on_course(db, user, course.id):
        is_admin_role = False  # explicit: teachers allowed, not admin
    else:
        raise HTTPException(status_code=403, detail="Access denied")

    out = CourseResponse.model_validate(course)
    out.is_admin = is_admin_role
    return out


@router.get("/api/courses/{course_id}", response_model=CourseResponse)
def get_course(course_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    course = get_or_404(db, Course, course_id)
    if not user.is_superuser:
        # Check if user is a course admin
        is_admin = db.execute(
            select(CourseAdmin).where(
                CourseAdmin.course_id == course_id,
                CourseAdmin.user_id == user.id,
            )
        ).scalar_one_or_none()
        if not is_admin:
            # Check if user has any enrollment (active or inactive) on any version of this course
            is_enrolled = db.execute(
                select(StudentEnrollment)
                .join(CourseVersion, CourseVersion.id == StudentEnrollment.version_id)
                .where(
                    CourseVersion.course_id == course_id,
                    StudentEnrollment.user_id == user.id,
                )
            ).first()
            if not is_enrolled:
                raise HTTPException(status_code=403, detail="Access denied")
    out = CourseResponse.model_validate(course)
    out.is_admin = _is_admin_for(db, user, course.id)
    return out


@router.patch("/api/courses/{course_id}", response_model=CourseResponse)
def update_course(course_id: int, data: CourseUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_course_admin(db, user, course_id)
    course = get_or_404(db, Course, course_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(course, field, value)
    db.commit()
    db.refresh(course)
    out = CourseResponse.model_validate(course)
    out.is_admin = _is_admin_for(db, user, course.id)
    return out


@router.delete("/api/courses/{course_id}", status_code=204)
def delete_course(course_id: int, db: Session = Depends(get_db), user: User = Depends(require_superuser)):
    course = get_or_404(db, Course, course_id)
    db.delete(course)
    db.commit()
