import io
import json
import os
from decimal import Decimal

import pytest
from fastapi import HTTPException

from mathion.archive.export import archive_filename, build_document, document_bytes, preflight
from mathion.config import settings
from mathion.models import AnswerOption, Asset, Block, CourseVersion, Item, Question, Sequence
from tests.test_version_clone import _build_full_source

FILES = {"logo.png", "sp.png", "vid.png", "quiz.png", "tq.png", "exp.png", "app.js"}


def _doc(db, version_id):
    version = db.get(CourseVersion, version_id)
    return json.loads(document_bytes(build_document(db, version)))


def _force_delete(admin_client, db, version_id, name):
    a = db.query(Asset).filter(Asset.version_id == version_id, Asset.filename == name).one()
    assert admin_client.delete(f"/api/assets/{a.id}?force=true").status_code == 204


def _keys(node):
    if isinstance(node, dict):
        for k, v in node.items():
            yield k
            yield from _keys(v)
    elif isinstance(node, list):
        for v in node:
            yield from _keys(v)


def test_document_full_fidelity(admin_client, db):
    _, v, _ = _build_full_source(admin_client, db)
    d = _doc(db, v["id"])
    assert d["format"] == 1
    assert d["made_by"] == settings.version
    assert d["course"] == {"name": "F", "slug": "full", "description": ""}
    assert d["version"] == {"label": "L", "info_md": "Welcome ![logo](logo.png)", "max_quiz_attempts": 3}
    [block] = d["blocks"]
    assert (block["title"], block["slug"], block["info"]) == ("Blk", "blk", "Block info")
    [seq] = block["sequences"]
    assert (seq["title"], seq["slug"]) == ("Seq", "seq")
    items = seq["items"]
    assert [i["type"] for i in items] == ["static_page", "video", "quiz", "interactive_app"]
    sp, vid, quiz, app = items
    assert (sp["title"], sp["slug"], sp["content_md"]) == ("SP", "sp", "Page ![x](sp.png)")
    assert (vid["title"], vid["slug"], vid["video_url"]) == ("Vid", "vid", "https://e.com/v")
    assert vid["content_md"] == "Notes ![x](vid.png)"
    assert (quiz["title"], quiz["slug"], quiz["content_md"]) == ("Quiz", "quiz", "Intro ![x](quiz.png)")
    assert (app["title"], app["slug"], app["video_url"]) == ("App", "app", None)
    assert app["script"] == "app.js"
    assert app["content_md"] is None
    assert sp["script"] is None and sp["questions"] == []
    qs = quiz["questions"]
    assert [q["type"] for q in qs] == ["single_choice", "numeric_answer", "text_answer", "multiple_choice"]
    choice, num, text, multi = qs
    assert choice["text_md"] == "Pick ![t](tq.png)"
    assert choice["explanation_md"] == "Why ![e](exp.png)"
    assert choice["options"] == [{"text": "A", "is_correct": True}, {"text": "B", "is_correct": False}]
    assert num["correct_numeric"] == "4.0000000000"
    assert num["precision"] == 0
    assert text["correct_text"] == "ada"
    assert (choice["correct_numeric"], choice["precision"], choice["correct_text"]) == (None, None, None)
    assert (num["explanation_md"], num["correct_text"], num["options"]) == (None, None, [])
    assert (text["explanation_md"], text["correct_numeric"], text["precision"]) == (None, None, None)
    assert multi["explanation_md"] is None
    assert multi["options"] == [{"text": "C", "is_correct": True}, {"text": "D", "is_correct": True}]


def test_document_has_nothing_about_people_or_rendering(admin_client, db):
    _, v, _ = _build_full_source(admin_client, db)
    keys = set(_keys(_doc(db, v["id"])))
    assert not [k for k in keys if k.endswith("_html")]
    banned = {"id", "order", "uploaded_by", "created_at", "updated_at", "published_at",
              "archived_at", "state", "is_disabled"}
    assert not keys & banned


