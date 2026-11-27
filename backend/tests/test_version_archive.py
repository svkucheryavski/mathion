import io
import json
import os
import tarfile

import pytest
from sqlalchemy import text

from mathion.api import version_archive
from mathion.archive import export
from mathion.archive.export import ArchiveFile, _Sink, stream_archive
from mathion.models import Asset, CourseVersion
from tests.test_version_clone import _build_full_source

UPLOADED = {name: name.encode() * 4 for name in ("logo.png", "sp.png", "vid.png", "quiz.png", "tq.png", "exp.png")}
UPLOADED["app.js"] = b"console.log(1)"


def _tar(body: bytes) -> tarfile.TarFile:
    return tarfile.open(fileobj=io.BytesIO(body), mode="r:gz")


def test_download_contains_document_and_every_file(admin_client, db):
    _, v, _ = _build_full_source(admin_client, db)
    r = admin_client.get(f"/api/versions/{v['id']}/archive")
    assert r.status_code == 200, r.text
    tar = _tar(r.content)
    members = tar.getmembers()
    assert members[0].name == "mathion-course.json"
    assert {m.name for m in members} == {"mathion-course.json"} | {f"assets/{n}" for n in UPLOADED}
    for name, data in UPLOADED.items():
        assert tar.extractfile(f"assets/{name}").read() == data
    doc = json.loads(tar.extractfile("mathion-course.json").read())
    assert doc["version"]["label"] == "L"
    assert all(m.uid == 0 and m.gid == 0 and m.uname == "" and m.gname == "" for m in members)
    assert all(m.mode == 0o644 for m in members)
    logo = db.query(Asset).filter(Asset.version_id == v["id"], Asset.filename == "logo.png").one()
    assert tar.getmember("assets/logo.png").mtime == int(logo.uploaded_at.timestamp())


def test_download_headers(admin_client, db):
    _, v, _ = _build_full_source(admin_client, db)
    r = admin_client.get(f"/api/versions/{v['id']}/archive")
    assert r.headers["content-type"].startswith("application/gzip")
    assert r.headers["content-disposition"] == f'attachment; filename="full-v{v["id"]}.tar.gz"'


def test_check_returns_filename(admin_client, db):
    _, v, _ = _build_full_source(admin_client, db)
    r = admin_client.get(f"/api/versions/{v['id']}/archive/check")
    assert r.status_code == 200
    assert r.json() == {"filename": f"full-v{v['id']}.tar.gz"}


@pytest.mark.parametrize("state, disabled", [("published", True), ("archived", True), ("created", True), ("published", False)])
def test_any_state_downloads(admin_client, db, state, disabled):
    _, v, _ = _build_full_source(admin_client, db)
    version = db.get(CourseVersion, v["id"])
    version.state, version.is_disabled = state, disabled
    db.commit()
    assert admin_client.get(f"/api/versions/{v['id']}/archive/check").status_code == 200
    assert admin_client.get(f"/api/versions/{v['id']}/archive").status_code == 200


def test_needs_course_admin(admin_client, auth_client, db):
    _, v, _ = _build_full_source(admin_client, db)
    for path in ("archive/check", "archive"):
        assert auth_client.get(f"/api/versions/{v['id']}/{path}").status_code == 403
        assert admin_client.get(f"/api/versions/999999/{path}").status_code == 404


def test_refusals_are_json_before_any_byte(admin_client, db):
    _, v, _ = _build_full_source(admin_client, db)
    logo = db.query(Asset).filter(Asset.version_id == v["id"], Asset.filename == "logo.png").one()
    assert admin_client.delete(f"/api/assets/{logo.id}?force=true").status_code == 204
    for path in ("archive/check", "archive"):
        r = admin_client.get(f"/api/versions/{v['id']}/{path}")
        assert r.status_code == 409
        assert r.json() == {"detail": "This version links to files it does not hold: logo.png"}


def _read_names(chunks):
    names = []
    try:
        with tarfile.open(fileobj=io.BytesIO(b"".join(chunks)), mode="r|gz") as tar:
            for m in tar:
                names.append(m.name)
    except (tarfile.TarError, EOFError, OSError):
        pass
    return names


def _not_whole(chunks):
    with pytest.raises((tarfile.TarError, EOFError, OSError)):
        tarfile.open(fileobj=io.BytesIO(b"".join(chunks)), mode="r:gz").getmembers()


