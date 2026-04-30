import os
import tempfile
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.helpers import (
    build_submission_filename,
    get_or_404,
    get_submitter_group,
    is_run_admin_or_teacher,
    mini_project_visible_to_student,
    submission_storage_dir,
    to_utc_aware,
)
from mathion.assets import validate_extension
from mathion.config import settings
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Block, Evaluation, MiniProject, Run, RunStudent, Submission
from mathion.models_auth import NotificationLogEntry, User
from mathion.schemas import SubmissionResponse

router = APIRouter(tags=["submissions"])


# TODO(phase 9): resubmission gate race — two members observing the same
# 'major_revision'/'minor_revision' result can both pass the pending check
# and submit twice for one revision cycle. Address via SAVEPOINT-based
# retry or a per-mini-project advisory lock when we move to Postgres.
def _latest_evaluation_result(db: Session, mini_project_id: int, group_id: int) -> tuple[str | None, int | None]:
    """Return (result, evaluator_user_id) of the latest evaluation for this group's
    latest submission on this mini-project. (None, None) if no submissions or no
    evaluation yet."""
    latest_sub = db.execute(
        select(Submission)
        .where(Submission.mini_project_id == mini_project_id, Submission.group_id == group_id)
        .order_by(Submission.submission_number.desc())
        .limit(1)
    ).scalar_one_or_none()
    if latest_sub is None:
        return None, None
    ev = db.execute(select(Evaluation).where(Evaluation.submission_id == latest_sub.id)).scalar_one_or_none()
    if ev is None:
        return None, None
    return ev.result, ev.evaluated_by


@router.post("/api/mini-projects/{mp_id}/submissions", status_code=201, response_model=SubmissionResponse)
def create_submission(
    mp_id: int,
    file: UploadFile,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mp = get_or_404(db, MiniProject, mp_id)
    run = get_or_404(db, Run, mp.run_id)

    if not mini_project_visible_to_student(run, mp):
        raise HTTPException(status_code=403, detail="Mini-project not visible")

    group = get_submitter_group(db, run.id, user.id)
    if group is None:
        raise HTTPException(status_code=403, detail="Must be a member of a group on this run to submit")
    if group.is_disabled:
        raise HTTPException(status_code=409, detail="Group is disabled")

    # Determine is_resubmission and check preconditions
    latest_result, prev_evaluator = _latest_evaluation_result(db, mp.id, group.id)
    if latest_result == "accepted":
        raise HTTPException(status_code=409, detail="Already accepted; no further submission")
    if latest_result is None:
        # Either no prior submission, or prior submission has no evaluation
        prior_sub = db.execute(
            select(Submission)
            .where(Submission.mini_project_id == mp.id, Submission.group_id == group.id)
            .order_by(Submission.submission_number.desc())
            .limit(1)
        ).scalar_one_or_none()
        if prior_sub is not None:
            raise HTTPException(status_code=409, detail="Previous submission pending evaluation")
        is_resubmission = False
    elif latest_result == "rejected":
        is_resubmission = False  # fresh initial submission per spec
    elif latest_result in ("major_revision", "minor_revision"):
        is_resubmission = True
    else:
        raise HTTPException(status_code=500, detail=f"Unexpected evaluation result: {latest_result}")

    # Deadline gates
    now = datetime.now(timezone.utc)
    hard_aware = to_utc_aware(mp.hard_deadline)
    soft_aware = to_utc_aware(mp.soft_deadline)
    resub_aware = to_utc_aware(mp.resubmission_deadline)
    if not is_resubmission:
        if hard_aware is not None and now > hard_aware:
            raise HTTPException(status_code=409, detail="Initial submission deadline passed")
    else:
        if resub_aware is not None and now > resub_aware:
            raise HTTPException(status_code=409, detail="Resubmission deadline passed")

    # Read file
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    ext = validate_extension(file.filename)
    if ext is None:
        raise HTTPException(status_code=400, detail="File extension not allowed")
    if ext != "pdf":
        raise HTTPException(status_code=400, detail="Submission must be a PDF")
    content = file.file.read(settings.max_file_size + 1)
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > settings.max_file_size:
        raise HTTPException(
            status_code=400,
            detail=f"File size {len(content)} exceeds max {settings.max_file_size}",
        )

    # Determine submission_number
    block = db.get(Block, mp.block_id)
    next_num = (db.scalar(
        select(func.max(Submission.submission_number)).where(
            Submission.mini_project_id == mp.id,
            Submission.group_id == group.id,
        )
    ) or 0) + 1

    filename = build_submission_filename(block.order, group.name, next_num)

    is_late = soft_aware is not None and now > soft_aware

    sub = Submission(
        mini_project_id=mp.id,
        group_id=group.id,
        submission_number=next_num,
        submitted_by=user.id,
        file_path=filename,
        file_size=len(content),
        is_late=is_late,
        is_resubmission=is_resubmission,
        submitted_at=now,
    )
    db.add(sub)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        # One retry on race
        next_num = (db.scalar(
            select(func.max(Submission.submission_number)).where(
                Submission.mini_project_id == mp.id,
                Submission.group_id == group.id,
            )
        ) or 0) + 1
        filename = build_submission_filename(block.order, group.name, next_num)
        sub = Submission(
            mini_project_id=mp.id, group_id=group.id, submission_number=next_num,
            submitted_by=user.id, file_path=filename, file_size=len(content),
            is_late=is_late, is_resubmission=is_resubmission,
            submitted_at=now,
        )
        db.add(sub)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=503, detail="Concurrent submission conflict; retry")

    # Atomic first_submitted_at set
    db.execute(
        MiniProject.__table__.update()
        .where(MiniProject.id == mp.id, MiniProject.first_submitted_at.is_(None))
        .values(first_submitted_at=now)
    )

    # Auto-acceptance for resubmissions + notifications (manual-eval
    # notifications fire in the evaluation endpoint instead).
    if is_resubmission:
        if prev_evaluator is None:
            raise HTTPException(status_code=500, detail="Auto-evaluation failed: no prior evaluator")
        auto_eval = Evaluation(
            submission_id=sub.id,
            evaluated_by=prev_evaluator,
            result="accepted",
        )
        db.add(auto_eval)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=500, detail="Auto-evaluation failed; submission rejected")

        member_ids = db.execute(
            select(RunStudent.user_id).where(
                RunStudent.run_id == run.id,
                RunStudent.group_id == group.id,
            )
        ).scalars().all()
        for uid in member_ids:
            db.add(NotificationLogEntry(
                user_id=uid,
                kind="evaluation_received",
                payload={
                    "run_id": run.id,
                    "mini_project_id": mp.id,
                    "submission_id": sub.id,
                    "evaluation_id": auto_eval.id,
                    "result": "accepted",
                },
            ))

    # Write file via temp+rename
    abs_dir = submission_storage_dir(run.id, group.id)
    abs_path = os.path.join(abs_dir, filename)
    tmp_path: str | None = None
    try:
        os.makedirs(abs_dir, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=abs_dir, prefix=".upload-", suffix=".tmp")
        with os.fdopen(fd, "wb") as f:
            f.write(content)
        os.replace(tmp_path, abs_path)
        tmp_path = None
    except Exception:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to write submission to disk")

    db.commit()
    return sub


