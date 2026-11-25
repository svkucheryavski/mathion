---
worth: later
where: backend/pyproject.toml:7
added: 2026-11-24
---
# FastAPI is held at 0.141.1 because later releases require opentelemetry-api

From 0.142.0 FastAPI lists `opentelemetry-api` as a plain requirement, not an extra. The beta gate round (2026-11-24) kept the rule of no new backend packages and pinned 0.141.1, the last release without it; every advisory then open was in Starlette, python-multipart, nh3 and others, not FastAPI, and 0.141.1 accepts Starlette 1.10.

Unknown that settles it: whether a FastAPI advisory or a Starlette release that 0.141.1 cannot accept arrives first. When either does, decide between accepting `opentelemetry-api` (a no-op tracing interface without an SDK) and staying behind.

The hold lives in three places, all to change together: the `<0.142` cap in `backend/pyproject.toml`, the `fastapi==0.141.1` pin in `backend/constraints.txt`, and `test_fastapi_held_below_the_opentelemetry_release` in `backend/tests/test_requirements.py`.
