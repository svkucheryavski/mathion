import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DBSession

from mathion.config import settings
from mathion.models_auth import LoginPIN, RateLimitEntry, Session, User


def hash_token(value: str) -> str:
    """Hash a token or PIN using SHA-256 with the app secret as salt."""
    salted = f"{settings.secret_key}:{value}"
    return hashlib.sha256(salted.encode()).hexdigest()


def verify_pin_hash(raw_pin: str, pin_hash: str) -> bool:
    return hmac.compare_digest(hash_token(raw_pin), pin_hash)


def generate_pin() -> str:
    """Generate a 6-digit PIN."""
    return f"{secrets.randbelow(1000000):06d}"


def generate_session_token() -> str:
    """Generate a cryptographically random session token."""
    return secrets.token_urlsafe(32)


def request_pin(db: DBSession, email: str) -> str | None:
    """Create a login PIN for the given email. Returns raw PIN or None if user not found or rate limited."""
    email = email.strip().lower()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user or user.is_disabled:
        return None

    # Rate limit: count PIN requests in last hour.
    # NOTE: Rate limiting is approximate under concurrent requests.
    # For strict enforcement on PostgreSQL, use SELECT ... FOR UPDATE on a per-email lock row.
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    request_count = db.scalar(
        select(func.count()).where(
            RateLimitEntry.key == f"pin_request:{email}",
            RateLimitEntry.created_at > one_hour_ago,
        )
    )
    if request_count >= settings.max_pin_requests_per_hour:
        return None

    # Invalidate any existing unused PINs for this user
    existing_pins = db.execute(
        select(LoginPIN).where(
            LoginPIN.user_id == user.id,
            LoginPIN.is_used == False,  # noqa: E712
        )
    ).scalars().all()
    for p in existing_pins:
        p.is_used = True

    # Record this request for rate limiting
    db.add(RateLimitEntry(key=f"pin_request:{email}"))

    raw_pin = generate_pin()
    pin = LoginPIN(
        user_id=user.id,
        pin_hash=hash_token(raw_pin),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.pin_expiry_minutes),
    )
    db.add(pin)
    db.commit()
    if settings.debug:
        print(f"[auth] PIN for {email}: {raw_pin}", flush=True)
    return raw_pin


def verify_pin(db: DBSession, email: str, raw_pin: str, duration_days: int) -> str | None:
    """Verify a PIN and create a session. Returns session token or None."""
    email = email.strip().lower()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user or user.is_disabled:
        return None

    # Rate limit: count PIN verification failures in last hour
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    failure_count = db.scalar(
        select(func.count()).where(
            RateLimitEntry.key == f"pin_failure:{email}",
            RateLimitEntry.created_at > one_hour_ago,
        )
    )
    if failure_count >= settings.max_pin_failures_per_hour:
        return None

    # Find valid, unused PIN — use .first() as safety net against MultipleResultsFound
    pin = db.execute(
        select(LoginPIN)
        .where(
            LoginPIN.user_id == user.id,
            LoginPIN.is_used == False,  # noqa: E712
            LoginPIN.expires_at > datetime.now(timezone.utc),
        )
        .order_by(LoginPIN.created_at.desc(), LoginPIN.id.desc())
    ).scalars().first()

    if not pin or not verify_pin_hash(raw_pin, pin.pin_hash):
        # Record failure for rate limiting
        db.add(RateLimitEntry(key=f"pin_failure:{email}"))
        db.commit()
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

    # Throttled update of last_active_at (at most once every 5 minutes)
    now = datetime.now(timezone.utc)
    last_active = session.last_active_at
    if last_active is not None and last_active.tzinfo is None:
        # Defensive: Postgres TIMESTAMPTZ always reads back tz-aware, but coerce
        # any naive value to UTC before the arithmetic below.
        last_active = last_active.replace(tzinfo=timezone.utc)
    if last_active is None or (now - last_active).total_seconds() > 300:
        session.last_active_at = now
        db.commit()

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
