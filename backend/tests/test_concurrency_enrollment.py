"""Phase 9-A2 — invariant #2 (one active enrollment per (student, course)).

Enforced PER-TABLE on BOTH RunStudent (add_student / publish_run) and
StudentEnrollment (enroll_student / enroll_batch -> _enroll_user), all keyed on
ENROLLMENT(course_id). See spec §5.2 / §6 and the Task 3 brief.

Off-HTTP semantics (spec §6 "Off-HTTP semantics & fabrication"): thread bodies
call the router/service functions directly with per-thread sessions. add_student
RETURNS JSONResponse(409) on conflict (does not raise); _enroll_user neither
raises nor returns a 409 — its invariant is asserted by active-row COUNT.
"""

from datetime import date as _date
import threading
import time

from fastapi.responses import JSONResponse
from sqlalchemy import func, select, text

from mathion.api import advisory
from mathion.api.enrollment import _enroll_user, enroll_batch, enroll_student
from mathion.api.lookups import get_newest_published_version, get_or_404, get_or_create_user
from mathion.api.authz import require_course_admin
from mathion.api.roster_ops import enroll_user_in_run, find_student_active_conflicts
from mathion.api.run_roster import add_student
from mathion.models import Course, CourseVersion, Run, RunStudent, RunTeacher
from mathion.models_auth import StudentEnrollment, User
from mathion.schemas import EnrollBatchRequest, EnrollRequest, RunStudentCreate
from tests.conftest import record_lock_calls


def _course_two_versions_two_runs(db, seed_publishable_version):
    """Course with TWO versions, one published run on each version (both runs
    belong to the SAME course). Two DIFFERENT versions so both enrollment paths
    can write distinct StudentEnrollment(user, version) rows without colliding on
    the (user_id, version_id) unique index — which isolates the RunStudent
    invariant under test (a shared version would make _enroll_user collide first,
    masking the RunStudent race). add_student gates only on run.is_published and
    version.is_disabled (neither requires the 2nd version to be *published*), and
    find_student_active_conflicts scopes by course_id across versions.

    Returns (course_id, v1_id, v2_id, run_a_id, run_b_id).
    """
    course, version1 = seed_publishable_version()
    course_id = course["id"]
    v2 = CourseVersion(course_id=course_id, info_md="", info_html="")
    db.add(v2)
    db.flush()
    run_a = Run(version_id=version1["id"], title="Run A",
                start_date=_date(2026, 1, 1), end_date=_date(2030, 1, 1), is_published=True)
    run_b = Run(version_id=v2.id, title="Run B",
                start_date=_date(2026, 1, 1), end_date=_date(2030, 1, 1), is_published=True)
    db.add_all([run_a, run_b])
    db.commit()
    return course_id, version1["id"], v2.id, run_a.id, run_b.id


def _active_runstudent_count(sess, user_id, run_ids):
    return sess.scalar(
        select(func.count(RunStudent.id)).where(
            RunStudent.user_id == user_id,
            RunStudent.run_id.in_(run_ids),
        )
    )


# --------------------------------------------------------------------------
# Step 1 / §6 "#2 RunStudent — symmetric": pre-existing student, two runs.
# --------------------------------------------------------------------------


