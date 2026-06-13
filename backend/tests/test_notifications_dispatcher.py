import pytest
from sqlalchemy import text

from mathion.notifications.dispatcher import _build_render_context
from mathion.models_auth import NotificationLogEntry, User
from mathion.models import Run


# ---------------------------------------------------------------------------
# Local fixtures (Option A — not in conftest)
# ---------------------------------------------------------------------------

@pytest.fixture
def seeded_run(seed_run_with_groups, db):
    """Return dict with 'run' (Run ORM) and 'student_user' (User ORM)."""
    run_dict, _ga, _gb = seed_run_with_groups()
    run = db.get(Run, run_dict["id"])
    student_user = db.query(User).filter_by(email="alice@example.com").one()
    return {"run": run, "student_user": student_user}


@pytest.fixture
def seeded_user(seed_run_with_groups, db):
    """Return a single User ORM object (alice, enrolled in a run)."""
    seed_run_with_groups()
    return db.query(User).filter_by(email="alice@example.com").one()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_build_render_context_run_enrolled(db, seeded_run):
    user = seeded_run["student_user"]
    run = seeded_run["run"]
    entry = NotificationLogEntry(
        user_id=user.id, kind="run_enrolled",
        payload={"run_id": run.id},
    )
    db.add(entry); db.flush()
    ctx = _build_render_context(db, entry)
    assert ctx.user.id == user.id
    assert ctx.run.id == run.id
    assert ctx.mp is None
    assert ctx.sub is None


def test_build_render_context_missing_run_raises(db, seeded_user):
    entry = NotificationLogEntry(
        user_id=seeded_user.id, kind="run_enrolled",
        payload={"run_id": 999999},
    )
    db.add(entry); db.flush()
    with pytest.raises(LookupError, match="referent missing"):
        _build_render_context(db, entry)


def test_build_render_context_missing_user_raises(db, seeded_run):
    # user_id=999999 doesn't exist; bypass FK via raw INSERT (FK enforced by
    # SQLite at the ORM level would reject db.flush() with IntegrityError).
    db.execute(text("PRAGMA foreign_keys=OFF"))
    entry = NotificationLogEntry(
        user_id=999999, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id},
    )
    db.add(entry); db.flush()
    db.execute(text("PRAGMA foreign_keys=ON"))
    with pytest.raises(LookupError, match="referent missing"):
        _build_render_context(db, entry)


@pytest.mark.skip(reason="seeded_run_with_eval fixture deferred — covered by T11/T12 integration tests")
def test_build_render_context_evaluation_received_loads_mp_sub(db, seeded_run_with_eval):
    user = seeded_run_with_eval["student_user"]
    entry = NotificationLogEntry(
        user_id=user.id, kind="evaluation_received",
        payload={
            "run_id": seeded_run_with_eval["run"].id,
            "mini_project_id": seeded_run_with_eval["mp"].id,
            "submission_id": seeded_run_with_eval["submission"].id,
        },
    )
    db.add(entry); db.flush()
    ctx = _build_render_context(db, entry)
    assert ctx.mp is not None and ctx.sub is not None
