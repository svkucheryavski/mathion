import re

from fastapi import BackgroundTasks
from sqlalchemy import func, select
from starlette.requests import Request as StarletteRequest

import mathion.api.auth as auth_api
from mathion.auth import verify_pin
from mathion.config import settings
from mathion.models_auth import NotificationLogEntry, RateLimitEntry, User
from mathion.notifications.mailer import MemoryMailer
from mathion.schemas import PinRequestSchema
from tests.conftest import set_site


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
    monkeypatch.setattr(auth_api, "build_mailer", lambda *a: mailer)
    resp = client.post("/api/auth/request-pin", json={"email": "real@example.com"})
    assert resp.status_code == 200
    assert mailer.sent == []


def test_sends_exactly_one_login_pin(client, db, monkeypatch):
    _make_user(db)
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "email_mode", "smtp")
    mailer = MemoryMailer()
    monkeypatch.setattr(auth_api, "build_mailer", lambda *a: mailer)

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
    monkeypatch.setattr(auth_api, "build_mailer", lambda *a: None)
    resp = client.post("/api/auth/request-pin", json={"email": "real@example.com"})
    assert resp.status_code == 200


def test_unknown_email_sends_nothing(client, db, monkeypatch):
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "email_mode", "smtp")
    mailer = MemoryMailer()
    monkeypatch.setattr(auth_api, "build_mailer", lambda *a: mailer)
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

    monkeypatch.setattr(auth_api, "build_mailer", lambda *a: BoomMailer())
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

    def boom(*a):
        raise RuntimeError("bad mailer config")

    monkeypatch.setattr(auth_api, "build_mailer", boom)
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
    monkeypatch.setattr(auth_api, "build_mailer", lambda *a: mailer)

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
    assert task.args[2] == 10  # the PIN's minutes, for the email (D10b)


def test_unknown_user_schedules_nothing(db, monkeypatch):
    monkeypatch.setattr(settings, "debug", False)
    mailer = MemoryMailer()
    monkeypatch.setattr(auth_api, "build_mailer", lambda *a: mailer)
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
    set_site(db, pin_requests_per_hour=3)
    for _ in range(3):
        db.add(RateLimitEntry(key="pin_request:real@example.com"))
    db.commit()
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


# --- superuser Settings D9b, D10b: the PIN email follows the panel ---

def test_pin_email_uses_the_saved_from_and_minutes(client, db, monkeypatch):
    import smtplib
    from mathion.notifications import mailer as mailer_mod
    _make_user(db)
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "email_mode", "disabled")
    set_site(db, email_on=True, smtp_host="mail.uni.dk", email_from="Mathion <noreply@uni.dk>", pin_minutes=25)
    sent = []

    class _FakeSMTP:
        def __init__(self, *a, **k): pass
        def ehlo_or_helo_if_needed(self): pass
        def starttls(self, **k): pass
        def send_message(self, msg): sent.append(msg)
        def quit(self): pass

    monkeypatch.setattr(mailer_mod.smtplib, "SMTP", _FakeSMTP)
    client.post("/api/auth/request-pin", json={"email": "real@example.com"})
    assert len(sent) == 1
    assert sent[0]["From"] == "Mathion <noreply@uni.dk>"
    assert "It expires in 25 minutes." in sent[0].get_content()


def test_pin_email_off_in_the_panel_sends_nothing(client, db, monkeypatch):
    from mathion.notifications import mailer as mailer_mod
    _make_user(db)
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "email_mode", "smtp")  # D2c: smtp now means "the panel decides"
    set_site(db, email_on=False, smtp_host="mail.uni.dk", email_from="a@uni.dk")
    connects = []
    monkeypatch.setattr(mailer_mod.smtplib, "SMTP", lambda *a, **k: connects.append(a))
    assert client.post("/api/auth/request-pin", json={"email": "real@example.com"}).status_code == 200
    assert connects == []


def test_pin_send_failure_logs_no_server_reply(client, db, monkeypatch, caplog):
    import logging
    import smtplib
    _make_user(db)
    monkeypatch.setattr(settings, "debug", False)

    class _Refusing(MemoryMailer):
        def send(self, msg):
            raise smtplib.SMTPRecipientsRefused({"real@example.com": (550, b"S3ntinel no such user")})

    monkeypatch.setattr(auth_api, "build_mailer", lambda *a: _Refusing())
    caplog.set_level(logging.DEBUG)
    assert client.post("/api/auth/request-pin", json={"email": "real@example.com"}).status_code == 200
    assert "S3ntinel" not in caplog.text
    assert "The mail server refused to send to real@example.com." in caplog.text


# --- the Email card hears about a failing PIN email (whole-branch review, Opus I2) -----------

from datetime import datetime, timedelta, timezone  # noqa: E402
import smtplib  # noqa: E402
from contextlib import contextmanager  # noqa: E402

from mathion.site_settings import load  # noqa: E402


def _smtp_on(monkeypatch, mailer):
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "email_mode", "smtp")
    monkeypatch.setattr(auth_api, "build_mailer", lambda *a: mailer)


def _card(db):
    db.expire_all()
    v = load(db)
    return v.send_failure_message, v.send_retry_at, v.send_backoff_step


def test_refused_login_on_a_pin_email_reaches_the_card(client, db, monkeypatch):
    class LoginRefused(MemoryMailer):
        @contextmanager
        def session(self):
            raise smtplib.SMTPAuthenticationError(535, b"bad password hunter2")
            yield

    _make_user(db)
    _smtp_on(monkeypatch, LoginRefused())
    client.post("/api/auth/request-pin", json={"email": "real@example.com"})
    # The card shows it; the queue's back-off is left alone.
    assert _card(db) == ("The mail server refused the login.", None, 0)


def test_refused_recipient_on_a_pin_email_leaves_the_card(client, db, monkeypatch):
    class RecipientRefused(MemoryMailer):
        def send(self, msg):
            raise smtplib.SMTPRecipientsRefused({"real@example.com": (550, b"no such user")})

    _make_user(db)
    _smtp_on(monkeypatch, RecipientRefused())
    client.post("/api/auth/request-pin", json={"email": "real@example.com"})
    assert _card(db) == (None, None, 0)


def test_sent_pin_email_clears_the_card(client, db, monkeypatch):
    later = datetime.now(timezone.utc) + timedelta(minutes=30)
    set_site(db, send_failure_message="The mail server refused the login.",
             send_failure_at=datetime.now(timezone.utc), send_retry_at=later, send_backoff_step=3)
    _make_user(db)
    mailer = MemoryMailer()
    _smtp_on(monkeypatch, mailer)
    client.post("/api/auth/request-pin", json={"email": "real@example.com"})
    assert len(mailer.sent) == 1
    assert _card(db) == (None, None, 0)


def test_pin_email_refused_after_body_reaches_the_card(client, db, monkeypatch):
    class Refused(MemoryMailer):
        def send(self, msg):
            raise smtplib.SMTPDataError(554, b"5.2.252 SendAsDenied")

    set_site(db, email_from="Mathion <noreply@uni.dk>")
    _make_user(db)
    _smtp_on(monkeypatch, Refused())
    client.post("/api/auth/request-pin", json={"email": "real@example.com"})
    assert _card(db) == ("The mail server refused a message: check that the login may send as "
                         "Mathion <noreply@uni.dk>.", None, 0)
