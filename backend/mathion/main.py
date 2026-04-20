from fastapi import FastAPI

from mathion.api.blocks import router as blocks_router
from mathion.api.courses import router as courses_router
from mathion.api.versions import router as versions_router

app = FastAPI(title="Mathion", version="0.1.0")
app.include_router(courses_router)
app.include_router(versions_router)
app.include_router(blocks_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
