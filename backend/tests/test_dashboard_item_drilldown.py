"""Tests for the per-item drilldown endpoint (slice 1 of teacher dashboards).

Endpoint: GET /api/runs/{rid}/students/{uid}/sequences/{sid}/items
Spec: docs/superpowers/specs/2026-05-31-teacher-dashboards-design.md §5.1

Exactly 15 tests covering the spec's enumerated test list (lines 362-378).
"""
from datetime import date, datetime, timezone

from mathion.models import (
    Block,
    Course,
    CourseAdmin,
    CourseVersion,
    Item,
    Run,
    RunStudent,
    RunTeacher,
    Sequence,
)
from mathion.models_auth import User, UserItemState


def _publish_minimal_run(db):
    """Create a published run with one block, one sequence containing 3 items
    (1 static_page + 2 quiz), and one enrolled student.

    Items are CREATED in non-natural order (order=3 first, then 1, then 2) so
    that any test that asserts `[1, 2, 3]` actually exercises the SQL
    `ORDER BY Item.order ASC` clause rather than passively relying on
    insertion order.

    Returns (run, seq, items, student, course, block) — `items` is sorted by
    `order` ASC for caller convenience; `course` and `block` are returned so
    callers don't need to re-query.
    """
    course = Course(slug="drilldown-test", name="Drilldown", description="")
    db.add(course); db.commit(); db.refresh(course)

    version = CourseVersion(
        course_id=course.id, state="published", is_disabled=False,
        info_md="", info_html="",
    )
    db.add(version); db.commit(); db.refresh(version)

    block = Block(version_id=version.id, title="Block 1", slug="block-1", order=1)
    db.add(block); db.commit(); db.refresh(block)

    seq = Sequence(block_id=block.id, title="Seq 1", slug="seq-1", order=1)
    db.add(seq); db.commit(); db.refresh(seq)

    # Insert items in non-natural order (3, 1, 2) so the SQL ORDER BY is
    # actually exercised by the items-order test.
    item3 = Item(sequence_id=seq.id, title="Item 3", slug="item-3", order=3, type="quiz")
    item1 = Item(sequence_id=seq.id, title="Item 1", slug="item-1", order=1, type="static_page",
                 content_md="x", content_html="<p>x</p>")
    item2 = Item(sequence_id=seq.id, title="Item 2", slug="item-2", order=2, type="quiz")
    for it in (item3, item1, item2):
        db.add(it)
    db.commit()
    for it in (item3, item1, item2):
        db.refresh(it)
    # Return items sorted by order (callers expect [item-1, item-2, item-3]).
    items = [item1, item2, item3]

    run = Run(
        version_id=version.id, title="Spring 2026",
        start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        groups_enabled=False, is_published=True,
    )
    db.add(run); db.commit(); db.refresh(run)

    student = User(email="s1@test", full_name="Student One")
    db.add(student); db.commit(); db.refresh(student)

    db.add(RunStudent(run_id=run.id, user_id=student.id))
    db.commit()

    return run, seq, items, student, course, block


# ============================================================================
# AUTHORIZATION (6 tests — spec #1-6)
# ============================================================================


def test_admin_returns_200_with_full_payload(db, student_client_for):
    """Spec #1: CourseAdmin returns 200 with full payload (sequence + student + items).

    Uses a non-superuser User + CourseAdmin row to exercise the
    `require_run_admin_or_teacher` CourseAdmin branch (authz.py),
    NOT the `is_superuser` short-circuit in authz.py. The superuser
    path is covered separately by `test_superuser_returns_200`.
    """
    run, seq, _items, student, course, _block = _publish_minimal_run(db)
    admin_user = User(email="course-admin@test", full_name="Course Admin")
    db.add(admin_user); db.commit(); db.refresh(admin_user)
    db.add(CourseAdmin(course_id=course.id, user_id=admin_user.id))
    db.commit()

    c = student_client_for(admin_user.email)
    r = c.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
    assert r.status_code == 200
    body = r.json()
    # SequenceMeta per spec §5.1 (NO sequence_order field exposed)
    assert body["sequence"]["sequence_id"] == seq.id
    assert body["sequence"]["sequence_title"] == "Seq 1"
    assert "sequence_order" not in body["sequence"]
    assert body["sequence"]["block_title"] == "Block 1"
    # StudentMeta
    assert body["student"]["user_id"] == student.id
    assert body["student"]["full_name"] == "Student One"
    assert body["student"]["email"] == "s1@test"
    # Items in order
    assert [it["item_order"] for it in body["items"]] == [1, 2, 3]


