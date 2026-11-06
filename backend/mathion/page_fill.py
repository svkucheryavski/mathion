"""The app page's head, filled by the server (superuser Branding spec D13).

The built `index.html` is read once, at import, and its markers are checked:
the default title, the branding marker and `</head>`. Each request fills that
kept copy with the title, the icon links, the logo preload, the theme link and
the inline data. The name is escaped as D3 says.
"""
import html
import json
import logging
from dataclasses import dataclass
from pathlib import Path

from mathion.branding import Branding, short_hash
from mathion.branding_defaults import ICON_32_PNG, ICON_180_PNG, ICON_SVG
from mathion.schemas import BrandingPublic, LogoPublic

log = logging.getLogger(__name__)

MARKER = "<!--branding-->"
_TITLE = "<title>Mathion</title>"
_HEAD_END = "</head>"

_BASE = "/api/branding"
_DEFAULT_ICON_LINKS = (
    f'<link rel="icon" type="image/svg+xml" href="{_BASE}/icon-default.svg?v={short_hash(ICON_SVG)}" data-branding>',
    f'<link rel="icon" type="image/png" sizes="32x32" href="{_BASE}/icon-default-32.png'
    f'?v={short_hash(ICON_32_PNG)}" data-branding>',
    f'<link rel="apple-touch-icon" href="{_BASE}/icon-default-180.png?v={short_hash(ICON_180_PNG)}" data-branding>',
)


@dataclass(frozen=True)
class IndexTemplate:
    text: str


def load_index(path: Path) -> IndexTemplate | None:
    """The built page, or None (with a warning) when a marker is missing, so
    the page is sent unfilled rather than filled in the wrong place."""
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        log.warning("page fill: %s can't be read (%s); the page is sent unfilled", path, type(e).__name__)
        return None
    wrong = [m for m in (_TITLE, MARKER, _HEAD_END) if text.count(m) != 1]
    if wrong:
        log.warning("page fill: %s needs exactly one of each of %s; the page is sent unfilled",
                    path, ", ".join(wrong))
        return None
    return IndexTemplate(text)


def branding_public(b: Branding) -> BrandingPublic:
    return BrandingPublic(
        name=b.name,
        logo=LogoPublic(version=b.logo.hash, width=b.logo.width, height=b.logo.height) if b.logo else None,
        icon=b.icon.hash if b.icon else None,
        theme=b.theme_hash,
    )


def _inline_json(b: Branding) -> str:
    # D3: plain json.dumps leaves "</script>" as it is.
    text = json.dumps(branding_public(b).model_dump(), separators=(",", ":"))
    return text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def fill_index(t: IndexTemplate, b: Branding) -> str:
    name = html.escape(b.name, quote=True)
    if b.icon:
        href = f"{_BASE}/icon.png?v={b.icon.hash}"
        icons = (f'<link rel="icon" type="image/png" href="{href}" data-branding>',
                 f'<link rel="apple-touch-icon" href="{href}" data-branding>')
    else:
        icons = _DEFAULT_ICON_LINKS
    tags = [*icons, f'<meta name="apple-mobile-web-app-title" content="{name}" data-branding>']
    if b.logo:
        tags.append(f'<link rel="preload" as="image" href="{_BASE}/logo.png?v={b.logo.hash}" data-branding>')
    tags.append(f'<script type="application/json" id="branding" data-branding>{_inline_json(b)}</script>')
    page = t.text.replace(_TITLE, f"<title data-branding>{name}</title>").replace(MARKER, "\n    ".join(tags))
    if b.theme_hash:
        # Last before </head>, after the built CSS (D13).
        theme = f'<link rel="stylesheet" href="{_BASE}/theme.css?v={b.theme_hash}" data-branding>'
        page = page.replace(_HEAD_END, f"  {theme}\n  {_HEAD_END}")
    return page
