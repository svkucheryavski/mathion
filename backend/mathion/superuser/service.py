import secrets
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import delete, exists, select
from sqlalchemy.orm import Session as DBSession

from mathion.auth import hash_token, request_pin
from mathion.config import settings
from mathion.models_auth import RateLimitEntry, SuperuserPanelToken, User
from mathion.site_settings import load as load_site

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
        # Defensive: coerce any naive datetime to UTC (Postgres TIMESTAMPTZ is
        # already tz-aware; mirrors auth.py).
        last_active = last_active.replace(tzinfo=timezone.utc)

    if last_active is None or (now - last_active).total_seconds() > PANEL_INACTIVITY_SECONDS:
        db.delete(row)
        db.commit()
        raise HTTPException(status_code=404, detail="Not Found")

    if (now - last_active).total_seconds() > PANEL_BUMP_THROTTLE_SECONDS:
        row.last_active_at = now
        db.commit()

    return row


@dataclass
class PinIssued:
    pin: str
    minutes: int  # how long it lasts, from the panel's Settings (D14)


@dataclass
class UnknownUser:
    pass


@dataclass
class DisabledUser:
    pass


@dataclass
class ActivateResult:
    token: str
    url: str
    has_superuser: bool


def create_or_promote_superuser(db: DBSession, email: str) -> User:
    normalized = email.strip().lower()
    if not normalized:
        raise ValueError("email must not be empty")
    if len(normalized) > 254:
        raise ValueError("email must be at most 254 characters")
    user = db.execute(select(User).where(User.email == normalized)).scalar_one_or_none()
    if user is None:
        user = User(email=normalized, is_superuser=True)
        db.add(user)
    else:
        user.is_superuser = True
        user.is_disabled = False  # a bootstrap command must yield a usable superuser
    db.commit()
    db.refresh(user)
    return user


def issue_bootstrap_pin(db: DBSession, email: str) -> "PinIssued | UnknownUser | DisabledUser":
    # D12: the operator's command skips the request limit and clears this
    # email's wrong tries, so with email off it's always a way back in. The
    # wrong-try limit still applies to the PIN it makes.
    normalized = email.strip().lower()
    raw = request_pin(db, normalized, operator=True)
    if raw is not None:
        db.execute(delete(RateLimitEntry).where(RateLimitEntry.key == f"pin_failure:{normalized}"))
        db.commit()
        return PinIssued(pin=raw, minutes=load_site(db).pin_minutes)
    # With operator=True, None means an unknown or a disabled account.
    user = db.execute(select(User).where(User.email == normalized)).scalar_one_or_none()
    return UnknownUser() if user is None else DisabledUser()


def activate_panel(db: DBSession) -> ActivateResult:
    raw = mint(db)
    has_superuser = bool(db.scalar(select(exists().where(User.is_superuser == True))))  # noqa: E712
    url = f"{settings.base_url}/superuser/{raw}"
    return ActivateResult(token=raw, url=url, has_superuser=has_superuser)
