from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, require_course_admin
from mathion.database import get_db
from mathion.dependencies import get_current_user, require_superuser
from mathion.models import Course
from mathion.models_auth import User
from mathion.schemas import CourseCreate, CourseResponse, CourseUpdate

router = APIRouter(tags=["courses"])


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
    return course


@router.get("/api/courses", response_model=list[CourseResponse])
def list_courses(limit: int = 100, offset: int = 0, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    courses = db.execute(select(Course).offset(offset).limit(limit)).scalars().all()
    return courses


@router.get("/api/courses/{course_id}", response_model=CourseResponse)
def get_course(course_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return get_or_404(db, Course, course_id)


@router.patch("/api/courses/{course_id}", response_model=CourseResponse)
def update_course(course_id: int, data: CourseUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_course_admin(db, user, course_id)
    course = get_or_404(db, Course, course_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(course, field, value)
    db.commit()
    db.refresh(course)
    return course


@router.delete("/api/courses/{course_id}", status_code=204)
def delete_course(course_id: int, db: Session = Depends(get_db), user: User = Depends(require_superuser)):
    course = get_or_404(db, Course, course_id)
    db.delete(course)
    db.commit()
