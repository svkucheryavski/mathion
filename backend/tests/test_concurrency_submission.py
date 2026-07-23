import os
import threading
from datetime import datetime, timedelta, timezone
from tempfile import SpooledTemporaryFile

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from starlette.datastructures import UploadFile

from mathion.api import advisory, submissions
from mathion.api.helpers import submission_storage_dir, to_utc_aware
from mathion.api.mini_projects import patch_mini_project
from mathion.api.submissions import create_submission
from mathion.models import MiniProject, RunStudent, Submission
from mathion.models_auth import User
from mathion.schemas import MiniProjectUpdate
from tests.conftest import record_lock_calls


def _pdf_upload():
    """Fabricate a bare UploadFile of %PDF- bytes over a SpooledTemporaryFile,
    matching what FastAPI hands create_submission on the HTTP path (spec §6)."""
    spool = SpooledTemporaryFile()
    spool.write(b"%PDF-1.4 concurrency test")
    spool.seek(0)
    return UploadFile(file=spool, filename="r.pdf")


def test_pending_submission_race_reproduces_without_lock(
    concurrency, monkeypatch, db, seed_run_with_published_mp
):
    """RED: two group members submit concurrently; both pass the pending-gate at
    the seam, both insert a pending submission -> 2 pending rows. Proves the race
    (and exercises the fixture + interleave seam). Monkeypatches advisory locks to
    no-ops so this remains the lock-removed RED after Task 5 adds the SUBMISSION lock.

    Asymmetric protocol (spec §6, "#3 pending-submission — asymmetric"): the FIRST
    submitter to pass the pending gate (thread B) is parked at the seam; thread A
    runs to a FULL commit of submission #1; then B is released and, under READ
    COMMITTED, reads A's committed row, computes max()+1 = 2, and inserts a SECOND
    pending row (no submission_number UNIQUE collision). A symmetric release would
    collide on submission_number and leave only 1 pending row — a false fail-first."""
    run, ga, gb, mp = seed_run_with_published_mp()

    # Seed a SECOND student into group ga (alice is already there) so two members
    # submit to the SAME (mini-project, group) — the (mp, ga) pending domain.
    carol = User(email="carol@example.com", full_name="Carol")
    db.add(carol)
    db.flush()
    db.add(RunStudent(run_id=run["id"], user_id=carol.id, group_id=ga["id"]))
    db.commit()

    # Neutralize the (yet-to-be-added, Task 5) SUBMISSION lock so this stays the
    # lock-removed RED even after Task 5 wires advisory_xact_lock into the endpoint.
    monkeypatch.setattr(advisory, "advisory_xact_lock", lambda db, ns, *ids: None)

    # Interleave seam: the FIRST caller to pass the pending gate parks; the second
    # runs straight through. Engage ONLY for the create_submission critical section.
    real_hook = advisory.interleave_hook
    parked = threading.Event()
    release = threading.Event()
    state = {"claimed": False}
    guard = threading.Lock()

    def hook(label):
        if label == "submission_pending":
            with guard:
                mine = not state["claimed"]
                state["claimed"] = True
            if mine:
                parked.set()  # signal: B has passed the pending gate and is parked
                if not release.wait(timeout=10):
                    raise RuntimeError("seam release timed out")
        return real_hook(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)

    sa, sb = concurrency.make_sessions(2)
    errors = []

    def _submit(session, email):
        try:
            user = session.execute(select(User).where(User.email == email)).scalar_one()
            create_submission(mp["id"], _pdf_upload(), db=session, user=user)
        except Exception as exc:  # surface silent thread failures
            errors.append((email, repr(exc)))

    tb = concurrency.spawn(_submit, sb, "carol@example.com")   # B: parks at the seam
    assert parked.wait(timeout=10), "thread B never reached the pending seam"
    ta = concurrency.spawn(_submit, sa, "alice@example.com")   # A: runs to full commit
    ta.join(timeout=10)
    release.set()                                              # release B
    tb.join(timeout=10)

    assert errors == [], f"submission thread(s) failed: {errors}"

    # Count pending submissions for (mp, ga): neither row is evaluated, so both are
    # pending. count == 2 proves the double-pending race (Task 5 GREEN forces == 1).
    (probe,) = concurrency.make_sessions(1)
    pending = probe.execute(
        select(func.count()).select_from(Submission).where(
            Submission.mini_project_id == mp["id"],
            Submission.group_id == ga["id"],
        )
    ).scalar()
    probe.rollback()
    assert pending == 2


def _seed_two_members_group_a(db, run, ga):
    """Add a SECOND student (carol) into group ga (alice is already there) so two
    members submit to the SAME (mini-project, group) pending domain. Commits so the
    concurrency-engine sessions see it."""
    carol = User(email="carol@example.com", full_name="Carol")
    db.add(carol)
    db.flush()
    db.add(RunStudent(run_id=run["id"], user_id=carol.id, group_id=ga["id"]))
    db.commit()


