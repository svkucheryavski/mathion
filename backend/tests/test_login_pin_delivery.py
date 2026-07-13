import re

from sqlalchemy import func, select

import mathion.api.auth as auth_api
from mathion.auth import verify_pin
from mathion.config import settings
from mathion.models_auth import NotificationLogEntry, User
from mathion.notifications.mailer import MemoryMailer


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
