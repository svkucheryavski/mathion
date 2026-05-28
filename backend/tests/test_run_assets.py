import io
import os

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


def test_serve_asset_uses_inline_content_disposition(admin_client, seed_run_with_groups):
    """Serve endpoint must set Content-Disposition: inline so browsers render
    PDFs/images inline instead of forcing a download (T15 step 5)."""
    run, _, _ = seed_run_with_groups()
    admin_client.post(f"/api/runs/{run['id']}/assets",
                      files={"file": ("doc.pdf", io.BytesIO(b"%PDF-1.4\n"), "application/pdf")})
    response = admin_client.get(f"/api/runs/{run['id']}/assets/doc.pdf")
    assert response.status_code == 200
    assert response.headers["content-disposition"].startswith("inline")


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


# ---------------------------------------------------------------------------
# T2: PUT /api/runs/{rid}/assets/{aid} — replace endpoint
# ---------------------------------------------------------------------------


def test_put_replace_asset_success_same_extension(admin_client, seed_run_with_groups):
    """PUT replaces the file content. Preserves the original filename;
    incoming filename is ignored. Returns updated response with
    is_referenced + uploaded_by_email populated."""
    run, _, _ = seed_run_with_groups()
    initial = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("doc.pdf", io.BytesIO(b"%PDF-1.4\nINITIAL\n"), "application/pdf")},
    ).json()
    asset_id = initial["id"]
    initial_size = initial["file_size"]
    initial_uploaded_at = initial["uploaded_at"]

    new_content = b"%PDF-1.4\nREPLACED-LARGER-PAYLOAD\n"
    resp = admin_client.put(
        f"/api/runs/{run['id']}/assets/{asset_id}",
        files={"file": ("ignored-name.pdf", io.BytesIO(new_content), "application/pdf")},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == asset_id
    assert body["filename"] == "doc.pdf"  # original filename preserved
    assert body["file_size"] == len(new_content)
    assert body["file_size"] != initial_size
    assert body["uploaded_at"] != initial_uploaded_at  # touched
    assert body["uploaded_by_email"] == "admin@example.com"
    assert body["is_referenced"] is False  # no MPs reference it


def test_put_replace_case_insensitive_extension(admin_client, seed_run_with_groups):
    """Uppercase incoming extension (.PDF) replaces lowercase asset (.pdf)."""
    run, _, _ = seed_run_with_groups()
    initial = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("doc.pdf", io.BytesIO(b"%PDF-1.4\n"), "application/pdf")},
    ).json()

    resp = admin_client.put(
        f"/api/runs/{run['id']}/assets/{initial['id']}",
        files={"file": ("NEW.PDF", io.BytesIO(b"%PDF-1.4\nNEW\n"), "application/pdf")},
    )
    assert resp.status_code == 200, resp.text
    # filename preserved as the original lowercased version
    assert resp.json()["filename"] == "doc.pdf"


def test_put_replace_422_on_extension_mismatch(admin_client, seed_run_with_groups):
    """Different extension (.png replacing .pdf) → 422 with 'extension' in detail."""
    run, _, _ = seed_run_with_groups()
    initial = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("doc.pdf", io.BytesIO(b"%PDF-1.4\n"), "application/pdf")},
    ).json()

    resp = admin_client.put(
        f"/api/runs/{run['id']}/assets/{initial['id']}",
        files={"file": ("doc.png", io.BytesIO(b"\x89PNG\r\n"), "image/png")},
    )
    assert resp.status_code == 422
    assert "extension" in resp.json()["detail"].lower()


def test_put_replace_404_on_missing_asset_no_orphan_temp(
    admin_client, seed_run_with_groups, asset_tmpdir
):
    """PUT against a nonexistent asset_id → 404 BEFORE any disk write."""
    run, _, _ = seed_run_with_groups()
    # The asset storage dir is created lazily on first POST; snapshot the run dir
    # contents (if any) so we can confirm nothing new appears after a failed PUT.
    from mathion.api.helpers import run_asset_storage_dir
    dirpath = run_asset_storage_dir(run["id"])
    before = set(os.listdir(dirpath)) if os.path.isdir(dirpath) else set()

    resp = admin_client.put(
        f"/api/runs/{run['id']}/assets/999999",
        files={"file": ("ghost.pdf", io.BytesIO(b"%PDF-1.4\n"), "application/pdf")},
    )
    assert resp.status_code == 404

    after = set(os.listdir(dirpath)) if os.path.isdir(dirpath) else set()
    assert before == after, f"Orphan temp file(s): {after - before}"


