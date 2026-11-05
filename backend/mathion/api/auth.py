import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session
from sqlalchemy import exists, select

from mathion.auth import destroy_session, request_pin, validate_session, verify_pin
from mathion.config import settings
from mathion.database import SessionLocal, get_db
from mathion.dependencies import get_current_user
from mathion.models import CourseAdmin, RunTeacher
from mathion.models_auth import User
from mathion.notifications.dispatcher import record_send_outcome, refusal_on_card
from mathion.notifications.mailer import DEV_MODES, build_mailer
from mathion.notifications.smtp_errors import SMTP_FAILURES, describe, stops_the_batch
from mathion.notifications.templates import build_login_pin_message
from mathion.schemas import AuthConfigResponse, PinRequestSchema, PinVerifySchema, UserResponse, UserUpdate
from mathion.site_settings import load as load_site, password_is_readable
from mathion.superuser import service as panel_service

router = APIRouter(prefix="/api/auth", tags=["auth"])

logger = logging.getLogger(__name__)


def _user_response_with_flags(db: Session, user: User) -> UserResponse:
    """Build a UserResponse with `has_course_admin` and `has_run_teacher` populated.

    Flags are UI hints for nav rendering only. Server-side authorization is
    always re-evaluated via require_* helpers. Do NOT branch on these flags in
    any new endpoint.
    """
    has_admin = user.is_superuser or bool(db.scalar(
        select(exists().where(CourseAdmin.user_id == user.id))
    ))
    has_teacher = bool(db.scalar(
        select(exists().where(RunTeacher.user_id == user.id))
    ))
    return UserResponse.model_validate(user).model_copy(
        update={"has_course_admin": has_admin, "has_run_teacher": has_teacher}
    )


def _require_csrf(request: Request):
    """Check CSRF header on public POST endpoints."""
    if request.headers.get("X-Requested-With") != "mathion":
        raise HTTPException(status_code=403, detail="Missing CSRF header")


@router.get("/config", response_model=AuthConfigResponse)
def api_auth_config(db: Session = Depends(get_db)) -> AuthConfigResponse:
    # True whenever "Send PIN" yields a retrievable PIN: debug (console print),
    # the `file` outbox, or the panel's email switch on with a password this
    # server can read (or no login). Excludes the one-shot `memory` sink.
    # Public, no auth, no CSRF (GET), so it carries nothing beyond what the
    # login page and the upload checks need (superuser Settings D10b).
    site = load_site(db)
    panel_sends = (settings.email_mode not in DEV_MODES and site.email_on
                   and password_is_readable(site, settings.secret_key))
    return AuthConfigResponse(
        send_pin_enabled=settings.debug or settings.email_mode == "file" or panel_sends,
        longest_sign_in_days=site.longest_sign_in_days,
        max_file_mb=site.max_file_mb,
    )


def _send_login_pin(email: str, raw_pin: str, minutes: int) -> None:
    """Build a one-shot mailer from the panel's saved settings and send the
    login PIN. Best-effort: any build/send failure is caught and logged without
    the raw PIN, and a mail-server failure only as D9b's class, code and
    sentence (servers can echo credentials). This is the SOLE error boundary
    for the send after it moved off the response path. It runs as a background
    task, so it opens its own database session (D10b)."""
    mailer = site = None
    sending = False
    try:
        with SessionLocal() as db:
            site = load_site(db)
        mailer = build_mailer(site, settings.secret_key, settings.email_mode)  # one-shot
        if mailer is not None:
            msg = build_login_pin_message(email, raw_pin, minutes=minutes, sender=mailer.sender)
            with mailer.session():
                sending = True
                mailer.send(msg)
            _record_on_card(site, None)
    except SMTP_FAILURES as exc:
        failure = describe(exc, host=getattr(mailer, "host", ""), port=getattr(mailer, "port", 0),
                           sender=getattr(mailer, "sender", ""), recipient=email,
                           encryption=getattr(mailer, "encryption", ""),
                           timeout=getattr(mailer, "timeout", 20))
        logger.warning("login PIN email send failed: %s", failure.text())
        # The Email card hears about the server's side (login, TLS, the
        # sender, no answer) and a refusal after the body, not about one
        # refused recipient.
        if site is not None:
            card = (failure if not sending or stops_the_batch(exc)
                    else refusal_on_card(exc, failure, site.email_from))
            if card is not None:
                _record_on_card(site, card)
    except Exception:
        logger.exception("login PIN email send failed")  # static message; never the raw PIN


def _record_on_card(site, failure) -> None:
    """Best-effort: a failure to record never reaches the caller."""
    try:
        with SessionLocal() as db:
            record_send_outcome(db, site, failure, datetime.now(timezone.utc))
    except Exception:
        logger.exception("login PIN email: recording the outcome on the Email card failed")


@router.post("/request-pin")
def api_request_pin(
    request: Request,
    data: PinRequestSchema,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    _require_csrf(request)
    raw_pin = request_pin(db, data.email)
    # Schedule the send OFF the response path (not inline) only for a real,
    # enabled, non-rate-limited user (request_pin returned a PIN) and only when
    # debug is off. Response stays uniform regardless.
    if raw_pin is not None and not settings.debug:
        # data.email is already stripped+lowercased by PinRequestSchema.normalize_email;
        # the .strip().lower() here is belt-and-suspenders (a no-op post-schema).
        background_tasks.add_task(_send_login_pin, data.email.strip().lower(), raw_pin,
                                  load_site(db).pin_minutes)
    return {"message": "PIN sent"}


@router.post("/verify-pin")
def api_verify_pin(request: Request, data: PinVerifySchema, response: Response, db: Session = Depends(get_db)):
    _require_csrf(request)
    # D12: a longer request (a login page left open across a change) is
    # shortened to the longest, before and apart from the PIN check.
    days = min(data.duration_days, load_site(db).longest_sign_in_days)
    token = verify_pin(db, data.email, data.pin, days)
    if not token:
        raise HTTPException(status_code=401, detail="Invalid or expired PIN")

    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=days * 86400,
    )

    email = data.email.strip().lower()
    user = db.execute(select(User).where(User.email == email)).scalar_one()
    return {"user": _user_response_with_flags(db, user)}


@router.get("/me", response_model=UserResponse)
def get_profile(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UserResponse:
    return _user_response_with_flags(db, user)


@router.patch("/me", response_model=UserResponse)
def update_profile(data: UserUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    session_token: str | None = Cookie(default=None, alias="session_token"),
    db: Session = Depends(get_db),
):
    _require_csrf(request)
    if session_token:
        # Resolve the user BEFORE destroying the session, so only a superuser's
        # logout tears down the shared panel token (a normal user's must not).
        user = validate_session(db, session_token)
        if user is not None and user.is_superuser:
            panel_service.destroy_active(db)
        destroy_session(db, session_token)
    response.delete_cookie("session_token")
    return {"message": "Logged out"}
