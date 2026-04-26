def test_create_run_pins_to_newest_published_version(admin_client, seed_publishable_version):
    course, version = seed_publishable_version()
    response = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "Spring 2026", "start_date": "2026-09-01", "end_date": "2026-12-15"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Spring 2026"
    assert data["version_id"] == version["id"]
    assert data["is_published"] is False
    assert data["groups_enabled"] is False


def test_create_run_no_published_version_409(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "x", "name": "X", "description": ""}).json()
    response = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "T", "start_date": "2026-01-01", "end_date": "2026-06-01"},
    )
    assert response.status_code == 409


def test_create_run_end_before_start_422(admin_client, seed_publishable_version):
    course, _ = seed_publishable_version()
    response = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "T", "start_date": "2026-06-01", "end_date": "2026-01-01"},
    )
    assert response.status_code == 422


def test_list_runs(admin_client, seed_publishable_version):
    course, _ = seed_publishable_version()
    admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R1", "start_date": "2026-01-01", "end_date": "2026-06-01"})
    admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R2", "start_date": "2026-07-01", "end_date": "2026-12-01"})
    response = admin_client.get(f"/api/courses/{course['id']}/runs")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_get_run(admin_client, seed_publishable_version):
    course, _ = seed_publishable_version()
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    response = admin_client.get(f"/api/runs/{run['id']}")
    assert response.status_code == 200
    assert response.json()["id"] == run["id"]


def test_patch_run_title(admin_client, seed_publishable_version):
    course, _ = seed_publishable_version()
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "Old", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    response = admin_client.patch(f"/api/runs/{run['id']}", json={"title": "New"})
    assert response.status_code == 200
    assert response.json()["title"] == "New"


def test_patch_run_version_id_ignored(admin_client, seed_publishable_version):
    """version_id in PATCH body must be silently ignored or rejected — never accepted."""
    course, _ = seed_publishable_version()
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    response = admin_client.patch(f"/api/runs/{run['id']}", json={"version_id": 999})
    assert response.status_code == 200
    assert response.json()["version_id"] == run["version_id"]


def test_delete_unpublished_run(admin_client, seed_publishable_version):
    course, _ = seed_publishable_version()
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    response = admin_client.delete(f"/api/runs/{run['id']}")
    assert response.status_code == 204
    assert admin_client.get(f"/api/runs/{run['id']}").status_code == 404


def test_non_admin_cannot_create_run(auth_client, seed_publishable_version):
    course, _ = seed_publishable_version()
    response = auth_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"})
    assert response.status_code == 403


def test_publish_run_no_teachers_409(admin_client, seed_publishable_version):
    course, _ = seed_publishable_version()
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    response = admin_client.post(f"/api/runs/{run['id']}/publish")
    assert response.status_code == 409
    assert "teacher" in response.json()["detail"].lower()


def test_publish_run_with_teacher_succeeds(admin_client, seed_publishable_version):
    course, _ = seed_publishable_version()
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    response = admin_client.post(f"/api/runs/{run['id']}/publish")
    assert response.status_code == 200
    assert response.json()["is_published"] is True


def test_publish_with_groups_enabled_unassigned_student_409(admin_client, seed_publishable_version):
    course, _ = seed_publishable_version()
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01",
              "groups_enabled": True}).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "s@example.com"})
    response = admin_client.post(f"/api/runs/{run['id']}/publish")
    assert response.status_code == 409


def test_publish_with_oversized_group_409(admin_client, db, seed_publishable_version):
    """Currently group capacity is enforced at 10 on add, so this guards against
    DB-level inconsistency (e.g., manual seeding) reaching publish."""
    from mathion.models import Group, RunStudent
    from mathion.models_auth import User
    course, _ = seed_publishable_version()
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01",
              "groups_enabled": True}).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    g = Group(run_id=run["id"], name="X")
    db.add(g); db.flush()
    for i in range(11):
        u = User(email=f"u{i}@example.com")
        db.add(u); db.flush()
        db.add(RunStudent(run_id=run["id"], user_id=u.id, group_id=g.id))
    db.commit()
    response = admin_client.post(f"/api/runs/{run['id']}/publish")
    assert response.status_code == 409


def test_unpublish_run(admin_client, seed_publishable_version):
    course, _ = seed_publishable_version()
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/publish")
    response = admin_client.post(f"/api/runs/{run['id']}/unpublish")
    assert response.status_code == 200
    assert response.json()["is_published"] is False


def test_delete_published_run_409(admin_client, seed_publishable_version):
    course, _ = seed_publishable_version()
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/publish")
    response = admin_client.delete(f"/api/runs/{run['id']}")
    assert response.status_code == 409


def test_patch_groups_enabled_after_publish_409(admin_client, seed_publishable_version):
    course, _ = seed_publishable_version()
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/publish")
    response = admin_client.patch(f"/api/runs/{run['id']}", json={"groups_enabled": True})
    assert response.status_code == 409


def test_publish_writes_run_published_notification_per_student(admin_client, db, seed_publishable_version):
    from mathion.models_auth import NotificationLogEntry
    course, _ = seed_publishable_version()
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "a@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "b@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/publish")
    rows = db.query(NotificationLogEntry).filter_by(kind="run_published").all()
    assert len(rows) == 2


def test_teacher_cannot_publish(teacher_client, admin_client, db, teacher_user, seed_publishable_version):
    from mathion.models import RunTeacher
    course, _ = seed_publishable_version()
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id)); db.commit()
    response = teacher_client.post(f"/api/runs/{run['id']}/publish")
    assert response.status_code == 403
