import io

from sqlalchemy import select

from mathion.models import Block, Run


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


def test_disable_group(admin_client, seed_run_with_groups):
    _, ga, _ = seed_run_with_groups()
    response = admin_client.patch(f"/api/groups/{ga['id']}", json={"is_disabled": True})
    assert response.status_code == 200
    assert response.json()["is_disabled"] is True


def test_cannot_add_student_to_disabled_group(admin_client, seed_run_with_groups):
    run, ga, _ = seed_run_with_groups()
    admin_client.patch(f"/api/groups/{ga['id']}", json={"is_disabled": True})
    response = admin_client.post(
        f"/api/runs/{run['id']}/students",
        json={"email": "new@example.com", "group_id": ga["id"]},
    )
    assert response.status_code == 409


def test_cannot_move_student_into_disabled_group(admin_client, seed_run_with_groups):
    run, ga, gb = seed_run_with_groups()
    # alice is in ga, bob is in gb. Disable gb. Try to move alice into gb.
    admin_client.patch(f"/api/groups/{gb['id']}", json={"is_disabled": True})
    students = admin_client.get(f"/api/runs/{run['id']}/students").json()
    alice = next(s for s in students if s["user_email"] == "alice@example.com")
    response = admin_client.patch(
        f"/api/runs/{run['id']}/students/{alice['user_id']}",
        json={"group_id": gb["id"]},
    )
    assert response.status_code == 409


def test_delete_group_with_submissions_409(admin_client, student_client_for, db, seed_run_with_groups):
    run, ga, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    mp = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={
            "block_id": block.id,
            "assignment_md": "x",
            "hard_deadline": "2026-06-01T23:59:00Z",
            "resubmission_deadline": "2026-06-15T23:59:00Z",
        },
    ).json()
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    student = student_client_for("alice@example.com")
    student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    # Remove alice from group so the student-count check passes
    students = admin_client.get(f"/api/runs/{run['id']}/students").json()
    alice = next(s for s in students if s["user_email"] == "alice@example.com")
    admin_client.delete(f"/api/runs/{run['id']}/students/{alice['user_id']}")
    # Now group is empty of students but has submissions
    response = admin_client.delete(f"/api/groups/{ga['id']}")
    assert response.status_code == 409
