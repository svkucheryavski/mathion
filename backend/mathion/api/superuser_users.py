"""The superuser panel's Users page (spec D14-D21).

Every route sits behind the panel token (`require_superuser_panel`); writes
also need the CSRF header (`require_superuser_panel_write`). An account that
is gone answers 409, never 404: the panel's 404 means only "link expired"
(D25). A superuser account can't be disabled, deleted or given a new email
here (D21); superuser rights come only from the server command.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, delete, exists, func, or_, select, true, union
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from mathion.api.superuser import require_superuser_panel, require_superuser_panel_write
from mathion.database import get_db
from mathion.models import (
    Asset, Course, CourseAdmin, CourseVersion, Evaluation, Run, RunAsset, RunStudent, RunTeacher, Submission,
)
from mathion.models_auth import LoginPIN, Session, StudentEnrollment, User, UserItemState
from mathion.schemas import (
    PanelCourseRef, PanelRunRef, PanelUser, PanelUserCounts, PanelUserCreate, PanelUserList, PanelUserRole,
    PanelUserUpdate,
)

router = APIRouter(tags=["superuser"])

_GONE = "This account was deleted"
_SUPERUSER = "A superuser account can't be changed here"
_EXISTS = "An account with this email already exists"
_TAKEN = "Another account already uses this email"
_HAS_DATA = "This account has data and can only be disabled"
_LIMIT = 20  # D15: no pages

_ROLE = {
    "admins": exists().where(CourseAdmin.user_id == User.id),
    "teachers": exists().where(RunTeacher.user_id == User.id),
    "students": exists().where(RunStudent.user_id == User.id),
    "disabled": User.is_disabled.is_(True),
}


def _users_with_data(db: DBSession, ids: list[int]) -> set[int]:
    """D20: the accounts among `ids` that any blocking reference points to.
    sessions, login_pins and notification_log don't block (they go with the
    account); runs.created_by and the two uploaded_by are stricter than the
    database needs, so authorship is never lost."""
    if not ids:
        return set()
    refs = [
        CourseAdmin.user_id, RunTeacher.user_id, RunStudent.user_id, StudentEnrollment.user_id,
        UserItemState.user_id, Submission.submitted_by, Evaluation.evaluated_by,
        Run.created_by, Asset.uploaded_by, RunAsset.uploaded_by,
    ]
    q = union(*(select(col.label("uid")).where(col.in_(ids)) for col in refs))
    return set(db.scalars(q).all())


def _has_data(db: DBSession, user_id: int) -> bool:
    return user_id in _users_with_data(db, [user_id])


def _rows(db: DBSession, users: list[User]) -> list[PanelUser]:
    """One PanelUser per account, with grouped queries (no per-row queries)."""
    ids = [u.id for u in users]
    admin_of: dict[int, list[PanelCourseRef]] = {i: [] for i in ids}
    teacher_runs: dict[int, list[PanelRunRef]] = {i: [] for i in ids}
    student_runs: dict[int, list[PanelRunRef]] = {i: [] for i in ids}
    with_data: set[int] = set()
    if ids:
        for uid, cid, name in db.execute(
            select(CourseAdmin.user_id, Course.id, Course.name).join(Course, Course.id == CourseAdmin.course_id)
            .where(CourseAdmin.user_id.in_(ids)).order_by(func.lower(Course.name), Course.id)
        ).all():
            admin_of[uid].append(PanelCourseRef(id=cid, name=name))
        for link, into in ((RunTeacher, teacher_runs), (RunStudent, student_runs)):
            for uid, rid, title, course_name in db.execute(
                select(link.user_id, Run.id, Run.title, Course.name)
                .join(Run, Run.id == link.run_id)
                .join(CourseVersion, CourseVersion.id == Run.version_id)
                .join(Course, Course.id == CourseVersion.course_id)
                .where(link.user_id.in_(ids))
                .order_by(func.lower(Course.name), func.lower(Run.title), Run.id)
            ).all():
                into[uid].append(PanelRunRef(id=rid, title=title, course_name=course_name))
        with_data = _users_with_data(db, ids)
    return [
        PanelUser(
            id=u.id, email=u.email, full_name=u.full_name, is_superuser=u.is_superuser,
            is_disabled=u.is_disabled, created_at=u.created_at, last_seen_at=u.last_seen_at,
            admin_of=admin_of[u.id], teacher_runs=teacher_runs[u.id],
            student_runs=student_runs[u.id], has_data=u.id in with_data,
        )
        for u in users
    ]


def _locked_user(db: DBSession, user_id: int) -> User:
    # The row lock serialises panel writes on one account. It also closes the
    # sign-in race for disable and email change: verify_pin and the throttled
    # session bump write users.last_seen_at first, so a sign-in in flight
    # either commits before this lock (its session is then seen and deleted)
    # or waits behind it. After an email change the waiting sign-in finds its
    # PIN gone and fails; after a disable it may still add a session, which
    # validate_session rejects and deletes because the account is disabled.
    user = db.execute(select(User).where(User.id == user_id).with_for_update()).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=409, detail=_GONE)
    return user


def _refuse_superuser(user: User) -> None:
    if user.is_superuser:
        raise HTTPException(status_code=403, detail=_SUPERUSER)


def _end_sessions(db: DBSession, user_id: int) -> None:
    # In the caller's transaction; invalidate_all_sessions commits on its own (D18).
    db.execute(delete(Session).where(Session.user_id == user_id))


def _email_taken(db: DBSession, email: str, other_than: int | None = None) -> bool:
    q = select(User.id).where(User.email == email)
    if other_than is not None:
        q = q.where(User.id != other_than)
    return db.scalar(q) is not None


@router.get("/api/superuser/{token}/users", response_model=PanelUserList)
def list_users(q: str = "", role: PanelUserRole = Query("all"),
               _user: User = Depends(require_superuser_panel), db: DBSession = Depends(get_db)):
    conds = []
    if role != "all":
        conds.append(_ROLE[role])
    q = q.strip()
    if q:
        # D15a: `%`, `_` and the escape character itself match literally.
        p = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        conds.append(or_(User.email.ilike(p, escape="\\"), User.full_name.ilike(p, escape="\\")))
    where = and_(true(), *conds)
    users = db.execute(
        select(User).where(where).order_by(User.created_at.desc(), User.id.desc()).limit(_LIMIT)
    ).scalars().all()
    count = lambda cond: db.scalar(select(func.count()).select_from(User).where(cond))  # noqa: E731
    return PanelUserList(
        users=_rows(db, list(users)),
        total=count(where),
        counts=PanelUserCounts(all=count(true()), **{k: count(c) for k, c in _ROLE.items()}),
    )


@router.post("/api/superuser/{token}/users", status_code=201, response_model=PanelUser)
def create_user(data: PanelUserCreate, _user: User = Depends(require_superuser_panel_write),
                db: DBSession = Depends(get_db)):
    # D17: no email is sent; the account isn't tied to anything yet.
    if _email_taken(db, data.email):
        raise HTTPException(status_code=409, detail=_EXISTS)
    try:
        with db.begin_nested():
            user = User(email=data.email, full_name=data.full_name)
            db.add(user)
            db.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=_EXISTS)
    db.commit()
    return _rows(db, [user])[0]


@router.patch("/api/superuser/{token}/users/{user_id}", response_model=PanelUser)
def update_user(user_id: int, data: PanelUserUpdate,
                _user: User = Depends(require_superuser_panel_write), db: DBSession = Depends(get_db)):
    user = _locked_user(db, user_id)
    sent = data.model_fields_set
    new_email = data.email if "email" in sent and data.email != user.email else None
    if "email" in sent:
        _refuse_superuser(user)  # D21: even re-sending the same address
    if new_email is not None and _email_taken(db, new_email, other_than=user.id):
        raise HTTPException(status_code=409, detail=_TAKEN)
    try:
        with db.begin_nested():
            if "full_name" in sent:
                user.full_name = data.full_name
            if new_email is not None:
                # D19: a mistyped address may belong to someone else, and PINs
                # are keyed by user_id, so old sessions and unused PINs go.
                user.email = new_email
                db.flush()
                db.execute(delete(LoginPIN).where(LoginPIN.user_id == user.id, LoginPIN.is_used.is_(False)))
                _end_sessions(db, user.id)
            db.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=_TAKEN)
    db.commit()
    return _rows(db, [user])[0]


@router.post("/api/superuser/{token}/users/{user_id}/disable", response_model=PanelUser)
def disable_user(user_id: int, _user: User = Depends(require_superuser_panel_write),
                 db: DBSession = Depends(get_db)):
    # D18: the flag and the sign-out in one commit; admin and teacher rows stay.
    user = _locked_user(db, user_id)
    _refuse_superuser(user)
    user.is_disabled = True
    _end_sessions(db, user.id)
    db.commit()
    return _rows(db, [user])[0]


@router.post("/api/superuser/{token}/users/{user_id}/enable", response_model=PanelUser)
def enable_user(user_id: int, _user: User = Depends(require_superuser_panel_write),
                db: DBSession = Depends(get_db)):
    user = _locked_user(db, user_id)
    user.is_disabled = False
    db.commit()
    return _rows(db, [user])[0]


@router.delete("/api/superuser/{token}/users/{user_id}", status_code=204)
def delete_user(user_id: int, _user: User = Depends(require_superuser_panel_write),
                db: DBSession = Depends(get_db)):
    # D20: the lock comes before the check. Every blocking reference is a
    # foreign key to users.id, and inserting one takes a key-share lock on this
    # row, so a roster import or an admin assign either committed before (and
    # the check sees it) or waits and then fails on the missing account.
    user = _locked_user(db, user_id)
    _refuse_superuser(user)
    if _has_data(db, user.id):
        raise HTTPException(status_code=409, detail=_HAS_DATA)
    # Core delete: sessions, PINs and notification rows cascade in the database.
    db.execute(delete(User.__table__).where(User.__table__.c.id == user.id))
    db.commit()
