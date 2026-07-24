"""Phase 9-A2 — Task 4: batch enrollment locks + email-ordering + MAX_BATCH_SIZE cap.

`add_students_batch` acquires ENROLLMENT(course_id) then CAPACITY(run_id) ONCE up
front (advisory-xact locks acquired before the per-row begin_nested savepoints
survive ROLLBACK TO SAVEPOINT), then processes its per-row `users`-table writes in
normalized-email order (deadlock-freedom, no global lock, spec §3.2/§5.3),
restoring the 207 results to INPUT order. Both batch endpoints reject oversize
input (> MAX_BATCH_SIZE) with an in-handler 422 guard, before any lock.

Off-HTTP semantics (spec §6): thread bodies call the router functions directly
with per-thread sessions; add_students_batch RETURNS a dict (207 body), per-row
errors are dict entries — it does not raise for per-row failures.
"""

import threading
import time

import psycopg
import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from mathion.api import advisory
from mathion.api.enrollment import enroll_student
from mathion.api.helpers import enroll_user_in_run
from mathion.api.run_roster import add_student, add_students_batch
from mathion.config import settings
from mathion.models import Run, RunStudent
from mathion.models_auth import User
from mathion.schemas import EnrollRequest, RunStudentBatchRequest, RunStudentCreate
from tests.conftest import record_lock_calls


# --------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------


def _published_run(admin_client, seed_publishable_version, slug, name):
    """Create a course (via seed) + a published run on it. Returns (course_id,
    run_id). The batch endpoint's is_published gate needs a published run, and
    publish needs a teacher — add one before publishing."""
    course, version = seed_publishable_version(slug=slug, name=name)
    run = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2030-01-01"},
    ).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": f"t-{slug}@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/publish")
    return course["id"], run["id"]


def _admin(sess):
    return sess.scalar(select(User).where(User.email == "admin@example.com"))


def _run_batch(sess, run_id, emails, out):
    """Thread body: run add_students_batch for `emails` on `run_id`/`sess`,
    capturing any raised exception (a cross-course users-index deadlock surfaces
    here as an OperationalError, sqlstate 40P01)."""
    try:
        add_students_batch(
            run_id,
            RunStudentBatchRequest(rows=[{"email": e} for e in emails]),
            db=sess,
            user=_admin(sess),
        )
        out["ok"] = True
    except Exception as exc:  # capture the (possible) 40P01 victim
        out["error"] = exc
        sess.rollback()


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


def _spy_get_or_create(monkeypatch, module, events):
    """Shadow `module.get_or_create_user` so each call appends ('read', email) to
    the shared `events` list — lets a single-threaded test assert the ENROLLMENT/
    CAPACITY locks are recorded BEFORE the first users-index INSERT, and that the
    visit order of the emails is sorted."""
    real = module.get_or_create_user

    def spy(db, email):
        events.append(("read", email))
        return real(db, email)

    monkeypatch.setattr(module, "get_or_create_user", spy)


# --------------------------------------------------------------------------
# Step 1 / §6 "Batch-size cap + shared timeout backstop": schema 422 cap-reject.
# --------------------------------------------------------------------------


def test_batch_rows_over_cap_rejected_422(admin_client, seed_publishable_version, db):
    course, version = seed_publishable_version()
    run = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2030-01-01"},
    ).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/publish")
    rows = [{"email": f"u{i}@example.com"} for i in range(advisory.MAX_BATCH_SIZE + 1)]
    resp = admin_client.post(f"/api/runs/{run['id']}/students/batch", json={"rows": rows})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Batch too large (max 300); split into smaller chunks"


def test_enroll_batch_emails_over_cap_rejected_422(admin_client, seed_publishable_version):
    course, version = seed_publishable_version()
    emails = [f"u{i}@example.com" for i in range(advisory.MAX_BATCH_SIZE + 1)]
    resp = admin_client.post(f"/api/courses/{course['id']}/enroll-batch", json={"emails": emails})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Batch too large (max 300); split into smaller chunks"


# --------------------------------------------------------------------------
# Step 6 / §6 "Cross-course batch deadlock (Finding 3 — the email-ordering proof)".
# Two DIFFERENT-course batches with overlapping brand-new emails in OPPOSITE input
# order. The course-keyed ENROLLMENT/CAPACITY locks (distinct keys per course/run)
# do NOT serialize them, so the only shared contention is the `users` index.
# Input-order visitation forms an index-vs-index cycle (40P01); email-ordering
# makes both visit the shared emails in one global order -> one-directional wait.
# --------------------------------------------------------------------------

SHARED_X = "aaa-cross@example.com"
SHARED_Y = "zzz-cross@example.com"


