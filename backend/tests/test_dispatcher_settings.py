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


@pytest.mark.parametrize("exc", [smtplib.SMTPRecipientsRefused({"x@uni.dk": (421, b"bye")}),
                                 smtplib.SMTPDataError(421, b"bye")])
def test_a_421_charges_its_message_stops_and_backs_off(db, seeded_run, mailer, exc):
    # The user's call (2026-11-15): charged, so a message the server always
    # closes on fails out instead of holding the queue.
    mailer["m"] = _Mailer(fail=exc, on_calls=[2])
    set_site(db, **ON, email_off_at=None)
    r1, r2, r3 = (_row(db, seeded_run, T0 + timedelta(seconds=i)) for i in range(3))
    now = T0 + H
    _tick_once(_state(), now)
    for r in (r1, r2, r3):
        db.refresh(r)
    assert r1.sent_at is not None
    assert (r2.retry_count, r2.next_attempt_at, r2.sent_at) == (1, now + timedelta(minutes=5), None)
    assert (r3.retry_count, r3.sent_at) == (0, None)
    assert mailer["m"].calls == 2                       # the batch ended at the 421
    view = _fresh_view(db)
    assert view.send_failure_message == "The mail server asked Mathion to try again later."
    assert (view.send_retry_at, view.send_backoff_step) == (now + timedelta(minutes=5), 1)


def test_a_421_on_the_last_try_fails_the_message_out(db, seeded_run, mailer):
    mailer["m"] = _Mailer(fail=smtplib.SMTPRecipientsRefused({"x@uni.dk": (421, b"bye")}))
    set_site(db, **ON, email_off_at=None)
    r = _row(db, seeded_run, T0, retry_count=4)
    _tick_once(_state(), T0 + H)
    db.refresh(r)
    assert (r.retry_count, r.next_attempt_at, r.sent_at) == (5, None, None)
    assert r.error.startswith("max attempts:")
    assert _fresh_view(db).send_failure_message == "The mail server asked Mathion to try again later."


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

REFUSED_SENTENCE = ("The mail server refused a message: check that it accepts mail from "
                    "Mathion <noreply@uni.dk> without a login.")
REFUSED_LOGIN_SENTENCE = ("The mail server refused a message: check that the login may send as "
                          "Mathion <noreply@uni.dk> and that it accepts Mathion's messages.")
EVERYONE_SENTENCE = ("The mail server refused every recipient: check that it lets Mathion send to "
                     "other addresses.")


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


# --- Set up D6: the time of the last successful send ---

def test_sent_tick_records_last_sent_on_healthy_server(db, seeded_run, mailer):
    # No failure stored: a healthy server still records the send.
    set_site(db, **ON, email_off_at=None)
    r = _row(db, seeded_run, T0)
    now = T0 + H
    _tick_once(_state(), now)
    assert _sent(db, r) == [True]
    assert _fresh_view(db).last_sent_at == now


def test_sent_tick_on_a_recorded_healthy_server_writes_nothing(db, seeded_run, mailer, monkeypatch):
    # D6: a send already recorded and nothing to clear leaves the
    # row alone, so a class signing in at once doesn't queue writes on it.
    set_site(db, **ON, email_off_at=None, last_sent_at=T0)
    r = _row(db, seeded_run, T0)

    def no_lock(*a):
        raise AssertionError("the settings row was locked")
    monkeypatch.setattr(dispatcher, "_fresh_row", no_lock)
    _tick_once(_state(), T0 + H)
    assert _sent(db, r) == [True]
    assert _fresh_view(db).last_sent_at == T0


def test_sent_tick_after_recovery_clears_the_failure(db, seeded_run, mailer):
    # D6: a send already recorded, then a failure with its back-off:
    # the next send must still clear it, or the card stays red for ever.
    set_site(db, **ON, email_off_at=None, last_sent_at=T0, send_failure_message="x", send_failure_at=T0,
             send_retry_at=T0, send_backoff_step=2)
    r = _row(db, seeded_run, T0)
    now = T0 + H
    _tick_once(_state(), now)
    assert _sent(db, r) == [True]
    v = _fresh_view(db)
    assert (v.send_failure_message, v.send_retry_at, v.send_backoff_step, v.last_sent_at) == (None, None, 0, now)


