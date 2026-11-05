"""The superuser panel's Settings page (superuser Settings spec D5-D12).

Every route sits behind the panel token; writes also need the CSRF header.
Each card saves only its own fields, so two tabs saving different cards never
overwrite each other. The password is never sent back (D8), and no sentence
quotes the mail server (D9b).
"""
import io
import logging
import re
import threading
from datetime import datetime, timezone
from email import message_from_bytes, policy as email_policy
from email.generator import BytesGenerator
from email.message import EmailMessage
from email.utils import getaddresses, parseaddr

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from mathion.api.superuser import require_superuser_panel, require_superuser_panel_write
from mathion.config import settings
from mathion.database import SessionLocal, get_db
from mathion.models_auth import NotificationLogEntry, SiteSettings, User
from mathion.notifications.mailer import DEV_MODES, SMTPMailer
from mathion.notifications.smtp_errors import SMTP_FAILURES, describe
from mathion.schemas import (
    EmailSettingsIn, EmailTestIn, EmailTestResult, LimitsIn, PanelEmailSettings, PanelEmailTest,
    PanelLimits, PanelSendFailure, PanelSettings, PanelSignIn, PanelSite, SignInIn,
)
from mathion.secret_box import SealError, fingerprint, seal, unseal
from mathion.site_settings import RANGES, SIGN_IN_DAYS, get_row, load as load_site, password_is_readable

logger = logging.getLogger(__name__)

router = APIRouter(tags=["superuser"])

# D7, D7a, D7b, D8, D8a. The D7/D8 sentences are the spec's; the others are mine.
_NEEDS_HOST_AND_FROM = "Email needs the mail server and the From address."
_HOST_TOO_LONG = "The mail server name is at most 253 characters."
_USERNAME_TOO_LONG = "The username is at most 254 characters."
_PORT = "The port must be from 1 to 65535."
_FROM = "The From address must look like Name <address@example.edu> or address@example.edu."
_FROM_ASCII = ("The address in From can only use plain letters, digits and symbols: "
               "write an accented domain in its xn-- form.")
_LOGIN_NEEDS_TLS = "A login needs encryption: pick STARTTLS or SSL/TLS."
_ASCII = "The password can only use plain letters, digits and symbols (no accents)."
_SAVED_NOT_ASCII = "The saved password has characters that can't be sent: type it again."
_NEEDS_PASSWORD = "Type the password for this username."
_RETYPE = "Type the password again: the mail server, username or certificate check has changed."
_UNREADABLE = "The saved password can't be read on this server: type it again."
_TEST_RUNNING = "A test is already running."
_SKIPPED_OFF = "skipped: email was off"

_PRINTABLE_ASCII = re.compile(r"[\x20-\x7e]*")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
# Labels of letters, digits and hyphens, one dot between them.
_DOMAIN = re.compile(r"[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*")

# D9: smtplib's own socket timeout, and how long the answer waits for the test.
SMTP_TIMEOUT_SECONDS = 20
TEST_WAIT_SECONDS = 20
# One test at a time, on the server too (D9). Held by the test's thread until
# it finishes, which can be after the 20 s answer went out.
_TEST_LOCK = threading.Lock()


def _bad(sentence: str):
    raise HTTPException(status_code=422, detail=sentence)


def _from_problem(value: str) -> str | None:
    """D7b: a name and an address with an @, and no line break of any kind.
    The address is plain ASCII: most mail servers refuse any other (no
    SMTPUTF8), and the queue would then fail every message. The name may use
    any letters. Last, a message is built and flattened as smtplib sends it:
    the envelope sender smtplib takes from it, and the From a receiver reads
    back, must both be the one address checked here. So nothing passes that
    would fail every message later."""
    if (len(value) > 320 or _CONTROL.search(value) or len(value.splitlines()) != 1
            or value.count("<") != value.count(">")):
        return _FROM
    _name, addr = parseaddr(value)
    local, at, domain = addr.rpartition("@")
    if not (at and local and domain) or any(c.isspace() for c in addr):
        return _FROM
    if not addr.isascii():
        return _FROM_ASCII
    try:
        msg = EmailMessage()
        msg["From"] = value
        buf = io.BytesIO()
        BytesGenerator(buf).flatten(msg, linesep="\r\n")
        back = message_from_bytes(buf.getvalue(), policy=email_policy.default)
        for header in (msg["From"], back["From"]):
            found = getaddresses([str(header)])
            if len(found) != 1 or found[0][1] != addr:
                return _FROM
        # As a receiver reads it: one mailbox, with a domain of the right shape
        # (a pasted quote leaves "noreply@uni.dk" with no domain at all).
        mailboxes = back["From"].addresses
        if (len(mailboxes) != 1 or mailboxes[0].addr_spec != addr
                or not _DOMAIN.fullmatch(mailboxes[0].domain or "")):
            return _FROM
    except Exception:
        return _FROM
    return None


