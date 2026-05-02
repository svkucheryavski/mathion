import os
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.assets import sanitize_filename
from mathion.config import settings
from mathion.database import Base


def bump_content_updated_at(version) -> None:
    """Mark a CourseVersion's content as updated (for ETag/cache invalidation)."""
    version.content_updated_at = datetime.now(timezone.utc)


def to_utc_aware(dt: datetime | None) -> datetime | None:
    """Normalize a datetime read from the DB (which may be tz-naive on SQLite
    or tz-aware on Postgres) to a tz-aware UTC datetime for safe comparisons."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


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


def is_run_admin_or_teacher(db: Session, user, run) -> bool:
    """Return True if user is course admin of run.course OR run teacher OR superuser."""
    from mathion.models import CourseAdmin, CourseVersion, RunTeacher

    if user.is_superuser:
        return True
    version = db.get(CourseVersion, run.version_id)
    is_admin = db.execute(
        select(CourseAdmin).where(
            CourseAdmin.course_id == version.course_id,
            CourseAdmin.user_id == user.id,
        )
    ).scalar_one_or_none() is not None
    if is_admin:
        return True
    is_teacher = db.execute(
        select(RunTeacher).where(
            RunTeacher.run_id == run.id,
            RunTeacher.user_id == user.id,
        )
    ).scalar_one_or_none() is not None
    return is_teacher


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


def remove_run_student(db: Session, run, user_id: int) -> bool:
    """Remove a student from a run.

    1. Look up RunStudent for (run.id, user_id). Return False if not found.
    2. Delete the RunStudent row and flush.
    3. Check whether the user has any other RunStudent on any version of
       the same course (joins Run -> CourseVersion -> course_id).
    4. If no siblings remain, set StudentEnrollment.is_active = False
       for (user_id, run.version_id).
    5. Caller must commit.

    Returns True if a row was deleted, False if no matching RunStudent.
    """
    from mathion.models import CourseVersion, Run, RunStudent
    from mathion.models_auth import StudentEnrollment

    rs = db.execute(
        select(RunStudent).where(RunStudent.run_id == run.id, RunStudent.user_id == user_id)
    ).scalar_one_or_none()
    if rs is None:
        return False

    db.delete(rs)
    db.flush()

    other = db.execute(
        select(RunStudent.id)
        .join(Run, Run.id == RunStudent.run_id)
        .join(CourseVersion, CourseVersion.id == Run.version_id)
        .where(
            RunStudent.user_id == user_id,
            CourseVersion.course_id == run.version.course_id,
        )
        .limit(1)
    ).first()
    if other is None:
        enrollment = db.execute(
            select(StudentEnrollment).where(
                StudentEnrollment.user_id == user_id,
                StudentEnrollment.version_id == run.version_id,
            )
        ).scalar_one_or_none()
        if enrollment:
            enrollment.is_active = False
    return True


def has_submissions(db: Session, run) -> bool:
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


def build_submission_filename(block_order: int, group_name: str, submission_number: int) -> str:
    """Build sanitized filename for a submission PDF.

    Pattern: 'block {N} - group {G} - submission {S}.pdf' passed through
    Phase 6's sanitize_filename. Group names like '3-12a' pass through unchanged;
    'Group #1!' becomes 'group-1'.
    """
    raw = f"block {block_order} - group {group_name} - submission {submission_number}.pdf"
    return sanitize_filename(raw)


def build_feedback_filename(block_order: int, group_name: str, submission_number: int) -> str:
    """Build sanitized filename for a feedback PDF (parallel to submission)."""
    raw = f"block {block_order} - group {group_name} - submission {submission_number} - feedback.pdf"
    return sanitize_filename(raw)


def submission_storage_dir(run_id: int, group_id: int) -> str:
    """Filesystem directory for a group's submissions on a run.

    Layout: <asset_path>/runs/{run_id}/submissions/{group_id}/. Lives under
    the per-run tree so run force-delete (Task 11) wipes a single subtree.
    """
    return os.path.join(settings.asset_path, "runs", str(run_id), "submissions", str(group_id))


def run_asset_storage_dir(run_id: int) -> str:
    """Filesystem directory for run-scoped asset files.

    Layout: <asset_path>/runs/{run_id}/assets/. Lives under the per-run tree
    alongside submissions so run force-delete wipes a single subtree.
    """
    return os.path.join(settings.asset_path, "runs", str(run_id), "assets")


def mini_project_visible_to_student(run, mini_project) -> bool:
    """Return True iff a non-admin/non-teacher student should see this mini-project.

    Visibility = run.is_published AND mini_project.is_published. Used at the start
    of every student-path branch in mini-project, submission, evaluation,
    feedback-file, and run-asset reads. Admins/run-teachers bypass this check.
    """
    return run.is_published and mini_project.is_published


def get_submitter_group(db: Session, run_id: int, user_id: int):
    """Return the (single) group on this run for the user, or None."""
    from mathion.models import Group, RunStudent

    rs = db.execute(
        select(RunStudent).where(
            RunStudent.run_id == run_id,
            RunStudent.user_id == user_id,
        )
    ).scalar_one_or_none()
    if rs is None or rs.group_id is None:
        return None
    return db.get(Group, rs.group_id)


def render_with_run_assets(db: Session, run_id: int, content_md: str | None) -> str:
    """Render markdown for mini-project assignment, validating asset refs.

    Mirrors `render_with_assets` (helpers.py:179) but resolves filenames
    against `RunAsset` (filtered by run_id) instead of `Asset`. Rewrites bare
    filenames to `/api/runs/{run_id}/assets/{filename}` paths in the rendered HTML.
    Raises 422 if any referenced filename is missing from this run's assets.
    """
    from mathion.markdown import extract_asset_filenames, render_markdown
    from mathion.models import RunAsset

    if not content_md:
        return render_markdown(content_md)

    html = render_markdown(content_md)
    ref_filenames = extract_asset_filenames(content_md)
    if not ref_filenames:
        return html

    existing = set(db.execute(
        select(RunAsset.filename).where(
            RunAsset.run_id == run_id,
            RunAsset.filename.in_(ref_filenames),
        )
    ).scalars().all())
    missing = ref_filenames - existing
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Referenced run-assets not found: {', '.join(sorted(missing))}",
        )

    # Rewrite bare filenames to run-scoped URLs. Mirror Phase 6's
    # resolve_asset_urls (markdown.py:71) style — use html.replace, not regex.
    base_url = f"/api/runs/{run_id}/assets"
    for filename in ref_filenames:
        html = html.replace(f'src="{filename}"', f'src="{base_url}/{filename}"')
        html = html.replace(f'href="{filename}"', f'href="{base_url}/{filename}"')
    return html


def sync_run_asset_references(db: Session, run_id: int, content_md: str | None, mini_project_id: int) -> None:
    """Sync RunAssetReference rows for a single mini-project.

    Mirrors `sync_asset_references` (helpers.py:215): deletes all
    RunAssetReference rows for this mini_project_id, then re-inserts rows for
    filenames currently referenced in the markdown. This handles markdown edits
    that remove references — the deleted-rows pass cleans them up.

    Call after `render_with_run_assets` has validated that all referenced
    filenames exist in the run's assets.
    """
    from sqlalchemy import delete as sa_delete
    from mathion.markdown import extract_asset_filenames
    from mathion.models import RunAsset, RunAssetReference

    db.execute(sa_delete(RunAssetReference).where(
        RunAssetReference.mini_project_id == mini_project_id,
    ))

    if not content_md:
        return
    ref_filenames = extract_asset_filenames(content_md)
    if not ref_filenames:
        return

    asset_ids = db.execute(
        select(RunAsset.id).where(
            RunAsset.run_id == run_id,
            RunAsset.filename.in_(ref_filenames),
        )
    ).scalars().all()
    for aid in asset_ids:
        db.add(RunAssetReference(run_asset_id=aid, mini_project_id=mini_project_id))
