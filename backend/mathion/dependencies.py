from fastapi import Cookie, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from mathion.auth import validate_session
from mathion.database import get_db
from mathion.models_auth import User


def get_current_user(
    request: Request,
    session_token: str | None = Cookie(default=None, alias="session_token"),
    db: Session = Depends(get_db),
) -> User:
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        if request.headers.get("X-Requested-With") != "mathion":
            raise HTTPException(status_code=403, detail="Missing CSRF header")

    if not session_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user = validate_session(db, session_token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    return user


def get_optional_user(
    request: Request,
    session_token: str | None = Cookie(default=None, alias="session_token"),
    db: Session = Depends(get_db),
) -> User | None:
    if not session_token:
        return None
    return validate_session(db, session_token)


def require_superuser(user: User = Depends(get_current_user)) -> User:
    if not user.is_superuser:
        raise HTTPException(status_code=403, detail="Superuser access required")
    return user
