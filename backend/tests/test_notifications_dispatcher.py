import pytest
import smtplib
import logging
from datetime import datetime, timezone

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
    # The recipient can vanish between tick() loading its batch and render()
    # (a concurrent user deletion). Construct a TRANSIENT entry — never
    # persisted — pointing at a missing user_id but a VALID run_id, so the run
    # lookup passes and we reach the user-None branch (dispatcher.py:68-70).
    # We never write an invalid FK; Postgres enforces FKs unconditionally.
    entry = NotificationLogEntry(
        user_id=999999, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id},
    )
    with pytest.raises(LookupError, match="referent missing: user:999999"):
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
    # Postgres TIMESTAMPTZ round-trips tz-aware; compare aware-to-aware.
    expected = now + timedelta(seconds=300)
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
    # Superuser Settings D9b: the stored error is the class, code and sentence,
    # never the server's own reply.
    assert entry.error == "SMTPResponseException 550: The mail server refused the message."
    assert "no mailbox" not in entry.error


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


def test_smtp_auth_error_stops_the_batch_and_never_logs_the_reply(db, seeded_run, caplog):
    # Superuser Settings D9b, D9c: a refused login is the server's side: no
    # message is charged, and nothing the server said reaches a log or the row.
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id})
    db.add(entry); db.commit()
    sensitive = smtplib.SMTPAuthenticationError(
        535, b"535 5.7.8 Authentication credentials invalid for user@example.com")
    caplog.set_level(logging.DEBUG, logger="mathion.notifications")
    tick(db, _RaisingMailer(sensitive), now=datetime.now(timezone.utc))
    db.refresh(entry)
    assert (entry.retry_count, entry.error, entry.sent_at, entry.next_attempt_at) == (0, None, None, None)
    assert "user@example.com" not in caplog.text
    assert not any(r.exc_info and r.exc_info[1] is sensitive for r in caplog.records)
    assert any("The mail server refused the login." in r.getMessage() for r in caplog.records)


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


# ---------------------------------------------------------------------------
# D5: course_admin_assigned — course-scoped, read and checked at send time.
# ---------------------------------------------------------------------------

@pytest.fixture
def admin_row(db):
    """A course with its admin and one queued course_admin_assigned row."""
    from mathion.models import Course, CourseAdmin
    course = Course(slug="stat", name="Statistics 101", description="")
    admin = User(email="anna@x", full_name="Anna Holm")
    db.add_all([course, admin]); db.flush()
    db.add(CourseAdmin(course_id=course.id, user_id=admin.id))
    row = NotificationLogEntry(user_id=admin.id, kind="course_admin_assigned",
                               payload={"course_id": course.id})
    db.add(row); db.commit()
    return {"course": course, "admin": admin, "row": row}


def test_course_admin_assigned_is_sent(db, admin_row):
    mailer = MemoryMailer()
    assert tick(db, mailer, now=datetime.now(timezone.utc)) == 1
    db.refresh(admin_row["row"])
    assert admin_row["row"].sent_at is not None
    assert [m["To"] for m in mailer.sent] == ["anna@x"]
    assert mailer.sent[0]["Subject"] == "You are now the admin of Statistics 101"


def _assert_skipped(db, row, reason):
    mailer = MemoryMailer()
    tick(db, mailer, now=datetime.now(timezone.utc))
    db.refresh(row)
    assert mailer.sent == []
    assert row.error == f"skipped: {reason}"
    assert row.sent_at is None and row.retry_count == 0
    assert tick(db, mailer, now=datetime.now(timezone.utc)) == 0  # never picked again


def test_skip_when_no_longer_admin(db, admin_row):
    from mathion.models import CourseAdmin
    other = User(email="ole@x"); db.add(other); db.flush()
    ca = db.query(CourseAdmin).filter_by(course_id=admin_row["course"].id).one()
    ca.user_id = other.id
    db.commit()
    _assert_skipped(db, admin_row["row"], "no longer admin")