def test_runstudent_race_two_runs_without_lock(
    concurrency, monkeypatch, db, seed_publishable_version, make_user
):
    """RED (spec §6 '#2 RunStudent — symmetric'): a pre-existing student is added
    to two different runs of ONE course; both threads find_student_active_conflicts
    empty at the seam; release both -> the student ends up active in BOTH runs.
    ENROLLMENT lock monkeypatched to a no-op. Symmetric barrier at the
    'enrollment_runstudent' seam (a pre-existing user does not INSERT into the
    users index, so both threads reach the seam without index contention)."""
    course_id, v1, v2, run_a, run_b = _course_two_versions_two_runs(db, seed_publishable_version)
    student = make_user(email="student@example.com")

    monkeypatch.setattr(advisory, "advisory_xact_lock", lambda db, ns, *ids: None)
    barrier = threading.Barrier(2)
    real_hook = advisory.interleave_hook

    def hook(label):
        if label == "enrollment_runstudent":
            barrier.wait(timeout=10)
        return real_hook(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)

    s1, s2 = concurrency.make_sessions(2)
    errors = []

    def add(sess, run_id):
        try:
            admin = sess.scalar(select(User).where(User.email == "admin@example.com"))
            resp = add_student(run_id, RunStudentCreate(email="student@example.com"),
                               db=sess, user=admin)
            if isinstance(resp, JSONResponse):
                sess.rollback()
        except Exception as exc:  # surface silent thread failures
            errors.append(repr(exc))
            sess.rollback()

    concurrency.spawn(add, s1, run_a)
    concurrency.spawn(add, s2, run_b)
    for t in list(concurrency.threads):
        t.join(timeout=10)

    assert errors == [], f"threads failed: {errors}"
    (verify,) = concurrency.make_sessions(1)
    active = _active_runstudent_count(verify, student.id, [run_a, run_b])
    verify.rollback()
    assert active == 2  # invariant #2 violated: active in BOTH runs


def test_runstudent_lock_prevents_double_active(
    concurrency, db, seed_publishable_version, make_user
):
    """GREEN: real ENROLLMENT(course_id) lock -> the two adds serialize; one wins
    (enrolls), the other re-reads under the lock, sees the committed RunStudent and
    returns JSONResponse(409). Exactly ONE active RunStudent. Free-running (no
    seam engaged): the outcome is deterministic regardless of which thread wins."""
    course_id, v1, v2, run_a, run_b = _course_two_versions_two_runs(db, seed_publishable_version)
    student = make_user(email="student@example.com")

    s1, s2 = concurrency.make_sessions(2)
    statuses = []

    def add(sess, run_id):
        admin = sess.scalar(select(User).where(User.email == "admin@example.com"))
        resp = add_student(run_id, RunStudentCreate(email="student@example.com"),
                           db=sess, user=admin)
        if isinstance(resp, JSONResponse):
            sess.rollback()
            statuses.append(resp.status_code)
        else:
            statuses.append(201)

    concurrency.spawn(add, s1, run_a)
    concurrency.spawn(add, s2, run_b)
    for t in list(concurrency.threads):
        t.join(timeout=10)

    (verify,) = concurrency.make_sessions(1)
    active = _active_runstudent_count(verify, student.id, [run_a, run_b])
    verify.rollback()
    assert active == 1                    # no double-active
    assert sorted(statuses) == [201, 409]  # exactly one winner, one conflict


# --------------------------------------------------------------------------
# Step 5 / §6 "New-email variant": SAME brand-new email into two runs.
# Distinct interleave from the pre-existing case — proves the get_or_create-first
# reorder closes the bypass where existing_user=None skipped the conflict check.
# --------------------------------------------------------------------------

NEW_EMAIL = "brand-new@example.com"


