"""T17: enroll_user_in_run should only write a run_enrolled log row on first enrollment.

Group moves and group unassigns must not produce additional notification rows.

T19: publish_mini_project emits mini_project_published per eligible student.
"""
import pytest
from sqlalchemy import select, delete

from mathion.api.roster_ops import enroll_user_in_run
from mathion.models_auth import NotificationLogEntry, User
from mathion.models import Run, Group
from sqlalchemy.exc import NoResultFound

from tests.conftest import NEAR_DEADLINE_ISO, FAR_DEADLINE_ISO


# ---------------------------------------------------------------------------
# Local fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def seeded_run(seed_run_with_groups, db):
    """Return dict with 'run' (Run ORM) and 'student_user' (User ORM, alice).

    Deletes all pre-existing NotificationLogEntry rows so tests can assert
    on exactly the rows produced by enroll_user_in_run calls.
    """
    run_dict, _ga, _gb = seed_run_with_groups()
    # Remove all seed-created notifications so count assertions start from 0.
    db.execute(delete(NotificationLogEntry))
    db.commit()
    run = db.get(Run, run_dict["id"])
    student_user = db.query(User).filter_by(email="alice@example.com").one()
    return {"run": run, "student_user": student_user}


@pytest.fixture
def seeded_run_with_group(seed_run_with_groups, db):
    """Return dict with 'run', 'group_a', 'group_b', 'student_user'.

    Keeps the original enrollment notification for alice intact so that
    move/unassign tests can assert the total count remains 1.
    """
    run_dict, ga_dict, gb_dict = seed_run_with_groups()
    run = db.get(Run, run_dict["id"])
    group_a = db.get(Group, ga_dict["id"])
    group_b = db.get(Group, gb_dict["id"])
    student_user = db.query(User).filter_by(email="alice@example.com").one()
    return {"run": run, "group_a": group_a, "group_b": group_b, "student_user": student_user}


@pytest.fixture
def seeded_enrolled_user(seeded_run_with_group, db):
    """Return alice — already enrolled in seeded_run_with_group['run'] via group_a.

    Removes bob's run_enrolled row so the total count is exactly 1
    (alice's original enrollment), enabling move/unassign tests to assert == 1.
    """
    bob = db.query(User).filter_by(email="bob@example.com").one()
    db.execute(
        delete(NotificationLogEntry).where(NotificationLogEntry.user_id == bob.id)
    )
    db.commit()
    return seeded_run_with_group["student_user"]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_first_enrollment_writes_log_row(db, seeded_run):
    """A brand-new enrollment produces exactly one run_enrolled log row.

    Uses a fresh user not previously enrolled in the run so enroll_user_in_run
    takes the else-branch (first enrollment).
    """
    # Create a minimal user that has never been enrolled in seeded_run["run"].
    new_user = User(email="newstudent@example.com", full_name="New Student")
    db.add(new_user)
    db.flush()

    enroll_user_in_run(db, new_user, seeded_run["run"], group_id=None)
    db.commit()

    rows = db.execute(
        select(NotificationLogEntry).where(NotificationLogEntry.kind == "run_enrolled")
    ).scalars().all()
    assert len(rows) == 1


def test_group_move_does_not_write_log_row(db, seeded_run_with_group, seeded_enrolled_user):
    """A user already enrolled and then moved to a new group must not add a new log row."""
    enroll_user_in_run(
        db, seeded_enrolled_user, seeded_run_with_group["run"],
        group_id=seeded_run_with_group["group_b"].id,
    )
    db.commit()

    rows = db.execute(
        select(NotificationLogEntry).where(NotificationLogEntry.kind == "run_enrolled")
    ).scalars().all()
    assert len(rows) == 1  # ONLY the original enrollment row


def test_group_unassign_does_not_write_log_row(db, seeded_run_with_group, seeded_enrolled_user):
    """A user already enrolled and then unassigned from a group must not add a new log row."""
    enroll_user_in_run(
        db, seeded_enrolled_user, seeded_run_with_group["run"],
        group_id=None,
    )
    db.commit()

    rows = db.execute(
        select(NotificationLogEntry).where(NotificationLogEntry.kind == "run_enrolled")
    ).scalars().all()
    assert len(rows) == 1


