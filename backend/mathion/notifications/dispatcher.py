import asyncio, fcntl, logging, smtplib
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path

from sqlalchemy import and_, not_, select
from sqlalchemy.exc import SQLAlchemyError, PendingRollbackError, NoResultFound
from sqlalchemy.orm import joinedload

from mathion.branding import load_branding
from mathion.config import settings
from mathion.database import SessionLocal
from mathion.models import Course, CourseAdmin, Run, CourseVersion, MiniProject, Submission
from mathion.models_auth import User, NotificationLogEntry, SiteSettings

from mathion.site_settings import get_row, load as load_site

from .errors import classify
from .mailer import DEV_MODES, build_mailer
from .smtp_errors import SMTP_FAILURES, SmtpFailure, describe, stops_the_batch
from .templates import render, _build_email_message, RenderContext, COURSE_ADMIN_ASSIGNED


logger = logging.getLogger("mathion.notifications")


def acquire_singleton_lock(settings):
    """Fail loud if another process holds the lock.

    Returns the open fd; caller releases it explicitly (more reliable than
    atexit, which may not fire on SIGKILL/OOM — kernel cleanup releases the
    flock there). The try/finally + success flag guards against fd leaks if
    fcntl.flock raises ANY exception other than BlockingIOError (e.g. OSError
    from stale NFS, EBADF, EINTR on uncommon kernels)."""
    lock_path = Path(settings.dispatcher_lock_path)
    fd = open(lock_path, "w")
    success = False
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError(
                f"Another Mathion dispatcher process holds {lock_path}. "
                "Mathion does not support multi-worker dispatchers yet. "
                "Run with --workers 1 or stop the other process."
            )
        success = True
        return fd
    finally:
        if not success:
            fd.close()


BATCH_SIZE = 20                                # inlined (was env var in rev 1)
MAX_ATTEMPTS = 5                               # inlined
BACKOFF_SECONDS = [300, 1800, 7200, 21600]     # inlined: 5m, 30m, 2h, 6h (4 entries == MAX_ATTEMPTS - 1)


def skip_reason(db, row: NotificationLogEntry) -> str | None:
    """Why a queued row should not be sent any more, or None (D5).

    Only the course-admin email is checked: it reads the course's current state
    at send time, so a replaced admin, a disabled account or a deleted course
    gets no mail."""
    if row.kind != COURSE_ADMIN_ASSIGNED:
        return None
    course = db.get(Course, (row.payload or {}).get("course_id"))
    if course is None:
        return "course gone"
    user = db.get(User, row.user_id)
    if user is None or user.is_disabled:
        return "recipient disabled"
    is_admin = db.execute(
        select(CourseAdmin.id).where(CourseAdmin.course_id == course.id,
                                     CourseAdmin.user_id == row.user_id)
    ).first()
    if is_admin is None:
        return "no longer admin"
    return None


def _build_render_context(db, row: NotificationLogEntry, site_name: str = "Mathion") -> RenderContext:
    payload = row.payload or {}
    if row.kind == COURSE_ADMIN_ASSIGNED:
        course = db.get(Course, payload["course_id"])
        if course is None:
            raise LookupError(f"referent missing: course:{payload['course_id']}")
        user = db.get(User, row.user_id)
        if user is None:
            raise LookupError(f"referent missing: user:{row.user_id}")
        return RenderContext(user=user, base_url=settings.base_url, course=course, site_name=site_name)
    if "run_id" not in payload:
        raise KeyError(f"payload missing run_id for kind={row.kind!r}")

    # (1) Run — eager-load the version+course chain so the @property doesn't fan out.
    run = db.execute(
        select(Run)
        .options(joinedload(Run.version).joinedload(CourseVersion.course))
        .where(Run.id == payload["run_id"])
    ).scalar_one_or_none()
    if run is None:
        raise LookupError(f"referent missing: run:{payload['run_id']}")

    # (2) User — the recipient.
    user = db.get(User, row.user_id)
    if user is None:
        raise LookupError(f"referent missing: user:{row.user_id}")

    # (3) MiniProject if present in payload.
    mp = None
    if "mini_project_id" in payload:
        mp = db.execute(
            select(MiniProject)
            .options(joinedload(MiniProject.block))
            .where(MiniProject.id == payload["mini_project_id"])
        ).scalar_one_or_none()
        if mp is None:
            raise LookupError(f"referent missing: mini_project:{payload['mini_project_id']}")

    # (4) Submission if present in payload.
    sub = None
    if "submission_id" in payload:
        sub = db.get(Submission, payload["submission_id"])
        if sub is None:
            raise LookupError(f"referent missing: submission:{payload['submission_id']}")

    return RenderContext(user=user, run=run, base_url=settings.base_url, mp=mp, sub=sub, site_name=site_name)


