from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware

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
from mathion.api.submissions import router as submissions_router
from mathion.api.versions import router as versions_router

app = FastAPI(title="Mathion", version="0.1.0")
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
app.include_router(evaluations_router)
app.include_router(dashboard_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