def test_stream_stops_when_a_file_vanishes(tmp_path):
    a = tmp_path / "a.png"
    a.write_bytes(os.urandom(256 * 1024))  # big enough for zlib to let it out
    chunks = []
    gen = stream_archive(b"{}", [ArchiveFile("a.png", str(a), 0.0), ArchiveFile("b.png", str(tmp_path / "gone.png"), 0.0)])
    with pytest.raises(FileNotFoundError):
        for chunk in gen:
            chunks.append(chunk)
    names = _read_names(chunks)
    assert "mathion-course.json" in names
    assert "assets/b.png" not in names
    _not_whole(chunks)


def test_stream_stops_when_a_file_shrinks(tmp_path, monkeypatch):
    a = tmp_path / "a.png"
    a.write_bytes(os.urandom(1024))
    real = os.fstat
    monkeypatch.setattr(export.os, "fstat", lambda fd: os.stat_result((*real(fd)[:6], real(fd).st_size + 100, *real(fd)[7:])))
    chunks = []
    with pytest.raises(OSError):
        for chunk in stream_archive(b"{}", [ArchiveFile("a.png", str(a), 0.0)]):
            chunks.append(chunk)
    _not_whole(chunks)


def test_stream_has_no_empty_chunks(tmp_path):
    files = []
    for name in ("a.png", "b.png"):
        p = tmp_path / name
        p.write_bytes(b"tiny")
        files.append(ArchiveFile(name, str(p), 0.0))
    chunks = list(stream_archive(b"{}", files))
    assert chunks and all(len(c) > 0 for c in chunks)


def test_sink_hands_over_without_copying():
    sink = _Sink()
    sink.write(b"ab")
    original = sink.buf
    out = sink.take()
    assert isinstance(out, memoryview) and bytes(out) == b"ab"
    assert out.obj is original
    assert len(sink.buf) == 0


def test_reads_share_one_repeatable_read_snapshot(admin_client, db, monkeypatch):
    _, v, _ = _build_full_source(admin_client, db)
    seen = []

    def spy(real):
        def run(session, version):
            seen.append(session.execute(text("SHOW transaction_isolation")).scalar())
            return real(session, version)
        return run

    monkeypatch.setattr(version_archive, "preflight", spy(version_archive.preflight))
    monkeypatch.setattr(version_archive, "build_document", spy(version_archive.build_document))
    assert admin_client.get(f"/api/versions/{v['id']}/archive/check").status_code == 200
    assert seen == ["repeatable read", "repeatable read"]
    assert db.execute(text("SHOW transaction_isolation")).scalar() == "read committed"


def test_stream_yields_per_entry(tmp_path):
    files = []
    for name in ("a.png", "b.png"):
        p = tmp_path / name
        p.write_bytes(os.urandom(256 * 1024))  # gzip keeps small writes to itself
        files.append(ArchiveFile(name, str(p), 0.0))
    chunks = [c for c in stream_archive(b"{}", files) if c]
    assert len(chunks) > 1
    tar = _tar(b"".join(chunks))
    assert [m.name for m in tar.getmembers()] == ["mathion-course.json", "assets/a.png", "assets/b.png"]


def test_a_failed_stream_never_looks_finished(admin_client, db, monkeypatch):
    """Through the whole app: after a mid-stream failure no final body message is sent."""
    import asyncio
    from mathion.main import app

    _, v, _ = _build_full_source(admin_client, db)

    def broken(doc, files):
        yield memoryview(b"partial")
        raise FileNotFoundError("gone")

    monkeypatch.setattr(version_archive, "stream_archive", broken)
    token = admin_client.cookies["session_token"]
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET",
        "scheme": "http", "path": f"/api/versions/{v['id']}/archive", "raw_path": b"",
        "query_string": b"", "root_path": "", "client": ("127.0.0.1", 1), "server": ("127.0.0.1", 80),
        "headers": [(b"host", b"testserver"), (b"cookie", f"session_token={token}".encode())],
    }
    sent = []
    asked = []

    async def receive():
        if not asked:
            asked.append(1)
            return {"type": "http.request", "body": b"", "more_body": False}
        await asyncio.Event().wait()  # the client stays connected

    async def send(message):
        sent.append(message)

    with pytest.raises(FileNotFoundError):
        asyncio.run(app(scope, receive, send))
    assert sent[0]["type"] == "http.response.start" and sent[0]["status"] == 200
    bodies = [m for m in sent if m["type"] == "http.response.body"]
    assert bodies and bytes(bodies[0]["body"]) == b"partial"
    assert not [m for m in bodies if not m.get("more_body", False)]


def test_superuser_paths_still_get_no_store(client):
    r = client.get("/api/superuser/not-a-token/nothing")
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert "referrer-policy" not in client.get("/health").headers
