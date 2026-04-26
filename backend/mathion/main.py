from fastapi import FastAPI

from mathion.api.auth import router as auth_router
from mathion.api.blocks import router as blocks_router
from mathion.api.content import router as content_router
from mathion.api.courses import router as courses_router
from mathion.api.enrollment import router as enrollment_router
from mathion.api.student import router as student_router
from mathion.api.items import router as items_router
from mathion.api.questions import router as questions_router
from mathion.api.quiz import router as quiz_router
from mathion.api.assets import router as assets_router
from mathion.api.run_teachers import router as run_teachers_router
from mathion.api.runs import router as runs_router
from mathion.api.versions import router as versions_router

app = FastAPI(title="Mathion", version="0.1.0")
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
app.include_router(runs_router)
app.include_router(run_teachers_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
