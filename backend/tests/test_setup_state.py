"""The Set up wizard's done rules (superuser Set up spec D6-D9)."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from mathion.models import Course, CourseAdmin
from mathion.models_auth import User
from mathion.secret_box import seal
from mathion.setup_state import STEPS, StepDone, course_facts, defaults_in_use, email_done, site_done
from mathion.site_settings import DEFAULTS, SiteSettingsView

SECRET = "s" * 48
T0 = datetime(2026, 11, 1, 8, 0, tzinfo=timezone.utc)
ON = replace(DEFAULTS, email_on=True, smtp_host="mail.uni.dk", email_from="Mathion <noreply@uni.dk>")

OFF = "Email is off."
UNREADABLE = "The saved password can't be read on this server."
FAILING = "Sending is failing: see Settings."
TEST_FAILED = "The last test failed."
NOT_TESTED = "Not tested yet: send a test email."


def _email(view: SiteSettingsView, mode: str = "smtp") -> StepDone:
    return email_done(view, SECRET, mode)


def test_steps_in_order():
    assert STEPS == ("email", "site", "course", "sign_in")


# --- D6, the email rule: one case per reason, in first-match order ---

def test_email_off():
    assert _email(replace(ON, email_on=False, smtp_username="u", smtp_password_sealed="junk",
                          send_failure_message="x")) == StepDone(False, OFF)


def test_email_unreadable_password():
    sealed = seal("pw", "o" * 48)  # sealed by another server's key
    view = replace(ON, smtp_username="u@uni.dk", smtp_password_sealed=sealed, send_failure_message="x",
                   card_test_ok=True, card_test_at=T0)
    assert _email(view) == StepDone(False, UNREADABLE)


def test_email_failing():
    view = replace(ON, send_failure_message="The mail server refused the login.", card_test_ok=True,
                   card_test_at=T0)
    assert _email(view) == StepDone(False, FAILING)


def test_email_last_test_failed_without_send():
    assert _email(replace(ON, card_test_ok=False, card_test_at=T0)) == StepDone(False, TEST_FAILED)


def test_email_not_tested():
    assert _email(ON) == StepDone(False, NOT_TESTED)


def test_email_card_test_passed():
    assert _email(replace(ON, card_test_ok=True, card_test_at=T0)) == StepDone(True, None)


def test_email_readable_login_and_passed_test():
    view = replace(ON, smtp_username="u@uni.dk", smtp_password_sealed=seal("pw", SECRET), card_test_ok=True,
                   card_test_at=T0)
    assert _email(view) == StepDone(True, None)


def test_email_sent_without_card_test():
    assert _email(replace(ON, last_sent_at=T0)) == StepDone(True, None)


def test_email_sent_after_failed_test():
    view = replace(ON, card_test_ok=False, card_test_at=T0, last_sent_at=T0 + timedelta(minutes=1))
    assert _email(view) == StepDone(True, None)


def test_email_failed_test_after_send():
    view = replace(ON, card_test_ok=False, card_test_at=T0 + timedelta(minutes=1), last_sent_at=T0)
    assert _email(view) == StepDone(False, TEST_FAILED)


@pytest.mark.parametrize("mode", ["file", "memory"])
def test_email_dev_mode_is_done(mode):
    assert _email(DEFAULTS, mode) == StepDone(True, None)


# --- D7, the site name ---

def test_site_default_name_not_done():
    assert site_done("Mathion", False) == StepDone(False, "The site is still called Mathion.")


def test_site_renamed_done():
    assert site_done("Lund", False) == StepDone(True, None)


def test_site_kept_done():
    assert site_done("Mathion", True) == StepDone(True, None)


# --- D8, the first course ---

def _user(db, email, disabled=False) -> User:
    u = User(email=email, is_disabled=disabled)
    db.add(u)
    db.flush()
    return u


def _course(db, id_, name, admin: User | None = None) -> Course:
    c = Course(id=id_, slug=f"c{id_}", name=name)
    db.add(c)
    db.flush()
    if admin is not None:
        db.add(CourseAdmin(course_id=c.id, user_id=admin.id))
    db.commit()
    return c


def test_course_facts_none(db):
    facts = course_facts(db)
    assert (facts.first, facts.without_admin) == (None, None)


def test_course_facts_first_with_admin(db):
    ann = _user(db, "ann@uni.dk")
    _course(db, 2, "Algebra")
    _course(db, 3, "Geometry", ann)
    facts = course_facts(db)
    assert facts.first is not None
    course, admin = facts.first
    assert (course.id, admin.email, facts.without_admin) == (3, "ann@uni.dk", None)


def test_course_facts_lowest_id_wins(db):
    ann, bob = _user(db, "ann@uni.dk"), _user(db, "bob@uni.dk")
    _course(db, 5, "Later", ann)
    _course(db, 4, "Earlier", bob)
    course, admin = course_facts(db).first
    assert (course.name, admin.email) == ("Earlier", "bob@uni.dk")


def test_course_facts_without_admin(db):
    _course(db, 3, "Statistics")
    _course(db, 2, "Algebra")
    facts = course_facts(db)
    assert (facts.first, facts.without_admin) == (None, "Algebra")


def test_course_facts_disabled_admin_counts(db):
    ann = _user(db, "ann@uni.dk", disabled=True)
    _course(db, 2, "Algebra", ann)
    course, admin = course_facts(db).first
    assert (course.name, admin.is_disabled) == ("Algebra", True)


# --- D9, D12: Mathion's sign-in and limit defaults ---

def test_defaults_in_use():
    assert defaults_in_use(DEFAULTS) is True
    assert defaults_in_use(replace(DEFAULTS, email_on=True, smtp_host="x")) is True


@pytest.mark.parametrize("field,value", [
    ("pin_minutes", 15), ("pin_requests_per_hour", 4), ("pin_failures_per_hour", 6),
    ("longest_sign_in_days", 7), ("max_file_mb", 21), ("max_total_mb", 501),
])
def test_defaults_not_in_use(field, value):
    assert defaults_in_use(replace(DEFAULTS, **{field: value})) is False
