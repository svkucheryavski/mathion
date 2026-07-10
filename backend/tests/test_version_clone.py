import io
import os

import pytest
from fastapi import HTTPException

from mathion.api.version_clone import copy_version_assets
from mathion.config import settings
from mathion.models import Asset, CourseVersion


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