def test_sent_tick_after_a_newer_failed_test_records(db, seeded_run, mailer):
    # A failed card test newer than the last send: this send makes Email done again.
    set_site(db, **ON, email_off_at=None, last_sent_at=T0, card_test_ok=False,
             card_test_at=T0 + timedelta(minutes=1), card_test_message="x")
    r = _row(db, seeded_run, T0)
    now = T0 + H
    _tick_once(_state(), now)
    assert _sent(db, r) == [True]
    assert _fresh_view(db).last_sent_at == now


def _fail_card_test(at):
    with SessionLocal() as other:
        row = other.get(SiteSettings, 1)
        row.card_test_ok, row.card_test_at, row.card_test_message = False, at, "x"
        other.commit()


def test_pin_send_after_a_test_that_failed_while_it_went_out_records(db):
    # D6: the PIN email records the time after its send. A card test that
    # failed after the caller read the row is read again, so the send counts.
    set_site(db, **ON, email_off_at=None, last_sent_at=T0)
    view = load(db)
    _fail_card_test(T0 + timedelta(minutes=30))
    dispatcher.record_send_outcome(db, view, None, T0 + H)
    assert _fresh_view(db).last_sent_at == T0 + H


def test_a_test_that_fails_during_a_batch_stays_newer_than_the_batch(db, seeded_run, mailer):
    # D6: the queue records its send at the batch's start, so a card test that
    # fails during the batch is newer, and Email says the test failed.
    from mathion.setup_state import EMAIL_TEST_FAILED, email_done
    now = T0 + H

    class _TestFailsWhileSending(_Mailer):
        def send(self, msg):
            super().send(msg)
            _fail_card_test(now + timedelta(seconds=5))
    mailer["m"] = _TestFailsWhileSending()
    set_site(db, **ON, email_off_at=None, last_sent_at=T0)
    r = _row(db, seeded_run, T0)
    _tick_once(_state(), now)
    assert _sent(db, r) == [True]
    assert email_done(_fresh_view(db), "k", "smtp").reason == EMAIL_TEST_FAILED


def test_sent_tick_skips_record_when_settings_changed(db, seeded_run, mailer):
    class _SavedWhileSending(_Mailer):
        def send(self, msg):
            super().send(msg)
            with SessionLocal() as other:
                other.get(SiteSettings, 1).smtp_host = "mail2.uni.dk"
                other.commit()
    mailer["m"] = _SavedWhileSending()
    set_site(db, **ON, email_off_at=None)
    r = _row(db, seeded_run, T0)
    _tick_once(_state(), T0 + H)
    assert _sent(db, r) == [True]
    view = _fresh_view(db)
    assert (view.smtp_host, view.last_sent_at) == ("mail2.uni.dk", None)


def test_refusal_tick_records_failure_not_send(db, seeded_run, mailer):
    # One message goes out, then the server refuses the sender (D9c).
    mailer["m"] = _Mailer(fail=smtplib.SMTPSenderRefused(553, b"no", "noreply@uni.dk"), on_calls=[2])
    set_site(db, **ON, email_off_at=None)
    r1, r2 = (_row(db, seeded_run, T0 + timedelta(seconds=i)) for i in range(2))
    now = T0 + H
    _tick_once(_state(), now)
    assert _sent(db, r1, r2) == [True, False]
    view = _fresh_view(db)
    assert (view.send_failure_message, view.last_sent_at) == (SENDER_SENTENCE, None)


# --- D9c, D9d, rev 8: the card and the queue's state ---

def test_card_refusal_without_login():
    from mathion.notifications.dispatcher import refusal_on_card
    from mathion.notifications.smtp_errors import describe
    exc = smtplib.SMTPDataError(554, b"x")
    failure = describe(exc, host="mail.uni.dk", port=587, sender="Mathion <noreply@uni.dk>", recipient="a@b")
    card = refusal_on_card(exc, failure, "Mathion <noreply@uni.dk>", has_login=False)
    assert (card.sentence, card.batch_level) == (REFUSED_SENTENCE, False)


