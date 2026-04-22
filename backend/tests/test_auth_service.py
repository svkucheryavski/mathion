from datetime import datetime, timedelta, timezone

from mathion.auth import (
    hash_token, generate_pin, generate_session_token, verify_pin_hash,
    request_pin, verify_pin, validate_session, invalidate_all_sessions,
)
from mathion.models_auth import LoginPIN, Session, User


def test_hash_token_deterministic():
    assert hash_token("abc123") == hash_token("abc123")


def test_hash_token_different_inputs():
    assert hash_token("abc") != hash_token("xyz")


def test_generate_pin_is_6_digits():
    pin = generate_pin()
    assert len(pin) == 6
    assert pin.isdigit()


def test_generate_session_token_length():
    token = generate_session_token()
    assert len(token) >= 43


def test_verify_pin_hash():
    pin = "123456"
    hashed = hash_token(pin)
    assert verify_pin_hash(pin, hashed) is True
    assert verify_pin_hash("654321", hashed) is False


def test_request_pin_creates_pin(db):
    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    result = request_pin(db, "alice@example.com")
    assert result is not None
    assert len(result) == 6

    pins = db.query(LoginPIN).filter_by(user_id=user.id).all()
    assert len(pins) == 1
    assert pins[0].is_used is False


def test_request_pin_unknown_email_returns_none(db):
    result = request_pin(db, "nobody@example.com")
    assert result is None


def test_request_pin_disabled_user_returns_none(db):
    user = User(email="alice@example.com", is_disabled=True)
    db.add(user)
    db.commit()
    result = request_pin(db, "alice@example.com")
    assert result is None


def test_verify_pin_success(db):
    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    raw_pin = request_pin(db, "alice@example.com")
    session_token = verify_pin(db, "alice@example.com", raw_pin, duration_days=7)
    assert session_token is not None

    pin = db.query(LoginPIN).first()
    assert pin.is_used is True

    sessions = db.query(Session).filter_by(user_id=user.id).all()
    assert len(sessions) == 1


def test_verify_pin_wrong_pin(db):
    user = User(email="alice@example.com")
    db.add(user)
    db.commit()
    request_pin(db, "alice@example.com")
    session_token = verify_pin(db, "alice@example.com", "000000", duration_days=7)
    assert session_token is None


def test_verify_pin_expired(db):
    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    pin = LoginPIN(
        user_id=user.id,
        pin_hash=hash_token("123456"),
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    db.add(pin)
    db.commit()

    result = verify_pin(db, "alice@example.com", "123456", duration_days=7)
    assert result is None


def test_verify_pin_already_used(db):
    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    raw_pin = request_pin(db, "alice@example.com")
    verify_pin(db, "alice@example.com", raw_pin, duration_days=7)
    result = verify_pin(db, "alice@example.com", raw_pin, duration_days=7)
    assert result is None


def test_validate_session_token(db):
    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    raw_pin = request_pin(db, "alice@example.com")
    token = verify_pin(db, "alice@example.com", raw_pin, duration_days=7)
    assert token is not None

    found_user = validate_session(db, token)
    assert found_user is not None
    assert found_user.id == user.id


def test_validate_session_invalid_token(db):
    result = validate_session(db, "invalid_token_here")
    assert result is None


def test_validate_session_disabled_user(db):
    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    raw_pin = request_pin(db, "alice@example.com")
    token = verify_pin(db, "alice@example.com", raw_pin, duration_days=7)

    user.is_disabled = True
    db.commit()

    result = validate_session(db, token)
    assert result is None
    assert db.query(Session).count() == 0


def test_invalidate_all_sessions(db):
    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    for i in range(3):
        s = Session(
            user_id=user.id,
            token_hash=f"hash_{i}",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        )
        db.add(s)
    db.commit()
    assert db.query(Session).count() == 3

    invalidate_all_sessions(db, user.id)
    assert db.query(Session).count() == 0
