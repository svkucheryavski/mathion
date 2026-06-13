import builtins
import fcntl
import unittest.mock

import pytest
from fastapi.testclient import TestClient

from mathion.config import settings
from mathion.notifications.dispatcher import acquire_singleton_lock


def _patch_lock_path(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "dispatcher_lock_path", str(tmp_path / "dispatcher.lock"))


def test_acquire_returns_fd(tmp_path, monkeypatch):
    _patch_lock_path(monkeypatch, tmp_path)
    fd = acquire_singleton_lock(settings)
    assert fd is not None
    fd.close()


def test_second_acquire_raises(tmp_path, monkeypatch):
    _patch_lock_path(monkeypatch, tmp_path)
    fd = acquire_singleton_lock(settings)
    try:
        with pytest.raises(RuntimeError, match="Another Mathion dispatcher"):
            acquire_singleton_lock(settings)
    finally:
        fd.close()


def test_close_releases_lock(tmp_path, monkeypatch):
    _patch_lock_path(monkeypatch, tmp_path)
    fd = acquire_singleton_lock(settings)
    fd.close()
    # Re-acquiring after close should succeed.
    fd2 = acquire_singleton_lock(settings)
    fd2.close()


def test_acquire_uses_configured_path(tmp_path, monkeypatch):
    target = tmp_path / "custom.lock"
    monkeypatch.setattr(settings, "dispatcher_lock_path", str(target))
    fd = acquire_singleton_lock(settings)
    try:
        assert target.exists()
    finally:
        fd.close()


def test_non_blocking_error_closes_fd(tmp_path, monkeypatch):
    _patch_lock_path(monkeypatch, tmp_path)

    real_open = builtins.open
    captured = {}
    def wrapped_open(path, mode, *args, **kwargs):
        f = real_open(path, mode, *args, **kwargs)
        captured["fd"] = f
        captured["close_spy"] = unittest.mock.Mock(wraps=f.close)
        f.close = captured["close_spy"]
        return f
    monkeypatch.setattr(builtins, "open", wrapped_open)
    monkeypatch.setattr(fcntl, "flock",
                        unittest.mock.Mock(side_effect=OSError("simulated EBADF")))
    with pytest.raises(OSError, match="simulated EBADF"):
        acquire_singleton_lock(settings)
    captured["close_spy"].assert_called_once()


def test_lifespan_refuses_when_lock_held(tmp_path, monkeypatch):
    # Re-import from the live module in case test_main_spa.py reloaded it.
    import mathion.config
    import mathion.main
    live_settings = mathion.config.settings
    live_app = mathion.main.app
    monkeypatch.setattr(live_settings, "dispatcher_lock_path", str(tmp_path / "dispatcher.lock"))
    monkeypatch.setattr(live_settings, "email_mode", "memory")
    fd = acquire_singleton_lock(live_settings)
    try:
        with pytest.raises(RuntimeError, match="Another Mathion dispatcher"):
            with TestClient(live_app):
                pass
    finally:
        fd.close()


def test_lifespan_disabled_mode_no_lock(tmp_path, monkeypatch):
    import mathion.config
    import mathion.main
    live_settings = mathion.config.settings
    live_app = mathion.main.app
    monkeypatch.setattr(live_settings, "dispatcher_lock_path", str(tmp_path / "dispatcher.lock"))
    monkeypatch.setattr(live_settings, "email_mode", "disabled")
    with TestClient(live_app):
        pass
    assert not (tmp_path / "dispatcher.lock").exists()
    assert live_app.state.lock_fd is None
    assert live_app.state.mailer is None
