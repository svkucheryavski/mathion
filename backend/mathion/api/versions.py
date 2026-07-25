import os
import shutil
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from mathion.api.text_utils import bump_content_updated_at
from mathion.api.lookups import get_or_404
from mathion.api.authz import has_run_teacher_on_course, require_course_admin
from mathion.api.asset_render import render_with_assets, sync_asset_references
from mathion.api.version_clone import clone_version_content, collect_referenced_filenames, copy_version_assets
from mathion.config import settings
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import AnswerOption, Asset, Block, Course, CourseAdmin, CourseVersion, Item, Question, Run, RunTeacher, Sequence
from mathion.models_auth import StudentEnrollment, User
from mathion.schemas import VersionCreate, VersionDuplicateRequest, VersionRenderRequest, VersionRenderResponse, VersionResponse, VersionUpdate

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
        label=data.label,
    )
    db.add(version)
    db.flush()

    if data.copy_assets_from is not None:
        try:
            copy_version_assets(db, data.copy_assets_from, version.id, user.id)
        except HTTPException:
            db.rollback()
            raise

    # Render info_md after assets are in place so asset references resolve
    version.info_html = render_with_assets(db, version.id, data.info_md)
    sync_asset_references(db, version.id, [data.info_md], {"info_version_id": version.id})

    db.commit()
    db.refresh(version)
    return version


@router.post("/api/versions/{version_id}/duplicate", status_code=201, response_model=VersionResponse)
def duplicate_version(
    version_id: int,
    data: VersionDuplicateRequest = VersionDuplicateRequest(),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    source = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, source.course_id)
    if source.is_disabled:
        raise HTTPException(status_code=403, detail="Cannot duplicate a disabled version")

    # 1. Quota (parity with create_version; coalesce so an empty source is 0, not None)
    total_size = db.scalar(
        select(func.coalesce(func.sum(Asset.file_size), 0)).where(Asset.version_id == source.id)
    )
    if total_size > settings.max_course_size:
        raise HTTPException(
            status_code=400,
            detail=f"Source assets total size ({total_size}) exceeds limit ({settings.max_course_size})",
        )

    # 2. Asset preflight — every referenced filename must have a backing Asset,
    #    BEFORE any disk write, so render_with_assets can't 422 mid-clone.
    referenced = collect_referenced_filenames(db, source)
    if referenced:
        existing = set(db.execute(
            select(Asset.filename).where(
                Asset.version_id == source.id,
                Asset.filename.in_(referenced),
            )
        ).scalars().all())
        missing = referenced - existing
        if missing:
            raise HTTPException(
                status_code=409,
                detail=f"Source references assets with no backing file: {', '.join(sorted(missing))}",
            )

    # 3. Insert the fresh draft; capture its id as a plain int for cleanup.
    new = CourseVersion(
        course_id=source.course_id,
        state="created",
        is_disabled=False,
        label=data.label,
        info_md=source.info_md,
        info_html="",
        max_quiz_attempts=source.max_quiz_attempts,
    )
    db.add(new)
    db.flush()
    new_id = new.id

    # 4. Copy assets, render info, clone tree, commit — all under cleanup.
    try:
        copy_version_assets(db, source.id, new.id, user.id)
        new.info_html = render_with_assets(db, new.id, new.info_md)
        sync_asset_references(db, new.id, [new.info_md], {"info_version_id": new.id})
        clone_version_content(db, source, new)
        db.commit()
    except Exception:
        db.rollback()
        shutil.rmtree(
            os.path.join(settings.asset_path, "courses", str(new_id)),
            ignore_errors=True,
        )
        raise

    # 5. refresh + return OUTSIDE the try — a post-commit refresh failure must
    #    NOT trigger the abort rmtree on an already-committed version's files.
    db.refresh(new)
    return new