def _changed_server(data: EmailTestIn, row: SiteSettings) -> bool:
    """D8a: the saved password stays with the server, username and certificate
    check it was saved for. Port and encryption alone may change."""
    return (data.host != row.smtp_host or data.username != row.smtp_username
            or (data.skip_cert_check and not row.smtp_skip_cert_check))


def _check_email(data: EmailTestIn, row: SiteSettings, secret: str) -> str:
    """D7-D8a, for a save with email on and for a test. Answers the password to
    use: the typed one, else the saved one, or "" without a login."""
    if not data.host or not data.from_address:
        _bad(_NEEDS_HOST_AND_FROM)
    if len(data.host) > 253:
        _bad(_HOST_TOO_LONG)
    if len(data.username) > 254:
        _bad(_USERNAME_TOO_LONG)
    if not 1 <= data.port <= 65535:
        _bad(_PORT)
    problem = _from_problem(data.from_address)
    if problem:
        _bad(problem)
    if not data.username:
        return ""
    if data.encryption == "none":
        _bad(_LOGIN_NEEDS_TLS)
    if data.password:
        if not _PRINTABLE_ASCII.fullmatch(data.password):
            _bad(_ASCII)
        return data.password
    if not row.smtp_password_sealed:
        _bad(_NEEDS_PASSWORD)
    if _changed_server(data, row):
        _bad(_RETYPE)
    try:
        saved = unseal(row.smtp_password_sealed, secret)
    except SealError:
        _bad(_UNREADABLE)
    if not _PRINTABLE_ASCII.fullmatch(saved):
        _bad(_SAVED_NOT_ASCII)  # copied from .env as it was (D2); smtplib can't send it
    return saved


def _fingerprint(host, port, encryption, skip_cert_check, username, password, sender, secret) -> str:
    """D9a: what a test tested, keyed so a leaked backup can't test passwords."""
    return fingerprint({
        "host": host, "port": port, "encryption": encryption, "skip_cert_check": skip_cert_check,
        "username": username, "password": password if username else "", "from": sender,
    }, secret)


def _saved_fingerprint(row: SiteSettings, secret: str) -> str | None:
    """The saved settings' fingerprint; None while the saved password can't be read."""
    password = ""
    if row.smtp_username and row.smtp_password_sealed:
        try:
            password = unseal(row.smtp_password_sealed, secret)
        except SealError:
            return None
    return _fingerprint(row.smtp_host, row.smtp_port, row.smtp_encryption, row.smtp_skip_cert_check,
                        row.smtp_username, password, row.email_from, secret)


def _locked_row(db: Session) -> SiteSettings:
    """The settings row, locked and read fresh. The queue's `_record` waits on
    this lock, so a failure it stores can't outlive a save made meanwhile."""
    get_row(db)
    return db.execute(select(SiteSettings).where(SiteSettings.id == 1).with_for_update()
                      .execution_options(populate_existing=True)).scalar_one()


def _panel_settings(db: Session) -> PanelSettings:
    v = load_site(db)
    secret = settings.secret_key
    card = (PanelEmailTest(at=v.card_test_at, ok=bool(v.card_test_ok), message=v.card_test_message or "")
            if v.card_test_at is not None else None)
    failing = (PanelSendFailure(since=v.send_failure_at, message=v.send_failure_message)
               if v.send_failure_message and v.send_failure_at is not None else None)
    return PanelSettings(
        email=PanelEmailSettings(
            on=v.email_on, host=v.smtp_host, port=v.smtp_port, encryption=v.smtp_encryption,
            skip_cert_check=v.smtp_skip_cert_check, username=v.smtp_username,
            password_saved=bool(v.smtp_password_sealed),
            password_unreadable=bool(v.smtp_password_sealed) and not password_is_readable(v, secret),
            from_address=v.email_from,
            dev_mode=settings.email_mode if settings.email_mode in DEV_MODES else None,
            card_test=card, failing=failing,
        ),
        limits=PanelLimits(max_file_mb=v.max_file_mb, max_total_mb=v.max_total_mb),
        sign_in=PanelSignIn(pin_minutes=v.pin_minutes, pin_requests_per_hour=v.pin_requests_per_hour,
                            pin_failures_per_hour=v.pin_failures_per_hour,
                            longest_sign_in_days=v.longest_sign_in_days),
        site=PanelSite(base_url=settings.base_url),
    )