def test_card_refusal_with_login_is_hedged():
    from mathion.notifications.dispatcher import refusal_on_card
    from mathion.notifications.smtp_errors import describe
    exc = smtplib.SMTPDataError(554, b"x")
    failure = describe(exc, host="mail.uni.dk", port=587, sender="Mathion <noreply@uni.dk>", recipient="a@b")
    card = refusal_on_card(exc, failure, "Mathion <noreply@uni.dk>", has_login=True)
    assert card.sentence == REFUSED_LOGIN_SENTENCE


def test_queue_card_refusal_names_the_login_when_one_is_saved(db, seeded_run, mailer):
    mailer["m"] = _Mailer(fail=smtplib.SMTPDataError(554, b"rejected"))
    set_site(db, **ON, smtp_username="u@uni.dk", email_off_at=None)
    _row(db, seeded_run, T0)
    _tick_once(_state(), T0 + H)
    assert _fresh_view(db).send_failure_message == REFUSED_LOGIN_SENTENCE


def test_session_with_nothing_sent_clears_the_red_line(db, seeded_run, mailer):
    # It connected and logged in, so the server's side works, though the one
    # message was refused on its own (one recipient's problem).
    mailer["m"] = _Mailer(fail=smtplib.SMTPRecipientsRefused({"x@uni.dk": (550, b"no such user")}))
    set_site(db, **ON, smtp_username="u@uni.dk", email_off_at=None,
             send_failure_message="The mail server refused the login.",
             send_failure_at=T0, send_retry_at=T0, send_backoff_step=2)
    _row(db, seeded_run, T0)
    _tick_once(_state(), T0 + H)
    view = _fresh_view(db)
    assert (view.send_failure_message, view.send_failure_at, view.send_retry_at, view.send_backoff_step) == (
        None, None, None, 0)
    assert view.last_sent_at is None


def test_refusal_after_body_clears_the_backoff(db, seeded_run, mailer):
    # The wait has run out by the tick (the queue doesn't run during one), so
    # this pins the reset step: the next D9c failure waits 5 minutes again.
    mailer["m"] = _Mailer(fail=smtplib.SMTPDataError(554, b"rejected"))
    set_site(db, **ON, email_off_at=None, send_failure_message="The mail server refused the login.",
             send_failure_at=T0, send_retry_at=T0 + timedelta(minutes=30), send_backoff_step=3)
    _row(db, seeded_run, T0)
    _tick_once(_state(), T0 + H)
    view = _fresh_view(db)
    assert view.send_failure_message == REFUSED_SENTENCE
    assert (view.send_retry_at, view.send_backoff_step) == (None, 0)


def _other_student(db):
    from mathion.models_auth import User
    user = User(email="ben@example.com", full_name="Ben")
    db.add(user)
    db.commit()
    return user


def _row_for(db, seeded_run, user, created_at):
    e = NotificationLogEntry(user_id=user.id, kind="run_enrolled", payload={"run_id": seeded_run["run"].id},
                             created_at=created_at)
    db.add(e)
    db.commit()
    return e


def test_relay_refusing_everyone_shows_on_card(db, seeded_run, mailer):
    mailer["m"] = _Mailer(fail=smtplib.SMTPRecipientsRefused({"x@uni.dk": (554, b"5.7.1 Relay access denied")}))
    set_site(db, **ON, email_off_at=None, send_failure_message="The mail server refused the login.",
             send_failure_at=T0, send_retry_at=T0, send_backoff_step=3)   # D9d: it ends a wait
    rows = [_row(db, seeded_run, T0), _row_for(db, seeded_run, _other_student(db), T0 + timedelta(seconds=1))]
    now = T0 + H
    _tick_once(_state(), now)
    view = _fresh_view(db)
    assert (view.send_failure_message, view.send_failure_at) == (EVERYONE_SENTENCE, now)
    assert (view.send_retry_at, view.send_backoff_step) == (None, 0)
    for r in rows:
        db.refresh(r)
        assert r.retry_count == 1
        assert r.error is not None   # each still fails for good


