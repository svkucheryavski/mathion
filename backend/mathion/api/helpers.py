from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.database import Base


def bump_content_updated_at(version) -> None:
    """Mark a CourseVersion's content as updated (for ETag/cache invalidation)."""
    version.content_updated_at = datetime.now(timezone.utc)


def get_or_404(db: Session, model: type[Base], id: int, detail: str | None = None):
    obj = db.get(model, id)
    if not obj:
        name = model.__name__
        raise HTTPException(status_code=404, detail=detail or f"{name} not found")
    return obj


def get_or_create_user(db: Session, email: str):
    """Return existing user by email, or create a new one with email only."""
    from mathion.models_auth import User

    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        user = User(email=email, full_name=None)
        db.add(user)
        try:
            db.flush()  # flush to detect duplicate from concurrent request
        except IntegrityError:
            db.rollback()
            # Re-query — the other concurrent request already created the user
            user = db.execute(select(User).where(User.email == email)).scalar_one()
    return user


def get_newest_published_version(db: Session, course_id: int):
    """Return the most recently published version for the course, or raise 409."""
    from mathion.models import CourseVersion

    version = db.execute(
        select(CourseVersion)
        .where(CourseVersion.course_id == course_id, CourseVersion.state == "published")
        .order_by(CourseVersion.published_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=409, detail="No published version exists for this course")
    return version


def require_course_admin(db: Session, user, course_id: int):
    """Verify user is course admin or superuser. Raises 403 if not."""
    if user.is_superuser:
        return
    from mathion.models import CourseAdmin
    admin = db.execute(
        select(CourseAdmin).where(
            CourseAdmin.course_id == course_id,
            CourseAdmin.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not admin:
        raise HTTPException(status_code=403, detail="Course admin access required")


def require_course_admin_for_run(db: Session, user, run) -> None:
    """Verify user is course admin for the run's course (or superuser).
    Caller must have already loaded `run` (via get_or_404 etc)."""
    from mathion.models import CourseVersion

    version = get_or_404(db, CourseVersion, run.version_id)
    require_course_admin(db, user, version.course_id)


def require_run_admin_or_teacher(db: Session, user, run) -> None:
    """Verify user is a course admin of the run's course OR a RunTeacher of
    the run OR a superuser. Raises 403 if no access. Caller is expected to
    have already loaded `run` (via `get_or_404` or similar)."""
    from mathion.models import CourseAdmin, CourseVersion, RunTeacher

    if user.is_superuser:
        return

    version = db.get(CourseVersion, run.version_id)
    is_course_admin = db.execute(
        select(CourseAdmin).where(
            CourseAdmin.course_id == version.course_id,
            CourseAdmin.user_id == user.id,
        )
    ).scalar_one_or_none() is not None
    is_run_teacher = db.execute(
        select(RunTeacher).where(
            RunTeacher.run_id == run.id,
            RunTeacher.user_id == user.id,
        )
    ).scalar_one_or_none() is not None
    if not (is_course_admin or is_run_teacher):
        raise HTTPException(status_code=403, detail="Run admin or teacher access required")


def enroll_user_in_run(db: Session, user, run, group_id: int | None):
    """Enroll a user in a run.

    1. Group capacity check (max 10 if group_id given).
    2. Activate StudentEnrollment for run.version_id (deactivates other active
       enrollments on this course via the existing `_enroll_user`).
    3. Create or update RunStudent row. If a RunStudent row already exists for
       this (run, user), its `group_id` is OVERWRITTEN with the new value.
       None means "unassign".
    4. Write a `run_enrolled` notification log row.

    Caller must commit. Raises HTTPException on capacity / disabled-version.

    Note: the capacity check is a SELECT-count + INSERT, not atomic. Two
    concurrent admins could both observe count=9 and both succeed. Real-world
    impact is low (admin operations); a SAVEPOINT-based fix lands in Phase 9.
    """
    from sqlalchemy import func
    from mathion.api.enrollment import _enroll_user
    from mathion.models import CourseVersion, RunStudent
    from mathion.models_auth import NotificationLogEntry

    version = db.get(CourseVersion, run.version_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Run version is disabled")

    if group_id is not None:
        count = db.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == group_id))
        if count >= 10:
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


def _has_submissions(db: Session, run) -> bool:
    """Return True if any Submission row exists for any mini-project on this run.

    Used by:
    - `runs.py:patch_run` — to block lowering `end_date` past `now()` while submissions exist
    - `runs.py:delete_run` — to block deletion when submissions exist (force flag bypasses)
    """
    from sqlalchemy import exists
    from mathion.models import MiniProject, Submission

    return db.scalar(
        select(exists().where(
            Submission.mini_project_id == MiniProject.id,
            MiniProject.run_id == run.id,
        ))
    ) or False


def render_with_assets(db: Session, version_id: int, content_md: str | None) -> str:
    """Render markdown, validating and resolving asset references.

    Validates every referenced asset filename exists in the version (raises
    422 with the missing names if any) and rewrites bare filenames in src/href
    attributes to /assets/{version_id}/{filename} paths.

    Use everywhere that markdown is saved as HTML for a course version:
    item content, question text/explanation, version info_md.
    """
    from mathion.markdown import extract_asset_filenames, render_markdown, resolve_asset_urls
    from mathion.models import Asset

    if not content_md:
        return render_markdown(content_md)

    html = render_markdown(content_md)
    ref_filenames = extract_asset_filenames(content_md)
    if not ref_filenames:
        return html

    existing = set(db.execute(
        select(Asset.filename).where(
            Asset.version_id == version_id,
            Asset.filename.in_(ref_filenames),
        )
    ).scalars().all())
    missing = ref_filenames - existing
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Referenced assets not found in version: {', '.join(sorted(missing))}",
        )
    return resolve_asset_urls(html, version_id, ref_filenames)


def sync_asset_references(
    db: Session,
    version_id: int,
    content_mds: list[str | None],
    owner: dict,
) -> None:
    """Sync AssetReference rows for a single owner (item/question/version-info).

    `content_mds` is a list of markdown strings (e.g., a question's text_md
    plus explanation_md). All referenced filenames across the list are
    aggregated. `owner` is one of `{"item_id": x}`, `{"question_id": x}`,
    `{"info_version_id": x}` and selects the rows to delete + the column to
    set on new rows.

    Call after `render_with_assets` has already validated that all referenced
    assets exist in the version.
    """
    from sqlalchemy import delete as sa_delete
    from mathion.markdown import extract_asset_filenames
    from mathion.models import Asset, AssetReference

    if list(owner.keys()) != [next(iter(owner))]:
        raise ValueError("owner must contain exactly one key")
    col_name = next(iter(owner))
    col_value = owner[col_name]

    all_filenames: set[str] = set()
    for md in content_mds:
        if md:
            all_filenames |= extract_asset_filenames(md)

    db.execute(
        sa_delete(AssetReference).where(
            getattr(AssetReference, col_name) == col_value,
        )
    )

    if not all_filenames:
        return

    asset_ids = db.execute(
        select(Asset.id).where(
            Asset.version_id == version_id,
            Asset.filename.in_(all_filenames),
        )
    ).scalars().all()
    for aid in asset_ids:
        db.add(AssetReference(asset_id=aid, **owner))
