"""Tests for POST /api/runs/{run_id}/render — slice-A T1."""
import io
from fastapi import status


def _upload_asset(admin_client, run_id: int, filename: str, content: bytes = b"x") -> dict:
    r = admin_client.post(
        f"/api/runs/{run_id}/assets",
        files={"file": (filename, io.BytesIO(content), "image/png")},
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_run_render_rewrites_asset_refs(admin_client, seed_run_with_groups):
    """POST /api/runs/{rid}/render returns HTML with bare filename refs rewritten to /api/runs/{rid}/assets/{filename}."""
    run, _, _ = seed_run_with_groups()
    asset = _upload_asset(admin_client, run["id"], "diagram.png")
    r = admin_client.post(
        f"/api/runs/{run['id']}/render",
        json={"content_md": f"![diagram]({asset['filename']})"},
    )
    assert r.status_code == status.HTTP_200_OK, r.text
    html = r.json()["html"]
    assert f'src="/api/runs/{run["id"]}/assets/{asset["filename"]}"' in html


def test_run_render_admin_ok(admin_client, seed_run_with_groups):
    """Course-admin authenticated session: 200."""
    run, _, _ = seed_run_with_groups()
    r = admin_client.post(f"/api/runs/{run['id']}/render", json={"content_md": "hi"})
    assert r.status_code == status.HTTP_200_OK


def test_run_render_run_teacher_ok(teacher_client, seed_run_with_groups, admin_client):
    """Run-teacher authenticated session: 200 (require_run_admin_or_teacher dep).

    teacher_client authenticates teacher@example.com (conftest.py:121); seed_run_with_groups
    attaches teach@example.com (DIFFERENT email) at conftest.py:213, so we must POST
    /api/runs/{id}/teachers with teacher@example.com to grant the test session
    run-teacher rights before calling the endpoint.
    """
    run, _, _ = seed_run_with_groups()
    attach_r = admin_client.post(
        f"/api/runs/{run['id']}/teachers", json={"email": "teacher@example.com"}
    )
    assert attach_r.status_code in (200, 201), attach_r.text
    r = teacher_client.post(f"/api/runs/{run['id']}/render", json={"content_md": "hi"})
    assert r.status_code == status.HTTP_200_OK, r.text


def test_run_render_outsider_403(client, seed_run_with_groups):
    """Unauthenticated / non-member: 401 or 403."""
    run, _, _ = seed_run_with_groups()
    r = client.post(f"/api/runs/{run['id']}/render", json={"content_md": "hi"})
    assert r.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)


def test_run_render_authenticated_non_member_403(auth_client, seed_run_with_groups):
    """Authenticated user who is NEITHER course admin NOR run teacher: 403.

    Locks the authorization boundary distinct from the 401 path: a regression
    that allowed any authenticated user to render would slip past the
    unauthenticated test but fail here. `auth_client` is `test_user`
    (conftest.py:102) — plain user, no admin/teacher/student attachment.
    """
    run, _, _ = seed_run_with_groups()
    r = auth_client.post(f"/api/runs/{run['id']}/render", json={"content_md": "hi"})
    assert r.status_code == status.HTTP_403_FORBIDDEN, r.text


def test_run_render_422_on_missing_asset(admin_client, seed_run_with_groups):
    """422 lists the missing filenames in the detail message."""
    run, _, _ = seed_run_with_groups()
    r = admin_client.post(
        f"/api/runs/{run['id']}/render",
        json={"content_md": "![x](missing.png)"},
    )
    assert r.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "missing.png" in r.json()["detail"]


def test_run_render_no_reference_rows_created(admin_client, seed_run_with_groups, db):
    """Side-effect-free: rendering does NOT create RunAssetReference rows.

    Uses the `db` test fixture (the shared session) rather than a fresh
    SessionLocal, so the query sees the state seeded by this test — see
    test_run_roster_bulk.py:104 for the same pattern.
    """
    from mathion.models import RunAssetReference

    run, _, _ = seed_run_with_groups()
    asset = _upload_asset(admin_client, run["id"], "d.png")
    before = db.query(RunAssetReference).filter_by(run_asset_id=asset["id"]).count()
    r = admin_client.post(
        f"/api/runs/{run['id']}/render",
        json={"content_md": f"![]({asset['filename']})"},
    )
    # Assert 200 first so this test fails red when the endpoint is absent
    # (otherwise `before == after` would pass vacuously on 404).
    assert r.status_code == status.HTTP_200_OK, r.text
    after = db.query(RunAssetReference).filter_by(run_asset_id=asset["id"]).count()
    assert before == after