def test_two_refusals_for_one_address_are_not_everyone(db, seeded_run, mailer):
    # Two messages to one dead mailbox are that address's problem.
    mailer["m"] = _Mailer(fail=smtplib.SMTPRecipientsRefused({"x@uni.dk": (550, b"no such user")}))
    set_site(db, **ON, email_off_at=None)
    for i in range(2):
        _row(db, seeded_run, T0 + timedelta(seconds=i))
    _tick_once(_state(), T0 + H)
    assert _fresh_view(db).send_failure_message is None


def test_the_card_names_no_login_when_none_happens(db, seeded_run, mailer):
    # A username copied with no encryption logs in to nothing (D7a).
    mailer["m"] = _Mailer(fail=smtplib.SMTPDataError(554, b"rejected"))
    set_site(db, **ON, smtp_username="u@uni.dk", smtp_encryption="none", email_off_at=None)
    _row(db, seeded_run, T0)
    _tick_once(_state(), T0 + H)
    assert _fresh_view(db).send_failure_message == REFUSED_SENTENCE


@pytest.mark.parametrize("rows, on_calls", [(1, ()), (2, [1])])
def test_one_refused_recipient_leaves_the_card(db, seeded_run, mailer, rows, on_calls):
    # One refused address is that address's problem; so is one beside a sent message.
    mailer["m"] = _Mailer(fail=smtplib.SMTPRecipientsRefused({"x@uni.dk": (550, b"no such user")}),
                          on_calls=on_calls)
    set_site(db, **ON, email_off_at=None)
    for i in range(rows):
        _row(db, seeded_run, T0 + timedelta(seconds=i))
    _tick_once(_state(), T0 + H)
    assert _fresh_view(db).send_failure_message is None


class _Seq(MemoryMailer):
    """Raises the n-th exception on the n-th send (None sends)."""
    def __init__(self, *fails):
        super().__init__()
        self.fails = list(fails)

    def send(self, msg):
        fail = self.fails.pop(0) if self.fails else None
        if fail is not None:
            raise fail
        self.sent.append(msg)


NO_UTF8 = ("One or more source or delivery addresses require internationalized email support,"
           " but the server does not advertise the required SMTPUTF8 capability")
RCPT_554 = smtplib.SMTPRecipientsRefused({"x@uni.dk": (554, b"5.7.1 Relay access denied")})


def test_a_non_ascii_recipient_fails_only_its_message(db, seeded_run, mailer):
    mailer["m"] = _Seq(smtplib.SMTPNotSupportedError(NO_UTF8), None)
    set_site(db, **ON, email_off_at=None)
    a, b = (_row(db, seeded_run, T0 + timedelta(seconds=i)) for i in range(2))
    _tick_once(_state(), T0 + H)
    db.refresh(a)
    assert a.error is not None and a.retry_count == 1
    assert _sent(db, b) == [True]
    assert _fresh_view(db).send_failure_message is None


def test_a_non_ascii_from_stops_the_queue(db, seeded_run, mailer):
    mailer["m"] = _Seq(smtplib.SMTPNotSupportedError(NO_UTF8))
    set_site(db, **{**ON, "email_from": "Mathion <nø@uni.dk>"}, email_off_at=None)
    r = _row(db, seeded_run, T0)
    _tick_once(_state(), T0 + H)
    db.refresh(r)
    assert (r.retry_count, r.error) == (0, None)
    view = _fresh_view(db)
    assert view.send_failure_message == "The mail server can't take an address with letters like æ, ø or å."
    assert view.send_retry_at is not None