def test_cross_course_batch_input_order_deadlocks(
    concurrency, monkeypatch, admin_client, seed_publishable_version, db
):
    """RED (email sort monkeypatched OFF -> input-order visitation): batch A on
    course A visits [X, Y]; batch B on course B visits [Y, X]. A parks after
    inserting X (holds X's index) and B after inserting Y; releasing both, A's
    INSERT Y blocks on B while B's INSERT X blocks on A -> DeadlockDetected
    (40P01) for exactly one batch. The real ENROLLMENT/CAPACITY locks are HELD
    (not no-op'd) — different courses/runs, distinct keys — so they cannot prevent
    this cross-course users-index cycle. Only the email sort is turned off."""
    from mathion.api import run_roster

    _, run_a = _published_run(admin_client, seed_publishable_version, "cross-a", "Cross A")
    _, run_b = _published_run(admin_client, seed_publishable_version, "cross-b", "Cross B")

    # Turn OFF email-ordering: identity -> visit rows in INPUT order.
    monkeypatch.setattr(
        run_roster, "sorted", lambda iterable, key=None: list(iterable), raising=False
    )

    barrier = threading.Barrier(2)
    parked = threading.local()
    real_hook = advisory.interleave_hook

    def hook(label):
        # Park each batch ONCE, after its FIRST new user (before its second), so A
        # holds X and B holds Y before either requests the other's key. The victim
        # errors here and the survivor's 2nd-row seam must NOT re-block the barrier.
        if label == "batch_between_users" and not getattr(parked, "done", False):
            parked.done = True
            barrier.wait(timeout=10)
        return real_hook(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)

    sA, sB = concurrency.make_sessions(2)
    result_A, result_B = {}, {}

    concurrency.spawn(_run_batch, sA, run_a, [SHARED_X, SHARED_Y], result_A)
    concurrency.spawn(_run_batch, sB, run_b, [SHARED_Y, SHARED_X], result_B)
    for t in list(concurrency.threads):
        t.join(timeout=15)

    victims = [
        _deadlock_sqlstate(r)
        for r in (result_A.get("error"), result_B.get("error"))
        if _deadlock_sqlstate(r) is not None
    ]
    assert victims == ["40P01"], (
        f"expected exactly one 40P01 deadlock victim in input order; "
        f"A={result_A!r} B={result_B!r}"
    )


def test_cross_course_batch_email_order_no_deadlock(
    concurrency, admin_client, seed_publishable_version, db
):
    """GREEN (shipped email-ordering, free-running — no seam): both batches visit
    the shared emails in the SAME sorted order (X then Y), so whoever inserts X
    first holds nothing the other needs while the other waits on X -> a one-
    directional wait, never a cycle. Both batches complete; exactly one User row
    exists per shared email. Deterministic regardless of scheduling."""
    _, run_a = _published_run(admin_client, seed_publishable_version, "cross-a", "Cross A")
    _, run_b = _published_run(admin_client, seed_publishable_version, "cross-b", "Cross B")

    sA, sB = concurrency.make_sessions(2)
    result_A, result_B = {}, {}

    concurrency.spawn(_run_batch, sA, run_a, [SHARED_X, SHARED_Y], result_A)
    concurrency.spawn(_run_batch, sB, run_b, [SHARED_Y, SHARED_X], result_B)
    for t in list(concurrency.threads):
        t.join(timeout=15)

    assert result_A.get("error") is None, f"batch A failed: {result_A.get('error')!r}"
    assert result_B.get("error") is None, f"batch B failed: {result_B.get('error')!r}"
    assert result_A.get("ok") is True and result_B.get("ok") is True

    (verify,) = concurrency.make_sessions(1)
    n_x = verify.scalar(select(func.count(User.id)).where(User.email == SHARED_X))
    n_y = verify.scalar(select(func.count(User.id)).where(User.email == SHARED_Y))
    verify.rollback()
    assert n_x == 1 and n_y == 1  # exactly one User per email, no duplicate insert


# --------------------------------------------------------------------------
# Step 7a / §6 "Deadlock regression (non-vacuous)". Proves the §3.2 ascending
# order (ENROLLMENT < CAPACITY) is load-bearing: reverse ONE path's order and race
# it (correct-order add_student vs a CAPACITY-then-ENROLLMENT path) with a
# BETWEEN-acquisitions barrier -> DeadlockDetected. Control (correct order, no
# barrier) -> both complete.
# --------------------------------------------------------------------------


def _course_id_of_run(db, run_id):
    return db.get(Run, run_id).version.course_id