@router.get("/api/mini-projects/{mp_id}/submissions", response_model=list[SubmissionResponse])
def list_submissions(
    mp_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mp = get_or_404(db, MiniProject, mp_id)
    run = get_or_404(db, Run, mp.run_id)
    if is_run_admin_or_teacher(db, user, run):
        subs = db.execute(
            select(Submission).where(Submission.mini_project_id == mp_id).order_by(Submission.submitted_at)
        ).scalars().all()
    else:
        if not mini_project_visible_to_student(run, mp):
            raise HTTPException(status_code=403, detail="Mini-project not visible")
        group = get_submitter_group(db, run.id, user.id)
        if group is None:
            raise HTTPException(status_code=403, detail="Not a group member")
        subs = db.execute(
            select(Submission).where(
                Submission.mini_project_id == mp_id,
                Submission.group_id == group.id,
            ).order_by(Submission.submitted_at)
        ).scalars().all()
    return subs


@router.get("/api/submissions/{sid}", response_model=SubmissionResponse)
def get_submission(
    sid: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sub = get_or_404(db, Submission, sid)
    mp = db.get(MiniProject, sub.mini_project_id)
    run = db.get(Run, mp.run_id)
    if is_run_admin_or_teacher(db, user, run):
        return sub
    if not mini_project_visible_to_student(run, mp):
        raise HTTPException(status_code=403, detail="Not visible")
    group = get_submitter_group(db, run.id, user.id)
    if group is None or group.id != sub.group_id:
        raise HTTPException(status_code=403, detail="Not a member of submitting group")
    return sub


@router.get("/api/submissions/{sid}/file")
def get_submission_file(
    sid: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sub = get_or_404(db, Submission, sid)
    mp = db.get(MiniProject, sub.mini_project_id)
    run = db.get(Run, mp.run_id)
    if not is_run_admin_or_teacher(db, user, run):
        if not mini_project_visible_to_student(run, mp):
            raise HTTPException(status_code=403, detail="Not visible")
        group = get_submitter_group(db, run.id, user.id)
        if group is None or group.id != sub.group_id:
            raise HTTPException(status_code=403, detail="Not a member of submitting group")

    abs_dir = submission_storage_dir(run.id, sub.group_id)
    abs_path = os.path.join(abs_dir, os.path.basename(sub.file_path))
    real_dir = os.path.realpath(abs_dir)
    real_path = os.path.realpath(abs_path)
    if os.path.commonpath([real_dir, real_path]) != real_dir:
        raise HTTPException(status_code=404, detail="File not found")
    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="File missing")
    return FileResponse(abs_path, media_type="application/pdf", filename=os.path.basename(sub.file_path))
