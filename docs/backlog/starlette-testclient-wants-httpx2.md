---
worth: later
where: backend/tests/conftest.py:5
added: 2026-11-24
---
# Starlette's TestClient warns that httpx is deprecated in favour of httpx2

Since the 2026-11-24 bump (Starlette 1.10.0) every backend run prints `StarletteDeprecationWarning: Using httpx with starlette.testclient is deprecated; install httpx2 instead.` The tests still pass on `httpx`. Switching means a new dev package, which the no-new-packages rule keeps out for now.

Unknown that settles it: the Starlette release that drops `httpx` support. Before taking it, either accept `httpx2` as a dev dependency or move the tests off `TestClient`.