def test_a_drop_mid_send_leaves_the_red_line(db, seeded_run, mailer):
    # The session opened but the message didn't go: nothing says the server works.
    mailer["m"] = _Seq(smtplib.SMTPServerDisconnected("Connection unexpectedly closed: timed out"))
    set_site(db, **ON, email_off_at=None, send_failure_message="The mail server refused the login.",
             send_failure_at=T0, send_retry_at=T0, send_backoff_step=2)
    _row(db, seeded_run, T0)
    _tick_once(_state(), T0 + H)
    view = _fresh_view(db)
    assert (view.send_failure_message, view.send_failure_at, view.send_backoff_step) == (
        "The mail server refused the login.", T0, 2)


def test_session_with_only_skipped_rows_clears_the_red_line(db, seeded_run, mailer):
    mailer["m"] = _Seq()
    set_site(db, **ON, email_off_at=None, send_failure_message="The mail server refused the login.",
             send_failure_at=T0, send_retry_at=T0, send_backoff_step=2)
    db.add(NotificationLogEntry(user_id=seeded_run["student_user"].id, kind="course_admin_assigned",
                                payload={"course_id": 987654}, created_at=T0))   # course gone: skipped
    db.commit()
    _tick_once(_state(), T0 + H)
    view = _fresh_view(db)
    assert (view.send_failure_message, view.send_retry_at, view.send_backoff_step) == (None, None, 0)
    assert mailer["m"].sent == []


@pytest.mark.parametrize("line", [REFUSED_SENTENCE, REFUSED_LOGIN_SENTENCE, EVERYONE_SENTENCE])
def test_a_refusal_line_stays_through_a_session_that_sends_nothing(db, seeded_run, mailer, line):
    # A refusal's line goes when a message gets through, not when a tick
    # merely connects (else a retried refusal flickers on and off).
    mailer["m"] = _Seq(smtplib.SMTPRecipientsRefused({"x@uni.dk": (550, b"no such user")}))
    set_site(db, **ON, email_off_at=None, send_failure_message=line, send_failure_at=T0)
    _row(db, seeded_run, T0)
    _tick_once(_state(), T0 + H)
    view = _fresh_view(db)
    assert (view.send_failure_message, view.send_failure_at) == (line, T0)


def test_relay_refusing_everyone_beside_a_broken_row_still_shows(db, seeded_run, mailer):
    # A row that fails before it reaches the server doesn't count.
    mailer["m"] = _Seq(RCPT_554, RCPT_554)
    set_site(db, **ON, email_off_at=None)
    _row(db, seeded_run, T0)
    db.add(NotificationLogEntry(user_id=seeded_run["student_user"].id, kind="evaluation_received",
                                payload={"run_id": seeded_run["run"].id}, created_at=T0 + timedelta(seconds=1)))
    db.commit()
    _row_for(db, seeded_run, _other_student(db), T0 + timedelta(seconds=2))
    _tick_once(_state(), T0 + H)
    assert _fresh_view(db).send_failure_message == EVERYONE_SENTENCE


def test_two_greylisted_recipients_are_not_everyone(db, seeded_run, mailer):
    grey = smtplib.SMTPRecipientsRefused({"x@uni.dk": (451, b"4.7.1 try later")})
    mailer["m"] = _Seq(grey, grey)
    set_site(db, **ON, email_off_at=None)
    _row(db, seeded_run, T0)
    _row_for(db, seeded_run, _other_student(db), T0 + timedelta(seconds=1))
    _tick_once(_state(), T0 + H)
    assert _fresh_view(db).send_failure_message is None


@pytest.mark.parametrize("third, line", [
    (smtplib.SMTPDataError(554, b"rejected"), REFUSED_SENTENCE),
    (smtplib.SMTPServerDisconnected("Connection unexpectedly closed"), None),
])
def test_refused_recipients_beside_another_failure_are_not_everyone(db, seeded_run, mailer, third, line):
    # Two addresses refused, but a third message went further (D9c): not everyone.
    mailer["m"] = _Seq(RCPT_554, RCPT_554, third)
    set_site(db, **ON, email_off_at=None)
    _row(db, seeded_run, T0)
    _row_for(db, seeded_run, _other_student(db), T0 + timedelta(seconds=1))
    _row(db, seeded_run, T0 + timedelta(seconds=2))
    _tick_once(_state(), T0 + H)
    assert _fresh_view(db).send_failure_message == line


