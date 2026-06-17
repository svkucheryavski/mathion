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

from tests.conftest import NEAR_DEADLINE_ISO, FAR_DEADLINE_ISO, RUN_END_DATE_FAR


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


def test_resolve_raises_403_when_run_on_disabled_version(
    db, seed_publishable_version,
):
    """A published run on a DISABLED CourseVersion must not be selected,
    even when the student has an active enrollment on ANOTHER non-disabled
    version of the same course. Without the `CourseVersion.is_disabled ==
    False` filter on the Run query, a stale run on a disabled version
    could leak through."""
    from datetime import date as _date

    from mathion.models import CourseVersion, Run, RunStudent
    from mathion.models_auth import StudentEnrollment

    # version_a — non-disabled, has the student's active enrollment but NO run
    course_dict, version_a_dict = seed_publishable_version(
        slug="dual-ver-course", name="Dual",
    )
    version_a = db.get(CourseVersion, version_a_dict["id"])

    # version_b — disabled, will host the stale published run + RunStudent
    version_b = CourseVersion(
        course_id=course_dict["id"], info_md="", state="published", is_disabled=True,
    )
    db.add(version_b); db.flush()

    run_b = Run(
        version_id=version_b.id,
        title="Stale Run on Disabled Version",
        start_date=_date(2026, 1, 1),
        end_date=_date(2026, 6, 1),
        is_published=True,
    )
    db.add(run_b); db.flush()

    student = User(email="dual-ver-student@example.com", full_name="Dual")
    db.add(student); db.flush()

    # Active enrollment on non-disabled version_a (satisfies enrollment gate).
    db.add(StudentEnrollment(
        user_id=student.id, version_id=version_a.id, is_active=True,
    ))
    # Active RunStudent on stale run on disabled version_b.
    db.add(RunStudent(run_id=run_b.id, user_id=student.id))
    db.commit()

    course = db.get(Course, course_dict["id"])
    with pytest.raises(HTTPException) as exc_info:
        _resolve_student_run(db, student, course.slug)
    assert exc_info.value.status_code == 403


def test_resolve_raises_404_when_enrollment_inactive(
    db, seed_publishable_version,
):
    """D2: StudentEnrollment with is_active=False must NOT satisfy the
    enrollment gate, even though a published run + RunStudent exist for
    the student (intentional divergence from /my-version). Expected 404."""
    from datetime import date as _date

    from mathion.models import CourseVersion, Run, RunStudent
    from mathion.models_auth import StudentEnrollment

    course_dict, version_dict = seed_publishable_version(
        slug="inactive-enroll", name="Inactive",
    )
    version = db.get(CourseVersion, version_dict["id"])

    run = Run(
        version_id=version.id,
        title="Spring 26",
        start_date=_date(2026, 1, 1),
        end_date=_date(2026, 6, 1),
        is_published=True,
    )
    db.add(run); db.flush()

    student = User(email="inactive-enroll-student@example.com", full_name="Inact")
    db.add(student); db.flush()

    # Inactive enrollment — fails the D2 gate.
    db.add(StudentEnrollment(
        user_id=student.id, version_id=version.id, is_active=False,
    ))
    # Active RunStudent — irrelevant since enrollment gate fails first.
    db.add(RunStudent(run_id=run.id, user_id=student.id))
    db.commit()

    course = db.get(Course, course_dict["id"])
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


# ============================================================================
# Task B2: GET /api/courses/{slug}/mini-projects — list endpoint
# ============================================================================
#
# These tests drive the HTTP-level contract: the 7-value `latest_status` enum,
# sort order (block.order ASC), error codes, and cross-course isolation (C28).


def test_list_200_empty_when_no_mps(
    admin_client, student_client_for, db, seed_publishable_version
):
    """Student on a published run with NO mini-projects → 200 + []."""
    course, _version = seed_publishable_version()
    run = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01",
              "end_date": RUN_END_DATE_FAR, "groups_enabled": False},
    ).json()
    admin_client.post(
        f"/api/runs/{run['id']}/teachers", json={"email": "teach@example.com"}
    )
    pub = admin_client.post(f"/api/runs/{run['id']}/publish")
    assert pub.status_code == 200, pub.text
    add = admin_client.post(
        f"/api/runs/{run['id']}/students",
        json={"email": "alice@example.com"},
    )
    assert add.status_code == 201, add.text
    sc = student_client_for("alice@example.com")
    resp = sc.get(f"/api/courses/{course['slug']}/mini-projects")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_returns_pending_group_assignment_when_no_group(
    admin_client, student_client_for, db, seed_run_with_published_mp
):
    """Student is RunStudent with group_id=None → latest_status = 'pending_group_assignment'.

    `seed_run_with_published_mp` puts alice in group A and bob in group B; we
    enroll a 3rd student (charlie) with no group_id so the no-group branch fires.
    """
    run, _ga, _gb, mp = seed_run_with_published_mp()
    admin_client.post(
        f"/api/runs/{run['id']}/students",
        json={"email": "charlie@example.com"},
    )
    course = _get_course_for_run(db, db.get(Run, run["id"]))
    sc = student_client_for("charlie@example.com")
    resp = sc.get(f"/api/courses/{course.slug}/mini-projects")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    item = body[0]
    assert item["mp_id"] == mp["id"]
    assert item["latest_status"] == "pending_group_assignment"
    # Deadlines reflected (from the fixture).
    assert item["hard_deadline"] is not None
    assert item["resubmission_deadline"] is not None
    # Block fields populated from the fixture's single block.
    assert item["block_slug"] == "b"
    assert item["block_order"] == 1
    assert item["block_title"] == "B"


