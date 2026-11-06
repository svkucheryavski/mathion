"""The superuser panel's Branding API (superuser Branding spec D2-D10, D12, D14)."""
import io
import logging
import threading

import pytest
from fastapi.testclient import TestClient

from mathion import branding
from mathion.api import superuser_branding as api
from mathion.branding import short_hash
from mathion.database import SessionLocal
from mathion.main import app
from mathion.models_auth import SiteBranding, SiteBrandingImage
from mathion.site_settings import MB
from mathion.superuser import service as panel_service
from mathion.theme_vars import THEME_VARS
from tests.test_png_check import chunk, idat, ihdr, png

NAME_ONE_LINE = "The site name must be 1 to 60 characters on one line."
NAME_HIDDEN = "The site name has a hidden control character; type it again."
LOGO_PNG = "The logo must be a PNG file."
LOGO_1MB = "The logo can be at most 1 MB."
LOGO_PIXELS = "The logo can be at most 4096 px on a side and 4 million pixels in all."
ICON_PNG = "The tab icon must be a PNG file."
ICON_1MB = "The tab icon can be at most 1 MB."
ICON_SIDE = "The tab icon can be at most 1024 px on a side."
MATCHES_MATHION_REMOVES = "This file matches Mathion's colours, so saving it removes your changes."
MATCHES_MATHION = "This file matches Mathion's colours."
MATCHES_SAVED = "This file matches the saved colours."
TOO_BIG = "The theme file can be at most 64 KB."


def _png(width: int, height: int) -> bytes:
    return png(ihdr(width=width, height=height), idat(), chunk(b"IEND", b""))


def _css(body: str) -> bytes:
    return f":root {{\n{body}\n}}\n".encode()


@pytest.fixture
def panel(admin_client, db):
    """(client, base path) for a superuser with a live panel token."""
    token = panel_service.mint(db)
    return admin_client, f"/api/superuser/{token}/branding"


def _get(panel) -> dict:
    client, base = panel
    r = client.get(base)
    assert r.status_code == 200, r.text
    return r.json()


def _name(panel, body: dict):
    client, base = panel
    return client.put(f"{base}/name", json=body)


def _image(panel, kind: str, data: bytes | None = None, reset: bool = False):
    client, base = panel
    files = {"file": ("x.png", data, "image/png")} if data is not None else None
    form = {"reset": "true"} if reset else None
    return client.post(f"{base}/{kind}", files=files, data=form)


def _check(panel, data: bytes):
    client, base = panel
    return client.post(f"{base}/theme/check", files={"file": ("theme.css", data, "text/css")})


def _theme(panel, data: bytes | None = None, reset: bool = False):
    client, base = panel
    files = {"file": ("theme.css", data, "text/css")} if data is not None else None
    return client.post(f"{base}/theme", files=files, data={"reset": "true"} if reset else None)


def _ok(r) -> dict:
    assert r.status_code == 200, r.text
    return r.json()


def _refused(r, sentence: str) -> None:
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == sentence


# --- the read ---

def test_read_defaults(panel):
    body = _get(panel)
    assert body["name"] == "Mathion"
    assert body["logo"] is None and body["icon"] is None
    assert body["public"] == {"name": "Mathion", "logo": None, "icon": None, "theme": None}
    colours = body["colours"]
    assert colours["changes"] == {} and colours["warnings"] == []
    assert len(colours["vars"]) == 73
    assert colours["vars"] == [{"name": v.name, "default": v.default, "heading": v.heading} for v in THEME_VARS]
    assert colours["vars"][0]["heading"] == "Page and surfaces"


