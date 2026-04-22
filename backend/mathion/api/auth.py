from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session
from sqlalchemy import select

from mathion.auth import destroy_session, request_pin, verify_pin
from mathion.config import settings
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models_auth import User
from mathion.schemas import PinRequestSchema, PinVerifySchema, UserResponse, UserUpdate

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _require_csrf(request: Request):
    """Check CSRF header on public POST endpoints."""
    if request.headers.get("X-Requested-With") != "mathion":
        raise HTTPException(status_code=403, detail="Missing CSRF header")


@router.post("/request-pin")
def api_request_pin(request: Request, data: PinRequestSchema, db: Session = Depends(get_db)):
    _require_csrf(request)
    request_pin(db, data.email)
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
    return {"user": UserResponse.model_validate(user)}


@router.get("/me", response_model=UserResponse)
def get_profile(user: User = Depends(get_current_user)):
    return user


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
