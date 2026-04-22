from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from sqlalchemy import select

from mathion.auth import destroy_session, request_pin, verify_pin
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models_auth import User
from mathion.schemas import PinRequestSchema, PinVerifySchema, UserResponse, UserUpdate

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/request-pin")
def api_request_pin(data: PinRequestSchema, db: Session = Depends(get_db)):
    request_pin(db, data.email)
    return {"message": "PIN sent"}


@router.post("/verify-pin")
def api_verify_pin(data: PinVerifySchema, response: Response, db: Session = Depends(get_db)):
    token = verify_pin(db, data.email, data.pin, data.duration_days)
    if not token:
        raise HTTPException(status_code=401, detail="Invalid or expired PIN")

    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=data.duration_days * 86400,
    )

    user = db.execute(select(User).where(User.email == data.email)).scalar_one()
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
    response: Response,
    session_token: str | None = Cookie(default=None, alias="session_token"),
    db: Session = Depends(get_db),
):
    if session_token:
        destroy_session(db, session_token)
    response.delete_cookie("session_token")
    return {"message": "Logged out"}
