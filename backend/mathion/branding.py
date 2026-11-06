"""The site's branding (superuser Branding spec): the site name, the logo, the
tab icon and the colour changes.

`check_site_name` is D3's rule. `load_branding` is D13's one read that never
fails: it answers the last branding it read successfully, or the defaults.
The writers (D12) lock the one row and change only their own item; the caller
commits.
"""
import hashlib
import logging
import threading
import unicodedata
from dataclasses import dataclass, field, replace

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from mathion.database import SessionLocal
from mathion.models_auth import SiteBranding, SiteBrandingImage
from mathion.theme_css import changes_in_use, write_stylesheet

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


def _from_row(db: Session) -> Branding:
    # The row only: the image bytes live in their own table (D12).
    row = db.execute(select(SiteBranding).where(SiteBranding.id == 1)).scalar_one_or_none()
    if row is None:
        return Branding()
    return Branding(
        name=row.site_name,
        logo=_image(row.logo_width, row.logo_height, row.logo_hash),
        icon=_image(row.icon_width, row.icon_height, row.icon_hash),
        theme_changes=dict(row.theme_changes or {}),
    )


def _read() -> Branding:
    with SessionLocal() as db:
        return _from_row(db)


def _with_theme(branding: Branding) -> Branding:
    """The stored colours in use and the stylesheet written from them (D10,
    D13). Worked out after the database read, so a bug here isn't logged as
    an outage; it answers Mathion's colours instead of failing the read."""
    try:
        changes = changes_in_use(branding.theme_changes)
        text = write_stylesheet(changes)
    except Exception:
        log.exception("branding: the stored colours couldn't be written; using Mathion's colours")
        return replace(branding, theme_changes={}, theme_text="", theme_hash=None)
    return replace(branding, theme_changes=changes, theme_text=text,
                   theme_hash=short_hash(text.encode()) if text else None)


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
    branding = _with_theme(branding)
    with _lock:
        _last_good, _failing = branding, False
    return _copy(branding)


def read_in(db: Session) -> Branding:
    """The branding through the caller's session: the panel's read after its
    own save, which must see what it just committed (D14). Errors propagate."""
    return _with_theme(_from_row(db))


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


# --- the writers (D12) ---

_ITEM = {"logo": "logo", "icon": "tab icon"}


def _locked_row(db: Session) -> SiteBranding:
    """The row, created from the defaults when absent, locked and read fresh,
    so two cards saved at once both land."""
    db.execute(insert(SiteBranding).values(id=1).on_conflict_do_nothing(index_elements=["id"]))
    return db.execute(select(SiteBranding).where(SiteBranding.id == 1).with_for_update()
                      .execution_options(populate_existing=True)).scalar_one()


def _changed(item: str, by: int | None) -> None:
    # The item, never the content (D12).
    log.info("branding: %s changed by %s", item, f"user {by}" if by is not None else "the server command")


def save_name(db: Session, name: str, *, by: int | None = None) -> None:
    _locked_row(db).site_name = name
    _changed("site name", by)


def save_image(db: Session, kind: str, data: bytes, width: int, height: int, *, by: int | None = None) -> None:
    """The version is the hash of these bytes, written with them (D13)."""
    row = _locked_row(db)
    setattr(row, f"{kind}_width", width)
    setattr(row, f"{kind}_height", height)
    setattr(row, f"{kind}_hash", short_hash(data))
    # An upsert, so the old bytes are never loaded.
    db.execute(insert(SiteBrandingImage).values(kind=kind, data=data)
               .on_conflict_do_update(index_elements=["kind"], set_={"data": data}))
    _changed(_ITEM[kind], by)


def clear_image(db: Session, kind: str, *, by: int | None = None) -> None:
    row = _locked_row(db)
    for column in ("width", "height", "hash"):
        setattr(row, f"{kind}_{column}", None)
    db.execute(delete(SiteBrandingImage).where(SiteBrandingImage.kind == kind))
    _changed(_ITEM[kind], by)


def save_theme(db: Session, changes: dict[str, str], *, by: int | None = None) -> None:
    """Replaces the whole stored set, left-out entries included (D10)."""
    _locked_row(db).theme_changes = dict(changes)  # a new dict: in-place changes aren't tracked
    _changed("colours", by)


def clear_theme(db: Session, *, by: int | None = None) -> None:
    save_theme(db, {}, by=by)


def reset(db: Session, everything: bool, *, by: int | None = None) -> list[str]:
    """D15: the colours, or every item, back to the defaults. Answers what was reset."""
    if not everything:
        clear_theme(db, by=by)
        return ["colours"]
    save_name(db, NAME_DEFAULT, by=by)
    clear_image(db, "logo", by=by)
    clear_image(db, "icon", by=by)
    clear_theme(db, by=by)
    return ["site name", "logo", "tab icon", "colours"]
