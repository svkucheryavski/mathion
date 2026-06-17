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


# --- batch endpoint tests (Task A5) --------------------------------------
#
# POST /api/runs/{rid}/students/batch must apply the same constraint per row,
# returning a per-row "error" with error_code="student_already_active_in_course"
# while letting other rows succeed. M5 mandates the check fires IMMEDIATELY
# after get_or_create_user and BEFORE any mutation of target.full_name, group
# lookup/creation, or enroll_user_in_run.


def test_batch_partial_success_with_one_conflict_row(
    admin_client, db, seed_two_published_runs_same_course
):
    run_a, _run_b, student_on_b = seed_two_published_runs_same_course()
    fresh_email = "fresh@example.com"
    new_email = "new-user@example.com"
    response = admin_client.post(
        f"/api/runs/{run_a.id}/students/batch",
        json={
            "rows": [
                {"email": fresh_email},
                {"email": student_on_b.email},
                {"email": new_email},
            ]
        },
    )
    assert response.status_code == 207
    results = response.json()["results"]
    assert results[0]["status"] == "added"
    assert results[1]["status"] == "error"
    assert results[1]["error_code"] == "student_already_active_in_course"
    assert results[2]["status"] == "added"


def test_batch_conflict_does_not_overwrite_full_name(
    admin_client, db, seed_two_published_runs_same_course
):
    """M5: rejected rows MUST NOT mutate target.full_name."""
    run_a, _run_b, student = seed_two_published_runs_same_course()
    original_name = student.full_name  # set to "Sam" by the fixture
    response = admin_client.post(
        f"/api/runs/{run_a.id}/students/batch",
        json={"rows": [{"email": student.email, "name": "Other Name"}]},
    )
    assert response.status_code == 207
    assert response.json()["results"][0]["status"] == "error"
    db.refresh(student)
    assert student.full_name == original_name  # unchanged


def test_batch_all_conflict_rows_zero_added(
    admin_client, db, seed_two_published_runs_same_course
):
    """All three rows target users already active on another published run of
    the same course → 0 added, 3 error rows with the constraint error_code."""
    from mathion.models import RunStudent

    run_a, run_b, student_one = seed_two_published_runs_same_course()
    # Two more conflicting users: active on run_b (same course as run_a).
    student_two = User(email="two@example.com", full_name="Two")
    student_three = User(email="three@example.com", full_name="Three")
    db.add_all([student_two, student_three])
    db.flush()
    db.add_all([
        RunStudent(run_id=run_b.id, user_id=student_two.id),
        RunStudent(run_id=run_b.id, user_id=student_three.id),
    ])
    db.commit()

    response = admin_client.post(
        f"/api/runs/{run_a.id}/students/batch",
        json={
            "rows": [
                {"email": student_one.email},
                {"email": student_two.email},
                {"email": student_three.email},
            ]
        },
    )
    assert response.status_code == 207
    results = response.json()["results"]
    assert len(results) == 3
    assert all(r["status"] == "error" for r in results)
    assert all(
        r["error_code"] == "student_already_active_in_course" for r in results
    )


# --- publish_run aggregate tests (Task A6) -------------------------------
#
# POST /api/runs/{rid}/publish must load all RunStudents of `rid` and collect
# every cross-run conflict in a single aggregate. 409 returns the full list
# (not first-conflict-wins) so admins can fix in one pass. Detail copy is
# explicit singular/plural based on the unique conflicting-student count.


def _make_publishable_draft(db, version_id, *, title="Draft", admin_email="admin@example.com"):
    """Helper: create an unpublished run on the given version, with one teacher
    so the existing teacher-count gate passes. Returns the Run ORM object."""
    from datetime import date as _date
    from mathion.models import Run, RunTeacher

    run = Run(
        version_id=version_id,
        title=title,
        start_date=_date(2026, 1, 1),
        end_date=_date(2026, 6, 1),
        groups_enabled=False,
        is_published=False,
    )
    db.add(run)
    db.flush()
    # Use the (already-existing) admin user as teacher to satisfy
    # teacher_count > 0 without spinning up a new user. The existing
    # admin_client fixture has already created an admin row.
    admin = db.query(User).filter_by(email=admin_email).one()
    db.add(RunTeacher(run_id=run.id, user_id=admin.id))
    db.commit()
    db.refresh(run)
    return run


