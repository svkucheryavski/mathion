import asyncio, logging, smtplib
from datetime import datetime, timezone, timedelta

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError, PendingRollbackError, NoResultFound
from sqlalchemy.orm import joinedload

from mathion.config import settings
from mathion.database import SessionLocal
from mathion.models import Run, CourseVersion, MiniProject, Submission
from mathion.models_auth import User, NotificationLogEntry

from .errors import classify
from .templates import render, _build_email_message, RenderContext


logger = logging.getLogger("mathion.notifications")


def _build_render_context(db, row: NotificationLogEntry) -> RenderContext:
    payload = row.payload or {}
    if "run_id" not in payload:
        raise KeyError(f"payload missing run_id for kind={row.kind!r}")

    # (1) Run — eager-load the version+course chain so the @property doesn't fan out.
    run = db.execute(
        select(Run)
        .options(joinedload(Run.version).joinedload(CourseVersion.course))
        .where(Run.id == payload["run_id"])
    ).scalar_one_or_none()
    if run is None:
        raise LookupError(f"referent missing: run:{payload['run_id']}")

    # (2) User — the recipient.
    user = db.get(User, row.user_id)
    if user is None:
        raise LookupError(f"referent missing: user:{row.user_id}")

    # (3) MiniProject if present in payload.
    mp = None
    if "mini_project_id" in payload:
        mp = db.execute(
            select(MiniProject)
            .options(joinedload(MiniProject.block))
            .where(MiniProject.id == payload["mini_project_id"])
        ).scalar_one_or_none()
        if mp is None:
            raise LookupError(f"referent missing: mini_project:{payload['mini_project_id']}")

    # (4) Submission if present in payload.
    sub = None
    if "submission_id" in payload:
        sub = db.get(Submission, payload["submission_id"])
        if sub is None:
            raise LookupError(f"referent missing: submission:{payload['submission_id']}")

    return RenderContext(user=user, run=run, base_url=settings.base_url, mp=mp, sub=sub)