def test_skip_when_recipient_disabled(db, admin_row):
    admin_row["admin"].is_disabled = True
    db.commit()
    _assert_skipped(db, admin_row["row"], "recipient disabled")


def test_skip_when_course_gone(db, admin_row):
    db.delete(admin_row["course"]); db.commit()
    _assert_skipped(db, admin_row["row"], "course gone")


def test_skip_does_not_touch_retry_or_log_warning(db, admin_row, caplog):
    admin_row["admin"].is_disabled = True
    db.commit()
    with caplog.at_level(logging.WARNING, logger="mathion.notifications"):
        tick(db, MemoryMailer(), now=datetime.now(timezone.utc))
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING]


def _reassign(session, course_id, user_id):
    from mathion.models import CourseAdmin
    session.query(CourseAdmin).filter_by(course_id=course_id).one().user_id = user_id
    session.commit()


def test_skip_is_checked_again_under_the_course_lock(db, admin_row, monkeypatch):
    """Rev 11: A -> B, the dispatcher sees B, then the panel puts A back before
    the skip is written: the second look, under the course lock the panel's
    assign holds, sees A again and the email goes."""
    from mathion.database import SessionLocal
    from mathion.notifications import dispatcher
    other = User(email="ole@x"); db.add(other); db.commit()
    course_id, anna_id = admin_row["course"].id, admin_row["admin"].id
    _reassign(db, course_id, other.id)
    real = dispatcher._lock_course

    def put_anna_back_then_lock(session, cid):
        with SessionLocal() as panel:
            _reassign(panel, course_id, anna_id)
        real(session, cid)

    monkeypatch.setattr(dispatcher, "_lock_course", put_anna_back_then_lock)
    mailer = MemoryMailer()
    tick(db, mailer, now=datetime.now(timezone.utc))
    db.refresh(admin_row["row"])
    assert admin_row["row"].error is None
    assert [m["To"] for m in mailer.sent] == ["anna@x"]


def test_a_second_look_that_clears_lets_go_of_the_lock_before_sending(db, admin_row, monkeypatch):
    """Rev 11: a row the second look clears is sent without the course lock,
    so a slow mail server can't hold up the panel's edits of that course."""
    from sqlalchemy import select, text
    from sqlalchemy.exc import OperationalError
    from mathion.database import SessionLocal
    from mathion.models import Course
    from mathion.notifications import dispatcher
    other = User(email="ole@x"); db.add(other); db.commit()
    course_id, anna_id = admin_row["course"].id, admin_row["admin"].id
    _reassign(db, course_id, other.id)
    real = dispatcher._lock_course

    def put_anna_back_then_lock(session, cid):
        with SessionLocal() as panel:
            _reassign(panel, course_id, anna_id)
        real(session, cid)

    monkeypatch.setattr(dispatcher, "_lock_course", put_anna_back_then_lock)
    blocked = []

    class PanelEditsDuringSend(MemoryMailer):
        def send(self, msg):
            with SessionLocal() as panel:
                panel.execute(text("SET LOCAL lock_timeout = '300ms'"))
                try:
                    panel.execute(select(Course).where(Course.id == course_id).with_for_update())
                    blocked.append(False)
                except OperationalError:
                    blocked.append(True)
                panel.rollback()
            super().send(msg)

    mailer = PanelEditsDuringSend()
    tick(db, mailer, now=datetime.now(timezone.utc))
    assert blocked == [False]
    assert [m["To"] for m in mailer.sent] == ["anna@x"]


