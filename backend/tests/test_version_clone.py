import io
import os

import pytest
from fastapi import HTTPException

from mathion.api.version_clone import collect_referenced_filenames, copy_version_assets
from mathion.config import settings
from mathion.models import Asset, Block, CourseVersion, Item, Question, Sequence


def _mk_course_version(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "vc", "name": "VC", "description": ""}).json()
    v = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    return course, v


def _upload(admin_client, version_id, name, content):
    r = admin_client.post(
        f"/api/versions/{version_id}/assets",
        files={"file": (name, io.BytesIO(content), "image/png")},
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_copy_version_assets_copies_rows_and_files(admin_client, db):
    course, src = _mk_course_version(admin_client)
    _upload(admin_client, src["id"], "a.png", b"AAA")
    _upload(admin_client, src["id"], "b.png", b"BBBBB")

    dst = CourseVersion(course_id=course["id"], info_md="", info_html="", max_quiz_attempts=3)
    db.add(dst)
    db.flush()

    copy_version_assets(db, src["id"], dst.id, None)
    db.commit()

    rows = db.query(Asset).filter(Asset.version_id == dst.id).all()
    assert {r.filename for r in rows} == {"a.png", "b.png"}
    dst_dir = os.path.join(settings.asset_path, "courses", str(dst.id))
    with open(os.path.join(dst_dir, "a.png"), "rb") as fh:
        assert fh.read() == b"AAA"  # byte-identical copy


def test_copy_version_assets_missing_file_raises_500(admin_client, db):
    course, src = _mk_course_version(admin_client)
    a = _upload(admin_client, src["id"], "gone.png", b"X")
    # Delete the file on disk but keep the DB row -> preflight must catch it.
    os.remove(os.path.join(settings.asset_path, "courses", str(src["id"]), "gone.png"))

    dst = CourseVersion(course_id=course["id"], info_md="", info_html="", max_quiz_attempts=3)
    db.add(dst)
    db.flush()

    with pytest.raises(HTTPException) as exc:
        copy_version_assets(db, src["id"], dst.id, None)
    assert exc.value.status_code == 500


def test_collect_referenced_filenames_aggregates_all_owners(admin_client, db):
    course = admin_client.post("/api/courses", json={"slug": "crf", "name": "C", "description": ""}).json()
    v = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    version = db.get(CourseVersion, v["id"])
    # Set info_md via ORM, NOT the create API: create_version renders info_md
    # eagerly (versions.py:82) and 422s on an asset that isn't uploaded.
    # collect_referenced_filenames reads the raw text, so no upload is needed here.
    version.info_md = "Info ![i](info.png)"

    block = Block(version_id=version.id, title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()

    # static_page item referencing a page asset
    page = Item(sequence_id=seq.id, title="P", slug="p", order=1, type="static_page",
                content_md="See ![d](diagram.png)", content_html="")
    # interactive_app with a script filename
    app = Item(sequence_id=seq.id, title="A", slug="a", order=2, type="interactive_app",
               content_md=None, content_html="", script_url="app.js")
    # interactive_app with NO script yet -> must be skipped, not crash
    app2 = Item(sequence_id=seq.id, title="A2", slug="a2", order=3, type="interactive_app",
                content_md=None, content_html="", script_url=None)
    db.add_all([page, app, app2]); db.flush()

    q = Question(item_id=page.id, text_md="Q ![t](tq.png)", text_html="",
                 type="text_answer", order=1, explanation_md="Ex ![e](exp.png)",
                 explanation_html="", correct_text="a")
    db.add(q); db.commit()

    names = collect_referenced_filenames(db, version)
    assert names == {"info.png", "diagram.png", "app.js", "tq.png", "exp.png"}
