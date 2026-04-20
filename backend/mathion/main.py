from fastapi import FastAPI

from mathion.api.courses import router as courses_router

app = FastAPI(title="Mathion", version="0.1.0")
app.include_router(courses_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
