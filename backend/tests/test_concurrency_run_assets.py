"""Upload takes the run's mini-project locks before it inserts the asset (math round 2026-11-24).

Off-HTTP like test_concurrency_mini_project: thread bodies call the router functions
directly with per-thread sessions and assert the HTTPException status codes.
"""
import threading

import pytest
from tempfile import SpooledTemporaryFile

from fastapi import HTTPException
from sqlalchemy import select
from starlette.datastructures import UploadFile

from mathion.api import advisory
from mathion.api.mini_projects import patch_mini_project
from mathion.api.run_assets import upload_run_asset
from mathion.api.runs import delete_run
from mathion.models import MiniProject
from mathion.models_auth import User
from mathion.schemas import MiniProjectUpdate
from tests.test_concurrency_mini_project import _pid, _unpublish_and_clear_roster, _wait_blocked
from tests.test_run_assets import _create_referenced_asset


def _pdf(name):
    spool = SpooledTemporaryFile()
    spool.write(b"%PDF-1.4 upload")
    spool.seek(0)
    return UploadFile(file=spool, filename=name)


def _admin(session):
    return session.execute(select(User).where(User.email == "admin@example.com")).scalar_one()


def test_upload_waits_for_run_delete_then_404(concurrency, monkeypatch, db, admin_client, seed_run_with_groups):
    """A run delete holds the mini-project locks; an upload blocks on them, then gets a clean 404 (no deadlock)."""
    run, _, _ = seed_run_with_groups()
    _create_referenced_asset(admin_client, db, run, "keep.pdf")
    _unpublish_and_clear_roster(db, run["id"])

    sd, su, probe = concurrency.make_sessions(3)
    sd_pid, su_pid = _pid(sd), _pid(su)
    real_lock = advisory.advisory_xact_lock
    d_holds, d_release = threading.Event(), threading.Event()

    def lock_ctl(session, ns, *ids):
        real_lock(session, ns, *ids)
        if ns == advisory.LOCK_NS_MINIPROJECT and session is sd and not d_holds.is_set():
            d_holds.set()
            if not d_release.wait(timeout=10):
                raise RuntimeError("d_release timed out")

    monkeypatch.setattr(advisory, "advisory_xact_lock", lock_ctl)
    res_d, res_u = {}, {}

    def delete():
        try:
            delete_run(run["id"], force=True, db=sd, user=_admin(sd))
            res_d["status"] = "deleted"
        except Exception as exc:
            res_d["error"] = repr(exc)
            sd.rollback()

    def upload():
        try:
            upload_run_asset(run["id"], _pdf("late.pdf"), user=_admin(su), db=su)
            res_u["status"] = "created"
        except HTTPException as exc:
            su.rollback()
            res_u["status"] = exc.status_code
        except Exception as exc:
            res_u["error"] = repr(exc)
            su.rollback()

    td = concurrency.spawn(delete)
    assert d_holds.wait(timeout=10), "delete never took the mini-project lock"
    tu = concurrency.spawn(upload)
    assert _wait_blocked(probe, su_pid, sd_pid), "upload never blocked on the delete's lock"
    d_release.set()
    td.join(timeout=15)
    tu.join(timeout=15)

    assert res_d.get("error") is None, res_d.get("error")
    assert res_d["status"] == "deleted"
    assert res_u.get("error") is None, res_u.get("error")
    assert res_u["status"] == 404


