"""Branding D13: the server fills the app page's head (title, icon links, logo
preload, theme link, inline data), escaped as D3 says."""
import json
import logging
import re
from pathlib import Path

import pytest

from mathion.branding import Branding, ImageMeta, short_hash
from mathion.branding_defaults import ICON_32_PNG, ICON_180_PNG, ICON_SVG
from mathion.page_fill import MARKER, IndexTemplate, branding_public, fill_index, load_index

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
APP_JS = '<script type="module" crossorigin src="/assets/index-x.js"></script>'
APP_CSS = '<link rel="stylesheet" crossorigin href="/assets/index-x.css">'


def _template(tmp_path) -> IndexTemplate:
    """The tracked index.html with Vite's two tags appended, as a build writes them."""
    text = (FRONTEND / "index.html").read_text().replace("</head>", f"  {APP_JS}\n  {APP_CSS}\n  </head>")
    page = tmp_path / "index.html"
    page.write_text(text)
    t = load_index(page)
    assert t is not None
    return t


def _inline(page: str) -> dict:
    m = re.search(r'<script type="application/json" id="branding" data-branding>(.*?)</script>', page)
    assert m
    return json.loads(m.group(1))


def _filled_tags(page: str) -> list[str]:
    return re.findall(r"<[a-z]+ [^>]*data-branding[^>]*>", page)


def test_fill_defaults(tmp_path):
    page = fill_index(_template(tmp_path), Branding())
    assert "<title data-branding>Mathion</title>" in page
    assert (f'<link rel="icon" type="image/svg+xml" href="/api/branding/icon-default.svg?v={short_hash(ICON_SVG)}"'
            " data-branding>") in page
    assert (f'<link rel="icon" type="image/png" sizes="32x32" href="/api/branding/icon-default-32.png'
            f'?v={short_hash(ICON_32_PNG)}" data-branding>') in page
    assert (f'<link rel="apple-touch-icon" href="/api/branding/icon-default-180.png?v={short_hash(ICON_180_PNG)}"'
            " data-branding>") in page
    assert '<meta name="apple-mobile-web-app-title" content="Mathion" data-branding>' in page
    assert "theme.css" not in page and "preload" not in page
    assert '{"name":"Mathion","logo":null,"icon":null,"theme":null}' in page
    assert _inline(page) == {"name": "Mathion", "logo": None, "icon": None, "theme": None}
    assert MARKER not in page
    # The title, three icon links, the meta and the inline data: each one marked.
    assert len(_filled_tags(page)) == 6
    assert page.count("data-branding") == 6


def test_uploaded_icon_drops_svg_link(tmp_path):
    page = fill_index(_template(tmp_path), Branding(icon=ImageMeta(180, 180, "c" * 16)))
    icons = re.findall(r'<link rel="(?:icon|apple-touch-icon)"[^>]*>', page)
    assert icons == [
        f'<link rel="icon" type="image/png" href="/api/branding/icon.png?v={"c" * 16}" data-branding>',
        f'<link rel="apple-touch-icon" href="/api/branding/icon.png?v={"c" * 16}" data-branding>',
    ]
    assert "image/svg+xml" not in page and "icon-default" not in page
    assert _inline(page)["icon"] == "c" * 16


def test_logo_preload_and_inline_size(tmp_path):
    page = fill_index(_template(tmp_path), Branding(logo=ImageMeta(838, 174, "a" * 16)))
    assert f'<link rel="preload" as="image" href="/api/branding/logo.png?v={"a" * 16}" data-branding>' in page
    assert _inline(page)["logo"] == {"version": "a" * 16, "width": 838, "height": 174}


def test_theme_link_after_built_css(tmp_path):
    b = Branding(theme_changes={"--bg": "#fff"}, theme_text=":root:root {\n  --bg: #fff;\n}\n", theme_hash="d" * 16)
    page = fill_index(_template(tmp_path), b)
    link = f'<link rel="stylesheet" href="/api/branding/theme.css?v={"d" * 16}" data-branding>'
    assert link in page
    assert page.index(APP_CSS) < page.index(link)
    assert re.search(re.escape(link) + r"\s*</head>", page)
    assert _inline(page)["theme"] == "d" * 16


def test_fill_escapes_script_close_in_name(tmp_path):
    t = _template(tmp_path)
    name = "</script><script>alert(1)</script>"
    page = fill_index(t, Branding(name=name))
    assert "<title data-branding>&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>" in page
    assert 'content="&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;"' in page
    raw = re.search(r'id="branding" data-branding>(.*?)</script>', page).group(1)
    assert raw == '{"name":"\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e",' \
                  '"logo":null,"icon":null,"theme":null}'
    assert json.loads(raw)["name"] == name
    # No script tag besides the app's own and the inline data.
    assert page.count("<script") == t.text.count("<script") + 1


def test_fill_escapes_quotes_and_ampersand(tmp_path):
    page = fill_index(_template(tmp_path), Branding(name='A & B "C" \'D\''))
    assert "<title data-branding>A &amp; B &quot;C&quot; &#x27;D&#x27;</title>" in page
    assert 'content="A &amp; B &quot;C&quot; &#x27;D&#x27;"' in page
    assert '"name":"A \\u0026 B \\"C\\" \'D\'"' in page


def test_missing_marker_warns_and_serves_unfilled(tmp_path, caplog):
    page = tmp_path / "index.html"
    for text in (
        "<html><head><title>Mathion</title></head></html>",                 # no marker
        f"<html><head><title>School</title>{MARKER}</head></html>",          # no title
        f"<html><title>Mathion</title>{MARKER}</html>",                      # no </head>
        f"<html><head><title>Mathion</title>{MARKER}{MARKER}</head></html>",  # twice
    ):
        page.write_text(text)
        caplog.clear()
        with caplog.at_level(logging.WARNING, logger="mathion.page_fill"):
            assert load_index(page) is None
        assert any("unfilled" in r.getMessage() for r in caplog.records)


def test_missing_file_warns(tmp_path, caplog):
    with caplog.at_level(logging.WARNING, logger="mathion.page_fill"):
        assert load_index(tmp_path / "nope.html") is None
    assert any("unfilled" in r.getMessage() for r in caplog.records)


def test_branding_public():
    b = Branding(name="Riverside", logo=ImageMeta(838, 174, "a" * 16), icon=ImageMeta(32, 32, "c" * 16),
                 theme_hash="d" * 16)
    assert branding_public(b).model_dump() == {
        "name": "Riverside", "logo": {"version": "a" * 16, "width": 838, "height": 174},
        "icon": "c" * 16, "theme": "d" * 16,
    }


@pytest.mark.skipif(not (FRONTEND / "dist" / "index.html").exists(), reason="no frontend build")
def test_real_dist_fills():
    t = load_index(FRONTEND / "dist" / "index.html")
    assert t is not None
    page = fill_index(t, Branding(theme_text="x", theme_hash="d" * 16))
    assert re.search(r'theme\.css\?v=d{16}" data-branding>\s*</head>', page)
    css = page.find('rel="stylesheet" crossorigin')
    assert 0 <= css < page.index("theme.css")
