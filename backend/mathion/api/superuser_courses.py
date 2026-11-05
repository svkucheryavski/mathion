"""The superuser panel's Courses page (spec D4-D13).

Every route sits behind the panel token (`require_superuser_panel`); writes
also need the CSRF header (`require_superuser_panel_write`). A course that is
gone answers 409, never 404: the panel's 404 means only "link expired" (D25).
"""
import shutil

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.assets import _asset_dir
from mathion.api.lookups import get_or_create_user
from mathion.api.superuser import require_superuser_panel, require_superuser_panel_write
from mathion.config import settings
from mathion.database import get_db
from mathion.models import Block, Course, CourseAdmin, CourseVersion, Item, Run, RunStudent, Sequence
from mathion.models_auth import NotificationLogEntry, User, UserItemState
from mathion.notifications.templates import COURSE_ADMIN_ASSIGNED
from mathion.schemas import (
    AccountLookup, AdminAssignResult, CourseDeleteImpact, PanelAdmin, PanelCourse,
    PanelCourseCreate, PanelCourseUpdate, PanelEmail,
)
from mathion.site_settings import load as load_site

router = APIRouter(tags=["superuser"])

_GONE = "This course was deleted"
_SLUG_TAKEN = "This address is already used by another course"
_HAS_RUNS = "This course has runs and can't be deleted"
_ACCOUNT_GONE = "This account was deleted"


def email_is_set_up() -> bool:
    # D5a: "set up" means a mailer exists, the condition that starts the email
    # queue (main.py). The `memory` test sink counts on purpose. Not
    # send_pin_enabled: that is also true in debug with email off.
    return settings.email_mode != "disabled"


def _admin_email_outcome(target: User, changed: bool) -> str:
    # D5a: the first that applies wins.
    if not changed:
        return "unchanged"
    if target.is_disabled:
        return "disabled"
    if not email_is_set_up():
        return "email_off"
    return "queued"


def _locked_course(db: Session, course_id: int) -> Course:
    course = db.execute(select(Course).where(Course.id == course_id).with_for_update()).scalar_one_or_none()
    if course is None:
        raise HTTPException(status_code=409, detail=_GONE)
    return course


def _panel_admin(user: User) -> PanelAdmin:
    return PanelAdmin(id=user.id, email=user.email, full_name=user.full_name, is_disabled=user.is_disabled)


def _rows(db: Session, courses: list[Course]) -> list[PanelCourse]:
    """One PanelCourse per course, with grouped counts (no per-row queries)."""
    ids = [c.id for c in courses]
    if not ids:
        return []
    versions = dict(db.execute(
        select(CourseVersion.course_id, func.count())
        .where(CourseVersion.course_id.in_(ids)).group_by(CourseVersion.course_id)
    ).all())
    runs = dict(db.execute(
        select(CourseVersion.course_id, func.count(Run.id))
        .join(Run, Run.version_id == CourseVersion.id)
        .where(CourseVersion.course_id.in_(ids)).group_by(CourseVersion.course_id)
    ).all())
    students = dict(db.execute(
        select(CourseVersion.course_id, func.count(func.distinct(RunStudent.user_id)))
        .join(Run, Run.version_id == CourseVersion.id)
        .join(RunStudent, RunStudent.run_id == Run.id)
        .where(CourseVersion.course_id.in_(ids)).group_by(CourseVersion.course_id)
    ).all())
    admins = {cid: user for cid, user in db.execute(
        select(CourseAdmin.course_id, User).join(User, User.id == CourseAdmin.user_id)
        .where(CourseAdmin.course_id.in_(ids))
    ).all()}
    return [
        PanelCourse(
            id=c.id, name=c.name, slug=c.slug,
            admin=_panel_admin(admins[c.id]) if c.id in admins else None,
            version_count=versions.get(c.id, 0),
            run_count=runs.get(c.id, 0),
            student_count=students.get(c.id, 0),
        )
        for c in courses
    ]


def _assigned(db: Session, course: Course, target: User, changed: bool) -> AdminAssignResult:
    """Queue the admin email when it should go, commit, and say what happened (D5, D5a)."""
    outcome = _admin_email_outcome(target, changed)
    if outcome == "queued":
        db.add(NotificationLogEntry(user_id=target.id, kind=COURSE_ADMIN_ASSIGNED,
                                    payload={"course_id": course.id}))
    try:
        db.commit()
    except IntegrityError:
        # The course is locked, so the only key this can break is the admin's
        # account: a panel delete took its row lock first and committed (D20).
        db.rollback()
        raise HTTPException(status_code=409, detail=_ACCOUNT_GONE)
    return AdminAssignResult(
        course=_rows(db, [course])[0],
        admin=_panel_admin(target),
        admin_email=outcome,
        pin_minutes=load_site(db).pin_minutes,
        sign_in_url=f"{settings.base_url}/courses/{course.slug}/edit",
    )


def _slug_taken(db: Session, slug: str, other_than: int | None = None) -> bool:
    q = select(Course.id).where(Course.slug == slug)
    if other_than is not None:
        q = q.where(Course.id != other_than)
    return db.scalar(q) is not None


@router.get("/api/superuser/{token}/courses", response_model=list[PanelCourse])
def list_courses(_user: User = Depends(require_superuser_panel), db: Session = Depends(get_db)):
    courses = db.execute(select(Course).order_by(func.lower(Course.name), Course.id)).scalars().all()
    return _rows(db, list(courses))


