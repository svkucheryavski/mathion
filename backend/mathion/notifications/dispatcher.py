import asyncio, fcntl, logging, smtplib
from datetime import datetime, timezone, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError, PendingRollbackError, NoResultFound
from sqlalchemy.orm import joinedload

from mathion.config import settings
from mathion.database import SessionLocal
from mathion.models import Run, CourseVersion, MiniProject, Submission
from mathion.models_auth import User, NotificationLogEntry

from .errors import classify
from .templates import render, _build_email_message, RenderContext


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
        except BlockingIOError as exc:
            raise RuntimeError(
                f"Another Mathion dispatcher process holds the lock at "
                f"{lock_path}. Set MATHION_DISPATCHER_LOCK_PATH per-process or "
                f"run uvicorn with a single worker."
            ) from exc
        success = True
        return fd
    finally:
        if not success:
            fd.close()


BATCH_SIZE = 20                                # inlined (was env var in rev 1)
MAX_ATTEMPTS = 5                               # inlined
BACKOFF_SECONDS = [300, 1800, 7200, 21600]     # inlined: 5m, 30m, 2h, 6h (4 entries == MAX_ATTEMPTS - 1)


def _build_render_context(db, row: NotificationLogEntry) -> RenderContext:
    payload = row.payload or {}
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

    return RenderContext(user=user, run=run, base_url=settings.base_url, mp=mp, sub=sub)


def tick(db, mailer, *, now: datetime) -> int:
    """Run one dispatch tick. Returns rows processed. Each row's success-path
    and error-path commit are wrapped in separate try blocks with explicit
    rollback on commit failure, so a poisoned session never blocks the batch."""
    rows = db.execute(
        select(NotificationLogEntry)
        .where(NotificationLogEntry.sent_at.is_(None))
        .where(NotificationLogEntry.error.is_(None))
        .where((NotificationLogEntry.next_attempt_at.is_(None)) |
               (NotificationLogEntry.next_attempt_at <= now))
        .order_by(NotificationLogEntry.created_at.asc(),
                  NotificationLogEntry.id.asc())  # PK tie-breaker for stable ordering
        .limit(BATCH_SIZE)
    ).scalars().all()

    if not rows:
        return 0

    # Acquire SMTP session for the whole batch. If acquisition itself fails
    # (server down, AUTH error, network unreachable), log structured warning
    # and return without touching row state — these failures are infrastructure-
    # level, not per-message, so they should NOT consume per-row retry budget.
    # The dispatcher loop will retry on next tick at its normal cadence.
    #
    # Defensive __exit__ call: SMTPMailer.session() today is a @contextmanager
    # generator whose try/finally cleans up on __enter__ failure (the exception
    # unwinds through the generator). But the Mailer.session() ABC is typed
    # AbstractContextManager[None] — a future class-based Mailer subclass with
    # an __enter__ that raises mid-init would NOT have Python call __exit__ on
    # it (the `with`-statement contract). Explicit __exit__ here is the belt-
    # and-suspenders for that future case.
    session_cm = mailer.session()
    try:
        session_cm.__enter__()
    except Exception as session_exc:
        try:
            session_cm.__exit__(type(session_exc), session_exc, session_exc.__traceback__)
        except Exception:
            logger.exception("notifications: session __exit__ raised during acquire-failure cleanup")
        logger.warning("notifications: failed to acquire mailer session (%s rows queued): %s",
                       len(rows), session_exc)
        return 0

    processed = 0
    try:
        for row in rows:
            processed += 1
            send_exc: BaseException | None = None
            try:
                ctx = _build_render_context(db, row)
                subject, body = render(row.kind, ctx)
                msg = _build_email_message(subject, body, ctx, kind=row.kind)
                mailer.send(msg)
            except Exception as exc:
                send_exc = exc

            if send_exc is None:
                # Success branch — stamp sent_at + commit; on commit failure
                # rollback and treat as transient (row stays unsent, retried next tick).
                row.sent_at = now
                try:
                    db.commit()
                except SQLAlchemyError as cexc:
                    logger.exception("commit failed after successful send (will retry): id=%s", row.id)
                    db.rollback()
                    # We can't un-send the email; on next tick we re-claim and re-send (at-least-once).
                    # Leave row's in-memory state to be expired by the rollback.
                continue

            # Error branch — failure path. Increment counters separately.
            db.rollback()                       # clear any partial in-memory state
            row_db = db.get(NotificationLogEntry, row.id)
            if row_db is None: continue          # row was deleted; skip
            row_db.retry_count = (row_db.retry_count or 0) + 1

            kind = classify(send_exc)
            exhausted = row_db.retry_count >= MAX_ATTEMPTS
            if kind == 'permanent' or exhausted:
                # Redact SMTPAuthenticationError messages — some servers echo
                # the username (or worse, parts of the password) in the 535
                # response body. Operator gets the full exception via
                # logger.exception below; the DB just gets a safe sentinel.
                if isinstance(send_exc, smtplib.SMTPAuthenticationError):
                    error_msg = "SMTP authentication failed (see operator logs)"
                else:
                    error_msg = str(send_exc)[:500]
                if exhausted and kind != 'permanent':
                    row_db.error = f"max attempts: {error_msg[:480]}"
                else:
                    row_db.error = error_msg
                row_db.next_attempt_at = None
                logger.warning("notification id=%s flagged permanently: %s",
                               row_db.id, row_db.error)
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
    finally:
        try:
            session_cm.__exit__(None, None, None)
        except Exception:
            logger.exception("notifications: session close raised (ignored)")
    return processed
