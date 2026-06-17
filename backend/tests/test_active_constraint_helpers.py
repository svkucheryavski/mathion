"""Tests for find_student_active_conflicts + make_already_active_409_body helpers.

The `find_*` tests depend on conftest fixtures that land in Tasks A3/A4:
- `seed_run_with_published_mp` (Task A3)
- `seed_two_published_runs_same_course` (Task A4)
- `seed_run_and_draft_run_same_course` (Task A4)

Those tests are skipped here and unskipped once the fixtures are added.
The constant test + the two pure-logic `make_body` tests run now.
"""

import pytest

from mathion.api.helpers import (
    STUDENT_ALREADY_ACTIVE_ERROR_CODE,
    find_student_active_conflicts,
    make_already_active_409_body,
)


def test_constant_value():
    assert STUDENT_ALREADY_ACTIVE_ERROR_CODE == "student_already_active_in_course"


@pytest.mark.skip(reason="awaits A3 conftest fixture seed_run_with_published_mp")
def test_find_returns_empty_when_no_conflicts(db_session, seed_run_with_published_mp):
    run = seed_run_with_published_mp["run"]
    student = seed_run_with_published_mp["student"]
    result = find_student_active_conflicts(
        db_session,
        student.id,
        course_id=run.version.course_id,
        exclude_run_id=run.id,
    )
    assert result == []


@pytest.mark.skip(reason="awaits A4 conftest fixture seed_two_published_runs_same_course")
def test_find_returns_other_runs_when_conflict(
    db_session, seed_two_published_runs_same_course
):
    fixture = seed_two_published_runs_same_course
    student = fixture["student"]
    run_a = fixture["run_a"]
    run_b = fixture["run_b"]
    result = find_student_active_conflicts(
        db_session,
        student.id,
        course_id=run_a.version.course_id,
        exclude_run_id=run_a.id,
    )
    assert result == [(run_b.id, run_b.title)]


@pytest.mark.skip(reason="awaits A4 conftest fixture seed_run_and_draft_run_same_course")
def test_find_excludes_unpublished_runs(
    db_session, seed_run_and_draft_run_same_course
):
    fixture = seed_run_and_draft_run_same_course
    student = fixture["student"]
    published_run = fixture["published_run"]
    result = find_student_active_conflicts(
        db_session,
        student.id,
        course_id=published_run.version.course_id,
        exclude_run_id=published_run.id,
    )
    assert result == []


def test_make_body_with_conflicts_uses_first():
    conflicts = [
        {"run_id": 42, "run_title": "Stats 101 — Spring"},
        {"run_id": 99, "run_title": "Stats 101 — Fall"},
    ]
    body = make_already_active_409_body(conflicts)
    assert body == {
        "detail": 'Student is already active in run "Stats 101 — Spring" of the same course.',
        "error_code": STUDENT_ALREADY_ACTIVE_ERROR_CODE,
        "conflicts": conflicts,
    }


def test_make_body_summary_override():
    conflicts = [{"run_id": 7, "run_title": "Anything"}]
    body = make_already_active_409_body(
        conflicts, summary_override="Custom roster-import summary"
    )
    assert body == {
        "detail": "Custom roster-import summary",
        "error_code": STUDENT_ALREADY_ACTIVE_ERROR_CODE,
        "conflicts": conflicts,
    }