def test_a_skip_keeps_the_course_lock_until_it_is_written(db, admin_row, monkeypatch):
    """Rev 11: a reason found by the second look is written under the same
    lock, so a re-assign can't slip in between the look and the skip."""
    from sqlalchemy import select, text
    from sqlalchemy.exc import OperationalError
    from mathion.database import SessionLocal
    from mathion.models import Course
    from mathion.notifications import dispatcher
    other = User(email="ole@x"); db.add(other); db.commit()
    course_id = admin_row["course"].id
    _reassign(db, course_id, other.id)
    real = dispatcher.skip_reason
    blocked = []

    def then_try_the_lock(session, row):
        reason = real(session, row)
        with SessionLocal() as panel:
            panel.execute(text("SET LOCAL lock_timeout = '300ms'"))
            try:
                panel.execute(select(Course).where(Course.id == course_id).with_for_update())
                blocked.append(False)
            except OperationalError:
                blocked.append(True)
            panel.rollback()
        return reason

    monkeypatch.setattr(dispatcher, "skip_reason", then_try_the_lock)
    tick(db, MemoryMailer(), now=datetime.now(timezone.utc))
    db.refresh(admin_row["row"])
    assert blocked == [True]
    assert admin_row["row"].error == "skipped: no longer admin"


def _said_gone(caplog, row_id, quietly=True):
    """A gone row is named in one info line; `quietly`: nothing louder."""
    assert any(r.getMessage() == f"notification id={row_id} is gone; passed over" for r in caplog.records)
    if quietly:
        assert not [r for r in caplog.records if r.levelno >= logging.WARNING]


def test_a_row_deleted_mid_send_is_passed_over(db, admin_row, monkeypatch, caplog):
    """A row deleted after its checks (its account deleted) is passed over:
    the loop keeps the row's id, so the tick doesn't fail on the gone row."""
    from mathion.database import SessionLocal
    from mathion.notifications import dispatcher
    row_id = admin_row["row"].id

    def delete_it_then_clear(session, row):
        with SessionLocal() as panel:
            panel.delete(panel.get(NotificationLogEntry, row_id))
            panel.commit()
        session.commit()  # as a clearing second look ends its transaction
        return None

    monkeypatch.setattr(dispatcher, "skip_reason", delete_it_then_clear)
    mailer = MemoryMailer()
    with caplog.at_level(logging.INFO, logger="mathion.notifications"):
        tick(db, mailer, now=datetime.now(timezone.utc))
    assert mailer.sent == []
    assert db.get(NotificationLogEntry, row_id) is None
    _said_gone(caplog, row_id)


def test_a_row_deleted_while_it_is_sent_is_passed_over(db, admin_row, caplog):
    """Deleted after the send, before its commit: the email went, the row is
    gone, and that is an info line, not a failed commit to retry."""
    from mathion.database import SessionLocal
    row_id = admin_row["row"].id
    db.add(NotificationLogEntry(user_id=admin_row["admin"].id, kind="course_admin_assigned",
                                payload={"course_id": admin_row["course"].id}))
    db.commit()

    class DeleteWhileSending(MemoryMailer):
        def send(self, msg):
            super().send(msg)
            if len(self.sent) == 1:
                with SessionLocal() as panel:
                    panel.delete(panel.get(NotificationLogEntry, row_id))
                    panel.commit()

    from mathion.notifications.dispatcher import _run
    mailer = DeleteWhileSending()
    with caplog.at_level(logging.INFO, logger="mathion.notifications"):
        result = _run(db, mailer, now=datetime.now(timezone.utc))
    # It went, so the server works (Set up D6); the row after it goes too.
    assert (result.processed, result.sent) == (2, 2)
    assert [m["To"] for m in mailer.sent] == ["anna@x", "anna@x"]
    _said_gone(caplog, row_id)


