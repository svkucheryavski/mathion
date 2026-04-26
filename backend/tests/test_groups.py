def _make_run(admin_client, seed_publishable_version, groups_enabled=True):
    course, _ = seed_publishable_version()
    return admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={
            "title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01",
            "groups_enabled": groups_enabled,
        },
    ).json()


def test_create_group(admin_client, db, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    response = admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "Team A"})
    assert response.status_code == 201
    assert response.json()["name"] == "Team A"


def test_create_group_duplicate_name_409(admin_client, db, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "Team A"})
    response = admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "Team A"})
    assert response.status_code == 409


def test_list_groups(admin_client, db, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "A"})
    admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "B"})
    response = admin_client.get(f"/api/runs/{run['id']}/groups")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_patch_group_name(admin_client, db, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    g = admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "Old"}).json()
    response = admin_client.patch(f"/api/groups/{g['id']}", json={"name": "New"})
    assert response.status_code == 200
    assert response.json()["name"] == "New"


def test_delete_empty_group(admin_client, db, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    g = admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "G"}).json()
    response = admin_client.delete(f"/api/groups/{g['id']}")
    assert response.status_code == 204


def test_delete_non_empty_group_409(admin_client, db, seed_publishable_version):
    from mathion.models import Group, RunStudent
    from mathion.models_auth import User
    run = _make_run(admin_client, seed_publishable_version)
    g = Group(run_id=run["id"], name="G")
    db.add(g); db.flush()
    u = User(email="s@example.com")
    db.add(u); db.flush()
    db.add(RunStudent(run_id=run["id"], user_id=u.id, group_id=g.id))
    db.commit()
    response = admin_client.delete(f"/api/groups/{g.id}")
    assert response.status_code == 409


def test_teacher_can_create_group(teacher_client, admin_client, db, teacher_user, seed_publishable_version):
    from mathion.models import RunTeacher
    run = _make_run(admin_client, seed_publishable_version)
    db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
    db.commit()
    response = teacher_client.post(f"/api/runs/{run['id']}/groups", json={"name": "G"})
    assert response.status_code == 201


def test_unrelated_user_cannot_create_group(auth_client, admin_client, db, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    response = auth_client.post(f"/api/runs/{run['id']}/groups", json={"name": "G"})
    assert response.status_code == 403