@router.patch("/api/versions/{version_id}", response_model=VersionResponse)
def update_version(
    version_id: int,
    data: VersionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only edit version meta in 'created' state")

    updates = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        return version
    if "info_md" in updates:
        version.info_md = updates["info_md"]
        version.info_html = render_with_assets(db, version.id, updates["info_md"])
        sync_asset_references(db, version.id, [updates["info_md"]], {"info_version_id": version.id})
    if "max_quiz_attempts" in updates:
        version.max_quiz_attempts = updates["max_quiz_attempts"]
    if "label" in updates:
        version.label = updates["label"]

    bump_content_updated_at(version)
    db.commit()
    db.refresh(version)
    return version


@router.post("/api/versions/{version_id}/render", response_model=VersionRenderResponse)
def render_version_md(
    version_id: int,
    data: VersionRenderRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    return VersionRenderResponse(html=render_with_assets(db, version.id, data.content_md))


@router.get("/api/courses/{course_id}/versions", response_model=list[VersionResponse])
def list_versions(course_id: int, limit: int = 100, offset: int = 0, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_or_404(db, Course, course_id)
    is_admin = user.is_superuser or bool(db.scalar(select(exists().where(
        CourseAdmin.user_id == user.id,
        CourseAdmin.course_id == course_id,
    ))))
    if is_admin:
        # Admin path — unchanged.
        versions = db.execute(
            select(CourseVersion)
            .where(CourseVersion.course_id == course_id)
            .order_by(CourseVersion.created_at.desc(), CourseVersion.id.desc())
            .offset(offset)
            .limit(limit)
        ).scalars().all()
        return versions

    # Teacher path: only versions pinned by a RunTeacher row of this user on
    # any run of this course. Returned id ASC (oldest first) — distinct
    # ordering from the admin DESC view so the UI can branch cleanly.
    if not has_run_teacher_on_course(db, user, course_id):
        raise HTTPException(status_code=403, detail="Access denied")
    versions = db.scalars(
        select(CourseVersion)
        .where(
            CourseVersion.course_id == course_id,
            CourseVersion.id.in_(
                select(Run.version_id)
                .select_from(Run)
                .join(RunTeacher, RunTeacher.run_id == Run.id)
                .where(RunTeacher.user_id == user.id)
            ),
        )
        .order_by(CourseVersion.id.asc())
    ).all()
    return [VersionResponse.model_validate(v) for v in versions]


@router.post("/api/versions/{version_id}/publish", response_model=VersionResponse)
def publish_version(version_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
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

    # Re-render all markdown to capture current asset state. If any referenced
    # asset is missing (e.g., force-deleted after the content was saved),
    # render_with_assets raises 422 and the publish fails.
    items_to_render = db.execute(
        select(Item)
        .join(Sequence, Sequence.id == Item.sequence_id)
        .join(Block, Block.id == Sequence.block_id)
        .where(Block.version_id == version_id)
    ).scalars().all()
    for item in items_to_render:
        if item.type == "interactive_app":
            # No content_md; its script AssetReference is maintained by the
            # item endpoint (sync_script_reference), not the markdown sync.
            # Running sync_asset_references here would delete-then-rebuild-
            # nothing and wipe that reference.
            continue
        item.content_html = render_with_assets(db, version_id, item.content_md)
        sync_asset_references(db, version_id, [item.content_md], {"item_id": item.id})

    questions_to_render = db.execute(
        select(Question)
        .join(Item, Item.id == Question.item_id)
        .join(Sequence, Sequence.id == Item.sequence_id)
        .join(Block, Block.id == Sequence.block_id)
        .where(Block.version_id == version_id)
    ).scalars().all()
    for q in questions_to_render:
        q.text_html = render_with_assets(db, version_id, q.text_md)
        q.explanation_html = render_with_assets(db, version_id, q.explanation_md)
        sync_asset_references(db, version_id, [q.text_md, q.explanation_md], {"question_id": q.id})

    version.info_html = render_with_assets(db, version_id, version.info_md)
    sync_asset_references(db, version_id, [version.info_md], {"info_version_id": version.id})

    version.state = "published"
    version.published_at = datetime.now(timezone.utc)
    bump_content_updated_at(version)
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
    today = date.today()
    active_run = db.execute(
        select(Run).where(
            Run.version_id == version_id,
            Run.is_published == True,  # noqa: E712
            Run.end_date >= today,
        ).limit(1)
    ).scalar_one_or_none()
    if active_run is not None:
        raise HTTPException(
            status_code=409,
            detail="Cannot disable version with active runs (published and not ended)",
        )
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
