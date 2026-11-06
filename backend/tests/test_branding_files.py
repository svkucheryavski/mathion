"""Branding D13: the public files under /api/branding/ and /favicon.ico,
cached by content and safe during a database outage."""
import importlib

import pytest
from fastapi.testclient import TestClient

from mathion import branding
from mathion.api import branding as branding_api
from mathion.branding import BrandingUnavailable, load_branding, short_hash
from mathion.branding_defaults import ICON_32_PNG, ICON_180_PNG, ICON_SVG
from mathion.models_auth import SiteBranding, SiteBrandingImage

LOGO = b"\x89PNG logo bytes"
ICON = b"\x89PNG icon bytes"
YEAR = "public, max-age=31536000, immutable"


def _upload(db, kind: str, data: bytes, **row):
    db.merge(SiteBranding(id=1, **{f"{kind}_width": 2, f"{kind}_height": 1, f"{kind}_hash": short_hash(data)}, **row))
    db.add(SiteBrandingImage(kind=kind, data=data))
    db.commit()


def _unavailable(kind):
    raise BrandingUnavailable(kind)


@pytest.mark.parametrize("kind", ["logo", "icon"])
def test_upload_404_without_one(client, kind):
    assert client.get(f"/api/branding/{kind}.png").status_code == 404


@pytest.mark.parametrize("kind,data", [("logo", LOGO), ("icon", ICON)])
def test_upload_served(client, db, kind, data):
    _upload(db, kind, data)
    r = client.get(f"/api/branding/{kind}.png")
    assert r.status_code == 200 and r.content == data
    assert r.headers["content-type"] == "image/png"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-security-policy"] == "sandbox"
    assert r.headers["cache-control"] == "no-cache"
    assert r.headers["etag"] == f'"{short_hash(data)}"'


@pytest.mark.parametrize("kind,data", [("logo", LOGO), ("icon", ICON)])
def test_upload_versions(client, db, kind, data):
    _upload(db, kind, data)
    current = client.get(f"/api/branding/{kind}.png?v={short_hash(data)}")
    assert current.status_code == 200 and current.headers["cache-control"] == YEAR
    old = client.get(f"/api/branding/{kind}.png?v=0123456789abcdef")
    assert old.status_code == 200 and old.headers["cache-control"] == "no-cache"
    assert old.headers["etag"] == f'"{short_hash(data)}"'


def test_upload_revalidates_with_304(client, db):
    _upload(db, "logo", LOGO)
    etag = f'"{short_hash(LOGO)}"'
    for sent in (etag, f"W/{etag}", f'"other", {etag}', "*"):
        r = client.get("/api/branding/logo.png", headers={"If-None-Match": sent})
        assert r.status_code == 304 and r.content == b""
        assert r.headers["etag"] == etag and r.headers["cache-control"] == "no-cache"
    assert client.get("/api/branding/logo.png", headers={"If-None-Match": '"other"'}).status_code == 200


def test_upload_head(client, db):
    _upload(db, "icon", ICON)
    r = client.head("/api/branding/icon.png")
    assert r.status_code == 200 and r.content == b""
    assert r.headers["content-type"] == "image/png"
    assert r.headers["etag"] == f'"{short_hash(ICON)}"'


def test_version_is_hash_of_bytes_served(client, db):
    # The row's hash is a stale value: the address versions what it sends.
    db.add(SiteBranding(id=1, logo_width=2, logo_height=1, logo_hash="f" * 16))
    db.add(SiteBrandingImage(kind="logo", data=LOGO))
    db.commit()
    assert client.get(f"/api/branding/logo.png?v={'f' * 16}").headers["cache-control"] == "no-cache"
    assert client.get("/api/branding/logo.png").headers["etag"] == f'"{short_hash(LOGO)}"'


