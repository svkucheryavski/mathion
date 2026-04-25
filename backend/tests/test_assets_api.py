import io

import pytest

from mathion.auth import request_pin, verify_pin
from mathion.config import settings


@pytest.fixture(autouse=True)
def asset_tmpdir(tmp_path):
    """Override asset_path to use a temp directory for tests."""
    original = settings.asset_path
    settings.asset_path = str(tmp_path)
    yield tmp_path
    settings.asset_path = original


def _switch_to_user(client, db, user):
    raw_pin = request_pin(db, user.email)
    token = verify_pin(db, user.email, raw_pin, duration_days=7)
    client.cookies.set("session_token", token)


def _create_published_version(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "asset-course", "name": "AC", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Page", "slug": "page", "type": "static_page", "content_md": "# Hi",
    })
    admin_client.post(f"/api/versions/{version['id']}/publish")
    return course, version


def test_upload_asset(admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    file_content = b"fake png content"
    response = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("My Diagram.PNG", io.BytesIO(file_content), "image/png")},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["filename"] == "my-diagram.png"
    assert data["file_size"] == len(file_content)
    assert data["mime_type"] == "image/png"
    # File exists on disk
    path = asset_tmpdir / "courses" / str(version["id"]) / "my-diagram.png"
    assert path.exists()
    assert path.read_bytes() == file_content


def test_upload_duplicate_filename_rejected(admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("test.png", io.BytesIO(b"a"), "image/png")},
    )
    response = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("test.png", io.BytesIO(b"b"), "image/png")},
    )
    assert response.status_code == 409


def test_upload_svg_rejected(admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    response = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("hack.svg", io.BytesIO(b"<svg></svg>"), "image/svg+xml")},
    )
    assert response.status_code == 400
    assert "extension" in response.json()["detail"].lower()


def test_upload_too_large_rejected(admin_client, asset_tmpdir):
    original = settings.max_file_size
    settings.max_file_size = 100
    course, version = _create_published_version(admin_client)
    response = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("big.png", io.BytesIO(b"x" * 200), "image/png")},
    )
    settings.max_file_size = original
    assert response.status_code == 400
    assert "size" in response.json()["detail"].lower()


def test_upload_version_total_exceeded(admin_client, asset_tmpdir):
    original = settings.max_course_size
    settings.max_course_size = 50
    course, version = _create_published_version(admin_client)
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("a.png", io.BytesIO(b"x" * 10), "image/png")},
    )
    response = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("b.png", io.BytesIO(b"x" * 50), "image/png")},
    )
    settings.max_course_size = original
    assert response.status_code == 400
    assert "total" in response.json()["detail"].lower()


def test_upload_non_admin_rejected(admin_client, db, test_user, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    _switch_to_user(admin_client, db, test_user)
    response = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("test.png", io.BytesIO(b"a"), "image/png")},
    )
    assert response.status_code == 403


def test_upload_disk_failure_rolls_back_db(admin_client, db, asset_tmpdir):
    """If disk write fails, no asset row may exist in the DB.

    Simulates failure by placing a regular file where the version asset
    directory should be created — os.makedirs will raise NotADirectoryError.
    """
    import os as _os
    from mathion.models import Asset
    course, version = _create_published_version(admin_client)
    courses_dir = asset_tmpdir / "courses"
    courses_dir.mkdir(parents=True, exist_ok=True)
    # Block the version dir creation by putting a file there
    (courses_dir / str(version["id"])).write_bytes(b"")

    response = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("test.png", io.BytesIO(b"data"), "image/png")},
    )
    assert response.status_code >= 500

    rows = db.execute(
        __import__("sqlalchemy").select(Asset).where(Asset.version_id == version["id"])
    ).scalars().all()
    assert len(rows) == 0


def test_upload_disabled_version_rejected(admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    admin_client.post(f"/api/versions/{version['id']}/disable")
    response = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("test.png", io.BytesIO(b"a"), "image/png")},
    )
    assert response.status_code == 403