def test_new_email_bypass_reproduces_without_reorder(
    concurrency, db, seed_publishable_version
):
    """RED: replicate the PRE-REORDER add_student flow (resolve-only read, skip the
    conflict check when the user doesn't exist yet, then get_or_create + enroll)
    for the SAME brand-new email into two runs of one course. Both threads read
    existing_user=None (a barrier holds both at that point BEFORE either commits),
    so both skip the conflict check; get_or_create then serializes on the users
    index (one inserts, the other recovers via SAVEPOINT after the first commits),
    but neither re-checks -> both enroll -> two active. This is the bypass the
    reorder removes; the seam never fires in this flow (spec §6 'New-email
    variant')."""
    course_id, v1, v2, run_a, run_b = _course_two_versions_two_runs(db, seed_publishable_version)

    barrier = threading.Barrier(2)
    s1, s2 = concurrency.make_sessions(2)
    errors = []

    def buggy_add(sess, run_id):
        try:
            sess.begin()
            run = sess.get(Run, run_id)
            # PRE-REORDER order: resolve-only, no create.
            existing = sess.execute(
                select(User).where(User.email == NEW_EMAIL)
            ).scalar_one_or_none()
            barrier.wait(timeout=10)  # both have read existing=None before any commit
            if existing is not None:
                if find_student_active_conflicts(
                    sess, existing.id, course_id=course_id, exclude_run_id=run_id
                ):
                    sess.rollback()
                    return
            target = get_or_create_user(sess, NEW_EMAIL)
            enroll_user_in_run(sess, target, run, None)
            sess.commit()
        except Exception as exc:  # surface silent thread failures
            errors.append(repr(exc))
            sess.rollback()

    concurrency.spawn(buggy_add, s1, run_a)
    concurrency.spawn(buggy_add, s2, run_b)
    for t in list(concurrency.threads):
        t.join(timeout=10)

    assert errors == [], f"threads failed: {errors}"
    (verify,) = concurrency.make_sessions(1)
    user_id = verify.scalar(select(User.id).where(User.email == NEW_EMAIL))
    assert user_id is not None
    active = _active_runstudent_count(verify, user_id, [run_a, run_b])
    verify.rollback()
    assert active == 2  # bypass: brand-new email enrolled in BOTH runs, unchecked


def test_new_email_lock_prevents_double_active(
    concurrency, db, seed_publishable_version
):
    """GREEN: the shipped (reordered) add_student -> ENROLLMENT lock is acquired
    BEFORE get_or_create_user, so the two brand-new-email adds serialize on the
    course key; the winner inserts the user + RunStudent, the loser (under the lock,
    user now committed) sees the RunStudent conflict and 409s. Exactly ONE active
    RunStudent and exactly ONE User row. Free-running (no seam)."""
    course_id, v1, v2, run_a, run_b = _course_two_versions_two_runs(db, seed_publishable_version)

    s1, s2 = concurrency.make_sessions(2)
    statuses = []

    def add(sess, run_id):
        admin = sess.scalar(select(User).where(User.email == "admin@example.com"))
        resp = add_student(run_id, RunStudentCreate(email=NEW_EMAIL), db=sess, user=admin)
        if isinstance(resp, JSONResponse):
            sess.rollback()
            statuses.append(resp.status_code)
        else:
            statuses.append(201)

    concurrency.spawn(add, s1, run_a)
    concurrency.spawn(add, s2, run_b)
    for t in list(concurrency.threads):
        t.join(timeout=10)

    (verify,) = concurrency.make_sessions(1)
    user_id = verify.scalar(select(User.id).where(User.email == NEW_EMAIL))
    n_users = verify.scalar(select(func.count(User.id)).where(User.email == NEW_EMAIL))
    active = _active_runstudent_count(verify, user_id, [run_a, run_b])
    verify.rollback()
    assert n_users == 1                    # get_or_create resolved to one row
    assert active == 1                     # no double-active
    assert sorted(statuses) == [201, 409]  # exactly one winner, one conflict


def _active_enrollment_count(sess, user_id, course_id):
    return sess.scalar(
        select(func.count(StudentEnrollment.id))
        .join(CourseVersion, CourseVersion.id == StudentEnrollment.version_id)
        .where(
            StudentEnrollment.user_id == user_id,
            StudentEnrollment.is_active == True,  # noqa: E712
            CourseVersion.course_id == course_id,
        )
    )


# --------------------------------------------------------------------------
# Step 9a / §6 "#2 StudentEnrollment — count-based, at _enroll_user level".
# Call _enroll_user directly with TWO DISTINCT versions of one course (the
# endpoints can't — they resolve the same newest version). GREEN wraps the lock
# (mimicking the production caller — _enroll_user holds no lock itself). Assert
# the active-row COUNT, not a 409.
# --------------------------------------------------------------------------