def test_pending_submission_lock_forces_one_409(
    concurrency, db, seed_run_with_published_mp
):
    """GREEN: real SUBMISSION(mp_id, group_id) lock, free-running (no seam block).
    Two group members submit concurrently to (mp, ga); the lock serializes them, so
    exactly ONE pending submission is committed and the other blocks on the lock,
    re-reads the committed row, and gets 409 'Previous submission pending evaluation'
    (spec §6, "#3 pending-submission — asymmetric": the GREEN blocks B on the lock ->
    re-reads -> 409). Deterministic in outcome regardless of which thread wins."""
    run, ga, gb, mp = seed_run_with_published_mp()
    _seed_two_members_group_a(db, run, ga)

    sa, sb = concurrency.make_sessions(2)
    committed = []
    rejected = []
    errors = []

    def _submit(session, email):
        try:
            user = session.execute(select(User).where(User.email == email)).scalar_one()
            create_submission(mp["id"], _pdf_upload(), db=session, user=user)
            committed.append(email)
        except HTTPException as exc:  # the lock loser re-reads -> 409
            session.rollback()
            rejected.append((exc.status_code, exc.detail))
        except Exception as exc:  # surface silent thread failures
            errors.append((email, repr(exc)))

    concurrency.spawn(_submit, sa, "alice@example.com")
    concurrency.spawn(_submit, sb, "carol@example.com")
    for t in list(concurrency.threads):
        t.join(timeout=10)

    assert errors == [], f"submission thread(s) failed: {errors}"
    assert len(committed) == 1, f"expected exactly one committed submission, got {committed}"
    assert rejected == [(409, "Previous submission pending evaluation")], rejected

    (probe,) = concurrency.make_sessions(1)
    pending = probe.execute(
        select(func.count()).select_from(Submission).where(
            Submission.mini_project_id == mp["id"],
            Submission.group_id == ga["id"],
        )
    ).scalar()
    probe.rollback()
    assert pending == 1  # the lock forced a single pending row


def test_orphan_temp_cleaned_on_pending_409(db, seed_run_with_published_mp):
    """Orphan-temp regression: a gate 409 raised BETWEEN the pre-lock temp-write and
    os.replace must leave no .upload-*.tmp behind. Submit twice as one group member;
    the second hits 'Previous submission pending evaluation' after its temp file is
    already written -> the try/finally must unlink it (§5.4)."""
    run, ga, gb, mp = seed_run_with_published_mp()
    alice = db.execute(select(User).where(User.email == "alice@example.com")).scalar_one()

    create_submission(mp["id"], _pdf_upload(), db=db, user=alice)  # #1 -> commits

    with pytest.raises(HTTPException) as ei:
        create_submission(mp["id"], _pdf_upload(), db=db, user=alice)  # #2 -> 409 pending
    db.rollback()
    assert ei.value.status_code == 409
    assert ei.value.detail == "Previous submission pending evaluation"

    abs_dir = submission_storage_dir(run["id"], ga["id"])
    leftovers = [f for f in os.listdir(abs_dir) if f.startswith(".upload-") and f.endswith(".tmp")]
    assert leftovers == [], f"orphan temp file(s) left behind: {leftovers}"


