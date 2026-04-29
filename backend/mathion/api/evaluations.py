import os
import tempfile

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.helpers import (
    build_feedback_filename,
    get_or_404,
    mini_project_visible_to_student,
    require_run_admin_or_teacher,
    submission_storage_dir,
)
from mathion.api.mini_projects import _is_admin_or_teacher
from mathion.api.submissions import _get_submitter_group
from mathion.assets import validate_extension
from mathion.config import settings
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Block, Evaluation, Group, MiniProject, Run, RunStudent, Submission
from mathion.models_auth import NotificationLogEntry, User
from mathion.schemas import EvaluationResponse, EvaluationUpdate

router = APIRouter(tags=["evaluations"])

ALLOWED_RESULTS = {"rejected", "major_revision", "minor_revision", "accepted"}


@router.post("/api/submissions/{sid}/evaluation", status_code=201, response_model=EvaluationResponse)
def create_evaluation(
    sid: int,
    result: str = Form(...),
    score: int | None = Form(None),
    feedback_text: str | None = Form(None),
    file: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if result not in ALLOWED_RESULTS:
        raise HTTPException(status_code=422, detail=f"Invalid result: {result}")
    if score is not None and not (0 <= score <= 100):
        raise HTTPException(status_code=422, detail="score must be 0-100")
    if result != "accepted" and file is None:
        raise HTTPException(status_code=422, detail="feedback_file required for this result")

    sub = get_or_404(db, Submission, sid)
    mp = db.get(MiniProject, sub.mini_project_id)
    run = get_or_404(db, Run, mp.run_id)
    require_run_admin_or_teacher(db, user, run)

    if sub.is_resubmission:
        raise HTTPException(status_code=409, detail="Submission was auto-accepted; cannot manually evaluate")

    feedback_filename: str | None = None
    feedback_size: int | None = None
    feedback_abs: str | None = None
    feedback_abs_dir: str | None = None
    content: bytes | None = None
    if file is not None:
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename provided")
        ext = validate_extension(file.filename)
        if ext != "pdf":
            raise HTTPException(status_code=400, detail="feedback_file must be a PDF")
        content = file.file.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Empty feedback file")
        if len(content) > settings.max_file_size:
            raise HTTPException(
                status_code=400,
                detail=f"File size {len(content)} exceeds max {settings.max_file_size}",
            )
        feedback_size = len(content)
        block = db.get(Block, mp.block_id)
        group = db.get(Group, sub.group_id)
        feedback_filename = build_feedback_filename(block.order, group.name, sub.submission_number)
        feedback_abs_dir = submission_storage_dir(run.id, sub.group_id)
        feedback_abs = os.path.join(feedback_abs_dir, feedback_filename)

    ev = Evaluation(
        submission_id=sid,
        evaluated_by=user.id,
        result=result,
        score=score,
        feedback_text=feedback_text,
        feedback_file=feedback_filename,
    )
    db.add(ev)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Already evaluated")

    if feedback_abs is not None:
        tmp_path: str | None = None
        try:
            os.makedirs(feedback_abs_dir, exist_ok=True)
            fd, tmp_path = tempfile.mkstemp(dir=feedback_abs_dir, prefix=".upload-", suffix=".tmp")
            with os.fdopen(fd, "wb") as f:
                f.write(content)
            os.replace(tmp_path, feedback_abs)
            tmp_path = None
        except Exception:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
            db.rollback()
            raise HTTPException(status_code=500, detail="Failed to write feedback file")

    member_ids = db.execute(
        select(RunStudent.user_id).where(
            RunStudent.run_id == run.id,
            RunStudent.group_id == sub.group_id,
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
                "evaluation_id": ev.id,
                "result": result,
            },
        ))

    db.commit()
    db.refresh(ev)
    return ev


@router.get("/api/submissions/{sid}/evaluation", response_model=EvaluationResponse)
def get_evaluation(
    sid: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sub = get_or_404(db, Submission, sid)
    mp = db.get(MiniProject, sub.mini_project_id)
    run = db.get(Run, mp.run_id)
    if not _is_admin_or_teacher(db, user, run):
        if not mini_project_visible_to_student(run, mp):
            raise HTTPException(status_code=403, detail="Not visible")
        group = _get_submitter_group(db, run.id, user.id)
        if group is None or group.id != sub.group_id:
            raise HTTPException(status_code=403, detail="Not a group member")
    ev = db.execute(select(Evaluation).where(Evaluation.submission_id == sid)).scalar_one_or_none()
    if ev is None:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    return ev


@router.patch("/api/evaluations/{eid}", response_model=EvaluationResponse)
def patch_evaluation(
    eid: int,
    data: EvaluationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ev = get_or_404(db, Evaluation, eid)
    sub = db.get(Submission, ev.submission_id)
    mp = db.get(MiniProject, sub.mini_project_id)
    run = get_or_404(db, Run, mp.run_id)
    require_run_admin_or_teacher(db, user, run)

    updates = data.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(ev, field, value)
    if ev.result != "accepted" and ev.feedback_file is None:
        raise HTTPException(status_code=422, detail="feedback_file required for this result")
    db.commit()
    db.refresh(ev)
    return ev


@router.get("/api/evaluations/{eid}/feedback-file")
def get_feedback_file(
    eid: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ev = get_or_404(db, Evaluation, eid)
    sub = db.get(Submission, ev.submission_id)
    mp = db.get(MiniProject, sub.mini_project_id)
    run = db.get(Run, mp.run_id)
    if not _is_admin_or_teacher(db, user, run):
        if not mini_project_visible_to_student(run, mp):
            raise HTTPException(status_code=403, detail="Not visible")
        group = _get_submitter_group(db, run.id, user.id)
        if group is None or group.id != sub.group_id:
            raise HTTPException(status_code=403, detail="Not a group member")
    if ev.feedback_file is None:
        raise HTTPException(status_code=404, detail="No feedback file")
    abs_dir = submission_storage_dir(run.id, sub.group_id)
    abs_path = os.path.join(abs_dir, os.path.basename(ev.feedback_file))
    real_dir = os.path.realpath(abs_dir)
    real_path = os.path.realpath(abs_path)
    if os.path.commonpath([real_dir, real_path]) != real_dir:
        raise HTTPException(status_code=404, detail="File not found")
    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="File missing")
    return FileResponse(abs_path, media_type="application/pdf",
                        filename=os.path.basename(ev.feedback_file))