def test_enroll_user_two_versions_double_active_without_lock(
    concurrency, db, seed_publishable_version, make_user
):
    """RED: two threads call _enroll_user for the same user on two DISTINCT
    versions of one course, with NO lock. A barrier holds both AFTER each has
    read other_active (empty, under READ COMMITTED) + inserted its own row but
    BEFORE either commits, so neither deactivates the other -> 2 active rows."""
    course_id, v1, v2, run_a, run_b = _course_two_versions_two_runs(db, seed_publishable_version)
    user = make_user(email="dual@example.com")

    barrier = threading.Barrier(2)
    s1, s2 = concurrency.make_sessions(2)
    errors = []

    def enroll(sess, version_id):
        try:
            sess.begin()
            version = sess.get(CourseVersion, version_id)
            u = sess.get(User, user.id)
            _enroll_user(sess, u, course_id, version)  # read other_active + insert + flush
            barrier.wait(timeout=10)                    # both inserted, neither committed yet
            sess.commit()
        except Exception as exc:  # surface silent thread failures
            errors.append(repr(exc))
            sess.rollback()

    concurrency.spawn(enroll, s1, v1)
    concurrency.spawn(enroll, s2, v2)
    for t in list(concurrency.threads):
        t.join(timeout=10)

    assert errors == [], f"threads failed: {errors}"
    (verify,) = concurrency.make_sessions(1)
    active = _active_enrollment_count(verify, user.id, course_id)
    verify.rollback()
    assert active == 2  # invariant #2 violated at the StudentEnrollment layer


def test_enroll_user_two_versions_lock_prevents_double_active(
    concurrency, db, seed_publishable_version, make_user
):
    """GREEN: each thread wraps its _enroll_user in the ENROLLMENT(course_id) lock
    (as the production callers enroll_student/enroll_batch do). The two calls
    serialize; the loser's other_active read (fresh snapshot after the winner
    commits) sees the winner's active row and deactivates it -> exactly ONE active.
    Free-running (no barrier — the lock provides the serialization)."""
    course_id, v1, v2, run_a, run_b = _course_two_versions_two_runs(db, seed_publishable_version)
    user = make_user(email="dual@example.com")

    s1, s2 = concurrency.make_sessions(2)
    errors = []

    def enroll(sess, version_id):
        try:
            sess.begin()
            version = sess.get(CourseVersion, version_id)
            u = sess.get(User, user.id)
            advisory.advisory_xact_lock(sess, advisory.LOCK_NS_ENROLLMENT, course_id)
            _enroll_user(sess, u, course_id, version)
            sess.commit()
        except Exception as exc:
            errors.append(repr(exc))
            sess.rollback()

    concurrency.spawn(enroll, s1, v1)
    concurrency.spawn(enroll, s2, v2)
    for t in list(concurrency.threads):
        t.join(timeout=10)

    assert errors == [], f"threads failed: {errors}"
    (verify,) = concurrency.make_sessions(1)
    active = _active_enrollment_count(verify, user.id, course_id)
    verify.rollback()
    assert active == 1  # deactivate-then-insert made atomic by the lock


# --------------------------------------------------------------------------
# Step 9b / §6 "Cross-endpoint advisory-vs-index deadlock (Finding 1)".
# Advisory-vs-UNIQUE-INDEX cycle (distinct from the namespace-reversal test):
# add_student (correct order ENROLLMENT->get_or_create) vs enroll_student forced
# to the rev-6 BUGGY order (get_or_create->ENROLLMENT), same brand-new email +
# course. Proves the reorder (advisory-before-index) is load-bearing.
# --------------------------------------------------------------------------

DEADLOCK_EMAIL = "cross-endpoint-new@example.com"


def _deadlock_sqlstate(exc):
    """Return '40P01' if exc (or anything in its cause/orig chain) is a Postgres
    deadlock, else None. Uses the driver's SQLSTATE — not string matching — so a
    statement_timeout (57014) can never be misread as a deadlock."""
    cur = exc
    for _ in range(8):
        if cur is None:
            break
        for c in (cur, getattr(cur, "orig", None)):
            if c is not None and getattr(c, "sqlstate", None) == "40P01":
                return "40P01"
        cur = getattr(cur, "__cause__", None) or getattr(cur, "__context__", None)
    return None


