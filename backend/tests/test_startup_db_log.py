"""The startup DB-target log must actually be emitted on a real uvicorn boot.

A plain module logger inherits root's WARNING level, and uvicorn installs no
handler on root, so an INFO record on it would be silently dropped. main.py logs
the target through the `uvicorn.error` logger (configured at INFO with a handler)
so the line is visible on boot. This test guards that routing AND the password
redaction (spec §50).
"""
import logging

import pytest

from fastapi.testclient import TestClient

from mathion.main import app


@pytest.fixture(autouse=True)
def _own_lock_path(tmp_path, monkeypatch):
    # Superuser Settings D10: every boot takes the single-sender lock, so a
    # dev server holding the default path can't make these boots fail.
    import mathion.config
    monkeypatch.setattr(mathion.config.settings, "dispatcher_lock_path", str(tmp_path / "dispatcher.lock"))


def test_startup_logs_redacted_db_target_via_uvicorn_logger():
    captured: list[str] = []

    class _Capture(logging.Handler):
        def emit(self, record):
            captured.append(record.getMessage())

    handler = _Capture()
    uvlog = logging.getLogger("uvicorn.error")
    uvlog.addHandler(handler)
    prev_level = uvlog.level
    uvlog.setLevel(logging.INFO)
    try:
        with TestClient(app):  # entering the context runs the lifespan startup
            pass
    finally:
        uvlog.removeHandler(handler)
        uvlog.setLevel(prev_level)

    target = [m for m in captured if "Database target:" in m]
    # Emitted via uvicorn.error — would be dropped if logged via a plain module
    # logger, which is exactly the regression this guards.
    assert target, "startup did not log the DB target through uvicorn.error"
    # make_url renders only username@host:port/db — never a user:password pair.
    assert all("mathion:mathion" not in m for m in target), target


MOVED = ("MATHION_MAX_FILE_SIZE", "MATHION_MAX_COURSE_SIZE", "MATHION_PIN_EXPIRY_MINUTES",
         "MATHION_MAX_PIN_REQUESTS_PER_HOUR", "MATHION_MAX_PIN_FAILURES_PER_HOUR",
         "MATHION_SMTP_HOST", "MATHION_SMTP_PORT", "MATHION_SMTP_USERNAME", "MATHION_SMTP_PASSWORD",
         "MATHION_EMAIL_FROM")


def _boot_lines() -> list[str]:
    captured: list[str] = []

    class _Capture(logging.Handler):
        def emit(self, record):
            captured.append(record.getMessage())

    handler = _Capture()
    uvlog = logging.getLogger("uvicorn.error")
    uvlog.addHandler(handler)
    prev_level = uvlog.level
    uvlog.setLevel(logging.INFO)
    try:
        with TestClient(app):
            pass
    finally:
        uvlog.removeHandler(handler)
        uvlog.setLevel(prev_level)
    return [m for m in captured if "keys are ignored" in m]


def test_ignored_env_keys_logged_once(monkeypatch):
    # D2: a key the panel now sets is named once at startup; nobody is asked to delete it.
    for key in MOVED:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("MATHION_MAX_FILE_SIZE", "abc")
    assert _boot_lines() == [
        "These .env keys are ignored since this version; the panel's Settings page "
        "sets them: MATHION_MAX_FILE_SIZE."
    ]


def test_ignored_env_keys_listed_in_one_line(monkeypatch):
    for key in MOVED:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("MATHION_PIN_EXPIRY_MINUTES", "10")
    monkeypatch.setenv("MATHION_MAX_COURSE_SIZE", "1")
    assert _boot_lines() == [
        "These .env keys are ignored since this version; the panel's Settings page "
        "sets them: MATHION_MAX_COURSE_SIZE, MATHION_PIN_EXPIRY_MINUTES."
    ]


def test_no_ignored_line_without_moved_keys(monkeypatch):
    for key in MOVED:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("MATHION_EMAIL_MODE", "disabled")  # D2c: the mode is never ignored
    assert _boot_lines() == []


def test_ignored_email_keys_are_named(monkeypatch):
    for key in MOVED:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("MATHION_SMTP_HOST", "mail.uni.dk")
    monkeypatch.setenv("MATHION_SMTP_PASSWORD", "S3ntinel")
    lines = _boot_lines()
    assert lines == [
        "These .env keys are ignored since this version; the panel's Settings page "
        "sets them: MATHION_SMTP_HOST, MATHION_SMTP_PASSWORD."
    ]
    assert "S3ntinel" not in lines[0]  # names only, never values