def test_a_row_deleted_before_its_skip_is_written_is_passed_over(db, admin_row, monkeypatch, caplog):
    """Deleted between the skip decision and its commit: an info line."""
    from mathion.database import SessionLocal
    from mathion.notifications import dispatcher
    other = User(email="ole@x"); db.add(other); db.commit()
    _reassign(db, admin_row["course"].id, other.id)
    db.add(NotificationLogEntry(user_id=other.id, kind="course_admin_assigned",
                                payload={"course_id": admin_row["course"].id}))
    db.commit()
    row_id = admin_row["row"].id
    real = dispatcher.skip_reason

    def decide_then_delete(session, row):
        reason = real(session, row)
        if row.id == row_id:
            with SessionLocal() as panel:
                panel.delete(panel.get(NotificationLogEntry, row_id))
                panel.commit()
        return reason

    monkeypatch.setattr(dispatcher, "skip_reason", decide_then_delete)
    mailer = MemoryMailer()
    with caplog.at_level(logging.INFO, logger="mathion.notifications"):
        assert tick(db, mailer, now=datetime.now(timezone.utc)) == 2
    assert [m["To"] for m in mailer.sent] == ["ole@x"]  # the row after it, in this same tick
    _said_gone(caplog, row_id)


def test_a_row_deleted_before_its_check_is_passed_over_quietly(db, admin_row, monkeypatch, caplog):
    """Row 1 is sent (its commit expires row 2), then row 2 is deleted before
    its skip check: the tick goes on, and a gone row is no error in the log."""
    from mathion.database import SessionLocal
    from mathion.notifications import dispatcher
    second, third = (NotificationLogEntry(user_id=admin_row["admin"].id, kind="course_admin_assigned",
                                          payload={"course_id": admin_row["course"].id}) for _ in range(2))
    db.add(second); db.commit()
    db.add(third); db.commit()
    second_id = second.id
    real = dispatcher.skip_reason
    seen = []

    def delete_the_second_first(session, row):
        seen.append(1)
        if len(seen) == 2:
            with SessionLocal() as panel:
                panel.delete(panel.get(NotificationLogEntry, second_id))
                panel.commit()
        return real(session, row)

    monkeypatch.setattr(dispatcher, "skip_reason", delete_the_second_first)
    mailer = MemoryMailer()
    with caplog.at_level(logging.INFO, logger="mathion.notifications"):
        assert tick(db, mailer, now=datetime.now(timezone.utc)) == 3
    assert [m["To"] for m in mailer.sent] == ["anna@x", "anna@x"]  # the first and the third
    _said_gone(caplog, second_id)


def test_a_row_deleted_while_it_is_charged_does_not_stop_the_tick(db, admin_row, monkeypatch, caplog):
    """A send fails and the row is deleted before its charge is written: the
    commit that finds it gone is passed over, named by the id the loop kept."""
    from mathion.database import SessionLocal
    from mathion.notifications import dispatcher
    row_id = admin_row["row"].id
    after = NotificationLogEntry(user_id=admin_row["admin"].id, kind="course_admin_assigned",
                                 payload={"course_id": admin_row["course"].id})
    db.add(after); db.commit()
    real = dispatcher.classify
    deleted = []

    def delete_then_classify(exc):
        if not deleted:
            with SessionLocal() as panel:
                panel.delete(panel.get(NotificationLogEntry, row_id))
                panel.commit()
            deleted.append(row_id)
        return real(exc)

    monkeypatch.setattr(dispatcher, "classify", delete_then_classify)

    class Boom(MemoryMailer):
        def send(self, msg):
            raise RuntimeError("boom")

    with caplog.at_level(logging.INFO, logger="mathion.notifications"):
        assert tick(db, Boom(), now=datetime.now(timezone.utc)) == 2
    # Its failure is still flagged first, with the detail for the operator.
    assert any(r.getMessage().startswith(f"notification id={row_id} flagged permanently") for r in caplog.records)
    _said_gone(caplog, row_id, quietly=False)
    assert not [r for r in caplog.records if "commit failed" in r.getMessage()]
    db.refresh(after)
    assert after.error == "boom"  # the row after it was charged in the same tick


