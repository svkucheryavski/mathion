import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse

from mathion.api.auth import router as auth_router
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
from mathion.api.teaching import router as teaching_router
from mathion.api.versions import router as versions_router
from mathion.config import settings
from mathion.notifications import (
    run_forever,
    acquire_singleton_lock,
    SHUTDOWN_TIMEOUT_SECONDS,
    build_mailer_from_settings,
)


@asynccontextmanager
async def lifespan(app):
    app.state.settings = settings
    app.state.shutdown = asyncio.Event()
    app.state.mailer = build_mailer_from_settings(settings)
    app.state.lock_fd = None
    if app.state.mailer is not None:
        app.state.lock_fd = acquire_singleton_lock(settings)
        task = asyncio.create_task(run_forever(app))
    else:
        task = None

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


@app.get("/health")
def health_check():
    return {"status": "ok"}


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


# Guard 2: conditional SPA fallback. Starlette 1.x StaticFiles(html=True)
# no longer serves index.html as a universal catch-all for unknown paths, so
# we implement the SPA pattern manually:
#   - If the requested path resolves to an actual file inside dist/, serve it
#     (handles JS bundles, CSS, images, etc.).
#   - Otherwise serve index.html, letting the SPA router handle the path in
#     the browser.
# The entire block is skipped when the dist directory is missing so that
# pure-backend dev / CI without a frontend build still works.
_frontend_dist = Path(settings.frontend_dist)
if _frontend_dist.is_dir():

    @app.api_route(
        "/{full_path:path}",
        methods=["GET", "HEAD"],
        include_in_schema=False,
    )
    def _spa_fallback(full_path: str) -> FileResponse:
        candidate = _frontend_dist / full_path
        # Path-traversal guard: a resolved candidate must stay inside dist/.
        # If it doesn't, return a 404 rather than the SPA shell so malformed
        # paths fail explicitly instead of silently rendering the app.
        try:
            candidate = candidate.resolve()
            candidate.relative_to(_frontend_dist.resolve())
        except ValueError:
            raise HTTPException(status_code=404)
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_frontend_dist / "index.html")
