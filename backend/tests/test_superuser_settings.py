"""The superuser panel's Settings API (superuser Settings spec D5-D12)."""
import smtplib
import threading
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from mathion.config import settings
from mathion.database import SessionLocal
from mathion.main import app
from mathion.models_auth import NotificationLogEntry
from mathion.notifications import dispatcher
from mathion.notifications import mailer as mailer_mod
from mathion.notifications.smtp_errors import SmtpFailure
from mathion.secret_box import seal, unseal
from mathion.site_settings import load
from mathion.superuser import service as panel_service
from tests.conftest import set_site

FROM = "Mathion <noreply@uni.dk>"
ON = dict(on=True, host="mail.uni.dk", port=587, encryption="starttls", skip_cert_check=False,
          username="", password=None, from_address=FROM)
SAVED_LOGIN = dict(email_on=True, smtp_host="mail.uni.dk", smtp_port=587, smtp_encryption="starttls",
                   smtp_username="u@uni.dk", email_from=FROM)
TEST_FIELDS = {k: v for k, v in ON.items() if k != "on"}

RETYPE = "Type the password again: the mail server, username or certificate check has changed."
UNREADABLE = "The saved password can't be read on this server: type it again."
TIMEOUT = "The mail server didn't answer within 20 seconds."


@pytest.fixture
def panel(admin_client, db, monkeypatch):
    """(client, base path) for a superuser with a live panel token; the panel decides email."""
    monkeypatch.setattr(settings, "email_mode", "disabled")
    token = panel_service.mint(db)
    return admin_client, f"/api/superuser/{token}"


def _msg(r) -> str:
    d = r.json()["detail"]
    return d if isinstance(d, str) else d[0]["msg"].removeprefix("Value error, ")


def _get(panel):
    client, base = panel
    r = client.get(f"{base}/settings")
    assert r.status_code == 200, r.text
    return r.json()


def _email(panel, **fields):
    client, base = panel
    return client.patch(f"{base}/settings/email", json={**ON, **fields})


def _test(panel, **fields):
    client, base = panel
    return client.post(f"{base}/settings/email/test", json={**TEST_FIELDS, **fields})


def _view(db):
    db.expire_all()
    return load(db)


class _FakeSMTP:
    """smtplib.SMTP/SMTP_SSL stand-in: records sends, fails or blocks on request."""
    sent: list = []
    fail_login: BaseException | None = None
    fail_send: BaseException | None = None
    block: threading.Event | None = None

    def __init__(self, host, port, timeout=None, **kw):
        self.host = host

    def ehlo_or_helo_if_needed(self):
        pass

    def starttls(self, context=None):
        pass

    def login(self, user, password):
        if _FakeSMTP.fail_login is not None:
            raise _FakeSMTP.fail_login

    def send_message(self, msg):
        if _FakeSMTP.block is not None:
            _FakeSMTP.block.wait(10)
        if _FakeSMTP.fail_send is not None:
            raise _FakeSMTP.fail_send
        _FakeSMTP.sent.append(msg)

    def quit(self):
        pass


@pytest.fixture
def smtp(monkeypatch):
    _FakeSMTP.sent, _FakeSMTP.fail_login, _FakeSMTP.fail_send, _FakeSMTP.block = [], None, None, None
    monkeypatch.setattr(mailer_mod.smtplib, "SMTP", _FakeSMTP)
    monkeypatch.setattr(mailer_mod.smtplib, "SMTP_SSL", _FakeSMTP)
    return _FakeSMTP


def _wait_for_test_thread():
    from mathion.api import superuser_settings as mod
    assert mod._TEST_LOCK.acquire(timeout=10), "the test thread never finished"
    mod._TEST_LOCK.release()


# --- reading ---------------------------------------------------------------------

def test_get_never_returns_password(panel, db):
    sealed = seal("S3ntinel-pw", settings.secret_key)
    set_site(db, **SAVED_LOGIN, smtp_password_sealed=sealed)
    client, base = panel
    r = client.get(f"{base}/settings")
    email = r.json()["email"]
    assert (email["password_saved"], email["password_unreadable"]) == (True, False)
    assert "S3ntinel" not in r.text and sealed not in r.text


