"""Tests for find_student_active_conflicts + make_already_active_409_body helpers."""

from mathion.api.helpers import (
    STUDENT_ALREADY_ACTIVE_ERROR_CODE,
    find_student_active_conflicts,
    make_already_active_409_body,
)
from mathion.models import Run
from mathion.models_auth import User


def test_constant_value():
    assert STUDENT_ALREADY_ACTIVE_ERROR_CODE == "student_already_active_in_course"


def test_find_returns_empty_when_no_conflicts(db, seed_run_with_published_mp):
    # 4-tuple factory: (run_dict, ga, gb, mp). Resolve ORM Run + the alice
    # student seeded by the underlying seed_run_with_groups call.
    run_dict, _ga, _gb, _mp = seed_run_with_published_mp()
    run = db.get(Run, run_dict["id"])
    alice = db.query(User).filter_by(email="alice@example.com").one()
    result = find_student_active_conflicts(
        db,
        alice.id,
        course_id=run.version.course_id,
        exclude_run_id=run.id,
    )
    # Alice is on this run only (the one we're excluding) → no conflicts.
    assert result == []


def test_find_returns_other_runs_when_conflict(
    db, seed_two_published_runs_same_course
):
    run_a, run_b, student = seed_two_published_runs_same_course()
    result = find_student_active_conflicts(
        db,
        student.id,
        course_id=run_a.version.course_id,
        exclude_run_id=run_a.id,
    )
    assert result == [(run_b.id, run_b.title)]


def test_find_excludes_unpublished_runs(
    db, seed_run_and_draft_run_same_course
):
    published_run, _draft_run, student = seed_run_and_draft_run_same_course()
    result = find_student_active_conflicts(
        db,
        student.id,
        course_id=published_run.version.course_id,
        exclude_run_id=published_run.id,
    )
    # Student is on the draft run only → excluded from the conflict set.
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
