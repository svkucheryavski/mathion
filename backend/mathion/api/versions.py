import os
import shutil
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, render_with_assets, require_course_admin, sync_asset_references
from mathion.config import settings
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import AnswerOption, Asset, Block, Course, CourseVersion, Item, Question, Sequence
from mathion.models_auth import StudentEnrollment, User
from mathion.schemas import VersionCreate, VersionResponse

router = APIRouter(tags=["versions"])


@router.post("/api/courses/{course_id}/versions", status_code=201, response_model=VersionResponse)
def create_version(course_id: int, data: VersionCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_or_404(db, Course, course_id)
    require_course_admin(db, user, course_id)

    if data.copy_assets_from is not None:
        source_version = get_or_404(db, CourseVersion, data.copy_assets_from)
        if source_version.course_id != course_id:
            raise HTTPException(status_code=400, detail="Source version belongs to a different course")
        total_size = db.scalar(
            select(func.coalesce(func.sum(Asset.file_size), 0)).where(
                Asset.version_id == data.copy_assets_from
            )
        )
        if total_size > settings.max_course_size:
            raise HTTPException(
                status_code=400,
                detail=f"Source assets total size ({total_size}) exceeds limit ({settings.max_course_size})",
            )

    version = CourseVersion(
        course_id=course_id,
        info_md=data.info_md,
        info_html="",
        max_quiz_attempts=data.max_quiz_attempts,
    )
    db.add(version)
    db.flush()

    if data.copy_assets_from is not None:
        source_assets = db.execute(
            select(Asset).where(Asset.version_id == data.copy_assets_from)
        ).scalars().all()
        if source_assets:
            source_dir = os.path.join(settings.asset_path, "courses", str(data.copy_assets_from))
            dest_dir = os.path.join(settings.asset_path, "courses", str(version.id))
            # Preflight: every source file must exist before any state changes
            missing = [
                a.filename for a in source_assets
                if not os.path.isfile(os.path.join(source_dir, a.filename))
            ]
            if missing:
                db.rollback()
                raise HTTPException(
                    status_code=500,
                    detail=f"Source asset files missing on disk: {', '.join(sorted(missing))}",
                )
            os.makedirs(dest_dir, exist_ok=True)
            for src_asset in source_assets:
                db.add(Asset(
                    version_id=version.id,
                    filename=src_asset.filename,
                    file_size=src_asset.file_size,
                    mime_type=src_asset.mime_type,
                    uploaded_by=user.id,
                ))
                src_path = os.path.join(source_dir, src_asset.filename)
                dst_path = os.path.join(dest_dir, src_asset.filename)
                shutil.copy2(src_path, dst_path)
            db.flush()

    # Render info_md after assets are in place so asset references resolve
    version.info_html = render_with_assets(db, version.id, data.info_md)
    sync_asset_references(db, version.id, [data.info_md], {"info_version_id": version.id})

    db.commit()
    db.refresh(version)
    return version


@router.get("/api/courses/{course_id}/versions", response_model=list[VersionResponse])
def list_versions(course_id: int, limit: int = 100, offset: int = 0, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_or_404(db, Course, course_id)
    require_course_admin(db, user, course_id)
    versions = db.execute(
        select(CourseVersion).where(CourseVersion.course_id == course_id).offset(offset).limit(limit)
    ).scalars().all()
    return versions


@router.post("/api/versions/{version_id}/publish", response_model=VersionResponse)
def publish_version(version_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
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

    # Every sequence must have at least one item
    sequences = db.execute(
        select(Sequence).join(Block, Block.id == Sequence.block_id).where(Block.version_id == version_id)
    ).scalars().all()
    for seq in sequences:
        item_exists = db.scalar(select(Item.id).where(Item.sequence_id == seq.id).limit(1))
        if item_exists is None:
            raise HTTPException(
                status_code=409,
                detail=f"Sequence '{seq.title}' has no items. Every sequence must have at least one item to publish.",
            )

    # Validate quiz completeness
    quiz_items = db.execute(
        select(Item)
        .join(Sequence, Sequence.id == Item.sequence_id)
        .join(Block, Block.id == Sequence.block_id)
        .where(Block.version_id == version_id, Item.type == "quiz")
    ).scalars().all()

    for item in quiz_items:
        questions = db.execute(
            select(Question).where(Question.item_id == item.id)
        ).scalars().all()
        if not questions:
            raise HTTPException(
                status_code=409,
                detail=f"Quiz '{item.title}' has no questions. Every quiz must have at least one question to publish.",
            )
        for q in questions:
            if q.type in ("single_choice", "multiple_choice"):
                options = db.execute(
                    select(AnswerOption).where(AnswerOption.question_id == q.id)
                ).scalars().all()
                if len(options) < 2:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Question '{q.text_md[:50]}' needs at least 2 options to publish.",
                    )
                correct_count = sum(1 for o in options if o.is_correct)
                if correct_count == 0:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Question '{q.text_md[:50]}' needs at least one correct option to publish.",
                    )
                if q.type == "single_choice" and correct_count != 1:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Single-choice question '{q.text_md[:50]}' must have exactly one correct option.",
                    )
            elif q.type == "numeric_answer":
                if q.correct_numeric is None:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Question '{q.text_md[:50]}' is missing correct_numeric to publish.",
                    )
                if q.precision is None:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Question '{q.text_md[:50]}' is missing precision to publish.",
                    )
            elif q.type == "text_answer":
                if not (q.correct_text or "").strip():
                    raise HTTPException(
                        status_code=409,
                        detail=f"Question '{q.text_md[:50]}' is missing correct_text to publish.",
                    )

    version.state = "published"
    version.published_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(version)
    return version


@router.post("/api/versions/{version_id}/archive", response_model=VersionResponse)
def archive_version(version_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "published":
        raise HTTPException(status_code=409, detail=f"Cannot archive version in '{version.state}' state")
    version.state = "archived"
    version.archived_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(version)
    return version


@router.post("/api/versions/{version_id}/revert", response_model=VersionResponse)
def revert_version(version_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "published":
        raise HTTPException(status_code=409, detail=f"Cannot revert version in '{version.state}' state")
    student_count = db.scalar(
        select(func.count()).where(
            StudentEnrollment.version_id == version_id,
            StudentEnrollment.is_active == True,  # noqa: E712
        )
    )
    if student_count > 0:
        raise HTTPException(status_code=409, detail="Cannot revert: version has enrolled students")
    version.state = "created"
    version.published_at = None
    db.commit()
    db.refresh(version)
    return version


@router.delete("/api/versions/{version_id}", status_code=204)
def delete_version(version_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only delete versions in 'created' state")
    db.delete(version)
    db.commit()


@router.post("/api/versions/{version_id}/disable", response_model=VersionResponse)
def disable_version(version_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
    version.is_disabled = True
    db.commit()
    db.refresh(version)
    return version


@router.post("/api/versions/{version_id}/enable", response_model=VersionResponse)
def enable_version(version_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
    version.is_disabled = False
    db.commit()
    db.refresh(version)
    return version
