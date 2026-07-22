import threading
from tempfile import SpooledTemporaryFile

from sqlalchemy import func, select
from starlette.datastructures import UploadFile

from mathion.api import advisory
from mathion.api.submissions import create_submission
from mathion.models import RunStudent, Submission
from mathion.models_auth import User


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
