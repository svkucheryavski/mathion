import threading

from sqlalchemy import func, select

from mathion.api import advisory
from mathion.api.helpers import enroll_user_in_run
from mathion.api.run_roster import bulk_move_students, patch_student
from mathion.models import Run, RunStudent
from mathion.models_auth import User
from mathion.schemas import RunStudentBulkMoveRequest, RunStudentUpdate
from tests.conftest import record_lock_calls


def _fill_group_to(db, run_id, group_id, target, make_user):
    """Top up `group_id` (in `run_id`) with fresh RunStudent rows until it has
    exactly `target` members. Direct inserts, no StudentEnrollment — the capacity
    guard only counts RunStudent rows. Commits so the concurrency sessions see it."""
    current = db.scalar(
        select(func.count(RunStudent.id)).where(RunStudent.group_id == group_id)
    )
    for _ in range(target - current):
        u = make_user()
        db.add(RunStudent(run_id=run_id, user_id=u.id, group_id=group_id))
    db.commit()


def test_capacity_race_two_adds_overflow_without_lock(
    concurrency, monkeypatch, seed_run_with_groups, make_user, db
):
    """RED: a group with MAX_GROUP_SIZE-1 members; two threads each add a distinct
    user; both read count=9 at the seam; both insert -> 11 members. Lock removed."""
    run, ga, gb = seed_run_with_groups()
    _fill_group_to(db, run["id"], ga["id"], advisory.MAX_GROUP_SIZE - 1, make_user)

    monkeypatch.setattr(advisory, "advisory_xact_lock", lambda db, ns, *ids: None)
    barrier = threading.Barrier(2)
    real_hook = advisory.interleave_hook

    def hook(label):
        if label == "capacity":
            barrier.wait(timeout=10)
        return real_hook(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)

    u1, u2 = make_user(), make_user()
    (s1,), (s2,) = concurrency.make_sessions(1), concurrency.make_sessions(1)

    def add(sess, uid):
        sess.begin()
        run_obj = sess.get(Run, run["id"])
        user = sess.get(User, uid)
        enroll_user_in_run(sess, user, run_obj, ga["id"])
        sess.commit()

    concurrency.spawn(add, s1, u1.id)
    concurrency.spawn(add, s2, u2.id)
    # join happens in fixture teardown; assert after explicit joins:
    for t in list(concurrency.threads):
        t.join(timeout=10)

    (verify,) = concurrency.make_sessions(1)
    count = verify.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == ga["id"]))
    verify.rollback()
    assert count == advisory.MAX_GROUP_SIZE + 1  # 11 — overflow proven


def test_capacity_lock_prevents_overflow(concurrency, seed_run_with_groups, make_user, db):
    """GREEN: real CAPACITY lock -> one add wins, the other 409s; count stays <= MAX_GROUP_SIZE."""
    run, ga, gb = seed_run_with_groups()
    _fill_group_to(db, run["id"], ga["id"], advisory.MAX_GROUP_SIZE - 1, make_user)
    u1, u2 = make_user(), make_user()
    (s1,), (s2,) = concurrency.make_sessions(1), concurrency.make_sessions(1)
    errors = []

    def add(sess, uid):
        from fastapi import HTTPException
        try:
            sess.begin()
            run_obj = sess.get(Run, run["id"])
            user = sess.get(User, uid)
            enroll_user_in_run(sess, user, run_obj, ga["id"])
            sess.commit()
        except HTTPException as e:
            sess.rollback()
            errors.append(e.status_code)

    concurrency.spawn(add, s1, u1.id)
    concurrency.spawn(add, s2, u2.id)
    for t in list(concurrency.threads):
        t.join(timeout=10)

    (verify,) = concurrency.make_sessions(1)
    count = verify.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == ga["id"]))
    verify.rollback()
    assert count == advisory.MAX_GROUP_SIZE          # exactly 10, no overflow
    assert errors == [409]                            # exactly one loser, a 409


def _seed_two_unassigned_movers(db, run_id, make_user):
    """Two fresh RunStudents in `run_id`, both unassigned (group_id=None) — ready
    to be moved into a group. Returns (m1, m2)."""
    m1, m2 = make_user(), make_user()
    db.add(RunStudent(run_id=run_id, user_id=m1.id, group_id=None))
    db.add(RunStudent(run_id=run_id, user_id=m2.id, group_id=None))
    db.commit()
    return m1, m2


