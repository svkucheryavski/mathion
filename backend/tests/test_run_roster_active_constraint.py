"""Tests for the one-active-RunStudent-per-course invariant on add_student.

POST /api/runs/{rid}/students must 409 when the target user already has an
active RunStudent row on ANOTHER published run of the same course. Ordering:
input-validation 400 (bad group_id) wins over business 409; the 409 fires
BEFORE get_or_create_user so a rejected add never creates a new User row.
"""

from sqlalchemy import func, select

from mathion.models_auth import User


def test_add_student_409_when_user_already_active_on_other_published_run(
    admin_client, db, seed_two_published_runs_same_course
):
    run_a, run_b, student = seed_two_published_runs_same_course()
    response = admin_client.post(
        f"/api/runs/{run_a.id}/students", json={"email": student.email}
    )
    assert response.status_code == 409
    body = response.json()
    assert body["error_code"] == "student_already_active_in_course"
    assert "Summer 26" in body["detail"]
    assert body["conflicts"] == [
        {
            "user_id": student.id,
            "email": student.email,
            "run_id": run_b.id,
            "run_title": "Summer 26",
        }
    ]


def test_add_student_400_when_bad_group_id_takes_precedence_over_409(
    admin_client, db, seed_two_published_runs_same_course
):
    """L2/M6: input-validation 400 takes precedence over business 409."""
    run_a, _run_b, student = seed_two_published_runs_same_course()
    response = admin_client.post(
        f"/api/runs/{run_a.id}/students",
        json={"email": student.email, "group_id": 999999},  # invalid group
    )
    assert response.status_code == 400  # bad group_id wins, NOT 409


def test_add_student_201_when_no_conflict(
    admin_client, db, seed_publishable_version
):
    """Happy path: no conflicting RunStudent on any other run of this course."""
    from datetime import date as _date
    from mathion.models import Run

    _course, version = seed_publishable_version()
    run = Run(
        version_id=version["id"],
        title="Spring 26",
        start_date=_date(2026, 1, 1),
        end_date=_date(2026, 6, 1),
        is_published=True,
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    response = admin_client.post(
        f"/api/runs/{run.id}/students", json={"email": "fresh@example.com"}
    )
    assert response.status_code == 201
    # The new user was created normally.
    assert db.query(User).filter_by(email="fresh@example.com").one() is not None


def test_add_student_201_when_conflict_is_on_draft_run(
    admin_client, db, seed_run_and_draft_run_same_course
):
    """Draft (unpublished) runs are excluded from the conflict set."""
    published_run, _draft_run, student = seed_run_and_draft_run_same_course()
    response = admin_client.post(
        f"/api/runs/{published_run.id}/students", json={"email": student.email}
    )
    assert response.status_code == 201


def test_add_student_201_when_conflict_is_on_different_course(
    admin_client, db, seed_publishable_version
):
    """Conflicts only count within the SAME course (CourseVersion.course_id)."""
    from datetime import date as _date
    from mathion.models import Run, RunStudent

    # Course A + a published run where `student` is already active.
    _course_a, version_a = seed_publishable_version(slug="course-a", name="A")
    run_other = Run(
        version_id=version_a["id"],
        title="Other course run",
        start_date=_date(2026, 1, 1),
        end_date=_date(2026, 6, 1),
        is_published=True,
    )
    db.add(run_other)
    db.flush()
    student = User(email="cross@example.com", full_name="Cross")
    db.add(student)
    db.flush()
    db.add(RunStudent(run_id=run_other.id, user_id=student.id))

    # Course B (different course) with its own published run.
    _course_b, version_b = seed_publishable_version(slug="course-b", name="B")
    run_target = Run(
        version_id=version_b["id"],
        title="Target",
        start_date=_date(2026, 1, 1),
        end_date=_date(2026, 6, 1),
        is_published=True,
    )
    db.add(run_target)
    db.commit()
    db.refresh(run_target)

    response = admin_client.post(
        f"/api/runs/{run_target.id}/students", json={"email": student.email}
    )
    assert response.status_code == 201


def test_add_student_409_does_not_duplicate_existing_user(
    admin_client, db, seed_two_published_runs_same_course
):
    """L4/M2: the 409 short-circuit must NOT call get_or_create_user, so the
    existing User row for `student.email` stays at count==1 after the call."""
    run_a, _run_b, student = seed_two_published_runs_same_course()

    before = db.scalar(
        select(func.count(User.id)).where(User.email == student.email)
    )
    assert before == 1

    response = admin_client.post(
        f"/api/runs/{run_a.id}/students", json={"email": student.email}
    )
    assert response.status_code == 409

    after = db.scalar(
        select(func.count(User.id)).where(User.email == student.email)
    )
    assert after == 1


def test_add_student_201_creates_new_user_when_no_existing_user(
    admin_client, db, seed_publishable_version
):
    """When the target email is a NEW user (no existing User row), the 409
    short-circuit cannot fire (no RunStudent to compare against) — existing
    flow creates the user normally and returns 201."""
    from datetime import date as _date
    from mathion.models import Run

    _course, version = seed_publishable_version()
    run = Run(
        version_id=version["id"],
        title="Spring 26",
        start_date=_date(2026, 1, 1),
        end_date=_date(2026, 6, 1),
        is_published=True,
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    new_email = "brand-new@example.com"
    before = db.scalar(
        select(func.count(User.id)).where(User.email == new_email)
    )
    assert before == 0

    response = admin_client.post(
        f"/api/runs/{run.id}/students", json={"email": new_email}
    )
    assert response.status_code == 201

    after = db.scalar(
        select(func.count(User.id)).where(User.email == new_email)
    )
    assert after == 1
