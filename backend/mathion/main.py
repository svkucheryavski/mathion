import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from sqlalchemy.engine import make_url

from mathion.api.auth import router as auth_router
from mathion.api.branding import favicon_ico, router as branding_router
from mathion.api.blocks import router as blocks_router
from mathion.api.content import router as content_router
from mathion.api.courses import router as courses_router
from mathion.api.dashboard import router as dashboard_router
from mathion.api.enrollment import router as enrollment_router
from mathion.api.evaluations import router as evaluations_router
from mathion.api.groups import router as groups_router
from mathion.api.student import router as student_router
from mathion.api.items import router as items_router
from mathion.api.questions import router as questions_router
from mathion.api.quiz import router as quiz_router
from mathion.api.assets import router as assets_router
from mathion.api.mini_projects import router as mini_projects_router
from mathion.api.run_assets import router as run_assets_router
from mathion.api.run_roster import router as run_roster_router
from mathion.api.run_teachers import router as run_teachers_router
from mathion.api.runs import router as runs_router
from mathion.api.student_mini_projects import router as student_mini_projects_router
from mathion.api.submissions import router as submissions_router
from mathion.api.superuser import router as superuser_router
from mathion.api.superuser_courses import router as superuser_courses_router
from mathion.api.superuser_branding import router as superuser_branding_router
from mathion.api.superuser_settings import router as superuser_settings_router
from mathion.api.superuser_users import router as superuser_users_router
from mathion.api.teaching import router as teaching_router
from mathion.api.versions import router as versions_router
from mathion.branding import load_branding
from mathion.config import settings, Settings
from mathion.notifications import (
    run_forever,
    acquire_singleton_lock,
    SHUTDOWN_TIMEOUT_SECONDS,
    build_mailer,
)
from mathion.page_fill import fill_index, load_index
from mathion.site_settings import MOVED_ENV_KEYS
from mathion.superuser.log_redaction import install as install_log_redaction

# Redact the panel token from uvicorn access logs. Installed at IMPORT TIME
# (top level, NOT in the lifespan) so it is active under every uvicorn
# --lifespan mode — importing this module wires it for the whole process.
install_log_redaction()

# Log through uvicorn's own logger so the startup line is actually emitted under
# uvicorn's default logging config: a plain module logger inherits root's WARNING
# level and uvicorn installs no handler on root, so an INFO record on it would be
# silently dropped on a real boot. `uvicorn.error` is configured at INFO with a
# handler.
logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app):
    # Fail closed: refuse to boot with the world-known dev secret (or an empty
    # one) when we're in a production posture (secure cookies enabled). The
    # secret salts PIN/token hashing (auth.hash_token), so a default in prod is
    # a real vulnerability, not a nag. Gated on cookie_secure — the prod .env
    # sets MATHION_COOKIE_SECURE=1; dev/tests leave it False, so this is inert
    # there. Lives here (lifespan), never at import, so pytest / alembic /
    # `python -m mathion.superuser` are unaffected.
    if settings.cookie_secure and (
        not settings.secret_key
        or settings.secret_key == Settings.model_fields["secret_key"].default
    ):
        raise RuntimeError(
            "Refusing to start: MATHION_SECRET_KEY is unset or still the dev "
            "default while MATHION_COOKIE_SECURE=1 (production). Set a strong "
            "secret, e.g. `openssl rand -base64 48`."
        )
    app.state.settings = settings
    # Echo the (password-redacted) database target on real uvicorn boot, so a
    # prod deploy that forgot MATHION_DATABASE_URL and silently fell back to the
    # localhost dev default is visible in the logs. make_url never renders the
    # password. This is in the lifespan on purpose — it must NOT fire on every
    # mathion.database import under alembic/CLI/tests.
    _db = make_url(settings.database_url)
    logger.info("Database target: %s@%s:%s/%s",
                _db.username, _db.host, _db.port or 5432, _db.database)
    # D2: the panel's Settings now set these; say once which ones .env still
    # sets, without asking anyone to delete them.
    ignored = sorted(k for k in MOVED_ENV_KEYS if k in os.environ)
    if ignored:
        logger.info("These .env keys are ignored since this version; the panel's "
                    "Settings page sets them: %s.", ", ".join(ignored))
    app.state.shutdown = asyncio.Event()
    # A developer outbox (`file`/`memory`, D2c) is built once here; otherwise
    # the loop builds the mailer from the panel's saved settings every tick.
    # An unknown MATHION_EMAIL_MODE fails the boot here, as before.
    app.state.mailer = build_mailer(None, settings.secret_key, settings.email_mode)
    # Superuser Settings D10: the panel can turn email on at any time, so the
    # loop and the single-sender lock start at every boot.
    app.state.lock_fd = None
    app.state.lock_fd = acquire_singleton_lock(settings)
    task = asyncio.create_task(run_forever(app))

    try:
        yield
    finally:
        app.state.shutdown.set()
        if task is not None:
            try:
                await asyncio.wait_for(task, timeout=SHUTDOWN_TIMEOUT_SECONDS)
            except asyncio.TimeoutError:
                task.cancel()
                try:
                    await asyncio.wait_for(task, timeout=5)
                except (asyncio.TimeoutError, asyncio.CancelledError):
                    pass
        if app.state.lock_fd is not None:
            app.state.lock_fd.close()
            app.state.lock_fd = None


