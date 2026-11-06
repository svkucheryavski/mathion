"""The site's branding (superuser Branding spec): the site name, the logo, the
tab icon and the colour changes.

`check_site_name` is D3's rule. `load_branding` is D13's one read that never
fails: it answers the last branding it read successfully, or the defaults.
"""
import hashlib
import logging
import threading
import unicodedata
from dataclasses import dataclass, field, replace

from sqlalchemy import select

from mathion.database import SessionLocal
from mathion.models_auth import SiteBranding, SiteBrandingImage

log = logging.getLogger(__name__)

NAME_DEFAULT = "Mathion"
NAME_MAX = 60

NAME_ONE_LINE = "The site name must be 1 to 60 characters on one line."
NAME_HIDDEN = "The site name has a hidden control character; type it again."

# D3: embeddings, overrides and isolates can reorder the text after the name in
# an email. The marks U+200E and U+200F can't, and right-to-left names need them.
_BIDI_CONTROLS = frozenset(chr(c) for c in (*range(0x202A, 0x202F), *range(0x2066, 0x206A)))


class BrandingRefusal(ValueError):
    """A refused branding value; its text is the sentence the panel shows."""


def check_site_name(raw: str) -> str:
    """D3: the name as stored, or BrandingRefusal with the sentence."""
    name = unicodedata.normalize("NFC", raw.replace("\t", " ").strip())
    if not name or len(name) > NAME_MAX or len(name.splitlines()) > 1:
        raise BrandingRefusal(NAME_ONE_LINE)
    # Cs: a lone surrogate (it can't be stored or sent).
    if any(unicodedata.category(ch) in ("Cc", "Cs", "Zl", "Zp") or ch in _BIDI_CONTROLS for ch in name):
        raise BrandingRefusal(NAME_HIDDEN)
    if not any(unicodedata.category(ch)[0] in "LNSP" for ch in name):
        raise BrandingRefusal(NAME_HIDDEN)
    return name


def short_hash(data: bytes) -> str:
    """D13: a file's version, the first 16 hex of its SHA-256."""
    return hashlib.sha256(data).hexdigest()[:16]


@dataclass(frozen=True)
class ImageMeta:
    width: int
    height: int
    hash: str


@dataclass(frozen=True)
class Branding:
    name: str = NAME_DEFAULT
    logo: ImageMeta | None = None
    icon: ImageMeta | None = None
    theme_changes: dict[str, str] = field(default_factory=dict)
    theme_text: str = ""
    theme_hash: str | None = None


DEFAULT_BRANDING = Branding()


class BrandingUnavailable(Exception):
    """An image's bytes couldn't be read (D13: the address answers 503)."""


# D13: the last branding read successfully, and whether an outage is logged.
_lock = threading.Lock()
_last_good: Branding = DEFAULT_BRANDING
_failing = False


def _image(width: int | None, height: int | None, hash_: str | None) -> ImageMeta | None:
    if width is None or height is None or hash_ is None:
        return None
    return ImageMeta(width, height, hash_)


def _read() -> Branding:
    # The row only: the image bytes live in their own table (D12).
    with SessionLocal() as db:
        row = db.execute(select(SiteBranding).where(SiteBranding.id == 1)).scalar_one_or_none()
        if row is None:
            return Branding()
        return Branding(
            name=row.site_name,
            logo=_image(row.logo_width, row.logo_height, row.logo_hash),
            icon=_image(row.icon_width, row.icon_height, row.icon_hash),
            theme_changes=dict(row.theme_changes or {}),
        )


def _copy(branding: Branding) -> Branding:
    # Each caller gets its own dict, so no caller can change the kept copy.
    return replace(branding, theme_changes=dict(branding.theme_changes))


def load_branding() -> Branding:
    """D13: the branding, read in its own session. Any error answers the last
    branding read successfully (the defaults before the first), logged once
    per outage, and never touches a caller's transaction.

    It takes a second pool connection while a request holds its own, so a
    request should call it before its first query of its own."""
    global _last_good, _failing
    try:
        branding = _read()
    except Exception as e:
        with _lock:
            if not _failing:
                # The driver's first line, never the SQL.
                reason = (str(getattr(e, "orig", None) or e).splitlines() or [""])[0]
                log.warning("branding: the database read failed (%s: %s); using the last branding read",
                            type(e).__name__, reason)
                _failing = True
            return _copy(_last_good)
    with _lock:
        _last_good, _failing = branding, False
    return _copy(branding)


def last_good() -> Branding:
    with _lock:
        return _copy(_last_good)


def read_image(kind: str) -> bytes | None:
    """The stored logo's or icon's bytes, None when there's none."""
    try:
        with SessionLocal() as db:
            return db.execute(select(SiteBrandingImage.data).where(SiteBrandingImage.kind == kind)).scalar_one_or_none()
    except Exception as e:
        raise BrandingUnavailable(kind) from e


def reset_cache() -> None:
    """Tests only: forget the last good copy and the outage."""
    global _last_good, _failing
    with _lock:
        _last_good, _failing = DEFAULT_BRANDING, False