def test_get_shape(panel, db):
    set_site(db, **SAVED_LOGIN, smtp_password_sealed=seal("pw", "another-secret"), max_file_mb=30,
             pin_minutes=15, send_failure_message="Couldn't reach mail.uni.dk on port 587.",
             send_failure_at=datetime(2026, 11, 1, tzinfo=timezone.utc))
    body = _get(panel)
    assert body["email"]["password_unreadable"] is True
    assert body["email"]["failing"]["message"] == "Couldn't reach mail.uni.dk on port 587."
    assert body["email"]["card_test"] is None
    assert body["email"]["dev_mode"] is None
    assert body["limits"] == {"max_file_mb": 30, "max_total_mb": 500}
    assert body["sign_in"] == {"pin_minutes": 15, "pin_requests_per_hour": 3, "pin_failures_per_hour": 5,
                               "longest_sign_in_days": 30}
    assert body["site"] == {"base_url": settings.base_url}


@pytest.mark.parametrize("mode,shown", [("file", "file"), ("memory", "memory"), ("disabled", None),
                                        ("smtp", None)])
def test_dev_mode_reported(panel, monkeypatch, mode, shown):
    monkeypatch.setattr(settings, "email_mode", mode)
    assert _get(panel)["email"]["dev_mode"] == shown


# --- turning email on and off ----------------------------------------------------------

@pytest.mark.parametrize("fields", [dict(host=""), dict(from_address=""), dict(host="  ")])
def test_turn_on_needs_host_and_from(panel, db, fields):
    r = _email(panel, **fields)
    assert (r.status_code, _msg(r)) == (422, "Email needs the mail server and the From address.")
    assert _view(db).email_on is False


def test_login_needs_encryption(panel, db):
    r = _email(panel, encryption="none", port=25, username="u@uni.dk", password="pw")
    assert (r.status_code, _msg(r)) == (422, "A login needs encryption: pick STARTTLS or SSL/TLS.")


def test_username_needs_password(panel, db):
    r = _email(panel, username="u@uni.dk", password=None)
    assert (r.status_code, _msg(r)) == (422, "Type the password for this username.")
    assert _view(db).email_on is False


@pytest.mark.parametrize("password", ["pässword", "pw\n", "密码"])
def test_password_ascii_only(panel, password):
    r = _email(panel, username="u@uni.dk", password=password)
    assert (r.status_code, _msg(r)) == (
        422, "The password can only use plain letters, digits and symbols (no accents).")


@pytest.mark.parametrize("sender", ["noreply", "noreply@", "@uni.dk", "Mathion <>",
                                    "Mathion <noreply@uni.dk>\nBcc: x@y.dk", "a b@uni.dk",
                                    # invisible line breaks a paste can carry (Shift-Return in Pages)
                                    "Ålborg\u2028Uni <noreply@uni.dk>", "Mathion\u2029 <noreply@uni.dk>",
                                    "Mathion\x85 <noreply@uni.dk>",
                                    # pass parseaddr, but a send reads another sender or breaks the header
                                    "Ålborg Universitet:Institut for Matematik og Økonomi <noreply@math.aau.dk>",
                                    "Universität Ålborg <noreply@uni.dk.>", "noreply@uni.dk.", "noreply@uni..dk",
                                    "Matematik\\Fysik <noreply@uni.dk>", "(Mathé) noreply@uni.dk",
                                    # a pasted quote: receivers read an address with no domain
                                    '"noreply@uni.dk"', '"noreply@uni.dk', "'noreply@uni.dk'",
                                    "\u180e\\Å <noreply@uni.dk>"])
def test_from_checked(panel, sender):
    r = _email(panel, from_address=sender)
    assert (r.status_code, _msg(r)) == (
        422, "The From address must look like Name <address@example.edu> or address@example.edu.")


