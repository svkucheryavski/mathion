"""Tests for the student mini-projects router skeleton + the
`_resolve_student_run` helper.

Covers the 404/403 boundary conditions mirroring `/my-version` semantics,
plus the D2 (inactive enrollment) and D6 (defensive multi-active-run pick)
spec divergences.
"""

from __future__ import annotations

import logging

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from mathion.api.student_mini_projects import _resolve_student_run
from mathion.models import Course, CourseVersion, Run
from mathion.models_auth import User


def _get_user_by_email(db, email: str) -> User:
    return db.execute(select(User).where(User.email == email)).scalar_one()


def _get_course_for_run(db, run: Run) -> Course:
    version = db.get(CourseVersion, run.version_id)
    return db.get(Course, version.course_id)


def test_resolve_returns_run_when_student_active(db, seed_run_with_published_mp):
    run_dict, _ga, _gb, _mp = seed_run_with_published_mp()
    run = db.get(Run, run_dict["id"])
    course = _get_course_for_run(db, run)
    student = _get_user_by_email(db, "alice@example.com")

    result = _resolve_student_run(db, student, course.slug)

    assert result.id == run.id


def test_resolve_raises_404_when_course_slug_missing(db, make_user):
    student = make_user()
    with pytest.raises(HTTPException) as exc_info:
        _resolve_student_run(db, student, "nope-no-such-slug")
    assert exc_info.value.status_code == 404


def test_resolve_raises_403_when_student_has_enrollment_but_no_run_student(
    db, seed_published_course_version_with_enrollment_only
):
    """User has StudentEnrollment on version, but no RunStudent on any run."""
    student, course = seed_published_course_version_with_enrollment_only()
    with pytest.raises(HTTPException) as exc_info:
        _resolve_student_run(db, student, course.slug)
    assert exc_info.value.status_code == 403


def test_resolve_raises_404_when_no_enrollment(db, make_user, seed_published_course):
    student = make_user()
    course = seed_published_course()
    with pytest.raises(HTTPException) as exc_info:
        _resolve_student_run(db, student, course.slug)
    assert exc_info.value.status_code == 404


def test_resolve_defensive_pick_most_recent_when_two_active_runs(
    db, seed_two_published_runs_same_course, caplog
):
    """D6: legacy data may have 2 active RunStudent rows; pick most-recent
    by Run.start_date DESC and emit warning."""
    run_a, run_b, student = seed_two_published_runs_same_course()
    # Sanity: fixture must satisfy run_b.start_date > run_a.start_date for
    # this test to deterministically prefer run_b.
    assert run_b.start_date > run_a.start_date
    course = _get_course_for_run(db, run_a)

    # Some earlier tests run Alembic, which calls logging.fileConfig with the
    # default `disable_existing_loggers=True` — that flips
    # `logger.disabled = True` on every pre-existing module logger, including
    # ours. caplog hooks the root logger but disabled module loggers swallow
    # records before propagation. Re-enable explicitly to keep this test
    # robust to global suite state.
    target_logger = logging.getLogger("mathion.api.student_mini_projects")
    target_logger.disabled = False
    with caplog.at_level(logging.WARNING, logger="mathion.api.student_mini_projects"):
        result = _resolve_student_run(db, student, course.slug)

    assert result.id == run_b.id  # newer wins
    assert any("multiple active" in rec.message.lower() for rec in caplog.records)