KEYS = {
    "doc": {"format", "made_by", "course", "version", "blocks"},
    "course": {"name", "slug", "description"},
    "version": {"label", "info_md", "max_quiz_attempts"},
    "block": {"title", "slug", "info", "sequences"},
    "sequence": {"title", "slug", "items"},
    "item": {"title", "slug", "type", "content_md", "video_url", "script", "questions"},
    "question": {"type", "text_md", "explanation_md", "correct_numeric", "precision", "correct_text", "options"},
    "option": {"text", "is_correct"},
}


def test_document_keys_are_exactly_the_format(admin_client, db):
    _, v, _ = _build_full_source(admin_client, db)
    d = _doc(db, v["id"])
    assert set(d) == KEYS["doc"]
    assert set(d["course"]) == KEYS["course"] and set(d["version"]) == KEYS["version"]
    for b in d["blocks"]:
        assert set(b) == KEYS["block"]
        for s in b["sequences"]:
            assert set(s) == KEYS["sequence"]
            for i in s["items"]:
                assert set(i) == KEYS["item"]
                for q in i["questions"]:
                    assert set(q) == KEYS["question"]
                    assert all(set(o) == KEYS["option"] for o in q["options"])


def test_script_only_for_an_app_item(admin_client, db):
    _, v, _ = _build_full_source(admin_client, db)
    sp = db.query(Item).join(Sequence).join(Block).filter(Block.version_id == v["id"], Item.slug == "sp").one()
    sp.script_url = "app.js"
    db.commit()
    items = _doc(db, v["id"])["blocks"][0]["sequences"][0]["items"]
    assert items[0]["script"] is None


def test_document_follows_order_not_creation(admin_client, db):
    course = admin_client.post("/api/courses", json={"slug": "ord", "name": "O", "description": ""}).json()
    v = admin_client.post(f"/api/courses/{course['id']}/versions", json={"label": "L", "info_md": ""}).json()
    b1 = Block(version_id=v["id"], title="B-second", slug="b1", order=2)
    b2 = Block(version_id=v["id"], title="B-first", slug="b2", order=1)
    db.add_all([b1, b2]); db.flush()
    s1 = Sequence(block_id=b2.id, title="S-second", slug="s1", order=2)
    s2 = Sequence(block_id=b2.id, title="S-first", slug="s2", order=1)
    db.add_all([s1, s2]); db.flush()
    i1 = Item(sequence_id=s2.id, title="I-second", slug="i1", order=2, type="static_page", content_md="", content_html="")
    i2 = Item(sequence_id=s2.id, title="I-first", slug="i2", order=1, type="quiz", content_md="", content_html="")
    db.add_all([i1, i2]); db.flush()
    q1 = Question(item_id=i2.id, text_md="Q-second", text_html="", type="single_choice", order=2)
    q2 = Question(item_id=i2.id, text_md="Q-first", text_html="", type="single_choice", order=1)
    db.add_all([q1, q2]); db.flush()
    db.add_all([AnswerOption(question_id=q2.id, text="O-second", is_correct=False, order=2),
                AnswerOption(question_id=q2.id, text="O-first", is_correct=True, order=1)])
    db.commit()
    d = _doc(db, v["id"])
    assert [b["title"] for b in d["blocks"]] == ["B-first", "B-second"]
    seqs = d["blocks"][0]["sequences"]
    assert [s["title"] for s in seqs] == ["S-first", "S-second"]
    items = seqs[0]["items"]
    assert [i["title"] for i in items] == ["I-first", "I-second"]
    assert [q["text_md"] for q in items[0]["questions"]] == ["Q-first", "Q-second"]
    assert [o["text"] for o in items[0]["questions"][0]["options"]] == ["O-first", "O-second"]


@pytest.mark.parametrize("value, text", [
    ("0", "0.0000000000"), ("0.0000001", "0.0000001000"), ("-0.00000005", "-0.0000000500"),
    ("1234567890.1234567890", "1234567890.1234567890"),
])
def test_numeric_answer_is_plain_digits(admin_client, db, value, text):
    _, v, _ = _build_full_source(admin_client, db)
    q = db.query(Question).filter(Question.type == "numeric_answer").one()
    q.correct_numeric = Decimal(value)
    db.commit()
    db.expire_all()
    qs = _doc(db, v["id"])["blocks"][0]["sequences"][0]["items"][2]["questions"]
    assert qs[1]["correct_numeric"] == text


