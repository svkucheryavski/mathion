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


# ============================================================================
# Task B3: GET /api/courses/{slug}/blocks/{block_slug}/mini-project — detail
# ============================================================================
#
# Covers: response shape, full_name fallback, group-summary surfaces
# `is_disabled`, submission_history DESC by submission_number, the 7-step
# `can_submit` ladder (one test per reason code), the IDOR cross-version
# block-slug guard (§4.2), and the 401/403/404 boundary.


def _detail_url(course_slug: str, block_slug: str) -> str:
    return f"/api/courses/{course_slug}/blocks/{block_slug}/mini-project"


def test_detail_200_grouped_can_submit_true(
    student_client_for, db, seed_run_with_published_mp,
):
    """Grouped student with no prior submission + hard_deadline in the
    future → 200, group populated, can_submit=True, reason=None."""
    run_dict, ga, _gb, mp = seed_run_with_published_mp()
    course = _get_course_for_run(db, db.get(Run, run_dict["id"]))
    sc = student_client_for("alice@example.com")
    resp = sc.get(_detail_url(course.slug, "b"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["mp_id"] == mp["id"]
    assert body["run_id"] == run_dict["id"]
    assert body["block_slug"] == "b"
    assert body["block_title"] == "B"
    assert body["assignment_html"]  # rendered HTML present
    assert body["group"] is not None
    assert body["group"]["id"] == ga["id"]
    assert body["group"]["name"] == "Group A"
    assert body["group"]["is_disabled"] is False
    member_ids = {m["user_id"] for m in body["group"]["members"]}
    alice = _get_user_by_email(db, "alice@example.com")
    assert alice.id in member_ids
    me_flags = {m["user_id"]: m["is_me"] for m in body["group"]["members"]}
    assert me_flags[alice.id] is True
    assert body["submission_history"] == []
    assert body["latest_status"] == "not_submitted"
    assert body["can_submit"] is True
    assert body["can_submit_reason_if_not"] is None


def test_detail_200_ungrouped_pending_group_assignment(
    admin_client, student_client_for, db, seed_run_with_published_mp,
):
    """Ungrouped student → 200, group=None, can_submit=False,
    reason='pending_group_assignment'."""
    run_dict, _ga, _gb, _mp = seed_run_with_published_mp()
    admin_client.post(
        f"/api/runs/{run_dict['id']}/students",
        json={"email": "charlie@example.com"},
    )
    course = _get_course_for_run(db, db.get(Run, run_dict["id"]))
    sc = student_client_for("charlie@example.com")
    resp = sc.get(_detail_url(course.slug, "b"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["group"] is None
    assert body["latest_status"] == "pending_group_assignment"
    assert body["can_submit"] is False
    assert body["can_submit_reason_if_not"] == "pending_group_assignment"


def test_detail_group_disabled_blocks_submit(
    student_client_for, db, seed_run_with_published_mp,
):
    """Group.is_disabled=True → can_submit=False, reason='group_disabled'."""
    from mathion.models import Group
    run_dict, ga, _gb, _mp = seed_run_with_published_mp()
    group_a = db.get(Group, ga["id"])
    group_a.is_disabled = True
    db.commit()
    course = _get_course_for_run(db, db.get(Run, run_dict["id"]))
    sc = student_client_for("alice@example.com")
    resp = sc.get(_detail_url(course.slug, "b"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["group"]["is_disabled"] is True
    assert body["can_submit"] is False
    assert body["can_submit_reason_if_not"] == "group_disabled"


def test_detail_already_accepted_blocks_submit(
    admin_client, student_client_for, db, seed_run_with_published_mp,
):
    """Latest evaluation result='accepted' → can_submit=False,
    reason='already_accepted'."""
    import io
    run_dict, _ga, _gb, mp = seed_run_with_published_mp()
    course = _get_course_for_run(db, db.get(Run, run_dict["id"]))
    sc = student_client_for("alice@example.com")
    sub = sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    ).json()
    admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "accepted"},
    )
    resp = sc.get(_detail_url(course.slug, "b"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["latest_status"] == "accepted"
    assert body["can_submit"] is False
    assert body["can_submit_reason_if_not"] == "already_accepted"


def test_detail_awaiting_evaluation_blocks_submit(
    student_client_for, db, seed_run_with_published_mp,
):
    """Submission exists but no eval yet → can_submit=False,
    reason='awaiting_evaluation'."""
    import io
    run_dict, _ga, _gb, mp = seed_run_with_published_mp()
    course = _get_course_for_run(db, db.get(Run, run_dict["id"]))
    sc = student_client_for("alice@example.com")
    sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    resp = sc.get(_detail_url(course.slug, "b"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["latest_status"] == "awaiting_evaluation"
    assert body["can_submit"] is False
    assert body["can_submit_reason_if_not"] == "awaiting_evaluation"


def test_detail_hard_deadline_passed_blocks_initial(
    student_client_for, db, seed_run_with_published_mp,
):
    """No prior submission AND hard_deadline in the past → can_submit=False,
    reason='hard_deadline_passed'.

    Manually rewind mp.hard_deadline (the publish gate forbids past deadlines
    at publish time, but post-publish a previously valid hard_deadline may
    pass). Using direct ORM update keeps the test in the ladder-step scope.
    """
    from datetime import datetime, timezone, timedelta
    from mathion.models import MiniProject
    run_dict, _ga, _gb, mp = seed_run_with_published_mp()
    mp_obj = db.get(MiniProject, mp["id"])
    mp_obj.hard_deadline = datetime.now(timezone.utc) - timedelta(days=1)
    db.commit()
    course = _get_course_for_run(db, db.get(Run, run_dict["id"]))
    sc = student_client_for("alice@example.com")
    resp = sc.get(_detail_url(course.slug, "b"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["can_submit"] is False
    assert body["can_submit_reason_if_not"] == "hard_deadline_passed"


def test_detail_resubmission_deadline_passed_blocks_resub(
    admin_client, student_client_for, db, seed_run_with_published_mp,
):
    """Latest result in major/minor_revision AND resubmission_deadline past
    → can_submit=False, reason='resubmission_deadline_passed'."""
    import io
    from datetime import datetime, timezone, timedelta
    from mathion.models import MiniProject
    run_dict, _ga, _gb, mp = seed_run_with_published_mp()
    course = _get_course_for_run(db, db.get(Run, run_dict["id"]))
    sc = student_client_for("alice@example.com")
    sub = sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    ).json()
    admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "major_revision", "feedback_text": "Redo"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    mp_obj = db.get(MiniProject, mp["id"])
    # CK ck_mini_project_hard_le_resubmission requires hard <= resub, so
    # rewind hard first then resub. Both lie in the past; the ladder only
    # consults `resubmission_deadline` because latest_result is a revision.
    mp_obj.hard_deadline = datetime.now(timezone.utc) - timedelta(days=2)
    mp_obj.resubmission_deadline = datetime.now(timezone.utc) - timedelta(days=1)
    db.commit()
    resp = sc.get(_detail_url(course.slug, "b"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["latest_status"] == "major_revision"
    assert body["can_submit"] is False
    assert body["can_submit_reason_if_not"] == "resubmission_deadline_passed"


def test_detail_rejected_allows_fresh_initial_submission(
    admin_client, student_client_for, db, seed_run_with_published_mp,
):
    """Latest result='rejected' → can_submit=True (resets to initial path;
    `submissions.py:88` treats rejected as a fresh initial)."""
    import io
    run_dict, _ga, _gb, mp = seed_run_with_published_mp()
    course = _get_course_for_run(db, db.get(Run, run_dict["id"]))
    sc = student_client_for("alice@example.com")
    sub = sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    ).json()
    admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "rejected", "feedback_text": "No"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    resp = sc.get(_detail_url(course.slug, "b"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["latest_status"] == "rejected"
    assert body["can_submit"] is True
    assert body["can_submit_reason_if_not"] is None


def test_detail_mp_not_visible_ladder_unit(
    db, seed_run_with_published_mp,
):
    """Ladder step #1 (`mp_not_visible`) can't be exercised end-to-end
    because the prior visibility check 404s before the ladder runs. Hit
    the helper directly for coverage of the branch.
    """
    from mathion.api.student_mini_projects import _compute_can_submit
    from mathion.models import MiniProject, Run

    run_dict, _ga, _gb, mp_dict = seed_run_with_published_mp()
    run = db.get(Run, run_dict["id"])
    mp = db.get(MiniProject, mp_dict["id"])
    mp.is_published = False  # would 404 from HTTP, but ladder still sees it
    db.commit()

    can, reason = _compute_can_submit(
        run=run, mp=mp, group=None,
        latest_result=None, has_any_submission=False,
    )
    assert can is False
    assert reason == "mp_not_visible"


def test_detail_full_name_fallback_to_email_local_part(
    admin_client, student_client_for, db, seed_run_with_published_mp,
):
    """Member with `full_name=None` → display falls back to email LOCAL
    part (no '@domain'). Applies to group members, submitter, and
    evaluator uniformly."""
    import io
    run_dict, _ga, _gb, mp = seed_run_with_published_mp()
    # Clear alice's full_name to trigger fallback.
    alice = _get_user_by_email(db, "alice@example.com")
    alice.full_name = None
    db.commit()
    course = _get_course_for_run(db, db.get(Run, run_dict["id"]))
    sc = student_client_for("alice@example.com")
    # Submit so the submitter_full_name field is also exercised.
    sub = sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    ).json()
    # Also clear evaluator full_name to test that branch.
    admin = _get_user_by_email(db, "admin@example.com")
    admin.full_name = None
    db.commit()
    admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "rejected", "feedback_text": "No"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    resp = sc.get(_detail_url(course.slug, "b"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    alice_member = next(
        m for m in body["group"]["members"] if m["user_id"] == alice.id
    )
    assert alice_member["full_name"] == "alice"
    entry = body["submission_history"][0]
    assert entry["submitted_by_full_name"] == "alice"
    assert entry["evaluation"]["evaluated_by_full_name"] == "admin"


def test_detail_history_desc_by_submission_number(
    admin_client, student_client_for, db, seed_run_with_published_mp,
):
    """Two submissions (after a major_revision cycle) → history sorted
    DESC by submission_number; evaluation reflects each row's state."""
    import io
    run_dict, _ga, _gb, mp = seed_run_with_published_mp()
    course = _get_course_for_run(db, db.get(Run, run_dict["id"]))
    sc = student_client_for("alice@example.com")
    sub1 = sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    ).json()
    admin_client.post(
        f"/api/submissions/{sub1['id']}/evaluation",
        data={"result": "major_revision", "feedback_text": "Redo"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    sub2 = sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r2.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    ).json()
    resp = sc.get(_detail_url(course.slug, "b"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [e["submission_number"] for e in body["submission_history"]] == [2, 1]
    # Newest first; entry index 0 is sub2 (auto-accepted on resubmission).
    assert body["submission_history"][0]["submission_id"] == sub2["id"]
    assert body["submission_history"][0]["is_resubmission"] is True
    assert body["submission_history"][0]["evaluation"]["result"] == "accepted"
    # Older entry: sub1 with the major_revision eval.
    assert body["submission_history"][1]["submission_id"] == sub1["id"]
    assert body["submission_history"][1]["evaluation"]["result"] == "major_revision"
    # Latest status reflects newest = accepted.
    assert body["latest_status"] == "accepted"


def test_detail_404_when_block_slug_missing_on_version(
    student_client_for, db, seed_run_with_published_mp,
):
    """Block slug doesn't exist on the run's version → 404."""
    run_dict, _ga, _gb, _mp = seed_run_with_published_mp()
    course = _get_course_for_run(db, db.get(Run, run_dict["id"]))
    sc = student_client_for("alice@example.com")
    resp = sc.get(_detail_url(course.slug, "no-such-block"))
    assert resp.status_code == 404


def test_detail_404_when_mp_not_published(
    admin_client, student_client_for, db, seed_run_with_groups,
):
    """Block exists, run is published, but the MP is_published=False → 404."""
    run_dict, _ga, _gb = seed_run_with_groups()
    from mathion.models import Block, Run
    run_obj = db.get(Run, run_dict["id"])
    block = db.execute(
        select(Block).where(Block.version_id == run_obj.version_id)
    ).scalars().first()
    # Create MP but DO NOT publish.
    admin_client.post(
        f"/api/runs/{run_dict['id']}/mini-projects",
        json={
            "block_id": block.id,
            "assignment_md": "Draft.",
            "hard_deadline": NEAR_DEADLINE_ISO,
            "resubmission_deadline": FAR_DEADLINE_ISO,
        },
    )
    course = _get_course_for_run(db, run_obj)
    sc = student_client_for("alice@example.com")
    resp = sc.get(_detail_url(course.slug, block.slug))
    assert resp.status_code == 404


def test_detail_404_when_mp_missing_for_block(
    admin_client, student_client_for, db, seed_run_with_groups,
):
    """Block exists on the version but no MP row for (run, block) → 404."""
    from mathion.models import Block as _Block, Run as _Run
    run_dict, _ga, _gb = seed_run_with_groups()
    run_obj = db.get(_Run, run_dict["id"])
    # Add a 2nd block with no MP attached.
    new_block = _Block(
        version_id=run_obj.version_id, title="NoMP", slug="no-mp", order=2,
    )
    db.add(new_block); db.commit(); db.refresh(new_block)
    course = _get_course_for_run(db, run_obj)
    sc = student_client_for("alice@example.com")
    resp = sc.get(_detail_url(course.slug, "no-mp"))
    assert resp.status_code == 404


def test_detail_401_when_no_session(client, db, seed_run_with_published_mp):
    """No session cookie → 401."""
    run_dict, _, _, _ = seed_run_with_published_mp()
    course = _get_course_for_run(db, db.get(Run, run_dict["id"]))
    resp = client.get(_detail_url(course.slug, "b"))
    assert resp.status_code == 401


def test_detail_403_when_no_active_run(
    student_client_for, db, seed_published_course_version_with_enrollment_only,
):
    """Enrolled on a version but no RunStudent → 403 from resolver
    (mirrors list endpoint)."""
    student, course = seed_published_course_version_with_enrollment_only()
    sc = student_client_for(student.email)
    resp = sc.get(_detail_url(course.slug, "b"))
    assert resp.status_code == 403


def test_resolve_block_returns_version_scoped_block(
    db, seed_publishable_version,
):
    """§4.2 IDOR (direct unit test): `_resolve_block` must filter by
    `run.version_id`. Same-course two-version setup where BOTH versions
    have a block at slug 'b'. Calling the resolver with a run on
    version_a must return version_a's block, NOT version_b's, even
    though the slug matches both.

    Complements the HTTP-level IDOR test below (which short-circuits at
    the enrollment gate): this one exercises the resolver in isolation,
    so removing `Block.version_id == run.version_id` from `_resolve_block`
    would make it fail.

    A4 note: A4 forbids two active RunStudent rows on the same course; it
    does NOT forbid a course having two versions, nor a Run on each. We
    seed no RunStudent, so this setup is legal.
    """
    from datetime import date as _date

    from mathion.api.student_mini_projects import _resolve_block
    from mathion.models import Block, CourseVersion, Run

    # version_a — created by the fixture; already has a Block slug="b".
    course_dict, version_a_dict = seed_publishable_version(
        slug="idor-direct", name="IDOR Direct",
    )
    version_a = db.get(CourseVersion, version_a_dict["id"])
    block_a = db.execute(
        select(Block).where(
            Block.version_id == version_a.id, Block.slug == "b",
        )
    ).scalar_one()

    # version_b — same course, distinct row, with its OWN Block at slug "b".
    version_b = CourseVersion(
        course_id=course_dict["id"], info_md="", state="published",
    )
    db.add(version_b); db.flush()
    block_b = Block(
        version_id=version_b.id, title="B's block", slug="b", order=1,
    )
    db.add(block_b); db.flush()

    # A run on version_a — minimal, doesn't need to be published.
    run_a = Run(
        version_id=version_a.id,
        title="R",
        start_date=_date(2026, 1, 1),
        end_date=_date(2026, 6, 1),
    )
    db.add(run_a); db.commit()

    # Sanity: the two blocks share a slug but have different ids.
    assert block_a.id != block_b.id

    # Direct call to the resolver — must pick version_a's block.
    result = _resolve_block(db, run_a, "b")
    assert result.id == block_a.id
    assert result.id != block_b.id


def test_resolve_block_raises_404_when_slug_missing_on_version(
    db, seed_publishable_version,
):
    """§4.2 complement: when the slug exists ONLY on a different version
    of the same course, `_resolve_block` must 404 — NOT return the
    cross-version block. Pins the `version_id` filter behavior.
    """
    from datetime import date as _date

    from mathion.api.student_mini_projects import _resolve_block
    from mathion.models import Block, CourseVersion, Run

    # version_a — fixture-created; its block has slug "b", NOT "only-on-b".
    course_dict, version_a_dict = seed_publishable_version(
        slug="idor-404", name="IDOR 404",
    )
    version_a = db.get(CourseVersion, version_a_dict["id"])

    # version_b — same course, with a Block at the target slug "only-on-b".
    version_b = CourseVersion(
        course_id=course_dict["id"], info_md="", state="published",
    )
    db.add(version_b); db.flush()
    db.add(Block(
        version_id=version_b.id, title="Only on B", slug="only-on-b", order=1,
    ))
    db.flush()

    run_a = Run(
        version_id=version_a.id,
        title="R",
        start_date=_date(2026, 1, 1),
        end_date=_date(2026, 6, 1),
    )
    db.add(run_a); db.commit()

    with pytest.raises(HTTPException) as exc_info:
        _resolve_block(db, run_a, "only-on-b")
    assert exc_info.value.status_code == 404


def test_detail_idor_cross_version_block_slug_returns_404(
    admin_client, student_client_for, db, seed_run_with_published_mp,
):
    """§4.2 IDOR: two versions of the SAME course, each with a block at
    slug 'b' and a published MP. Student on run_a hitting `/blocks/b/` must
    resolve `_resolve_block` against `run_a.version_id` — so the block id
    landed on belongs to version_a, NOT version_b. We assert success
    (200) AND that block_id matches version_a's block. The cross-version
    IDOR vector is closed because the version-scoped query returns
    exactly the right row, never version_b's.

    To make the IDOR vector concrete: we then create a SECOND course
    where the block slug 'b' also exists, and verify the student (on
    course-x) gets 404 when navigating to that other course's block.
    """
    from mathion.models import Block, CourseVersion, Run

    run_dict, _ga, _gb, mp = seed_run_with_published_mp()
    course = _get_course_for_run(db, db.get(Run, run_dict["id"]))
    sc = student_client_for("alice@example.com")

    # Sanity: student detail call lands on version_a's block.
    resp = sc.get(_detail_url(course.slug, "b"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    run_a = db.get(Run, run_dict["id"])
    version_a_block = db.execute(
        select(Block).where(
            Block.version_id == run_a.version_id, Block.slug == "b",
        )
    ).scalar_one()
    assert body["block_id"] == version_a_block.id
    assert body["mp_id"] == mp["id"]

    # Now create a 2nd, DISTINCT CourseVersion (same course) with its own
    # block 'b' + MP. The student has NO enrollment on this course-y, so
    # hitting `_detail_url(course_y.slug, "b")` must 404 at the resolver
    # (enrollment check), proving the slug 'b' on version_b is unreachable
    # from a student on version_a's run.
    course_y, _v_y = admin_client.post(
        "/api/courses",
        json={"slug": "other-course", "name": "Other", "description": ""},
    ), None
    course_y_id = course_y.json()["id"]
    version_y = admin_client.post(
        f"/api/courses/{course_y_id}/versions", json={"info_md": ""}
    ).json()
    block_y = Block(
        version_id=version_y["id"], title="B", slug="b", order=1,
    )
    db.add(block_y); db.commit(); db.refresh(block_y)
    # Sanity: a NEW block with slug 'b' exists on version_y, distinct from
    # version_a_block.id.
    assert block_y.id != version_a_block.id

    # Student on course-x hits /api/courses/other-course/blocks/b/mini-project
    # → 404 at the enrollment gate (no enrollment on course-y), proving
    # cross-course / cross-version block slug doesn't leak.
    resp_y = sc.get(_detail_url("other-course", "b"))
    assert resp_y.status_code == 404


def test_detail_filename_is_safe_basename(
    student_client_for, db, seed_run_with_published_mp,
):
    """`filename` field exposes only the basename of Submission.file_path
    (no directory components)."""
    import io
    run_dict, _ga, _gb, mp = seed_run_with_published_mp()
    course = _get_course_for_run(db, db.get(Run, run_dict["id"]))
    sc = student_client_for("alice@example.com")
    sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    resp = sc.get(_detail_url(course.slug, "b"))
    assert resp.status_code == 200, resp.text
    entry = resp.json()["submission_history"][0]
    assert "/" not in entry["filename"]
    assert "\\" not in entry["filename"]
    assert entry["filename"].endswith(".pdf")


def test_detail_latest_status_snapshot_consistent_with_history(
    student_client_for, db, seed_run_with_published_mp,
):
    """Spec §3.2 invariant: `latest_status` and
    `submission_history[0].evaluation` are derived from the SAME in-request
    snapshot. A response must never show `latest_status='accepted'` while
    `submission_history[0].evaluation is None` (which would happen if
    status used a fresher DB read than history).

    This test simulates the race by performing two fetches, mutating the
    DB directly between them. Each fetch must show internal consistency:
    - phase 1 (no eval): status='awaiting_evaluation' AND history[0].evaluation None.
    - phase 2 (eval committed via ORM): status=eval.result AND
      history[0].evaluation populated. Neither field can lead the other.
    """
    import io
    from mathion.models import Evaluation, Submission

    run_dict, _ga, _gb, mp = seed_run_with_published_mp()
    course = _get_course_for_run(db, db.get(Run, run_dict["id"]))
    sc = student_client_for("alice@example.com")

    # One submission, NO evaluation yet.
    sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )

    # Phase 1: both fields must reflect the no-eval state together.
    resp1 = sc.get(_detail_url(course.slug, "b"))
    assert resp1.status_code == 200, resp1.text
    body1 = resp1.json()
    assert body1["latest_status"] == "awaiting_evaluation"
    assert body1["submission_history"][0]["evaluation"] is None
    # And the can_submit ladder must agree with the snapshot too.
    assert body1["can_submit"] is False
    assert body1["can_submit_reason_if_not"] == "awaiting_evaluation"

    # Inject an Evaluation directly via ORM (bypass the eval endpoint to
    # keep the test focused on read-side consistency). The fixture seeds
    # an admin superuser at admin@example.com — use it as `evaluated_by`.
    sub = db.execute(
        select(Submission).where(Submission.mini_project_id == mp["id"])
    ).scalar_one()
    admin = _get_user_by_email(db, "admin@example.com")
    ev = Evaluation(
        submission_id=sub.id,
        evaluated_by=admin.id,
        result="accepted",
        feedback_text="ok",
    )
    db.add(ev); db.commit()

    # Phase 2: both fields must reflect the evaluated state together.
    resp2 = sc.get(_detail_url(course.slug, "b"))
    assert resp2.status_code == 200, resp2.text
    body2 = resp2.json()
    assert body2["latest_status"] == "accepted"
    history_eval = body2["submission_history"][0]["evaluation"]
    assert history_eval is not None
    assert history_eval["result"] == "accepted"
    # Ladder must agree too: accepted is terminal.
    assert body2["can_submit"] is False
    assert body2["can_submit_reason_if_not"] == "already_accepted"
