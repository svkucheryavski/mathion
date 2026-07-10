import io
import os
from decimal import Decimal

import pytest
from fastapi import HTTPException

from mathion.api.version_clone import clone_version_content, collect_referenced_filenames, copy_version_assets
from mathion.config import settings
from mathion.models import AnswerOption, Asset, AssetReference, Block, CourseVersion, Item, Question, Sequence


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
    _upload(admin_client, src["id"], "gone.png", b"X")
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
    # eagerly (render_with_assets in create_version) and 422s on an asset that isn't uploaded.
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


def _build_full_source(admin_client, db):
    """Course + version with all four item types (incl. a video and a quiz item
    that BOTH carry content_md with an image ref), a quiz with all question
    types + options, version info referencing an asset, and a block with info.
    Returns (course, version_dict, {asset filenames}). Assets uploaded via API."""
    course = admin_client.post("/api/courses", json={"slug": "full", "name": "F", "description": ""}).json()
    v = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    for name in ("logo.png", "sp.png", "vid.png", "quiz.png", "tq.png", "exp.png"):
        admin_client.post(
            f"/api/versions/{v['id']}/assets",
            files={"file": (name, io.BytesIO(name.encode() * 4), "image/png")},
        )
    admin_client.post(
        f"/api/versions/{v['id']}/assets",
        files={"file": ("app.js", io.BytesIO(b"console.log(1)"), "text/javascript")},
    )
    version = db.get(CourseVersion, v["id"])
    # Set info_md via ORM AFTER assets exist. Creating the version with an
    # asset-referencing info_md would 422 (create_version renders info_md
    # eagerly via render_with_assets). The /duplicate endpoint later renders this
    # against the COPIED assets, so logo.png must be a real uploaded asset.
    version.info_md = "Welcome ![logo](logo.png)"

    block = Block(version_id=version.id, title="Blk", slug="blk", order=1,
                  info="Block info", info_html="<p>Block info</p>")
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="Seq", slug="seq", order=1)
    db.add(seq); db.flush()

    sp = Item(sequence_id=seq.id, title="SP", slug="sp", order=1, type="static_page",
              content_md="Page ![x](sp.png)", content_html="")
    vid = Item(sequence_id=seq.id, title="Vid", slug="vid", order=2, type="video",
               content_md="Notes ![x](vid.png)", content_html="", video_url="https://e.com/v")
    quiz = Item(sequence_id=seq.id, title="Quiz", slug="quiz", order=3, type="quiz",
                content_md="Intro ![x](quiz.png)", content_html="")
    app = Item(sequence_id=seq.id, title="App", slug="app", order=4, type="interactive_app",
               content_md=None, content_html="", script_url="app.js")
    db.add_all([sp, vid, quiz, app]); db.flush()
    # Establish the source interactive_app's script AssetReference (mirrors the
    # item PATCH-attach path). Without this the source app has ZERO references,
    # so the "source ref survives, no GC" assertion below would be vacuous.
    from mathion.api.helpers import sync_script_reference
    sync_script_reference(db, version.id, app.id, "app.js")

    q_choice = Question(item_id=quiz.id, text_md="Pick ![t](tq.png)", text_html="",
                        type="single_choice", order=1, explanation_md="Why ![e](exp.png)",
                        explanation_html="")
    q_num = Question(item_id=quiz.id, text_md="2+2?", text_html="", type="numeric_answer",
                     order=2, correct_numeric=Decimal("4"), precision=0)
    q_text = Question(item_id=quiz.id, text_md="Name?", text_html="", type="text_answer",
                      order=3, correct_text="ada")
    q_multi = Question(item_id=quiz.id, text_md="Select all", text_html="",
                       type="multiple_choice", order=4)
    db.add_all([q_choice, q_num, q_text, q_multi]); db.flush()
    db.add_all([
        AnswerOption(question_id=q_choice.id, text="A", is_correct=True, order=1),
        AnswerOption(question_id=q_choice.id, text="B", is_correct=False, order=2),
        AnswerOption(question_id=q_multi.id, text="C", is_correct=True, order=1),
        AnswerOption(question_id=q_multi.id, text="D", is_correct=True, order=2),
    ])
    db.commit()
    return course, v, {"logo.png", "sp.png", "vid.png", "quiz.png", "tq.png", "exp.png", "app.js"}