def test_list_assets(admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("a.png", io.BytesIO(b"aaa"), "image/png")},
    )
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("b.pdf", io.BytesIO(b"bbb"), "application/pdf")},
    )
    response = admin_client.get(f"/api/versions/{version['id']}/assets")
    assert response.status_code == 200
    assets = response.json()
    assert len(assets) == 2
    filenames = {a["filename"] for a in assets}
    assert filenames == {"a.png", "b.pdf"}


def test_list_assets_non_admin_rejected(admin_client, db, test_user, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    _switch_to_user(admin_client, db, test_user)
    response = admin_client.get(f"/api/versions/{version['id']}/assets")
    assert response.status_code == 403


# ----- Task 5: serve endpoint -----


def _enroll_user(db, user_id, version_id):
    from mathion.models_auth import StudentEnrollment
    enrollment = StudentEnrollment(user_id=user_id, version_id=version_id, is_active=True)
    db.add(enrollment)
    db.commit()


def test_serve_asset_as_admin(admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("test.png", io.BytesIO(b"png-content"), "image/png")},
    )
    response = admin_client.get(f"/assets/{version['id']}/test.png")
    assert response.status_code == 200
    assert response.content == b"png-content"
    assert response.headers["content-type"] == "image/png"


def test_serve_asset_as_enrolled_student(admin_client, db, test_user, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("doc.pdf", io.BytesIO(b"pdf-bytes"), "application/pdf")},
    )
    _enroll_user(db, test_user.id, version["id"])
    _switch_to_user(admin_client, db, test_user)
    response = admin_client.get(f"/assets/{version['id']}/doc.pdf")
    assert response.status_code == 200
    assert response.content == b"pdf-bytes"


def test_serve_asset_unenrolled_rejected(admin_client, db, test_user, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("test.png", io.BytesIO(b"data"), "image/png")},
    )
    _switch_to_user(admin_client, db, test_user)
    response = admin_client.get(f"/assets/{version['id']}/test.png")
    assert response.status_code == 403


def test_serve_asset_disabled_version_blocked(admin_client, db, test_user, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("test.png", io.BytesIO(b"data"), "image/png")},
    )
    _enroll_user(db, test_user.id, version["id"])
    admin_client.post(f"/api/versions/{version['id']}/disable")
    _switch_to_user(admin_client, db, test_user)
    response = admin_client.get(f"/assets/{version['id']}/test.png")
    assert response.status_code == 403


def test_serve_asset_disabled_version_blocks_admin(admin_client, asset_tmpdir):
    """Disabled versions block all access — superusers and admins included.

    Consistent with upload/delete which also reject 403 for admins on
    disabled versions.
    """
    course, version = _create_published_version(admin_client)
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("test.png", io.BytesIO(b"data"), "image/png")},
    )
    admin_client.post(f"/api/versions/{version['id']}/disable")
    response = admin_client.get(f"/assets/{version['id']}/test.png")
    assert response.status_code == 403


def test_serve_asset_not_found(admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    response = admin_client.get(f"/assets/{version['id']}/nonexistent.png")
    assert response.status_code == 404


# ----- Task 6: delete endpoint -----


def test_delete_asset(admin_client, db, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    upload = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("del.png", io.BytesIO(b"data"), "image/png")},
    ).json()
    path = asset_tmpdir / "courses" / str(version["id"]) / "del.png"
    assert path.exists()

    response = admin_client.delete(f"/api/assets/{upload['id']}")
    assert response.status_code == 204
    assert not path.exists()

    response = admin_client.get(f"/api/versions/{version['id']}/assets")
    assert len(response.json()) == 0


def test_delete_referenced_asset_warns(admin_client, db, asset_tmpdir):
    from sqlalchemy import select as sa_select
    from mathion.models import Asset, AssetReference, Block, Item, Sequence
    course, version = _create_published_version(admin_client)
    upload = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("ref.png", io.BytesIO(b"data"), "image/png")},
    ).json()

    asset = db.get(Asset, upload["id"])
    items = db.execute(
        sa_select(Item)
        .join(Sequence, Sequence.id == Item.sequence_id)
        .join(Block, Block.id == Sequence.block_id)
        .where(Block.version_id == version["id"])
    ).scalars().all()
    db.add(AssetReference(asset_id=asset.id, item_id=items[0].id))
    db.commit()

    response = admin_client.delete(f"/api/assets/{upload['id']}")
    assert response.status_code == 409
    assert "referenced" in response.json()["detail"].lower()