@pytest.mark.parametrize("path,data,media", [
    ("icon-default.svg", ICON_SVG, "image/svg+xml"),
    ("icon-default-32.png", ICON_32_PNG, "image/png"),
    ("icon-default-180.png", ICON_180_PNG, "image/png"),
])
def test_default_icons_always_answer(client, db, path, data, media):
    _upload(db, "icon", ICON)  # an upload doesn't take the defaults away
    r = client.get(f"/api/branding/{path}")
    assert r.status_code == 200 and r.content == data
    assert r.headers["content-type"] == media
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-security-policy"] == "sandbox"
    assert r.headers["etag"] == f'"{short_hash(data)}"'
    assert client.get(f"/api/branding/{path}?v={short_hash(data)}").headers["cache-control"] == YEAR
    assert client.get(f"/api/branding/{path}", headers={"If-None-Match": f'"{short_hash(data)}"'}).status_code == 304


def test_theme_css_empty_without_changes(client):
    r = client.get("/api/branding/theme.css")
    assert r.status_code == 200 and r.text == ""
    assert r.headers["content-type"] == "text/css; charset=utf-8"
    assert r.headers["x-content-type-options"] == "nosniff"


def test_theme_css_served_and_versioned(client, db):
    db.add(SiteBranding(id=1, theme_changes={"--bg": "#fff"}))
    db.commit()
    text = ":root:root {\n  --bg: #fff;\n}\n"
    r = client.get("/api/branding/theme.css")
    assert r.text == text and r.headers["cache-control"] == "no-cache"
    version = short_hash(text.encode())
    assert r.headers["etag"] == f'"{version}"'
    assert client.get(f"/api/branding/theme.css?v={version}").headers["cache-control"] == YEAR
    assert client.get("/api/branding/theme.css", headers={"If-None-Match": f'"{version}"'}).status_code == 304


def test_favicon_default_then_upload(client, db):
    r = client.get("/favicon.ico")
    assert r.status_code == 200 and r.content == ICON_32_PNG
    assert r.headers["content-type"] == "image/png"
    assert r.headers["cache-control"] == "no-cache"
    _upload(db, "icon", ICON)
    assert client.get("/favicon.ico").content == ICON
    assert client.head("/favicon.ico").status_code == 200


def test_favicon_without_frontend_dist(db, tmp_path, monkeypatch):
    import mathion.config
    import mathion.main
    monkeypatch.setenv("MATHION_FRONTEND_DIST", str(tmp_path / "missing"))
    importlib.reload(mathion.config)
    importlib.reload(mathion.main)
    try:
        r = TestClient(mathion.main.app).get("/favicon.ico")
        assert r.status_code == 200 and r.content == ICON_32_PNG
    finally:
        monkeypatch.undo()
        importlib.reload(mathion.config)
        importlib.reload(mathion.main)


# --- A database outage (D13) ---

@pytest.mark.parametrize("path,kind,data", [
    ("/api/branding/logo.png", "logo", LOGO),
    ("/api/branding/icon.png", "icon", ICON),
    ("/favicon.ico", "icon", ICON),
])
def test_outage_revalidates_or_503(client, db, monkeypatch, path, kind, data):
    _upload(db, kind, data)
    load_branding()  # the last good copy knows the hash
    monkeypatch.setattr(branding_api, "read_image", _unavailable)
    r = client.get(path, headers={"If-None-Match": f'"{short_hash(data)}"'})
    assert r.status_code == 304
    for headers in ({}, {"If-None-Match": '"other"'}):
        r = client.get(f"{path}?v={short_hash(data)}", headers=headers)
        assert r.status_code == 503
        assert r.headers["cache-control"] == "no-store"


def test_outage_never_404s(client, monkeypatch):
    # Nothing read yet: the address can't tell "no upload" from "no database".
    monkeypatch.setattr(branding_api, "read_image", _unavailable)
    assert client.get("/api/branding/logo.png").status_code == 503


def test_outage_favicon_without_upload_known_answers_default(client, monkeypatch):
    load_branding()
    monkeypatch.setattr(branding_api, "read_image", _unavailable)
    r = client.get("/favicon.ico")
    assert r.status_code == 200 and r.content == ICON_32_PNG


def test_outage_theme_from_last_good(client, db, monkeypatch):
    db.add(SiteBranding(id=1, theme_changes={"--bg": "#fff"}))
    db.commit()
    load_branding()

    def refused():
        raise RuntimeError("connection refused")

    monkeypatch.setattr(branding, "_read", refused)
    r = client.get("/api/branding/theme.css")
    assert r.status_code == 200 and r.text == ":root:root {\n  --bg: #fff;\n}\n"
