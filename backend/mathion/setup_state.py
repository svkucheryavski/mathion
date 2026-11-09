"""The panel's Set up wizard (superuser Set up spec): when each step is done."""
from dataclasses import dataclass

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from mathion.branding import NAME_DEFAULT
from mathion.models import Course, CourseAdmin
from mathion.models_auth import User
from mathion.notifications.mailer import DEV_MODES
from mathion.site_settings import DEFAULTS, SiteSettingsView, password_is_readable

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
