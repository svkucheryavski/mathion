"""Task 7: the OLX import routes, the streamed body cap and apply()."""
import asyncio
import io
import json
import os
import threading
import time
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from starlette.testclient import TestClient

import mathion.api.olx_import as olx_import
import mathion.olx.apply as apply_mod
from mathion.api.asset_render import render_with_assets
from mathion.database import SessionLocal, engine, get_db
from mathion.main import app
from mathion.models import (AnswerOption, Asset, AssetReference, Block, Course, CourseAdmin, CourseVersion,
                            Item, Question, Sequence)
from mathion.olx.apply import ApplyRefused, apply
from mathion.olx.bundle import CheckBody
from mathion.olx.convert import convert
from mathion.olx.files import Limits
from tests.conftest import CSRFTestClient
from tests.test_olx_tree import fixture_files

FIX = Path(__file__).parent / "fixtures" / "olx"
FILES = {"fig-1.png": FIX / "course/static/img/fig 1.png", "notes.pdf": FIX / "course/static/notes.pdf",
         "sine-demo.js": FIX / "apps/sine-demo.js"}
CHECK = {"files": fixture_files(),
         "static": [{"path": "img/fig 1.png", "size": 67, "skipped": None}, {"path": "notes.pdf", "size": 586, "skipped": None}],
         "apps": [{"name": "sine-demo.js", "size": 409}]}
BUILD = {**CHECK, "report": [], "date": "2026-11-18"}
UNFINISHED = "Open edX (unfinished): Synthetic Demo Course"
FINAL = "Open edX: Synthetic Demo Course (2026-11-18)"
LIMITS = Limits(20 * 1024 * 1024, 500 * 1024 * 1024)


def _admin_course(db, user, admin=True, slug="olx-course"):
    course = Course(slug=slug, name="OLX", description="")
    db.add(course)
    db.flush()
    if admin:
        db.add(CourseAdmin(course_id=course.id, user_id=user.id))
    version = CourseVersion(course_id=course.id, label=UNFINISHED, info_md="", info_html="", max_quiz_attempts=2)
    db.add(version)
    db.commit()
    return course, version


def _new_version(db, course, label=UNFINISHED):
    version = CourseVersion(course_id=course.id, label=label, info_md="", info_html="", max_quiz_attempts=2)
    db.add(version)
    db.commit()
    return version


def _upload(client, vid, name, data):
    r = client.post(f"/api/versions/{vid}/assets", files={"file": (name, io.BytesIO(data), "application/octet-stream")})
    assert r.status_code == 201, r.text
    return r


def _upload_all(client, vid, skip=()):
    for name, path in FILES.items():
        if name not in skip:
            _upload(client, vid, name, path.read_bytes())


def _count(db, model, **where):
    db.expire_all()
    q = select(func.count()).select_from(model)
    for k, v in where.items():
        q = q.where(getattr(model, k) == v)
    return db.scalar(q)


def _blocks(db, vid):
    return _count(db, Block, version_id=vid)


def _build(client, vid, body=BUILD):
    return client.post(f"/api/versions/{vid}/olx-import/build", json=body)


@pytest.fixture
def real_client(auth_client):
    """auth_client without the shared-session override: every request gets its own session."""
    saved = app.dependency_overrides.pop(get_db)
    yield auth_client
    app.dependency_overrides[get_db] = saved


def _token(auth_client):
    return auth_client.cookies["session_token"]


# --- config


def test_auth_config_has_max_total_mb(client):
    assert client.get("/api/auth/config").json()["max_total_mb"] == 500


# --- check


def test_check_returns_plan_and_writes_nothing(auth_client, db, test_user):
    course, version = _admin_course(db, test_user)
    before = [_count(db, m) for m in (Block, Item, Asset, AssetReference)]
    r = auth_client.post(f"/api/courses/{course.id}/olx-import/check", json=CHECK)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["summary"] == {"blocks": 2, "sequences": 3, "items": 12, "videos": 3, "pages": 3, "apps": 1,
                               "quizzes": 5, "files": 3, "bytes": 1062}
    assert body["label"] == UNFINISHED and body["blocking"] is False and body["blockers"] == []
    assert body["max_quiz_attempts"] == 2
    assert body["linked"] == ["fig-1.png", "notes.pdf", "sine-demo.js"]
    assert sorted((u["source"], u["target"], u["kind"]) for u in body["uploads"]) == [
        ("img/fig 1.png", "fig-1.png", "static"), ("notes.pdf", "notes.pdf", "static"), ("sine-demo.js", "sine-demo.js", "app")]
    assert all(set(line) == {"level", "where", "text"} for line in body["report"])
    assert [_count(db, m) for m in (Block, Item, Asset, AssetReference)] == before


def test_check_needs_course_admin(auth_client, client, db, test_user):
    course, _ = _admin_course(db, test_user, admin=False)
    assert auth_client.post(f"/api/courses/{course.id}/olx-import/check", json=CHECK).status_code == 403
    assert client.post(f"/api/courses/{course.id}/olx-import/check", json=CHECK).status_code == 401
    assert auth_client.post("/api/courses/999999/olx-import/check", json=CHECK).status_code == 404


def test_csrf_header_missing_403(auth_client, db, test_user):
    course, version = _admin_course(db, test_user)
    plain = TestClient(app)
    plain.cookies.set("session_token", _token(auth_client))
    assert plain.post(f"/api/courses/{course.id}/olx-import/check", json=CHECK).status_code == 403
    assert plain.post(f"/api/versions/{version.id}/olx-import/build", json=BUILD).status_code == 403


def test_build_and_status_need_course_admin(auth_client, client, db, test_user):
    _, version = _admin_course(db, test_user, admin=False)
    assert _build(auth_client, version.id).status_code == 403
    assert auth_client.get(f"/api/versions/{version.id}/olx-import/status").status_code == 403
    assert client.get(f"/api/versions/{version.id}/olx-import/status").status_code == 401
    assert _build(auth_client, 999999).status_code == 404


# --- the body cap, through the ASGI app (TestClient buffers the body)