@pytest.mark.parametrize("sender", ["noreply@universität.de", "Mathion <nø@uni.dk>"])
def test_from_address_must_be_plain(panel, sender):
    # Most mail servers refuse an address with other letters (no SMTPUTF8).
    r = _email(panel, from_address=sender)
    assert (r.status_code, _msg(r)) == (
        422, "The address in From can only use plain letters, digits and symbols: "
             "write an accented domain in its xn-- form.")


@pytest.mark.parametrize("sender", ["noreply@uni.dk", "Mathion <noreply@uni.dk>", '"Uni, Maths" <m@uni.dk>',
                                    "Universität Ålborg <noreply@uni.dk>", "noreply@xn--universitt-y5a.de"])
def test_good_from_accepted(panel, db, sender):
    assert _email(panel, from_address=sender).status_code == 200
    assert _view(db).email_from == sender


@pytest.mark.parametrize("port", [0, 65536, -1])
def test_port_range(panel, port):
    r = _email(panel, port=port)
    assert (r.status_code, _msg(r)) == (422, "The port must be from 1 to 65535.")


def test_turn_on_saves_and_seals(panel, db):
    r = _email(panel, username="u@uni.dk", password="S3ntinel-pw", encryption="ssl", port=465,
               skip_cert_check=True)
    assert r.status_code == 200, r.text
    v = _view(db)
    assert (v.email_on, v.smtp_host, v.smtp_port, v.smtp_encryption, v.smtp_skip_cert_check,
            v.smtp_username, v.email_from) == (True, "mail.uni.dk", 465, "ssl", True, "u@uni.dk", FROM)
    assert v.smtp_password_sealed.startswith("v1:") and "S3ntinel" not in v.smtp_password_sealed
    assert unseal(v.smtp_password_sealed, settings.secret_key) == "S3ntinel-pw"
    assert r.json()["email"]["password_saved"] is True


def test_turn_on_marks_off_rows_skipped_and_sets_times(panel, db, superuser):
    now = datetime.now(timezone.utc)
    off_at = now - timedelta(hours=2)
    set_site(db, email_on=False, email_off_at=off_at, email_on_at=None)

    def row(created, **kw):
        e = NotificationLogEntry(user_id=superuser.id, kind="run_enrolled", payload={}, created_at=created, **kw)
        db.add(e)
        db.commit()
        return e
    before = row(now - timedelta(hours=3))
    inside = row(now - timedelta(hours=1))
    backoff = row(now - timedelta(hours=1), retry_count=1, next_attempt_at=now + timedelta(minutes=5))
    sent = row(now - timedelta(hours=1), sent_at=now - timedelta(minutes=30))
    failed = row(now - timedelta(hours=1), error="bounced")

    assert _email(panel).status_code == 200
    for r in (before, inside, backoff, sent, failed):
        db.refresh(r)
    assert before.error is None
    assert inside.error == backoff.error == "skipped: email was off"
    assert (sent.error, failed.error) == (None, "bounced")
    v = _view(db)
    assert v.email_off_at == off_at
    assert v.email_on_at is not None and v.email_on_at > off_at


def test_saving_while_on_keeps_times_and_marks_nothing(panel, db, superuser):
    on_at = datetime.now(timezone.utc) - timedelta(hours=1)
    set_site(db, email_on=True, smtp_host="mail.uni.dk", email_from=FROM, email_off_at=None, email_on_at=on_at)
    e = NotificationLogEntry(user_id=superuser.id, kind="run_enrolled", payload={})
    db.add(e)
    db.commit()
    assert _email(panel, host="mail2.uni.dk").status_code == 200
    db.refresh(e)
    assert e.error is None
    v = _view(db)
    assert (v.email_off_at, v.email_on_at, v.smtp_host) == (None, on_at, "mail2.uni.dk")


def test_off_writes_only_switch(panel, db):
    set_site(db, **SAVED_LOGIN, smtp_password_sealed=seal("pw", settings.secret_key), email_off_at=None)
    r = _email(panel, on=False, host="evil.example", username="", from_address="x")
    assert r.status_code == 200, r.text
    v = _view(db)
    assert (v.email_on, v.smtp_host, v.smtp_username, v.email_from) == (False, "mail.uni.dk", "u@uni.dk", FROM)
    assert v.smtp_password_sealed is not None
    assert v.email_off_at is not None and v.email_off_at > datetime.now(timezone.utc) - timedelta(minutes=1)


