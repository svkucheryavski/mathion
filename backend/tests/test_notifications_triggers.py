"""T17: enroll_user_in_run should only write a run_enrolled log row on first enrollment.

Group moves and group unassigns must not produce additional notification rows.
"""
import pytest
from sqlalchemy import select, delete

from mathion.api.helpers import enroll_user_in_run
from mathion.models_auth import NotificationLogEntry, User
from mathion.models import Run, Group


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
