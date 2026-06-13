import pytest
import smtplib
import logging
from datetime import datetime, timezone
from sqlalchemy import text

from mathion.notifications.dispatcher import _build_render_context
from mathion.models_auth import NotificationLogEntry, User
from mathion.models import Run


# ---------------------------------------------------------------------------
# Local fixtures (Option A — not in conftest)
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


def test_build_render_context_missing_run_id_key_raises_keyerror(db, seeded_user):
    entry = NotificationLogEntry(
        user_id=seeded_user.id, kind="run_enrolled",
        payload={},  # no run_id key at all
    )
    db.add(entry); db.flush()
    with pytest.raises(KeyError, match="payload missing run_id"):
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


# ---------------------------------------------------------------------------
# T11 — tick() dispatcher tests
# ---------------------------------------------------------------------------

from datetime import timedelta

from mathion.notifications.dispatcher import tick, BATCH_SIZE
from mathion.notifications.mailer import MemoryMailer


def test_tick_returns_zero_on_empty(db):
    assert tick(db, MemoryMailer(), now=datetime.now(timezone.utc)) == 0


def test_tick_single_row_happy_path(db, seeded_run):
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id},
    )
    db.add(entry); db.commit()
    mailer = MemoryMailer()
    assert tick(db, mailer, now=datetime.now(timezone.utc)) == 1
    db.refresh(entry)
    assert entry.sent_at is not None
    assert len(mailer.sent) == 1


def test_tick_batch_size_capped(db, seeded_run):
    student = seeded_run["student_user"]
    for _ in range(BATCH_SIZE + 10):
        db.add(NotificationLogEntry(
            user_id=student.id, kind="run_enrolled",
            payload={"run_id": seeded_run["run"].id}))
    db.commit()
    mailer = MemoryMailer()
    assert tick(db, mailer, now=datetime.now(timezone.utc)) == BATCH_SIZE


def test_tick_orders_by_created_at_then_id(db, seeded_run):
    ids = []
    for i in range(3):
        e = NotificationLogEntry(
            user_id=seeded_run["student_user"].id, kind="run_enrolled",
            payload={"run_id": seeded_run["run"].id})
        db.add(e); db.commit(); ids.append(e.id)
    mailer = MemoryMailer()
    tick(db, mailer, now=datetime.now(timezone.utc))
    assert len(mailer.sent) == 3


def test_tick_skips_already_sent(db, seeded_run):
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id},
        sent_at=datetime.now(timezone.utc),
    )
    db.add(entry); db.commit()
    mailer = MemoryMailer()
    assert tick(db, mailer, now=datetime.now(timezone.utc)) == 0
    assert len(mailer.sent) == 0


def test_tick_skips_errored(db, seeded_run):
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id},
        error="permanently failed",
    )
    db.add(entry); db.commit()
    mailer = MemoryMailer()
    assert tick(db, mailer, now=datetime.now(timezone.utc)) == 0


def test_tick_skips_backoff_future(db, seeded_run):
    future = datetime.now(timezone.utc) + timedelta(minutes=5)
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id},
        next_attempt_at=future,
    )
    db.add(entry); db.commit()
    mailer = MemoryMailer()
    assert tick(db, mailer, now=datetime.now(timezone.utc)) == 0


def test_tick_backoff_boundary_inclusive(db, seeded_run):
    now = datetime.now(timezone.utc)
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id},
        next_attempt_at=now,
    )
    db.add(entry); db.commit()
    mailer = MemoryMailer()
    assert tick(db, mailer, now=now) == 1


# ---------------------------------------------------------------------------
# T12 — error-path tests for tick() dispatcher
# ---------------------------------------------------------------------------


class _RaisingMailer(MemoryMailer):
    def __init__(self, exc): super().__init__(); self.exc = exc
    def send(self, msg): raise self.exc


def test_transient_failure_1st_retry(db, seeded_run):
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id})
    db.add(entry); db.commit()
    now = datetime.now(timezone.utc)
    tick(db, _RaisingMailer(ConnectionRefusedError("nope")), now=now)
    db.refresh(entry)
    assert entry.retry_count == 1
    # SQLite strips tzinfo on readback; compare using naive reference
    expected = (now + timedelta(seconds=300)).replace(tzinfo=None)
    assert entry.next_attempt_at == expected
    assert entry.error is None


def test_transient_exhausted_attempts(db, seeded_run):
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id},
        retry_count=4)
    db.add(entry); db.commit()
    tick(db, _RaisingMailer(ConnectionRefusedError("nope")), now=datetime.now(timezone.utc))
    db.refresh(entry)
    assert entry.retry_count == 5
    assert entry.next_attempt_at is None
    assert entry.error and entry.error.startswith("max attempts:")