def test_read_after_saves(panel, db):
    db.add(SiteBranding(id=1, site_name="Riverside", logo_width=838, logo_height=174, logo_hash="a" * 16,
                        theme_changes={"--bg": "#fff8e7", "--muted": "#cccccc"}))
    db.commit()
    body = _get(panel)
    assert body["name"] == "Riverside"
    assert body["logo"] == {"width": 838, "height": 174} and body["icon"] is None
    assert body["colours"]["changes"] == {"--bg": "#fff8e7", "--muted": "#cccccc"}
    assert any("`--muted` on `--surface`" in w for w in body["colours"]["warnings"])
    assert body["public"]["logo"] == {"version": "a" * 16, "width": 838, "height": 174}
    assert body["public"]["theme"] is not None


def test_read_changes_exclude_dead_var(panel, db):
    db.add(SiteBranding(id=1, theme_changes={"--bg": "var(--radius)", "--text": "#111111", "--gone": "#fff"}))
    db.commit()
    assert _get(panel)["colours"]["changes"] == {"--text": "#111111"}


# --- the name ---

def test_name_saved(panel, db):
    body = _ok(_name(panel, {"name": "  Riverside\tSchool "}))
    assert body["name"] == "Riverside School"
    assert body["public"]["name"] == "Riverside School"
    assert db.get(SiteBranding, 1).site_name == "Riverside School"


@pytest.mark.parametrize("raw,sentence", [
    ("", NAME_ONE_LINE), ("x" * 61, NAME_ONE_LINE), ("a\nb", NAME_ONE_LINE),
    ("a" + chr(0x202E) + "b", NAME_HIDDEN), (chr(0x200B), NAME_HIDDEN),
])
def test_name_refused(panel, db, raw, sentence):
    _refused(_name(panel, {"name": raw}), sentence)
    assert db.get(SiteBranding, 1) is None


def test_name_reset(panel, db):
    _ok(_name(panel, {"name": "Riverside"}))
    body = _ok(_name(panel, {"reset": True}))
    assert body["name"] == "Mathion"


@pytest.mark.parametrize("body", [{}, {"name": "Riverside", "reset": True}, {"reset": False}])
def test_name_needs_one_of_name_or_reset(panel, body):
    assert _name(panel, body).status_code == 422


# --- the logo and the tab icon ---

def test_logo_saved(panel, db):
    data = _png(838, 174)
    body = _ok(_image(panel, "logo", data))
    assert body["logo"] == {"width": 838, "height": 174}
    assert body["public"]["logo"] == {"version": short_hash(data), "width": 838, "height": 174}
    row = db.get(SiteBranding, 1)
    assert (row.logo_width, row.logo_height, row.logo_hash) == (838, 174, short_hash(data))
    assert db.get(SiteBrandingImage, "logo").data == data
    # The public address serves those bytes under that version.
    client, _ = panel
    assert client.get(f"/api/branding/logo.png?v={short_hash(data)}").content == data


def test_logo_replaced_gets_new_hash(panel, db):
    first, second = _png(100, 20), _png(200, 40)
    _ok(_image(panel, "logo", first))
    body = _ok(_image(panel, "logo", second))
    assert body["public"]["logo"]["version"] == short_hash(second) != short_hash(first)
    db.expire_all()
    assert db.get(SiteBrandingImage, "logo").data == second


def test_wide_small_logo_accepted(panel):
    # D4: the advice ("may look soft", "very wide") is the browser's, never a refusal.
    assert _ok(_image(panel, "logo", _png(600, 16)))["logo"] == {"width": 600, "height": 16}


@pytest.mark.parametrize("data,sentence", [
    (b"GIF89a....", LOGO_PNG),
    (b"", LOGO_PNG),
    (b"<svg xmlns='http://www.w3.org/2000/svg'/>", LOGO_PNG),
    (_png(838, 174)[:-6], LOGO_PNG),           # cut before IEND's CRC
    (_png(4097, 10), LOGO_PIXELS),
    (_png(10, 4097), LOGO_PIXELS),
    (_png(2001, 2000), LOGO_PIXELS),           # 4,002,000 pixels
    (_png(2, 1) + b"\0" * MB, LOGO_1MB),
])
def test_logo_refused(panel, db, data, sentence):
    _refused(_image(panel, "logo", data), sentence)
    assert db.get(SiteBranding, 1) is None and db.get(SiteBrandingImage, "logo") is None