def test_off_alone_is_enough(panel, db):
    client, base = panel
    r = client.patch(f"{base}/settings/email", json={"on": False})
    assert r.status_code == 200, r.text


def test_off_needs_no_password_even_unreadable(panel, db):
    set_site(db, **SAVED_LOGIN, smtp_password_sealed=seal("pw", "another-secret"))
    r = _email(panel, on=False, username="u@uni.dk", password=None)
    assert r.status_code == 200, r.text
    assert _view(db).email_on is False


def test_clearing_username_drops_password(panel, db):
    set_site(db, **SAVED_LOGIN, smtp_password_sealed=seal("pw", settings.secret_key))
    assert _email(panel, username="").status_code == 200
    v = _view(db)
    assert (v.smtp_username, v.smtp_password_sealed) == ("", None)


# --- the saved password (D8a) -------------------------------------------------------------

def _saved_login(db):
    sealed = seal("pw", settings.secret_key)
    set_site(db, **SAVED_LOGIN, smtp_password_sealed=sealed)
    return sealed


def test_changed_host_needs_password_again(panel, db):
    _saved_login(db)
    r = _email(panel, host="mail2.uni.dk", username="u@uni.dk")
    assert (r.status_code, _msg(r)) == (422, RETYPE)
    assert _view(db).smtp_host == "mail.uni.dk"


def test_changed_username_needs_password_again(panel, db):
    _saved_login(db)
    r = _email(panel, username="v@uni.dk")
    assert (r.status_code, _msg(r)) == (422, RETYPE)


def test_newly_ticked_cert_box_needs_password_again(panel, db):
    _saved_login(db)
    r = _email(panel, username="u@uni.dk", skip_cert_check=True)
    assert (r.status_code, _msg(r)) == (422, RETYPE)


def test_changed_port_keeps_password(panel, db):
    sealed = _saved_login(db)
    r = _email(panel, username="u@uni.dk", port=465, encryption="ssl")
    assert r.status_code == 200, r.text
    assert _view(db).smtp_password_sealed == sealed


def test_typed_password_with_changed_host_is_saved(panel, db):
    _saved_login(db)
    assert _email(panel, host="mail2.uni.dk", username="u@uni.dk", password="pw2").status_code == 200
    assert unseal(_view(db).smtp_password_sealed, settings.secret_key) == "pw2"


def test_unreadable_saved_password_needs_typing(panel, db):
    set_site(db, **SAVED_LOGIN, smtp_password_sealed=seal("pw", "another-secret"))
    r = _email(panel, username="u@uni.dk")
    assert (r.status_code, _msg(r)) == (422, UNREADABLE)


def test_test_with_changed_host_needs_password_again(panel, db, smtp):
    _saved_login(db)
    r = _test(panel, host="mail2.uni.dk", username="u@uni.dk")
    assert (r.status_code, _msg(r)) == (422, RETYPE)
    assert smtp.sent == []


# --- the card's test (D9a) -----------------------------------------------------------------

def test_test_of_saved_values_reaches_card(panel, db, smtp):
    assert _email(panel).status_code == 200
    r = _test(panel)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "message": "Sent to admin@example.com: check your inbox."}
    assert len(smtp.sent) == 1
    assert smtp.sent[0]["To"] == "admin@example.com" and smtp.sent[0]["From"] == FROM
    card = _get(panel)["email"]["card_test"]
    assert (card["ok"], card["message"]) == (True, "Sent to admin@example.com: check your inbox.")


def test_test_of_saved_login_uses_saved_password(panel, db, smtp):
    _saved_login(db)
    r = _test(panel, username="u@uni.dk")
    assert r.json()["ok"] is True
    assert _get(panel)["email"]["card_test"]["ok"] is True


def test_test_then_save_reaches_card(panel, db, smtp):
    assert _email(panel).status_code == 200
    assert _test(panel, host="mail2.uni.dk").json()["ok"] is True
    assert _get(panel)["email"]["card_test"] is None
    assert _email(panel, host="mail2.uni.dk").status_code == 200
    assert _get(panel)["email"]["card_test"]["ok"] is True