# D9d, rev 8: a login doesn't show the server takes the From, so these lines
# stay until a message gets past the sender.
SENDER_SIDE = [SENDER_SENTENCE, "The mail server asked Mathion to try again later.",
               "The mail server can't take an address with letters like æ, ø or å."]


@pytest.mark.parametrize("before_sender", [False, True])
@pytest.mark.parametrize("line", SENDER_SIDE)
def test_a_sender_line_stays_through_a_session_that_sends_nothing(db, seeded_run, mailer, line, before_sender):
    # The one row is skipped, or fails before the sender is sent (a
    # recipient with letters like æ on a server without SMTPUTF8).
    mailer["m"] = _Seq(smtplib.SMTPNotSupportedError(NO_UTF8))
    set_site(db, **ON, email_off_at=None, send_failure_message=line,
             send_failure_at=T0, send_retry_at=T0, send_backoff_step=3)
    if before_sender:
        _row(db, seeded_run, T0)
    else:
        db.add(NotificationLogEntry(user_id=seeded_run["student_user"].id, kind="course_admin_assigned",
                                    payload={"course_id": 987654}, created_at=T0))   # course gone: skipped
        db.commit()
    _tick_once(_state(), T0 + H)
    view = _fresh_view(db)
    assert (view.send_failure_message, view.send_failure_at, view.send_backoff_step) == (line, T0, 3)


@pytest.mark.parametrize("fail", [
    smtplib.SMTPRecipientsRefused({"x@uni.dk": (550, b"no such user")}),
    smtplib.SMTPRecipientsRefused({"x@uni.dk": (451, b"4.7.1 try later")}),
    smtplib.SMTPDataError(451, b"4.3.0 try later"),
])
@pytest.mark.parametrize("line", SENDER_SIDE)
def test_a_sender_line_goes_when_a_message_gets_past_the_sender(db, seeded_run, mailer, line, fail):
    # The server took the sender, then refused or delayed the message: the From works.
    mailer["m"] = _Seq(fail)
    set_site(db, **ON, email_off_at=None, send_failure_message=line,
             send_failure_at=T0, send_retry_at=T0, send_backoff_step=3)
    _row(db, seeded_run, T0)
    _tick_once(_state(), T0 + H)
    view = _fresh_view(db)
    assert (view.send_failure_message, view.send_retry_at, view.send_backoff_step) == (None, None, 0)


def test_a_message_smtplib_stops_before_the_server_does_not_count(db, seeded_run, mailer):
    # A recipient with letters like æ never reaches a server without SMTPUTF8,
    # so it doesn't hide a relay refusing everyone (D9c).
    mailer["m"] = _Seq(RCPT_554, smtplib.SMTPNotSupportedError(NO_UTF8), RCPT_554)
    set_site(db, **ON, email_off_at=None)
    _row(db, seeded_run, T0)
    _row(db, seeded_run, T0 + timedelta(seconds=1))
    _row_for(db, seeded_run, _other_student(db), T0 + timedelta(seconds=2))
    _tick_once(_state(), T0 + H)
    assert _fresh_view(db).send_failure_message == EVERYONE_SENTENCE


def test_a_message_that_breaks_before_the_server_does_not_count(db, seeded_run, mailer):
    # An error of Mathion's own while smtplib builds the message: the server
    # never heard of it, so it doesn't hide a relay refusing everyone (D9c).
    mailer["m"] = _Seq(RCPT_554, ValueError("header"), RCPT_554)
    set_site(db, **ON, email_off_at=None)
    _row(db, seeded_run, T0)
    _row(db, seeded_run, T0 + timedelta(seconds=1))
    _row_for(db, seeded_run, _other_student(db), T0 + timedelta(seconds=2))
    _tick_once(_state(), T0 + H)
    assert _fresh_view(db).send_failure_message == EVERYONE_SENTENCE
