"""Tests for find_student_active_conflicts + make_already_active_409_body helpers."""

from mathion.api.roster_ops import STUDENT_ALREADY_ACTIVE_ERROR_CODE, find_student_active_conflicts, make_already_active_409_body
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


def test_find_returns_conflicts_ordered_by_run_id_ascending(
    db, seed_publishable_version
):
    """§7a determinism CONTRACT guard for find_student_active_conflicts.

    A student active in TWO other published runs of the same course must be
    returned sorted by run_id ascending, so the user-facing 409 in
    run_roster.py (which reads conflict_dicts[0]['run_title']) always names a
    stable conflicting run. This is a CONTRACT guard: on a small table a
    PostgreSQL seq scan tends to yield heap/insertion order (already ascending
    here), so removing the `.order_by(Run.id)` does not reliably reproduce a
    mis-order — the test pins the ordering contract rather than a live failure.
    """
    from datetime import date as _date

    from mathion.models import Run, RunStudent

    _course, version = seed_publishable_version()
    # exclude_run: the run being edited; student is NOT on it.
    exclude_run = Run(
        version_id=version["id"], title="Editing",
        start_date=_date(2026, 1, 1), end_date=_date(2026, 6, 1),
        is_published=True,
    )
    conflict_run_a = Run(
        version_id=version["id"], title="Conflict A",
        start_date=_date(2026, 1, 1), end_date=_date(2026, 6, 1),
        is_published=True,
    )
    conflict_run_b = Run(
        version_id=version["id"], title="Conflict B",
        start_date=_date(2026, 1, 1), end_date=_date(2026, 6, 1),
        is_published=True,
    )
    db.add_all([exclude_run, conflict_run_a, conflict_run_b])
    db.flush()
    student = User(email="multi@example.com", full_name="Multi")
    db.add(student)
    db.flush()
    db.add_all([
        RunStudent(run_id=conflict_run_a.id, user_id=student.id),
        RunStudent(run_id=conflict_run_b.id, user_id=student.id),
    ])
    db.commit()

    result = find_student_active_conflicts(
        db,
        student.id,
        course_id=exclude_run.version.course_id,
        exclude_run_id=exclude_run.id,
    )
    assert result == [
        (conflict_run_a.id, conflict_run_a.title),
        (conflict_run_b.id, conflict_run_b.title),
    ]
    # Explicit: ascending by run_id (contract).
    assert [rid for rid, _ in result] == sorted(rid for rid, _ in result)


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