def test_test_other_values_leaves_card(panel, db, smtp):
    assert _email(panel).status_code == 200
    assert _test(panel).json()["ok"] is True
    smtp.fail_send = smtplib.SMTPSenderRefused(553, b"no", "x@other.dk")
    r = _test(panel, from_address="x@other.dk")
    assert r.json() == {"ok": False, "message": "The mail server refused x@other.dk as the sender."}
    assert _get(panel)["email"]["card_test"]["ok"] is True


def test_save_clears_card_test_when_fingerprint_differs(panel, db, smtp):
    assert _email(panel).status_code == 200
    assert _test(panel).json()["ok"] is True
    assert _email(panel, port=2525).status_code == 200
    assert _get(panel)["email"]["card_test"] is None


def test_save_unchanged_keeps_card_test(panel, db, smtp):
    assert _email(panel).status_code == 200
    assert _test(panel).json()["ok"] is True
    assert _test(panel, port=2525).json()["ok"] is True   # the latest test is of other values
    assert _email(panel).status_code == 200                # the same settings again
    assert _get(panel)["email"]["card_test"]["ok"] is True


# --- the test itself (D9) ----------------------------------------------------------------------

def test_test_endpoint_answer_has_no_server_text(panel, db, smtp):
    smtp.fail_login = smtplib.SMTPAuthenticationError(535, b"5.7.8 bad S3ntinel-pw")
    r = _test(panel, username="u@uni.dk", password="S3ntinel-pw")
    assert r.status_code == 200
    assert r.json() == {"ok": False, "message": "The mail server refused the login."}
    assert "S3ntinel" not in r.text
    v = _view(db)
    assert v.test_message == "The mail server refused the login." and v.test_ok is False


def test_copied_non_ascii_password_must_be_typed_again(panel, db, smtp, caplog):
    # D2 copies .env's password as it is; smtplib can't send a non-ASCII one,
    # and its error would name a character of it.
    set_site(db, **SAVED_LOGIN, smtp_password_sealed=seal("pässwørd", settings.secret_key))
    caplog.set_level("DEBUG")
    for r in (_test(panel, username="u@uni.dk"), _email(panel, username="u@uni.dk")):
        assert (r.status_code, _msg(r)) == (
            422, "The saved password has characters that can't be sent: type it again.")
    assert smtp.sent == [] and "ø" not in caplog.text and "ä" not in caplog.text


def test_unexpected_test_failure_logs_no_detail(panel, smtp, monkeypatch, caplog):
    # An error that isn't the mail server's (here one that quotes a password
    # character) is logged by class only.
    def boom(self, msg):
        raise UnicodeEncodeError("ascii", "S3ntinel-ø", 9, 10, "ordinal not in range(128)")
    monkeypatch.setattr(mailer_mod.SMTPMailer, "send", boom)
    caplog.set_level("DEBUG")
    r = _test(panel)
    assert r.json() == {"ok": False, "message": "Sending failed (UnicodeEncodeError)."}
    assert "UnicodeEncodeError" in caplog.text
    assert "S3ntinel" not in caplog.text and "position" not in caplog.text


def test_test_failure_logs_no_server_text(panel, smtp, caplog):
    smtp.fail_send = smtplib.SMTPDataError(554, b"5.7.1 S3ntinel spam")
    caplog.set_level("DEBUG")
    assert _test(panel).json()["ok"] is False
    assert "S3ntinel" not in caplog.text


def test_test_checks_the_from(panel, smtp):
    r = _test(panel, from_address="nobody")
    assert (r.status_code, _msg(r)) == (
        422, "The From address must look like Name <address@example.edu> or address@example.edu.")
    assert smtp.sent == []


def test_second_test_while_running_409(panel, smtp):
    from mathion.api import superuser_settings as mod
    assert mod._TEST_LOCK.acquire(blocking=False)
    try:
        r = _test(panel)
        assert (r.status_code, _msg(r)) == (409, "A test is already running.")
    finally:
        mod._TEST_LOCK.release()


