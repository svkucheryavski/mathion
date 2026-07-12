import secrets
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DBSession

from mathion.auth import hash_token
from mathion.models_auth import SuperuserPanelToken

PANEL_INACTIVITY_SECONDS = 30 * 60  # 1800 — sliding inactivity window
PANEL_BUMP_THROTTLE_SECONDS = 5 * 60  # 300 — at most one last_active_at write per interval


def mint(db: DBSession) -> str:
    """Replace the active panel token (delete-then-insert, single transaction).

    Returns the raw URL-safe token; only its hash is stored.
    """
    db.execute(delete(SuperuserPanelToken))
    raw = secrets.token_urlsafe(32)
    db.add(SuperuserPanelToken(token_hash=hash_token(raw)))
    db.commit()
    return raw


def destroy_active(db: DBSession) -> None:
    """Delete the active panel token (no-op if none)."""
    db.execute(delete(SuperuserPanelToken))
    db.commit()


def validate(db: DBSession, token: str) -> SuperuserPanelToken:
    """Return the token row, or raise 404 on absent/expired.

    Enforces the 30-min sliding inactivity window (deleting an expired row) and
    bumps last_active_at at most once per 5 min.
    """
    row = db.execute(
        select(SuperuserPanelToken).where(SuperuserPanelToken.token_hash == hash_token(token))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Not Found")

    now = datetime.now(timezone.utc)
    last_active = row.last_active_at
    if last_active is not None and last_active.tzinfo is None:
        # SQLite may store naive datetimes; treat as UTC (mirrors auth.py:150-153).
        last_active = last_active.replace(tzinfo=timezone.utc)

    if last_active is None or (now - last_active).total_seconds() > PANEL_INACTIVITY_SECONDS:
        db.delete(row)
        db.commit()
        raise HTTPException(status_code=404, detail="Not Found")

    if (now - last_active).total_seconds() > PANEL_BUMP_THROTTLE_SECONDS:
        row.last_active_at = now
        db.commit()

    return row