def _asgi_post(path, chunks, headers, on_receive=None):
    """POST through the ASGI app; returns (status, body, receive() calls)."""
    calls = [0]
    sent = []
    it = iter(chunks)
    pending = [next(it, None)]

    async def receive():
        calls[0] += 1
        if on_receive:
            on_receive()
        chunk = pending[0]
        if chunk is None:
            return {"type": "http.disconnect"}
        pending[0] = next(it, None)
        return {"type": "http.request", "body": chunk, "more_body": pending[0] is not None}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "scheme": "http",
             "path": path, "raw_path": path.encode(), "query_string": b"", "root_path": "",
             "headers": [(k.lower().encode(), v.encode("latin-1")) for k, v in headers.items()],
             "client": ("127.0.0.1", 5000), "server": ("testserver", 80)}
    asyncio.run(app(scope, receive, send))
    status = next(m["status"] for m in sent if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return status, body, calls[0]


def _headers(auth_client, **extra):
    return {"cookie": f"session_token={_token(auth_client)}", "x-requested-with": "mathion",
            "content-type": "application/json", **extra}


def test_body_not_read_for_non_admin(auth_client, db, test_user):
    course, _ = _admin_course(db, test_user, admin=False)
    data = json.dumps(CHECK).encode()
    status, _, calls = _asgi_post(f"/api/courses/{course.id}/olx-import/check", [data],
                                  _headers(auth_client, **{"content-length": str(len(data))}))
    assert (status, calls) == (403, 0)


def test_no_connection_held_while_streaming(auth_client, db, test_user):
    course, _ = _admin_course(db, test_user)
    data = json.dumps(CHECK).encode()
    db.commit()
    baseline = engine.pool.checkedout()
    seen = []
    status, body, calls = _asgi_post(f"/api/courses/{course.id}/olx-import/check",
                                     [data[i:i + 4096] for i in range(0, len(data), 4096)],
                                     _headers(auth_client), on_receive=lambda: seen.append(engine.pool.checkedout()))
    assert status == 200, body[:300]
    assert calls > 1 and seen and all(n == baseline for n in seen)


def test_content_length_over_cap_413(auth_client, db, test_user):
    course, _ = _admin_course(db, test_user)
    status, _, calls = _asgi_post(f"/api/courses/{course.id}/olx-import/check", [b"{}"],
                                  _headers(auth_client, **{"content-length": str(olx_import.MAX_BODY + 1)}))
    assert (status, calls) == (413, 0)


def test_streamed_body_over_cap_413(auth_client, db, test_user):
    course, _ = _admin_course(db, test_user)
    mb = b" " * (1024 * 1024)
    status, _, calls = _asgi_post(f"/api/courses/{course.id}/olx-import/check", (mb for _ in range(60)),
                                  _headers(auth_client))
    assert status == 413
    assert olx_import.MAX_BODY // len(mb) <= calls <= olx_import.MAX_BODY // len(mb) + 2


def test_invalid_json_422(auth_client, db, test_user):
    course, version = _admin_course(db, test_user)
    r = auth_client.post(f"/api/courses/{course.id}/olx-import/check", content=b"{not json",
                         headers={"content-type": "application/json"})
    assert r.status_code == 422
    bad = {**CHECK, "static": [{"path": "a\ud800.png", "size": 5, "skipped": None}]}
    r = auth_client.post(f"/api/courses/{course.id}/olx-import/check",
                         content=json.dumps(bad).encode(), headers={"content-type": "application/json"})
    assert r.status_code == 422
    assert all("input" not in e for e in r.json()["detail"])


# --- build


def test_build_creates_content_and_final_label(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    r = _build(auth_client, version.id)
    assert r.status_code == 200, r.text
    assert r.json()["label"] == FINAL
    db.expire_all()
    assert db.get(CourseVersion, version.id).label == FINAL
    plan = convert(CheckBody.model_validate(CHECK), LIMITS)
    blocks = db.scalars(select(Block).where(Block.version_id == version.id).order_by(Block.order)).all()
    assert [(b.title, b.slug, b.order, b.info_html) for b in blocks] == [
        (p.title, p.slug, n, "") for n, p in enumerate(plan.blocks, 1)]
    for b, pb in zip(blocks, plan.blocks):
        seqs = db.scalars(select(Sequence).where(Sequence.block_id == b.id).order_by(Sequence.order)).all()
        assert [(s.title, s.slug) for s in seqs] == [(p.title, p.slug) for p in pb.sequences]
        for s, ps in zip(seqs, pb.sequences):
            items = db.scalars(select(Item).where(Item.sequence_id == s.id).order_by(Item.order)).all()
            assert [(i.title, i.slug, i.type, i.order) for i in items] == [
                (p.title, p.slug, p.type, n) for n, p in enumerate(ps.items, 1)]
    assert _count(db, Question) == sum(len(i.questions) for b in plan.blocks for s in b.sequences for i in s.items)


def test_build_items_equal_hand_made(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    assert _build(auth_client, version.id).status_code == 200
    db.expire_all()
    welcome = db.scalars(select(Item).join(Sequence).join(Block)
                         .where(Block.version_id == version.id, Item.title == "Welcome")).one()
    assert welcome.content_html == render_with_assets(db, version.id, welcome.content_md)
    refs = db.scalars(select(Asset.filename).join(AssetReference).where(AssetReference.item_id == welcome.id)).all()
    assert sorted(refs) == ["fig-1.png", "notes.pdf"]
    options = db.scalars(select(AnswerOption)).all()
    assert options and all(o.text_html for o in options)


def test_build_refuses_published_disabled_or_nonempty(auth_client, db, test_user):
    course, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    version.state = "published"
    db.commit()
    assert _build(auth_client, version.id).status_code == 409
    version.state, version.is_disabled = "created", True
    db.commit()
    assert _build(auth_client, version.id).status_code == 403
    version.is_disabled = False
    db.add(Block(version_id=version.id, title="Mine", slug="mine", order=1, info="", info_html=""))
    db.commit()
    assert _build(auth_client, version.id).status_code == 409
    assert _blocks(db, version.id) == 1


def test_build_twice_is_409_no_duplicates(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    assert _build(auth_client, version.id).status_code == 200
    items = _count(db, Item)
    assert _build(auth_client, version.id).status_code == 409
    assert (_blocks(db, version.id), _count(db, Item)) == (2, items)


def test_simultaneous_builds_one_wins(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    barrier = threading.Barrier(2)
    results = []

    def run():
        plan = convert(CheckBody.model_validate(CHECK), LIMITS)
        s = SessionLocal()
        try:
            barrier.wait()
            apply(plan, version.id, s, date(2026, 11, 18))
            s.commit()
            results.append("ok")
        except ApplyRefused as exc:
            s.rollback()
            results.append(exc.status)
        finally:
            s.close()
    threads = [threading.Thread(target=run) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    assert sorted(results, key=str) == [409, "ok"]
    assert _blocks(db, version.id) == 2


def test_render_error_after_partial_inserts_rolls_back(auth_client, db, test_user, monkeypatch):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    real = olx_import.convert

    def bad_plan(body, limits):
        plan = real(body, limits)
        last = [i for b in plan.blocks for s in b.sequences for i in s.items if i.type == "static_page"][-1]
        last.content_md += "\n\n![x](missing.png)"
        return plan
    monkeypatch.setattr(olx_import, "convert", bad_plan)
    r = _build(auth_client, version.id)
    assert r.status_code == 422 and "missing.png" in r.text
    assert (_blocks(db, version.id), _count(db, Item), _count(db, Sequence)) == (0, 0, 0)
    db.expire_all()
    assert db.get(CourseVersion, version.id).label == UNFINISHED


def test_script_files_unlinked_only_after_commit(auth_client, db, test_user, monkeypatch, tmp_path):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    folder = tmp_path / "scripts"
    folder.mkdir()
    script = folder / "sentinel.js"
    script.write_text("x")
    seen = []
    real_commit = db.commit
    monkeypatch.setattr(olx_import, "apply", lambda plan, vid, s, day: [str(script)])

    def commit():
        seen.append(script.exists())
        real_commit()
    monkeypatch.setattr(db, "commit", commit)
    assert _build(auth_client, version.id).status_code == 200
    assert seen == [False] and not script.exists()     # moved aside before, gone after
    assert list(folder.iterdir()) == []

    script.write_text("x")

    def failing_commit():
        raise RuntimeError("commit failed")
    monkeypatch.setattr(db, "commit", failing_commit)
    with pytest.raises(RuntimeError):
        _build(auth_client, version.id)
    assert script.read_text() == "x" and [p.name for p in folder.iterdir()] == ["sentinel.js"]


def test_apply_refused_maps_to_http(auth_client, db, test_user, monkeypatch):
    course, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    plan = convert(CheckBody.model_validate(CHECK), LIMITS)
    day = date(2026, 11, 18)
    version.is_disabled = True
    db.commit()
    with pytest.raises(ApplyRefused) as exc:
        apply(plan, version.id, db, day)
    assert exc.value.status == 403
    db.rollback()
    version.is_disabled, version.state = False, "published"
    db.commit()
    with pytest.raises(ApplyRefused) as exc:
        apply(plan, version.id, db, day)
    assert exc.value.status == 409
    db.rollback()
    with pytest.raises(ApplyRefused) as exc:
        apply(plan, 999999, db, day)
    assert exc.value.status == 404
    db.rollback()
    version.state = "created"
    db.commit()
    for status in (403, 404, 409):
        def refuse(plan, vid, s, day, status=status):
            raise ApplyRefused(status, "refused")
        monkeypatch.setattr(olx_import, "apply", refuse)
        r = _build(auth_client, version.id)
        assert (r.status_code, r.json()["detail"]) == (status, "refused")


def test_build_body_with_report_and_date_parses(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    assert _build(auth_client, version.id, {**BUILD, "extra": 1}).status_code == 422
    assert _build(auth_client, version.id, {**BUILD, "date": "not a date"}).status_code == 422
    body = {**BUILD, "report": [{"level": "note", "where": "", "text": "Read 3 files"}]}
    assert _build(auth_client, version.id, body).status_code == 200


def test_app_script_reference_persisted(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    assert _build(auth_client, version.id).status_code == 200
    db.expire_all()
    app_item = db.scalars(select(Item).where(Item.type == "interactive_app")).one()
    assert app_item.script_url == "sine-demo.js" and app_item.content_md is None
    refs = db.scalars(select(Asset.filename).join(AssetReference).where(AssetReference.item_id == app_item.id)).all()
    assert refs == ["sine-demo.js"]


def test_build_missing_linked_file_409_unlinked_reported(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id, skip={"notes.pdf"})
    r = _build(auth_client, version.id)
    assert r.status_code == 409 and "notes.pdf" in r.json()["detail"]
    assert _blocks(db, version.id) == 0
    _upload(auth_client, version.id, "notes.pdf", FILES["notes.pdf"].read_bytes())
    body = {**BUILD, "static": BUILD["static"] + [{"path": "extra.pdf", "size": 5, "skipped": None}]}
    r = _build(auth_client, version.id, body)
    assert r.status_code == 200, r.text
    assert any("extra.pdf" in line["text"] and "not in the draft" in line["text"] for line in r.json()["report"])


def test_build_rollback_on_error_leaves_no_rows(auth_client, db, test_user, monkeypatch):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)

    def boom(plan, vid, s, day):
        apply(plan, vid, s, day)
        raise RuntimeError("mid-way")
    monkeypatch.setattr(olx_import, "apply", boom)
    with pytest.raises(RuntimeError):
        _build(auth_client, version.id)
    assert (_blocks(db, version.id), _count(db, Item), _count(db, Question)) == (0, 0, 0)


def test_build_merges_browser_report_lines(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    check = auth_client.post(f"/api/courses/{version.course_id}/olx-import/check", json=CHECK).json()
    server_line = check["report"][-1]
    mine = {"level": "skipped", "where": "", "text": "The file “x.exe” was not read"}
    body = {**BUILD, "report": [server_line, mine, mine]}
    report = _build(auth_client, version.id, body).json()["report"]
    keys = [(r["level"], r["where"], r["text"]) for r in report]
    assert len(keys) == len(set(keys))
    assert ("skipped", "", mine["text"]) in keys
    ranks = [{"skipped": 0, "changed": 1, "note": 2}[k[0]] for k in keys]
    assert ranks == sorted(ranks)


# --- status


def test_status_running_built_empty(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    status = lambda: auth_client.get(f"/api/versions/{version.id}/olx-import/status").json()["state"]  # noqa: E731
    assert status() == "empty"
    holder = SessionLocal()
    try:
        holder.execute(select(CourseVersion).where(CourseVersion.id == version.id).with_for_update())
        assert status() == "running"
    finally:
        holder.rollback()
        holder.close()
    _upload_all(auth_client, version.id)
    assert _build(auth_client, version.id).status_code == 200
    assert status() == "built"


def test_status_other_db_error_is_not_running(auth_client, db, test_user, monkeypatch):
    _, version = _admin_course(db, test_user)

    class Orig(Exception):
        sqlstate = "57014"

    def fail(db, vid):
        raise OperationalError("SELECT", {}, Orig())
    monkeypatch.setattr(olx_import, "_lock_nowait", fail)
    with pytest.raises(OperationalError):
        auth_client.get(f"/api/versions/{version.id}/olx-import/status")


# --- discard


def test_discard_deletes_unfinished_empty_draft(auth_client, db, test_user, asset_tmpdir):
    _, version = _admin_course(db, test_user)
    _upload(auth_client, version.id, "fig-1.png", FILES["fig-1.png"].read_bytes())
    folder = asset_tmpdir / "courses" / str(version.id)
    assert folder.is_dir()
    assert auth_client.post(f"/api/versions/{version.id}/olx-import/discard").status_code == 204
    db.expire_all()
    assert db.get(CourseVersion, version.id) is None and not folder.exists()


def test_discard_refuses_built_or_relabelled(auth_client, db, test_user):
    course, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    assert _build(auth_client, version.id).status_code == 200
    r = auth_client.post(f"/api/versions/{version.id}/olx-import/discard")
    assert (r.status_code, r.json()["detail"]) == (409, "This import finished; the draft was kept.")
    relabelled = _new_version(db, course, label="My own draft")
    published = _new_version(db, course)
    published.state = "published"
    db.commit()
    for v in (relabelled, published):
        assert auth_client.post(f"/api/versions/{v.id}/olx-import/discard").status_code == 409
    db.expire_all()
    assert all(db.get(CourseVersion, v.id) for v in (version, relabelled, published))


def test_discard_needs_course_admin(auth_client, db, test_user):
    _, version = _admin_course(db, test_user, admin=False)
    assert auth_client.post(f"/api/versions/{version.id}/olx-import/discard").status_code == 403
    db.expire_all()
    assert db.get(CourseVersion, version.id) is not None


def test_discard_waits_for_build_and_keeps_it(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    holder = SessionLocal()
    result = []
    try:
        holder.execute(select(CourseVersion).where(CourseVersion.id == version.id).with_for_update())
        holder.add(Block(version_id=version.id, title="B", slug="b", order=1, info="", info_html=""))
        holder.flush()
        t = threading.Thread(target=lambda: result.append(
            auth_client.post(f"/api/versions/{version.id}/olx-import/discard").status_code))
        t.start()
        time.sleep(0.5)
        assert t.is_alive() and result == []
        holder.commit()
        t.join(30)
    finally:
        holder.close()
    assert result == [409]
    db.expire_all()
    assert db.get(CourseVersion, version.id) is not None


def test_build_after_discard_is_404(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    assert auth_client.get(f"/api/versions/{version.id}/olx-import/status").json()["state"] == "empty"
    assert auth_client.post(f"/api/versions/{version.id}/olx-import/discard").status_code == 204
    assert _build(auth_client, version.id).status_code == 404
    assert _count(db, Block) == 0


def _race(real_client, db, test_user, monkeypatch):
    """A real build parked after authorisation, before its FOR UPDATE."""
    _, version = _admin_course(db, test_user)
    _upload_all(real_client, version.id)
    reached, release = threading.Event(), threading.Event()

    def park():
        reached.set()
        release.wait(30)
    monkeypatch.setattr(apply_mod, "_before_lock", park)
    result = []
    t = threading.Thread(target=lambda: result.append(_build(real_client, version.id)))
    t.start()
    assert reached.wait(30)
    return version, release, t, result


def test_prelock_race_discard_first(real_client, db, test_user, monkeypatch):
    version, release, t, result = _race(real_client, db, test_user, monkeypatch)
    assert real_client.get(f"/api/versions/{version.id}/olx-import/status").json()["state"] == "empty"
    assert real_client.post(f"/api/versions/{version.id}/olx-import/discard").status_code == 204
    release.set()
    t.join(60)
    assert result[0].status_code == 404
    assert _count(db, Block) == 0 and _count(db, Item) == 0


def test_prelock_race_build_first(real_client, db, test_user, monkeypatch):
    version, release, t, result = _race(real_client, db, test_user, monkeypatch)
    release.set()
    t.join(60)
    assert result[0].status_code == 200, result[0].text
    assert real_client.post(f"/api/versions/{version.id}/olx-import/discard").status_code == 409
    assert _blocks(db, version.id) == 2


# --- Review Focus 4 and 5


def _synthetic_bundle():
    quiz = ("<problem display_name='Quiz'><p>What is \\(2+2\\)?</p><numericalresponse answer='4'><textline/>"
            "</numericalresponse><p>Pick.</p><multiplechoiceresponse><choicegroup><choice correct='true'>a</choice>"
            "<choice correct='false'>b</choice></choicegroup></multiplechoiceresponse></problem>")
    page = "<html display_name='Text'><h2>Title</h2><p>Text with \\(x^2\\).</p>" + "<p>More text.</p>" * 20 + "</html>"
    video = "<video display_name='V' youtube_id_1_0='AbCdEfGhIjK'/>"
    kinds = [page, quiz, video]
    body = "".join(f"<chapter display_name='Ch {c}'>" + "".join(
        f"<sequential display_name='S {s}'>" + "".join(
            f"<vertical display_name='U {u}'>{kinds[u % 3]}</vertical>" for u in range(30))
        + "</sequential>" for s in range(8)) + "</chapter>" for c in range(8))
    files = {"course.xml": '<course url_name="r" org="o" course="c"/>',
             "course/r.xml": f"<course display_name='Big' max_attempts='3'>{body}</course>"}
    return {"files": files, "static": [], "apps": [], "report": [], "date": "2026-11-18"}


def test_large_synthetic_course_is_fast(auth_client, db, test_user, capsys):
    _, version = _admin_course(db, test_user)
    start = time.perf_counter()
    r = _build(auth_client, version.id, _synthetic_bundle())
    elapsed = time.perf_counter() - start
    assert r.status_code == 200, r.text[:500]
    assert _count(db, Item) == 8 * 8 * 30
    with capsys.disabled():
        print(f"\n[olx] 8x8x30 build: {elapsed:.2f} s")
    assert elapsed < 10


def test_import_twice_into_one_course(auth_client, db, test_user, asset_tmpdir):
    course, first = _admin_course(db, test_user)
    second = _new_version(db, course)
    for v in (first, second):
        _upload_all(auth_client, v.id)
        assert _build(auth_client, v.id).status_code == 200
    assert _blocks(db, first.id) == _blocks(db, second.id) == 2
    assert auth_client.delete(f"/api/versions/{first.id}").status_code == 204
    db.expire_all()
    assert db.get(CourseVersion, first.id) is None
    assert _blocks(db, second.id) == 2 and _count(db, Asset, version_id=second.id) == 3
    assert sorted(os.listdir(asset_tmpdir / "courses" / str(second.id))) == ["fig-1.png", "notes.pdf", "sine-demo.js"]
    second_items = db.scalars(select(Item).join(Sequence).join(Block).where(Block.version_id == second.id)).all()
    assert len(second_items) == 12


def test_build_does_not_repeat_a_file_the_browser_reported(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    told = {"level": "skipped", "where": "", "text": "The file “extra.pdf” was refused by the server: too big"}
    body = {**BUILD, "static": BUILD["static"] + [{"path": "extra.pdf", "size": 5, "skipped": None},
                                                  {"path": "other.pdf", "size": 5, "skipped": None}],
            "report": [told]}
    texts = [line["text"] for line in _build(auth_client, version.id, body).json()["report"]]
    assert [t for t in texts if "extra.pdf" in t] == [told["text"]]
    assert any("“other.pdf” was not uploaded" in t for t in texts)
    assert not any("was uploaded as" in t and ("extra.pdf" in t or "other.pdf" in t) for t in texts)


def test_bad_content_length_400(auth_client, db, test_user):
    course, _ = _admin_course(db, test_user)
    status, _, calls = _asgi_post(f"/api/courses/{course.id}/olx-import/check", [b"{}"],
                                  _headers(auth_client, **{"content-length": "12x"}))
    assert (status, calls) == (400, 0)


def test_build_with_blockers_409_lists_them(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    files = {"course.xml": '<course url_name="r" org="o" course="c"/>',
             "course/r.xml": "<course display_name='C'><chapter display_name='Ch'><sequential display_name='S'>"
                             "<vertical display_name='U'><discussion/></vertical></sequential></chapter></course>"}
    r = _build(auth_client, version.id, {"files": files, "static": [], "apps": [], "report": [], "date": "2026-11-18"})
    assert r.status_code == 409
    body = r.json()
    assert body["blockers"] and body["detail"].startswith("The import is blocked: ")
    assert _blocks(db, version.id) == 0


def test_disabled_build_refused_before_reading_body(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    version.is_disabled = True
    db.commit()
    data = json.dumps(BUILD).encode()
    status, _, calls = _asgi_post(f"/api/versions/{version.id}/olx-import/build", [data],
                                  _headers(auth_client, **{"content-length": str(len(data))}))
    assert (status, calls) == (403, 0)


# --- review round 1


def test_422_is_small_and_never_echoes(auth_client, db, test_user):
    course, _ = _admin_course(db, test_user)
    url = f"/api/courses/{course.id}/olx-import/check"
    r = auth_client.post(url, json={"files": {"K" * 1_000_000: 1}, "static": [], "apps": []})
    assert r.status_code == 422 and len(r.content) < 5000
    r = auth_client.post(url, json={"files": {}, "static": [1] * 50_000, "apps": []})
    assert r.status_code == 422 and len(r.json()["detail"]) <= olx_import.MAX_ERRORS and len(r.content) < 20_000
    r = auth_client.post(url, json={**CHECK, "static": [{"path": "/x", "size": 5, "skipped": None}]})
    assert r.status_code == 422
    for e in r.json()["detail"]:
        assert e["loc"][0] == "body" and not {"input", "ctx", "url"} & set(e)


def test_422_messages_never_echo_the_path(auth_client, db, test_user):
    course, _ = _admin_course(db, test_user)
    url = f"/api/courses/{course.id}/olx-import/check"
    r = auth_client.post(url, json={**CHECK, "static": [{"path": "zz-echo/../x", "size": 5, "skipped": None}]})
    assert r.status_code == 422 and "zz-echo" not in r.text
    r = auth_client.post(url, json={**CHECK, "files": {**CHECK["files"], "zz-echo.xml": "a\x00b"}})
    assert r.status_code == 422 and "zz-echo" not in r.text


def test_build_refuses_a_linked_file_of_another_size(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id, skip={"notes.pdf"})
    _upload(auth_client, version.id, "notes.pdf", b"%PDF-1.4 another file")
    r = _build(auth_client, version.id)
    assert r.status_code == 409 and "notes.pdf" in r.json()["detail"]
    assert _blocks(db, version.id) == 0


def test_build_reports_an_unlinked_file_of_another_size(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    _upload(auth_client, version.id, "kept.pdf", b"%PDF-1.4 kept")
    body = {**BUILD, "static": BUILD["static"] + [{"path": "kept.pdf", "size": 99, "skipped": None}]}
    report = _build(auth_client, version.id, body).json()["report"]
    assert any("kept.pdf" in ln["text"] and "another file under its name" in ln["text"] for ln in report)


def _editor_twin(c, db, v1, v2):
    """Rebuild v1's imported content in v2 through the editor routes; return the differences."""
    diffs, bmap, smap = [], {}, {}
    strip = lambda html, v: (html or "").replace(f"/assets/{v}/", "/A/") if html is not None else None  # noqa: E731

    def refs(**kw):
        q = select(Asset.filename).join(AssetReference)
        for k, val in kw.items():
            q = q.where(getattr(AssetReference, k) == val)
        return sorted(db.scalars(q))
    rows = db.execute(select(Block, Sequence, Item).join(Sequence, Sequence.block_id == Block.id)
                      .join(Item, Item.sequence_id == Sequence.id).where(Block.version_id == v1)
                      .order_by(Block.order, Sequence.order, Item.order)).all()
    for b, s, i in rows:
        if b.id not in bmap:
            bmap[b.id] = c.post(f"/api/versions/{v2}/blocks", json={"title": b.title}).json()["id"]
            nb = db.get(Block, bmap[b.id])
            if (nb.info, nb.info_html, nb.order, nb.slug) != (b.info, b.info_html, b.order, b.slug):
                diffs.append(("block", b.title))
        if s.id not in smap:
            j = c.post(f"/api/blocks/{bmap[b.id]}/sequences", json={"title": s.title}).json()
            smap[s.id] = j["id"]
            if (j["order"], j["slug"]) != (s.order, s.slug):
                diffs.append(("sequence", s.title))
        body = {"title": i.title, "type": i.type}
        if i.content_md is not None:
            body["content_md"] = i.content_md
        if i.video_url is not None:
            body["video_url"] = i.video_url
        nid = c.post(f"/api/sequences/{smap[s.id]}/items", json=body).json()["id"]
        if i.script_url:
            assert c.patch(f"/api/items/{nid}", json={"script_url": i.script_url}).status_code == 200
        db.expire_all()
        n = db.get(Item, nid)
        row = lambda x, v: (x.type, x.title, x.slug, x.order, x.content_md, strip(x.content_html, v),  # noqa: E731
                            x.video_url, x.script_url, refs(item_id=x.id))
        if row(i, v1) != row(n, v2):
            diffs.append(("item", i.title))
        for q in db.scalars(select(Question).where(Question.item_id == i.id).order_by(Question.order)).all():
            qb = {"text_md": q.text_md, "type": q.type, "explanation_md": q.explanation_md, "precision": q.precision,
                  "correct_text": q.correct_text, "correct_numeric": None if q.correct_numeric is None else str(q.correct_numeric)}
            r = c.post(f"/api/items/{nid}/questions", json=qb)
            assert r.status_code == 201, r.text
            db.expire_all()
            nq = db.get(Question, r.json()["id"])
            qrow = lambda x, v: (x.type, x.order, x.text_md, strip(x.text_html, v), x.explanation_md,  # noqa: E731
                                 strip(x.explanation_html, v), x.correct_numeric, x.precision, x.correct_text,
                                 refs(question_id=x.id))
            if qrow(q, v1) != qrow(nq, v2):
                diffs.append(("question", i.title, q.order))
            for o in db.scalars(select(AnswerOption).where(AnswerOption.question_id == q.id).order_by(AnswerOption.order)):
                j = c.post(f"/api/questions/{nq.id}/options", json={"text": o.text, "is_correct": o.is_correct}).json()
                if (j["text"], j["text_html"], j["is_correct"], j["order"]) != (o.text, o.text_html, o.is_correct, o.order):
                    diffs.append(("option", i.title, q.order, o.order))
    return diffs, len(rows)


def test_build_equals_editor_made_twin(auth_client, db, test_user):
    course, v1 = _admin_course(db, test_user)
    _upload_all(auth_client, v1.id)
    db.expire_all()
    before = db.get(CourseVersion, v1.id).content_updated_at
    assert _build(auth_client, v1.id).status_code == 200
    v2 = _new_version(db, course, "hand")
    _upload_all(auth_client, v2.id)
    db.expire_all()
    assert db.get(CourseVersion, v1.id).content_updated_at > before
    diffs, n = _editor_twin(auth_client, db, v1.id, v2.id)
    plan = convert(CheckBody.model_validate(CHECK), LIMITS)
    questions = [q for b in plan.blocks for s in b.sequences for i in s.items for q in i.questions]
    assert n == 12 and diffs == []
    assert _count(db, Question) == 2 * len(questions) == 20
    assert _count(db, AnswerOption) == 2 * sum(len(q.options) for q in questions)


def test_check_blocked_returns_blockers(auth_client, db, test_user):
    course, _ = _admin_course(db, test_user)
    body = {**CHECK, "apps": [{"name": "sine-demo.js", "size": 0}]}
    r = auth_client.post(f"/api/courses/{course.id}/olx-import/check", json=body).json()
    assert r["blocking"] is True and [b["text"] for b in r["blockers"]] == [
        "The app file “sine-demo.js” is empty; pick the right file again"]


def test_build_holds_no_connection_while_streaming_or_converting(auth_client, db, test_user, monkeypatch):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    db.commit()
    baseline = engine.pool.checkedout()
    real, during = olx_import.convert, []

    def spy(body, limits):
        during.append(engine.pool.checkedout())
        return real(body, limits)
    monkeypatch.setattr(olx_import, "convert", spy)
    data = json.dumps(BUILD).encode()
    seen = []
    status, body, _ = _asgi_post(f"/api/versions/{version.id}/olx-import/build",
                                 [data[i:i + 4096] for i in range(0, len(data), 4096)],
                                 _headers(auth_client), on_receive=lambda: seen.append(engine.pool.checkedout()))
    assert status == 200, body[:300]
    assert seen and all(n == baseline for n in seen) and during == [baseline]


def test_check_holds_no_connection_while_converting(auth_client, db, test_user, monkeypatch):
    course, _ = _admin_course(db, test_user)
    db.commit()
    baseline = engine.pool.checkedout()
    real, during = olx_import.convert, []

    def spy(body, limits):
        during.append(engine.pool.checkedout())
        return real(body, limits)
    monkeypatch.setattr(olx_import, "convert", spy)
    data = json.dumps(CHECK).encode()
    status, body, _ = _asgi_post(f"/api/courses/{course.id}/olx-import/check", [data], _headers(auth_client))
    assert status == 200 and during == [baseline]


def test_body_of_exactly_the_cap_is_read(auth_client, db, test_user):
    course, _ = _admin_course(db, test_user)
    url = f"/api/courses/{course.id}/olx-import/check"
    mb = 1024 * 1024
    chunks = [b" " * mb] * 45
    status, _, _ = _asgi_post(url, chunks, _headers(auth_client, **{"content-length": str(olx_import.MAX_BODY)}))
    assert status == 422                                   # read whole, then refused as JSON
    status, _, _ = _asgi_post(url, chunks + [b" "], _headers(auth_client))
    assert status == 413
    assert olx_import.MAX_BODY == 45 * mb


def test_build_missing_app_file_409(auth_client, db, test_user):
    course, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id, skip={"sine-demo.js"})
    other = _new_version(db, course)
    _upload(auth_client, other.id, "sine-demo.js", FILES["sine-demo.js"].read_bytes())
    r = _build(auth_client, version.id)
    assert r.status_code == 409 and "sine-demo.js" in r.json()["detail"]
    assert _blocks(db, version.id) == 0


def test_build_reports_only_missing_uploads(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    _upload(auth_client, version.id, "kept.pdf", b"%PDF-1.4 kept")
    body = {**BUILD, "static": BUILD["static"] + [{"path": "kept.pdf", "size": 13, "skipped": None},
                                                  {"path": "gone.pdf", "size": 5, "skipped": None}]}
    report = _build(auth_client, version.id, body).json()["report"]
    gone = [ln for ln in report if "gone.pdf" in ln["text"]]
    assert [ln["level"] for ln in gone] == ["skipped"] and "not uploaded" in gone[0]["text"]
    assert not any("not uploaded" in ln["text"] for ln in report if "gone.pdf" not in ln["text"])
    assert any("“kept.pdf” was uploaded as" in ln["text"] for ln in report)


def test_merge_matches_cleaned_names_and_keeps_browser_lines(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    told = {"level": "skipped", "where": "", "text": "The server refused “a  b.pdf”: too big"}
    odd = {"level": "note", "where": "", "text": "Odd: “c.pdf” was uploaded as “c.pdf” elsewhere"}
    body = {**BUILD, "static": BUILD["static"] + [{"path": "a  b.pdf", "size": 5, "skipped": None},
                                                  {"path": "c.pdf", "size": 5, "skipped": None}],
            "report": [told, odd]}
    texts = [ln["text"] for ln in _build(auth_client, version.id, body).json()["report"]]
    assert [t for t in texts if "a b.pdf" in t or "a  b.pdf" in t] == ["The server refused “a b.pdf”: too big"]
    assert odd["text"] in texts


def test_discard_disabled_403(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    version.is_disabled = True
    db.commit()
    assert auth_client.post(f"/api/versions/{version.id}/olx-import/discard").status_code == 403
    db.expire_all()
    assert db.get(CourseVersion, version.id) is not None


def test_discard_sees_a_label_changed_while_it_waited(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    holder = SessionLocal()
    result = []
    try:
        locked = holder.execute(select(CourseVersion).where(CourseVersion.id == version.id).with_for_update()).scalar_one()
        locked.label = FINAL
        holder.flush()
        t = threading.Thread(target=lambda: result.append(
            auth_client.post(f"/api/versions/{version.id}/olx-import/discard").status_code))
        t.start()
        time.sleep(0.5)
        holder.commit()
        t.join(30)
    finally:
        holder.close()
    assert result == [409]
    db.expire_all()
    assert db.get(CourseVersion, version.id) is not None


def test_status_ignores_an_open_upload(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    other = SessionLocal()
    try:
        other.add(Asset(version_id=version.id, filename="up.png", file_size=3, mime_type="image/png",
                        uploaded_by=test_user.id))
        other.flush()
        assert auth_client.get(f"/api/versions/{version.id}/olx-import/status").json()["state"] == "empty"
    finally:
        other.rollback()
        other.close()


def test_non_ascii_content_length_400(auth_client, db, test_user):
    course, _ = _admin_course(db, test_user)
    status, _, calls = _asgi_post(f"/api/courses/{course.id}/olx-import/check", [b"{}"],
                                  _headers(auth_client, **{"content-length": "²"}))
    assert (status, calls) == (400, 0)


def test_client_gone_mid_body_is_quiet(auth_client, db, test_user):
    course, _ = _admin_course(db, test_user)
    path = f"/api/courses/{course.id}/olx-import/check"
    messages = iter([{"type": "http.request", "body": b'{"files"', "more_body": True}, {"type": "http.disconnect"}])
    sent = []

    async def receive():
        return next(messages, {"type": "http.disconnect"})

    async def send(message):
        sent.append(message)
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "scheme": "http",
             "path": path, "raw_path": path.encode(), "query_string": b"", "root_path": "",
             "headers": [(k.encode(), v.encode()) for k, v in _headers(auth_client).items()],
             "client": ("127.0.0.1", 5000), "server": ("testserver", 80)}
    asyncio.run(app(scope, receive, send))
    assert next(m["status"] for m in sent if m["type"] == "http.response.start") == 400


def test_questions_and_options_match_the_plan(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    assert _build(auth_client, version.id).status_code == 200
    db.expire_all()
    plan = convert(CheckBody.model_validate(CHECK), LIMITS)
    want = [(q.type, n, q.text_md, q.explanation_md, q.correct_numeric, q.precision, q.correct_text,
             [(o.text, o.is_correct, m) for m, o in enumerate(q.options, 1)])
            for b in plan.blocks for s in b.sequences for i in s.items for n, q in enumerate(i.questions, 1)]
    got = []
    for q in db.scalars(select(Question).join(Item).join(Sequence).join(Block)
                        .order_by(Block.order, Sequence.order, Item.order, Question.order)):
        opts = db.scalars(select(AnswerOption).where(AnswerOption.question_id == q.id).order_by(AnswerOption.order))
        got.append((q.type, q.order, q.text_md, q.explanation_md, q.correct_numeric, q.precision, q.correct_text,
                    [(o.text, o.is_correct, o.order) for o in opts]))
    assert got == want
    assert any(w[4] is not None for w in want) and any(w[5] is not None for w in want)
    assert any(w[6] is not None for w in want) and any(o[1] for w in want for o in w[7])


def test_question_asset_references_cover_text_and_explanation(auth_client, db, test_user, monkeypatch):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    real = olx_import.convert

    def with_links(body, limits):
        plan = real(body, limits)
        q = [q for b in plan.blocks for s in b.sequences for i in s.items for q in i.questions][0]
        q.text_md += "\n\n![a](fig-1.png)"
        q.explanation_md = (q.explanation_md or "") + "\n\n[notes](notes.pdf)"
        return plan
    monkeypatch.setattr(olx_import, "convert", with_links)
    assert _build(auth_client, version.id).status_code == 200
    db.expire_all()
    first = db.scalars(select(Question).join(Item).join(Sequence).join(Block)
                       .order_by(Block.order, Sequence.order, Item.order, Question.order)).first()
    refs = db.scalars(select(Asset.filename).join(AssetReference).where(AssetReference.question_id == first.id)).all()
    assert sorted(refs) == ["fig-1.png", "notes.pdf"]
    assert "fig-1.png" in first.text_html and "notes.pdf" in first.explanation_html


def test_apply_reads_the_locked_row_fresh(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    plan = convert(CheckBody.model_validate(CHECK), LIMITS)
    mine = SessionLocal()
    try:
        stale = mine.get(CourseVersion, version.id)       # held, so the session keeps the old row
        assert stale.state == "created"
        other = SessionLocal()
        other.get(CourseVersion, version.id).state = "published"
        other.commit()
        other.close()
        with pytest.raises(ApplyRefused) as exc:
            apply(plan, version.id, mine, date(2026, 11, 18))
        assert exc.value.status == 409
    finally:
        mine.rollback()
        mine.close()


# --- review round 2


def test_long_lists_stop_at_the_cap():
    from pydantic import ValidationError
    for key in ("static", "apps"):
        raw = json.dumps({"files": {}, "static": [], "apps": [], key: [1] * 100_000}).encode()
        with pytest.raises(ValidationError) as exc:
            CheckBody.model_validate_json(raw)
        assert exc.value.error_count() == 1 and exc.value.errors()[0]["type"] == "too_long"


def test_many_errors_are_not_expanded(monkeypatch):
    from fastapi import HTTPException
    from pydantic import ValidationError
    raw = json.dumps({"files": {f"k{i}": 1 for i in range(5000)}, "static": [], "apps": []}).encode()
    called = []
    real = ValidationError.errors
    monkeypatch.setattr(ValidationError, "errors", lambda self, **kw: called.append(1) or real(self, **kw))
    with pytest.raises(HTTPException) as exc:
        olx_import._parse(CheckBody, raw)
    assert exc.value.status_code == 422 and called == []
    assert exc.value.detail == [{"type": "too_many_errors", "loc": ["body"], "msg": "5000 problems in the request body"}]


def test_discard_needs_the_exact_prefix(auth_client, db, test_user):
    course, _ = _admin_course(db, test_user)
    odd = _new_version(db, course, label="Open edX (unfinished):x")
    assert auth_client.post(f"/api/versions/{odd.id}/olx-import/discard").status_code == 409


def test_error_list_edge_is_twenty(auth_client, db, test_user):
    course, _ = _admin_course(db, test_user)
    url = f"/api/courses/{course.id}/olx-import/check"
    for n, many in ((20, False), (21, True)):
        detail = auth_client.post(url, json={"files": {}, "apps": [], "static": [1] * n}).json()["detail"]
        assert (detail[0]["type"] == "too_many_errors") is many and len(detail) == (1 if many else n)


def test_list_cap_edge_is_twenty_thousand():
    from pydantic import ValidationError
    entries = {"static": {"path": "a.png", "size": 1, "skipped": None}, "apps": {"name": "a.js", "size": 1}}
    for key, entry in entries.items():
        for n, ok in ((20_000, True), (20_001, False)):
            raw = json.dumps({"files": {}, "static": [], "apps": [], key: [entry] * n}).encode()
            try:
                CheckBody.model_validate_json(raw)
                assert ok, (key, n)
            except ValidationError:
                assert not ok, (key, n)


# --- Codex round 1


def _rl(level, text):
    from mathion.olx.report import ReportLine
    return ReportLine(level, "", text)


def test_merge_is_fast_on_a_large_report():
    missing = {f"f{i}.pdf" for i in range(4000)}
    server = [_rl("skipped", f"The file “f{i}.pdf” was not uploaded, so it is not in the draft") for i in range(4000)]
    server += [_rl("note", f"The file “f{i}.pdf” was uploaded as “f{i}.pdf” but is not linked from any page")
               for i in range(4000)]
    browser = [_rl("skipped", f"The server refused “b{i}.pdf”: " + "x" * 1900) for i in range(20000)]
    start = time.perf_counter()
    out = olx_import._merged(server, browser, missing)
    assert time.perf_counter() - start < 1
    assert len(out) == 4000 and all(ln.text.endswith("not in the draft") for ln in out)


def test_merge_drops_an_upload_claim_whose_line_was_capped():
    claim = _rl("note", "The file “x.pdf” was uploaded as “x.pdf” but is not linked from any page")
    kept = _rl("note", "The file “y.pdf” was uploaded as “y.pdf” but is not linked from any page")
    assert olx_import._merged([claim, kept], [], {"x.pdf"}) == [kept]
    spaced = _rl("note", "The file “a b.pdf” was uploaded as “a-b.pdf” but is not linked from any page")
    assert olx_import._merged([spaced], [], {"a  b.pdf"}) == []


def test_apply_records_uploads_missing_from_the_draft(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    body = {**CHECK, "static": CHECK["static"] + [{"path": "x/extra.pdf", "size": 5, "skipped": None}]}
    plan = convert(CheckBody.model_validate(body), LIMITS)
    apply(plan, version.id, db, date(2026, 11, 18))
    db.rollback()
    assert plan.not_uploaded == {"x/extra.pdf"}


def test_status_404_when_discarded_before_its_lock(auth_client, db, test_user, monkeypatch):
    _, version = _admin_course(db, test_user)
    real = olx_import._course_admin_version

    def then_gone(s, user, vid):
        real(s, user, vid)
        other = SessionLocal()
        other.delete(other.get(CourseVersion, vid))
        other.commit()
        other.close()
    monkeypatch.setattr(olx_import, "_course_admin_version", then_gone)
    assert auth_client.get(f"/api/versions/{version.id}/olx-import/status").status_code == 404


# --- review round 4


def test_merge_is_fast_on_unclosed_quotes():
    browser = [_rl("skipped", "“" * 2000) for _ in range(3000)]
    start = time.perf_counter()
    olx_import._merged([], browser, set())
    assert time.perf_counter() - start < 1


def test_merge_sees_every_quoted_name_in_a_browser_line():
    line = _rl("skipped", "The file “extra.pdf” was not uploaded, so it is not in the draft")
    told = [_rl("skipped", "The files “a.pdf” and “extra.pdf” were refused")]
    assert olx_import._merged([line], told, set()) == []


# --- Codex round 2


def test_bad_path_id_reads_no_body(auth_client):
    data = json.dumps(CHECK).encode()
    for path in ("/api/courses/abc/olx-import/check", "/api/versions/abc/olx-import/build"):
        status, _, calls = _asgi_post(path, [data], _headers(auth_client, **{"content-length": str(len(data))}))
        assert (status, calls) == (422, 0), path


def test_merge_keeps_names_with_an_inner_open_quote_apart():
    a = _rl("skipped", "The file “a“b.pdf” was not uploaded, so it is not in the draft")
    b = _rl("skipped", "The file “b.pdf” was not uploaded, so it is not in the draft")
    told = [_rl("skipped", "Upload refused for “b.pdf”")]
    assert olx_import._merged([a, b], told, set()) == [a]
    assert olx_import._merged([a, b], [_rl("skipped", "Upload refused for “a“b.pdf”")], set()) == [b]
    claim = _rl("note", "The file “b.pdf” was uploaded as “b.pdf” but is not linked from any page")
    assert olx_import._merged([claim], [], {"a“b.pdf"}) == [claim]


def test_merge_ignores_a_closing_quote_before_the_first_opening_one():
    line = _rl("skipped", "The file “extra.pdf” was not uploaded, so it is not in the draft")
    assert olx_import._merged([line], [_rl("skipped", "5” wide: “extra.pdf” was refused")], set()) == []


def test_build_and_discard_take_the_version_lock_first(auth_client, db, test_user, monkeypatch):
    from mathion.api import advisory
    from tests.conftest import record_lock_calls
    _, version = _admin_course(db, test_user)
    _upload_all(auth_client, version.id)
    from tests.test_concurrency_draft_lock import _statements
    events = record_lock_calls(monkeypatch)
    with _statements() as seen:
        assert _build(auth_client, version.id).status_code == 200
    assert events[0] == ("lock", advisory.LOCK_NS_VERSION_INFO, (version.id,))
    assert _advisory_before_row_locks(seen)
    _, draft = _admin_course(db, test_user, slug="olx-discard")
    events.clear()
    with _statements() as seen:
        assert auth_client.post(f"/api/versions/{draft.id}/olx-import/discard").status_code == 204
    assert events[0] == ("lock", advisory.LOCK_NS_VERSION_INFO, (draft.id,))
    assert _advisory_before_row_locks(seen)


def _advisory_before_row_locks(seen) -> bool:
    lock = next(i for i, st in enumerate(seen) if "pg_advisory_xact_lock" in st)
    row = next(i for i, st in enumerate(seen) if "FROM course_versions" in st and "FOR UPDATE" in st)
    return lock < row
