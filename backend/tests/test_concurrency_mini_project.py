"""Task 6 (invariant #5) — MINIPROJECT(mp_id) across submit / patch / delete / delete_run.

A mini-project locked by its first submission stays immutable except by course-admin
force. All first-submitted-at setters/readers serialize on MINIPROJECT(mp_id); patch and
delete re-fetch the WHOLE entity under the lock (fresh deadlines/lock-flag); delete_run
holds every run mini-project's MINIPROJECT lock (ascending mp_id).

Off-HTTP (spec §6): thread bodies call the router functions directly with per-thread
sessions; create_submission takes a bare UploadFile fabricated over a SpooledTemporaryFile
of %PDF- bytes; handlers RAISE HTTPException, so tests assert status_code.
"""
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from tempfile import SpooledTemporaryFile

import psycopg
from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from starlette.datastructures import UploadFile

from mathion.api import advisory, runs as runs_module, submissions
from mathion.api.text_utils import to_utc_aware
from mathion.api.submission_files import submission_storage_dir
from mathion.api.mini_projects import delete_mini_project, patch_mini_project
from mathion.api.runs import delete_run
from mathion.api.submissions import create_submission
from mathion.models import Block, MiniProject, Run, RunStudent, Submission
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


def _pid(session):
    """Backend PID of a NullPool session's connection.

    Does NOT rollback: on a NullPool session, rollback releases (closes) the
    connection, so the next statement would run on a fresh backend with a new PID.
    The leftover read-only SELECT just opens the transaction the following
    create_submission / delete_run continues on the SAME connection (stable PID)."""
    return session.execute(text("SELECT pg_backend_pid()")).scalar()