def test_put_replace_404_on_cross_run_asset_id(
    admin_client, db, seed_run_with_groups, asset_tmpdir
):
    """User authorized on both runs; PUT against run_A with asset belonging to
    run_B → 404. Mirrors the ownership-check semantics of DELETE."""
    from mathion.models import Run

    from mathion.models import CourseVersion

    run_a, _, _ = seed_run_with_groups()
    # Create run_B on the same course (course already exists from the first seed).
    run_a_obj = db.get(Run, run_a["id"])
    version_obj = db.get(CourseVersion, run_a_obj.version_id)
    course_id = version_obj.course_id

    run_b_resp = admin_client.post(
        f"/api/courses/{course_id}/runs",
        json={
            "title": "R-B",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "groups_enabled": False,
        },
    )
    assert run_b_resp.status_code == 201, run_b_resp.text
    run_b = run_b_resp.json()

    # Upload an asset to run_B
    asset_b = admin_client.post(
        f"/api/runs/{run_b['id']}/assets",
        files={"file": ("doc.pdf", io.BytesIO(b"%PDF-1.4\n"), "application/pdf")},
    ).json()

    from mathion.api.helpers import run_asset_storage_dir
    dirpath_a = run_asset_storage_dir(run_a["id"])
    before = set(os.listdir(dirpath_a)) if os.path.isdir(dirpath_a) else set()

    # PUT against run_A with run_B's asset_id
    resp = admin_client.put(
        f"/api/runs/{run_a['id']}/assets/{asset_b['id']}",
        files={"file": ("doc.pdf", io.BytesIO(b"%PDF-1.4\nNEW\n"), "application/pdf")},
    )
    assert resp.status_code == 404

    after = set(os.listdir(dirpath_a)) if os.path.isdir(dirpath_a) else set()
    assert before == after, f"Orphan temp file(s) in run_A dir: {after - before}"


def test_put_replace_403_on_unauthorized_user(
    admin_client, auth_client, seed_run_with_groups
):
    """User with no role on the run → 403 (auth_client is logged in as
    test@example.com, which has no role on the seeded run)."""
    run, _, _ = seed_run_with_groups()
    initial = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("doc.pdf", io.BytesIO(b"%PDF-1.4\n"), "application/pdf")},
    ).json()

    resp = auth_client.put(
        f"/api/runs/{run['id']}/assets/{initial['id']}",
        files={"file": ("doc.pdf", io.BytesIO(b"%PDF-1.4\nNEW\n"), "application/pdf")},
    )
    assert resp.status_code == 403


def test_put_replace_overwrites_file_content(admin_client, seed_run_with_groups):
    """File on disk is actually overwritten — GET serve returns the new bytes."""
    run, _, _ = seed_run_with_groups()
    initial = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("doc.pdf", io.BytesIO(b"INITIAL"), "application/pdf")},
    ).json()

    serve = admin_client.get(f"/api/runs/{run['id']}/assets/doc.pdf")
    assert serve.content == b"INITIAL"

    admin_client.put(
        f"/api/runs/{run['id']}/assets/{initial['id']}",
        files={"file": ("doc.pdf", io.BytesIO(b"REPLACED"), "application/pdf")},
    )

    serve2 = admin_client.get(f"/api/runs/{run['id']}/assets/doc.pdf")
    assert serve2.content == b"REPLACED"


