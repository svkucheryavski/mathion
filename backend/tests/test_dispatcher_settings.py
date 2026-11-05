"""D9c, D9d, D10, D10a, D10c (superuser Settings): the queue's loop reads the
panel's email settings once per tick (`_tick_once`), skips what was born while
email was off, and backs off after a failure on the mail server's side."""
import logging
import smtplib
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from mathion.database import SessionLocal
from mathion.models_auth import NotificationLogEntry, SiteSettings
from mathion.notifications import dispatcher
from mathion.notifications.dispatcher import _tick_once
from mathion.notifications.mailer import FileMailer, MemoryMailer
from mathion.secret_box import seal
from mathion.site_settings import load
from tests.conftest import set_site
from tests.test_notifications_dispatcher import seeded_run  # noqa: F401 (fixture)

SECRET = "s" * 48
T0 = datetime(2026, 11, 1, 8, 0, tzinfo=timezone.utc)
H = timedelta(hours=1)
ON = dict(email_on=True, smtp_host="mail.uni.dk", smtp_port=587, email_from="Mathion <noreply@uni.dk>")
SENDER_SENTENCE = "The mail server refused Mathion <noreply@uni.dk> as the sender."


def _state(mode="disabled", mailer=None):
    return SimpleNamespace(settings=SimpleNamespace(email_mode=mode, secret_key=SECRET), mailer=mailer)


def _row(db, seeded_run, created_at, **kw):
    e = NotificationLogEntry(user_id=seeded_run["student_user"].id, kind="run_enrolled",
                             payload={"run_id": seeded_run["run"].id}, created_at=created_at, **kw)
    db.add(e)
    db.commit()
    return e


def _sent(db, *rows):
    for r in rows:
        db.refresh(r)
    return [r.sent_at is not None for r in rows]


class _Mailer(MemoryMailer):
    """Counts sends; raises `fail` on the given call numbers (1-based)."""
    def __init__(self, fail=None, on_calls=()):
        super().__init__()
        self.fail, self.on_calls, self.calls = fail, set(on_calls), 0

    def send(self, msg):
        self.calls += 1
        if self.fail is not None and (not self.on_calls or self.calls in self.on_calls):
            raise self.fail
        self.sent.append(msg)


@pytest.fixture
def mailer(monkeypatch):
    holder = {"m": _Mailer()}
    monkeypatch.setattr(dispatcher, "build_mailer", lambda view, secret, mode: holder["m"])
    return holder


def test_off_sends_nothing_marks_nothing(db, seeded_run, mailer):
    set_site(db, smtp_host="mail.uni.dk")  # email off
    r = _row(db, seeded_run, T0)
    _tick_once(_state(), T0 + H)
    db.refresh(r)
    assert (r.sent_at, r.error, r.retry_count, r.next_attempt_at) == (None, None, 0, None)
    assert mailer["m"].calls == 0


def test_turn_on_skips_rows_born_off(db, seeded_run, mailer):
    # t1 (on) and t3 (after the turn-on) go; t2 (born in the off interval) never
    # does. Task 4's turn-on marks it "skipped: email was off".
    set_site(db, **ON, email_off_at=T0 + H, email_on_at=T0 + 3 * H)
    t1, t2, t3 = _row(db, seeded_run, T0), _row(db, seeded_run, T0 + 2 * H), _row(db, seeded_run, T0 + 4 * H)
    _tick_once(_state(), T0 + 5 * H)
    assert _sent(db, t1, t2, t3) == [True, False, True]
    assert (t2.error, t2.retry_count) == (None, 0)


def test_late_commit_in_off_interval_not_sent(db, seeded_run, mailer):
    # A row whose transaction began in the off interval and committed after the
    # turn-on: created_at is the transaction's start, so the select leaves it out.
    set_site(db, **ON, email_off_at=T0 + H, email_on_at=T0 + 3 * H)
    _tick_once(_state(), T0 + 3 * H + timedelta(minutes=1))
    late = _row(db, seeded_run, T0 + 2 * H)
    _tick_once(_state(), T0 + 4 * H)
    assert _sent(db, late) == [False]


