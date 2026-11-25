"""Rows are written in one order (beta gate Task 3): ids ascend, references before the version row."""
import io
import re
from contextlib import contextmanager

import pytest
from sqlalchemy import event, text

from mathion.database import engine


@contextmanager
def _statements():
    seen: list[tuple[str, object]] = []

    def grab(conn, cursor, statement, params, context, executemany):
        for p in (params if executemany else [params]):
            seen.append((statement, p))

    event.listen(engine, "before_cursor_execute", grab)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", grab)


def _update_ids(seen, table):
    return [p[f"{table}_id"] for s, p in seen if s.startswith(f"UPDATE {table} ")]


def _first(seen, pred):
    return next(i for i, (s, _) in enumerate(seen) if pred(s))


def _draft(admin_client, slug="wo"):
    course = admin_client.post("/api/courses", json={"slug": slug, "name": "C", "description": ""}).json()
    return admin_client.post(f"/api/courses/{course['id']}/versions", json={"label": "L", "info_md": ""}).json()


def _upload(admin_client, version, name="pic.png"):
    r = admin_client.post(f"/api/versions/{version['id']}/assets",
                          files={"file": (name, io.BytesIO(b"png"), "image/png")})
    assert r.status_code == 201


def _tree(admin_client, version):
    b = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "info": ""}).json()
    s = admin_client.post(f"/api/blocks/{b['id']}/sequences", json={"title": "S"}).json()
    return b, s


def test_publish_renders_items_in_id_order(admin_client, db):
    version = _draft(admin_client)
    _b, s = _tree(admin_client, version)
    ids = [admin_client.post(f"/api/sequences/{s['id']}/items",
                             json={"title": f"I{n}", "type": "static_page", "content_md": f"$x^{n}$"}).json()["id"]
           for n in range(3)]
    for i in reversed(ids):
        db.execute(text("UPDATE items SET content_html = 'stale' WHERE id = :id"), {"id": i})
    db.commit()
    with _statements() as seen:
        assert admin_client.post(f"/api/versions/{version['id']}/publish").status_code == 200
    select_items = [s for s, _ in seen
                    if s.startswith("SELECT items.") and "JOIN sequences" in s and "items.type =" not in s]
    assert select_items and re.search(r"ORDER BY items\.id\s*$", select_items[0])
    written = _update_ids(seen, "items")
    assert sorted(set(written)) == sorted(ids) and written == sorted(written)


def _children(admin_client, kind):
    """Three children of one parent, plus the reorder URL and the stored orders reader."""
    version = _draft(admin_client, f"wo-{kind}")
    if kind == "blocks":
        ids = [admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": f"B{n}", "info": ""}).json()["id"]
               for n in range(3)]
        return ids, f"/api/versions/{version['id']}/blocks/reorder"
    b, s = _tree(admin_client, version)
    if kind == "sequences":
        ids = [s["id"]] + [admin_client.post(f"/api/blocks/{b['id']}/sequences", json={"title": f"S{n}"}).json()["id"]
                           for n in range(2)]
        return ids, f"/api/blocks/{b['id']}/sequences/reorder"
    if kind == "items":
        ids = [admin_client.post(f"/api/sequences/{s['id']}/items", json={"title": f"I{n}", "type": "quiz"}).json()["id"]
               for n in range(3)]
        return ids, f"/api/sequences/{s['id']}/items/reorder"
    item = admin_client.post(f"/api/sequences/{s['id']}/items", json={"title": "Q", "type": "quiz"}).json()
    q_ids = [admin_client.post(f"/api/items/{item['id']}/questions",
                               json={"text_md": f"Q{n}", "type": "single_choice"}).json()["id"] for n in range(3)]
    if kind == "questions":
        return q_ids, f"/api/items/{item['id']}/questions/reorder"
    ids = [admin_client.post(f"/api/questions/{q_ids[0]}/options",
                             json={"text": f"A{n}", "is_correct": n == 0}).json()["id"] for n in range(3)]
    return ids, f"/api/questions/{q_ids[0]}/options/reorder"


_TABLE = {"blocks": "blocks", "sequences": "sequences", "items": "items",
          "questions": "questions", "options": "answer_options"}


@pytest.mark.parametrize("kind", list(_TABLE))
def test_reorder_writes_in_id_order(admin_client, db, kind):
    ids, url = _children(admin_client, kind)
    payload = [{"id": i, "order": n + 1} for n, i in enumerate(reversed(ids))]
    db.expunge_all()                                   # rows load inside the request, one flush per row
    with _statements() as seen:
        assert admin_client.post(url, json={"order": payload}).status_code == 200
    table = _TABLE[kind]
    written = _update_ids(seen, table)
    assert written and written == sorted(written)
    stored = dict(db.execute(text(f'SELECT id, "order" FROM {table} WHERE id = ANY(:ids)'), {"ids": ids}).all())
    assert stored == {e["id"]: e["order"] for e in payload}


def _info_delete(s):
    return s.startswith("DELETE FROM asset_references") and "info_version_id" in s


def test_info_patch_writes_references_before_version(admin_client):
    version = _draft(admin_client, "wo-info")
    _upload(admin_client, version)
    with _statements() as seen:
        r = admin_client.patch(f"/api/versions/{version['id']}", json={"info_md": "![p](pic.png)"})
    assert r.status_code == 200
    assert _first(seen, _info_delete) < _first(seen, lambda s: s.startswith("UPDATE course_versions "))


def test_publish_writes_info_references_before_version(admin_client, db):
    version = _draft(admin_client, "wo-pub-info")
    _upload(admin_client, version)
    _b, s = _tree(admin_client, version)
    admin_client.post(f"/api/sequences/{s['id']}/items", json={"title": "I", "type": "static_page", "content_md": "hi"})
    assert admin_client.patch(f"/api/versions/{version['id']}", json={"info_md": "![p](pic.png)"}).status_code == 200
    db.execute(text("UPDATE course_versions SET info_html = 'stale' WHERE id = :id"), {"id": version["id"]})
    db.commit()
    with _statements() as seen:
        assert admin_client.post(f"/api/versions/{version['id']}/publish").status_code == 200
    assert _first(seen, _info_delete) < _first(seen, lambda s: s.startswith("UPDATE course_versions "))