# ---------------------------------------------------------------------------
# T19 helpers
# ---------------------------------------------------------------------------

def _create_draft_mp(admin_client, db, run_id):
    """Create a draft mini-project with valid publish deadlines for a run."""
    from mathion.models import Block, Run as RunModel
    run_obj = db.get(RunModel, run_id)
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    resp = admin_client.post(
        f"/api/runs/{run_id}/mini-projects",
        json={
            "block_id": block.id,
            "assignment_md": "x",
            "hard_deadline": NEAR_DEADLINE_ISO,
            "resubmission_deadline": FAR_DEADLINE_ISO,
        },
    )
    assert resp.status_code == 201, f"create mini-project failed: {resp.json()}"
    mp_id = resp.json()["id"]
    from mathion.models import MiniProject
    return db.get(MiniProject, mp_id)


# ---------------------------------------------------------------------------
# T19 fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def seeded_run_with_students_and_draft_mp(seed_run_with_groups, admin_client, db):
    """Published run, 2 enabled-group students (alice, bob), draft MP with valid deadlines."""
    run_dict, ga, gb = seed_run_with_groups()
    mp = _create_draft_mp(admin_client, db, run_dict["id"])
    db.execute(delete(NotificationLogEntry))
    db.commit()
    from mathion.models import Run as RunModel, RunStudent
    run_obj = db.get(RunModel, run_dict["id"])
    roster = db.execute(select(RunStudent).where(RunStudent.run_id == run_obj.id)).scalars().all()
    roster_ids = [rs.user_id for rs in roster]
    return {"run": run_obj, "mp": mp, "roster_excluding_disabled": roster_ids}


@pytest.fixture
def seeded_run_with_disabled_group_and_draft_mp(seed_run_with_groups, admin_client, db):
    """Published run with one group disabled; disabled-group students must be excluded."""
    run_dict, ga_dict, gb_dict = seed_run_with_groups()
    mp = _create_draft_mp(admin_client, db, run_dict["id"])
    db.execute(delete(NotificationLogEntry))
    db.commit()
    # Disable group_b so bob is excluded
    from mathion.models import Group as GroupModel, Run as RunModel, RunStudent
    gb_obj = db.get(GroupModel, gb_dict["id"])
    gb_obj.is_disabled = True
    db.commit()
    run_obj = db.get(RunModel, run_dict["id"])
    # Collect user IDs in the disabled group
    disabled_rs = db.execute(
        select(RunStudent).where(RunStudent.run_id == run_obj.id, RunStudent.group_id == gb_obj.id)
    ).scalars().all()
    disabled_ids = [rs.user_id for rs in disabled_rs]
    return {"run": run_obj, "mp": mp, "disabled_group_student_ids": disabled_ids}


@pytest.fixture
def seeded_run_with_published_mp(seed_run_with_groups, admin_client, db):
    """Published run with the MP already published (log rows already present)."""
    run_dict, _ga, _gb = seed_run_with_groups()
    mp = _create_draft_mp(admin_client, db, run_dict["id"])
    # First publish to produce the existing log rows
    resp = admin_client.post(f"/api/mini-projects/{mp.id}/publish")
    assert resp.status_code == 200
    db.expire(mp)
    from mathion.models import Run as RunModel, MiniProject
    run_obj = db.get(RunModel, run_dict["id"])
    mp_refreshed = db.get(MiniProject, mp.id)
    return {"run": run_obj, "mp": mp_refreshed}


@pytest.fixture
def seeded_run_no_students_with_draft_mp(seed_publishable_version, admin_client, db):
    """Published run with no students enrolled, draft MP."""
    from tests.conftest import RUN_END_DATE_FAR
    course, _ = seed_publishable_version(slug="nostudents", name="No Students")
    run_resp = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "Empty", "start_date": "2026-01-01", "end_date": RUN_END_DATE_FAR, "groups_enabled": True},
    )
    assert run_resp.status_code == 201
    run_dict = run_resp.json()
    # Run publish requires at least one teacher
    admin_client.post(f"/api/runs/{run_dict['id']}/teachers", json={"email": "teach@example.com"})
    pub = admin_client.post(f"/api/runs/{run_dict['id']}/publish")
    assert pub.status_code == 200
    db.execute(delete(NotificationLogEntry))
    db.commit()
    mp = _create_draft_mp(admin_client, db, run_dict["id"])
    from mathion.models import Run as RunModel
    run_obj = db.get(RunModel, run_dict["id"])
    return {"run": run_obj, "mp": mp}


