import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, require_run_admin_or_teacher
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Run
from mathion.models_auth import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["dashboard"])


@router.get("/api/runs/{run_id}/dashboard/progress")
def get_progress(
    run_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    # Stub — full body added in Tasks 5-7.
    return {
        "run": {
            "id": run.id,
            "title": run.title,
            "groups_enabled": run.groups_enabled,
            "version_is_disabled": run.version.is_disabled,
        },
        "sequences": [],
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
