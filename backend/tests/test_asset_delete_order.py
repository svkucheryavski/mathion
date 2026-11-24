"""Asset delete: links before the asset row, the file out of the way before the commit (beta gate Task 3b)."""
import io
import os
from contextlib import contextmanager

import pytest
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from mathion.api.submission_files import run_asset_storage_dir
from mathion.database import SessionLocal, engine


@contextmanager
def _statements():
    seen: list[str] = []

    def grab(conn, cursor, statement, params, context, executemany):
        seen.append(statement)

    event.listen(engine, "before_cursor_execute", grab)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", grab)


@contextmanager
def _after_delete_commit(table, asset_id, action):
    """Run action once, right after the commit that removed the asset row."""
    fired = []

    def run(session):
        if fired:
            return
        with SessionLocal() as s:
            gone = s.execute(text(f"SELECT 1 FROM {table} WHERE id = :id"), {"id": asset_id}).first() is None
        if gone:
            fired.append(True)
            action()

    event.listen(Session, "after_commit", run)
    try:
        yield fired
    finally:
        event.remove(Session, "after_commit", run)


def _course_asset(admin_client, asset_tmpdir, linked):
    course = admin_client.post("/api/courses", json={"slug": "del", "name": "C", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"label": "L", "info_md": ""}).json()
    asset = admin_client.post(f"/api/versions/{version['id']}/assets",
                              files={"file": ("pic.png", io.BytesIO(b"old"), "image/png")}).json()
    if linked:
        r = admin_client.patch(f"/api/versions/{version['id']}", json={"info_md": "![p](pic.png)"})
        assert r.status_code == 200
    path = asset_tmpdir / "courses" / str(version["id"]) / "pic.png"
    return f"/api/assets/{asset['id']}", asset["id"], path


def _run_asset(admin_client, db, seed_run_with_groups, linked):
    from sqlalchemy import select
    from mathion.models import Block, Run
    run, _, _ = seed_run_with_groups()
    asset = admin_client.post(f"/api/runs/{run['id']}/assets",
                              files={"file": ("data.csv", io.BytesIO(b"old"), "text/csv")}).json()
    if linked:
        block = db.execute(select(Block).where(Block.version_id == db.get(Run, run["id"]).version_id)).scalars().first()
        r = admin_client.post(f"/api/runs/{run['id']}/mini-projects",
                              json={"block_id": block.id, "assignment_md": "Use [d](data.csv).",
                                    "hard_deadline": "2026-06-01T23:59:00Z",
                                    "resubmission_deadline": "2026-06-15T23:59:00Z"})
        assert r.status_code == 201, r.text
    path = os.path.join(run_asset_storage_dir(run["id"]), "data.csv")
    return f"/api/runs/{run['id']}/assets/{asset['id']}", asset["id"], path


@pytest.fixture
def kinds(admin_client, db, asset_tmpdir, seed_run_with_groups):
    return {
        "course": ("assets", "asset_references",
                   lambda linked: _course_asset(admin_client, asset_tmpdir, linked)),
        "run": ("run_assets", "run_asset_references",
                lambda linked: _run_asset(admin_client, db, seed_run_with_groups, linked)),
    }


@pytest.mark.parametrize("kind", ["course", "run"])
def test_delete_keeps_a_file_written_after_its_commit(admin_client, kinds, kind):
    table, _refs, make = kinds[kind]
    url, asset_id, path = make(False)

    def same_name_upload_lands():
        with open(path, "wb") as f:
            f.write(b"new")

    with _after_delete_commit(table, asset_id, same_name_upload_lands) as fired:
        assert admin_client.delete(url).status_code == 204
    assert fired
    with open(path, "rb") as f:
        assert f.read() == b"new"
    assert [n for n in os.listdir(os.path.dirname(path)) if n.startswith(".")] == []


@pytest.mark.parametrize("kind", ["course", "run"])
def test_force_delete_drops_links_before_the_asset(admin_client, kinds, kind):
    table, refs, make = kinds[kind]
    url, _asset_id, _path = make(True)
    with _statements() as seen:
        assert admin_client.delete(url + "?force=true").status_code == 204
    first_refs = next(i for i, s in enumerate(seen) if s.startswith(f"DELETE FROM {refs} "))
    first_asset = next(i for i, s in enumerate(seen) if s.startswith(f"DELETE FROM {table} "))
    assert first_refs < first_asset


@pytest.mark.parametrize("kind", ["course", "run"])
def test_delete_whose_commit_fails_keeps_the_file(admin_client, kinds, kind, monkeypatch):
    table, _refs, make = kinds[kind]
    url, _asset_id, path = make(False)

    def fail(session):
        raise RuntimeError("commit failed")

    event.listen(Session, "before_commit", fail)
    try:
        with pytest.raises(RuntimeError):
            admin_client.delete(url)
    finally:
        event.remove(Session, "before_commit", fail)
    with open(path, "rb") as f:
        assert f.read() == b"old"
    assert [n for n in os.listdir(os.path.dirname(path)) if n.startswith(".")] == []


