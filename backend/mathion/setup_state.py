"""The panel's Set up wizard (superuser Set up spec): when each step is
done, the state read, and the wizard's moves."""
from dataclasses import dataclass

from psycopg.errors import UndefinedTable
from sqlalchemy import exists, select, update
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from mathion import branding
from mathion.api.superuser_courses import _panel_admin, email_is_set_up
from mathion.branding import NAME_DEFAULT
from mathion.config import settings
from mathion.models import Course, CourseAdmin
from mathion.models_auth import SiteSetup, User
from mathion.notifications.mailer import DEV_MODES
from mathion.schemas import PanelSetup, PanelSetupCourse, PanelSetupStep
from mathion.site_settings import DEFAULTS, SiteSettingsView, get_row, load as load_site, password_is_readable

STEPS = ("email", "site", "course", "sign_in")

# D6: why email isn't done, first match wins.
EMAIL_OFF = "Email is off."
EMAIL_UNREADABLE = "The saved password can't be read on this server."
EMAIL_FAILING = "Sending is failing: see Settings."
EMAIL_TEST_FAILED = "The last test failed."
EMAIL_NOT_TESTED = "Not tested yet: send a test email."
# D7.
SITE_DEFAULT_NAME = "The site is still called Mathion."

# D9, D12: the Sign-in and File limits cards' six values.
_SIGN_IN_FIELDS = ("pin_minutes", "pin_requests_per_hour", "pin_failures_per_hour", "longest_sign_in_days",
                   "max_file_mb", "max_total_mb")


@dataclass(frozen=True)
class StepDone:
    done: bool
    reason: str | None = None


DONE = StepDone(True, None)


def email_done(view: SiteSettingsView, secret: str, email_mode: str) -> StepDone:
    """D6: email works with the saved settings, a test or a real send says so."""
    if email_mode in DEV_MODES:
        return DONE  # a developer outbox (Settings D2c)
    if not view.email_on:
        return StepDone(False, EMAIL_OFF)
    if not password_is_readable(view, secret):
        return StepDone(False, EMAIL_UNREADABLE)
    if view.send_failure_message is not None:
        return StepDone(False, EMAIL_FAILING)
    if view.card_test_ok:
        return DONE
    failed_at = view.card_test_at if view.card_test_ok is False else None
    if view.last_sent_at is not None and (failed_at is None or failed_at <= view.last_sent_at):
        return DONE
    return StepDone(False, EMAIL_TEST_FAILED if failed_at is not None else EMAIL_NOT_TESTED)


def site_done(name: str, kept: bool) -> StepDone:
    """D7, D4a: renamed, or the default kept on purpose."""
    return DONE if kept or name != NAME_DEFAULT else StepDone(False, SITE_DEFAULT_NAME)


@dataclass(frozen=True)
class CourseFacts:
    # D8: the lowest-id course with an admin, and that admin.
    first: tuple[Course, User] | None
    # D8: the lowest-id course without an admin; set only when `first` is None.
    without_admin: str | None


def course_facts(db: Session) -> CourseFacts:
    row = db.execute(
        select(Course, User).join(CourseAdmin, CourseAdmin.course_id == Course.id)
        .join(User, User.id == CourseAdmin.user_id).order_by(Course.id).limit(1)
    ).first()
    if row is not None:
        return CourseFacts(first=(row[0], row[1]), without_admin=None)
    name = db.scalar(
        select(Course.name).where(~exists().where(CourseAdmin.course_id == Course.id))
        .order_by(Course.id).limit(1)
    )
    return CourseFacts(first=None, without_admin=name)


def defaults_in_use(view: SiteSettingsView) -> bool:
    """D12: the six sign-in and limit values are all Mathion's."""
    return all(getattr(view, f) == getattr(DEFAULTS, f) for f in _SIGN_IN_FIELDS)


# --- the state read and the moves (D4, D4a, D5, D5a, D10, D13) ---

def _setup_row(db: Session, *, lock: bool = False) -> SiteSetup | None:
    """The wizard's row; None when it or its table is missing (D10: over).
    A savepoint, so a missing table never rolls back the caller's work."""
    stmt = select(SiteSetup).where(SiteSetup.id == 1).execution_options(populate_existing=True)
    if lock:
        stmt = stmt.with_for_update()
    try:
        with db.begin_nested():
            return db.execute(stmt).scalar_one_or_none()
    except ProgrammingError as e:
        if not isinstance(e.orig, UndefinedTable):
            raise
        return None