app = FastAPI(title="Mathion", version="0.1.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def _superuser_no_store(request: Request, call_next):
    """no-store + no-referrer on EVERY /api/superuser/ response, including the
    guard's 401/404 (which bypass the handler body). The panel token lives in
    the URL, so error responses must not be cached or leak a Referer either."""
    response = await call_next(request)
    if request.url.path.startswith("/api/superuser/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.exception_handler(RequestValidationError)
async def _validation_error(request: Request, exc: RequestValidationError):
    """Superuser Settings D9b: a panel 422 never echoes its input, which may hold
    a typed SMTP password. Elsewhere, FastAPI's default answer."""
    if request.url.path.startswith("/api/superuser/"):
        return JSONResponse(status_code=422, content={
            "detail": [{"loc": list(e.get("loc", ())), "msg": e.get("msg", "")} for e in exc.errors()],
        })
    return await request_validation_exception_handler(request, exc)


app.include_router(auth_router)
app.include_router(courses_router)
app.include_router(versions_router)
app.include_router(blocks_router)
app.include_router(items_router)
app.include_router(content_router)
app.include_router(enrollment_router)
app.include_router(student_router)
app.include_router(questions_router)
app.include_router(quiz_router)
app.include_router(assets_router)
app.include_router(mini_projects_router)
app.include_router(run_assets_router)
app.include_router(runs_router)
app.include_router(run_teachers_router)
app.include_router(groups_router)
app.include_router(run_roster_router)
app.include_router(submissions_router)
app.include_router(student_mini_projects_router)
app.include_router(evaluations_router)
app.include_router(dashboard_router)
app.include_router(teaching_router)
app.include_router(superuser_router)
app.include_router(superuser_courses_router)
app.include_router(superuser_users_router)
app.include_router(superuser_settings_router)
app.include_router(superuser_branding_router)
app.include_router(branding_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/version")
def version_endpoint() -> dict:
    return {"version": settings.version}


# Branding D13: the tab icon, whether or not the built frontend exists.
app.add_api_route("/favicon.ico", favicon_ico, methods=["GET", "HEAD"], include_in_schema=False)


# The two SPA additions MUST come AFTER the include_router() calls above AND
# AFTER /health — a Starlette Mount registered first would shadow /health
# because mounts match every prefix below them.

# Guard 1: explicit catch-all for unknown /api/* so router typos return JSON
# 404 rather than falling through to the SPA fallback and getting index.html
# (without this, unknown /api/foo would serve the SPA shell with a 200 —
# silently masking API typos in production).
@app.api_route(
    "/api/{rest:path}",
    methods=["GET", "POST", "PATCH", "DELETE", "PUT", "HEAD", "OPTIONS"],
)
def _api_not_found(rest: str):
    raise HTTPException(status_code=404, detail="Not Found")


def _panel_cache_headers(full_path: str) -> dict[str, str] | None:
    """no-store for superuser panel document responses (the token is in the URL)."""
    if full_path == "superuser" or full_path.startswith("superuser/"):
        return {"Cache-Control": "no-store"}
    return None


def _page_cache_headers(full_path: str) -> dict[str, str]:
    """The filled page names the current branding versions: never cached (Branding D13)."""
    return _panel_cache_headers(full_path) or {"Cache-Control": "no-cache"}


# Guard 2: conditional SPA fallback. Starlette 1.x StaticFiles(html=True)
# no longer serves index.html as a universal catch-all for unknown paths, so
# we implement the SPA pattern manually:
#   - If the requested path resolves to an actual file inside dist/, serve it
#     (handles JS bundles, CSS, images, etc.).
#   - Otherwise serve index.html, letting the SPA router handle the path in
#     the browser.
# The entire block is skipped when the dist directory is missing so that
# pure-backend dev / CI without a frontend build still works.
# The page itself is read once, here, and filled per request (Branding D13).
_frontend_dist = Path(settings.frontend_dist)
_index = load_index(_frontend_dist / "index.html") if _frontend_dist.is_dir() else None
if _frontend_dist.is_dir():

    @app.api_route(
        "/{full_path:path}",
        methods=["GET", "HEAD"],
        include_in_schema=False,
    )
    def _spa_fallback(full_path: str) -> Response:
        candidate = _frontend_dist / full_path
        # Path-traversal guard: a resolved candidate must stay inside dist/.
        # If it doesn't, return a 404 rather than the SPA shell so malformed
        # paths fail explicitly instead of silently rendering the app.
        try:
            candidate = candidate.resolve()
            candidate.relative_to(_frontend_dist.resolve())
        except ValueError:
            raise HTTPException(status_code=404)
        headers = _panel_cache_headers(full_path)
        index = _frontend_dist.resolve() / "index.html"
        if candidate.is_file() and candidate != index:
            return FileResponse(candidate, headers=headers)
        if _index is None:
            return FileResponse(index, headers=headers)
        return HTMLResponse(fill_index(_index, load_branding()), headers=_page_cache_headers(full_path))