def test_upload_and_delete_run_do_not_deadlock(concurrency, monkeypatch, db, admin_client, seed_run_with_groups):
    """The upload parks holding the locks; a forced run delete waits, then both finish without a 500."""
    run, _, _ = seed_run_with_groups()
    _create_referenced_asset(admin_client, db, run, "keep.pdf")
    _unpublish_and_clear_roster(db, run["id"])

    su, sd, probe = concurrency.make_sessions(3)
    su_pid, sd_pid = _pid(su), _pid(sd)
    real_hook = advisory.interleave_hook
    u_parked, u_release = threading.Event(), threading.Event()

    def hook(label):
        if label == "asset_upload_locked":
            u_parked.set()
            if not u_release.wait(timeout=10):
                raise RuntimeError("u_release timed out")
        return real_hook(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)
    res_d, res_u = {}, {}

    def upload():
        try:
            res_u["status"] = upload_run_asset(run["id"], _pdf("late.pdf"), user=_admin(su), db=su).filename
        except HTTPException as exc:
            su.rollback()
            res_u["status"] = exc.status_code
        except Exception as exc:
            res_u["error"] = repr(exc)
            su.rollback()

    def delete():
        try:
            delete_run(run["id"], force=True, db=sd, user=_admin(sd))
            res_d["status"] = "deleted"
        except Exception as exc:
            res_d["error"] = repr(exc)
            sd.rollback()

    tu = concurrency.spawn(upload)
    assert u_parked.wait(timeout=10), "upload never reached asset_upload_locked"
    td = concurrency.spawn(delete)
    assert _wait_blocked(probe, sd_pid, su_pid), "delete never blocked on the upload's lock"
    u_release.set()
    tu.join(timeout=15)
    td.join(timeout=15)

    assert res_u.get("error") is None, res_u.get("error")
    assert res_u["status"] in ("late.pdf", 404)  # the delete may commit before the upload's re-read
    assert res_d.get("error") is None, res_d.get("error")
    assert res_d["status"] == "deleted"


def test_upload_reads_text_saved_while_waiting(concurrency, monkeypatch, db, admin_client, seed_run_with_groups):
    """A save removing the link holds the lock; the waiting upload reads the saved text, so no stale row."""
    run, _, _ = seed_run_with_groups()
    asset = _create_referenced_asset(admin_client, db, run, "fig.pdf")
    mp_id = db.execute(select(MiniProject.id).where(MiniProject.run_id == run["id"])).scalar_one()
    assert admin_client.delete(f"/api/runs/{run['id']}/assets/{asset['id']}?force=true").status_code == 204

    sp, su, probe = concurrency.make_sessions(3)
    sp_pid, su_pid = _pid(sp), _pid(su)
    real_hook = advisory.interleave_hook
    p_parked, p_release = threading.Event(), threading.Event()

    def hook(label):
        if label == "mp_patch":                        # only the save passes this hook
            p_parked.set()
            if not p_release.wait(timeout=10):
                raise RuntimeError("p_release timed out")
        return real_hook(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)
    res_p, res_u = {}, {}

    def patch():
        try:
            patch_mini_project(mp_id, MiniProjectUpdate(assignment_md="No figure now."), db=sp, user=_admin(sp))
            res_p["status"] = "saved"
        except Exception as exc:
            res_p["error"] = repr(exc)
            sp.rollback()

    def upload():
        try:
            res_u["body"] = upload_run_asset(run["id"], _pdf("fig.pdf"), user=_admin(su), db=su)
        except Exception as exc:
            res_u["error"] = repr(exc)
            su.rollback()

    tp = concurrency.spawn(patch)
    assert p_parked.wait(timeout=10), "save never reached its lock"
    tu = concurrency.spawn(upload)
    assert _wait_blocked(probe, su_pid, sp_pid), "upload never blocked on the save's lock"
    p_release.set()
    tp.join(timeout=15)
    tu.join(timeout=15)

    assert res_p.get("error") is None, res_p.get("error")
    assert res_u.get("error") is None, res_u.get("error")
    assert res_u["body"].referenced_by == []