def test_clone_version_content_full_fidelity(admin_client, db):
    course, src_v, _ = _build_full_source(admin_client, db)
    source = db.get(CourseVersion, src_v["id"])

    new = CourseVersion(course_id=course["id"], state="created", is_disabled=False,
                        label="dup", info_md=source.info_md, info_html="",
                        max_quiz_attempts=source.max_quiz_attempts)
    db.add(new); db.flush()
    copy_version_assets(db, source.id, new.id, None)
    clone_version_content(db, source, new)
    db.commit()

    new_blocks = db.query(Block).filter(Block.version_id == new.id).all()
    assert len(new_blocks) == 1
    nb = new_blocks[0]
    assert nb.title == "Blk" and nb.info_html == "<p>Block info</p>"  # verbatim block html
    items = db.query(Item).join(Sequence).filter(Sequence.block_id == nb.id).order_by(Item.order).all()
    assert [i.type for i in items] == ["static_page", "video", "quiz", "interactive_app"]

    vid_item = items[1]
    assert vid_item.video_url == "https://e.com/v"
    assert vid_item.content_md == "Notes ![x](vid.png)"      # content_md kept on video
    assert f"/assets/{new.id}/vid.png" in vid_item.content_html  # rendered against NEW version
    assert f"/assets/{new.id}/sp.png" in items[0].content_html        # static_page rendered vs new
    assert f"/assets/{new.id}/quiz.png" in items[2].content_html      # quiz item rendered vs new

    app_item = items[3]
    assert app_item.script_url == "app.js"
    # the interactive_app's script AssetReference points at the NEW version's asset
    new_app_asset = db.query(Asset).filter(Asset.version_id == new.id, Asset.filename == "app.js").one()
    ref = db.query(AssetReference).filter(AssetReference.item_id == app_item.id).one()
    assert ref.asset_id == new_app_asset.id

    quiz_item = items[2]
    qs = db.query(Question).filter(Question.item_id == quiz_item.id).order_by(Question.order).all()
    assert [q.type for q in qs] == ["single_choice", "numeric_answer", "text_answer", "multiple_choice"]
    assert qs[1].correct_numeric == Decimal("4") and qs[1].precision == 0
    assert qs[2].correct_text == "ada"
    assert f"/assets/{new.id}/tq.png" in qs[0].text_html              # question text rendered vs new
    assert f"/assets/{new.id}/exp.png" in qs[0].explanation_html      # question explanation rendered vs new

    opts = db.query(AnswerOption).filter(AnswerOption.question_id == qs[0].id).order_by(AnswerOption.order).all()
    assert [(o.text, o.is_correct) for o in opts] == [("A", True), ("B", False)]

    # question AssetReference points at the COPIED asset in `new`
    new_tq = db.query(Asset).filter(Asset.version_id == new.id, Asset.filename == "tq.png").one()
    q_ref_asset_ids = {r.asset_id for r in db.query(AssetReference).filter(AssetReference.question_id == qs[0].id)}
    assert new_tq.id in q_ref_asset_ids

    # multiple_choice options copied with both correct
    mopts = db.query(AnswerOption).filter(AnswerOption.question_id == qs[3].id).order_by(AnswerOption.order).all()
    assert [(o.text, o.is_correct) for o in mopts] == [("C", True), ("D", True)]

    # SOURCE untouched: its interactive_app script ref + asset survive (no GC)
    src_app = db.query(Item).filter(Item.sequence_id.in_(
        db.query(Sequence.id).join(Block).filter(Block.version_id == source.id)
    ), Item.type == "interactive_app").one()
    assert db.query(AssetReference).filter(AssetReference.item_id == src_app.id).count() == 1
    assert db.query(Asset).filter(Asset.version_id == source.id, Asset.filename == "app.js").count() == 1
    src_app_asset = db.query(Asset).filter(Asset.version_id == source.id, Asset.filename == "app.js").one()
    src_ref = db.query(AssetReference).filter(AssetReference.item_id == src_app.id).one()
    assert src_ref.asset_id == src_app_asset.id
