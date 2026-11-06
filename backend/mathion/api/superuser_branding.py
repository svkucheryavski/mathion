"""The superuser panel's Branding page (superuser Branding spec D2-D10, D12,
D14): one read, and one save per card. Each save commits, then answers the
whole read, so the panel never shows values from before the save."""
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from mathion import branding
from mathion.api.superuser import require_superuser_panel, require_superuser_panel_write
from mathion.branding import BrandingRefusal, check_site_name
from mathion.contrast import contrast_warnings
from mathion.database import get_db
from mathion.models_auth import User
from mathion.page_fill import branding_public
from mathion.png_check import PngRefused, check_png
from mathion.schemas import (
    BrandingNameIn, ImageSize, PanelBranding, PanelColours, ThemeCheck, ThemeVarOut,
)
from mathion.site_settings import MB
from mathion.theme_css import MAX_BYTES, parse_theme, same_colour
from mathion.theme_vars import THEME_VARS

log = logging.getLogger(__name__)

router = APIRouter(tags=["superuser"])
_BASE = "/api/superuser/{token}/branding"

# Mine: a request that sends both or neither is a caller's bug, not a person's.
_NAME_OR_RESET = "Send a name or reset, not both."
_FILE_OR_RESET = "Send a file or reset, not both."

# D4, D6: the item's words, the longest side, the most pixels, and the cap's sentence.
_IMAGES = {
    "logo": ("logo", 4096, 4_000_000, "The logo can be at most 4096 px on a side and 4 million pixels in all."),
    "icon": ("tab icon", 1024, None, "The tab icon can be at most 1024 px on a side."),
}

# D10.
_MATCHES_MATHION_REMOVES = "This file matches Mathion's colours, so saving it removes your changes."
_MATCHES_MATHION = "This file matches Mathion's colours."
_MATCHES_SAVED = "This file matches the saved colours."


def _bad(sentence: str):
    raise HTTPException(status_code=422, detail=sentence)


def _read_capped(f, limit: int) -> bytes:
    """At most `limit` + 1 bytes, so an oversized upload is never read whole (D5)."""
    parts, left = [], limit + 1
    while left > 0:
        part = f.read(min(left, 65536))
        if not part:
            break
        parts.append(part)
        left -= len(part)
    return b"".join(parts)


def _panel(db: Session) -> PanelBranding:
    b = branding.read_in(db)
    size = lambda m: ImageSize(width=m.width, height=m.height) if m else None  # noqa: E731
    return PanelBranding(
        name=b.name, logo=size(b.logo), icon=size(b.icon),
        colours=PanelColours(
            vars=[ThemeVarOut(name=v.name, default=v.default, heading=v.heading) for v in THEME_VARS],
            changes=b.theme_changes, warnings=contrast_warnings(b.theme_changes),
        ),
        public=branding_public(b),
    )


@router.get(_BASE, response_model=PanelBranding)
def get_branding(_user: User = Depends(require_superuser_panel), db: Session = Depends(get_db)):
    return _panel(db)


@router.put(f"{_BASE}/name", response_model=PanelBranding)
def save_name(data: BrandingNameIn, user: User = Depends(require_superuser_panel_write),
              db: Session = Depends(get_db)):
    if (data.name is None) != data.reset:
        _bad(_NAME_OR_RESET)
    if data.reset:
        name = branding.NAME_DEFAULT
    else:
        try:
            name = check_site_name(data.name)
        except BrandingRefusal as e:
            _bad(str(e))
    branding.save_name(db, name, by=user.id)
    db.commit()
    return _panel(db)


def _one_of(file: UploadFile | None, reset: bool) -> None:
    if (file is None) != reset:
        _bad(_FILE_OR_RESET)


def _save_image(kind: str, file: UploadFile | None, reset: bool, user: User, db: Session) -> PanelBranding:
    _one_of(file, reset)
    if reset:
        branding.clear_image(db, kind, by=user.id)
    else:
        item, side, pixels, too_large = _IMAGES[kind]
        data = _read_capped(file.file, MB)
        if len(data) > MB:
            _bad(f"The {item} can be at most 1 MB.")
        try:
            width, height = check_png(data)
        except PngRefused as e:
            log.info("branding: a %s upload was refused (%s)", item, e)
            _bad(f"The {item} must be a PNG file.")
        if width > side or height > side or (pixels is not None and width * height > pixels):
            _bad(too_large)
        branding.save_image(db, kind, data, width, height, by=user.id)
    db.commit()
    return _panel(db)


@router.post(f"{_BASE}/logo", response_model=PanelBranding)
def save_logo(file: UploadFile | None = File(None), reset: bool = Form(False),
              user: User = Depends(require_superuser_panel_write), db: Session = Depends(get_db)):
    return _save_image("logo", file, reset, user, db)


@router.post(f"{_BASE}/icon", response_model=PanelBranding)
def save_icon(file: UploadFile | None = File(None), reset: bool = Form(False),
              user: User = Depends(require_superuser_panel_write), db: Session = Depends(get_db)):
    return _save_image("icon", file, reset, user, db)


def _same_set(a: dict[str, str], b: dict[str, str]) -> bool:
    return a.keys() == b.keys() and all(same_colour(a[n], b[n]) for n in a)


@router.post(f"{_BASE}/theme/check", response_model=ThemeCheck)
def check_theme(file: UploadFile = File(...), _user: User = Depends(require_superuser_panel_write),
                db: Session = Depends(get_db)):
    parsed = parse_theme(_read_capped(file.file, MAX_BYTES))
    check = ThemeCheck(changes=parsed.changes, problems=parsed.problems, more=parsed.more,
                       warnings=[], blocked=None)
    if parsed.problems:
        return check
    new, saved = parsed.changes, branding.read_in(db).theme_changes
    if not new:
        # One sentence in place of a "puts back" for each saved colour.
        if saved:
            check.warnings = [_MATCHES_MATHION_REMOVES]
        else:
            check.blocked = _MATCHES_MATHION
        return check
    check.warnings = contrast_warnings(new)
    if _same_set(new, saved):
        check.blocked = _MATCHES_SAVED
    else:
        check.warnings += [f"This file puts back Mathion's colour for `{v.name}`, which is changed now."
                           for v in THEME_VARS if v.name in saved and v.name not in new]
    return check


@router.post(f"{_BASE}/theme", response_model=PanelBranding)
def save_theme(file: UploadFile | None = File(None), reset: bool = Form(False),
               user: User = Depends(require_superuser_panel_write), db: Session = Depends(get_db)):
    _one_of(file, reset)
    if reset:
        branding.clear_theme(db, by=user.id)
    else:
        parsed = parse_theme(_read_capped(file.file, MAX_BYTES))
        if parsed.problems:
            _bad(parsed.problems[0])
        branding.save_theme(db, parsed.changes, by=user.id)
    db.commit()
    return _panel(db)