@router.get("/api/superuser/{token}/settings", response_model=PanelSettings)
def get_settings(_user: User = Depends(require_superuser_panel), db: Session = Depends(get_db)):
    return _panel_settings(db)


def _clear_send_failure(row: SiteSettings) -> None:
    # D9c, D9d: a save of the email settings resets the wait and the red line.
    row.send_failure_message = row.send_failure_at = row.send_retry_at = None
    row.send_backoff_step = 0


@router.patch("/api/superuser/{token}/settings/email", response_model=PanelSettings)
def save_email(data: EmailSettingsIn, _user: User = Depends(require_superuser_panel_write),
               db: Session = Depends(get_db)):
    secret = settings.secret_key
    row = _locked_row(db)
    now = db.scalar(select(func.now()))
    if not data.on:
        # D7c: only the switch; nothing is checked, not even the password.
        if row.email_on:
            row.email_on = False
            row.email_off_at = now
        _clear_send_failure(row)
        db.commit()
        return _panel_settings(db)

    password = _check_email(data, row, secret)
    old_fp = _saved_fingerprint(row, secret)
    row.smtp_host, row.smtp_port, row.smtp_encryption = data.host, data.port, data.encryption
    row.smtp_skip_cert_check, row.email_from = data.skip_cert_check, data.from_address
    row.smtp_username = data.username
    if not data.username:
        row.smtp_password_sealed = None  # D8: clearing the username drops the password
    elif data.password:
        row.smtp_password_sealed = seal(data.password, secret)

    # D9a: the latest test becomes the card's test when it tested these
    # settings; a save that changed nothing keeps the card's test.
    new_fp = _fingerprint(data.host, data.port, data.encryption, data.skip_cert_check, data.username,
                          password, data.from_address, secret)
    if row.test_fp == new_fp:
        row.card_test_at, row.card_test_ok, row.card_test_message = row.test_at, row.test_ok, row.test_message
    elif new_fp != old_fp:
        row.card_test_at = row.card_test_ok = row.card_test_message = None

    if not row.email_on:
        # D10a: what was queued while email was off is never sent.
        row.email_on = True
        row.email_on_at = now
        if row.email_off_at is not None:
            db.execute(
                update(NotificationLogEntry)
                .where(NotificationLogEntry.sent_at.is_(None), NotificationLogEntry.error.is_(None),
                       NotificationLogEntry.created_at >= row.email_off_at,
                       NotificationLogEntry.created_at < now)
                .values(error=_SKIPPED_OFF)
            )
    _clear_send_failure(row)
    db.commit()
    return _panel_settings(db)


def _check_range(value: int, low: int, high: int, sentence: str) -> None:
    if not low <= value <= high:
        _bad(sentence)


@router.patch("/api/superuser/{token}/settings/limits", response_model=PanelSettings)
def save_limits(data: LimitsIn, _user: User = Depends(require_superuser_panel_write),
                db: Session = Depends(get_db)):
    low, high = RANGES["max_file_mb"]
    _check_range(data.max_file_mb, low, high, f"The largest file must be from {low} to {high} MB.")
    high = RANGES["max_total_mb"][1]
    if data.max_total_mb > high:
        _bad(f"The total can be at most {high} MB.")
    if data.max_total_mb < data.max_file_mb:
        _bad("The total can't be smaller than the largest file.")
    row = get_row(db)
    row.max_file_mb, row.max_total_mb = data.max_file_mb, data.max_total_mb
    db.commit()
    return _panel_settings(db)


@router.patch("/api/superuser/{token}/settings/sign-in", response_model=PanelSettings)
def save_sign_in(data: SignInIn, _user: User = Depends(require_superuser_panel_write),
                 db: Session = Depends(get_db)):
    _check_range(data.pin_minutes, *RANGES["pin_minutes"], "A PIN lasts from {} to {} minutes.".format(
        *RANGES["pin_minutes"]))
    _check_range(data.pin_requests_per_hour, *RANGES["pin_requests_per_hour"],
                 "PIN requests per hour must be from {} to {}.".format(*RANGES["pin_requests_per_hour"]))
    _check_range(data.pin_failures_per_hour, *RANGES["pin_failures_per_hour"],
                 "Wrong PIN tries per hour must be from {} to {}.".format(*RANGES["pin_failures_per_hour"]))
    if data.longest_sign_in_days not in SIGN_IN_DAYS:
        _bad("The longest sign-in is 1, 7 or 30 days.")
    row = get_row(db)
    row.pin_minutes, row.pin_requests_per_hour = data.pin_minutes, data.pin_requests_per_hour
    row.pin_failures_per_hour, row.longest_sign_in_days = data.pin_failures_per_hour, data.longest_sign_in_days
    db.commit()
    return _panel_settings(db)


