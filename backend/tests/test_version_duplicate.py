import os

from mathion.config import settings
from mathion.models import Asset, AssetReference, Block, CourseVersion, Item, Question, Sequence
from tests.test_version_clone import _build_full_source


def _asset_dir(version_id):
    return os.path.join(settings.asset_path, "courses", str(version_id))


def test_duplicate_full_fidelity_and_source_untouched(admin_client, db):
    course, src_v, filenames = _build_full_source(admin_client, db)
    admin_client.post(f"/api/versions/{src_v['id']}/publish")

    r = admin_client.post(f"/api/versions/{src_v['id']}/duplicate", json={"label": "Copy A"})
    assert r.status_code == 201, r.text
    new = r.json()
    assert new["state"] == "created" and new["is_disabled"] is False
    assert new["label"] == "Copy A" and new["course_id"] == course["id"]
    assert new["id"] != src_v["id"]

    # tree copied
    nb = db.query(Block).filter(Block.version_id == new["id"]).all()
    assert len(nb) == 1
    items = db.query(Item).join(Sequence).filter(Sequence.block_id == nb[0].id).all()
    assert len(items) == 4
    # asset files copied byte-identically under the new version dir
    with open(os.path.join(_asset_dir(new["id"]), "logo.png"), "rb") as fh1, \
         open(os.path.join(_asset_dir(src_v["id"]), "logo.png"), "rb") as fh2:
        assert fh1.read() == fh2.read()
    # rendered URLs + AssetReference rows resolve against the NEW version (spec §138-139)
    assert f"/assets/{new['id']}/logo.png" in new["info_html"]     # info_html -> new id
    new_q = db.query(Question).join(Item).join(Sequence).join(Block).filter(
        Block.version_id == new["id"], Question.type == "single_choice",
    ).one()
    assert f"/assets/{new['id']}/tq.png" in new_q.text_html         # text_html -> new id
    new_tq = db.query(Asset).filter(Asset.version_id == new["id"], Asset.filename == "tq.png").one()
    q_ref_asset_ids = {r.asset_id for r in db.query(AssetReference).filter(AssetReference.question_id == new_q.id)}
    assert new_tq.id in q_ref_asset_ids                            # question ref -> COPIED asset
    # source untouched
    assert db.query(Item).join(Sequence).join(Block).filter(Block.version_id == src_v["id"]).count() == 4
    # the duplicate creates NO run-scoped data (spec copy-fidelity requirement)
    from mathion.models import MiniProject, Run
    assert db.query(Run).count() == 0
    assert db.query(MiniProject).count() == 0


def test_duplicate_requires_admin_403(auth_client, admin_client, db):
    _, src_v, _ = _build_full_source(admin_client, db)
    r = auth_client.post(f"/api/versions/{src_v['id']}/duplicate", json={"label": "x"})
    assert r.status_code == 403
    assert r.json()["detail"] == "Course admin access required"


def test_duplicate_disabled_source_403(admin_client, db):
    _, src_v, _ = _build_full_source(admin_client, db)
    admin_client.post(f"/api/versions/{src_v['id']}/disable")
    r = admin_client.post(f"/api/versions/{src_v['id']}/duplicate", json={"label": "x"})
    assert r.status_code == 403
    assert r.json()["detail"] == "Cannot duplicate a disabled version"


def test_duplicate_missing_source_404(admin_client):
    r = admin_client.post("/api/versions/999999/duplicate", json={"label": "x"})
    assert r.status_code == 404


def test_duplicate_over_quota_400(admin_client, db, monkeypatch):
    _, src_v, _ = _build_full_source(admin_client, db)
    monkeypatch.setattr(settings, "max_course_size", 1)  # any real asset exceeds
    r = admin_client.post(f"/api/versions/{src_v['id']}/duplicate", json={"label": "x"})
    assert r.status_code == 400


def test_duplicate_dangling_referenced_asset_409_no_orphan_dir(admin_client, db):
    _, src_v, _ = _build_full_source(admin_client, db)
    admin_client.post(f"/api/versions/{src_v['id']}/publish")
    # force-delete a REFERENCED asset (logo.png is referenced by info_md)
    logo = db.query(Asset).filter(Asset.version_id == src_v["id"], Asset.filename == "logo.png").one()
    dr = admin_client.delete(f"/api/assets/{logo.id}?force=true")
    assert dr.status_code == 204
    before = set(os.listdir(os.path.join(settings.asset_path, "courses")))
    r = admin_client.post(f"/api/versions/{src_v['id']}/duplicate", json={"label": "x"})
    assert r.status_code == 409
    after = set(os.listdir(os.path.join(settings.asset_path, "courses")))
    assert before == after  # no orphaned courses/{new_id}/ dir left behind


def test_duplicate_empty_source_201(admin_client, db):
    course = admin_client.post("/api/courses", json={"slug": "empty", "name": "E", "description": ""}).json()
    src = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    r = admin_client.post(f"/api/versions/{src['id']}/duplicate", json={"label": "e"})
    assert r.status_code == 201
    assert db.query(Block).filter(Block.version_id == r.json()["id"]).count() == 0


def test_duplicate_omitted_body_defaults_label_empty(admin_client, db):
    course = admin_client.post("/api/courses", json={"slug": "nob", "name": "N", "description": ""}).json()
    src = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    r = admin_client.post(f"/api/versions/{src['id']}/duplicate")  # no body
    assert r.status_code == 201
    assert r.json()["label"] == ""


def test_duplicate_label_too_long_422(admin_client, db):
    course = admin_client.post("/api/courses", json={"slug": "lng", "name": "N", "description": ""}).json()
    src = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    r = admin_client.post(f"/api/versions/{src['id']}/duplicate", json={"label": "x" * 201})
    assert r.status_code == 422


def test_duplicate_abort_after_copy_rolls_back_and_cleans_dir(admin_client, db, monkeypatch):
    _, src_v, _ = _build_full_source(admin_client, db)
    import mathion.api.versions as versions_mod
    from fastapi import HTTPException

    def boom(*args, **kwargs):
        raise HTTPException(status_code=500, detail="forced post-copy failure")

    # clone_version_content runs AFTER copy_version_assets has written courses/{new_id},
    # so patching it forces the abort path with assets already on disk.
    monkeypatch.setattr(versions_mod, "clone_version_content", boom)

    courses_dir = os.path.join(settings.asset_path, "courses")
    before_dirs = set(os.listdir(courses_dir))
    before_count = db.query(CourseVersion).count()

    r = admin_client.post(f"/api/versions/{src_v['id']}/duplicate", json={"label": "x"})
    assert r.status_code == 500

    # rollback: the flushed new version was never committed
    assert db.query(CourseVersion).count() == before_count
    # cleanup: the copied courses/{new_id} dir was rmtree'd — no orphan left behind
    assert set(os.listdir(courses_dir)) == before_dirs
