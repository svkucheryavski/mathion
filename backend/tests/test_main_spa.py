"""SPA static-mount + /api catch-all behavior."""
import importlib

from fastapi.testclient import TestClient


def _client_with_dist(tmp_path, monkeypatch):
    """Return a TestClient where settings.frontend_dist points at a real dir."""
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><html>SPA</html>")
    assets_dir = dist / "_app"
    assets_dir.mkdir()
    (assets_dir / "bundle.js").write_text("console.log('hi')")
    monkeypatch.setenv("MATHION_FRONTEND_DIST", str(dist))
    # Force re-import so the conditional mount sees the env var.
    import mathion.config
    import mathion.main
    importlib.reload(mathion.config)
    importlib.reload(mathion.main)
    return TestClient(mathion.main.app)


def test_health_still_works_with_spa_mount(tmp_path, monkeypatch):
    client = _client_with_dist(tmp_path, monkeypatch)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_unknown_api_route_returns_json_404(tmp_path, monkeypatch):
    client = _client_with_dist(tmp_path, monkeypatch)
    response = client.get("/api/clearly-not-a-route")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}
    assert response.headers["content-type"].startswith("application/json")


def test_real_api_route_404_still_json(tmp_path, monkeypatch):
    """Existing API routes that 404 (e.g. nonexistent course slug) keep JSON 404."""
    client = _client_with_dist(tmp_path, monkeypatch)
    response = client.get("/api/courses/nonexistent-slug/my-version")
    # Could be 401 if no session, but it must be JSON not the SPA shell.
    assert response.headers["content-type"].startswith("application/json")
    assert response.status_code in (401, 404)


def test_deep_spa_path_serves_index_html(tmp_path, monkeypatch):
    client = _client_with_dist(tmp_path, monkeypatch)
    response = client.get("/courses/some-deep-spa-path")
    assert response.status_code == 200
    assert "SPA" in response.text


def test_app_bundle_served(tmp_path, monkeypatch):
    client = _client_with_dist(tmp_path, monkeypatch)
    response = client.get("/_app/bundle.js")
    assert response.status_code == 200
    assert "hi" in response.text


def test_missing_dist_does_not_break_app(tmp_path, monkeypatch):
    """Conditional mount: pure-backend dev / CI without a frontend build still works."""
    monkeypatch.setenv("MATHION_FRONTEND_DIST", str(tmp_path / "definitely-not-here"))
    import mathion.config
    import mathion.main
    importlib.reload(mathion.config)
    importlib.reload(mathion.main)
    client = TestClient(mathion.main.app)
    assert client.get("/health").status_code == 200
    # No SPA fallback — non-API path returns 404.
    assert client.get("/courses/anything").status_code == 404
