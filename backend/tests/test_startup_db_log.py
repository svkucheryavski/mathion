"""The startup DB-target log must actually be emitted on a real uvicorn boot.

A plain module logger inherits root's WARNING level, and uvicorn installs no
handler on root, so an INFO record on it would be silently dropped. main.py logs
the target through the `uvicorn.error` logger (configured at INFO with a handler)
so the line is visible on boot. This test guards that routing AND the password
redaction (spec §50).
"""
import logging

from fastapi.testclient import TestClient

from mathion.main import app


def test_startup_logs_redacted_db_target_via_uvicorn_logger():
    captured: list[str] = []

    class _Capture(logging.Handler):
        def emit(self, record):
            captured.append(record.getMessage())

    handler = _Capture()
    uvlog = logging.getLogger("uvicorn.error")
    uvlog.addHandler(handler)
    prev_level = uvlog.level
    uvlog.setLevel(logging.INFO)
    try:
        with TestClient(app):  # entering the context runs the lifespan startup
            pass
    finally:
        uvlog.removeHandler(handler)
        uvlog.setLevel(prev_level)

    target = [m for m in captured if "Database target:" in m]
    # Emitted via uvicorn.error — would be dropped if logged via a plain module
    # logger, which is exactly the regression this guards.
    assert target, "startup did not log the DB target through uvicorn.error"
    # make_url renders only username@host:port/db — never a user:password pair.
    assert all("mathion:mathion" not in m for m in target), target
