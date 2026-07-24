import os
import re
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.assets import sanitize_filename
from mathion.config import settings
from mathion.database import Base
from mathion.models import CourseVersion, Run, RunStudent

if TYPE_CHECKING:
    from mathion.models_auth import User

from mathion.api.text_utils import bump_content_updated_at, slugify, to_utc_aware
from mathion.api.lookups import INT4_MAX, get_newest_published_version, get_or_404, get_or_create_user
from mathion.api.authz import has_run_pinned_to_version, has_run_teacher_on_course, is_run_admin_or_teacher, require_course_admin, require_course_admin_for_run, require_run_admin_or_teacher
from mathion.api.roster_ops import STUDENT_ALREADY_ACTIVE_ERROR_CODE, enroll_user_in_run, find_student_active_conflicts, make_already_active_409_body, remove_run_student


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


def sync_script_reference(
    db: Session,
    version_id: int,
    item_id: int,
    filename: str | None,
) -> list[str]:
    """Maintain the single AssetReference for an interactive_app item's script,
    and garbage-collect the backing JS asset once it is no longer referenced.

    Deletes any existing reference for the item, then (when `filename` is given)
    points a fresh reference at the matching Asset in this version. Repoint-on-
    replace and clear-on-remove both fall out of delete-then-optional-add. This
    is the interactive_app counterpart to the markdown-driven
    `sync_asset_references` — kept separate because an interactive_app item has
    no content_md to extract filenames from.

    Unlike `sync_asset_references`, which leaves an unreferenced asset in place
    so it can be re-referenced from the asset sidebar, an interactive_app script
    asset has NO reuse path — upload is the only way to attach one — so a script
    asset that loses its last reference here is deleted: the row now, the file
    after the caller commits. Deletion is guarded on ref_count == 0, so an asset
    still referenced by another item/question/info page is never removed.

    Returns the filesystem paths of any asset FILES whose rows were deleted, for
    the caller to unlink AFTER commit (best-effort — same rule as delete_asset:
    a leftover file is harmless; a row pointing at a missing file is worse).

    Raises 422 when `filename` names an asset that doesn't exist in the version.
    """
    from sqlalchemy import delete as sa_delete, func
    from mathion.api.assets import _asset_dir
    from mathion.models import Asset, AssetReference

    # Capture the asset(s) this item's script currently references before the
    # reference rows are dropped, so any that become unreferenced can be GC'd.
    prev_asset_ids = set(
        db.scalars(select(AssetReference.asset_id).where(AssetReference.item_id == item_id)).all()
    )

    db.execute(sa_delete(AssetReference).where(AssetReference.item_id == item_id))

    new_asset_id: int | None = None
    if filename is not None:
        new_asset_id = db.scalar(
            select(Asset.id).where(Asset.version_id == version_id, Asset.filename == filename)
        )
        if new_asset_id is None:
            raise HTTPException(
                status_code=422,
                detail=f"No uploaded asset named '{filename}' in this version",
            )
        db.add(AssetReference(asset_id=new_asset_id, item_id=item_id))

    # GC previously-referenced script assets that are now unreferenced (and are
    # not the asset we just re-pointed at). db.scalar autoflushes the pending
    # AssetReference insert, so the count reflects the new reference.
    removed_files: list[str] = []
    for aid in prev_asset_ids:
        if aid == new_asset_id:
            continue
        still_referenced = db.scalar(
            select(func.count()).where(AssetReference.asset_id == aid)
        )
        if still_referenced:
            continue
        asset = db.get(Asset, aid)
        if asset is None:
            continue
        removed_files.append(os.path.join(_asset_dir(asset.version_id), asset.filename))
        db.delete(asset)

    return removed_files


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
