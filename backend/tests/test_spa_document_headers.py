import importlib

from fastapi.testclient import TestClient

from mathion.main import _panel_cache_headers


def test_panel_paths_get_no_store():
    assert _panel_cache_headers("superuser/abc123") == {"Cache-Control": "no-store"}
    assert _panel_cache_headers("superuser") == {"Cache-Control": "no-store"}


def test_non_panel_paths_get_no_headers():
    assert _panel_cache_headers("courses") is None
    assert _panel_cache_headers("") is None
    assert _panel_cache_headers("superuserfoo") is None  # not a panel path


def _client(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html><head><title>Mathion</title><!--branding--></head></html>")
    monkeypatch.setenv("MATHION_FRONTEND_DIST", str(dist))
    import mathion.config
    import mathion.main
    importlib.reload(mathion.config)
    importlib.reload(mathion.main)
    return TestClient(mathion.main.app)


def test_page_is_never_cached(tmp_path, monkeypatch):
    # Branding D13: the filled page names the current versions, so it's always revalidated.
    client = _client(tmp_path, monkeypatch)
    for path in ("/", "/index.html", "/courses/x"):
        r = client.get(path)
        assert r.headers["cache-control"] == "no-cache"
        assert "etag" not in r.headers and "last-modified" not in r.headers


def test_panel_page_keeps_no_store(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    for path in ("/superuser", "/superuser/abc123"):
        r = client.get(path)
        assert r.headers["cache-control"] == "no-store"
        assert "etag" not in r.headers and "last-modified" not in r.headers
