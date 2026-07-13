from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.auth import validate_session
from mathion.database import get_db
from mathion.models import Asset, Course, RunAsset, Submission
from mathion.models_auth import Session as UserSession, User
from mathion.schemas import SuperuserStatsResponse
from mathion.superuser import service as panel_service

router = APIRouter(tags=["superuser"])

_ACTIVE_24H = timedelta(hours=24)
_ACTIVE_7D = timedelta(days=7)


def require_superuser_panel(
    token: str,
    session_token: str | None = Cookie(default=None, alias="session_token"),
    db: Session = Depends(get_db),
) -> User:
    # 1. token first -> 404 on bad/expired (also bumps last_active_at).
    panel_service.validate(db, token)
    # 2. session presence -> 401.
    if not session_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = validate_session(db, session_token)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    # 3. role -> 404 (deliberately NOT 403, so normal users cannot tell the route exists).
    if not user.is_superuser:
        raise HTTPException(status_code=404, detail="Not Found")
    return user


def _count_active_since(db: Session, since: datetime) -> int:
    # SQLite drops tzinfo uniformly on store and on bind, so both the stored
    # last_active_at and this tz-aware `since` compare as naive UTC strings.
    return db.scalar(
        select(func.count(func.distinct(UserSession.user_id))).where(
            UserSession.last_active_at >= since
        )
    )


@router.get("/api/superuser/{token}/stats", response_model=SuperuserStatsResponse)
def get_superuser_stats(
    _user: User = Depends(require_superuser_panel),
    db: Session = Depends(get_db),
) -> SuperuserStatsResponse:
    total_users = db.scalar(select(func.count()).select_from(User))
    total_courses = db.scalar(select(func.count()).select_from(Course))
    asset_bytes = db.scalar(select(func.coalesce(func.sum(Asset.file_size), 0)))
    run_asset_bytes = db.scalar(select(func.coalesce(func.sum(RunAsset.file_size), 0)))
    submission_bytes = db.scalar(select(func.coalesce(func.sum(Submission.file_size), 0)))
    now = datetime.now(timezone.utc)

    return SuperuserStatsResponse(
        total_users=total_users,
        total_courses=total_courses,
        storage_bytes=asset_bytes + run_asset_bytes + submission_bytes,
        active_users_24h=_count_active_since(db, now - _ACTIVE_24H),
        active_users_7d=_count_active_since(db, now - _ACTIVE_7D),
    )
