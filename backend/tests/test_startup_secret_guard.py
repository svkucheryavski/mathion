"""The production secret-key guard must fail closed.

main.py's lifespan refuses to boot when MATHION_SECRET_KEY is empty or still the
dev default WHILE cookie_secure is True (the production posture). It is inert
otherwise (no secure cookies) — which is why the rest of the suite, running with
cookie_secure=False, is unaffected. Entering TestClient(app) as a context manager
runs the lifespan startup (same pattern as test_startup_db_log.py).

The settings singleton, Settings class, and app are re-read LIVE inside each test
(via mathion.config / mathion.main) rather than bound with a module-level
`from mathion.config import ...`. test_main_spa.py does
importlib.reload(mathion.config) + importlib.reload(mathion.main); that reload
rebinds mathion.main's globals (which the lifespan reads through) to a FRESH
settings instance, so a module-level import would monkeypatch a stale object the
lifespan no longer reads — and the two `refuses_*` assertions would spuriously fail
when this file runs after test_main_spa.py in the full suite. This mirrors the
existing guard in test_notifications_lifespan.py / test_notifications_lock.py
("Re-import live settings/app in case test_main_spa.py reloaded them").
"""
import pytest
from fastapi.testclient import TestClient

import mathion.config
import mathion.main


def _live():
    """(settings singleton, Settings class, app) the lifespan reads RIGHT NOW —
    after any test_main_spa.py reload. Settings.model_fields["secret_key"].default
    is the dev-default string, so there is no magic-string duplication here."""
    return mathion.config.settings, mathion.config.Settings, mathion.main.app


def test_guard_refuses_dev_default_secret_with_secure_cookies(monkeypatch):
    settings, Settings, app = _live()
    monkeypatch.setattr(settings, "cookie_secure", True)
    monkeypatch.setattr(settings, "secret_key", Settings.model_fields["secret_key"].default)
    with pytest.raises(RuntimeError, match="MATHION_SECRET_KEY"):
        with TestClient(app):
            pass


def test_guard_refuses_empty_secret_with_secure_cookies(monkeypatch):
    settings, Settings, app = _live()
    monkeypatch.setattr(settings, "cookie_secure", True)
    monkeypatch.setattr(settings, "secret_key", "")
    with pytest.raises(RuntimeError, match="MATHION_SECRET_KEY"):
        with TestClient(app):
            pass


def test_guard_allows_real_secret_with_secure_cookies(monkeypatch):
    settings, Settings, app = _live()
    monkeypatch.setattr(settings, "cookie_secure", True)
    monkeypatch.setattr(settings, "secret_key", "a-strong-production-secret")
    with TestClient(app):  # must NOT raise
        pass


def test_guard_inert_with_default_secret_when_cookies_insecure(monkeypatch):
    settings, Settings, app = _live()
    # Dev/test posture: default secret is fine when cookie_secure is False.
    monkeypatch.setattr(settings, "cookie_secure", False)
    monkeypatch.setattr(settings, "secret_key", Settings.model_fields["secret_key"].default)
    with TestClient(app):  # must NOT raise
        pass