def test_logo_limits_are_inclusive(panel):
    assert _ok(_image(panel, "logo", _png(4096, 976)))["logo"] == {"width": 4096, "height": 976}
    assert _ok(_image(panel, "logo", _png(2000, 2000)))["logo"] == {"width": 2000, "height": 2000}
    assert _image(panel, "logo", _png(2, 1) + b"\0" * (MB - len(_png(2, 1)))).status_code == 200


def test_logo_reset(panel, db):
    _ok(_image(panel, "logo", _png(100, 20)))
    body = _ok(_image(panel, "logo", reset=True))
    assert body["logo"] is None and body["public"]["logo"] is None
    db.expire_all()
    assert db.get(SiteBrandingImage, "logo") is None
    assert db.get(SiteBranding, 1).logo_hash is None


@pytest.mark.parametrize("kind", ["logo", "icon"])
def test_image_needs_file_or_reset(panel, kind):
    assert _image(panel, kind, _png(32, 32), reset=True).status_code == 422
    assert _image(panel, kind).status_code == 422


def test_upload_read_is_capped():
    # D5: the server reads at most 1 MB + 1 byte before any check.
    sizes: list[int] = []

    class Spy(io.BytesIO):
        def read(self, size=-1):
            sizes.append(size)
            return super().read(size)

    assert len(api._read_capped(Spy(b"x" * (3 * MB)), MB)) == MB + 1
    assert sizes and all(0 <= s <= MB + 1 for s in sizes)


def test_icon_saved_and_advice_is_not_a_refusal(panel):
    assert _ok(_image(panel, "icon", _png(16, 16)))["icon"] == {"width": 16, "height": 16}
    body = _ok(_image(panel, "icon", _png(300, 100)))
    assert body["icon"] == {"width": 300, "height": 100}
    assert body["public"]["icon"] == short_hash(_png(300, 100))


@pytest.mark.parametrize("data,sentence", [
    (b"not a png", ICON_PNG),
    (_png(1025, 16), ICON_SIDE),
    (_png(16, 1025), ICON_SIDE),
    (_png(2, 1) + b"\0" * MB, ICON_1MB),
])
def test_icon_refused(panel, db, data, sentence):
    _refused(_image(panel, "icon", data), sentence)
    assert db.get(SiteBrandingImage, "icon") is None


def test_icon_reset_keeps_logo(panel, db):
    _ok(_image(panel, "logo", _png(100, 20)))
    _ok(_image(panel, "icon", _png(32, 32)))
    body = _ok(_image(panel, "icon", reset=True))
    assert body["icon"] is None and body["logo"] == {"width": 100, "height": 20}


# --- the theme check ---

def test_check_problems_and_more(panel):
    lines = "\n".join(f"  --nope-{i}: #fff;" for i in range(25))
    body = _ok(_check(panel, _css(lines)))
    assert len(body["problems"]) == 20 and body["more"] == 5
    assert body["problems"][0] == "Line 2: `--nope-0` isn't a theme variable."
    assert body["blocked"] is None and body["warnings"] == []


def test_check_too_big(panel):
    body = _ok(_check(panel, b" " * (64 * 1024 + 1)))
    assert body["problems"] == [TOO_BIG]


def test_check_changes_and_contrast(panel):
    body = _ok(_check(panel, _css("  --bg: #F2F3F6;\n  --muted: #cccccc;\n  --primary: #3f5c77;")))
    assert body["changes"] == {"--muted": "#cccccc"}  # --bg and --primary are Mathion's own
    assert body["problems"] == [] and body["blocked"] is None
    assert any(w.startswith("Text may be hard to read: `--muted` on `--bg`") for w in body["warnings"])


