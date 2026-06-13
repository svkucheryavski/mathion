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

    run_id = payload.get("run_id")
    if run_id is None:
        raise LookupError(f"referent missing: payload run_id absent for row id={row.id}")
    run = db.execute(
        select(Run)
        .where(Run.id == run_id)
        .options(joinedload(Run.version).joinedload(CourseVersion.course))
    ).scalars().first()
    if run is None:
        raise LookupError(f"referent missing: run id={run_id}")

    user = db.get(User, row.user_id)
    if user is None:
        raise LookupError(f"referent missing: user id={row.user_id}")

    mp = None
    if "mini_project_id" in payload:
        mp = db.get(MiniProject, payload["mini_project_id"])
        if mp is None:
            raise LookupError(f"referent missing: mp id={payload['mini_project_id']}")

    sub = None
    if "submission_id" in payload:
        sub = db.get(Submission, payload["submission_id"])
        if sub is None:
            raise LookupError(f"referent missing: submission id={payload['submission_id']}")

    return RenderContext(user=user, run=run, base_url=settings.base_url, mp=mp, sub=sub)