@dataclass
class TickResult:
    processed: int = 0
    sent: int = 0
    failure: SmtpFailure | None = None  # D9c: a failure on the server's side stopped the batch
    refused: SmtpFailure | None = None  # D9c, extended: a message was refused after the body


def off_interval_for(view) -> tuple[datetime, datetime | None] | None:
    """D10a: `[email_off_at, email_on_at)`, or None when there is none (a
    copied "on" has both times NULL)."""
    if view.email_off_at is None:
        return None
    return (view.email_off_at, view.email_on_at)


def _where(mailer, view=None) -> dict:
    """What `describe` says a failure was about: the saved settings when the
    loop has them, else the mailer's own."""
    if view is not None:
        return dict(host=view.smtp_host, port=view.smtp_port, sender=view.email_from,
                    encryption=view.smtp_encryption, timeout=getattr(mailer, "timeout", 20))
    return dict(host=getattr(mailer, "host", ""), port=getattr(mailer, "port", 0),
                sender=getattr(mailer, "sender", ""), encryption=getattr(mailer, "encryption", ""),
                timeout=getattr(mailer, "timeout", 20))


def _charge(db, row_id: int, send_exc: BaseException, failure: SmtpFailure | None,
            now: datetime) -> None:
    """Charge one failed message: a retry with its back-off, or a permanent
    error. A mail-server failure is stored and logged only as its class, code
    and sentence (D9b: servers can echo credentials); Mathion's own errors (a
    missing referent) keep their text."""
    db.rollback()                       # clear any partial in-memory state
    row_db = db.get(NotificationLogEntry, row_id)
    if row_db is None:
        return                          # row was deleted; skip
    row_db.retry_count = (row_db.retry_count or 0) + 1

    kind = classify(send_exc)
    exhausted = row_db.retry_count >= MAX_ATTEMPTS
    if kind == 'permanent' or exhausted:
        error_msg = failure.text() if failure is not None else str(send_exc)[:500]
        if exhausted and kind != 'permanent':
            row_db.error = f"max attempts: {error_msg[:480]}"
        else:
            row_db.error = error_msg
        row_db.next_attempt_at = None
        logger.warning("notification id=%s flagged permanently: %s",
                       row_db.id, row_db.error)
        if failure is None:
            # Full exception for operator (logs only, never DB).
            logger.exception("notification id=%s permanent-error detail", row_db.id, exc_info=send_exc)
    else:
        idx = min(row_db.retry_count - 1, len(BACKOFF_SECONDS) - 1)
        row_db.next_attempt_at = now + timedelta(seconds=BACKOFF_SECONDS[idx])
    try:
        db.commit()
    except SQLAlchemyError:
        logger.exception("commit failed updating retry state: id=%s", row_db.id)
        db.rollback()


def refusal_on_card(send_exc: BaseException, failure: SmtpFailure | None, sender: str) -> SmtpFailure | None:
    """D9c, extended (user 2026-11-05): a 5xx refusal after the message body,
    as the Email card says it. Microsoft 365 refuses a From the login may not
    send as only here; each such message is retried on its own (`classify`)."""
    if (failure is None or not isinstance(send_exc, smtplib.SMTPDataError)
            or failure.code is None or not 500 <= failure.code <= 599):
        return None
    return SmtpFailure(failure.cls, failure.code,
                       f"The mail server refused a message: check that the login may send as {sender}.", False)