def test_delete_referenced_asset_force(admin_client, db, asset_tmpdir):
    from sqlalchemy import select as sa_select
    from mathion.models import Asset, AssetReference, Block, Item, Sequence
    course, version = _create_published_version(admin_client)
    upload = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("ref2.png", io.BytesIO(b"data"), "image/png")},
    ).json()

    asset = db.get(Asset, upload["id"])
    items = db.execute(
        sa_select(Item)
        .join(Sequence, Sequence.id == Item.sequence_id)
        .join(Block, Block.id == Sequence.block_id)
        .where(Block.version_id == version["id"])
    ).scalars().all()
    db.add(AssetReference(asset_id=asset.id, item_id=items[0].id))
    db.commit()

    response = admin_client.delete(f"/api/assets/{upload['id']}?force=true")
    assert response.status_code == 204


def test_delete_asset_non_admin_rejected(admin_client, db, test_user, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    upload = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("x.png", io.BytesIO(b"data"), "image/png")},
    ).json()
    _switch_to_user(admin_client, db, test_user)
    response = admin_client.delete(f"/api/assets/{upload['id']}")
    assert response.status_code == 403


def test_delete_asset_disabled_version_rejected(admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    upload = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("x.png", io.BytesIO(b"data"), "image/png")},
    ).json()
    admin_client.post(f"/api/versions/{version['id']}/disable")
    response = admin_client.delete(f"/api/assets/{upload['id']}")
    assert response.status_code == 403


# ----- Task 8: item save integration -----


def test_item_save_resolves_asset_refs(admin_client, db, asset_tmpdir):
    course = admin_client.post("/api/courses", json={"slug": "md-course", "name": "M", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("chart.png", io.BytesIO(b"png"), "image/png")},
    )
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Page", "slug": "page", "type": "static_page",
        "content_md": "See ![chart](chart.png) for details",
    }).json()
    assert f'/assets/{version["id"]}/chart.png' in item["content_html"]


def test_item_save_rejects_missing_asset(admin_client, asset_tmpdir):
    course = admin_client.post("/api/courses", json={"slug": "md2", "name": "M", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    response = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Page", "slug": "page", "type": "static_page",
        "content_md": "See ![chart](nonexistent.png) here",
    })
    assert response.status_code == 422
    assert "nonexistent.png" in response.json()["detail"]


def test_item_update_tracks_references(admin_client, db, asset_tmpdir):
    course = admin_client.post("/api/courses", json={"slug": "md3", "name": "M", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("a.png", io.BytesIO(b"a"), "image/png")},
    )
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("b.png", io.BytesIO(b"b"), "image/png")},
    )
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "P", "slug": "p", "type": "static_page",
        "content_md": "![img](a.png)",
    }).json()

    assets = admin_client.get(f"/api/versions/{version['id']}/assets").json()
    a_asset = [x for x in assets if x["filename"] == "a.png"][0]
    b_asset = [x for x in assets if x["filename"] == "b.png"][0]
    assert a_asset["is_referenced"] is True
    assert b_asset["is_referenced"] is False

    admin_client.patch(f"/api/items/{item['id']}", json={"content_md": "![img](b.png)"})
    assets = admin_client.get(f"/api/versions/{version['id']}/assets").json()
    a_asset = [x for x in assets if x["filename"] == "a.png"][0]
    b_asset = [x for x in assets if x["filename"] == "b.png"][0]
    assert a_asset["is_referenced"] is False
    assert b_asset["is_referenced"] is True


def test_item_no_asset_refs_works(admin_client, asset_tmpdir):
    course = admin_client.post("/api/courses", json={"slug": "md4", "name": "M", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "P", "slug": "p", "type": "static_page",
        "content_md": "Just text with [external](https://example.com)",
    }).json()
    assert item["content_html"]