def test_patch_student_move_race_overflow_without_lock(
    concurrency, monkeypatch, seed_run_with_groups, make_user, db
):
    """RED: two concurrent moves into a MAX_GROUP_SIZE-1 group both pass the count
    check at the seam; both write -> 11 members. Lock removed (patch_student move)."""
    run, ga, gb = seed_run_with_groups()
    _fill_group_to(db, run["id"], ga["id"], advisory.MAX_GROUP_SIZE - 1, make_user)
    m1, m2 = _seed_two_unassigned_movers(db, run["id"], make_user)

    monkeypatch.setattr(advisory, "advisory_xact_lock", lambda db, ns, *ids: None)
    barrier = threading.Barrier(2)
    real_hook = advisory.interleave_hook

    def hook(label):
        if label == "capacity":
            barrier.wait(timeout=10)
        return real_hook(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)

    (s1,), (s2,) = concurrency.make_sessions(1), concurrency.make_sessions(1)

    def move(sess, uid):
        admin = sess.scalar(select(User).where(User.email == "admin@example.com"))
        patch_student(run["id"], uid, RunStudentUpdate(group_id=ga["id"]), db=sess, user=admin)

    concurrency.spawn(move, s1, m1.id)
    concurrency.spawn(move, s2, m2.id)
    for t in list(concurrency.threads):
        t.join(timeout=10)

    (verify,) = concurrency.make_sessions(1)
    count = verify.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == ga["id"]))
    verify.rollback()
    assert count == advisory.MAX_GROUP_SIZE + 1  # 11 — overflow proven


def test_patch_student_move_lock_prevents_overflow(
    concurrency, seed_run_with_groups, make_user, db
):
    """GREEN: real CAPACITY lock -> one move wins, the other 409s; count stays 10."""
    run, ga, gb = seed_run_with_groups()
    _fill_group_to(db, run["id"], ga["id"], advisory.MAX_GROUP_SIZE - 1, make_user)
    m1, m2 = _seed_two_unassigned_movers(db, run["id"], make_user)

    (s1,), (s2,) = concurrency.make_sessions(1), concurrency.make_sessions(1)
    errors = []

    def move(sess, uid):
        from fastapi import HTTPException
        try:
            admin = sess.scalar(select(User).where(User.email == "admin@example.com"))
            patch_student(run["id"], uid, RunStudentUpdate(group_id=ga["id"]), db=sess, user=admin)
        except HTTPException as e:
            sess.rollback()
            errors.append(e.status_code)

    concurrency.spawn(move, s1, m1.id)
    concurrency.spawn(move, s2, m2.id)
    for t in list(concurrency.threads):
        t.join(timeout=10)

    (verify,) = concurrency.make_sessions(1)
    count = verify.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == ga["id"]))
    verify.rollback()
    assert count == advisory.MAX_GROUP_SIZE
    assert errors == [409]


def _scalar_ordering_spy(db, events):
    """Shadow db.scalar so the FIRST count-read records whether a lock was already
    logged into `events`. Returns the read_seen dict (read_seen['after_lock'])."""
    read_seen = {"after_lock": None}
    real_scalar = db.scalar

    def scalar_spy(*a, **k):
        if read_seen["after_lock"] is None:
            read_seen["after_lock"] = len(events) > 0
        return real_scalar(*a, **k)

    db.scalar = scalar_spy
    return read_seen


def test_capacity_wiring_and_ordering(monkeypatch, seed_run_with_groups, make_user, db):
    """Single-threaded: enroll_user_in_run records a CAPACITY(run_id) lock, and the
    lock is recorded BEFORE the group-count guard read."""
    run, ga, gb = seed_run_with_groups()
    user = make_user()
    run_obj = db.get(Run, run["id"])

    # Record locks AFTER the seed (which itself enrolls alice/bob) so `events`
    # starts empty and the ordering assertion is not falsely satisfied by seed locks.
    events = record_lock_calls(monkeypatch)
    read_seen = _scalar_ordering_spy(db, events)

    enroll_user_in_run(db, user, run_obj, ga["id"])
    assert ("lock", advisory.LOCK_NS_CAPACITY, (run_obj.id,)) in events
    assert read_seen["after_lock"] is True   # count read happened AFTER the lock


def test_patch_student_capacity_wiring_and_ordering(
    monkeypatch, seed_run_with_groups, make_user, db, superuser
):
    """Single-threaded: patch_student move records a CAPACITY(run_id) lock BEFORE
    its group-count guard read."""
    run, ga, gb = seed_run_with_groups()
    (mover,) = (make_user(),)
    db.add(RunStudent(run_id=run["id"], user_id=mover.id, group_id=None))
    db.commit()

    events = record_lock_calls(monkeypatch)
    read_seen = _scalar_ordering_spy(db, events)

    patch_student(run["id"], mover.id, RunStudentUpdate(group_id=ga["id"]), db=db, user=superuser)
    assert ("lock", advisory.LOCK_NS_CAPACITY, (run["id"],)) in events
    assert read_seen["after_lock"] is True


def test_bulk_move_capacity_wiring_and_ordering(
    monkeypatch, seed_run_with_groups, make_user, db, superuser
):
    """Single-threaded: bulk_move acquires CAPACITY(run_id) EXACTLY ONCE, before the
    first per-row count read (one run-keyed acquire covers every row)."""
    run, ga, gb = seed_run_with_groups()
    m1, m2 = _seed_two_unassigned_movers(db, run["id"], make_user)

    events = record_lock_calls(monkeypatch)
    read_seen = _scalar_ordering_spy(db, events)

    bulk_move_students(
        run["id"],
        RunStudentBulkMoveRequest(user_ids=[m1.id, m2.id], group_id=ga["id"]),
        db=db,
        user=superuser,
    )
    assert events == [("lock", advisory.LOCK_NS_CAPACITY, (run["id"],))]  # once, before loop
    assert read_seen["after_lock"] is True