def _run(db, mailer, *, now: datetime, off_interval=None, log_failures: bool = True,
         view=None, site_name: str = "Mathion") -> TickResult:
    """One batch. Each row's success-path and error-path commit are wrapped in
    separate try blocks with explicit rollback on commit failure, so a poisoned
    session never blocks the batch.

    `off_interval` (D10a) leaves out rows born while email was off. A failure
    on the mail server's side (D9c) stops the batch without charging any
    message and comes back in the result; `log_failures` logs it here (direct
    `tick()` callers), otherwise the loop logs it once per change (D9d)."""
    query = (
        select(NotificationLogEntry)
        .where(NotificationLogEntry.sent_at.is_(None))
        .where(NotificationLogEntry.error.is_(None))
        .where((NotificationLogEntry.next_attempt_at.is_(None)) |
               (NotificationLogEntry.next_attempt_at <= now))
    )
    if off_interval is not None and off_interval[0] is not None:
        off_at, on_at = off_interval
        born_off = NotificationLogEntry.created_at >= off_at
        if on_at is not None:
            born_off = and_(born_off, NotificationLogEntry.created_at < on_at)
        # created_at is the transaction's start, so a row begun while off and
        # committed after the turn-on is left out too. After a later turn-off
        # (on_at < off_at) this excludes nothing.
        query = query.where(not_(born_off))
    rows = db.execute(
        query.order_by(NotificationLogEntry.created_at.asc(),
                       NotificationLogEntry.id.asc())  # PK tie-breaker for stable ordering
        .limit(BATCH_SIZE)
    ).scalars().all()

    result = TickResult()
    if not rows:
        return result

    # Acquire SMTP session for the whole batch. If acquisition itself fails
    # (server down, AUTH error, TLS, an unreadable password), it is the server's
    # side (D9c): return without touching row state, so these failures do NOT
    # consume per-row retry budget.
    #
    # Defensive __exit__ call: SMTPMailer.session() today is a @contextmanager
    # generator whose try/finally cleans up on __enter__ failure (the exception
    # unwinds through the generator). But the Mailer.session() ABC is typed
    # AbstractContextManager[None] — a future class-based Mailer subclass with
    # an __enter__ that raises mid-init would NOT have Python call __exit__ on
    # it (the `with`-statement contract). Explicit __exit__ here is the belt-
    # and-suspenders for that future case.
    session_cm = None
    try:
        session_cm = mailer.session()
        session_cm.__enter__()
    except Exception as session_exc:
        if session_cm is not None:
            try:
                session_cm.__exit__(type(session_exc), session_exc, session_exc.__traceback__)
            except Exception:
                # No exc_info: the cleanup error can carry the server's reply (D9b).
                logger.warning("notifications: session __exit__ raised during acquire-failure cleanup")
        failure = describe(session_exc, recipient="", **_where(mailer, view))
        result.failure = SmtpFailure(failure.cls, failure.code, failure.sentence, True)
        if log_failures:
            logger.warning("notifications: failed to acquire mailer session (%s rows queued): %s",
                           len(rows), result.failure.text())
        return result

    try:
        for row in rows:
            result.processed += 1
            # D5: a row that should no longer be sent is closed here, not via
            # the error path (no retry count, no "flagged permanently" warning).
            try:
                reason = skip_reason(db, row)
            except SQLAlchemyError:
                logger.exception("skip check failed (will retry): id=%s", row.id)
                db.rollback()
                continue
            if reason is not None:
                row.error = f"skipped: {reason}"
                try:
                    db.commit()
                    logger.info("notification id=%s skipped: %s", row.id, reason)
                except SQLAlchemyError:
                    logger.exception("commit failed marking skip (will retry): id=%s", row.id)
                    db.rollback()
                continue
            send_exc: BaseException | None = None
            recipient = ""
            try:
                ctx = _build_render_context(db, row, site_name)
                recipient = ctx.user.email or ""
                subject, body = render(row.kind, ctx)
                msg = _build_email_message(subject, body, ctx, kind=row.kind, sender=mailer.sender)
                mailer.send(msg)
            except Exception as exc:
                send_exc = exc

            if send_exc is None:
                # Success branch — stamp sent_at + commit; on commit failure
                # rollback and treat as transient (row stays unsent, retried next tick).
                row.sent_at = now
                try:
                    db.commit()
                    result.sent += 1
                except SQLAlchemyError as cexc:
                    logger.exception("commit failed after successful send (will retry): id=%s", row.id)
                    db.rollback()
                    # We can't un-send the email; on next tick we re-claim and re-send (at-least-once).
                    # Leave row's in-memory state to be expired by the rollback.
                continue

            failure = (describe(send_exc, recipient=recipient, **_where(mailer, view))
                       if isinstance(send_exc, SMTP_FAILURES) else None)
            if failure is not None and stops_the_batch(send_exc):
                # D9c: the server's side (login, TLS, the sender, the password).
                # No message is charged; the loop retries after its back-off.
                db.rollback()
                result.processed -= 1
                result.failure = failure
                if log_failures:
                    logger.warning("notifications: sending stopped (%s): %s", row.id, failure.text())
                break

            # Error branch — failure path.
            result.refused = refusal_on_card(send_exc, failure, _where(mailer, view)["sender"]) or result.refused
            _charge(db, row.id, send_exc, failure, now)
            if isinstance(send_exc, smtplib.SMTPServerDisconnected):
                # D9c: a disconnect mid-batch is charged to the message being
                # sent and ends the batch, so the ones after it aren't charged.
                break
    finally:
        try:
            session_cm.__exit__(None, None, None)
        except Exception:
            logger.exception("notifications: session close raised (ignored)")
    return result


def tick(db, mailer, *, now: datetime, off_interval=None) -> int:
    """Run one dispatch tick with this mailer. Returns rows processed. With no
    `off_interval` it behaves as before the panel's Settings (D10's seam)."""
    return _run(db, mailer, now=now, off_interval=off_interval).processed


BACKOFF_FIRST_MINUTES = 5    # D9c: after a failure on the server's side, wait
BACKOFF_MAX_MINUTES = 60     # 5 min, doubling up to an hour


