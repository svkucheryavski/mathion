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


def test_disabled_version_still_serves_historical(admin_client, db, seed_run_with_groups):
    """Disabled version still serves historical run assets.

    Under Semantics 2 ("no new work; reads still allowed"), a disabled version
    must keep historical reads working. We shorten the run's end_date to the
    past so the version can be disabled (no active runs invariant), then
    confirm the asset still serves.
    """
    run, _, _ = seed_run_with_groups()
    admin_client.post(f"/api/runs/{run['id']}/assets",
                      files={"file": ("d.csv", io.BytesIO(b"x"), "text/csv")})
    # Make run inactive (past end_date) so the version can be disabled
    admin_client.patch(f"/api/runs/{run['id']}", json={"end_date": "2026-01-01"})
    disable_resp = admin_client.post(f"/api/versions/{run['version_id']}/disable")
    assert disable_resp.status_code == 200
    response = admin_client.get(f"/api/runs/{run['id']}/assets/d.csv")
    assert response.status_code == 200
    assert response.content == b"x"


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


# ---------------------------------------------------------------------------
# T1: RunAssetResponse.uploaded_by_email
# ---------------------------------------------------------------------------


def test_list_assets_returns_uploaded_by_email(admin_client, seed_run_with_groups):
    """GET-list response includes uploaded_by_email for each asset."""
    run, _, _ = seed_run_with_groups()
    upload = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("doc.pdf", io.BytesIO(b"%PDF-1.4\n"), "application/pdf")},
    )
    assert upload.status_code == 201

    list_resp = admin_client.get(f"/api/runs/{run['id']}/assets")
    assert list_resp.status_code == 200
    rows = list_resp.json()
    assert len(rows) == 1
    # admin_client is logged in as the superuser fixture (admin@example.com)
    assert rows[0]["uploaded_by_email"] == "admin@example.com"


def test_list_assets_uploaded_by_email_null_when_user_deleted_set_null(
    admin_client, db, seed_run_with_groups
):
    """uploaded_by=NULL (SET NULL on user delete) → uploaded_by_email=None."""
    from mathion.models import RunAsset

    run, _, _ = seed_run_with_groups()
    a = RunAsset(
        run_id=run["id"],
        filename="orphan.pdf",
        file_size=10,
        mime_type="application/pdf",
        uploaded_by=None,
    )
    db.add(a)
    db.commit()

    list_resp = admin_client.get(f"/api/runs/{run['id']}/assets")
    assert list_resp.status_code == 200
    rows = list_resp.json()
    assert any(
        r["filename"] == "orphan.pdf" and r["uploaded_by_email"] is None for r in rows
    )


def test_list_assets_uploaded_by_email_null_when_user_row_missing(
    admin_client, db, seed_run_with_groups
):
    """uploaded_by points at a nonexistent user row → uploaded_by_email=None.

    Simulates a hard-delete that bypassed the SET NULL cascade (defensive
    guarantee). PRAGMA off needed because SQLite FK enforcement (on by
    default in conftest) would otherwise reject the insert.
    """
    from sqlalchemy import text

    from mathion.models import RunAsset

    run, _, _ = seed_run_with_groups()
    db.execute(text("PRAGMA foreign_keys=OFF"))
    try:
        a = RunAsset(
            run_id=run["id"],
            filename="ghost.pdf",
            file_size=10,
            mime_type="application/pdf",
            uploaded_by=99999,  # nonexistent user row
        )
        db.add(a)
        db.commit()
    finally:
        db.execute(text("PRAGMA foreign_keys=ON"))

    list_resp = admin_client.get(f"/api/runs/{run['id']}/assets")
    assert list_resp.status_code == 200
    rows = list_resp.json()
    assert any(
        r["filename"] == "ghost.pdf" and r["uploaded_by_email"] is None for r in rows
    )


def test_post_asset_returns_uploaded_by_email(admin_client, seed_run_with_groups):
    """POST handler populates uploaded_by_email in the response body."""
    run, _, _ = seed_run_with_groups()
    resp = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("hello.pdf", io.BytesIO(b"%PDF-1.4\n"), "application/pdf")},
    )
    assert resp.status_code == 201
    body = resp.json()
    # admin_client is logged in as the superuser fixture (admin@example.com)
    assert body["uploaded_by_email"] == "admin@example.com"
