import asyncio
import logging
from datetime import datetime, timezone

import pytest

from mathion.config import settings
from mathion.main import app
from mathion.notifications.mailer import MemoryMailer
from mathion.models_auth import NotificationLogEntry


# ---------------------------------------------------------------------------
# Local fixture (Option A — not in conftest)
# ---------------------------------------------------------------------------

@pytest.fixture
def seeded_run(seed_run_with_groups, db):
    """Return dict with 'run' (Run ORM) and 'student_user' (User ORM).

    Mark any notification rows created by the seeding API calls as already-sent
    so that tick() tests start with a clean slate and can assert on exactly the
    rows they add.
    """
    from datetime import datetime, timezone as tz
    from sqlalchemy import update
    from mathion.models import Run
    from mathion.models_auth import User
    run_dict, _ga, _gb = seed_run_with_groups()
    # Stamp all seed-created notifications as already sent so tick() ignores them.
    db.execute(
        update(NotificationLogEntry)
        .values(sent_at=datetime.now(tz.utc))
    )
    db.commit()
    run = db.get(Run, run_dict["id"])
    student_user = db.query(User).filter_by(email="alice@example.com").one()
    return {"run": run, "student_user": student_user}


# ---------------------------------------------------------------------------
# _SlowMailer: MemoryMailer that sleeps 2s on each send to force mid-batch
# ---------------------------------------------------------------------------

class _SlowMailer(MemoryMailer):
    """MemoryMailer that sleeps 2s on each send to force a mid-batch shutdown."""
    def send(self, msg):
        import time
        time.sleep(2)
        self.sent.append(msg)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_lifespan_shutdown_with_inflight_tick(db, seeded_run, tmp_path, monkeypatch, caplog):
    """Verify the §5 task.cancel() + asyncio.wait_for drain logic."""
    # Re-import live settings/app in case test_main_spa.py reloaded them.
    import mathion.config
    live_settings = mathion.config.settings
    monkeypatch.setattr(live_settings, "dispatcher_lock_path", str(tmp_path / "shutdown.lock"))
    monkeypatch.setattr(live_settings, "email_mode", "memory")

    student = seeded_run["student_user"]
    run = seeded_run["run"]
    for _ in range(20):
        db.add(NotificationLogEntry(
            user_id=student.id, kind="run_enrolled",
            payload={"run_id": run.id}))
    db.commit()

    caplog.set_level(logging.ERROR, logger="asyncio")

    # Patch the mailer factory to return a slow MemoryMailer
    monkeypatch.setattr(
        "mathion.main.build_mailer_from_settings",
        lambda s: _SlowMailer())

    import mathion.main
    live_app = mathion.main.app
    live_lifespan = mathion.main.lifespan
    async with live_lifespan(live_app):
        # Wait for at least one send
        for _ in range(50):
            if hasattr(live_app.state, "mailer") and live_app.state.mailer is not None and len(live_app.state.mailer.sent) > 0:
                break
            await asyncio.sleep(0.1)
        # Trigger shutdown — lifespan __aexit__ will set shutdown event + drain
    # After exit: cleanup pollution for other tests
    live_app.state.mailer = None
    live_app.state.shutdown = None
    live_app.state.lock_fd = None
    # No "Task was destroyed but it is pending"
    leaked = [r for r in caplog.records
              if "Task was destroyed but it is pending" in r.getMessage()]
    assert not leaked, "asyncio leaked a pending task at shutdown"
