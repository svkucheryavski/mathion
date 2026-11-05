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


def test_api_request_pin_without_csrf_header(client, db):
    """POST to request-pin without CSRF header should return 403."""
    from fastapi.testclient import TestClient
    from mathion.main import app
    from mathion.database import get_db as real_get_db

    raw_client = TestClient(app)

    def override():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[real_get_db] = override
    response = raw_client.post("/api/auth/request-pin", json={"email": "test@example.com"})
    assert response.status_code == 403
    app.dependency_overrides.clear()


def test_api_verify_pin_without_csrf_header(client, db):
    """POST to verify-pin without CSRF header should return 403."""
    from fastapi.testclient import TestClient
    from mathion.main import app
    from mathion.database import get_db as real_get_db

    raw_client = TestClient(app)

    def override():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[real_get_db] = override
    response = raw_client.post("/api/auth/verify-pin", json={
        "email": "test@example.com", "pin": "123456", "duration_days": 7,
    })
    assert response.status_code == 403
    app.dependency_overrides.clear()


def test_api_logout_without_csrf_header(client, db):
    """POST to logout without CSRF header should return 403."""
    from fastapi.testclient import TestClient
    from mathion.main import app
    from mathion.database import get_db as real_get_db

    raw_client = TestClient(app)

    def override():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[real_get_db] = override
    response = raw_client.post("/api/auth/logout")
    assert response.status_code == 403
    app.dependency_overrides.clear()


def test_email_normalization_in_api_request_pin(client, db):
    """request-pin endpoint normalizes mixed-case email via schema validator."""
    user = User(email="alice@example.com", full_name="Alice")
    db.add(user)
    db.commit()
    # Send mixed-case email — should still find the user (normalized by schema)
    response = client.post("/api/auth/request-pin", json={"email": "ALICE@EXAMPLE.COM"},
                           headers={"X-Requested-With": "mathion"})
    assert response.status_code == 200


import pytest

from mathion.models import CourseAdmin, Run, RunTeacher
from mathion.models_auth import User
from mathion.auth import request_pin


class TestMeRoleFlags:
    def test_me_admin_only(self, admin_client, superuser, seed_publishable_version, db):
        # superuser → has_course_admin: True via short-circuit
        r = admin_client.get("/api/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["has_course_admin"] is True
        assert body["has_run_teacher"] is False

    def test_me_teacher_only(self, teacher_client, teacher_user, admin_client,
                             seed_publishable_version, db):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        r = teacher_client.get("/api/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["has_course_admin"] is False
        assert body["has_run_teacher"] is True

    def test_me_both(self, teacher_client, teacher_user, admin_client,
                     seed_publishable_version, db):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.add(CourseAdmin(user_id=teacher_user.id, course_id=course["id"]))
        db.commit()
        r = teacher_client.get("/api/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["has_course_admin"] is True
        assert body["has_run_teacher"] is True

    def test_me_neither(self, teacher_client):
        r = teacher_client.get("/api/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["has_course_admin"] is False
        assert body["has_run_teacher"] is False

    def test_me_response_shape_includes_existing_fields(self, teacher_client):
        r = teacher_client.get("/api/auth/me")
        assert r.status_code == 200
        body = r.json()
        for key in ("id", "email", "full_name", "is_superuser", "is_disabled", "photo_url"):
            assert key in body, f"missing {key!r} in /me response"


class TestVerifyPinFlags:
    def test_verify_pin_response_includes_role_flags(
        self, client, admin_client, teacher_user, seed_publishable_version, db,
    ):
        course, _version = seed_publishable_version()
        run_resp = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={
                "title": "R",
                "start_date": "2026-01-01",
                "end_date": "2026-12-31",
                "groups_enabled": False,
            },
        )
        assert run_resp.status_code == 201, run_resp.text
        run = run_resp.json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()

        pin = request_pin(db, teacher_user.email)
        assert pin is not None

        r = client.post(
            "/api/auth/verify-pin",
            json={"email": teacher_user.email, "pin": pin, "duration_days": 7},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "user" in body
        assert body["user"]["has_run_teacher"] is True
        assert body["user"]["has_course_admin"] is False
        for key in ("id", "email", "full_name", "is_superuser", "is_disabled", "photo_url"):
            assert key in body["user"]


# --- superuser Settings D12: the sign-in rules come from the panel ---

from sqlalchemy import func as _func, select as _select

from mathion.auth import verify_pin as _verify_pin
from mathion.models_auth import RateLimitEntry
from tests.conftest import set_site


def test_pin_limits_follow_site_settings(db):
    db.add(User(email="lim@example.com"))
    db.commit()
    set_site(db, pin_requests_per_hour=4, pin_minutes=5)
    pins = [request_pin(db, "lim@example.com") for _ in range(5)]
    assert all(p is not None for p in pins[:4]) and pins[4] is None
    pin = db.execute(_select(LoginPIN).order_by(LoginPIN.id.desc())).scalars().first()
    left = pin.expires_at - datetime.now(timezone.utc)
    assert timedelta(minutes=4, seconds=50) < left <= timedelta(minutes=5)


def test_wrong_tries_follow_site_settings(db):
    db.add(User(email="wt@example.com"))
    db.commit()
    set_site(db, pin_failures_per_hour=3)
    raw = request_pin(db, "wt@example.com")
    for _ in range(3):
        assert _verify_pin(db, "wt@example.com", "000000", 1) is None
    assert _verify_pin(db, "wt@example.com", raw, 1) is None  # the 4th try is refused


def test_longer_duration_is_shortened_not_refused(client, db):
    # D12: a login page left open across a change still signs the person in.
    db.add(User(email="short@example.com"))
    db.commit()
    set_site(db, longest_sign_in_days=1)
    raw = request_pin(db, "short@example.com")
    resp = client.post("/api/auth/verify-pin", json={
        "email": "short@example.com", "pin": raw, "duration_days": 30,
    }, headers={"X-Requested-With": "mathion"})
    assert resp.status_code == 200
    assert "Max-Age=86400" in resp.headers["set-cookie"]
    session = db.execute(_select(Session)).scalar_one()
    left = session.expires_at - datetime.now(timezone.utc)
    assert timedelta(hours=23, minutes=59) < left <= timedelta(days=1)
    assert db.scalar(_select(_func.count()).select_from(RateLimitEntry).where(
        RateLimitEntry.key == "pin_failure:short@example.com")) == 0


def test_shorter_duration_is_kept(client, db):
    db.add(User(email="keep@example.com"))
    db.commit()
    set_site(db, longest_sign_in_days=7)
    raw = request_pin(db, "keep@example.com")
    resp = client.post("/api/auth/verify-pin", json={
        "email": "keep@example.com", "pin": raw, "duration_days": 1,
    }, headers={"X-Requested-With": "mathion"})
    assert resp.status_code == 200
    assert "Max-Age=86400" in resp.headers["set-cookie"]


def test_typo_in_ignored_key_does_not_stop_startup(monkeypatch):
    # D2: the moved keys are out of Settings, so a bad value can't stop the app.
    from mathion.config import Settings
    monkeypatch.setenv("MATHION_MAX_FILE_SIZE", "abc")
    monkeypatch.setenv("MATHION_PIN_EXPIRY_MINUTES", "ten")
    s = Settings()
    assert not hasattr(s, "max_file_size") and not hasattr(s, "pin_expiry_minutes")