def test_run_teacher_returns_200(db, teacher_user, teacher_client):
    """Spec #2: Run teacher of THIS run returns 200."""
    run, seq, _items, student, _course, _block = _publish_minimal_run(db)
    db.add(RunTeacher(run_id=run.id, user_id=teacher_user.id))
    db.commit()
    r = teacher_client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
    assert r.status_code == 200


def test_superuser_returns_200(db, student_client_for):
    """Spec #3: Superuser returns 200 (verifies helper short-circuit)."""
    run, seq, _items, student, _course, _block = _publish_minimal_run(db)
    su = User(email="su@test", full_name="SU", is_superuser=True)
    db.add(su); db.commit()
    c = student_client_for(su.email)
    r = c.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
    assert r.status_code == 200


def test_non_member_returns_403(db, student_client_for):
    """Spec #4: Non-member (no CourseAdmin, no RunTeacher, not enrolled, not superuser) returns 403."""
    run, seq, _items, student, _course, _block = _publish_minimal_run(db)
    nm = User(email="nm@test", full_name="NM")
    db.add(nm); db.commit()
    c = student_client_for(nm.email)
    r = c.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
    assert r.status_code == 403


def test_teacher_of_different_run_returns_403(db, student_client_for):
    """Spec #5: Teacher of a DIFFERENT run (course-distinct) returns 403."""
    run, seq, _items, student, _course, _block = _publish_minimal_run(db)
    # Create a second course/run with its own teacher.
    other_course = Course(slug="other-course", name="Other", description="")
    db.add(other_course); db.commit(); db.refresh(other_course)
    other_version = CourseVersion(
        course_id=other_course.id, state="published", is_disabled=False,
        info_md="", info_html="",
    )
    db.add(other_version); db.commit(); db.refresh(other_version)
    other_run = Run(
        version_id=other_version.id, title="Other Run",
        start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        groups_enabled=False, is_published=True,
    )
    db.add(other_run); db.commit(); db.refresh(other_run)
    other_teacher = User(email="other-teacher@test", full_name="OT")
    db.add(other_teacher); db.commit(); db.refresh(other_teacher)
    db.add(RunTeacher(run_id=other_run.id, user_id=other_teacher.id))
    db.commit()

    c = student_client_for(other_teacher.email)
    r = c.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
    assert r.status_code == 403


def test_student_of_this_run_returns_403(db, student_client_for):
    """Spec #6: Student of THIS run (no admin/teacher role) returns 403 even for their own data."""
    run, seq, _items, student, _course, _block = _publish_minimal_run(db)
    c = student_client_for(student.email)
    r = c.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
    assert r.status_code == 403


# ============================================================================
# 404s — probe-safe with identical "Resource not found" detail (3 tests — spec #7-9)
# ============================================================================


def test_student_not_in_run_returns_404_identical_detail(db, admin_client):
    """Spec #7: Student-not-in-this-run (different run / not enrolled / nonexistent) returns 404
    with identical `"Resource not found"` detail."""
    run, seq, _items, _student, _course, _block = _publish_minimal_run(db)

    # Case A: real user, not enrolled
    other = User(email="other@test", full_name="Other")
    db.add(other); db.commit(); db.refresh(other)
    r1 = admin_client.get(f"/api/runs/{run.id}/students/{other.id}/sequences/{seq.id}/items")
    assert r1.status_code == 404
    assert r1.json()["detail"] == "Resource not found"

    # Case B: nonexistent user_id
    r2 = admin_client.get(f"/api/runs/{run.id}/students/999999/sequences/{seq.id}/items")
    assert r2.status_code == 404
    assert r2.json()["detail"] == "Resource not found"


def test_sequence_not_in_pinned_version_returns_404(db, admin_client):
    """Spec #8: Sequence-not-in-pinned-version returns 404 with identical detail."""
    run, _seq, _items, student, _course, _block = _publish_minimal_run(db)
    other_course = Course(slug="other", name="Other", description="")
    db.add(other_course); db.commit(); db.refresh(other_course)
    other_version = CourseVersion(
        course_id=other_course.id, state="published", is_disabled=False,
        info_md="", info_html="",
    )
    db.add(other_version); db.commit(); db.refresh(other_version)
    other_block = Block(version_id=other_version.id, title="B", slug="b", order=1)
    db.add(other_block); db.commit(); db.refresh(other_block)
    other_seq = Sequence(block_id=other_block.id, title="X", slug="x", order=1)
    db.add(other_seq); db.commit(); db.refresh(other_seq)

    r = admin_client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{other_seq.id}/items")
    assert r.status_code == 404
    assert r.json()["detail"] == "Resource not found"


