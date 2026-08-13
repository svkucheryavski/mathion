from fastapi.testclient import TestClient
from mathion.main import app


def test_version_returns_settings_version(monkeypatch):
    from mathion import config
    monkeypatch.setattr(config.settings, "version", "v9.9.9")
    r = TestClient(app).get("/version")
    assert r.status_code == 200
    assert r.json() == {"version": "v9.9.9"}


def test_version_defaults_unknown_when_unset(monkeypatch):
    # Settings default when MATHION_VERSION is not in the environment.
    monkeypatch.delenv("MATHION_VERSION", raising=False)
    from mathion.config import Settings
    assert Settings().version == "unknown"
