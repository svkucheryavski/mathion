"""Authoring writes on a draft take the per-version lock first, as publish does (beta gate Task 3c)."""
import re
import threading
import time
from contextlib import contextmanager

import pytest
from sqlalchemy import event, select, text

from mathion.api import advisory
from fastapi import HTTPException

from mathion.api.items import delete_item, update_item
from mathion.api.versions import publish_version
from mathion.database import engine
from mathion.markdown import render_markdown
from mathion.models_auth import User
from mathion.schemas import ItemUpdate
from tests.conftest import record_lock_calls


def _tree(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "dl", "name": "C", "description": ""}).json()
    v = admin_client.post(f"/api/courses/{course['id']}/versions", json={"label": "L", "info_md": ""}).json()["id"]
    b = admin_client.post(f"/api/versions/{v}/blocks", json={"title": "B", "info": ""}).json()["id"]
    b2 = admin_client.post(f"/api/versions/{v}/blocks", json={"title": "B2", "info": ""}).json()["id"]
    s = admin_client.post(f"/api/blocks/{b}/sequences", json={"title": "S"}).json()["id"]
    s2 = admin_client.post(f"/api/blocks/{b}/sequences", json={"title": "S2"}).json()["id"]
    page = admin_client.post(f"/api/sequences/{s}/items",
                             json={"title": "P", "type": "static_page", "content_md": "old"}).json()["id"]
    quiz = admin_client.post(f"/api/sequences/{s}/items", json={"title": "Q", "type": "quiz"}).json()["id"]
    q = admin_client.post(f"/api/items/{quiz}/questions", json={"text_md": "Q1", "type": "single_choice"}).json()["id"]
    q2 = admin_client.post(f"/api/items/{quiz}/questions", json={"text_md": "Q2", "type": "single_choice"}).json()["id"]
    o = admin_client.post(f"/api/questions/{q}/options", json={"text": "A", "is_correct": True}).json()["id"]
    o2 = admin_client.post(f"/api/questions/{q}/options", json={"text": "B", "is_correct": False}).json()["id"]
    return dict(v=v, b=b, b2=b2, s=s, s2=s2, page=page, quiz=quiz, q=q, q2=q2, o=o, o2=o2)


def _order(*ids):
    return {"order": [{"id": i, "order": n + 1} for n, i in enumerate(ids)]}


WRITES = {
    "create_block": lambda t: ("post", f"/api/versions/{t['v']}/blocks", {"title": "N", "info": ""}),
    "update_block": lambda t: ("patch", f"/api/blocks/{t['b2']}", {"title": "N"}),
    "delete_block": lambda t: ("delete", f"/api/blocks/{t['b2']}", None),
    "reorder_blocks": lambda t: ("post", f"/api/versions/{t['v']}/blocks/reorder", _order(t["b2"], t["b"])),
    "create_sequence": lambda t: ("post", f"/api/blocks/{t['b']}/sequences", {"title": "N"}),
    "update_sequence": lambda t: ("patch", f"/api/sequences/{t['s2']}", {"title": "N"}),
    "delete_sequence": lambda t: ("delete", f"/api/sequences/{t['s2']}", None),
    "reorder_sequences": lambda t: ("post", f"/api/blocks/{t['b']}/sequences/reorder", _order(t["s2"], t["s"])),
    "create_item": lambda t: ("post", f"/api/sequences/{t['s']}/items", {"title": "N", "type": "quiz"}),
    "update_item": lambda t: ("patch", f"/api/items/{t['page']}", {"content_md": "new"}),
    "delete_item": lambda t: ("delete", f"/api/items/{t['page']}", None),
    "reorder_items": lambda t: ("post", f"/api/sequences/{t['s']}/items/reorder", _order(t["quiz"], t["page"])),
    "create_question": lambda t: ("post", f"/api/items/{t['quiz']}/questions",
                                  {"text_md": "N", "type": "single_choice"}),
    "update_question": lambda t: ("patch", f"/api/questions/{t['q2']}", {"text_md": "N"}),
    "delete_question": lambda t: ("delete", f"/api/questions/{t['q2']}", None),
    "reorder_questions": lambda t: ("post", f"/api/items/{t['quiz']}/questions/reorder", _order(t["q2"], t["q"])),
    "create_option": lambda t: ("post", f"/api/questions/{t['q']}/options", {"text": "C", "is_correct": False}),
    "update_option": lambda t: ("patch", f"/api/options/{t['o2']}", {"text": "N"}),
    "delete_option": lambda t: ("delete", f"/api/options/{t['o2']}", None),
    "reorder_options": lambda t: ("post", f"/api/questions/{t['q']}/options/reorder", _order(t["o2"], t["o"])),
}


@pytest.mark.parametrize("name", list(WRITES))
def test_every_draft_write_takes_the_version_lock(admin_client, monkeypatch, name):
    t = _tree(admin_client)
    method, url, body = WRITES[name](t)
    events = record_lock_calls(monkeypatch)
    with _statements() as seen:
        r = getattr(admin_client, method)(url, **({"json": body} if body is not None else {}))
    assert r.status_code in (200, 201, 204), r.text
    assert events == [("lock", advisory.LOCK_NS_VERSION_INFO, (t["v"],))]
    lock = next(i for i, st in enumerate(seen) if "pg_advisory_xact_lock" in st)
    first_write = next(i for i, st in enumerate(seen) if _CONTENT_WRITE.match(st))
    assert lock < first_write