def test_nonexistent_sequence_returns_404(db, admin_client):
    """Spec #9: Nonexistent sequence_id returns 404."""
    run, _seq, _items, student, _course, _block = _publish_minimal_run(db)
    r = admin_client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/999999/items")
    assert r.status_code == 404
    assert r.json()["detail"] == "Resource not found"


# ============================================================================
# RESPONSE SHAPE (3 tests — spec #10-12)
# ============================================================================


def test_empty_sequence_returns_items_empty_list(db, admin_client):
    """Spec #10: Empty sequence (zero items) returns items: []."""
    run, _seq, _items, student, _course, block = _publish_minimal_run(db)
    empty_seq = Sequence(block_id=block.id, title="Empty", slug="empty", order=2)
    db.add(empty_seq); db.commit(); db.refresh(empty_seq)

    r = admin_client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{empty_seq.id}/items")
    assert r.status_code == 200
    assert r.json()["items"] == []


def test_zero_touched_items_returns_default_fields(db, admin_client):
    """Spec #11: Zero touched items returns full item list with is_covered=false defaults,
    last_score=null, last_visited_at=null."""
    run, seq, _items, student, _course, _block = _publish_minimal_run(db)
    # NO UserItemState rows for any item.
    r = admin_client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
    body = r.json()
    assert len(body["items"]) == 3
    for it in body["items"]:
        assert it["is_covered"] is False
        assert it["last_score"] is None
        assert it["last_visited_at"] is None


def test_quiz_with_attempt_populates_last_score_non_quiz_is_null(db, admin_client):
    """Spec #12: Quiz item with attempt returns last_score: {correct, total} populated;
    non-quiz items return last_score: null."""
    run, seq, items, student, _course, _block = _publish_minimal_run(db)
    static_item, quiz_a, _quiz_b = items
    visited_at = datetime(2026, 4, 10, 9, 32, tzinfo=timezone.utc)
    # Quiz item with full attempt.
    db.add(UserItemState(
        user_id=student.id, item_id=quiz_a.id, is_covered=True,
        last_score_correct=6, last_score_total=8, last_visited_at=visited_at,
        time_spent=120,
    ))
    # Static-page UIS row (should still produce last_score=None per Cell conventions).
    db.add(UserItemState(
        user_id=student.id, item_id=static_item.id, is_covered=True,
        last_visited_at=visited_at, time_spent=30,
    ))
    db.commit()

    r = admin_client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
    body = r.json()
    quiz_row = next(it for it in body["items"] if it["item_id"] == quiz_a.id)
    assert quiz_row["last_score"] == {"correct": 6, "total": 8}
    assert quiz_row["last_visited_at"] is not None
    static_row = next(it for it in body["items"] if it["item_id"] == static_item.id)
    assert static_row["last_score"] is None  # not quiz, even with UIS row
    assert static_row["is_covered"] is True
    assert static_row["last_visited_at"] is not None


# ============================================================================
# STATE PRESERVATION (3 tests — spec #13-15)
# ============================================================================


def test_disabled_user_returns_200(db, admin_client):
    """Spec #13: Disabled user returns 200 — admin/teacher can still view."""
    run, seq, _items, student, _course, _block = _publish_minimal_run(db)
    student.is_disabled = True
    db.commit()
    r = admin_client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
    assert r.status_code == 200
    assert r.json()["student"]["user_id"] == student.id


def test_disabled_version_returns_200(db, admin_client):
    """Spec #14: Disabled version returns 200 — admin/teacher reads historical state."""
    run, seq, _items, student, _course, _block = _publish_minimal_run(db)
    version = db.get(CourseVersion, run.version_id)
    version.is_disabled = True
    db.commit()
    r = admin_client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
    assert r.status_code == 200


def test_unpublished_run_returns_200(db, admin_client):
    """Spec #15: Unpublished run returns 200 for admin/teacher (preview)."""
    run, seq, _items, student, _course, _block = _publish_minimal_run(db)
    run.is_published = False
    db.commit()
    r = admin_client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
    assert r.status_code == 200
