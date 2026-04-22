from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404
from mathion.database import get_db
from mathion.models import Course
from mathion.schemas import CourseCreate, CourseResponse, CourseUpdate

router = APIRouter(tags=["courses"])


@router.post("/api/courses", status_code=201, response_model=CourseResponse)
def create_course(data: CourseCreate, db: Session = Depends(get_db)):
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
def list_courses(limit: int = 100, offset: int = 0, db: Session = Depends(get_db)):
    courses = db.execute(select(Course).offset(offset).limit(limit)).scalars().all()
    return courses


@router.get("/api/courses/{course_id}", response_model=CourseResponse)
def get_course(course_id: int, db: Session = Depends(get_db)):
    return get_or_404(db, Course, course_id)


@router.patch("/api/courses/{course_id}", response_model=CourseResponse)
def update_course(course_id: int, data: CourseUpdate, db: Session = Depends(get_db)):
    course = get_or_404(db, Course, course_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(course, field, value)
    db.commit()
    db.refresh(course)
    return course


@router.delete("/api/courses/{course_id}", status_code=204)
def delete_course(course_id: int, db: Session = Depends(get_db)):
    course = get_or_404(db, Course, course_id)
    db.delete(course)
    db.commit()
