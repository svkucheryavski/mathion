"""D11, D11a (superuser Settings): every upload path reads its limits from the
panel's Settings, and says them in whole MB.

The byte-limit tests of test_assets_api, test_run_assets and
test_version_duplicate (which patched the old `settings.max_*_size`) live
here now, one per path, with the panel's whole-MB limits."""
import io
import tempfile

from mathion.site_settings import MB
from tests.conftest import FAR_DEADLINE_ISO, NEAR_DEADLINE_ISO, set_site
from tests.test_assets_api import _create_published_version
from tests.test_evaluations import _make_submitted

OVER_1_MB = b"x" * (MB + 1)
FILE_SENTENCE = "This file is over the 1 MB limit."


def _pdf(size: int) -> bytes:
    return b"%PDF-1.4\n" + b"x" * (size - 9)


# --- one file over the largest-file limit, on each path ---

def test_course_asset_over_the_file_limit(admin_client, db):
    _, version = _create_published_version(admin_client)
    set_site(db, max_file_mb=1)
    r = admin_client.post(f"/api/versions/{version['id']}/assets",
                          files={"file": ("big.png", io.BytesIO(OVER_1_MB), "image/png")})
    assert (r.status_code, r.json()["detail"]) == (400, FILE_SENTENCE)


def test_course_asset_at_the_file_limit_is_accepted(admin_client, db):
    _, version = _create_published_version(admin_client)
    set_site(db, max_file_mb=1)
    r = admin_client.post(f"/api/versions/{version['id']}/assets",
                          files={"file": ("edge.png", io.BytesIO(b"x" * MB), "image/png")})
    assert r.status_code == 201


