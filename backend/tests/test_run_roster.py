from tests.test_runs import _seed_minimal_publishable_version


def _make_run(admin_client, db, groups_enabled=False):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    return admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={
            "title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01",
            "groups_enabled": groups_enabled,
        },
    ).json()


def test_add_student_creates_user_and_enrollment(admin_client, db):
    from mathion.models_auth import StudentEnrollment, User
    run = _make_run(admin_client, db)
    response = admin_client.post(
        f"/api/runs/{run['id']}/students", json={"email": "alice@example.com"}
    )
    assert response.status_code == 201
    assert response.json()["user_email"] == "alice@example.com"
    user = db.query(User).filter_by(email="alice@example.com").one()
    enrollment = db.query(StudentEnrollment).filter_by(
        user_id=user.id, version_id=run["version_id"]
    ).one()
    assert enrollment.is_active is True


def test_add_student_with_group(admin_client, db):
    from mathion.models import Group
    run = _make_run(admin_client, db, groups_enabled=True)
    g = Group(run_id=run["id"], name="A")
    db.add(g); db.commit(); db.refresh(g)
    response = admin_client.post(
        f"/api/runs/{run['id']}/students", json={"email": "a@example.com", "group_id": g.id}
    )
    assert response.status_code == 201
    assert response.json()["group_id"] == g.id


def test_group_capacity_enforced_at_10(admin_client, db):
    from mathion.models import Group, RunStudent
    from mathion.models_auth import User
    run = _make_run(admin_client, db, groups_enabled=True)
    g = Group(run_id=run["id"], name="A")
    db.add(g); db.flush()
    for i in range(10):
        u = User(email=f"u{i}@example.com")
        db.add(u); db.flush()
        db.add(RunStudent(run_id=run["id"], user_id=u.id, group_id=g.id))
    db.commit()
    response = admin_client.post(
        f"/api/runs/{run['id']}/students", json={"email": "overflow@example.com", "group_id": g.id}
    )
    assert response.status_code == 409


def test_list_students(admin_client, db):
    run = _make_run(admin_client, db)
    admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "a@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "b@example.com"})
    response = admin_client.get(f"/api/runs/{run['id']}/students")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_patch_student_change_group(admin_client, db):
    from mathion.models import Group
    run = _make_run(admin_client, db, groups_enabled=True)
    g1 = Group(run_id=run["id"], name="A"); db.add(g1)
    g2 = Group(run_id=run["id"], name="B"); db.add(g2)
    db.commit(); db.refresh(g1); db.refresh(g2)
    s = admin_client.post(
        f"/api/runs/{run['id']}/students", json={"email": "x@example.com", "group_id": g1.id}
    ).json()
    response = admin_client.patch(
        f"/api/runs/{run['id']}/students/{s['user_id']}", json={"group_id": g2.id}
    )
    assert response.status_code == 200
    assert response.json()["group_id"] == g2.id


def test_remove_student_deactivates_enrollment_when_no_other_run(admin_client, db):
    from mathion.models_auth import StudentEnrollment
    run = _make_run(admin_client, db)
    s = admin_client.post(
        f"/api/runs/{run['id']}/students", json={"email": "x@example.com"}
    ).json()
    response = admin_client.delete(f"/api/runs/{run['id']}/students/{s['user_id']}")
    assert response.status_code == 204
    enrollment = db.query(StudentEnrollment).filter_by(
        user_id=s["user_id"], version_id=run["version_id"]
    ).one()
    assert enrollment.is_active is False


def test_remove_student_keeps_enrollment_if_other_run_exists(admin_client, db):
    from mathion.models_auth import StudentEnrollment
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run1 = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R1", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    run2 = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R2", "start_date": "2026-07-01", "end_date": "2026-12-01"}).json()
    s = admin_client.post(
        f"/api/runs/{run1['id']}/students", json={"email": "x@example.com"}
    ).json()
    admin_client.post(
        f"/api/runs/{run2['id']}/students", json={"email": "x@example.com"}
    )
    admin_client.delete(f"/api/runs/{run1['id']}/students/{s['user_id']}")
    enrollment = db.query(StudentEnrollment).filter_by(
        user_id=s["user_id"], version_id=run1["version_id"]
    ).one()
    assert enrollment.is_active is True


def test_add_student_writes_run_enrolled_notification(admin_client, db):
    from mathion.models_auth import NotificationLogEntry
    run = _make_run(admin_client, db)
    admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "a@example.com"})
    rows = db.query(NotificationLogEntry).filter_by(kind="run_enrolled").all()
    assert len(rows) == 1
    assert rows[0].payload["run_id"] == run["id"]


def test_unrelated_user_cannot_add_student(auth_client, admin_client, db):
    run = _make_run(admin_client, db)
    response = auth_client.post(f"/api/runs/{run['id']}/students", json={"email": "x@example.com"})
    assert response.status_code == 403


def test_remove_student_keeps_enrollment_with_two_other_runs(admin_client, db):
    """Regression: scalar_one_or_none would raise MultipleResultsFound when the
    user is in 2+ other runs on the same course. We use first()+limit(1)."""
    from mathion.models_auth import StudentEnrollment
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run1 = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R1", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    run2 = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R2", "start_date": "2026-07-01", "end_date": "2026-12-01"}).json()
    run3 = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R3", "start_date": "2027-01-01", "end_date": "2027-06-01"}).json()
    s = admin_client.post(f"/api/runs/{run1['id']}/students",
        json={"email": "x@example.com"}).json()
    admin_client.post(f"/api/runs/{run2['id']}/students", json={"email": "x@example.com"})
    admin_client.post(f"/api/runs/{run3['id']}/students", json={"email": "x@example.com"})

    # Remove from run1 — must not crash, must keep enrollment active.
    response = admin_client.delete(f"/api/runs/{run1['id']}/students/{s['user_id']}")
    assert response.status_code == 204
    enrollment = db.query(StudentEnrollment).filter_by(
        user_id=s["user_id"], version_id=run1["version_id"]
    ).one()
    assert enrollment.is_active is True