def test_check_puts_back_a_saved_colour(panel, db):
    db.add(SiteBranding(id=1, theme_changes={"--primary": "#204060", "--bg": "#fff8e7"}))
    db.commit()
    body = _ok(_check(panel, _css("  --bg: #fff8e7;\n  --text: #000000;")))
    assert body["blocked"] is None
    assert body["warnings"] == ["This file puts back Mathion's colour for `--primary`, which is changed now."]


def test_check_all_default_with_saved_changes(panel, db):
    db.add(SiteBranding(id=1, theme_changes={"--primary": "#204060", "--bg": "#fff8e7"}))
    db.commit()
    body = _ok(_check(panel, _css("  --bg: #f2f3f6;")))
    assert body["changes"] == {} and body["blocked"] is None
    assert body["warnings"] == [MATCHES_MATHION_REMOVES]


def test_check_all_default_without_saved_changes(panel):
    body = _ok(_check(panel, _css("  --bg: #f2f3f6;")))
    assert body["blocked"] == MATCHES_MATHION and body["warnings"] == []


def test_check_matches_saved(panel, db):
    db.add(SiteBranding(id=1, theme_changes={"--primary": "#204060"}))
    db.commit()
    body = _ok(_check(panel, _css("  --primary: rgb(32, 64, 96);")))
    assert body["blocked"] == MATCHES_SAVED


def test_check_saves_nothing(panel, db):
    _ok(_check(panel, _css("  --bg: #fff8e7;")))
    assert db.get(SiteBranding, 1) is None


# --- the theme save ---

def test_theme_save_replaces_whole_set(panel, db):
    db.add(SiteBranding(id=1, theme_changes={"--primary": "#204060", "--gone": "#fff", "--bg": "var(--radius)"}))
    db.commit()
    body = _ok(_theme(panel, _css("  --text: #111111;")))
    assert body["colours"]["changes"] == {"--text": "#111111"}
    db.expire_all()
    assert db.get(SiteBranding, 1).theme_changes == {"--text": "#111111"}
    text = ":root:root {\n  --text: #111111;\n}\n"
    assert body["public"]["theme"] == short_hash(text.encode())
    client, _ = panel
    assert client.get("/api/branding/theme.css").text == text


def test_theme_save_refused_writes_nothing(panel, db):
    db.add(SiteBranding(id=1, theme_changes={"--primary": "#204060"}))
    db.commit()
    _refused(_theme(panel, _css("  --text: #111111;\n  --radius: #fff;")),
             "Line 3: `--radius` isn't a colour, so it can't be changed here.")
    db.expire_all()
    assert db.get(SiteBranding, 1).theme_changes == {"--primary": "#204060"}


def test_theme_reset(panel, db):
    _ok(_theme(panel, _css("  --text: #111111;")))
    body = _ok(_theme(panel, reset=True))
    assert body["colours"]["changes"] == {} and body["public"]["theme"] is None
    db.expire_all()
    assert db.get(SiteBranding, 1).theme_changes == {}


def test_theme_needs_file_or_reset(panel):
    assert _theme(panel, _css("  --text: #111111;"), reset=True).status_code == 422
    assert _theme(panel).status_code == 422


# --- the writers ---

def test_saves_write_only_their_own_card(panel, db):
    _ok(_name(panel, {"name": "Riverside"}))
    _ok(_image(panel, "logo", _png(100, 20)))
    _ok(_theme(panel, _css("  --text: #111111;")))
    body = _ok(_image(panel, "icon", _png(32, 32)))
    assert body["name"] == "Riverside" and body["logo"] == {"width": 100, "height": 20}
    assert body["colours"]["changes"] == {"--text": "#111111"}


