"""The public branding files (superuser Branding spec D13): no sign-in,
versioned by a hash of the bytes served, and safe during a database outage."""
from fastapi import APIRouter, HTTPException, Request, Response

from mathion.branding import BrandingUnavailable, last_good, load_branding, read_image, short_hash
from mathion.branding_defaults import ICON_32_PNG, ICON_180_PNG, ICON_SVG

# Files, not JSON: kept out of the OpenAPI schema.
router = APIRouter(prefix="/api/branding", tags=["branding"], include_in_schema=False)

_YEAR = "public, max-age=31536000, immutable"
# Never sniffed as another type; an SVG opened on its own runs nothing.
_SAFE = {"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox"}


def _matches(request: Request, etag: str) -> bool:
    """If-None-Match names this ETag (weak or strong), or is "*"."""
    sent = request.headers.get("if-none-match")
    if not sent:
        return False
    tags = [t.strip().removeprefix("W/") for t in sent.split(",")]
    return "*" in tags or etag in tags


def _answer(request: Request, data: bytes, media_type: str) -> Response:
    # The bytes come from the database, so the ETag and 304 are worked out here.
    version = short_hash(data)
    headers = {**_SAFE, "ETag": f'"{version}"',
               "Cache-Control": _YEAR if request.query_params.get("v") == version else "no-cache"}
    if _matches(request, headers["ETag"]):
        return Response(status_code=304, headers=headers)
    return Response(data, media_type=media_type, headers=headers)


def _unavailable(request: Request, kind: str) -> Response:
    """The bytes can't be read: a browser that has the last image read keeps
    it (304); anything else is told to ask again (503), never 404 or cached."""
    kept = getattr(last_good(), kind)
    if kept is not None and _matches(request, f'"{kept.hash}"'):
        return Response(status_code=304, headers={**_SAFE, "ETag": f'"{kept.hash}"', "Cache-Control": "no-cache"})
    return Response(status_code=503, headers={"Cache-Control": "no-store"})


def _upload(request: Request, kind: str) -> Response:
    try:
        data = read_image(kind)
    except BrandingUnavailable:
        return _unavailable(request, kind)
    if data is None:
        raise HTTPException(status_code=404, detail="Not Found")
    return _answer(request, data, "image/png")


@router.api_route("/logo.png", methods=["GET", "HEAD"])
def logo_png(request: Request) -> Response:
    return _upload(request, "logo")


@router.api_route("/icon.png", methods=["GET", "HEAD"])
def icon_png(request: Request) -> Response:
    return _upload(request, "icon")


@router.api_route("/icon-default.svg", methods=["GET", "HEAD"])
def icon_default_svg(request: Request) -> Response:
    return _answer(request, ICON_SVG, "image/svg+xml")


@router.api_route("/icon-default-32.png", methods=["GET", "HEAD"])
def icon_default_32(request: Request) -> Response:
    return _answer(request, ICON_32_PNG, "image/png")


@router.api_route("/icon-default-180.png", methods=["GET", "HEAD"])
def icon_default_180(request: Request) -> Response:
    return _answer(request, ICON_180_PNG, "image/png")


@router.api_route("/theme.css", methods=["GET", "HEAD"])
def theme_css(request: Request) -> Response:
    # Empty when no changes are in use; the last good copy during an outage.
    return _answer(request, load_branding().theme_text.encode(), "text/css; charset=utf-8")


def favicon_ico(request: Request) -> Response:
    """`/favicon.ico`: the uploaded icon, else the 32 px default."""
    try:
        data = read_image("icon")
    except BrandingUnavailable:
        if last_good().icon is not None:
            return _unavailable(request, "icon")
        data = None
    return _answer(request, data if data is not None else ICON_32_PNG, "image/png")