# ----- Task 9: version copy with assets -----


def test_version_copy_assets(admin_client, db, asset_tmpdir):
    course = admin_client.post("/api/courses", json={"slug": "copy-course", "name": "C", "description": ""}).json()
    v1 = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()

    admin_client.post(
        f"/api/versions/{v1['id']}/assets",
        files={"file": ("a.png", io.BytesIO(b"aaa"), "image/png")},
    )
    admin_client.post(
        f"/api/versions/{v1['id']}/assets",
        files={"file": ("b.pdf", io.BytesIO(b"bbb"), "application/pdf")},
    )

    v2 = admin_client.post(
        f"/api/courses/{course['id']}/versions",
        json={"info_md": "", "copy_assets_from": v1["id"]},
    ).json()

    assets = admin_client.get(f"/api/versions/{v2['id']}/assets").json()
    assert len(assets) == 2
    filenames = {a["filename"] for a in assets}
    assert filenames == {"a.png", "b.pdf"}

    v2_dir = asset_tmpdir / "courses" / str(v2["id"])
    assert (v2_dir / "a.png").read_bytes() == b"aaa"
    assert (v2_dir / "b.pdf").read_bytes() == b"bbb"


def test_version_copy_assets_wrong_course_rejected(admin_client, asset_tmpdir):
    c1 = admin_client.post("/api/courses", json={"slug": "c1", "name": "C1", "description": ""}).json()
    c2 = admin_client.post("/api/courses", json={"slug": "c2", "name": "C2", "description": ""}).json()
    v1 = admin_client.post(f"/api/courses/{c1['id']}/versions", json={"info_md": ""}).json()

    response = admin_client.post(
        f"/api/courses/{c2['id']}/versions",
        json={"info_md": "", "copy_assets_from": v1["id"]},
    )
    assert response.status_code == 400


def test_version_copy_assets_size_check(admin_client, asset_tmpdir):
    original = settings.max_course_size
    settings.max_course_size = 10
    try:
        course = admin_client.post("/api/courses", json={"slug": "sc", "name": "S", "description": ""}).json()
        v1 = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
        # Bypass max_course_size for the source upload — it's a pre-existing version.
        # Use max_file_size only by temporarily restoring max_course_size for upload.
        settings.max_course_size = 10000
        admin_client.post(
            f"/api/versions/{v1['id']}/assets",
            files={"file": ("big.png", io.BytesIO(b"x" * 20), "image/png")},
        )
        settings.max_course_size = 10
        response = admin_client.post(
            f"/api/courses/{course['id']}/versions",
            json={"info_md": "", "copy_assets_from": v1["id"]},
        )
    finally:
        settings.max_course_size = original
    assert response.status_code == 400
    assert "size" in response.json()["detail"].lower()


def test_version_copy_no_assets_is_noop(admin_client, asset_tmpdir):
    course = admin_client.post("/api/courses", json={"slug": "empty", "name": "E", "description": ""}).json()
    v1 = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    v2 = admin_client.post(
        f"/api/courses/{course['id']}/versions",
        json={"info_md": "", "copy_assets_from": v1["id"]},
    ).json()
    assets = admin_client.get(f"/api/versions/{v2['id']}/assets").json()
    assert len(assets) == 0


def test_version_copy_fails_if_source_file_missing(admin_client, asset_tmpdir):
    """If source DB rows reference files missing on disk, copy must fail
    rather than silently create dangling registry rows in the new version.
    """
    import os
    course = admin_client.post("/api/courses", json={"slug": "miss", "name": "M", "description": ""}).json()
    v1 = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(
        f"/api/versions/{v1['id']}/assets",
        files={"file": ("a.png", io.BytesIO(b"data"), "image/png")},
    )
    # Simulate disk-only loss: remove the source file but keep the DB row
    os.remove(asset_tmpdir / "courses" / str(v1["id"]) / "a.png")

    response = admin_client.post(
        f"/api/courses/{course['id']}/versions",
        json={"info_md": "", "copy_assets_from": v1["id"]},
    )
    assert response.status_code == 500
    assert "missing" in response.json()["detail"].lower()