def test_file_write_error_returns_500_and_cleans_temp(
    db, monkeypatch, seed_run_with_published_mp
):
    """File-error path: os.replace raising OSError surfaces the existing
    500 'Failed to write submission to disk' (narrowed except OSError) AND the
    try/finally unlinks the temp file (no orphan)."""
    run, ga, gb, mp = seed_run_with_published_mp()
    alice = db.execute(select(User).where(User.email == "alice@example.com")).scalar_one()

    def _boom(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(submissions.os, "replace", _boom)

    with pytest.raises(HTTPException) as ei:
        create_submission(mp["id"], _pdf_upload(), db=db, user=alice)
    db.rollback()
    assert ei.value.status_code == 500
    assert ei.value.detail == "Failed to write submission to disk"

    abs_dir = submission_storage_dir(run["id"], ga["id"])
    leftovers = [f for f in os.listdir(abs_dir) if f.startswith(".upload-") and f.endswith(".tmp")]
    assert leftovers == [], f"orphan temp file(s) left behind after file-write error: {leftovers}"


def test_submission_wiring_and_ordering(monkeypatch, db, seed_run_with_published_mp):
    """Single-threaded: create_submission records the SUBMISSION(mp_id, group_id)
    lock, and the lock is recorded BEFORE the pending-gate read
    (_latest_evaluation_result)."""
    run, ga, gb, mp = seed_run_with_published_mp()
    alice = db.execute(select(User).where(User.email == "alice@example.com")).scalar_one()

    # Record locks AFTER the seed (which enrolls alice/bob via ENROLLMENT-locked
    # add_student) so `events` starts empty and the ordering check is not falsely
    # satisfied by seed locks.
    events = record_lock_calls(monkeypatch)

    real_latest = submissions._latest_evaluation_result
    read_seen = {"after_lock": None}

    def latest_spy(*a, **k):
        if read_seen["after_lock"] is None:
            read_seen["after_lock"] = len(events) > 0
        return real_latest(*a, **k)

    monkeypatch.setattr(submissions, "_latest_evaluation_result", latest_spy)

    create_submission(mp["id"], _pdf_upload(), db=db, user=alice)

    assert ("lock", advisory.LOCK_NS_SUBMISSION, (mp["id"], ga["id"])) in events
    assert read_seen["after_lock"] is True  # pending-gate read happened AFTER the lock


# --- Task 6 (invariant #5): stale-`mp` on the submit side (spec §6, "#5 stale-`mp`
# on the submit side"). create_submission re-fetches mp under MINIPROJECT so the
# deadline gates read the FRESH row, not the pre-lock :56 snapshot. ---

def test_stale_mp_submit_side_reproduces_without_refetch_block(
    concurrency, monkeypatch, db, seed_run_with_published_mp
):
    """RED (lock removed): thread A (create_submission) re-fetches the deadline BEFORE
    a concurrent patch shortens it, then parks; thread B (patch_mini_project) shortens
    hard_deadline into the PAST and commits; released A reads its stale (pre-shorten)
    deadline and ACCEPTS the submission past the new deadline. Without the MINIPROJECT
    lock, nothing forces A to re-read after B commits — the stale snapshot governs."""
    run, ga, gb, mp = seed_run_with_published_mp()
    alice = db.execute(select(User).where(User.email == "alice@example.com")).scalar_one()
    admin = db.execute(select(User).where(User.email == "admin@example.com")).scalar_one()

    # Lock removed so A (parked at submission_pending) does not hold MINIPROJECT and
    # B's patch can proceed without blocking.
    monkeypatch.setattr(advisory, "advisory_xact_lock", lambda db, ns, *ids: None)

    real_hook = advisory.interleave_hook
    a_parked = threading.Event()
    a_release = threading.Event()

    def hook(label):
        if label == "submission_pending":
            a_parked.set()
            if not a_release.wait(timeout=10):
                raise RuntimeError("submission_pending seam release timed out")
        return real_hook(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)

    (sa,) = concurrency.make_sessions(1)
    result = {}

    def submit_a():
        try:
            u = sa.execute(select(User).where(User.email == "alice@example.com")).scalar_one()
            create_submission(mp["id"], _pdf_upload(), db=sa, user=u)
            result["status"] = "accepted"
        except HTTPException as exc:
            sa.rollback()
            result["status"] = exc.status_code
        except Exception as exc:  # surface silent thread failures
            result["error"] = repr(exc)

    ta = concurrency.spawn(submit_a)  # A: refetches future deadline, parks
    assert a_parked.wait(timeout=10), "create_submission never reached the seam"

    # B shortens hard_deadline into the past and commits (mp is unlocked -> allowed).
    past = datetime.now(timezone.utc) - timedelta(days=1)
    patch_mini_project(mp["id"], MiniProjectUpdate(hard_deadline=past), db=db, user=admin)
    db.rollback()

    a_release.set()  # release A -> reads its stale future deadline -> accepts
    ta.join(timeout=10)

    assert result.get("error") is None, f"submit thread failed: {result.get('error')}"
    assert result["status"] == "accepted"  # BUG: accepted past the now-past deadline
    (probe,) = concurrency.make_sessions(1)
    fresh = probe.get(MiniProject, mp["id"])
    committed = probe.execute(
        select(func.count()).select_from(Submission).where(Submission.mini_project_id == mp["id"])
    ).scalar()
    hard = fresh.hard_deadline
    probe.rollback()
    assert to_utc_aware(hard) < datetime.now(timezone.utc)  # deadline really is in the past
    assert committed == 1  # the stale-read submission was committed


def test_stale_mp_submit_side_blocked_by_refetch(db, seed_run_with_published_mp):
    """GREEN (sequenced, real lock + refetch): run the patch to full commit FIRST, then
    create_submission acquires MINIPROJECT, re-fetches mp (populate_existing), reads the
    now-past hard_deadline, and rejects with 409 'Initial submission deadline passed'.
    The fresh row governs, not the pre-lock snapshot."""
    run, ga, gb, mp = seed_run_with_published_mp()
    alice = db.execute(select(User).where(User.email == "alice@example.com")).scalar_one()
    admin = db.execute(select(User).where(User.email == "admin@example.com")).scalar_one()

    past = datetime.now(timezone.utc) - timedelta(days=1)
    patch_mini_project(mp["id"], MiniProjectUpdate(hard_deadline=past), db=db, user=admin)  # commits

    with pytest.raises(HTTPException) as ei:
        create_submission(mp["id"], _pdf_upload(), db=db, user=alice)
    db.rollback()
    assert ei.value.status_code == 409
    assert ei.value.detail == "Initial submission deadline passed"

    leftovers = [
        f for f in os.listdir(submission_storage_dir(run["id"], ga["id"]))
        if f.startswith(".upload-") and f.endswith(".tmp")
    ]
    assert leftovers == []  # the try/finally unlinked the pre-lock temp on the 409
