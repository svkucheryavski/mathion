import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from mathion.config import settings
from mathion.models_auth import LoginPIN, Session, User


def hash_token(value: str) -> str:
    """Hash a token or PIN using SHA-256 with the app secret as salt."""
    salted = f"{settings.secret_key}:{value}"
    return hashlib.sha256(salted.encode()).hexdigest()


def verify_pin_hash(raw_pin: str, pin_hash: str) -> bool:
    return hash_token(raw_pin) == pin_hash


def generate_pin() -> str:
    """Generate a 6-digit PIN."""
    return f"{secrets.randbelow(1000000):06d}"


def generate_session_token() -> str:
    """Generate a cryptographically random session token."""
    return secrets.token_urlsafe(32)


def request_pin(db: DBSession, email: str) -> str | None:
    """Create a login PIN for the given email. Returns raw PIN or None if user not found."""
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user or user.is_disabled:
        return None

    raw_pin = generate_pin()
    pin = LoginPIN(
        user_id=user.id,
        pin_hash=hash_token(raw_pin),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.pin_expiry_minutes),
    )
    db.add(pin)
    db.commit()
    return raw_pin


def verify_pin(db: DBSession, email: str, raw_pin: str, duration_days: int) -> str | None:
    """Verify a PIN and create a session. Returns session token or None."""
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user or user.is_disabled:
        return None

    # Find valid, unused PIN
    pin = db.execute(
        select(LoginPIN)
        .where(
            LoginPIN.user_id == user.id,
            LoginPIN.is_used == False,  # noqa: E712
            LoginPIN.expires_at > datetime.now(timezone.utc),
        )
        .order_by(LoginPIN.created_at.desc())
    ).scalar_one_or_none()

    if not pin or not verify_pin_hash(raw_pin, pin.pin_hash):
        return None

    # Mark PIN as used
    pin.is_used = True

    # Create session
    raw_token = generate_session_token()
    session = Session(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=duration_days),
    )
    db.add(session)
    db.commit()
    return raw_token


def validate_session(db: DBSession, raw_token: str) -> User | None:
    """Validate a session token. Returns the user or None."""
    token_hash = hash_token(raw_token)
    session = db.execute(
        select(Session).where(
            Session.token_hash == token_hash,
            Session.expires_at > datetime.now(timezone.utc),
        )
    ).scalar_one_or_none()

    if not session:
        return None

    user = db.get(User, session.user_id)
    if not user or user.is_disabled:
        db.delete(session)
        db.commit()
        return None

    return user


def invalidate_all_sessions(db: DBSession, user_id: int) -> None:
    """Delete all sessions for a user."""
    sessions = db.execute(select(Session).where(Session.user_id == user_id)).scalars().all()
    for s in sessions:
        db.delete(s)
    db.commit()


def destroy_session(db: DBSession, raw_token: str) -> None:
    """Delete a specific session (logout)."""
    token_hash = hash_token(raw_token)
    session = db.execute(
        select(Session).where(Session.token_hash == token_hash)
    ).scalar_one_or_none()
    if session:
        db.delete(session)
        db.commit()