def test_cross_endpoint_buggy_order_deadlocks(
    concurrency, db, seed_publishable_version
):
    """RED: enroll_student in the rev-6 BUGGY order (get_or_create_user BEFORE
    ENROLLMENT) is parked after its users-index INSERT but before its ENROLLMENT
    acquire. add_student (shipped order) then takes ENROLLMENT(course) and blocks
    on the parked index row; releasing enroll_student makes it request
    ENROLLMENT (held by add_student) -> advisory-vs-index cycle -> DeadlockDetected
    (40P01). Exactly one of the two transactions is chosen as the victim."""
    course_id, v1, v2, run_a, run_b = _course_two_versions_two_runs(db, seed_publishable_version)

    sA, sE, sPoll = concurrency.make_sessions(3)
    # Pre-connect sA on the main thread so its backend PID is stable and equals the
    # PID add_student's INSERT will run on (NullPool keeps one connection per open txn).
    a_pid = sA.execute(text("SELECT pg_backend_pid()")).scalar()

    parked_E = threading.Event()
    release_E = threading.Event()
    result_A, result_E = {}, {}

    def enroll_buggy(sess):
        """rev-6 buggy order: get_or_create_user (INSERT, holds index) BEFORE the
        ENROLLMENT lock. Parked between them."""
        try:
            sess.begin()
            result_E["pid"] = sess.execute(text("SELECT pg_backend_pid()")).scalar()
            get_or_404(sess, Course, course_id)
            admin = sess.scalar(select(User).where(User.email == "admin@example.com"))
            require_course_admin(sess, admin, course_id)
            version = get_newest_published_version(sess, course_id)
            user = get_or_create_user(sess, DEADLOCK_EMAIL)  # INSERT -> holds email index
            parked_E.set()
            if not release_E.wait(timeout=10):
                raise RuntimeError("release_E timed out")
            advisory.advisory_xact_lock(sess, advisory.LOCK_NS_ENROLLMENT, course_id)  # blocks on A
            _enroll_user(sess, user, course_id, version)
            sess.commit()
            result_E["ok"] = True
        except Exception as exc:  # capture the (possible) 40P01 victim
            result_E["error"] = exc
            sess.rollback()

    def add_correct(sess):
        try:
            admin = sess.scalar(select(User).where(User.email == "admin@example.com"))
            result_A["resp"] = add_student(
                run_a, RunStudentCreate(email=DEADLOCK_EMAIL), db=sess, user=admin
            )
            result_A["ok"] = True
        except Exception as exc:
            result_A["error"] = exc
            sess.rollback()

    tE = concurrency.spawn(enroll_buggy, sE)
    assert parked_E.wait(timeout=10), "enroll_student never parked after its users insert"
    e_pid = result_E["pid"]

    tA = concurrency.spawn(add_correct, sA)

    # Wait until add_student is actually blocked on enroll_student's uncommitted
    # index row (it holds ENROLLMENT by then) — a real block, not a hoped interleave.
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        blockers = sPoll.execute(text("SELECT pg_blocking_pids(:a)"), {"a": a_pid}).scalar()
        sPoll.rollback()
        if blockers and e_pid in blockers:
            break
        time.sleep(0.05)
    else:
        raise AssertionError("add_student never blocked on enroll_student's index row")

    release_E.set()  # enroll_student now requests ENROLLMENT (held by A) -> cycle
    tA.join(timeout=10)
    tE.join(timeout=10)

    victims = [
        _deadlock_sqlstate(r)
        for r in (result_A.get("error"), result_E.get("error"))
        if _deadlock_sqlstate(r) is not None
    ]
    assert victims == ["40P01"], (
        f"expected exactly one 40P01 deadlock victim; "
        f"A={result_A!r} E={result_E!r}"
    )