def test_document_keeps_unicode(admin_client, db):
    course = admin_client.post("/api/courses", json={"slug": "uni", "name": "U", "description": ""}).json()
    v = admin_client.post(f"/api/courses/{course['id']}/versions", json={"label": "L", "info_md": ""}).json()
    block = Block(version_id=v["id"], title="Ünïcode ∑", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    db.add(Item(sequence_id=seq.id, title="I", slug="i", order=1, type="static_page",
                content_md="Привет $x^2$", content_html=""))
    db.commit()
    text = document_bytes(build_document(db, db.get(CourseVersion, v["id"]))).decode("utf-8")
    assert "Ünïcode ∑" in text
    assert "Привет $x^2$" in text


def test_empty_version_document(admin_client, db):
    course = admin_client.post("/api/courses", json={"slug": "empty", "name": "E", "description": ""}).json()
    v = admin_client.post(f"/api/courses/{course['id']}/versions", json={"label": "L", "info_md": ""}).json()
    assert _doc(db, v["id"])["blocks"] == []
    assert preflight(db, db.get(CourseVersion, v["id"])) == []


def test_preflight_lists_every_file_sorted(admin_client, db):
    _, v, _ = _build_full_source(admin_client, db)
    extra = {"zz.png", "ab.png", "a-z.png"}
    for name in extra:
        r = admin_client.post(f"/api/versions/{v['id']}/assets",
                              files={"file": (name, io.BytesIO(b"ZZZ"), "image/png")})
        assert r.status_code == 201, r.text
    files = preflight(db, db.get(CourseVersion, v["id"]))
    assert [f.filename for f in files] == sorted(FILES | extra)
    assert all(os.path.isfile(f.path) for f in files)


def test_preflight_dangling_reference_409(admin_client, db):
    _, v, _ = _build_full_source(admin_client, db)
    _force_delete(admin_client, db, v["id"], "logo.png")
    db.expire_all()
    with pytest.raises(HTTPException) as exc:
        preflight(db, db.get(CourseVersion, v["id"]))
    assert exc.value.status_code == 409
    assert exc.value.detail == "This version links to files it does not hold: logo.png"


def test_preflight_missing_on_disk_409(admin_client, db):
    _, v, _ = _build_full_source(admin_client, db)
    os.remove(os.path.join(settings.asset_path, "courses", str(v["id"]), "sp.png"))
    with pytest.raises(HTTPException) as exc:
        preflight(db, db.get(CourseVersion, v["id"]))
    assert exc.value.status_code == 409
    assert exc.value.detail == "These files of the version are missing on the server: sp.png"


def test_archive_filename():
    assert archive_filename("calc-1", 15) == "calc-1-v15.tar.gz"


def test_preflight_names_several_sorted_and_dangling_first(admin_client, db):
    _, v, _ = _build_full_source(admin_client, db)
    folder = os.path.join(settings.asset_path, "courses", str(v["id"]))
    os.remove(os.path.join(folder, "sp.png"))
    os.remove(os.path.join(folder, "exp.png"))
    _force_delete(admin_client, db, v["id"], "tq.png")
    _force_delete(admin_client, db, v["id"], "logo.png")
    db.expire_all()
    with pytest.raises(HTTPException) as exc:
        preflight(db, db.get(CourseVersion, v["id"]))
    assert exc.value.detail == "This version links to files it does not hold: logo.png, tq.png"


def test_preflight_missing_names_python_sorted(admin_client, db):
    _, v, _ = _build_full_source(admin_client, db)
    for name in ("ab.png", "a-z.png"):
        r = admin_client.post(f"/api/versions/{v['id']}/assets",
                              files={"file": (name, io.BytesIO(b"Z"), "image/png")})
        assert r.status_code == 201, r.text
    folder = os.path.join(settings.asset_path, "courses", str(v["id"]))
    for name in ("sp.png", "ab.png", "a-z.png"):
        os.remove(os.path.join(folder, name))
    with pytest.raises(HTTPException) as exc:
        preflight(db, db.get(CourseVersion, v["id"]))
    assert exc.value.detail == "These files of the version are missing on the server: a-z.png, ab.png, sp.png"