def test_put_replace_preserves_RunAssetReference_rows(
    admin_client, db, seed_run_with_groups
):
    """Replace must NOT touch RunAssetReference rows: pre/post id-set equality
    + row count unchanged forbids delete-and-reinsert + orphan inserts."""
    from mathion.models import Block, Run, RunAssetReference
    from sqlalchemy import select as _select

    run, _, _ = seed_run_with_groups()
    asset = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("data.csv", io.BytesIO(b"a,b\n1,2\n"), "text/csv")},
    ).json()
    aid = asset["id"]

    # Seed creates one block; add a second so we can create 2 MPs (one per block).
    run_obj = db.get(Run, run["id"])
    block_a = db.execute(
        _select(Block).where(Block.version_id == run_obj.version_id)
    ).scalars().first()
    block_b = Block(
        version_id=run_obj.version_id, title="B2", slug="b2", order=2
    )
    db.add(block_b)
    db.commit()
    db.refresh(block_b)

    # Create 2 MPs that reference data.csv — the existing POST /mini-projects
    # path runs sync_run_asset_references automatically.
    for block_id, body_md in [
        (block_a.id, "See ![data](data.csv) for details."),
        (block_b.id, "Also references [data](data.csv)."),
    ]:
        mp_resp = admin_client.post(
            f"/api/runs/{run['id']}/mini-projects",
            json={
                "block_id": block_id,
                "assignment_md": body_md,
                "hard_deadline": "2026-06-01T23:59:00Z",
                "resubmission_deadline": "2026-06-15T23:59:00Z",
            },
        )
        assert mp_resp.status_code in (200, 201), mp_resp.text

    pre_ids = set(
        db.scalars(
            _select(RunAssetReference.id).where(RunAssetReference.run_asset_id == aid)
        ).all()
    )
    assert len(pre_ids) >= 2, f"Expected ≥2 refs, got {pre_ids}"

    admin_client.put(
        f"/api/runs/{run['id']}/assets/{aid}",
        files={"file": ("ignored.csv", io.BytesIO(b"a,b,c\n1,2,3\n"), "text/csv")},
    )

    post_ids = set(
        db.scalars(
            _select(RunAssetReference.id).where(RunAssetReference.run_asset_id == aid)
        ).all()
    )
    assert post_ids == pre_ids, "RunAssetReference.id set must be preserved"


def test_post_upload_413_on_oversize(admin_client, seed_run_with_groups, monkeypatch):
    """File larger than settings.max_file_size on POST → 413 (parity with PUT)."""
    from mathion.api import run_assets as _ra

    run, _, _ = seed_run_with_groups()
    monkeypatch.setattr(_ra.settings, "max_file_size", 10)

    resp = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("doc.pdf", io.BytesIO(b"X" * 100), "application/pdf")},
    )
    assert resp.status_code == 413


def test_post_upload_413_on_quota_exceeded(
    admin_client, seed_run_with_groups, monkeypatch
):
    """Upload that pushes the run's aggregate over max_course_size → 413 (parity with PUT)."""
    from mathion.api import run_assets as _ra

    run, _, _ = seed_run_with_groups()
    admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("first.pdf", io.BytesIO(b"X" * 30), "application/pdf")},
    )

    monkeypatch.setattr(_ra.settings, "max_course_size", 50)

    resp = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("second.pdf", io.BytesIO(b"X" * 40), "application/pdf")},
    )
    assert resp.status_code == 413


def test_put_replace_413_on_oversize(admin_client, seed_run_with_groups, monkeypatch):
    """File larger than settings.max_file_size → 413.

    Targets `mathion.api.run_assets.settings` (the alias the endpoint
    actually reads). Necessary because `test_main_spa.py` does
    `importlib.reload(mathion.config)` which rebinds
    `mathion.config.settings` to a new instance while leaving the
    run_assets module's bound reference pointing at the old one.
    """
    # Import the alias the endpoint actually uses
    from mathion.api import run_assets as _ra

    run, _, _ = seed_run_with_groups()
    initial = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("doc.pdf", io.BytesIO(b"%PDF-1.4\n"), "application/pdf")},
    ).json()

    monkeypatch.setattr(_ra.settings, "max_file_size", 10)

    resp = admin_client.put(
        f"/api/runs/{run['id']}/assets/{initial['id']}",
        files={"file": ("doc.pdf", io.BytesIO(b"X" * 100), "application/pdf")},
    )
    assert resp.status_code == 413


