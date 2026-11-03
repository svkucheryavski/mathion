"""D22: `users.last_seen_at` is set at sign-in and bumped together with the
session's throttled `last_active_at`, so "Last active" survives logout."""
from datetime import datetime, timedelta, timezone

from mathion.auth import hash_token, request_pin, validate_session, verify_pin
from mathion.models_auth import Session


def _near_now(t: datetime | None) -> bool:
    return t is not None and abs((datetime.now(timezone.utc) - t).total_seconds()) < 5


def _sign_in(db, user) -> str:
    return verify_pin(db, user.email, request_pin(db, user.email), duration_days=7)


def test_verify_pin_sets_last_seen(db, test_user):
    assert test_user.last_seen_at is None
    _sign_in(db, test_user)
    db.refresh(test_user)
    assert _near_now(test_user.last_seen_at)


def test_throttled_bump_updates_last_seen(db, test_user):
    token = _sign_in(db, test_user)
    old = datetime.now(timezone.utc) - timedelta(minutes=10)
    session = db.query(Session).filter_by(token_hash=hash_token(token)).one()
    session.last_active_at = old
    test_user.last_seen_at = old
    db.commit()

    assert validate_session(db, token) is not None
    db.refresh(session)
    db.refresh(test_user)
    assert _near_now(session.last_active_at)
    assert _near_now(test_user.last_seen_at)


def test_no_bump_inside_throttle(db, test_user):
    token = _sign_in(db, test_user)
    recent = datetime.now(timezone.utc) - timedelta(minutes=1)
    session = db.query(Session).filter_by(token_hash=hash_token(token)).one()
    session.last_active_at = recent
    test_user.last_seen_at = recent
    db.commit()

    assert validate_session(db, token) is not None
    db.refresh(test_user)
    assert test_user.last_seen_at == recent