def test_list_returns_not_submitted_when_grouped_no_submission(
    student_client_for, db, seed_run_with_published_mp
):
    """Grouped student with no submission yet → 'not_submitted'."""
    _run, _ga, _gb, mp = seed_run_with_published_mp()
    course = _get_course_for_run(db, db.get(Run, _run["id"]))
    sc = student_client_for("alice@example.com")
    resp = sc.get(f"/api/courses/{course.slug}/mini-projects")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["mp_id"] == mp["id"]
    assert body[0]["latest_status"] == "not_submitted"


def test_list_returns_awaiting_evaluation_when_submission_no_eval(
    student_client_for, db, seed_run_with_published_mp
):
    """Submission exists but no Evaluation row → 'awaiting_evaluation'."""
    import io
    _run, _ga, _gb, mp = seed_run_with_published_mp()
    course = _get_course_for_run(db, db.get(Run, _run["id"]))
    sc = student_client_for("alice@example.com")
    sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    resp = sc.get(f"/api/courses/{course.slug}/mini-projects")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["latest_status"] == "awaiting_evaluation"


@pytest.mark.parametrize(
    "result_value", ["rejected", "major_revision", "minor_revision", "accepted"]
)
def test_list_returns_eval_result_status(
    result_value, admin_client, student_client_for, db, seed_run_with_published_mp
):
    """All 4 Evaluation.result values propagate verbatim as `latest_status`."""
    import io
    _run, _ga, _gb, mp = seed_run_with_published_mp()
    course = _get_course_for_run(db, db.get(Run, _run["id"]))
    sc = student_client_for("alice@example.com")
    sub = sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    ).json()
    payload = {"result": result_value}
    files = None
    if result_value != "accepted":
        payload["feedback_text"] = "Feedback"
        files = {"file": ("fb.pdf", io.BytesIO(b"%PDF"), "application/pdf")}
    admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data=payload,
        files=files,
    )

    resp = sc.get(f"/api/courses/{course.slug}/mini-projects")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["latest_status"] == result_value


def test_list_sorted_by_block_order_asc(
    admin_client, student_client_for, db, seed_run_with_published_mp
):
    """Two MPs on different blocks → returned in Block.order ASC."""
    from mathion.models import Block as _Block, Run as _Run
    _run, _ga, _gb, mp1 = seed_run_with_published_mp()
    run_obj = db.get(_Run, _run["id"])
    # Create a second Block with a HIGHER order, then a second MP on it.
    block2 = _Block(
        version_id=run_obj.version_id, title="B2", slug="b2", order=2,
    )
    db.add(block2)
    db.commit()
    db.refresh(block2)
    mp2 = admin_client.post(
        f"/api/runs/{_run['id']}/mini-projects",
        json={
            "block_id": block2.id,
            "assignment_md": "Second mp",
            "hard_deadline": NEAR_DEADLINE_ISO,
            "resubmission_deadline": FAR_DEADLINE_ISO,
        },
    ).json()
    admin_client.post(f"/api/mini-projects/{mp2['id']}/publish")

    course = _get_course_for_run(db, run_obj)
    sc = student_client_for("alice@example.com")
    resp = sc.get(f"/api/courses/{course.slug}/mini-projects")
    assert resp.status_code == 200
    body = resp.json()
    assert [item["mp_id"] for item in body] == [mp1["id"], mp2["id"]]
    assert [item["block_order"] for item in body] == [1, 2]


def test_list_401_when_no_session(client, db, seed_run_with_published_mp):
    """No session cookie → 401."""
    run, _, _, _ = seed_run_with_published_mp()
    course = _get_course_for_run(db, db.get(Run, run["id"]))
    resp = client.get(f"/api/courses/{course.slug}/mini-projects")
    assert resp.status_code == 401


def test_list_403_when_no_active_run(
    student_client_for, db, seed_published_course_version_with_enrollment_only
):
    """Enrolled on a version but no RunStudent → 403."""
    student, course = seed_published_course_version_with_enrollment_only()
    sc = student_client_for(student.email)
    resp = sc.get(f"/api/courses/{course.slug}/mini-projects")
    assert resp.status_code == 403


def test_list_404_when_course_slug_missing(auth_client):
    """Random slug → 404 even for an authed user."""
    resp = auth_client.get("/api/courses/no-such-course/mini-projects")
    assert resp.status_code == 404


def test_list_cross_course_isolation(
    student_client_for, db, seed_student_in_two_courses
):
    """C28: student on Course X AND Course Y; query X → only X's MPs returned."""
    course_x, course_y, x_mp_ids, y_mp_id, student = seed_student_in_two_courses()
    sc = student_client_for(student.email)

    resp_x = sc.get(f"/api/courses/{course_x.slug}/mini-projects")
    assert resp_x.status_code == 200
    returned_x = {item["mp_id"] for item in resp_x.json()}
    assert returned_x == x_mp_ids
    assert y_mp_id not in returned_x

    # Sanity: querying Y returns only Y's MP, not X's.
    resp_y = sc.get(f"/api/courses/{course_y.slug}/mini-projects")
    assert resp_y.status_code == 200
    returned_y = {item["mp_id"] for item in resp_y.json()}
    assert returned_y == {y_mp_id}
    assert not (returned_y & x_mp_ids)