def _done(db: Session) -> tuple[list[StepDone], SiteSettingsView, CourseFacts]:
    view = load_site(db)
    facts = course_facts(db)
    done = [
        email_done(view, settings.secret_key, settings.email_mode),
        site_done(branding.read_in(db).name, view.site_name_kept),  # never the cached copy (§6)
        StepDone(facts.first is not None),
        StepDone(view.sign_in_kept),
    ]
    return done, view, facts


def _passed(mask: int, done: list[StepDone]) -> list[bool]:
    return [bool(mask & (1 << i)) or d.done for i, d in enumerate(done)]


def _panel_course(facts: CourseFacts) -> PanelSetupCourse | None:
    if facts.first is None:
        return None
    course, admin = facts.first
    return PanelSetupCourse(name=course.name, sign_in_url=f"{settings.base_url}/courses/{course.slug}/edit",
                            admin=_panel_admin(admin))


def read(db: Session) -> PanelSetup:
    """D13's one read. D5a: on with every step passed (done anywhere, or
    skipped) stores "over" with one conditional update, then answers."""
    row = _setup_row(db)
    done, view, facts = _done(db)
    passed = _passed(row.passed_mask if row is not None else 0, done)
    on = row is not None and row.wizard_on
    if on and all(passed):
        db.execute(update(SiteSetup).where(SiteSetup.id == 1, SiteSetup.wizard_on).values(wizard_on=False))
        db.commit()
        on = False
    return PanelSetup(
        wizard_on=on,
        step=row.step if on else 1,
        steps=[PanelSetupStep(passed=p, done=d.done, reason=d.reason) for p, d in zip(passed, done)],
        course=_panel_course(facts),
        course_without_admin=facts.without_admin,
        email_set_up=email_is_set_up(db),
        pin_minutes=view.pin_minutes,
        defaults_in_use=defaults_in_use(view),
    )


def _live_row(db: Session) -> SiteSetup | None:
    """The row, locked, while the wizard is on; otherwise None and the
    transaction ended, so a late write changes nothing (D5a)."""
    row = _setup_row(db, lock=True)
    if row is None or not row.wizard_on:
        db.rollback()
        return None
    return row


def go_to(db: Session, n: int) -> PanelSetup:
    row = _live_row(db)
    if row is not None:
        row.step = n
        db.commit()
    return read(db)


def _pass(db: Session, n: int, *, kept: bool) -> PanelSetup:
    """D4: mark step n passed and go to the first step after it that isn't,
    wrapping round; none left ends the wizard (D5). `kept` marks step 2's or
    step 4's defaults kept (D4a, D7)."""
    row = _live_row(db)
    if row is None:
        return read(db)
    if kept and n == 2:
        get_row(db).site_name_kept = True
    elif kept and n == 4:
        get_row(db).sign_in_kept = True
    row.passed_mask |= 1 << (n - 1)
    passed = _passed(row.passed_mask, _done(db)[0])
    after = [(n + i - 1) % 4 + 1 for i in range(1, 4)]
    nxt = next((k for k in after if not passed[k - 1]), None)
    if nxt is None:
        row.wizard_on = False
    else:
        row.step = nxt
    db.commit()
    return read(db)


def skip(db: Session, n: int) -> PanelSetup:
    """The skip button: no values saved; steps 2 and 4 keep their defaults (D4a)."""
    return _pass(db, n, kept=n in (2, 4))


def saved(db: Session, n: int) -> PanelSetup:
    """After a step's own saves, or Continue. Step 2's save marks the name kept
    (D7); step 4's keep goes through keep_sign_in."""
    return _pass(db, n, kept=n == 2)


def keep_sign_in(db: Session) -> PanelSetup:
    """D9, D12: the Dashboard's Keep these values and step 4's unchanged save.
    Not a wizard write: it marks the step whatever the wizard's state."""
    get_row(db).sign_in_kept = True
    db.commit()
    return read(db)
