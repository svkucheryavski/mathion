import logging

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, require_run_admin_or_teacher
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Block, Item, Run, Sequence
from mathion.models_auth import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["dashboard"])


def _load_sequences(db: Session, version_id: int) -> list[dict]:
    """Return ordered sequence metadata for a course version."""
    rows = db.execute(
        select(
            Block.id, Block.order, Block.title,
            Sequence.id, Sequence.order, Sequence.title,
            func.count(Item.id),
            func.coalesce(
                func.max(case((Item.type == "quiz", 1), else_=0)),
                0,
            ),
        )
        .select_from(Sequence)
        .join(Block, Block.id == Sequence.block_id)
        .outerjoin(Item, Item.sequence_id == Sequence.id)
        .where(Block.version_id == version_id)
        .group_by(Block.id, Block.order, Block.title,
                  Sequence.id, Sequence.order, Sequence.title)
        .order_by(Block.order, Sequence.order)
    ).all()

    return [
        {
            "block_id": b_id,
            "block_order": b_order,
            "block_title": b_title,
            "sequence_id": s_id,
            "sequence_order": s_order,
            "sequence_title": s_title,
            "total_items": int(total),
            "has_quiz_items": bool(has_quiz),
        }
        for (b_id, b_order, b_title, s_id, s_order, s_title, total, has_quiz) in rows
    ]


@router.get("/api/runs/{run_id}/dashboard/progress")
def get_progress(
    run_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)

    sequences = _load_sequences(db, run.version_id)
    return {
        "run": {
            "id": run.id,
            "title": run.title,
            "groups_enabled": run.groups_enabled,
            "version_is_disabled": run.version.is_disabled,
        },
        "sequences": sequences,
        "students": [],
    }


@router.get("/api/runs/{run_id}/dashboard/mini-projects")
def get_mini_projects(
    run_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    # Stub — full body added in Tasks 8-9.
    return {
        "run": {
            "id": run.id,
            "title": run.title,
            "groups_enabled": run.groups_enabled,
        },
        "mini_projects": [],
    }