def test_timeout_answer_recorded_and_late_result_discarded(panel, db, smtp, monkeypatch):
    from mathion.api import superuser_settings as mod
    monkeypatch.setattr(mod, "TEST_WAIT_SECONDS", 0.2)
    assert _email(panel).status_code == 200
    smtp.block = threading.Event()
    r = _test(panel)
    assert r.json() == {"ok": False, "message": TIMEOUT}
    smtp.block.set()                 # the late success arrives
    _wait_for_test_thread()
    assert len(smtp.sent) == 1
    v = _view(db)
    assert (v.test_ok, v.test_message) == (False, TIMEOUT)
    assert (v.card_test_ok, v.card_test_message) == (False, TIMEOUT)


def test_port_hint_in_the_test_answer(panel, smtp):
    smtp.fail_send = ConnectionRefusedError("nope")
    r = _test(panel, encryption="ssl", port=587)
    assert r.json()["message"] == ("Couldn't reach mail.uni.dk on port 587. "
                                   "Port 465 usually means SSL/TLS, and 587 STARTTLS.")


# --- saving resets the stuck queue (D9c, D9d) ------------------------------------------------------

def test_save_email_clears_failure_and_backoff(panel, db):
    set_site(db, email_on=True, smtp_host="mail.uni.dk", email_from=FROM, email_off_at=None,
             send_failure_message="x", send_failure_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
             send_retry_at=datetime.now(timezone.utc) + timedelta(minutes=30), send_backoff_step=3)
    assert _email(panel).status_code == 200
    v = _view(db)
    assert (v.send_failure_message, v.send_failure_at, v.send_retry_at, v.send_backoff_step) == (
        None, None, None, 0)
    assert _get(panel)["email"]["failing"] is None


def test_failure_stored_during_a_save_does_not_survive_it(panel, db, monkeypatch):
    # The queue records a failure for the old server while the save (which
    # changes the server) is between its read and its commit: the save wins.
    from mathion.api import superuser_settings as mod
    set_site(db, email_on=True, smtp_host="old.uni.dk", email_from=FROM, email_off_at=None)
    tick_view = _view(db)
    failure = SmtpFailure("ConnectionRefusedError", None, "Couldn't reach old.uni.dk on port 587.", True)
    threads = []
    real_check = mod._check_email

    def check_while_the_queue_records(*a, **kw):
        def record():
            with SessionLocal() as other:
                dispatcher._record(other, tick_view, dispatcher.TickResult(failure=failure),
                                   datetime.now(timezone.utc))
        t = threading.Thread(target=record)
        t.start()
        t.join(0.5)       # with the save's row lock, the queue waits here
        threads.append(t)
        return real_check(*a, **kw)

    monkeypatch.setattr(mod, "_check_email", check_while_the_queue_records)
    assert _email(panel, host="new.uni.dk").status_code == 200
    for t in threads:
        t.join(10)
    v = _view(db)
    assert (v.smtp_host, v.send_failure_message, v.send_retry_at) == ("new.uni.dk", None, None)


# --- limits and sign-in -----------------------------------------------------------------------------

@pytest.mark.parametrize("body,msg", [
    ({"max_file_mb": 0, "max_total_mb": 500}, "The largest file must be from 1 to 50 MB."),
    ({"max_file_mb": 51, "max_total_mb": 500}, "The largest file must be from 1 to 50 MB."),
    ({"max_file_mb": 20, "max_total_mb": 102_401}, "The total can be at most 102400 MB."),
])
def test_limits_ranges(panel, db, body, msg):
    client, base = panel
    r = client.patch(f"{base}/settings/limits", json=body)
    assert (r.status_code, _msg(r)) == (422, msg)
    assert _view(db).max_file_mb == 20


def test_total_below_file_refused(panel):
    client, base = panel
    r = client.patch(f"{base}/settings/limits", json={"max_file_mb": 30, "max_total_mb": 29})
    assert (r.status_code, _msg(r)) == (422, "The total can't be smaller than the largest file.")