def test_off_interval_skips_only_rows_born_off(db, seeded_run, mailer):
    # off/on twice: only the latest interval is stored; a row from the first
    # on-interval (e.g. stuck in a relay outage) still goes.
    set_site(db, **ON, email_off_at=T0 + 3 * H, email_on_at=T0 + 4 * H)
    first_on = _row(db, seeded_run, T0 + 2.5 * H)
    second_off = _row(db, seeded_run, T0 + 3.5 * H)
    _tick_once(_state(), T0 + 5 * H)
    assert _sent(db, first_on, second_off) == [True, False]


def test_after_a_later_turn_off_nothing_is_filtered(db, seeded_run, mailer):
    # on_at < off_at while email is off; the next tick with email on (a save
    # that hasn't stamped on_at yet) excludes nothing born after the old on_at.
    set_site(db, **ON, email_off_at=T0 + 3 * H, email_on_at=T0 + H)
    r = _row(db, seeded_run, T0 + 4 * H)
    _tick_once(_state(), T0 + 5 * H)
    assert _sent(db, r) == [True]


def test_copied_on_null_times_sends_whole_queue(db, seeded_run, mailer):
    set_site(db, **ON, email_off_at=None, email_on_at=None)
    now = T0 + 5 * H
    old = _row(db, seeded_run, T0 - timedelta(days=10))
    backoff = _row(db, seeded_run, T0, retry_count=1, next_attempt_at=now + timedelta(minutes=1))
    _tick_once(_state(), now)
    assert _sent(db, old, backoff) == [True, False]
    _tick_once(_state(), now + timedelta(minutes=2))
    assert _sent(db, backoff) == [True]


@pytest.mark.parametrize("mode", ["file", "memory"])
def test_file_mode_sends_all(db, seeded_run, tmp_path, mode):
    # D10c: the developer modes ignore the switch and the off interval.
    set_site(db, email_on=False, email_off_at=T0, email_on_at=None)
    dev = FileMailer(tmp_path) if mode == "file" else MemoryMailer()
    rows = [_row(db, seeded_run, T0 + H), _row(db, seeded_run, T0 + 2 * H)]
    _tick_once(_state(mode, dev), T0 + 3 * H)
    assert _sent(db, *rows) == [True, True]


def test_batch_level_failure_keeps_messages(db, seeded_run, mailer):
    mailer["m"] = _Mailer(fail=smtplib.SMTPSenderRefused(553, b"no", "noreply@uni.dk"))
    set_site(db, **ON, email_off_at=None)
    a, b = _row(db, seeded_run, T0), _row(db, seeded_run, T0)
    now = T0 + H
    _tick_once(_state(), now)
    for r in (a, b):
        db.refresh(r)
        assert (r.retry_count, r.error, r.next_attempt_at, r.sent_at) == (0, None, None, None)
    db.expire_all()
    view = load(db)
    assert view.send_failure_message == SENDER_SENTENCE
    assert view.send_failure_at == now
    assert view.send_retry_at == now + timedelta(minutes=5)

    calls = mailer["m"].calls
    _tick_once(_state(), now + timedelta(minutes=4))   # still waiting
    assert mailer["m"].calls == calls

    _tick_once(_state(), now + timedelta(minutes=5))   # the next failure waits 10 min
    db.expire_all()
    view = load(db)
    assert view.send_retry_at == now + timedelta(minutes=15)
    assert view.send_failure_at == now                 # failing since the first one

    set_site(db, send_backoff_step=7)
    _tick_once(_state(), now + timedelta(minutes=15))  # capped at an hour
    db.expire_all()
    assert load(db).send_retry_at == now + timedelta(minutes=75)


def test_session_failure_is_batch_level(db, seeded_run, mailer):
    class _Wedged(MemoryMailer):
        def session(self):
            raise ConnectionRefusedError("down")
    mailer["m"] = _Wedged()
    set_site(db, **ON, email_off_at=None)
    r = _row(db, seeded_run, T0)
    _tick_once(_state(), T0 + H)
    db.refresh(r)
    assert (r.retry_count, r.error) == (0, None)
    db.expire_all()
    assert load(db).send_failure_message == "Couldn't reach mail.uni.dk on port 587."


