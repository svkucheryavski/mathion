from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404
from mathion.database import get_db
from mathion.models import Block, Course, CourseVersion, Sequence
from mathion.schemas import VersionCreate, VersionResponse

router = APIRouter(tags=["versions"])


@router.post("/api/courses/{course_id}/versions", status_code=201, response_model=VersionResponse)
def create_version(course_id: int, data: VersionCreate, db: Session = Depends(get_db)):
    get_or_404(db, Course, course_id)
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
def list_versions(course_id: int, limit: int = 100, offset: int = 0, db: Session = Depends(get_db)):
    get_or_404(db, Course, course_id)
    versions = db.execute(
        select(CourseVersion).where(CourseVersion.course_id == course_id).offset(offset).limit(limit)
    ).scalars().all()
    return versions


@router.post("/api/versions/{version_id}/publish", response_model=VersionResponse)
def publish_version(version_id: int, db: Session = Depends(get_db)):
    version = get_or_404(db, CourseVersion, version_id)
    if version.state != "created":
        raise HTTPException(status_code=409, detail=f"Cannot publish version in '{version.state}' state")

    # C4: every block must have at least one sequence
    blocks = db.execute(select(Block).where(Block.version_id == version_id)).scalars().all()
    for block in blocks:
        seq_count = db.scalar(
            select(Sequence.id).where(Sequence.block_id == block.id).limit(1)
        )
        if seq_count is None:
            raise HTTPException(
                status_code=409,
                detail=f"Block '{block.title}' has no sequences. Every block must have at least one sequence to publish.",
            )

    version.state = "published"
    version.published_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(version)
    return version


@router.post("/api/versions/{version_id}/archive", response_model=VersionResponse)
def archive_version(version_id: int, db: Session = Depends(get_db)):
    version = get_or_404(db, CourseVersion, version_id)
    if version.state != "published":
        raise HTTPException(status_code=409, detail=f"Cannot archive version in '{version.state}' state")
    version.state = "archived"
    version.archived_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(version)
    return version


@router.post("/api/versions/{version_id}/revert", response_model=VersionResponse)
def revert_version(version_id: int, db: Session = Depends(get_db)):
    version = get_or_404(db, CourseVersion, version_id)
    if version.state != "published":
        raise HTTPException(status_code=409, detail=f"Cannot revert version in '{version.state}' state")
    version.state = "created"
    version.published_at = None
    db.commit()
    db.refresh(version)
    return version


@router.delete("/api/versions/{version_id}", status_code=204)
def delete_version(version_id: int, db: Session = Depends(get_db)):
    version = get_or_404(db, CourseVersion, version_id)
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only delete versions in 'created' state")
    db.delete(version)
    db.commit()


@router.post("/api/versions/{version_id}/disable", response_model=VersionResponse)
def disable_version(version_id: int, db: Session = Depends(get_db)):
    version = get_or_404(db, CourseVersion, version_id)
    version.is_disabled = True
    db.commit()
    db.refresh(version)
    return version


@router.post("/api/versions/{version_id}/enable", response_model=VersionResponse)
def enable_version(version_id: int, db: Session = Depends(get_db)):
    version = get_or_404(db, CourseVersion, version_id)
    version.is_disabled = False
    db.commit()
    db.refresh(version)
    return version