def test_run_asset_over_the_file_limit(admin_client, db, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    set_site(db, max_file_mb=1)
    r = admin_client.post(f"/api/runs/{run['id']}/assets",
                          files={"file": ("big.pdf", io.BytesIO(_pdf(MB + 1)), "application/pdf")})
    assert (r.status_code, r.json()["detail"]) == (413, FILE_SENTENCE)


def test_run_asset_replace_over_the_file_limit(admin_client, db, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    first = admin_client.post(f"/api/runs/{run['id']}/assets",
                              files={"file": ("doc.pdf", io.BytesIO(_pdf(100)), "application/pdf")}).json()
    set_site(db, max_file_mb=1)
    r = admin_client.put(f"/api/runs/{run['id']}/assets/{first['id']}",
                         files={"file": ("doc.pdf", io.BytesIO(_pdf(MB + 1)), "application/pdf")})
    assert (r.status_code, r.json()["detail"]) == (413, FILE_SENTENCE)


def _published_mini_project(admin_client, db, seed_run_with_groups):
    from sqlalchemy import select
    from mathion.models import Block, Run
    run, _, _ = seed_run_with_groups()
    block = db.execute(select(Block).where(
        Block.version_id == db.get(Run, run["id"]).version_id)).scalars().first()
    mp = admin_client.post(f"/api/runs/{run['id']}/mini-projects", json={
        "block_id": block.id, "assignment_md": "x",
        "hard_deadline": NEAR_DEADLINE_ISO, "resubmission_deadline": FAR_DEADLINE_ISO,
    }).json()
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    return mp


def test_submission_over_the_file_limit(admin_client, student_client_for, db, seed_run_with_groups):
    mp = _published_mini_project(admin_client, db, seed_run_with_groups)
    set_site(db, max_file_mb=1)
    student = student_client_for("alice@example.com")
    r = student.post(f"/api/mini-projects/{mp['id']}/submissions",
                     files={"file": ("r.pdf", io.BytesIO(_pdf(MB + 1)), "application/pdf")})
    assert (r.status_code, r.json()["detail"]) == (400, FILE_SENTENCE)


def test_evaluation_file_over_the_file_limit(admin_client, student_client_for, db, seed_run_with_groups):
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    set_site(db, max_file_mb=1)
    r = admin_client.post(f"/api/submissions/{sub['id']}/evaluation",
                          data={"result": "minor_revision", "feedback_text": "Fix x"},
                          files={"file": ("fb.pdf", io.BytesIO(_pdf(MB + 1)), "application/pdf")})
    assert (r.status_code, r.json()["detail"]) == (400, FILE_SENTENCE)


def test_course_asset_read_is_bounded(admin_client, db, monkeypatch):
    # D11: course files read at most the limit plus one byte, like the others.
    _, version = _create_published_version(admin_client)
    set_site(db, max_file_mb=1)
    sizes = []
    real_read = tempfile.SpooledTemporaryFile.read

    def recording_read(self, *args):
        sizes.append(args[0] if args else None)
        return real_read(self, *args)

    monkeypatch.setattr(tempfile.SpooledTemporaryFile, "read", recording_read)
    admin_client.post(f"/api/versions/{version['id']}/assets",
                      files={"file": ("a.png", io.BytesIO(b"abc"), "image/png")})
    assert MB + 1 in sizes
    assert None not in sizes and -1 not in sizes


# --- the total per version or run ---

def test_version_total_over_the_limit(admin_client, db):
    _, version = _create_published_version(admin_client)
    set_site(db, max_file_mb=1, max_total_mb=2)
    for name in ("a.png", "b.png"):
        ok = admin_client.post(f"/api/versions/{version['id']}/assets",
                               files={"file": (name, io.BytesIO(b"x" * MB), "image/png")})
        assert ok.status_code == 201
    r = admin_client.post(f"/api/versions/{version['id']}/assets",
                          files={"file": ("c.png", io.BytesIO(b"x"), "image/png")})
    assert (r.status_code, r.json()["detail"]) == (
        400, "This would take the files of this version past its 2 MB limit.")


def test_run_total_over_the_limit(admin_client, db, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    set_site(db, max_file_mb=1, max_total_mb=2)
    for name in ("a.pdf", "b.pdf"):
        ok = admin_client.post(f"/api/runs/{run['id']}/assets",
                               files={"file": (name, io.BytesIO(_pdf(MB)), "application/pdf")})
        assert ok.status_code == 201
    r = admin_client.post(f"/api/runs/{run['id']}/assets",
                          files={"file": ("c.pdf", io.BytesIO(_pdf(100)), "application/pdf")})
    assert (r.status_code, r.json()["detail"]) == (
        413, "This would take the files of this run past its 2 MB limit.")


def test_run_replace_total_over_the_limit(admin_client, db, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    set_site(db, max_file_mb=1, max_total_mb=2)
    small = admin_client.post(f"/api/runs/{run['id']}/assets",
                              files={"file": ("a.pdf", io.BytesIO(_pdf(100)), "application/pdf")}).json()
    admin_client.post(f"/api/runs/{run['id']}/assets",
                      files={"file": ("b.pdf", io.BytesIO(_pdf(MB)), "application/pdf")})
    admin_client.post(f"/api/runs/{run['id']}/assets",
                      files={"file": ("c.pdf", io.BytesIO(_pdf(MB - 200)), "application/pdf")})
    r = admin_client.put(f"/api/runs/{run['id']}/assets/{small['id']}",
                         files={"file": ("a.pdf", io.BytesIO(_pdf(1000)), "application/pdf")})
    assert (r.status_code, r.json()["detail"]) == (
        413, "This would take the files of this run past its 2 MB limit.")


# --- copying a version's files ---

COPY_SENTENCE = "This version's files are over the 2 MB limit, so it can't be copied."


def _version_with_3_mb(admin_client, db):
    course = admin_client.post("/api/courses", json={"slug": "cp", "name": "C", "description": ""}).json()
    v1 = admin_client.post(f"/api/courses/{course['id']}/versions", json={"label": "L", "info_md": ""}).json()
    for name in ("a.png", "b.png", "c.png"):
        admin_client.post(f"/api/versions/{v1['id']}/assets",
                          files={"file": (name, io.BytesIO(b"x" * MB), "image/png")})
    set_site(db, max_total_mb=2)  # lowered afterwards: nothing is deleted (D11)
    return course, v1


def test_version_copy_over_the_limit(admin_client, db):
    course, v1 = _version_with_3_mb(admin_client, db)
    r = admin_client.post(f"/api/courses/{course['id']}/versions",
                          json={"label": "L2", "info_md": "", "copy_assets_from": v1["id"]})
    assert (r.status_code, r.json()["detail"]) == (400, COPY_SENTENCE)


def test_version_duplicate_over_the_limit(admin_client, db):
    _, v1 = _version_with_3_mb(admin_client, db)
    r = admin_client.post(f"/api/versions/{v1['id']}/duplicate", json={"label": "x"})
    assert (r.status_code, r.json()["detail"]) == (400, COPY_SENTENCE)