def test_publish_run_409_with_aggregate_conflicts(
    admin_client, db, seed_two_published_runs_same_course
):
    """run_a (draft, about to publish) has 3 students. 2 are also on run_b
    (published, same course). Publishing run_a returns 409 with both conflicts."""
    from mathion.models import RunStudent

    # seed_two_published_runs_same_course gives us a published run_b with `student`
    # already enrolled. We turn run_a into a DRAFT to publish, and add 2 more
    # conflicting students.
    run_a, run_b, s1 = seed_two_published_runs_same_course()
    # Flip run_a to draft (we want to PUBLISH it; the fixture made it published).
    run_a.is_published = False
    db.add(run_a)
    db.commit()
    db.refresh(run_a)

    # s1 is already on both runs from the fixture. Add two more conflict students.
    s2 = User(email="s2@example.com", full_name="S2")
    s3 = User(email="s3@example.com", full_name="S3")
    # And one non-conflicting student (only on run_a).
    s_fresh = User(email="fresh@example.com", full_name="Fresh")
    db.add_all([s2, s3, s_fresh])
    db.flush()
    db.add_all([
        RunStudent(run_id=run_a.id, user_id=s2.id),
        RunStudent(run_id=run_b.id, user_id=s2.id),  # s2 conflicts via run_b
        RunStudent(run_id=run_a.id, user_id=s3.id),
        RunStudent(run_id=run_b.id, user_id=s3.id),  # s3 conflicts via run_b
        RunStudent(run_id=run_a.id, user_id=s_fresh.id),  # only on run_a, no conflict
    ])
    db.commit()

    # Add a teacher to run_a so the teacher-count gate passes.
    from mathion.models import RunTeacher
    admin = db.query(User).filter_by(email="admin@example.com").one()
    db.add(RunTeacher(run_id=run_a.id, user_id=admin.id))
    db.commit()

    response = admin_client.post(f"/api/runs/{run_a.id}/publish")
    assert response.status_code == 409
    body = response.json()
    assert body["error_code"] == "student_already_active_in_course"
    # 3 conflicting users (s1, s2, s3) — s_fresh excluded.
    assert {c["user_id"] for c in body["conflicts"]} == {s1.id, s2.id, s3.id}
    # run_a still unpublished.
    db.refresh(run_a)
    assert run_a.is_published is False


def test_publish_run_409_singular_copy_for_n_eq_1(
    admin_client, db, seed_two_published_runs_same_course
):
    """1 conflicting student → singular copy with 'another run'."""
    run_a, _run_b, _s1 = seed_two_published_runs_same_course()
    run_a.is_published = False
    db.add(run_a)
    db.commit()
    db.refresh(run_a)

    from mathion.models import RunTeacher
    admin = db.query(User).filter_by(email="admin@example.com").one()
    db.add(RunTeacher(run_id=run_a.id, user_id=admin.id))
    db.commit()

    response = admin_client.post(f"/api/runs/{run_a.id}/publish")
    assert response.status_code == 409
    body = response.json()
    assert body["detail"] == (
        "1 student cannot be added — already active in another run of this course."
    )


def test_publish_run_409_plural_copy_for_n_geq_2(
    admin_client, db, seed_two_published_runs_same_course
):
    """3 conflicting students → plural copy with 'other runs'."""
    from mathion.models import RunStudent, RunTeacher

    run_a, run_b, _s1 = seed_two_published_runs_same_course()
    run_a.is_published = False
    db.add(run_a)
    db.commit()
    db.refresh(run_a)

    # Add 2 more conflicting students (total 3 with s1).
    s2 = User(email="s2@example.com", full_name="S2")
    s3 = User(email="s3@example.com", full_name="S3")
    db.add_all([s2, s3])
    db.flush()
    db.add_all([
        RunStudent(run_id=run_a.id, user_id=s2.id),
        RunStudent(run_id=run_b.id, user_id=s2.id),
        RunStudent(run_id=run_a.id, user_id=s3.id),
        RunStudent(run_id=run_b.id, user_id=s3.id),
    ])
    admin = db.query(User).filter_by(email="admin@example.com").one()
    db.add(RunTeacher(run_id=run_a.id, user_id=admin.id))
    db.commit()

    response = admin_client.post(f"/api/runs/{run_a.id}/publish")
    assert response.status_code == 409
    body = response.json()
    assert body["detail"] == (
        "3 students cannot be added — already active in other runs of this course."
    )


def test_publish_run_200_when_no_conflicts(
    admin_client, db, seed_publishable_version
):
    """Happy path: draft run with non-conflicting students publishes cleanly."""
    from mathion.models import RunStudent

    _course, version = seed_publishable_version()
    run = _make_publishable_draft(db, version["id"], title="Clean")
    # Add a student not enrolled anywhere else.
    s = User(email="clean@example.com", full_name="Clean")
    db.add(s)
    db.flush()
    db.add(RunStudent(run_id=run.id, user_id=s.id))
    db.commit()

    response = admin_client.post(f"/api/runs/{run.id}/publish")
    assert response.status_code == 200
    db.refresh(run)
    assert run.is_published is True


def test_publish_run_self_skip(
    admin_client, db, seed_publishable_version
):
    """exclude_run_id=run_id ensures the run being published isn't counted
    against itself. Student is only on run_a's roster (a draft). Publishing
    run_a must succeed — the helper must NOT treat run_a as a conflict source."""
    from mathion.models import RunStudent

    _course, version = seed_publishable_version()
    run = _make_publishable_draft(db, version["id"], title="Self")
    s = User(email="self@example.com", full_name="Self")
    db.add(s)
    db.flush()
    db.add(RunStudent(run_id=run.id, user_id=s.id))
    db.commit()

    response = admin_client.post(f"/api/runs/{run.id}/publish")
    assert response.status_code == 200
    db.refresh(run)
    assert run.is_published is True