def test_cross_endpoint_shipped_order_both_complete(
    concurrency, db, seed_publishable_version
):
    """Control (both paths shipped order — ENROLLMENT before get_or_create_user):
    add_student and enroll_student for the same brand-new email + course serialize
    on ENROLLMENT and BOTH complete. Because find_student_active_conflicts checks
    only RunStudent, add_student finds no conflict against the sibling's
    StudentEnrollment -> NO roster 409. Exactly one User, one active RunStudent,
    one active StudentEnrollment (invariant #2 is enforced per-table)."""
    course_id, v1, v2, run_a, run_b = _course_two_versions_two_runs(db, seed_publishable_version)

    sA, sE = concurrency.make_sessions(2)
    result_A, result_E = {}, {}

    def run_add(sess):
        try:
            admin = sess.scalar(select(User).where(User.email == "admin@example.com"))
            result_A["resp"] = add_student(
                run_a, RunStudentCreate(email=DEADLOCK_EMAIL), db=sess, user=admin
            )
        except Exception as exc:
            result_A["error"] = exc
            sess.rollback()

    def run_enroll(sess):
        try:
            admin = sess.scalar(select(User).where(User.email == "admin@example.com"))
            result_E["resp"] = enroll_student(
                course_id, EnrollRequest(email=DEADLOCK_EMAIL), db=sess, current_user=admin
            )
        except Exception as exc:
            result_E["error"] = exc
            sess.rollback()

    concurrency.spawn(run_add, sA)
    concurrency.spawn(run_enroll, sE)
    for t in list(concurrency.threads):
        t.join(timeout=10)

    assert result_A.get("error") is None, f"add_student failed: {result_A.get('error')!r}"
    assert result_E.get("error") is None, f"enroll_student failed: {result_E.get('error')!r}"
    assert not isinstance(result_A["resp"], JSONResponse), "unexpected roster 409"

    (verify,) = concurrency.make_sessions(1)
    n_users = verify.scalar(select(func.count(User.id)).where(User.email == DEADLOCK_EMAIL))
    user_id = verify.scalar(select(User.id).where(User.email == DEADLOCK_EMAIL))
    n_runstudent = _active_runstudent_count(verify, user_id, [run_a])
    n_enroll = _active_enrollment_count(verify, user_id, course_id)
    verify.rollback()
    assert n_users == 1
    assert n_runstudent == 1
    assert n_enroll == 1


# --------------------------------------------------------------------------
# Step 10 / §6 "Wiring + ordering assertions": every enrollment path records
# ENROLLMENT(course_id), and add_student/enroll_student/enroll_batch record it
# BEFORE get_or_create_user (advisory-before-index).
# --------------------------------------------------------------------------


def _spy_get_or_create(monkeypatch, module, events):
    """Shadow `module.get_or_create_user` so each call appends ('read', email) to
    the shared `events` list — lets a single-threaded test assert the ENROLLMENT
    lock is recorded BEFORE the users-index INSERT, and (for batch) the visit
    order of the emails."""
    real = module.get_or_create_user

    def spy(db, email):
        events.append(("read", email))
        return real(db, email)

    monkeypatch.setattr(module, "get_or_create_user", spy)


def _scalar_ordering_spy(db, events):
    """Shadow db.scalar so the FIRST count-read records whether a lock was already
    logged into `events`. Returns read_seen (read_seen['after_lock'])."""
    read_seen = {"after_lock": None}
    real_scalar = db.scalar

    def scalar_spy(*a, **k):
        if read_seen["after_lock"] is None:
            read_seen["after_lock"] = len(events) > 0
        return real_scalar(*a, **k)

    db.scalar = scalar_spy
    return read_seen


def _published_run(db, version_id):
    run = Run(version_id=version_id, title="R",
              start_date=_date(2026, 1, 1), end_date=_date(2030, 1, 1), is_published=True)
    db.add(run)
    db.commit()
    return run