def test_deadlock_regression_reversed_order_deadlocks(
    concurrency, monkeypatch, seed_run_with_groups, db
):
    """RED: a correct-order path (add_student: ENROLLMENT then CAPACITY) races a
    reversed path (CAPACITY then ENROLLMENT) on the SAME course+run. A wrapper on
    advisory_xact_lock parks each thread at a barrier AFTER acquiring its FIRST
    lock (disjoint first keys — ENR vs CAP — so the barrier is reachable) and
    BEFORE its second; releasing both, each requests the lock the other holds ->
    ABBA cycle -> 40P01. This is exactly the cycle the ascending order forbids."""
    run, ga, gb = seed_run_with_groups()
    run_id = run["id"]
    course_id = _course_id_of_run(db, run_id)

    barrier = threading.Barrier(2)
    first = threading.local()
    real_lock = advisory.advisory_xact_lock

    def barriered_lock(dbs, ns, *ids):
        real_lock(dbs, ns, *ids)  # acquire the real lock FIRST, then park once
        if not getattr(first, "parked", False):
            first.parked = True
            barrier.wait(timeout=10)

    monkeypatch.setattr(advisory, "advisory_xact_lock", barriered_lock)

    sC, sR = concurrency.make_sessions(2)
    result_C, result_R = {}, {}

    def correct_path(sess):
        """Real add_student — ENROLLMENT (1st, parks) then CAPACITY (2nd, blocks)."""
        try:
            add_student(
                run_id, RunStudentCreate(email="dl-correct@example.com", group_id=ga["id"]),
                db=sess, user=_admin(sess),
            )
            result_C["ok"] = True
        except Exception as exc:
            result_C["error"] = exc
            sess.rollback()

    def reversed_path(sess):
        """Reversed order: CAPACITY (1st, parks) then ENROLLMENT (2nd, blocks)."""
        try:
            advisory.advisory_xact_lock(sess, advisory.LOCK_NS_CAPACITY, run_id)
            advisory.advisory_xact_lock(sess, advisory.LOCK_NS_ENROLLMENT, course_id)
            sess.commit()
            result_R["ok"] = True
        except Exception as exc:
            result_R["error"] = exc
            sess.rollback()

    concurrency.spawn(correct_path, sC)
    concurrency.spawn(reversed_path, sR)
    for t in list(concurrency.threads):
        t.join(timeout=15)

    victims = [
        _deadlock_sqlstate(r)
        for r in (result_C.get("error"), result_R.get("error"))
        if _deadlock_sqlstate(r) is not None
    ]
    assert victims == ["40P01"], (
        f"expected exactly one 40P01 victim from the reversed lock order; "
        f"C={result_C!r} R={result_R!r}"
    )


def test_deadlock_regression_control_both_complete(
    concurrency, seed_run_with_groups, db
):
    """Control (both correct order, NO barrier): two add_student calls (distinct
    brand-new emails) into the same run+group both take ENROLLMENT then CAPACITY,
    serialize, and BOTH complete — no deadlock. Reusing the strict barrier here
    would hang (both take ENROLLMENT first), so the control runs free."""
    from fastapi.responses import JSONResponse

    run, ga, gb = seed_run_with_groups()
    run_id = run["id"]

    sA, sB = concurrency.make_sessions(2)
    results = {}

    def add(sess, email, key):
        try:
            results[key] = add_student(
                run_id, RunStudentCreate(email=email, group_id=ga["id"]),
                db=sess, user=_admin(sess),
            )
        except Exception as exc:
            results[key] = exc
            sess.rollback()

    concurrency.spawn(add, sA, "ctrl-a@example.com", "a")
    concurrency.spawn(add, sB, "ctrl-b@example.com", "b")
    for t in list(concurrency.threads):
        t.join(timeout=15)

    for k in ("a", "b"):
        assert not isinstance(results[k], Exception), f"{k} raised: {results[k]!r}"
        assert not isinstance(results[k], JSONResponse), f"{k} unexpectedly 409'd"


# --------------------------------------------------------------------------
# Step 7b / §6 "Batch-size cap + shared timeout backstop": the 57014 backstop.
# DOCUMENTS (does not prove unreachable) that the batch shares the design's
# statement_timeout backstop: email-ordering removes the 40P01 deadlock but not
# this 57014, which the MAX_BATCH_SIZE=300 cap keeps rare by bounding the hold.
# --------------------------------------------------------------------------

BACKSTOP_SHARED = "aaa-backstop@example.com"
BACKSTOP_OTHER = "zzz-backstop@example.com"


