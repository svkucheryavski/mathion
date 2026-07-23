import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.api import advisory
from mathion.api.helpers import (
    STUDENT_ALREADY_ACTIVE_ERROR_CODE,
    enroll_user_in_run,
    find_student_active_conflicts,
    get_or_404,
    get_or_create_user,
    make_already_active_409_body,
    remove_run_student,
    require_run_admin_or_teacher,
)
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Group, Run, RunStudent
from mathion.models_auth import User
from mathion.schemas import (
    RunStudentBatchRequest,
    RunStudentBatchResponse,
    RunStudentBulkDeleteRequest,
    RunStudentBulkDeleteResponse,
    RunStudentBulkMoveRequest,
    RunStudentBulkMoveResponse,
    RunStudentCreate,
    RunStudentResponse,
    RunStudentUpdate,
)

logger = logging.getLogger(__name__)

RUN_UNPUBLISHED_ERROR_CODE = "run_unpublished"

router = APIRouter(tags=["run_roster"])


def _to_response(rs: RunStudent) -> dict:
    return {
        "id": rs.id, "run_id": rs.run_id, "user_id": rs.user_id,
        "user_email": rs.user.email, "user_full_name": rs.user.full_name,
        "group_id": rs.group_id, "created_at": rs.created_at,
    }


@router.post(
    "/api/runs/{run_id}/students",
    status_code=201,
    response_model=RunStudentResponse,
    responses={409: {
        "description": "Run is not published",
        "content": {"application/json": {"example": {
            "detail": "Cannot add students to an unpublished run",
            "error_code": "run_unpublished"}}}}})
