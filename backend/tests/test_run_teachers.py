def _make_run(admin_client, seed_publishable_version):
    course, _ = seed_publishable_version()
    return admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"},
    ).json()


def test_add_teacher_creates_user_if_absent(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    response = admin_client.post(
        f"/api/runs/{run['id']}/teachers", json={"email": "newteacher@example.com"}
    )
    assert response.status_code == 201
    assert response.json()["user_email"] == "newteacher@example.com"


def test_add_teacher_writes_notification_log_row(admin_client, db, seed_publishable_version):
    from mathion.models_auth import NotificationLogEntry
    run = _make_run(admin_client, seed_publishable_version)
    admin_client.post(
        f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"}
    )
    rows = db.query(NotificationLogEntry).filter_by(kind="run_teacher_assigned").all()
    assert len(rows) == 1
    assert rows[0].payload["run_id"] == run["id"]


def test_list_teachers(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "a@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "b@example.com"})
    response = admin_client.get(f"/api/runs/{run['id']}/teachers")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_remove_teacher(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    teacher = admin_client.post(
        f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"}
    ).json()
    response = admin_client.delete(f"/api/runs/{run['id']}/teachers/{teacher['user_id']}")
    assert response.status_code == 204


def test_duplicate_add_409(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    response = admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    assert response.status_code == 409


def test_non_admin_cannot_add_teacher(auth_client, admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    response = auth_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "x@example.com"})
    assert response.status_code == 403


def test_teacher_can_list_but_not_add(teacher_client, admin_client, db, teacher_user, seed_publishable_version):
    from mathion.models import RunTeacher
    run = _make_run(admin_client, seed_publishable_version)
    db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
    db.commit()
    assert teacher_client.get(f"/api/runs/{run['id']}/teachers").status_code == 200
    assert teacher_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "x@example.com"}).status_code == 403