@router.post("/api/superuser/{token}/courses", status_code=201, response_model=AdminAssignResult)
def create_course(data: PanelCourseCreate, _user: User = Depends(require_superuser_panel_write),
                  db: Session = Depends(get_db)):
    # D8: one transaction. The slug check runs first, and the insert sits in its
    # own SAVEPOINT, so a slug race is never confused with get_or_create_user's
    # recovery from a concurrent user insert.
    if _slug_taken(db, data.slug):
        raise HTTPException(status_code=409, detail=_SLUG_TAKEN)
    try:
        with db.begin_nested():
            course = Course(slug=data.slug, name=data.name, description="")
            db.add(course)
            db.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=_SLUG_TAKEN)
    target = get_or_create_user(db, data.admin_email)
    db.add(CourseAdmin(course_id=course.id, user_id=target.id))
    return _assigned(db, course, target, changed=True)


@router.patch("/api/superuser/{token}/courses/{course_id}", response_model=PanelCourse)
def update_course(course_id: int, data: PanelCourseUpdate,
                  _user: User = Depends(require_superuser_panel_write), db: Session = Depends(get_db)):
    course = _locked_course(db, course_id)
    if data.slug is not None and data.slug != course.slug and _slug_taken(db, data.slug, other_than=course.id):
        raise HTTPException(status_code=409, detail=_SLUG_TAKEN)
    try:
        with db.begin_nested():
            if data.name is not None:
                course.name = data.name
            if data.slug is not None:
                course.slug = data.slug
            db.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=_SLUG_TAKEN)
    db.commit()
    return _rows(db, [course])[0]


@router.put("/api/superuser/{token}/courses/{course_id}/admin", response_model=AdminAssignResult)
def assign_admin(course_id: int, data: PanelEmail,
                 _user: User = Depends(require_superuser_panel_write), db: Session = Depends(get_db)):
    # D6: the course row lock comes before get_or_create_user (lock before
    # index), so two assigns serialise. The admin row is updated in place: a
    # delete plus add in one flush would INSERT first and hit the unique key.
    course = _locked_course(db, course_id)
    target = get_or_create_user(db, data.email)
    row = db.execute(select(CourseAdmin).where(CourseAdmin.course_id == course.id)).scalar_one_or_none()
    changed = row is None or row.user_id != target.id
    if row is None:
        db.add(CourseAdmin(course_id=course.id, user_id=target.id))
    elif changed:
        row.user_id = target.id
    return _assigned(db, course, target, changed)


@router.delete("/api/superuser/{token}/courses/{course_id}/admin", status_code=204)
def remove_admin(course_id: int, _user: User = Depends(require_superuser_panel_write),
                 db: Session = Depends(get_db)):
    course = _locked_course(db, course_id)
    row = db.execute(select(CourseAdmin).where(CourseAdmin.course_id == course.id)).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=409, detail="This course has no admin")
    db.delete(row)
    db.commit()


@router.get("/api/superuser/{token}/courses/{course_id}/delete-impact", response_model=CourseDeleteImpact)
def delete_impact(course_id: int, _user: User = Depends(require_superuser_panel), db: Session = Depends(get_db)):
    # D12a: students' leftover progress, not counting the admin's or any
    # superuser's own preview clicks. Informs the confirm; never blocks.
    if db.get(Course, course_id) is None:
        raise HTTPException(status_code=409, detail=_GONE)
    q = (
        select(func.count(func.distinct(UserItemState.user_id)))
        .join(Item, Item.id == UserItemState.item_id)
        .join(Sequence, Sequence.id == Item.sequence_id)
        .join(Block, Block.id == Sequence.block_id)
        .join(CourseVersion, CourseVersion.id == Block.version_id)
        .join(User, User.id == UserItemState.user_id)
        .where(CourseVersion.course_id == course_id, User.is_superuser.is_(False))
    )
    admin_id = db.scalar(select(CourseAdmin.user_id).where(CourseAdmin.course_id == course_id))
    if admin_id is not None:
        q = q.where(UserItemState.user_id != admin_id)
    return CourseDeleteImpact(progress_students=db.scalar(q))


@router.delete("/api/superuser/{token}/courses/{course_id}", status_code=204)
def delete_course(course_id: int, _user: User = Depends(require_superuser_panel_write),
                  db: Session = Depends(get_db)):
    # D12c: the course lock blocks new versions and admin rows; the version
    # locks block new runs, enrollments and assets; so the runs check holds
    # and the folder list is complete when the cascade runs.
    course = _locked_course(db, course_id)
    version_ids = list(db.scalars(
        select(CourseVersion.id).where(CourseVersion.course_id == course.id).with_for_update()
    ).all())
    if version_ids and db.scalar(select(func.count()).select_from(Run).where(Run.version_id.in_(version_ids))):
        raise HTTPException(status_code=409, detail=_HAS_RUNS)
    try:
        # Core delete: the database's ON DELETE CASCADE removes the rest, instead
        # of the ORM loading every row and deleting bottom-up.
        db.execute(delete(Course.__table__).where(Course.__table__.c.id == course.id))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=_HAS_RUNS)
    # Files last, after the commit, best-effort (as runs.py does).
    for vid in version_ids:
        shutil.rmtree(_asset_dir(vid), ignore_errors=True)


@router.post("/api/superuser/{token}/accounts/lookup", response_model=AccountLookup)
def lookup_account(data: PanelEmail, _user: User = Depends(require_superuser_panel_write),
                   db: Session = Depends(get_db)):
    # The hint under an admin email field (D8). POST keeps addresses out of the
    # access log; it only reads.
    user = db.execute(select(User).where(User.email == data.email)).scalar_one_or_none()
    if user is None:
        return AccountLookup(status="new", full_name=None)
    return AccountLookup(status="disabled" if user.is_disabled else "existing", full_name=user.full_name)