def _wait_blocked(probe, blocked_pid, by_pid, timeout=10):
    """Poll pg_blocking_pids until `blocked_pid` is blocked by `by_pid`."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        blocked = probe.execute(
            text("SELECT :b = ANY(pg_blocking_pids(:a))"),
            {"a": blocked_pid, "b": by_pid},
        ).scalar()
        probe.rollback()
        if blocked:
            return True
        time.sleep(0.05)
    return False


def _is_fk_23503(exc) -> bool:
    """True iff exc is an IntegrityError wrapping a Postgres ForeignKeyViolation (23503)."""
    return (
        isinstance(exc, IntegrityError)
        and isinstance(exc.orig, psycopg.errors.ForeignKeyViolation)
        and getattr(exc.orig, "sqlstate", None) == "23503"
    )


# =====================================================================================
# #5 delete_mini_project bypass — spec §6, "#5 mini-project — asymmetric, sequenced GREEN"
# =====================================================================================

def test_delete_mp_bypass_reproduces_without_lock(
    concurrency, monkeypatch, db, seed_run_with_published_mp
):
    """RED (lock removed): a run-teacher's delete_mini_project (non-force) reads
    is_locked=False at the mp_delete seam; a concurrent create_submission commits
    first_submitted_at; released, the delete proceeds WITHOUT the force/course-admin
    escalation -> a now-locked mini-project is deleted by a mere run-teacher."""
    run, ga, gb, mp = seed_run_with_published_mp()

    # Lock removed so A (parked at mp_delete) holds no MINIPROJECT and B can commit.
    monkeypatch.setattr(advisory, "advisory_xact_lock", lambda db, ns, *ids: None)

    real_hook = advisory.interleave_hook
    a_parked = threading.Event()
    a_release = threading.Event()

    def hook(label):
        if label == "mp_delete":
            a_parked.set()
            if not a_release.wait(timeout=10):
                raise RuntimeError("mp_delete seam release timed out")
        return real_hook(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)

    (sa,) = concurrency.make_sessions(1)
    result = {}

    def run_delete():
        try:
            teacher = sa.execute(select(User).where(User.email == "teach@example.com")).scalar_one()
            delete_mini_project(mp["id"], force=False, db=sa, user=teacher)
            result["status"] = "deleted"
        except HTTPException as exc:
            sa.rollback()
            result["status"] = exc.status_code
        except Exception as exc:  # surface silent thread failures
            result["error"] = repr(exc)

    ta = concurrency.spawn(run_delete)  # A: parks at mp_delete (is_locked=False)
    assert a_parked.wait(timeout=10), "delete_mini_project never reached the mp_delete seam"

    # B commits a first submission -> sets first_submitted_at (mp now locked in DB).
    alice = db.execute(select(User).where(User.email == "alice@example.com")).scalar_one()
    create_submission(mp["id"], _pdf_upload(), db=db, user=alice)
    db.rollback()

    a_release.set()  # release A -> deletes the now-locked mp without escalation
    ta.join(timeout=10)

    assert result.get("error") is None, f"delete thread failed: {result.get('error')}"
    assert result["status"] == "deleted"  # BYPASS: no 409, no course-admin escalation
    (probe,) = concurrency.make_sessions(1)
    gone = probe.get(MiniProject, mp["id"])
    probe.rollback()
    assert gone is None  # the locked mini-project was deleted


def test_delete_mp_bypass_blocked_by_lock(
    concurrency, monkeypatch, db, seed_run_with_published_mp
):
    """GREEN (blocking, spec §6): A (create_submission) acquires MINIPROJECT and parks
    HOLDING it (uncommitted); B (delete_mini_project non-force), past its authz load that
    read is_locked=False, BLOCKS on MINIPROJECT(mp); release A -> it commits the first
    submission (mp now locked) and releases; B unblocks, re-fetches the whole entity ->
    is_locked=True -> 409 force/course-admin gate. Load-bearing: B's pre-lock snapshot
    still says unlocked; only the under-lock refetch produces the 409. A committed, B 409,
    mp still present."""
    run, ga, gb, mp = seed_run_with_published_mp()

    sa, sb, sc = concurrency.make_sessions(3)  # sc is a dedicated blocking-poll probe
    sa_pid, sb_pid = _pid(sa), _pid(sb)

    # A acquires MINIPROJECT and holds it (parks); B blocks on that same lock.
    real_lock = advisory.advisory_xact_lock
    a_holds = threading.Event()
    a_release = threading.Event()

    def lock_ctl(session, ns, *ids):
        if ns == advisory.LOCK_NS_MINIPROJECT and session is sa:
            real_lock(session, ns, *ids)  # acquire and hold
            a_holds.set()
            if not a_release.wait(timeout=10):
                raise RuntimeError("a_release timed out")
            return
        if ns == advisory.LOCK_NS_MINIPROJECT and session is sb:
            real_lock(session, ns, *ids)  # now block on A's held lock
            return
        real_lock(session, ns, *ids)

    monkeypatch.setattr(advisory, "advisory_xact_lock", lock_ctl)

    res_a, res_b = {}, {}

    def submit_a():  # A = mutator: commits a first submission -> locks mp
        try:
            u = sa.execute(select(User).where(User.email == "alice@example.com")).scalar_one()
            create_submission(mp["id"], _pdf_upload(), db=sa, user=u)
            res_a["status"] = "committed"
        except HTTPException as exc:
            sa.rollback()
            res_a["status"] = exc.status_code
        except Exception as exc:  # surface silent thread failures
            res_a["error"] = repr(exc)

    def delete_b():  # B = reader: non-force delete, blocks then re-fetches is_locked=True
        try:
            u = sb.execute(select(User).where(User.email == "teach@example.com")).scalar_one()
            delete_mini_project(mp["id"], force=False, db=sb, user=u)
            res_b["status"] = "deleted"
        except HTTPException as exc:
            sb.rollback()
            res_b["status"] = exc.status_code
            res_b["detail"] = exc.detail
        except Exception as exc:  # surface silent thread failures
            res_b["error"] = repr(exc)

    ta = concurrency.spawn(submit_a)  # A: acquires + holds MINIPROJECT (uncommitted)
    assert a_holds.wait(timeout=10), "create_submission never acquired MINIPROJECT"

    tb = concurrency.spawn(delete_b)  # B: past authz (is_locked=False), blocks on MINIPROJECT
    assert _wait_blocked(sc, sb_pid, sa_pid), "delete B never blocked on A's MINIPROJECT lock"

    a_release.set()  # A: refetch -> insert -> commit (mp locked) -> release
    ta.join(timeout=10)
    tb.join(timeout=10)

    assert res_a.get("error") is None, f"submit A failed: {res_a.get('error')}"
    assert res_a["status"] == "committed"
    assert res_b.get("error") is None, f"delete B failed: {res_b.get('error')}"
    assert res_b["status"] == 409  # under-lock refetch reads is_locked=True -> force gate
    assert res_b["detail"] == "Mini-project is locked (has submissions); use ?force=true"

    (probe,) = concurrency.make_sessions(1)
    assert probe.get(MiniProject, mp["id"]) is not None  # not deleted
    committed = probe.execute(
        select(func.count()).select_from(Submission).where(Submission.mini_project_id == mp["id"])
    ).scalar()
    probe.rollback()
    assert committed == 1  # A committed exactly one submission


# =====================================================================================
# #5 patch two-PATCH deadline lost-update — spec §6, "#5 patch — symmetric, two-PATCH"
# =====================================================================================

def _lock_mp(db, mp_id):
    """Commit a first submission (alice) so the mini-project becomes locked."""
    alice = db.execute(select(User).where(User.email == "alice@example.com")).scalar_one()
    create_submission(mp_id, _pdf_upload(), db=db, user=alice)


def test_patch_two_patch_deadline_lost_update_reproduces_without_lock(
    concurrency, monkeypatch, db, seed_run_with_published_mp
):
    """RED (re-read defeated by racing before the other commits): a LOCKED mp has
    hard_deadline=D0. Thread B (proposing D1) re-fetches D0 and parks at mp_patch;
    thread A extends to D2 and commits; released B's extension guard compares its
    proposed D1 against its STALE D0, passes (D1>D0), and commits -> D2 shortened to
    D1, violating 'can only be extended'. Lock removed so B does not block on A."""
    run, ga, gb, mp = seed_run_with_published_mp()
    _lock_mp(db, mp["id"])  # first_submitted_at set -> extension guard applies
    db.rollback()

    d1 = datetime.now(timezone.utc) + timedelta(days=75)
    d2 = datetime.now(timezone.utc) + timedelta(days=90)

    monkeypatch.setattr(advisory, "advisory_xact_lock", lambda db, ns, *ids: None)

    real_hook = advisory.interleave_hook
    b_parked = threading.Event()
    b_release = threading.Event()
    claimed = {"v": False}
    guard = threading.Lock()

    def hook(label):
        if label == "mp_patch":
            with guard:
                mine = not claimed["v"]
                claimed["v"] = True
            if mine:
                b_parked.set()
                if not b_release.wait(timeout=10):
                    raise RuntimeError("mp_patch seam release timed out")
        return real_hook(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)

    (sb,) = concurrency.make_sessions(1)
    result = {}

    def patch_b():
        try:
            u = sb.execute(select(User).where(User.email == "admin@example.com")).scalar_one()
            patch_mini_project(mp["id"], MiniProjectUpdate(hard_deadline=d1), db=sb, user=u)
            result["b"] = "committed"
        except HTTPException as exc:
            sb.rollback()
            result["b"] = exc.status_code
        except Exception as exc:
            result["error"] = repr(exc)

    tb = concurrency.spawn(patch_b)  # B: re-fetches D0, parks at mp_patch
    assert b_parked.wait(timeout=10), "patch B never reached the mp_patch seam"

    # A extends to D2 and commits (mp_patch seam already claimed by B -> A runs through).
    admin = db.execute(select(User).where(User.email == "admin@example.com")).scalar_one()
    patch_mini_project(mp["id"], MiniProjectUpdate(hard_deadline=d2), db=db, user=admin)
    db.rollback()

    b_release.set()  # release B -> stale D1>D0 check passes -> commits D1
    tb.join(timeout=10)

    assert result.get("error") is None, f"patch thread failed: {result.get('error')}"
    assert result["b"] == "committed"  # B accepted despite D1 < D2
    (probe,) = concurrency.make_sessions(1)
    final = probe.get(MiniProject, mp["id"]).hard_deadline
    probe.rollback()
    assert to_utc_aware(final) == to_utc_aware(d1)  # LOST UPDATE: D2 overwritten by D1


def test_patch_two_patch_deadline_lock_prevents_lost_update(
    concurrency, monkeypatch, db, seed_run_with_published_mp
):
    """GREEN (blocking, whole-entity refetch): A (patch -> D2, extend) acquires MINIPROJECT
    and parks HOLDING it; B (patch -> D1, D1<D2), past its pre-lock load that read D0,
    BLOCKS on MINIPROJECT(mp); release A -> it commits D2 and releases; B unblocks,
    re-fetches the whole entity -> sees D2 -> extension guard rejects D1 <= D2 -> 409
    'can only be extended'. Load-bearing: B's stale D0 would pass the guard (D1>D0); only
    the under-lock refetch of D2 rejects it. A committed D2, B 409, final deadline == D2."""
    run, ga, gb, mp = seed_run_with_published_mp()
    _lock_mp(db, mp["id"])  # first_submitted_at set -> extension guard applies

    sa, sb, sc = concurrency.make_sessions(3)  # sc is a dedicated blocking-poll probe
    sa_pid, sb_pid = _pid(sa), _pid(sb)

    d1 = datetime.now(timezone.utc) + timedelta(days=75)  # D0(=+60d) < D1 < D2
    d2 = datetime.now(timezone.utc) + timedelta(days=90)

    real_lock = advisory.advisory_xact_lock
    a_holds = threading.Event()
    a_release = threading.Event()

    def lock_ctl(session, ns, *ids):
        if ns == advisory.LOCK_NS_MINIPROJECT and session is sa:
            real_lock(session, ns, *ids)  # acquire and hold
            a_holds.set()
            if not a_release.wait(timeout=10):
                raise RuntimeError("a_release timed out")
            return
        if ns == advisory.LOCK_NS_MINIPROJECT and session is sb:
            real_lock(session, ns, *ids)  # now block on A's held lock
            return
        real_lock(session, ns, *ids)

    monkeypatch.setattr(advisory, "advisory_xact_lock", lock_ctl)

    res_a, res_b = {}, {}

    def patch_a():  # A = mutator: extend to D2, holds MINIPROJECT
        try:
            u = sa.execute(select(User).where(User.email == "admin@example.com")).scalar_one()
            patch_mini_project(mp["id"], MiniProjectUpdate(hard_deadline=d2), db=sa, user=u)
            res_a["status"] = "committed"
        except HTTPException as exc:
            sa.rollback()
            res_a["status"] = exc.status_code
        except Exception as exc:  # surface silent thread failures
            res_a["error"] = repr(exc)

    def patch_b():  # B = reader: propose D1 < D2, blocks then re-fetches D2 -> 409
        try:
            u = sb.execute(select(User).where(User.email == "admin@example.com")).scalar_one()
            patch_mini_project(mp["id"], MiniProjectUpdate(hard_deadline=d1), db=sb, user=u)
            res_b["status"] = "committed"
        except HTTPException as exc:
            sb.rollback()
            res_b["status"] = exc.status_code
            res_b["detail"] = exc.detail
        except Exception as exc:  # surface silent thread failures
            res_b["error"] = repr(exc)

    ta = concurrency.spawn(patch_a)  # A: acquires + holds MINIPROJECT (uncommitted)
    assert a_holds.wait(timeout=10), "patch A never acquired MINIPROJECT"

    tb = concurrency.spawn(patch_b)  # B: past pre-lock load (D0), blocks on MINIPROJECT
    assert _wait_blocked(sc, sb_pid, sa_pid), "patch B never blocked on A's MINIPROJECT lock"

    a_release.set()  # A: refetch -> extension guard passes (D2>D0) -> commit D2 -> release
    ta.join(timeout=10)
    tb.join(timeout=10)

    assert res_a.get("error") is None, f"patch A failed: {res_a.get('error')}"
    assert res_a["status"] == "committed"
    assert res_b.get("error") is None, f"patch B failed: {res_b.get('error')}"
    assert res_b["status"] == 409  # under-lock refetch reads D2 -> extension guard rejects D1
    assert "can only be extended" in res_b["detail"]

    (probe,) = concurrency.make_sessions(1)
    final = probe.get(MiniProject, mp["id"]).hard_deadline
    probe.rollback()
    assert to_utc_aware(final) == to_utc_aware(d2)  # D2 preserved, no lost update


# =====================================================================================
# #5 delete_run — both paths reachable (spec §5.5 / §6, "#5 delete_run — both paths")
# =====================================================================================

def _unpublish_and_clear_roster(db, run_id):
    """Make a run non-force-deletable: unpublish + clear the roster. (create_submission
    checks visibility/group ONCE up front, so an in-flight submit past those checks
    still commits — that is what makes both non-force/force REDs reachable, spec §5.5.)"""
    run_obj = db.get(Run, run_id)
    run_obj.is_published = False
    db.execute(RunStudent.__table__.delete().where(RunStudent.run_id == run_id))
    db.commit()


def test_delete_run_nonforce_race_reproduces_fk_23503_rollback_intact(
    concurrency, monkeypatch, db, seed_run_with_published_mp
):
    """Non-force RED (spec §6): B (create_submission) parks AFTER its up-front checks;
    with B parked, unpublish + clear roster (so non-force delete_run passes its
    published/student gates); A (delete_run non-force) parks after has_submissions=False;
    release B -> B commits its row (group_id ON DELETE RESTRICT); release A -> db.delete
    (run) cascades to the run's groups and is REJECTED by B's submission's RESTRICT FK ->
    A raises FK 23503 AND rolls back: run, mini-project, submission row, file ALL intact."""
    run, ga, gb, mp = seed_run_with_published_mp()

    monkeypatch.setattr(advisory, "advisory_xact_lock", lambda db, ns, *ids: None)

    # B parks at submission_pending (after up-front checks + refetch, before its insert).
    real_hook = advisory.interleave_hook
    b_parked = threading.Event()
    b_release = threading.Event()

    def hook(label):
        if label == "submission_pending":
            b_parked.set()
            if not b_release.wait(timeout=10):
                raise RuntimeError("submission_pending seam release timed out")
        return real_hook(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)

    # A parks right after reading has_submissions=False, before db.delete(run).
    real_has = runs_module.has_submissions
    a_at_has = threading.Event()
    a_release = threading.Event()

    def has_spy(dbx, runx):
        val = real_has(dbx, runx)
        a_at_has.set()
        if not a_release.wait(timeout=10):
            raise RuntimeError("has_submissions seam release timed out")
        return val

    monkeypatch.setattr(runs_module, "has_submissions", has_spy)

    sa, sb = concurrency.make_sessions(2)
    res_a, res_b = {}, {}

    def submit_b():
        try:
            u = sb.execute(select(User).where(User.email == "alice@example.com")).scalar_one()
            create_submission(mp["id"], _pdf_upload(), db=sb, user=u)
            res_b["status"] = "committed"
        except Exception as exc:
            res_b["error"] = repr(exc)

    def delete_a():
        try:
            u = sa.execute(select(User).where(User.email == "admin@example.com")).scalar_one()
            delete_run(run["id"], force=False, db=sa, user=u)
            res_a["status"] = "deleted"
        except Exception as exc:
            res_a["exc"] = exc
            sa.rollback()

    tb = concurrency.spawn(submit_b)  # B: passes up-front checks (published/enrolled), parks
    assert b_parked.wait(timeout=10), "submit B never reached submission_pending"

    _unpublish_and_clear_roster(db, run["id"])  # B already past its checks

    ta = concurrency.spawn(delete_a)  # A: non-force gates pass, parks after has_submissions
    assert a_at_has.wait(timeout=10), "delete A never reached has_submissions"

    b_release.set()  # B commits its submission (references group ga via RESTRICT)
    tb.join(timeout=10)
    assert res_b.get("error") is None, f"submit B failed: {res_b.get('error')}"
    assert res_b["status"] == "committed"

    a_release.set()  # A: db.delete(run) -> group cascade rejected by RESTRICT -> FK 23503
    ta.join(timeout=10)

    assert "status" not in res_a, "delete A unexpectedly succeeded (no FK violation)"
    assert _is_fk_23503(res_a.get("exc")), f"expected FK 23503, got {res_a.get('exc')!r}"

    # Rollback left EVERYTHING intact — run, mini-project, submission row, and file.
    (probe,) = concurrency.make_sessions(1)
    assert probe.get(Run, run["id"]) is not None
    assert probe.get(MiniProject, mp["id"]) is not None
    subs = probe.execute(
        select(func.count()).select_from(Submission).where(Submission.mini_project_id == mp["id"])
    ).scalar()
    probe.rollback()
    assert subs == 1
    files = [
        f for f in os.listdir(submission_storage_dir(run["id"], ga["id"]))
        if not f.startswith(".upload-")
    ]
    assert files, "B's committed submission file was lost"


def test_delete_run_nonforce_lock_blocks_submit_then_404(
    concurrency, monkeypatch, db, seed_run_with_published_mp
):
    """Non-force GREEN (blocking, spec §6): A acquires the run's MINIPROJECT lock FIRST
    and parks holding it; B (create_submission), past its up-front checks, BLOCKS on
    MINIPROJECT(mp); release A -> it re-reads has_submissions=False, deletes the still-
    empty run, commits, releases; B unblocks, re-fetches mp -> None -> 404. A 204, B 404,
    no 500, no orphan."""
    run, ga, gb, mp = seed_run_with_published_mp()

    sa, sb, sc = concurrency.make_sessions(3)  # sc is a dedicated blocking-poll probe
    sa_pid, sb_pid = _pid(sa), _pid(sb)

    # B parks BEFORE acquiring MINIPROJECT; A parks AFTER acquiring it (holding it).
    real_lock = advisory.advisory_xact_lock
    a_holds = threading.Event()
    a_release = threading.Event()
    b_at_lock = threading.Event()
    b_release = threading.Event()

    def lock_ctl(session, ns, *ids):
        if ns == advisory.LOCK_NS_MINIPROJECT and session is sb:
            b_at_lock.set()
            if not b_release.wait(timeout=10):
                raise RuntimeError("b_release timed out")
            real_lock(session, ns, *ids)  # now block on A's held lock
            return
        if ns == advisory.LOCK_NS_MINIPROJECT and session is sa:
            real_lock(session, ns, *ids)  # acquire and hold
            a_holds.set()
            if not a_release.wait(timeout=10):
                raise RuntimeError("a_release timed out")
            return
        real_lock(session, ns, *ids)

    monkeypatch.setattr(advisory, "advisory_xact_lock", lock_ctl)

    res_a, res_b = {}, {}

    def submit_b():
        try:
            u = sb.execute(select(User).where(User.email == "alice@example.com")).scalar_one()
            create_submission(mp["id"], _pdf_upload(), db=sb, user=u)
            res_b["status"] = "committed"
        except HTTPException as exc:
            sb.rollback()
            res_b["status"] = exc.status_code
        except Exception as exc:
            res_b["error"] = repr(exc)

    def delete_a():
        try:
            u = sa.execute(select(User).where(User.email == "admin@example.com")).scalar_one()
            delete_run(run["id"], force=False, db=sa, user=u)
            res_a["status"] = "deleted"
        except Exception as exc:
            res_a["error"] = repr(exc)
            sa.rollback()

    tb = concurrency.spawn(submit_b)  # B: past up-front checks, parks before MINIPROJECT
    assert b_at_lock.wait(timeout=10), "submit B never reached the MINIPROJECT acquire"

    _unpublish_and_clear_roster(db, run["id"])  # B already past its checks

    ta = concurrency.spawn(delete_a)  # A: acquires + holds MINIPROJECT
    assert a_holds.wait(timeout=10), "delete A never acquired MINIPROJECT"

    b_release.set()  # B proceeds to real acquire -> blocks on A's held lock
    assert _wait_blocked(sc, sb_pid, sa_pid), "submit B never blocked on A's MINIPROJECT lock"

    a_release.set()  # A: empty run -> deletes -> commits -> releases
    ta.join(timeout=10)
    tb.join(timeout=10)

    assert res_a.get("error") is None, f"delete A failed: {res_a.get('error')}"
    assert res_a["status"] == "deleted"  # 204
    assert res_b.get("error") is None, f"submit B failed: {res_b.get('error')}"
    assert res_b["status"] == 404  # re-fetch mp -> None -> 404 (no 500)

    (probe,) = concurrency.make_sessions(1)
    assert probe.get(Run, run["id"]) is None
    assert probe.get(MiniProject, mp["id"]) is None
    probe.rollback()
    leftovers = [
        f for f in os.listdir(submission_storage_dir(run["id"], ga["id"]))
        if f.startswith(".upload-") and f.endswith(".tmp")
    ] if os.path.isdir(submission_storage_dir(run["id"], ga["id"])) else []
    assert leftovers == []  # no orphan temp


def test_delete_run_force_race_reproduces_fk_23503(
    concurrency, monkeypatch, db, seed_run_with_published_mp
):
    """Force RED (spec §6): A (delete_run force) runs its cascade to a FULL commit
    (mini-projects gone); then B (parked after its up-front checks + refetch) is
    released and attempts its Submission insert with the now-dangling mini_project_id
    -> FK 23503. Lock removed so A does not block on B."""
    run, ga, gb, mp = seed_run_with_published_mp()

    monkeypatch.setattr(advisory, "advisory_xact_lock", lambda db, ns, *ids: None)

    real_hook = advisory.interleave_hook
    b_parked = threading.Event()
    b_release = threading.Event()

    def hook(label):
        if label == "submission_pending":
            b_parked.set()
            if not b_release.wait(timeout=10):
                raise RuntimeError("submission_pending seam release timed out")
        return real_hook(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)

    (sb,) = concurrency.make_sessions(1)
    res_b = {}

    def submit_b():
        try:
            u = sb.execute(select(User).where(User.email == "alice@example.com")).scalar_one()
            create_submission(mp["id"], _pdf_upload(), db=sb, user=u)
            res_b["status"] = "committed"
        except Exception as exc:
            res_b["exc"] = exc
            sb.rollback()

    tb = concurrency.spawn(submit_b)  # B: refetches mp (exists), parks at submission_pending
    assert b_parked.wait(timeout=10), "submit B never reached submission_pending"

    # A force-deletes the run to a full commit (mini-projects + groups gone).
    admin = db.execute(select(User).where(User.email == "admin@example.com")).scalar_one()
    delete_run(run["id"], force=True, db=db, user=admin)
    db.rollback()

    b_release.set()  # B resumes: insert against the now-dangling mini_project_id -> FK 23503
    tb.join(timeout=10)

    assert "status" not in res_b, "submit B unexpectedly committed against a deleted mp"
    assert _is_fk_23503(res_b.get("exc")), f"expected FK 23503, got {res_b.get('exc')!r}"


def test_delete_run_force_lock_blocks_submit_then_404(
    concurrency, monkeypatch, db, seed_run_with_published_mp
):
    """Force GREEN (blocking, spec §6): A (delete_run force) acquires the run's
    MINIPROJECT lock and parks holding it; B blocks on MINIPROJECT(mp); release A ->
    force cascade commits + releases; B unblocks, re-fetches mp -> None -> 404. A 204,
    no orphan, B 404 (no FK 500)."""
    run, ga, gb, mp = seed_run_with_published_mp()

    sa, sb, sc = concurrency.make_sessions(3)  # sc is a dedicated blocking-poll probe
    sa_pid, sb_pid = _pid(sa), _pid(sb)

    real_lock = advisory.advisory_xact_lock
    a_holds = threading.Event()
    a_release = threading.Event()
    b_at_lock = threading.Event()
    b_release = threading.Event()

    def lock_ctl(session, ns, *ids):
        if ns == advisory.LOCK_NS_MINIPROJECT and session is sb:
            b_at_lock.set()
            if not b_release.wait(timeout=10):
                raise RuntimeError("b_release timed out")
            real_lock(session, ns, *ids)
            return
        if ns == advisory.LOCK_NS_MINIPROJECT and session is sa:
            real_lock(session, ns, *ids)
            a_holds.set()
            if not a_release.wait(timeout=10):
                raise RuntimeError("a_release timed out")
            return
        real_lock(session, ns, *ids)

    monkeypatch.setattr(advisory, "advisory_xact_lock", lock_ctl)

    res_a, res_b = {}, {}

    def submit_b():
        try:
            u = sb.execute(select(User).where(User.email == "alice@example.com")).scalar_one()
            create_submission(mp["id"], _pdf_upload(), db=sb, user=u)
            res_b["status"] = "committed"
        except HTTPException as exc:
            sb.rollback()
            res_b["status"] = exc.status_code
        except Exception as exc:
            res_b["error"] = repr(exc)

    def delete_a():
        try:
            u = sa.execute(select(User).where(User.email == "admin@example.com")).scalar_one()
            delete_run(run["id"], force=True, db=sa, user=u)
            res_a["status"] = "deleted"
        except Exception as exc:
            res_a["error"] = repr(exc)
            sa.rollback()

    tb = concurrency.spawn(submit_b)  # B: past up-front checks (published/enrolled), parks
    assert b_at_lock.wait(timeout=10), "submit B never reached the MINIPROJECT acquire"

    ta = concurrency.spawn(delete_a)  # A: acquires + holds MINIPROJECT
    assert a_holds.wait(timeout=10), "delete A never acquired MINIPROJECT"

    b_release.set()  # B proceeds to real acquire -> blocks on A's held lock
    assert _wait_blocked(sc, sb_pid, sa_pid), "submit B never blocked on A's MINIPROJECT lock"

    a_release.set()  # A: force cascade commits + releases
    ta.join(timeout=10)
    tb.join(timeout=10)

    assert res_a.get("error") is None, f"delete A failed: {res_a.get('error')}"
    assert res_a["status"] == "deleted"
    assert res_b.get("error") is None, f"submit B failed: {res_b.get('error')}"
    assert res_b["status"] == 404  # re-fetch mp -> None -> 404 (no FK 500)

    (probe,) = concurrency.make_sessions(1)
    assert probe.get(Run, run["id"]) is None
    assert probe.get(MiniProject, mp["id"]) is None
    probe.rollback()
    d = submission_storage_dir(run["id"], ga["id"])
    leftovers = [f for f in os.listdir(d) if f.startswith(".upload-")] if os.path.isdir(d) else []
    assert leftovers == []  # no orphan temp


# =====================================================================================
# Wiring + ordering assertions — spec §6, "Wiring + ordering assertions"
# =====================================================================================

def test_create_submission_mp_lock_before_submission_and_refetch(
    monkeypatch, db, seed_run_with_published_mp
):
    """create_submission records MINIPROJECT(mp_id) THEN SUBMISSION(mp_id, group_id),
    with the whole-entity mp re-fetch after MINIPROJECT and before the deadline gates."""
    run, ga, gb, mp = seed_run_with_published_mp()
    alice = db.execute(select(User).where(User.email == "alice@example.com")).scalar_one()

    events = record_lock_calls(monkeypatch)

    real_get = db.get

    def get_spy(entity, ident, *a, **k):
        r = real_get(entity, ident, *a, **k)
        if entity is MiniProject and k.get("populate_existing"):
            events.append(("refetch", ident))
        return r

    monkeypatch.setattr(db, "get", get_spy)

    seen = {"deadline": False}
    real_deadline = submissions.to_utc_aware

    def deadline_spy(v):
        if not seen["deadline"]:
            events.append(("deadline_read",))
            seen["deadline"] = True
        return real_deadline(v)

    monkeypatch.setattr(submissions, "to_utc_aware", deadline_spy)

    create_submission(mp["id"], _pdf_upload(), db=db, user=alice)

    mp_i = events.index(("lock", advisory.LOCK_NS_MINIPROJECT, (mp["id"],)))
    sub_i = events.index(("lock", advisory.LOCK_NS_SUBMISSION, (mp["id"], ga["id"])))
    refetch_i = events.index(("refetch", mp["id"]))
    deadline_i = events.index(("deadline_read",))
    assert mp_i < sub_i < refetch_i < deadline_i


def test_patch_mp_lock_then_refetch(monkeypatch, db, seed_run_with_published_mp):
    """patch_mini_project records MINIPROJECT(mp_id), with the whole-entity
    populate_existing re-fetch recorded AFTER the lock."""
    run, ga, gb, mp = seed_run_with_published_mp()
    admin = db.execute(select(User).where(User.email == "admin@example.com")).scalar_one()

    events = record_lock_calls(monkeypatch)
    real_get = db.get

    def get_spy(entity, ident, *a, **k):
        r = real_get(entity, ident, *a, **k)
        if entity is MiniProject and k.get("populate_existing"):
            events.append(("refetch", ident))
        return r

    monkeypatch.setattr(db, "get", get_spy)

    patch_mini_project(mp["id"], MiniProjectUpdate(assignment_md="Updated."), db=db, user=admin)

    lock_i = events.index(("lock", advisory.LOCK_NS_MINIPROJECT, (mp["id"],)))
    refetch_i = events.index(("refetch", mp["id"]))
    assert lock_i < refetch_i


def test_delete_mp_lock_then_refetch(monkeypatch, db, seed_run_with_published_mp):
    """delete_mini_project records MINIPROJECT(mp_id), with the whole-entity
    populate_existing re-fetch recorded AFTER the lock."""
    run, ga, gb, mp = seed_run_with_published_mp()
    admin = db.execute(select(User).where(User.email == "admin@example.com")).scalar_one()

    events = record_lock_calls(monkeypatch)
    real_get = db.get

    def get_spy(entity, ident, *a, **k):
        r = real_get(entity, ident, *a, **k)
        if entity is MiniProject and k.get("populate_existing"):
            events.append(("refetch", ident))
        return r

    monkeypatch.setattr(db, "get", get_spy)

    delete_mini_project(mp["id"], force=False, db=db, user=admin)  # unlocked -> 204

    lock_i = events.index(("lock", advisory.LOCK_NS_MINIPROJECT, (mp["id"],)))
    refetch_i = events.index(("refetch", mp["id"]))
    assert lock_i < refetch_i


def test_delete_run_locks_all_mps_ascending_before_has_submissions(
    monkeypatch, db, seed_run_with_published_mp
):
    """delete_run records one MINIPROJECT lock per run mini-project in ascending mp_id
    order, all recorded BEFORE the has_submissions guard read."""
    run, ga, gb, mp = seed_run_with_published_mp()
    admin = db.execute(select(User).where(User.email == "admin@example.com")).scalar_one()
    run_obj = db.get(Run, run["id"])

    # A second block + mini-project so delete_run locks TWO mps (ascending id order).
    b2 = Block(version_id=run_obj.version_id, title="B2", slug="b2", order=2)
    db.add(b2)
    db.flush()
    mp2 = MiniProject(
        run_id=run["id"], block_id=b2.id, assignment_md="x",
        assignment_html="<p>x</p>", is_published=False,
    )
    db.add(mp2)
    db.flush()
    mp2_id = mp2.id
    assert mp["id"] < mp2_id  # created earlier -> lower id

    # Make the run non-force-deletable (no submissions exist).
    run_obj.is_published = False
    db.execute(RunStudent.__table__.delete().where(RunStudent.run_id == run["id"]))
    db.commit()

    events = record_lock_calls(monkeypatch)
    real_has = runs_module.has_submissions

    def has_spy(dbx, runx):
        events.append(("read", "has_submissions"))
        return real_has(dbx, runx)

    monkeypatch.setattr(runs_module, "has_submissions", has_spy)

    delete_run(run["id"], force=False, db=db, user=admin)  # 204

    mp_locks = [e for e in events if e[0] == "lock" and e[1] == advisory.LOCK_NS_MINIPROJECT]
    assert mp_locks == [
        ("lock", advisory.LOCK_NS_MINIPROJECT, (mp["id"],)),
        ("lock", advisory.LOCK_NS_MINIPROJECT, (mp2_id,)),
    ]  # ascending mp_id, one per run mini-project
    read_i = events.index(("read", "has_submissions"))
    assert all(events.index(l) < read_i for l in mp_locks)  # all locks precede the guard read
