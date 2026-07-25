import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.assets import sanitize_filename
from mathion.config import settings


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
