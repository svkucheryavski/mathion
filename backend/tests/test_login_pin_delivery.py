import re

from fastapi import BackgroundTasks
from sqlalchemy import func, select
from starlette.requests import Request as StarletteRequest

import mathion.api.auth as auth_api
from mathion.auth import verify_pin
from mathion.config import settings
from mathion.models_auth import NotificationLogEntry, User
from mathion.notifications.mailer import MemoryMailer
from mathion.schemas import PinRequestSchema


def _make_user(db, email="real@example.com"):
    u = User(email=email)
    db.add(u)
    db.commit()
    return u


def test_debug_console_no_email(client, db, monkeypatch):
    _make_user(db)
    monkeypatch.setattr(settings, "debug", True)
    monkeypatch.setattr(settings, "email_mode", "smtp")
    mailer = MemoryMailer()
    monkeypatch.setattr(auth_api, "build_mailer_from_settings", lambda s: mailer)
    resp = client.post("/api/auth/request-pin", json={"email": "real@example.com"})
    assert resp.status_code == 200
    assert mailer.sent == []


def test_sends_exactly_one_login_pin(client, db, monkeypatch):
    _make_user(db)
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "email_mode", "smtp")
    mailer = MemoryMailer()
    monkeypatch.setattr(auth_api, "build_mailer_from_settings", lambda s: mailer)

    resp = client.post("/api/auth/request-pin", json={"email": "real@example.com"})
    assert resp.status_code == 200
    assert resp.json() == {"message": "PIN sent"}
    assert len(mailer.sent) == 1
    msg = mailer.sent[0]
    assert msg["To"] == "real@example.com"
    assert msg["X-Mathion-Kind"] == "login_pin"

    pin = re.search(r"\b(\d{6})\b", msg.get_content()).group(1)
    assert verify_pin(db, "real@example.com", pin, duration_days=1) is not None

    # Raw PIN never persisted to the notification log.
    assert db.scalar(select(func.count()).select_from(NotificationLogEntry)) == 0


def test_no_mailer_sends_nothing(client, db, monkeypatch):
    _make_user(db)
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "email_mode", "disabled")
    monkeypatch.setattr(auth_api, "build_mailer_from_settings", lambda s: None)
    resp = client.post("/api/auth/request-pin", json={"email": "real@example.com"})
    assert resp.status_code == 200


def test_unknown_email_sends_nothing(client, db, monkeypatch):
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "email_mode", "smtp")
    mailer = MemoryMailer()
    monkeypatch.setattr(auth_api, "build_mailer_from_settings", lambda s: mailer)
    resp = client.post("/api/auth/request-pin", json={"email": "nobody@example.com"})
    assert resp.status_code == 200
    assert mailer.sent == []


def test_send_failure_stays_uniform(client, db, monkeypatch):
    _make_user(db)
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "email_mode", "smtp")

    class BoomMailer(MemoryMailer):
        def send(self, msg):
            raise RuntimeError("SMTP down")

    monkeypatch.setattr(auth_api, "build_mailer_from_settings", lambda s: BoomMailer())
    fail_resp = client.post("/api/auth/request-pin", json={"email": "real@example.com"})
    unknown_resp = client.post("/api/auth/request-pin", json={"email": "nobody@example.com"})
    assert fail_resp.status_code == 200
    assert fail_resp.json() == unknown_resp.json() == {"message": "PIN sent"}


def test_request_pin_still_200_under_lifespanless_client(client, db):
    # Regression guard for the removed app.state.mailer read: default email
    # mode is "disabled", no debug -> no send, no AttributeError.
    resp = client.post("/api/auth/request-pin", json={"email": "whoever@example.com"})
    assert resp.status_code == 200


def test_mailer_build_failure_stays_uniform(client, db, monkeypatch):
    _make_user(db)
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "email_mode", "smtp")

    def boom(s):
        raise RuntimeError("bad mailer config")

    monkeypatch.setattr(auth_api, "build_mailer_from_settings", boom)
    fail_resp = client.post("/api/auth/request-pin", json={"email": "real@example.com"})
    unknown_resp = client.post("/api/auth/request-pin", json={"email": "nobody@example.com"})
    assert fail_resp.status_code == 200
    assert fail_resp.json() == unknown_resp.json() == {"message": "PIN sent"}


def _csrf_request():
    # _require_csrf only checks the X-Requested-With header; this minimal scope
    # satisfies it with no monkeypatch.
    return StarletteRequest(
        {"type": "http", "headers": [(b"x-requested-with", b"mathion")]}
    )


def test_eligible_user_schedules_send_off_path(db, monkeypatch):
    _make_user(db)
    monkeypatch.setattr(settings, "debug", False)
    mailer = MemoryMailer()
    monkeypatch.setattr(auth_api, "build_mailer_from_settings", lambda s: mailer)

    bg = BackgroundTasks()
    result = auth_api.api_request_pin(
        _csrf_request(), PinRequestSchema(email="real@example.com"), bg, db=db
    )

    assert result == {"message": "PIN sent"}
    # (no inline send) a direct call collects but never runs tasks, so an empty
    # outbox proves the send did not execute inline.
    assert mailer.sent == []
    # (scheduled) exactly one _send_login_pin task, right recipient, valid PIN.
    assert len(bg.tasks) == 1
    task = bg.tasks[0]
    assert task.func is auth_api._send_login_pin
    assert task.args[0] == "real@example.com"
    # validate the scheduled PIN non-circularly (same pattern as
    # test_sends_exactly_one_login_pin), not by reading task.args[1] back.
    assert verify_pin(db, "real@example.com", task.args[1], 1) is not None


def test_unknown_user_schedules_nothing(db, monkeypatch):
    monkeypatch.setattr(settings, "debug", False)
    mailer = MemoryMailer()
    monkeypatch.setattr(auth_api, "build_mailer_from_settings", lambda s: mailer)
    bg = BackgroundTasks()
    auth_api.api_request_pin(
        _csrf_request(), PinRequestSchema(email="nobody@example.com"), bg, db=db
    )
    assert bg.tasks == []
    assert mailer.sent == []


def test_disabled_user_schedules_nothing(db, monkeypatch):
    u = _make_user(db)
    u.is_disabled = True
    db.commit()
    monkeypatch.setattr(settings, "debug", False)
    bg = BackgroundTasks()
    auth_api.api_request_pin(
        _csrf_request(), PinRequestSchema(email="real@example.com"), bg, db=db
    )
    assert bg.tasks == []


def test_rate_limited_user_schedules_nothing(db, monkeypatch):
    _make_user(db)
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "max_pin_requests_per_hour", 0)  # any count >= 0 -> limited
    bg = BackgroundTasks()
    auth_api.api_request_pin(
        _csrf_request(), PinRequestSchema(email="real@example.com"), bg, db=db
    )
    assert bg.tasks == []


def test_debug_mode_schedules_nothing(db, monkeypatch):
    _make_user(db)
    monkeypatch.setattr(settings, "debug", True)  # request_pin still returns a PIN;
    bg = BackgroundTasks()                          # the handler's `not settings.debug`
    auth_api.api_request_pin(                        # gate suppresses scheduling.
        _csrf_request(), PinRequestSchema(email="real@example.com"), bg, db=db
    )
    assert bg.tasks == []
