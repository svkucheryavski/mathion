def _make_run(admin_client, seed_publishable_version, groups_enabled=False):
    course, _ = seed_publishable_version()
    return admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={
            "title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01",
            "groups_enabled": groups_enabled,
        },
    ).json()


def test_add_student_creates_user_and_enrollment(admin_client, db, seed_publishable_version):
    from mathion.models_auth import StudentEnrollment, User
    run = _make_run(admin_client, seed_publishable_version)
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


def test_add_student_with_group(admin_client, db, seed_publishable_version):
    from mathion.models import Group
    run = _make_run(admin_client, seed_publishable_version, groups_enabled=True)
    g = Group(run_id=run["id"], name="A")
    db.add(g); db.commit(); db.refresh(g)
    response = admin_client.post(
        f"/api/runs/{run['id']}/students", json={"email": "a@example.com", "group_id": g.id}
    )
    assert response.status_code == 201
    assert response.json()["group_id"] == g.id


def test_group_capacity_enforced_at_10(admin_client, db, seed_publishable_version):
    from mathion.models import Group, RunStudent
    from mathion.models_auth import User
    run = _make_run(admin_client, seed_publishable_version, groups_enabled=True)
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


def test_list_students(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "a@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "b@example.com"})
    response = admin_client.get(f"/api/runs/{run['id']}/students")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_patch_student_change_group(admin_client, db, seed_publishable_version):
    from mathion.models import Group
    run = _make_run(admin_client, seed_publishable_version, groups_enabled=True)
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


def test_remove_student_deactivates_enrollment_when_no_other_run(admin_client, db, seed_publishable_version):
    from mathion.models_auth import StudentEnrollment
    run = _make_run(admin_client, seed_publishable_version)
    s = admin_client.post(
        f"/api/runs/{run['id']}/students", json={"email": "x@example.com"}
    ).json()
    response = admin_client.delete(f"/api/runs/{run['id']}/students/{s['user_id']}")
    assert response.status_code == 204
    enrollment = db.query(StudentEnrollment).filter_by(
        user_id=s["user_id"], version_id=run["version_id"]
    ).one()
    assert enrollment.is_active is False


def test_remove_student_keeps_enrollment_if_other_run_exists(admin_client, db, seed_publishable_version):
    from mathion.models_auth import StudentEnrollment
    course, _ = seed_publishable_version()
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


def test_add_student_writes_run_enrolled_notification(admin_client, db, seed_publishable_version):
    from mathion.models_auth import NotificationLogEntry
    run = _make_run(admin_client, seed_publishable_version)
    admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "a@example.com"})
    rows = db.query(NotificationLogEntry).filter_by(kind="run_enrolled").all()
    assert len(rows) == 1
    assert rows[0].payload["run_id"] == run["id"]


def test_unrelated_user_cannot_add_student(auth_client, admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    response = auth_client.post(f"/api/runs/{run['id']}/students", json={"email": "x@example.com"})
    assert response.status_code == 403


def test_remove_student_keeps_enrollment_with_two_other_runs(admin_client, db, seed_publishable_version):
    """Regression: scalar_one_or_none would raise MultipleResultsFound when the
    user is in 2+ other runs on the same course. We use first()+limit(1)."""
    from mathion.models_auth import StudentEnrollment
    course, _ = seed_publishable_version()
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


def test_batch_add_auto_creates_groups(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version, groups_enabled=True)
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/batch",
        json={"rows": [
            {"name": "Alice", "email": "alice@example.com", "group": "Team A"},
            {"name": "Bob",   "email": "bob@example.com",   "group": "Team B"},
        ]},
    )
    assert response.status_code == 207
    body = response.json()
    assert len(body["results"]) == 2
    assert all(r["status"] == "added" for r in body["results"])
    groups = admin_client.get(f"/api/runs/{run['id']}/groups").json()
    assert {g["name"] for g in groups} == {"Team A", "Team B"}


def test_batch_add_per_row_errors_do_not_abort(admin_client, db, seed_publishable_version):
    from mathion.models import Group, RunStudent
    from mathion.models_auth import User
    run = _make_run(admin_client, seed_publishable_version, groups_enabled=True)
    g = Group(run_id=run["id"], name="Full")
    db.add(g); db.flush()
    for i in range(10):
        u = User(email=f"f{i}@example.com")
        db.add(u); db.flush()
        db.add(RunStudent(run_id=run["id"], user_id=u.id, group_id=g.id))
    db.commit()
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/batch",
        json={"rows": [
            {"email": "ok@example.com", "group": "OK"},
            {"email": "fail@example.com", "group": "Full"},
        ]},
    )
    assert response.status_code == 207
    body = response.json()
    assert body["results"][0]["status"] == "added"
    assert body["results"][1]["status"] == "error"


def test_batch_add_no_group_field(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version, groups_enabled=False)
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/batch",
        json={"rows": [{"email": "x@example.com"}]},
    )
    assert response.status_code == 207
    assert response.json()["results"][0]["status"] == "added"


def test_batch_savepoint_rolls_back_auto_group_on_failure(admin_client, db, seed_publishable_version):
    """Regression: when enroll_user_in_run raises mid-row, a group auto-created
    in the same row must roll back with the savepoint — no orphan groups."""
    from mathion.models import Group
    course, version = seed_publishable_version()
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01",
              "groups_enabled": True}).json()

    # Disable the version so enroll_user_in_run will raise 403.
    admin_client.post(f"/api/versions/{version['id']}/disable")

    # Single row with a brand-new group name. Enrollment will fail → savepoint
    # must roll back the auto-created group.
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/batch",
        json={"rows": [{"email": "x@example.com", "group": "Brand New Group"}]},
    )
    assert response.status_code == 207
    assert response.json()["results"][0]["status"] == "error"

    # Critical: no orphan group remains
    groups = db.query(Group).filter_by(run_id=run["id"]).all()
    assert len(groups) == 0, f"Expected no groups, found: {[g.name for g in groups]}"


def test_batch_add_to_disabled_group_per_row_error(admin_client, seed_run_with_groups):
    """Batch add to a disabled group produces a per-row error, not a global failure."""
    run, ga, _ = seed_run_with_groups()
    # Disable Group A
    admin_client.patch(f"/api/groups/{ga['id']}", json={"is_disabled": True})
    # Batch upload: one row pointing at the disabled group, one pointing at a new group
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/batch",
        json={"rows": [
            {"email": "ren@example.com", "group": "Group A"},
            {"email": "stim@example.com", "group": "Group C"},  # new group, OK
        ]},
    )
    assert response.status_code == 207
    body = response.json()
    rows = body["results"]
    # First row error, second row added
    error_row = next(r for r in rows if r["email"] == "ren@example.com")
    ok_row = next(r for r in rows if r["email"] == "stim@example.com")
    assert error_row["status"] == "error"
    assert "disabled" in error_row["detail"].lower()
    assert ok_row["status"] == "added"
