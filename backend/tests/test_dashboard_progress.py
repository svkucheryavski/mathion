from fastapi.testclient import TestClient

from mathion.auth import request_pin, verify_pin
from mathion.models import RunTeacher
from mathion.models_auth import User
from mathion.main import app


def _publish_run(admin_client, db, course_id, groups_enabled=False):
    r = admin_client.post(f"/api/courses/{course_id}/runs", json={
        "title": "Run A",
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
        "groups_enabled": groups_enabled,
    }).json()
    # publish requires at least one teacher
    admin_client.post(f"/api/runs/{r['id']}/teachers", json={"email": "t@example.com"})
    admin_client.post(f"/api/runs/{r['id']}/publish")
    return r


def test_progress_404_for_nonexistent_run(admin_client):
    r = admin_client.get("/api/runs/99999/dashboard/progress")
    assert r.status_code == 404


def test_progress_403_for_unrelated_user(client, db, seed_publishable_version, admin_client):
    course, version = seed_publishable_version()
    run = _publish_run(admin_client, db, course["id"])

    other = User(email="other@example.com", full_name="Other")
    db.add(other); db.commit()
    raw = request_pin(db, other.email)
    tok = verify_pin(db, other.email, raw, duration_days=7)
    c = TestClient(app)
    c.cookies.set("session_token", tok)
    c.headers.update({"X-Requested-With": "mathion"})

    r = c.get(f"/api/runs/{run['id']}/dashboard/progress")
    assert r.status_code == 403


def test_progress_200_for_admin(admin_client, seed_publishable_version, db):
    course, version = seed_publishable_version()
    run = _publish_run(admin_client, db, course["id"])
    r = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress")
    assert r.status_code == 200


def test_progress_200_for_run_teacher(admin_client, seed_publishable_version, db, teacher_user, teacher_client):
    course, version = seed_publishable_version()
    run = _publish_run(admin_client, db, course["id"])
    db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
    db.commit()
    r = teacher_client.get(f"/api/runs/{run['id']}/dashboard/progress")
    assert r.status_code == 200