def test_the_second_look_reads_the_account_again(db, admin_row, monkeypatch):
    """Rev 11: the first look cached the account as disabled; one enabled while
    the lock waited is read again, not taken from that cache."""
    from mathion.database import SessionLocal
    from mathion.notifications import dispatcher
    anna_id = admin_row["admin"].id
    admin_row["admin"].is_disabled = True
    db.commit()
    real = dispatcher._lock_course

    def enable_anna_then_lock(session, cid):
        with SessionLocal() as panel:
            panel.get(User, anna_id).is_disabled = False
            panel.commit()
        real(session, cid)

    monkeypatch.setattr(dispatcher, "_lock_course", enable_anna_then_lock)
    mailer = MemoryMailer()
    tick(db, mailer, now=datetime.now(timezone.utc))
    assert [m["To"] for m in mailer.sent] == ["anna@x"]


def test_a_skip_waits_for_the_course_lock(db, admin_row):
    """Rev 11: the skip is decided under the course's row lock, so it can't
    cross a panel assign that holds it."""
    from sqlalchemy import select, text
    from sqlalchemy.exc import OperationalError
    from mathion.database import SessionLocal
    from mathion.models import Course
    from mathion.notifications.dispatcher import skip_reason
    other = User(email="ole@x"); db.add(other); db.commit()
    _reassign(db, admin_row["course"].id, other.id)
    with SessionLocal() as panel:
        panel.execute(select(Course).where(Course.id == admin_row["course"].id).with_for_update())
        try:
            db.execute(text("SET LOCAL lock_timeout = '300ms'"))
            with pytest.raises(OperationalError):
                skip_reason(db, admin_row["row"])
        finally:
            db.rollback()
            panel.rollback()


def test_a_row_still_to_send_takes_no_course_lock(db, admin_row):
    """Rev 11: only a skip takes the lock, so a slow send never holds up the panel."""
    from sqlalchemy import select, text
    from mathion.database import SessionLocal
    from mathion.models import Course
    from mathion.notifications.dispatcher import skip_reason
    with SessionLocal() as panel:
        panel.execute(select(Course).where(Course.id == admin_row["course"].id).with_for_update())
        try:
            db.execute(text("SET LOCAL lock_timeout = '300ms'"))
            assert skip_reason(db, admin_row["row"]) is None
        finally:
            db.rollback()
            panel.rollback()


def test_course_slug_read_at_send_time(db, admin_row):
    admin_row["course"].slug = "stat-2027"
    db.commit()
    mailer = MemoryMailer()
    tick(db, mailer, now=datetime.now(timezone.utc))
    body = mailer.sent[0].get_content()
    assert "/courses/stat-2027/edit" in body


# --- superuser Branding D3: the dispatcher reads the site name once per tick ---

def test_tick_reads_branding_once(db, seeded_run, monkeypatch):
    from types import SimpleNamespace
    from mathion.branding import Branding
    from mathion.notifications import dispatcher
    for _ in range(3):
        db.add(NotificationLogEntry(user_id=seeded_run["student_user"].id, kind="run_enrolled",
                                    payload={"run_id": seeded_run["run"].id}))
    db.commit()
    calls = []

    def load():
        calls.append(1)
        return Branding(name="Riverside")

    monkeypatch.setattr(dispatcher, "load_branding", load)
    mailer = MemoryMailer()
    state = SimpleNamespace(settings=SimpleNamespace(email_mode="memory", secret_key="s" * 48), mailer=mailer)
    assert dispatcher._tick_once(state, datetime.now(timezone.utc)) == 3
    assert len(calls) == 1
    assert [m.get_content().endswith("\n\n\u2014 Riverside\n") for m in mailer.sent] == [True] * 3


def test_tick_signs_with_mathion_by_default(db, seeded_run):
    db.add(NotificationLogEntry(user_id=seeded_run["student_user"].id, kind="run_enrolled",
                                payload={"run_id": seeded_run["run"].id}))
    db.commit()
    mailer = MemoryMailer()
    tick(db, mailer, now=datetime.now(timezone.utc))
    assert mailer.sent[0].get_content().endswith("\n\n\u2014 Mathion\n")