def test_put_replace_413_on_quota_delta_exceeded(
    admin_client, seed_run_with_groups, monkeypatch
):
    """Replacement that pushes the run's aggregate over max_course_size → 413.

    Targets `mathion.api.run_assets.settings` for the same reason as
    test_put_replace_413_on_oversize above.
    """
    from mathion.api import run_assets as _ra

    run, _, _ = seed_run_with_groups()
    initial = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("doc.pdf", io.BytesIO(b"X" * 10), "application/pdf")},
    ).json()

    monkeypatch.setattr(_ra.settings, "max_course_size", 50)

    # Replacing 10-byte file with 200-byte file → delta +190 > 50 → 413
    resp = admin_client.put(
        f"/api/runs/{run['id']}/assets/{initial['id']}",
        files={"file": ("doc.pdf", io.BytesIO(b"X" * 200), "application/pdf")},
    )
    assert resp.status_code == 413


# ---------------------------------------------------------------------------
# T3: DELETE force-flag role-boundary lock-down tests
# ---------------------------------------------------------------------------
#
# The existing DELETE endpoint at backend/mathion/api/run_assets.py:180-213
# already enforces `require_course_admin_for_run` when force=true (line
# 190-191). These tests lock the contract that the gate distinguishes
# force=true (course-admin-only) from non-force (run-teacher allowed).


def _create_referenced_asset(admin_client, db, run, filename):
    """Helper: upload asset and create one MP that references it. Returns asset dict."""
    from mathion.models import Block, Run
    from sqlalchemy import select as _select

    asset = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": (filename, io.BytesIO(b"%PDF-1.4\n"), "application/pdf")},
    ).json()

    run_obj = db.get(Run, run["id"])
    block = db.execute(
        _select(Block).where(Block.version_id == run_obj.version_id)
    ).scalars().first()
    mp_resp = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={
            "block_id": block.id,
            "assignment_md": f"See [ref]({filename}).",
            "hard_deadline": "2026-06-01T23:59:00Z",
            "resubmission_deadline": "2026-06-15T23:59:00Z",
        },
    )
    assert mp_resp.status_code in (200, 201), mp_resp.text
    return asset


def test_force_delete_referenced_by_run_teacher_403(
    admin_client, db, seed_run_with_groups
):
    """Run-teacher (not course-admin) DELETE ?force=true on referenced asset
    → 403. Locks the force-flag gate: only course-admins / superusers may
    force-delete a referenced asset."""
    run, _, _ = seed_run_with_groups()
    asset = _create_referenced_asset(admin_client, db, run, "ref.pdf")

    # seed_run_with_groups adds teach@example.com as a RunTeacher; that user
    # is NOT a CourseAdmin and NOT a superuser.
    teacher = _client_for(db, "teach@example.com")
    resp = teacher.delete(f"/api/runs/{run['id']}/assets/{asset['id']}?force=true")
    assert resp.status_code == 403


def test_delete_referenced_by_run_teacher_without_force_returns_409(
    admin_client, db, seed_run_with_groups
):
    """Run-teacher DELETE without force on referenced asset → 409 (existing
    semantics: non-force is allowed for run-teachers, but the referenced
    check returns 409 because the asset has refs)."""
    run, _, _ = seed_run_with_groups()
    asset = _create_referenced_asset(admin_client, db, run, "ref2.pdf")

    teacher = _client_for(db, "teach@example.com")
    resp = teacher.delete(f"/api/runs/{run['id']}/assets/{asset['id']}")
    assert resp.status_code == 409


def test_force_delete_by_course_admin_cascades_RunAssetReference(
    admin_client, db, seed_run_with_groups
):
    """Force-delete by course-admin (superuser bypass) → 204 AND the asset's
    RunAssetReference rows are cascade-deleted (FK ON DELETE CASCADE)."""
    from mathion.models import RunAssetReference
    from sqlalchemy import func as _func, select as _select

    run, _, _ = seed_run_with_groups()
    asset = _create_referenced_asset(admin_client, db, run, "cascade.pdf")
    aid = asset["id"]

    pre_count = db.scalar(
        _select(_func.count(RunAssetReference.id)).where(
            RunAssetReference.run_asset_id == aid
        )
    )
    assert pre_count >= 1

    resp = admin_client.delete(f"/api/runs/{run['id']}/assets/{aid}?force=true")
    assert resp.status_code == 204

    post_count = db.scalar(
        _select(_func.count(RunAssetReference.id)).where(
            RunAssetReference.run_asset_id == aid
        )
    )
    assert post_count == 0