def test_limits_saved(panel, db):
    client, base = panel
    r = client.patch(f"{base}/settings/limits", json={"max_file_mb": 50, "max_total_mb": 50})
    assert r.status_code == 200, r.text
    assert r.json()["limits"] == {"max_file_mb": 50, "max_total_mb": 50}
    assert (_view(db).max_file_mb, _view(db).max_total_mb) == (50, 50)


SIGN_IN = {"pin_minutes": 10, "pin_requests_per_hour": 3, "pin_failures_per_hour": 5, "longest_sign_in_days": 30}


@pytest.mark.parametrize("field,value,msg", [
    ("pin_minutes", 4, "A PIN lasts from 5 to 60 minutes."),
    ("pin_minutes", 61, "A PIN lasts from 5 to 60 minutes."),
    ("pin_requests_per_hour", 2, "PIN requests per hour must be from 3 to 20."),
    ("pin_requests_per_hour", 21, "PIN requests per hour must be from 3 to 20."),
    ("pin_failures_per_hour", 2, "Wrong PIN tries per hour must be from 3 to 20."),
    ("pin_failures_per_hour", 21, "Wrong PIN tries per hour must be from 3 to 20."),
    ("longest_sign_in_days", 2, "The longest sign-in is 1, 7 or 30 days."),
])
def test_sign_in_ranges(panel, db, field, value, msg):
    client, base = panel
    r = client.patch(f"{base}/settings/sign-in", json={**SIGN_IN, field: value})
    assert (r.status_code, _msg(r)) == (422, msg)
    assert _view(db).pin_minutes == 10


def test_sign_in_saved_and_cards_independent(panel, db):
    set_site(db, max_file_mb=33, email_on=True, smtp_host="mail.uni.dk", email_from=FROM)
    client, base = panel
    body = {"pin_minutes": 60, "pin_requests_per_hour": 20, "pin_failures_per_hour": 3, "longest_sign_in_days": 7}
    r = client.patch(f"{base}/settings/sign-in", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["sign_in"] == body
    v = _view(db)
    assert (v.pin_minutes, v.longest_sign_in_days, v.max_file_mb, v.email_on, v.smtp_host) == (
        60, 7, 33, True, "mail.uni.dk")


# --- no echo, the guard -------------------------------------------------------------------------------

def test_422_echoes_no_input(panel):
    client, base = panel
    no_on = {k: v for k, v in ON.items() if k != "on"}
    bodies = [
        (client.patch, f"{base}/settings/email", {**ON, "password": "S3ntinel-pw", "port": "abc"}),
        (client.patch, f"{base}/settings/email", {**no_on, "password": "S3ntinel-pw"}),   # whole body echoed by default
        (client.patch, f"{base}/settings/email", {**ON, "password": ["S3ntinel-pw"]}),
        (client.post, f"{base}/settings/email/test", {**TEST_FIELDS, "password": ["S3ntinel-pw"]}),
    ]
    for method, url, body in bodies:
        r = method(url, json=body)
        assert r.status_code == 422
        assert "S3ntinel" not in r.text, (url, body)
        assert all(set(e) == {"loc", "msg"} for e in r.json()["detail"])


def test_422_outside_the_panel_unchanged(admin_client):
    r = admin_client.post("/api/auth/request-pin", json={"email": 5})
    assert r.status_code == 422
    assert "input" in r.json()["detail"][0]


def test_guard_and_csrf(panel, db):
    client, base = panel
    assert client.get("/api/superuser/not-a-token/settings").status_code == 404
    plain = TestClient(app)
    plain.cookies = client.cookies
    calls = [
        ("PATCH", f"{base}/settings/email", ON),
        ("PATCH", f"{base}/settings/limits", {"max_file_mb": 20, "max_total_mb": 500}),
        ("PATCH", f"{base}/settings/sign-in", SIGN_IN),
        ("POST", f"{base}/settings/email/test", TEST_FIELDS),
    ]
    for method, url, body in calls:
        r = plain.request(method, url, json=body)
        assert r.status_code == 403, (method, url, r.status_code)