def test_add_student_wiring_and_ordering(monkeypatch, db, seed_publishable_version, superuser):
    """Single-threaded: add_student records ('lock', ENROLLMENT, (course_id,)) and
    the lock precedes get_or_create_user."""
    from mathion.api import run_roster

    course, version = seed_publishable_version()
    course_id = course["id"]
    run = _published_run(db, version["id"])

    events = record_lock_calls(monkeypatch)
    _spy_get_or_create(monkeypatch, run_roster, events)

    add_student(run.id, RunStudentCreate(email="wire-add@example.com"), db=db, user=superuser)

    lock_ev = ("lock", advisory.LOCK_NS_ENROLLMENT, (course_id,))
    assert lock_ev in events
    read_idx = next(i for i, e in enumerate(events) if e[0] == "read")
    assert events.index(lock_ev) < read_idx


def test_enroll_student_wiring_and_ordering(monkeypatch, db, seed_publishable_version, superuser):
    """Single-threaded: enroll_student records ENROLLMENT(course_id) before
    get_or_create_user."""
    from mathion.api import enrollment

    course, version = seed_publishable_version()
    course_id = course["id"]

    events = record_lock_calls(monkeypatch)
    _spy_get_or_create(monkeypatch, enrollment, events)

    enroll_student(course_id, EnrollRequest(email="wire-enroll@example.com"),
                   db=db, current_user=superuser)

    lock_ev = ("lock", advisory.LOCK_NS_ENROLLMENT, (course_id,))
    assert lock_ev in events
    read_idx = next(i for i, e in enumerate(events) if e[0] == "read")
    assert events.index(lock_ev) < read_idx


def test_enroll_batch_wiring_ordering_and_email_order(
    monkeypatch, db, seed_publishable_version, superuser
):
    """Single-threaded: enroll_batch records ENROLLMENT(course_id) ONCE before the
    loop and before the first get_or_create_user; it visits the users-table writes
    in normalized-email order (deadlock-freedom, §5.3) yet returns the response in
    the client's INPUT order."""
    from mathion.api import enrollment

    course, version = seed_publishable_version()
    course_id = course["id"]

    events = record_lock_calls(monkeypatch)
    _spy_get_or_create(monkeypatch, enrollment, events)

    input_emails = ["charlie@example.com", "alice@example.com", "bob@example.com"]
    resp = enroll_batch(course_id, EnrollBatchRequest(emails=input_emails),
                        db=db, current_user=superuser)

    lock_ev = ("lock", advisory.LOCK_NS_ENROLLMENT, (course_id,))
    assert [e for e in events if e[0] == "lock"] == [lock_ev]  # exactly once
    read_events = [e for e in events if e[0] == "read"]
    assert events.index(lock_ev) < events.index(read_events[0])  # lock before first write
    assert [e[1] for e in read_events] == sorted(input_emails)   # visited sorted-email order
    assert [r.user_email for r in resp] == input_emails          # response in INPUT order


def test_publish_run_wiring_and_ordering(
    monkeypatch, db, seed_publishable_version, superuser, make_user
):
    """Single-threaded: publish_run records ENROLLMENT(course_id), recorded BEFORE
    its first guard-read (the teacher-count db.scalar)."""
    from mathion.api.runs import publish_run

    course, version = seed_publishable_version()
    course_id = course["id"]
    run = Run(version_id=version["id"], title="R",
              start_date=_date(2026, 1, 1), end_date=_date(2030, 1, 1), is_published=False)
    db.add(run)
    db.flush()
    teacher = make_user(email="wire-pubteach@example.com")
    db.add(RunTeacher(run_id=run.id, user_id=teacher.id))
    db.commit()

    events = record_lock_calls(monkeypatch)
    read_seen = _scalar_ordering_spy(db, events)

    publish_run(run.id, db=db, user=superuser)

    assert ("lock", advisory.LOCK_NS_ENROLLMENT, (course_id,)) in events
    assert read_seen["after_lock"] is True
