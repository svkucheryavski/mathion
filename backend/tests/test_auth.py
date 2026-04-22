from datetime import datetime, timedelta, timezone

from mathion.models_auth import LoginPIN, Session, User


def test_create_user(db):
    user = User(email="student@example.com", full_name="Alice Smith")
    db.add(user)
    db.commit()
    db.refresh(user)

    assert user.id is not None
    assert user.email == "student@example.com"
    assert user.full_name == "Alice Smith"
    assert user.is_superuser is False
    assert user.is_disabled is False
    assert user.photo_url is None


def test_user_email_unique(db):
    import pytest
    from sqlalchemy.exc import IntegrityError

    u1 = User(email="alice@example.com")
    u2 = User(email="alice@example.com")
    db.add(u1)
    db.commit()
    db.add(u2)
    with pytest.raises(IntegrityError):
        db.commit()


def test_create_superuser(db):
    user = User(email="admin@example.com", full_name="Admin", is_superuser=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    assert user.is_superuser is True


def test_create_session(db):
    user = User(email="alice@example.com")
    db.add(user)
    db.commit()
    session = Session(
        user_id=user.id,
        token_hash="abc123hashed",
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    assert session.id is not None
    assert session.user_id == user.id
    assert session.created_at is not None
    assert session.last_active_at is not None


def test_create_pin(db):
    user = User(email="alice@example.com")
    db.add(user)
    db.commit()
    pin = LoginPIN(
        user_id=user.id,
        pin_hash="hashed_pin_value",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    db.add(pin)
    db.commit()
    db.refresh(pin)
    assert pin.id is not None
    assert pin.is_used is False


def test_cascade_delete_user_deletes_sessions(db):
    user = User(email="alice@example.com")
    db.add(user)
    db.commit()
    session = Session(
        user_id=user.id,
        token_hash="abc",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db.add(session)
    db.commit()
    db.delete(user)
    db.commit()
    assert db.query(Session).count() == 0


def test_api_request_pin(client, db):
    user = User(email="alice@example.com", full_name="Alice")
    db.add(user)
    db.commit()
    response = client.post("/api/auth/request-pin", json={"email": "alice@example.com"},
                           headers={"X-Requested-With": "mathion"})
    assert response.status_code == 200
    assert response.json()["message"] == "PIN sent"


def test_api_request_pin_unknown_email(client):
    response = client.post("/api/auth/request-pin", json={"email": "nobody@example.com"},
                           headers={"X-Requested-With": "mathion"})
    assert response.status_code == 200
    assert response.json()["message"] == "PIN sent"


def test_api_verify_pin_and_login(client, db):
    from mathion.auth import request_pin as _request_pin

    user = User(email="alice@example.com", full_name="Alice")
    db.add(user)
    db.commit()

    raw_pin = _request_pin(db, "alice@example.com")
    response = client.post("/api/auth/verify-pin", json={
        "email": "alice@example.com",
        "pin": raw_pin,
        "duration_days": 7,
    }, headers={"X-Requested-With": "mathion"})
    assert response.status_code == 200
    data = response.json()
    assert data["user"]["email"] == "alice@example.com"
    assert "session_token" in response.cookies


def test_api_verify_pin_wrong(client, db):
    from mathion.auth import request_pin as _request_pin

    user = User(email="alice@example.com")
    db.add(user)
    db.commit()
    _request_pin(db, "alice@example.com")
    response = client.post("/api/auth/verify-pin", json={
        "email": "alice@example.com",
        "pin": "000000",
        "duration_days": 7,
    }, headers={"X-Requested-With": "mathion"})
    assert response.status_code == 401


def test_api_get_profile(auth_client, test_user):
    response = auth_client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json()["email"] == test_user.email


def test_api_get_profile_unauthenticated(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 401


def test_api_logout(auth_client, db):
    from mathion.models_auth import Session
    response = auth_client.post("/api/auth/logout", headers={"X-Requested-With": "mathion"})
    assert response.status_code == 200
    assert db.query(Session).count() == 0


def test_api_update_profile(auth_client):
    response = auth_client.patch("/api/auth/me", json={"full_name": "New Name"},
                                 headers={"X-Requested-With": "mathion"})
    assert response.status_code == 200
    assert response.json()["full_name"] == "New Name"
