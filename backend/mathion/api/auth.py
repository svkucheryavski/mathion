import logging

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session
from sqlalchemy import exists, select

from mathion.auth import destroy_session, request_pin, verify_pin
from mathion.config import settings
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import CourseAdmin, RunTeacher
from mathion.models_auth import User
from mathion.notifications.mailer import build_mailer_from_settings
from mathion.notifications.templates import build_login_pin_message
from mathion.schemas import AuthConfigResponse, PinRequestSchema, PinVerifySchema, UserResponse, UserUpdate

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
def api_auth_config() -> AuthConfigResponse:
    # True whenever "Send PIN" yields a retrievable PIN: debug (console print) or
    # a delivering mailer (smtp inbox / file .eml outbox). Excludes the one-shot
    # `memory` sink and `disabled`. Public, no auth, no CSRF (GET).
    return AuthConfigResponse(
        send_pin_enabled=settings.debug or settings.email_mode in ("smtp", "file")
    )


@router.post("/request-pin")
def api_request_pin(request: Request, data: PinRequestSchema, db: Session = Depends(get_db)):
    _require_csrf(request)
    raw_pin = request_pin(db, data.email)
    # Send only for a real, enabled, non-rate-limited user (request_pin returned
    # a PIN) and only when debug is off. Response stays uniform regardless.
    if raw_pin is not None and not settings.debug:
        mailer = build_mailer_from_settings(settings)  # one-shot; NOT app.state.mailer
        if mailer is not None:
            try:
                msg = build_login_pin_message(data.email.strip().lower(), raw_pin)
                with mailer.session():
                    mailer.send(msg)
            except Exception:
                logger.exception("login PIN email send failed")  # static message; never the raw PIN
    return {"message": "PIN sent"}


@router.post("/verify-pin")
def api_verify_pin(request: Request, data: PinVerifySchema, response: Response, db: Session = Depends(get_db)):
    _require_csrf(request)
    token = verify_pin(db, data.email, data.pin, data.duration_days)
    if not token:
        raise HTTPException(status_code=401, detail="Invalid or expired PIN")

    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=data.duration_days * 86400,
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
        destroy_session(db, session_token)
    response.delete_cookie("session_token")
    return {"message": "Logged out"}