@pytest.mark.parametrize("force", [True, False])
def test_upload_and_delete_run_with_a_new_mini_project(force, concurrency, monkeypatch, db, admin_client, seed_run_with_groups):
    """A mini-project made after the run delete took its locks: the delete must lock it too, or the upload deadlocks."""
    from mathion.api import run_assets
    from tests.test_run_assets import _mp

    run, _, _ = seed_run_with_groups()
    first = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("fig.pdf", __import__("io").BytesIO(b"%PDF-1.4\n"), "application/pdf")},
    ).json()
    _unpublish_and_clear_roster(db, run["id"])

    sd, su, probe = concurrency.make_sessions(3)
    sd_pid, su_pid = _pid(sd), _pid(su)
    real_hook = advisory.interleave_hook
    real_reference = run_assets.reference_new_run_asset
    d_parked, d_release = threading.Event(), threading.Event()
    u_parked, u_release = threading.Event(), threading.Event()

    def hook(label):
        if label == "run_delete_locked":
            d_parked.set()
            if not d_release.wait(timeout=10):
                raise RuntimeError("d_release timed out")
        return real_hook(label)

    def reference(session, asset, mp_ids):
        u_parked.set()  # the asset row is flushed: the upload holds a key-share lock on the run
        if not u_release.wait(timeout=10):
            raise RuntimeError("u_release timed out")
        return real_reference(session, asset, mp_ids)

    monkeypatch.setattr(advisory, "interleave_hook", hook)
    monkeypatch.setattr(run_assets, "reference_new_run_asset", reference)
    res_d, res_u = {}, {}

    def delete():
        try:
            delete_run(run["id"], force=force, db=sd, user=_admin(sd))
            res_d["status"] = "deleted"
        except Exception as exc:
            res_d["error"] = repr(exc)
            sd.rollback()

    def upload():
        try:
            res_u["status"] = upload_run_asset(run["id"], _pdf("fig.pdf"), user=_admin(su), db=su).filename
        except HTTPException as exc:
            su.rollback()
            res_u["status"] = exc.status_code
        except Exception as exc:
            res_u["error"] = repr(exc)
            su.rollback()

    td = concurrency.spawn(delete)
    assert d_parked.wait(timeout=10), "delete never reached run_delete_locked"
    _mp(admin_client, db, run, "See [f](fig.pdf).")  # made after the delete took its locks
    assert admin_client.delete(f"/api/runs/{run['id']}/assets/{first['id']}?force=true").status_code == 204
    tu = concurrency.spawn(upload)
    assert u_parked.wait(timeout=10), "upload never reached its reference step"
    d_release.set()
    assert _wait_blocked(probe, sd_pid, su_pid), "delete never waited for the upload"
    u_release.set()
    td.join(timeout=15)
    tu.join(timeout=15)

    assert res_u.get("error") is None, res_u.get("error")
    assert res_d.get("error") is None, res_d.get("error")
    assert res_d["status"] == "deleted"
    assert res_u["status"] in ("fig.pdf", 404)


def test_delete_run_locks_new_mini_projects_before_touching_submissions(concurrency, monkeypatch, db, admin_client, seed_run_with_groups):
    """The late lock pass comes before any submission read or delete, so locks always precede row locks."""
    from sqlalchemy import event
    from tests.test_run_assets import _mp

    run, _, _ = seed_run_with_groups()
    _unpublish_and_clear_roster(db, run["id"])
    (sd,) = concurrency.make_sessions(1)  # its own session, so the create commits apart from the delete
    engine = sd.get_bind()
    real_hook, real_lock = advisory.interleave_hook, advisory.advisory_xact_lock
    events, made = [], {}

    def hook(label):
        if label == "run_delete_locked":
            made["mp"] = _mp(admin_client, db, run, "Made mid-delete.")["id"]
            made["recording"] = True
        return real_hook(label)

    def lock(session, ns, *ids):
        if made.get("recording"):
            events.append(("lock", ns, *ids))
        return real_lock(session, ns, *ids)

    def record(conn, cursor, statement, *args):
        if made.get("recording") and "submissions" in statement:
            events.append(("sql", statement.split()[0]))

    monkeypatch.setattr(advisory, "interleave_hook", hook)
    monkeypatch.setattr(advisory, "advisory_xact_lock", lock)
    event.listen(engine, "before_cursor_execute", record)
    try:
        delete_run(run["id"], force=True, db=sd, user=_admin(sd))
    finally:
        event.remove(engine, "before_cursor_execute", record)
    late = events.index(("lock", advisory.LOCK_NS_MINIPROJECT, made["mp"]))
    first_sql = next(i for i, e in enumerate(events) if e[0] == "sql")
    assert late < first_sql, events