def test_two_cards_saved_at_once_both_land(db):
    first, second = SessionLocal(), SessionLocal()
    try:
        branding.save_name(first, "Riverside", by=1)  # holds the row lock
        done = threading.Event()

        def other():
            branding.save_theme(second, {"--text": "#111111"}, by=2)  # waits on the lock
            second.commit()
            done.set()

        t = threading.Thread(target=other)
        t.start()
        assert not done.wait(0.5)
        first.commit()
        t.join(10)
        assert done.is_set()
    finally:
        first.close()
        second.close()
    db.expire_all()
    row = db.get(SiteBranding, 1)
    assert (row.site_name, row.theme_changes) == ("Riverside", {"--text": "#111111"})


def test_writers_log_the_item_and_user(db, caplog):
    with caplog.at_level(logging.INFO, logger="mathion.branding"):
        branding.save_name(db, "Riverside", by=7)
        branding.save_image(db, "logo", _png(2, 1), 2, 1, by=7)
        branding.clear_image(db, "icon", by=7)
        branding.save_theme(db, {"--text": "#111111"}, by=7)
        branding.clear_theme(db, by=7)
        db.commit()
    messages = [r.getMessage() for r in caplog.records if r.name == "mathion.branding"]
    assert messages == [
        "branding: site name changed by user 7",
        "branding: logo changed by user 7",
        "branding: tab icon changed by user 7",
        "branding: colours changed by user 7",
        "branding: colours changed by user 7",
    ]
    assert not any("Riverside" in m or "#111111" in m for m in messages)  # the item, never the content


def test_reset_colours_only_then_everything(db):
    branding.save_name(db, "Riverside")
    branding.save_image(db, "logo", _png(2, 1), 2, 1)
    branding.save_image(db, "icon", _png(32, 32), 32, 32)
    branding.save_theme(db, {"--text": "#111111", "--gone": "#fff"})
    db.commit()
    assert branding.reset(db, everything=False) == ["colours"]
    db.commit()
    db.expire_all()
    row = db.get(SiteBranding, 1)
    assert row.theme_changes == {} and row.site_name == "Riverside" and row.logo_hash is not None
    assert branding.reset(db, everything=True) == ["site name", "logo", "tab icon", "colours"]
    db.commit()
    db.expire_all()
    row = db.get(SiteBranding, 1)
    assert (row.site_name, row.logo_hash, row.icon_hash, row.theme_changes) == ("Mathion", None, None, {})
    assert db.query(SiteBrandingImage).count() == 0


def test_save_image_hash_is_of_the_bytes(db):
    data = _png(3, 2)
    branding.save_image(db, "icon", data, 3, 2)
    db.commit()
    assert db.get(SiteBranding, 1).icon_hash == short_hash(data)


# --- the guard ---

def test_guard_and_csrf(panel, auth_client, db):
    client, base = panel
    token_path = base.removesuffix("/branding")
    assert client.get("/api/superuser/not-a-token/branding").status_code == 404
    plain = TestClient(app)
    plain.cookies = client.cookies
    calls = [
        ("PUT", f"{base}/name", {"json": {"name": "X"}}),
        ("POST", f"{base}/logo", {"data": {"reset": "true"}}),
        ("POST", f"{base}/icon", {"data": {"reset": "true"}}),
        ("POST", f"{base}/theme", {"data": {"reset": "true"}}),
        ("POST", f"{base}/theme/check", {"files": {"file": ("t.css", _css("  --bg: #fff;"))}}),
    ]
    for method, url, kwargs in calls:
        r = plain.request(method, url, **kwargs)
        assert r.status_code == 403, (method, url, r.status_code)
    # A signed-in user who isn't a superuser meets the route-hiding 404.
    assert auth_client.get(f"{token_path}/branding").status_code == 404
    for method, url, kwargs in calls:
        assert auth_client.request(method, url, **kwargs).status_code == 404
    # No session at all: 401.
    assert TestClient(app).get(base).status_code == 401
    assert db.get(SiteBranding, 1) is None