@pytest.mark.parametrize("save", [
    dict(smtp_host="mail2.uni.dk"),   # the operator fixed the server
    dict(),                           # a save with the same settings clears the failure too
])
def test_save_during_a_failing_attempt_wins(db, seeded_run, mailer, save):
    # A panel save lands while the attempt waits on the old server (up to the
    # timeout): the save's settings and cleared failure stay, not the old failure.
    class _SavedMeanwhile(MemoryMailer):
        @contextmanager
        def session(self):
            with SessionLocal() as other:
                row = other.get(SiteSettings, 1)
                for k, v in {**save, "send_failure_message": None, "send_failure_at": None,
                             "send_retry_at": None, "send_backoff_step": 0}.items():
                    setattr(row, k, v)
                other.commit()
            raise ConnectionRefusedError("down")
            yield
    mailer["m"] = _SavedMeanwhile()
    set_site(db, **ON, email_off_at=None, send_failure_message="Couldn't reach mail.uni.dk on port 587.",
             send_failure_at=T0, send_retry_at=T0 + timedelta(minutes=5), send_backoff_step=1)
    _row(db, seeded_run, T0)
    _tick_once(_state(), T0 + H)
    db.expire_all()
    view = load(db)
    assert (view.send_failure_message, view.send_retry_at, view.send_backoff_step) == (None, None, 0)
    assert view.smtp_host == save.get("smtp_host", "mail.uni.dk")


def test_refused_greeting_charges_no_message(db, seeded_run, mailer):
    class _Rude(MemoryMailer):
        @contextmanager
        def session(self):
            raise smtplib.SMTPHeloError(554, b"go away")
            yield
    mailer["m"] = _Rude()
    set_site(db, **ON, email_off_at=None)
    r = _row(db, seeded_run, T0)
    _tick_once(_state(), T0 + H)
    db.refresh(r)
    assert (r.retry_count, r.error, r.sent_at) == (0, None, None)
    db.expire_all()
    assert load(db).send_failure_message == "The mail server refused Mathion's greeting."


def test_success_clears_failure_and_backoff(db, seeded_run, mailer):
    now = T0 + H
    set_site(db, **ON, email_off_at=None, send_failure_message="x", send_failure_at=T0,
             send_retry_at=now - timedelta(seconds=1), send_backoff_step=3)
    r = _row(db, seeded_run, T0)
    _tick_once(_state(), now)
    assert _sent(db, r) == [True]
    db.expire_all()
    view = load(db)
    assert (view.send_failure_message, view.send_failure_at, view.send_retry_at, view.send_backoff_step) == (
        None, None, None, 0)


def test_disconnect_mid_batch_charges_one_row_and_stops(db, seeded_run, mailer):
    mailer["m"] = _Mailer(fail=smtplib.SMTPServerDisconnected("gone"), on_calls=[2])
    set_site(db, **ON, email_off_at=None)
    r1, r2, r3 = (_row(db, seeded_run, T0 + timedelta(seconds=i)) for i in range(3))
    now = T0 + H
    _tick_once(_state(), now)
    for r in (r1, r2, r3):
        db.refresh(r)
    assert r1.sent_at is not None
    assert (r2.retry_count, r2.next_attempt_at, r2.sent_at) == (1, now + timedelta(minutes=5), None)
    assert (r3.retry_count, r3.sent_at) == (0, None)   # not charged a retry
    db.expire_all()
    assert load(db).send_failure_message is None       # not a D9c failure


def test_unreadable_password_logged_once(db, seeded_run, caplog, monkeypatch):
    # The real factory: the password was sealed with another server's key.
    from mathion.notifications import mailer as mailer_mod
    connects = []
    monkeypatch.setattr(mailer_mod.smtplib, "SMTP", lambda *a, **k: connects.append(a))
    set_site(db, **ON, smtp_encryption="starttls", email_off_at=None,
             smtp_username="u@uni.dk", smtp_password_sealed=seal("pw", "another-secret"))
    _row(db, seeded_run, T0)
    caplog.set_level(logging.WARNING, logger="mathion.notifications")
    now = T0 + H
    _tick_once(_state(), now)
    _tick_once(_state(), now + timedelta(minutes=5))
    lines = [r for r in caplog.records if "can't be read" in r.getMessage()]
    assert len(lines) == 1
    db.expire_all()
    assert load(db).send_failure_message == "The saved password can't be read on this server: type it again."
    assert connects == []   # the password is opened before any connect