# What the tick's mailer was built from, and the failure state it read: a
# panel save that changed any of these during the attempt wins over the tick.
_TICK_FIELDS = ("email_on", "smtp_host", "smtp_port", "smtp_encryption", "smtp_skip_cert_check",
                "smtp_username", "smtp_password_sealed", "email_from",
                "send_failure_message", "send_failure_at", "send_retry_at", "send_backoff_step")


def _fresh_row(db, view):
    """The settings row, locked and re-read; None when a save changed it since
    `view` was loaded."""
    db.commit()  # end the tick's transaction, so the read below is fresh
    get_row(db)
    row = db.execute(select(SiteSettings).where(SiteSettings.id == 1).with_for_update()
                     .execution_options(populate_existing=True)).scalar_one()
    if any(getattr(row, f) != getattr(view, f) for f in _TICK_FIELDS):
        db.rollback()
        return None
    return row


def _record(db, view, result: TickResult, now: datetime) -> None:
    """D9c, D9d: store a failure on the server's side with its back-off, or
    clear the stored one after a successful send."""
    if result.failure is not None:
        row = _fresh_row(db, view)
        if row is None:
            return
        sentence = result.failure.sentence
        if row.send_failure_message != sentence:
            logger.warning("notifications: sending is failing: %s", result.failure.text())
            row.send_failure_at = now
        row.send_failure_message = sentence
        step = row.send_backoff_step or 0
        wait = min(BACKOFF_FIRST_MINUTES * 2 ** min(step, 6), BACKOFF_MAX_MINUTES)
        row.send_retry_at = now + timedelta(minutes=wait)
        row.send_backoff_step = min(step + 1, 6)
        db.commit()
    elif result.sent:
        _clear_failure(db, view)
    elif result.refused is not None:
        # Refusals and nothing through: the card says so, the queue goes on.
        record_send_outcome(db, view, result.refused, now)


def _clear_failure(db, view) -> None:
    """A message went out, so the server works: drop the stored failure and
    the back-off."""
    if view.send_failure_message is None and view.send_retry_at is None and not view.send_backoff_step:
        return
    row = _fresh_row(db, view)
    if row is None:
        return
    row.send_failure_message = row.send_failure_at = row.send_retry_at = None
    row.send_backoff_step = 0
    db.commit()


def record_send_outcome(db, view, failure: SmtpFailure | None, now: datetime) -> None:
    """A send outside the queue (the login PIN, whole-branch review): a
    failure on the server's side shows on the Email card, without starting
    the queue's back-off; a sent message clears a stored failure."""
    if failure is None:
        _clear_failure(db, view)
        return
    row = _fresh_row(db, view)
    if row is None:
        return
    if row.send_failure_message != failure.sentence:
        logger.warning("notifications: sending is failing: %s", failure.text())
        row.send_failure_at = now
    row.send_failure_message = failure.sentence
    db.commit()


def _tick_once(app_state, now: datetime) -> int:
    """One turn of the loop (D10's seam): read the mode and the saved settings,
    build the mailer, pass `tick` the off interval, keep the back-off."""
    s = app_state.settings
    # Branding D3, D13: the site name, once per tick, before this tick's own
    # session takes a connection. The read never fails.
    site_name = load_branding().name
    with SessionLocal() as db:
        if s.email_mode in DEV_MODES:
            # D10c: a developer outbox ignores the switch and the off interval.
            return _run(db, app_state.mailer, now=now, site_name=site_name).processed
        view = load_site(db)
        if not view.email_on:
            return 0  # D10a: while email is off, nothing is sent and nothing is marked
        if view.send_retry_at is not None and now < view.send_retry_at:
            return 0  # D9c: backing off after a failure on the server's side
        mailer = build_mailer(view, s.secret_key, s.email_mode)
        if mailer is None:
            return 0
        result = _run(db, mailer, now=now, off_interval=off_interval_for(view), log_failures=False, view=view,
                      site_name=site_name)
        _record(db, view, result, now)
        return result.processed


SHUTDOWN_TIMEOUT_SECONDS = 30
TICK_SLEEP_SECONDS = 30


async def run_forever(app):
    """Lifespan-launched loop. Wraps the sync tick() in asyncio.to_thread so
    smtplib does not block the FastAPI event loop."""
    shutdown: asyncio.Event = app.state.shutdown
    while not shutdown.is_set():
        try:
            await asyncio.to_thread(_tick_once, app.state, datetime.now(timezone.utc))
        except Exception:
            logger.exception("dispatcher tick failed; continuing")
        try:
            await asyncio.wait_for(shutdown.wait(), timeout=TICK_SLEEP_SECONDS)
        except asyncio.TimeoutError:
            pass