def add_student(run_id: int, data: RunStudentCreate, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    if not run.is_published:
        return JSONResponse(
            status_code=409,
            content={"detail": "Cannot add students to an unpublished run",
                     "error_code": RUN_UNPUBLISHED_ERROR_CODE})
    if data.group_id is not None:
        g = db.get(Group, data.group_id)
        if g is None or g.run_id != run_id:
            raise HTTPException(status_code=400, detail="Group not in this run")
        if g.is_disabled:
            raise HTTPException(status_code=409, detail="Cannot add students to disabled group")

    # L2/M6: check runs AFTER input-validation, BEFORE side effects.
    # Resolve user only — do NOT create. If user doesn't exist, no conflict
    # possible (no RunStudent row to compare against).
    existing_user = db.execute(
        select(User).where(User.email == data.email)
    ).scalar_one_or_none()
    if existing_user is not None:
        conflicts = find_student_active_conflicts(
            db,
            existing_user.id,
            course_id=run.version.course_id,
            exclude_run_id=run.id,
        )
        if conflicts:
            conflict_dicts = [
                {
                    "user_id": existing_user.id,
                    "email": existing_user.email,
                    "run_id": rid_other,
                    "run_title": title,
                }
                for (rid_other, title) in conflicts
            ]
            detail = (
                f"{data.email} is already active in run "
                f"\"{conflict_dicts[0]['run_title']}\" of the same course."
            )
            return JSONResponse(
                status_code=409,
                content=make_already_active_409_body(
                    conflict_dicts, summary_override=detail
                ),
            )

    target = get_or_create_user(db, data.email)
    rs = enroll_user_in_run(db, target, run, data.group_id)
    db.commit()
    db.refresh(rs)
    return _to_response(rs)


@router.get("/api/runs/{run_id}/students", response_model=list[RunStudentResponse])
def list_students(run_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    rows = db.execute(
        select(RunStudent).where(RunStudent.run_id == run_id).order_by(RunStudent.created_at, RunStudent.id)
    ).scalars().all()
    return [_to_response(rs) for rs in rows]


@router.patch("/api/runs/{run_id}/students/{user_id}", response_model=RunStudentResponse)
def patch_student(run_id: int, user_id: int, data: RunStudentUpdate,
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    rs = db.execute(
        select(RunStudent).where(RunStudent.run_id == run_id, RunStudent.user_id == user_id)
    ).scalar_one_or_none()
    if not rs:
        raise HTTPException(status_code=404, detail="Student not in run")

    updates = data.model_dump(exclude_unset=True)
    if "group_id" in updates:
        new_gid = updates["group_id"]
        if new_gid is not None:
            g = db.get(Group, new_gid)
            if g is None or g.run_id != run_id:
                raise HTTPException(status_code=400, detail="Group not in this run")
            if g.is_disabled:
                raise HTTPException(status_code=409, detail="Cannot move student into disabled group")
            advisory.advisory_xact_lock(db, advisory.LOCK_NS_CAPACITY, run_id)
            count = db.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == new_gid))
            advisory.interleave_hook("capacity")
            if count >= advisory.MAX_GROUP_SIZE and rs.group_id != new_gid:
                raise HTTPException(status_code=409, detail="Group capacity reached")
        rs.group_id = new_gid

    db.commit()
    db.refresh(rs)
    return _to_response(rs)


@router.delete("/api/runs/{run_id}/students/{user_id}", status_code=204)
def remove_student(run_id: int, user_id: int, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    if not remove_run_student(db, run, user_id):
        raise HTTPException(status_code=404, detail="Student not in run")
    db.commit()


@router.post(
    "/api/runs/{run_id}/students/batch",
    status_code=207,
    response_model=RunStudentBatchResponse,
    responses={409: {
        "description": "Run is not published",
        "content": {"application/json": {"example": {
            "detail": "Cannot add students to an unpublished run",
            "error_code": "run_unpublished"}}}}})
def add_students_batch(
    run_id: int,
    data: RunStudentBatchRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    if not run.is_published:
        return JSONResponse(
            status_code=409,
            content={"detail": "Cannot add students to an unpublished run",
                     "error_code": RUN_UNPUBLISHED_ERROR_CODE})
    results = []
    course_id = run.version.course_id

    for row in data.rows:
        # User creation happens at the outer transaction; safe to keep even if
        # the per-row enrollment later fails.
        target = get_or_create_user(db, row.email)

        # M5: enforce one-active-RunStudent-per-course invariant. Check fires
        # IMMEDIATELY after get_or_create_user and BEFORE any side effects
        # (full_name mutation, Group lookup/creation, enroll_user_in_run) so
        # rejected rows don't mutate target user state or create orphan groups.
        conflicts = find_student_active_conflicts(
            db, target.id, course_id=course_id, exclude_run_id=run.id
        )
        if conflicts:
            results.append({
                "email": row.email,
                "status": "error",
                "detail": f"Already active in '{conflicts[0][1]}'",
                "error_code": STUDENT_ALREADY_ACTIVE_ERROR_CODE,
            })
            continue

        sp = db.begin_nested()
        try:
            if row.name and not target.full_name:
                target.full_name = row.name
            gid: int | None = None
            if row.group:
                g = db.execute(
                    select(Group).where(Group.run_id == run_id, Group.name == row.group)
                ).scalar_one_or_none()
                if g is None:
                    g = Group(run_id=run_id, name=row.group)
                    db.add(g)
                    db.flush()
                elif g.is_disabled:
                    raise HTTPException(status_code=409, detail=f"Cannot add students to disabled group '{row.group}'")
                gid = g.id

            rs = enroll_user_in_run(db, target, run, gid)
            sp.commit()
            results.append({"email": row.email, "status": "added", "group_id": rs.group_id})
        except HTTPException as e:
            sp.rollback()
            results.append({"email": row.email, "status": "error", "detail": e.detail})
        except Exception:  # noqa: BLE001
            logger.exception("Unexpected error in batch student add for %s", row.email)
            sp.rollback()
            results.append({"email": row.email, "status": "error", "detail": "internal error"})

    db.commit()
    return {"results": results}


@router.post(
    "/api/runs/{run_id}/students/bulk-delete",
    status_code=207,
    response_model=RunStudentBulkDeleteResponse,
)
def bulk_delete_students(
    run_id: int,
    data: RunStudentBulkDeleteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)

    results = []
    for uid in data.user_ids:
        sp = db.begin_nested()
        try:
            if remove_run_student(db, run, uid):
                sp.commit()
                results.append({"user_id": uid, "status": "ok"})
            else:
                sp.rollback()
                results.append({
                    "user_id": uid, "status": "error",
                    "detail": "Student not in run", "error_code": "not_in_run",
                })
        except HTTPException as e:
            sp.rollback()
            # No code: HTTPException from helpers is not a known per-row
            # business error today; frontend should fall back to detail.
            results.append({"user_id": uid, "status": "error", "detail": e.detail})
        except Exception:  # noqa: BLE001
            logger.exception("Unexpected error in bulk-delete for user %s on run %s", uid, run_id)
            sp.rollback()
            results.append({
                "user_id": uid, "status": "error",
                "detail": "internal error", "error_code": "internal_error",
            })

    db.commit()
    ok_count = sum(1 for r in results if r["status"] == "ok")
    return {
        "results": results,
        "summary": {"total": len(results), "ok": ok_count, "error": len(results) - ok_count},
    }


@router.post(
    "/api/runs/{run_id}/students/bulk-move",
    status_code=207,
    response_model=RunStudentBulkMoveResponse,
)
def bulk_move_students(
    run_id: int,
    data: RunStudentBulkMoveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)

    # Pre-flight: validate target group (whole-call failure on bad target).
    # Frontend contract: if target is disabled, filter user_ids client-side
    # before calling. The whole-call 409 here intentionally rejects the call
    # even when every uid is already in the disabled target — this trades a
    # niche no-op carve-out for a simple, structural target-validity invariant.
    if data.group_id is not None:
        g = db.get(Group, data.group_id)
        if g is None or g.run_id != run_id:
            raise HTTPException(status_code=400, detail="Group not in this run")
        if g.is_disabled:
            raise HTTPException(status_code=409, detail="Cannot move student into disabled group")

    # Hold CAPACITY(run_id) across the whole loop (Phase 9-A2): the per-row
    # count-read + UPDATE below is otherwise non-atomic, and the bulk version
    # widens the window because the outer transaction commits only after the
    # whole loop. One run-keyed acquire up front covers every row, so a
    # concurrent bulk-move / add into the same group serializes behind it.
    if data.group_id is not None:
        advisory.advisory_xact_lock(db, advisory.LOCK_NS_CAPACITY, run_id)
    results = []
    for uid in data.user_ids:
        sp = db.begin_nested()
        try:
            rs = db.execute(
                select(RunStudent).where(
                    RunStudent.run_id == run_id, RunStudent.user_id == uid
                )
            ).scalar_one_or_none()
            if rs is None:
                sp.rollback()
                results.append({
                    "user_id": uid, "status": "error",
                    "detail": "Student not in run", "error_code": "not_in_run",
                })
                continue

            # Already in target → no-op success, skip capacity charge.
            if rs.group_id == data.group_id:
                sp.commit()
                results.append({"user_id": uid, "status": "ok", "group_id": data.group_id})
                continue

            if data.group_id is not None:
                # Scope count to this run as defense-in-depth: pre-flight already
                # ensures target group belongs to this run, but a future regression
                # there must not turn the cap into a global count across runs.
                count = db.scalar(
                    select(func.count(RunStudent.id)).where(
                        RunStudent.run_id == run_id,
                        RunStudent.group_id == data.group_id,
                    )
                )
                if count >= advisory.MAX_GROUP_SIZE:
                    sp.rollback()
                    results.append({
                        "user_id": uid, "status": "error",
                        "detail": "Group capacity reached",
                        "error_code": "capacity_reached",
                    })
                    continue

            rs.group_id = data.group_id
            db.flush()  # so next iteration's count includes this row
            sp.commit()
            results.append({"user_id": uid, "status": "ok", "group_id": data.group_id})
        except HTTPException as e:
            sp.rollback()
            # No code: HTTPException raised mid-loop is not a known per-row
            # business error today; frontend should fall back to detail.
            results.append({"user_id": uid, "status": "error", "detail": e.detail})
        except Exception:  # noqa: BLE001
            logger.exception("Unexpected error in bulk-move for user %s on run %s", uid, run_id)
            sp.rollback()
            results.append({
                "user_id": uid, "status": "error",
                "detail": "internal error", "error_code": "internal_error",
            })

    db.commit()
    ok_count = sum(1 for r in results if r["status"] == "ok")
    return {
        "results": results,
        "summary": {"total": len(results), "ok": ok_count, "error": len(results) - ok_count},
    }