def test_batch_shared_statement_timeout_backstop_57014(
    concurrency, monkeypatch, admin_client, seed_publishable_version, db
):
    """Deterministic contention: batch A parks mid-loop at the between-users seam
    holding its ENROLLMENT(course) lock + a just-flushed shared-user index lock. A
    contending same-course enroll_student, run on a DEDICATED low-statement_timeout
    session (500 ms), blocks on ENROLLMENT and is canceled -> SQLSTATE 57014
    (sqlalchemy OperationalError wrapping psycopg QueryCanceled). Then A is
    released, commits cleanly. Email-ordering removes the 40P01 deadlock but NOT
    this shared statement_timeout backstop (spec §3.3); MAX_BATCH_SIZE=300 keeps
    it rare by bounding the hold — this documents, it does not assert unreachable."""
    course_id, run_id = _published_run(admin_client, seed_publishable_version, "backstop", "Backstop")

    parked = threading.Event()
    release = threading.Event()
    park_once = threading.local()
    real_hook = advisory.interleave_hook

    def hook(label):
        if label == "batch_between_users" and not getattr(park_once, "done", False):
            park_once.done = True
            parked.set()
            release.wait(timeout=15)
        return real_hook(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)

    # Dedicated LOW-statement_timeout engine (mirrors the concurrency fixture's
    # create_engine but with statement_timeout=500ms) — one session on it.
    low_eng = create_engine(
        settings.database_url,
        poolclass=NullPool,
        isolation_level="READ COMMITTED",
        connect_args={
            "connect_timeout": 10,
            "options": "-c statement_timeout=500 -c TimeZone=UTC",
        },
    )
    low_session = sessionmaker(bind=low_eng)()

    (sA,) = concurrency.make_sessions(1)
    result_A = {}
    # BACKSTOP_SHARED is the lowest email, so email-ordering visits it FIRST: A
    # parks holding ENROLLMENT + the SHARED user's flushed index lock.
    tA = concurrency.spawn(_run_batch, sA, run_id, [BACKSTOP_SHARED, BACKSTOP_OTHER], result_A)
    try:
        assert parked.wait(timeout=15), "batch A never parked at the between-users seam"

        low_admin = low_session.scalar(select(User).where(User.email == "admin@example.com"))
        t0 = time.monotonic()
        with pytest.raises(OperationalError) as ei:
            # Same course -> contends on ENROLLMENT(course), held by parked batch A.
            enroll_student(
                course_id, EnrollRequest(email=BACKSTOP_SHARED),
                db=low_session, current_user=low_admin,
            )
        elapsed = time.monotonic() - t0
        assert isinstance(ei.value.orig, psycopg.errors.QueryCanceled), repr(ei.value.orig)
        assert ei.value.orig.sqlstate == "57014"  # statement_timeout cancellation, NOT 40P01
        assert 0.3 < elapsed < 5.0, f"cancel took {elapsed:.2f}s (expected ~0.5s)"
        low_session.rollback()
    finally:
        release.set()  # let batch A finish so its commit + teardown are clean
        tA.join(timeout=15)
        low_session.rollback()
        low_session.close()
        low_eng.dispose()

    assert result_A.get("error") is None, f"batch A did not commit cleanly: {result_A!r}"
    assert result_A.get("ok") is True


# --------------------------------------------------------------------------
# Step 7c / §6 "Wiring + ordering assertions": ENROLLMENT before CAPACITY, both
# before the first row's get_or_create_user; rows visited in sorted-email order
# but results returned in INPUT order.
# --------------------------------------------------------------------------


def test_batch_wiring_ordering_and_email_order(
    monkeypatch, admin_client, seed_publishable_version, db, superuser
):
    """Single-threaded: add_students_batch records ('lock', ENROLLMENT, (course_id,))
    THEN ('lock', CAPACITY, (run_id,)) — in that order, both before the first
    get_or_create_user — and visits the users-table writes in normalized-email
    order while returning the 207 results in the client's INPUT order."""
    from mathion.api import run_roster

    course_id, run_id = _published_run(admin_client, seed_publishable_version, "wire", "Wire")

    # Record AFTER seeding/publish (publish_run itself takes ENROLLMENT) so `events`
    # starts empty and the ordering assertion is not satisfied by a seed lock.
    events = record_lock_calls(monkeypatch)
    _spy_get_or_create(monkeypatch, run_roster, events)

    input_emails = ["charlie@example.com", "alice@example.com", "bob@example.com"]
    resp = add_students_batch(
        run_id,
        RunStudentBatchRequest(rows=[{"email": e} for e in input_emails]),
        db=db,
        user=superuser,
    )

    lock_events = [e for e in events if e[0] == "lock"]
    assert lock_events == [
        ("lock", advisory.LOCK_NS_ENROLLMENT, (course_id,)),
        ("lock", advisory.LOCK_NS_CAPACITY, (run_id,)),
    ]  # ENROLLMENT before CAPACITY, exactly once each

    read_events = [e for e in events if e[0] == "read"]
    first_read_idx = next(i for i, e in enumerate(events) if e[0] == "read")
    assert events.index(lock_events[0]) < first_read_idx  # ENROLLMENT before first write
    assert events.index(lock_events[1]) < first_read_idx  # CAPACITY before first write
    assert [e[1] for e in read_events] == sorted(input_emails)  # visited sorted-email order

    assert [r["email"] for r in resp["results"]] == input_emails  # response in INPUT order
    assert all(r["status"] == "added" for r in resp["results"])