def test_permanent_failure_smtp_550(db, seeded_run):
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id})
    db.add(entry); db.commit()
    tick(db, _RaisingMailer(smtplib.SMTPResponseException(550, "no mailbox")),
         now=datetime.now(timezone.utc))
    db.refresh(entry)
    assert entry.retry_count == 1
    assert entry.next_attempt_at is None
    assert entry.error and "no mailbox" in entry.error
    assert not entry.error.startswith("max attempts:")


def test_permanent_failure_smtp_recipients_refused(db, seeded_run):
    """Spec §12 line 1149: SMTPRecipientsRefused with a 5xx recipient code → permanent."""
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id})
    db.add(entry); db.commit()
    refused = smtplib.SMTPRecipientsRefused({"x@example.com": (550, b"no such user")})
    tick(db, _RaisingMailer(refused), now=datetime.now(timezone.utc))
    db.refresh(entry)
    assert entry.retry_count == 1
    assert entry.next_attempt_at is None
    assert entry.error is not None
    assert not entry.error.startswith("max attempts:")


def test_smtp_auth_error_redacted(db, seeded_run, caplog):
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id})
    db.add(entry); db.commit()
    sensitive = smtplib.SMTPAuthenticationError(
        535, b"535 5.7.8 Authentication credentials invalid for user@example.com")
    caplog.set_level(logging.WARNING, logger="mathion.notifications")
    tick(db, _RaisingMailer(sensitive), now=datetime.now(timezone.utc))
    db.refresh(entry)
    assert entry.error == "SMTP authentication failed (see operator logs)"
    assert "user@example.com" not in (entry.error or "")
    # Full exception is in the logs for the operator
    has_full_exc = any(
        r.exc_info and r.exc_info[1] is sensitive for r in caplog.records
    )
    assert has_full_exc


def test_per_row_containment(db, seeded_run):
    # Insert 3 rows: first OK, middle raises, third OK.
    e1 = NotificationLogEntry(user_id=seeded_run["student_user"].id, kind="run_enrolled",
                              payload={"run_id": seeded_run["run"].id})
    e2 = NotificationLogEntry(user_id=seeded_run["student_user"].id, kind="run_enrolled",
                              payload={"run_id": seeded_run["run"].id})
    e3 = NotificationLogEntry(user_id=seeded_run["student_user"].id, kind="run_enrolled",
                              payload={"run_id": seeded_run["run"].id})
    db.add_all([e1, e2, e3]); db.commit()

    class _SometimesFail(MemoryMailer):
        def __init__(self): super().__init__(); self.calls = 0
        def send(self, msg):
            self.calls += 1
            if self.calls == 2:
                raise ConnectionRefusedError("boom")
            self.sent.append(msg)

    tick(db, _SometimesFail(), now=datetime.now(timezone.utc))
    db.refresh(e1); db.refresh(e2); db.refresh(e3)
    assert e1.sent_at is not None
    assert e2.sent_at is None and e2.retry_count == 1
    assert e3.sent_at is not None


def test_render_failure_classifies_permanent(db, seeded_run):
    # Drop a required payload key to force a permanent exception during render
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="evaluation_received",
        payload={"run_id": seeded_run["run"].id})  # missing mini_project_id
    db.add(entry); db.commit()
    tick(db, MemoryMailer(), now=datetime.now(timezone.utc))
    db.refresh(entry)
    assert entry.error is not None
    assert entry.next_attempt_at is None


# ---------------------------------------------------------------------------
# T13 — session-acquire wedge tests
# ---------------------------------------------------------------------------


class _WedgedMailer(MemoryMailer):
    def __init__(self, exc):
        super().__init__()
        self.exc = exc

    def session(self):
        class _CM:
            def __init__(self, exc): self.exc = exc
            def __enter__(self): raise self.exc
            def __exit__(self, *a): return False
        return _CM(self.exc)


def test_session_acquire_wedge_no_row_state_change(db, seeded_run, caplog):
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id})
    db.add(entry); db.commit()
    caplog.set_level(logging.WARNING, logger="mathion.notifications")
    rc = tick(db, _WedgedMailer(ConnectionRefusedError("smtp down")),
              now=datetime.now(timezone.utc))
    db.refresh(entry)
    assert rc == 0
    assert entry.retry_count == 0
    assert entry.sent_at is None
    assert entry.error is None
    assert any("failed to acquire mailer session" in r.getMessage()
               for r in caplog.records)


def test_session_acquire_wedge_zero_rows_returns_0_no_log(db, caplog):
    caplog.set_level(logging.WARNING, logger="mathion.notifications")
    rc = tick(db, _WedgedMailer(ConnectionRefusedError("smtp down")),
              now=datetime.now(timezone.utc))
    assert rc == 0
    # No wedge log when there are no rows to wedge on
    assert not any("failed to acquire" in r.getMessage() for r in caplog.records)