def _swap_row_on_load(monkeypatch, module, model, table, path):
    """Once the handler has loaded the row: give it a new id (a delete plus a same-name upload) and new bytes."""
    real = module.get_or_404
    done = []

    def get(session, m, ident, *a, **k):
        obj = real(session, m, ident, *a, **k)
        if m is model and not done:
            done.append(True)
            with SessionLocal() as s:
                s.execute(text(f"UPDATE {table} SET id = id + 1000 WHERE id = :id"), {"id": ident})
                s.commit()
            with open(path, "wb") as f:
                f.write(b"new")
        return obj

    monkeypatch.setattr(module, "get_or_404", get)


@pytest.mark.parametrize("kind", ["course", "run"])
def test_delete_of_a_row_gone_meanwhile_keeps_the_new_file(admin_client, kinds, kind, monkeypatch):
    from mathion.api import assets as assets_api, run_assets as run_assets_api
    from mathion.models import Asset, RunAsset
    table, _refs, make = kinds[kind]
    url, _asset_id, path = make(False)
    module, model = (assets_api, Asset) if kind == "course" else (run_assets_api, RunAsset)
    _swap_row_on_load(monkeypatch, module, model, table, path)
    r = admin_client.delete(url)
    assert r.status_code == 404
    with open(path, "rb") as f:
        assert f.read() == b"new"


@pytest.mark.parametrize("kind", ["course", "run"])
def test_restore_keeps_a_newer_file(admin_client, kinds, kind):
    _table, _refs, make = kinds[kind]
    url, _asset_id, path = make(False)

    def newer_then_fail(session):
        with open(path, "wb") as f:
            f.write(b"newer")
        raise RuntimeError("commit failed")

    event.listen(Session, "before_commit", newer_then_fail)
    try:
        with pytest.raises(RuntimeError):
            admin_client.delete(url)
    finally:
        event.remove(Session, "before_commit", newer_then_fail)
    with open(path, "rb") as f:
        assert f.read() == b"newer"
    assert [n for n in os.listdir(os.path.dirname(path)) if n.startswith(".")] == []


def test_course_delete_takes_the_version_lock_first(admin_client, asset_tmpdir, monkeypatch):
    from mathion.api import advisory
    from tests.conftest import record_lock_calls
    url, _asset_id, path = _course_asset(admin_client, asset_tmpdir, True)
    events = record_lock_calls(monkeypatch)
    with _statements() as seen:
        assert admin_client.delete(url + "?force=true").status_code == 204
    assert events == [("lock", advisory.LOCK_NS_VERSION_INFO, (int(path.parent.name),))]
    lock = next(i for i, s in enumerate(seen) if "pg_advisory_xact_lock" in s)
    links = next(i for i, s in enumerate(seen) if s.startswith("DELETE FROM asset_references "))
    assert lock < links


def test_script_cleanup_deletes_the_row_before_moving_the_file(admin_client, asset_tmpdir, monkeypatch):
    course = admin_client.post("/api/courses", json={"slug": "js", "name": "C", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"label": "L", "info_md": ""}).json()
    b = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "info": ""}).json()
    s = admin_client.post(f"/api/blocks/{b['id']}/sequences", json={"title": "S"}).json()
    item = admin_client.post(f"/api/sequences/{s['id']}/items", json={"title": "App", "type": "interactive_app"}).json()
    for name in ("a.js", "b.js"):
        r = admin_client.post(f"/api/versions/{version['id']}/assets",
                              files={"file": (name, io.BytesIO(b"x"), "text/javascript")})
        assert r.status_code == 201
    assert admin_client.patch(f"/api/items/{item['id']}", json={"script_url": "a.js"}).status_code == 200
    log: list[str] = []
    real_replace = os.replace

    def replace(src, dst):
        log.append(f"move {os.path.basename(str(src))}")
        real_replace(src, dst)

    monkeypatch.setattr(os, "replace", replace)

    def grab(conn, cursor, statement, params, context, executemany):
        if statement.startswith("DELETE FROM assets "):
            log.append("delete row")

    event.listen(engine, "before_cursor_execute", grab)
    try:
        assert admin_client.patch(f"/api/items/{item['id']}", json={"script_url": "b.js"}).status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", grab)
    assert log[:2] == ["delete row", "move a.js"]
    assert not (asset_tmpdir / "courses" / str(version["id"]) / "a.js").exists()


def test_restore_without_hard_links_keeps_the_file(admin_client, asset_tmpdir, monkeypatch):
    url, _asset_id, path = _course_asset(admin_client, asset_tmpdir, False)

    def no_links(src, dst):
        raise PermissionError("no hard links on this volume")

    def fail(session):
        raise RuntimeError("commit failed")

    monkeypatch.setattr(os, "link", no_links)
    event.listen(Session, "before_commit", fail)
    try:
        with pytest.raises(RuntimeError):
            admin_client.delete(url)
    finally:
        event.remove(Session, "before_commit", fail)
    assert path.read_bytes() == b"old"
    assert [p.name for p in path.parent.iterdir() if p.name.startswith(".")] == []