# --- Send test email (D9, D9a) ------------------------------------------------------

class _Attempt:
    """One test. Whoever settles it first (the thread with its result, or the
    endpoint with the 20 s answer) records the outcome; the other is dropped."""

    def __init__(self, fp: str):
        self.fp = fp
        self._lock = threading.Lock()
        self.result: EmailTestResult | None = None

    def settle(self, ok: bool, message: str) -> EmailTestResult:
        with self._lock:
            if self.result is not None:
                return self.result
            self.result = EmailTestResult(ok=ok, message=message)
        _record_test(self.fp, ok, message)
        return self.result


def _record_test(fp: str, ok: bool, message: str) -> None:
    """D9a: the latest test, and the card's test when it tested the settings
    saved at this moment (so a save made while the test ran counts)."""
    secret = settings.secret_key
    with SessionLocal() as db:
        row = _locked_row(db)
        at = datetime.now(timezone.utc)
        row.test_fp, row.test_at, row.test_ok, row.test_message = fp, at, ok, message
        if fp == _saved_fingerprint(row, secret):
            row.card_test_at, row.card_test_ok, row.card_test_message = at, ok, message
        db.commit()


def _test_message(sender: str, recipient: str) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = "Test email from Mathion"
    msg["From"] = sender
    msg["To"] = recipient
    msg.set_content("This is a test from the Settings page of your Mathion server. "
                    "Email from Mathion reaches this inbox.\n")
    return msg


def _run_test(attempt: _Attempt, data: EmailTestIn, password: str, recipient: str) -> None:
    try:
        mailer = SMTPMailer(data.host, data.port, data.encryption, data.username, password,
                            verify_cert=not data.skip_cert_check, timeout=SMTP_TIMEOUT_SECONDS)
        try:
            with mailer.session():
                mailer.send(_test_message(data.from_address, recipient))
        except SMTP_FAILURES as exc:
            failure = describe(exc, host=data.host, port=data.port, sender=data.from_address,
                               recipient=recipient, encryption=data.encryption, timeout=SMTP_TIMEOUT_SECONDS)
            logger.info("settings: test email failed: %s", failure.text())
            attempt.settle(False, failure.sentence)
            return
        except Exception as exc:
            # Not the mail server's: still logged by class only, since smtplib's
            # own errors (an encoding one, say) can quote the password.
            logger.warning("settings: test email failed (%s)", type(exc).__name__)
            attempt.settle(False, f"Sending failed ({type(exc).__name__}).")
            return
        attempt.settle(True, f"Sent to {recipient}: check your inbox.")
    except Exception:
        logger.exception("settings: recording the test email's outcome failed")
    finally:
        _TEST_LOCK.release()


@router.post("/api/superuser/{token}/settings/email/test", response_model=EmailTestResult)
def test_email(data: EmailTestIn, user: User = Depends(require_superuser_panel_write),
               db: Session = Depends(get_db)):
    secret = settings.secret_key
    password = _check_email(data, get_row(db), secret)
    fp = _fingerprint(data.host, data.port, data.encryption, data.skip_cert_check, data.username,
                      password, data.from_address, secret)
    recipient = user.email
    db.commit()  # hold no lock on the settings row while the test runs
    if not _TEST_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail=_TEST_RUNNING)
    attempt = _Attempt(fp)
    try:
        thread = threading.Thread(target=_run_test, args=(attempt, data, password, recipient),
                                  name="mathion-test-email", daemon=True)
        thread.start()
    except BaseException:
        _TEST_LOCK.release()
        raise
    # A thread can't be cancelled: smtplib's timeout stops it. The answer
    # gives up at 20 s, and a late result from the thread is dropped (D9).
    thread.join(TEST_WAIT_SECONDS)
    timeout = describe(TimeoutError(), host=data.host, port=data.port, sender=data.from_address,
                       recipient=recipient, encryption=data.encryption, timeout=SMTP_TIMEOUT_SECONDS)
    return attempt.settle(False, timeout.sentence)
