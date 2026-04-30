from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, require_run_admin_or_teacher
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Group, Run, RunStudent, Submission
from mathion.models_auth import User
from mathion.schemas import GroupCreate, GroupResponse, GroupUpdate

router = APIRouter(tags=["groups"])


def _to_response(g: Group, count: int) -> dict:
    return {"id": g.id, "run_id": g.run_id, "name": g.name, "is_disabled": g.is_disabled, "student_count": count}


@router.post("/api/runs/{run_id}/groups", status_code=201, response_model=GroupResponse)
def create_group(run_id: int, data: GroupCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    g = Group(run_id=run_id, name=data.name)
    db.add(g)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Group name already exists in this run")
    db.refresh(g)
    return _to_response(g, 0)


@router.get("/api/runs/{run_id}/groups", response_model=list[GroupResponse])
def list_groups(run_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    rows = db.execute(
        select(Group, func.count(RunStudent.id))
        .outerjoin(RunStudent, RunStudent.group_id == Group.id)
        .where(Group.run_id == run_id)
        .group_by(Group.id)
        .order_by(Group.name)
    ).all()
    return [_to_response(g, count) for g, count in rows]


@router.patch("/api/groups/{group_id}", response_model=GroupResponse)
def patch_group(group_id: int, data: GroupUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    g = get_or_404(db, Group, group_id)
    run = get_or_404(db, Run, g.run_id)
    require_run_admin_or_teacher(db, user, run)
    updates = data.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(g, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Group name already exists in this run")
    db.refresh(g)
    count = db.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == g.id))
    return _to_response(g, count)


@router.delete("/api/groups/{group_id}", status_code=204)
def delete_group(group_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    g = get_or_404(db, Group, group_id)
    run = get_or_404(db, Run, g.run_id)
    require_run_admin_or_teacher(db, user, run)
    count = db.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == group_id))
    if count > 0:
        raise HTTPException(status_code=409, detail="Group has students; reassign or remove first")
    sub_count = db.scalar(select(func.count(Submission.id)).where(Submission.group_id == group_id))
    if sub_count and sub_count > 0:
        raise HTTPException(status_code=409, detail="Group has submissions; disable instead")
    db.delete(g)
    db.commit()