def test_failure_text_in_db_has_no_server_reply(db, seeded_run, mailer, caplog):
    caplog.set_level(logging.DEBUG, logger="mathion.notifications")
    set_site(db, **ON, email_off_at=None)
    mailer["m"] = _Mailer(fail=smtplib.SMTPRecipientsRefused({"alice@example.com": (550, b"S3ntinel no user")}))
    r = _row(db, seeded_run, T0)
    _tick_once(_state(), T0 + H)
    db.refresh(r)
    assert r.error == "SMTPRecipientsRefused 550: The mail server refused to send to alice@example.com."
    mailer["m"] = _Mailer(fail=smtplib.SMTPSenderRefused(553, b"S3ntinel spoof", "x@uni.dk"))
    _row(db, seeded_run, T0)
    _tick_once(_state(), T0 + 2 * H)
    db.expire_all()
    assert load(db).send_failure_message == SENDER_SENTENCE
    assert "S3ntinel" not in caplog.text



# --- D9c, extended (user 2026-11-05): a refusal after the body --------------------------
# Microsoft 365 refuses a From the login may not send as only after DATA. Each
# refused message is retried on its own (5 min, 30 min, 2 h, 6 h, then failed
# for good) and never holds up the others; while refusals come and nothing gets
# through, the Email card says so (no queue back-off).

REFUSED_SENTENCE = ("The mail server refused a message: check that the login may send as "
                    "Mathion <noreply@uni.dk>.")


def _fresh_view(db):
    db.expire_all()
    return load(db)


def test_refusal_after_body_is_retried_and_shown(db, seeded_run, mailer):
    mailer["m"] = _Mailer(fail=smtplib.SMTPDataError(554, b"5.2.252 SendAsDenied; pw=hunter2"))
    set_site(db, **ON, email_off_at=None)
    rows = [_row(db, seeded_run, T0 + timedelta(seconds=i)) for i in range(3)]
    now = T0 + H
    _tick_once(_state(), now)
    assert mailer["m"].calls == 3                       # nothing stops the batch
    for r in rows:
        db.refresh(r)
        assert (r.retry_count, r.error, r.next_attempt_at, r.sent_at) == (1, None, now + timedelta(minutes=5), None)
    view = _fresh_view(db)
    assert view.send_failure_message == REFUSED_SENTENCE
    assert view.send_failure_at == now
    assert (view.send_retry_at, view.send_backoff_step) == (None, 0)   # the queue isn't held back


def test_refusal_after_body_fails_after_five_tries(db, seeded_run, mailer):
    mailer["m"] = _Mailer(fail=smtplib.SMTPDataError(554, b"rejected"))
    set_site(db, **ON, email_off_at=None)
    r = _row(db, seeded_run, T0, retry_count=4)
    _tick_once(_state(), T0 + H)
    db.refresh(r)
    assert r.error == "max attempts: SMTPDataError 554: The mail server refused the message."
    assert (r.retry_count, r.next_attempt_at, r.sent_at) == (5, None, None)


def test_refusal_beside_a_sent_message_leaves_the_card(db, seeded_run, mailer):
    mailer["m"] = _Mailer(fail=smtplib.SMTPDataError(554, b"rejected"), on_calls=[1])
    set_site(db, **ON, email_off_at=None)
    r1, r2 = (_row(db, seeded_run, T0 + timedelta(seconds=i)) for i in range(2))
    _tick_once(_state(), T0 + H)
    db.refresh(r1)
    assert (r1.retry_count, r1.error) == (1, None)
    assert _sent(db, r2) == [True]
    assert _fresh_view(db).send_failure_message is None
