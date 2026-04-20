from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.database import get_db
from mathion.models import Course, CourseVersion
from mathion.schemas import VersionCreate, VersionResponse

router = APIRouter(tags=["versions"])


@router.post("/api/courses/{course_id}/versions", status_code=201, response_model=VersionResponse)
def create_version(course_id: int, data: VersionCreate, db: Session = Depends(get_db)):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    version = CourseVersion(
        course_id=course_id,
        info_md=data.info_md,
        info_html="",
        max_quiz_attempts=data.max_quiz_attempts,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return version


@router.get("/api/courses/{course_id}/versions", response_model=list[VersionResponse])
def list_versions(course_id: int, db: Session = Depends(get_db)):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    versions = db.execute(
        select(CourseVersion).where(CourseVersion.course_id == course_id)
    ).scalars().all()
    return versions


@router.post("/api/versions/{version_id}/publish", response_model=VersionResponse)
def publish_version(version_id: int, db: Session = Depends(get_db)):
    version = db.get(CourseVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    if version.state != "created":
        raise HTTPException(status_code=409, detail=f"Cannot publish version in '{version.state}' state")
    version.state = "published"
    version.published_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(version)
    return version


@router.post("/api/versions/{version_id}/archive", response_model=VersionResponse)
def archive_version(version_id: int, db: Session = Depends(get_db)):
    version = db.get(CourseVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    if version.state != "published":
        raise HTTPException(status_code=409, detail=f"Cannot archive version in '{version.state}' state")
    version.state = "archived"
    version.archived_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(version)
    return version


@router.post("/api/versions/{version_id}/revert", response_model=VersionResponse)
def revert_version(version_id: int, db: Session = Depends(get_db)):
    version = db.get(CourseVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    if version.state != "published":
        raise HTTPException(status_code=409, detail=f"Cannot revert version in '{version.state}' state")
    version.state = "created"
    version.published_at = None
    db.commit()
    db.refresh(version)
    return version


@router.delete("/api/versions/{version_id}", status_code=204)
def delete_version(version_id: int, db: Session = Depends(get_db)):
    version = db.get(CourseVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only delete versions in 'created' state")
    db.delete(version)
    db.commit()
