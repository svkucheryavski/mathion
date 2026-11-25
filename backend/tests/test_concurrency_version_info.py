"""Course-info edits and publish take one per-version lock first (beta gate Task 3)."""
import io
import threading
import time

from sqlalchemy import select, text

from mathion.api import advisory
from mathion.api import versions as versions_api
from mathion.api.versions import publish_version, update_version
from mathion.models import AssetReference, CourseVersion
from mathion.models_auth import User
from mathion.schemas import VersionUpdate
from tests.conftest import record_lock_calls


def _draft_with_two_assets(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "vi", "name": "C", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"label": "L", "info_md": ""}).json()
    for name in ("a.png", "b.png"):
        r = admin_client.post(f"/api/versions/{version['id']}/assets",
                              files={"file": (name, io.BytesIO(b"png"), "image/png")})
        assert r.status_code == 201
    return version


def _lock_waiting(probe) -> bool:
    probe.rollback()
    return bool(probe.execute(text(
        "SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted LIMIT 1")).first())


def test_two_info_edits_leave_only_the_last_reference(concurrency, monkeypatch, admin_client, db):
    version = _draft_with_two_assets(admin_client)
    vid = version["id"]
    a_parked, a_release = threading.Event(), threading.Event()
    real_hook = advisory.interleave_hook

    def hook(label):
        if label == "version_info" and threading.current_thread().name == "A":
            a_parked.set()
            if not a_release.wait(timeout=10):
                raise RuntimeError("version_info seam release timed out")
        return real_hook(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)
    sa, sb, probe = concurrency.make_sessions(3)
    result = {}

    def edit(session, key, md):
        try:
            admin = session.execute(select(User).where(User.email == "admin@example.com")).scalar_one()
            update_version(vid, VersionUpdate(info_md=md), db=session, user=admin)
            result[key] = "ok"
        except Exception as exc:  # surface thread failures
            session.rollback()
            result[key] = repr(exc)

    ta = threading.Thread(target=edit, args=(sa, "a", "![a](a.png)"), name="A")
    ta.start()
    concurrency.threads.append(ta)
    assert a_parked.wait(timeout=10), "update_version never reached the version_info seam"
    tb = concurrency.spawn(edit, sb, "b", "![b](b.png)")
    deadline = time.monotonic() + 10
    while tb.is_alive() and not _lock_waiting(probe) and time.monotonic() < deadline:
        time.sleep(0.02)
    a_release.set()
    ta.join(timeout=10)
    tb.join(timeout=10)
    assert result == {"a": "ok", "b": "ok"}
    probe.rollback()
    info = probe.execute(text("SELECT info_md FROM course_versions WHERE id = :id"), {"id": vid}).scalar_one()
    refs = probe.execute(text(
        "SELECT a.filename FROM asset_references r JOIN assets a ON a.id = r.asset_id "
        "WHERE r.info_version_id = :id ORDER BY a.filename"), {"id": vid}).scalars().all()
    probe.rollback()
    assert (info, refs) == ("![b](b.png)", ["b.png"])


def test_info_edit_and_publish_take_the_version_lock_first(monkeypatch, admin_client, db):
    version = _draft_with_two_assets(admin_client)
    events = record_lock_calls(monkeypatch)
    real_get = versions_api.get_or_404

    def get(session, model, ident):
        if model is CourseVersion:
            events.append(("read",))
        return real_get(session, model, ident)

    monkeypatch.setattr(versions_api, "get_or_404", get)
    admin = db.execute(select(User).where(User.email == "admin@example.com")).scalar_one()
    db.expire_all()
    update_version(version["id"], VersionUpdate(info_md="![a](a.png)"), db=db, user=admin)
    publish_version(version["id"], db=db, user=admin)
    assert events == [("lock", advisory.LOCK_NS_VERSION_INFO, (version["id"],)), ("read",)] * 2
    refs = db.scalars(select(AssetReference).where(AssetReference.info_version_id == version["id"])).all()
    assert len(refs) == 1