_CONTENT_WRITE = re.compile(r"(INSERT INTO|UPDATE|DELETE FROM) (blocks|sequences|items|questions|answer_options)\b")


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


def _draft(admin_client, slug):
    course = admin_client.post("/api/courses", json={"slug": slug, "name": "C", "description": ""}).json()
    return admin_client.post(f"/api/courses/{course['id']}/versions", json={"label": "L", "info_md": ""}).json()["id"]


@pytest.mark.parametrize("kind", ["delete", "duplicate"])
def test_whole_draft_writes_take_the_version_lock_first(admin_client, monkeypatch, kind):
    v = _draft(admin_client, f"wd-{kind}")
    events = record_lock_calls(monkeypatch)
    with _statements() as seen:
        if kind == "delete":
            r = admin_client.delete(f"/api/versions/{v}")
        else:
            r = admin_client.post(f"/api/versions/{v}/duplicate", json={"label": "Copy"})
    assert r.status_code in (201, 204), r.text
    assert events[0] == ("lock", advisory.LOCK_NS_VERSION_INFO, (v,))
    assert "pg_advisory_xact_lock" in next(st for st in seen if "course_versions" in st or "pg_advisory" in st)


def _lock_waiting(probe) -> bool:
    probe.rollback()
    return bool(probe.execute(text(
        "SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted LIMIT 1")).first())


def _page_tree(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "dl2", "name": "C", "description": ""}).json()
    v = admin_client.post(f"/api/courses/{course['id']}/versions", json={"label": "L", "info_md": ""}).json()["id"]
    b = admin_client.post(f"/api/versions/{v}/blocks", json={"title": "B", "info": ""}).json()["id"]
    s = admin_client.post(f"/api/blocks/{b}/sequences", json={"title": "S"}).json()["id"]
    page = admin_client.post(f"/api/sequences/{s}/items",
                             json={"title": "P", "type": "static_page", "content_md": "old"}).json()["id"]
    return dict(v=v, page=page)


def test_publish_does_not_render_an_item_edited_meanwhile(concurrency, monkeypatch, admin_client, db):
    t = _page_tree(admin_client)
    db.execute(text("UPDATE items SET content_html = 'stale' WHERE id = :id"), {"id": t["page"]})
    db.commit()
    a_parked, a_release = threading.Event(), threading.Event()
    real_hook = advisory.interleave_hook

    def hook(label):
        if label == "item_saved" and threading.current_thread().name == "A":
            a_parked.set()
            if not a_release.wait(timeout=10):
                raise RuntimeError("item_saved seam release timed out")
        return real_hook(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)
    sa, sb, probe = concurrency.make_sessions(3)
    result = {}

    def admin(session):
        return session.execute(select(User).where(User.email == "admin@example.com")).scalar_one()

    def edit():
        try:
            update_item(t["page"], ItemUpdate(content_md="new"), db=sa, user=admin(sa))
            result["a"] = "ok"
        except Exception as exc:
            sa.rollback()
            result["a"] = repr(exc)

    def publish():
        try:
            publish_version(t["v"], db=sb, user=admin(sb))
            result["b"] = "ok"
        except Exception as exc:
            sb.rollback()
            result["b"] = repr(exc)

    ta = threading.Thread(target=edit, name="A")
    ta.start()
    concurrency.threads.append(ta)
    assert a_parked.wait(timeout=10), "update_item never reached the item_saved seam"
    tb = concurrency.spawn(publish)
    deadline = time.monotonic() + 3
    while tb.is_alive() and not _lock_waiting(probe) and time.monotonic() < deadline:
        time.sleep(0.02)
    a_release.set()
    ta.join(timeout=10)
    tb.join(timeout=10)
    assert result == {"a": "ok", "b": "ok"}
    probe.rollback()
    md, html = probe.execute(text("SELECT content_md, content_html FROM items WHERE id = :id"),
                             {"id": t["page"]}).one()
    probe.rollback()
    assert (md, html) == ("new", render_markdown("new"))


def test_a_write_that_waited_sees_the_version_published_meanwhile(concurrency, admin_client):
    t = _page_tree(admin_client)
    holder, sb, probe = concurrency.make_sessions(3)
    advisory.advisory_xact_lock(holder, advisory.LOCK_NS_VERSION_INFO, t["v"])
    result = {}

    def delete():
        user = sb.execute(select(User).where(User.email == "admin@example.com")).scalar_one()
        try:
            delete_item(t["page"], db=sb, user=user)
            result["b"] = "deleted"
        except HTTPException as exc:
            sb.rollback()
            result["b"] = exc.status_code

    try:
        tb = concurrency.spawn(delete)
        deadline = time.monotonic() + 5
        waiting = False
        while not waiting and time.monotonic() < deadline:
            waiting = _lock_waiting(probe)
            time.sleep(0.02)
        assert waiting and tb.is_alive(), "delete_item never waited on the draft lock"
        holder.execute(text("UPDATE course_versions SET state = 'published' WHERE id = :id"), {"id": t["v"]})
        holder.commit()
        tb.join(timeout=10)
    finally:
        holder.rollback()                              # a failed run still frees the lock
    assert result == {"b": 409}
    probe.rollback()
    assert probe.execute(text("SELECT count(*) FROM items WHERE id = :id"), {"id": t["page"]}).scalar() == 1
    probe.rollback()
