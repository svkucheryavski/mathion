import io

from mathion.auth import request_pin, verify_pin
from mathion.main import app
from tests.conftest import CSRFTestClient


def _client_for(db, email: str) -> CSRFTestClient:
    """Authenticate a CSRFTestClient as the user with the given email.

    Used to authenticate as users seeded by seed_run_with_groups (alice,
    bob, teach) without piling more fixtures into conftest.
    """
    raw_pin = request_pin(db, email)
    assert raw_pin is not None
    token = verify_pin(db, email, raw_pin, duration_days=7)
    c = CSRFTestClient(app)
    c.cookies.set("session_token", token)
    return c


def test_upload_run_asset(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    response = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("dataset.csv", io.BytesIO(b"a,b,c\n1,2,3"), "text/csv")},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["filename"] == "dataset.csv"
    assert body["file_size"] == len(b"a,b,c\n1,2,3")


def test_list_run_assets(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("a.csv", io.BytesIO(b"x"), "text/csv")},
    )
    admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("b.csv", io.BytesIO(b"y"), "text/csv")},
    )
    response = admin_client.get(f"/api/runs/{run['id']}/assets")
    assert response.status_code == 200
    assert {a["filename"] for a in response.json()} == {"a.csv", "b.csv"}


def test_duplicate_filename_409(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    admin_client.post(f"/api/runs/{run['id']}/assets",
                      files={"file": ("d.csv", io.BytesIO(b"x"), "text/csv")})
    response = admin_client.post(f"/api/runs/{run['id']}/assets",
                                 files={"file": ("d.csv", io.BytesIO(b"y"), "text/csv")})
    assert response.status_code == 409


def test_disallowed_extension(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    response = admin_client.post(f"/api/runs/{run['id']}/assets",
                                 files={"file": ("evil.exe", io.BytesIO(b"x"), "application/octet-stream")})
    assert response.status_code == 400


def test_delete_unreferenced(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    asset = admin_client.post(f"/api/runs/{run['id']}/assets",
                              files={"file": ("d.csv", io.BytesIO(b"x"), "text/csv")}).json()
    response = admin_client.delete(f"/api/runs/{run['id']}/assets/{asset['id']}")
    assert response.status_code == 204


def test_serve_asset_admin(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    admin_client.post(f"/api/runs/{run['id']}/assets",
                      files={"file": ("d.csv", io.BytesIO(b"hello"), "text/csv")})
    response = admin_client.get(f"/api/runs/{run['id']}/assets/d.csv")
    assert response.status_code == 200
    assert response.content == b"hello"


def test_non_member_cannot_serve(auth_client, admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    admin_client.post(f"/api/runs/{run['id']}/assets",
                      files={"file": ("d.csv", io.BytesIO(b"x"), "text/csv")})
    response = auth_client.get(f"/api/runs/{run['id']}/assets/d.csv")
    assert response.status_code == 403


def test_enrolled_student_can_serve(admin_client, db, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    admin_client.post(f"/api/runs/{run['id']}/assets",
                      files={"file": ("d.csv", io.BytesIO(b"hello"), "text/csv")})
    alice = _client_for(db, "alice@example.com")
    response = alice.get(f"/api/runs/{run['id']}/assets/d.csv")
    assert response.status_code == 200
    assert response.content == b"hello"


def test_run_teacher_can_serve(admin_client, db, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    admin_client.post(f"/api/runs/{run['id']}/assets",
                      files={"file": ("d.csv", io.BytesIO(b"hello"), "text/csv")})
    teach = _client_for(db, "teach@example.com")
    response = teach.get(f"/api/runs/{run['id']}/assets/d.csv")
    assert response.status_code == 200
    assert response.content == b"hello"


def test_disabled_version_blocks_serve(admin_client, db, seed_run_with_groups):
    """Run pinned to a disabled CourseVersion serves no assets — even to admins.

    Mirrors Phase 6 serve_asset behavior; a disabled version must block
    every actor uniformly.
    """
    run, _, _ = seed_run_with_groups()
    admin_client.post(f"/api/runs/{run['id']}/assets",
                      files={"file": ("d.csv", io.BytesIO(b"x"), "text/csv")})
    admin_client.post(f"/api/versions/{run['version_id']}/disable")
    response = admin_client.get(f"/api/runs/{run['id']}/assets/d.csv")
    assert response.status_code == 403


def test_delete_referenced_409_without_force(admin_client, db, seed_run_with_groups):
    """Cannot delete a run-asset that is referenced by a mini-project."""
    from mathion.models import Block, Run
    from sqlalchemy import select as _select
    run, _, _ = seed_run_with_groups()
    asset = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("data.csv", io.BytesIO(b"x,y\n1,2"), "text/csv")},
    ).json()
    run_obj = db.get(Run, run["id"])
    block = db.execute(_select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={"block_id": block.id,
              "assignment_md": "Use [data.csv](data.csv) for the analysis.",
              "hard_deadline": "2026-06-01T23:59:00Z",
              "resubmission_deadline": "2026-06-15T23:59:00Z"},
    )
    response = admin_client.delete(f"/api/runs/{run['id']}/assets/{asset['id']}")
    assert response.status_code == 409
    assert "referenced" in response.json()["detail"].lower()


def test_force_delete_referenced_as_admin(admin_client, db, seed_run_with_groups):
    """Force-delete (course-admin) succeeds even when referenced by a mini-project."""
    from mathion.models import Block, Run
    from sqlalchemy import select as _select
    run, _, _ = seed_run_with_groups()
    asset = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("data.csv", io.BytesIO(b"x,y\n1,2"), "text/csv")},
    ).json()
    run_obj = db.get(Run, run["id"])
    block = db.execute(_select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={"block_id": block.id,
              "assignment_md": "Use [data.csv](data.csv) for the analysis.",
              "hard_deadline": "2026-06-01T23:59:00Z",
              "resubmission_deadline": "2026-06-15T23:59:00Z"},
    )
    response = admin_client.delete(f"/api/runs/{run['id']}/assets/{asset['id']}?force=true")
    assert response.status_code == 204