@pytest.fixture
def seeded_run_with_draft_mp(seed_run_with_groups, admin_client, db):
    """Minimal: published run + one student + draft MP."""
    run_dict, _ga, _gb = seed_run_with_groups()
    mp = _create_draft_mp(admin_client, db, run_dict["id"])
    db.execute(delete(NotificationLogEntry))
    db.commit()
    from mathion.models import Run as RunModel, MiniProject
    run_obj = db.get(RunModel, run_dict["id"])
    mp_refreshed = db.get(MiniProject, mp.id)
    return {"run": run_obj, "mp": mp_refreshed}


# ---------------------------------------------------------------------------
# T19 tests
# ---------------------------------------------------------------------------

def test_mp_publish_writes_per_student(admin_client, seeded_run_with_students_and_draft_mp, db):
    """First publish: each non-disabled-group student gets a log row."""
    fixture = seeded_run_with_students_and_draft_mp
    mp_id = fixture["mp"].id
    expected_recipients = fixture["roster_excluding_disabled"]
    response = admin_client.post(f"/api/mini-projects/{mp_id}/publish")
    assert response.status_code == 200
    rows = db.execute(
        select(NotificationLogEntry).where(
            NotificationLogEntry.kind == "mini_project_published"
        )
    ).scalars().all()
    assert len(rows) == len(expected_recipients)


def test_mp_publish_excludes_disabled_group_students(admin_client, seeded_run_with_disabled_group_and_draft_mp, db):
    fixture = seeded_run_with_disabled_group_and_draft_mp
    mp_id = fixture["mp"].id
    response = admin_client.post(f"/api/mini-projects/{mp_id}/publish")
    assert response.status_code == 200
    rows = db.execute(
        select(NotificationLogEntry).where(
            NotificationLogEntry.kind == "mini_project_published"
        )
    ).scalars().all()
    student_ids = {r.user_id for r in rows}
    for disabled_student_id in fixture["disabled_group_student_ids"]:
        assert disabled_student_id not in student_ids


def test_mp_republish_is_idempotent(admin_client, seeded_run_with_published_mp, db):
    """Re-publishing an already-published MP: no new log rows AND endpoint returns success."""
    fixture = seeded_run_with_published_mp
    mp_id = fixture["mp"].id
    before_ids = {r.id for r in db.execute(
        select(NotificationLogEntry).where(
            NotificationLogEntry.kind == "mini_project_published"
        )
    ).scalars().all()}
    response = admin_client.post(f"/api/mini-projects/{mp_id}/publish")
    assert response.status_code == 200
    after_ids = {r.id for r in db.execute(
        select(NotificationLogEntry).where(
            NotificationLogEntry.kind == "mini_project_published"
        )
    ).scalars().all()}
    assert after_ids == before_ids  # set-equality catches buggy delete+reinsert


def test_mp_publish_no_students_writes_zero_rows(admin_client, seeded_run_no_students_with_draft_mp, db):
    fixture = seeded_run_no_students_with_draft_mp
    mp_id = fixture["mp"].id
    response = admin_client.post(f"/api/mini-projects/{mp_id}/publish")
    assert response.status_code == 200
    rows = db.execute(
        select(NotificationLogEntry).where(
            NotificationLogEntry.kind == "mini_project_published"
        )
    ).scalars().all()
    assert len(rows) == 0


def test_mp_publish_deleted_mp_returns_404(admin_client, seeded_run_with_draft_mp, db):
    """If MP is deleted between get_or_404 and refetch, return 404 not 500."""
    fixture = seeded_run_with_draft_mp
    mp_id = fixture["mp"].id
    # Pre-publish: hand-delete the MP from another session
    db.delete(fixture["mp"]); db.commit()
    response = admin_client.post(f"/api/mini-projects/{mp_id}/publish")
    assert response.status_code == 404
    assert response.json()["detail"] == "MiniProject not found"
