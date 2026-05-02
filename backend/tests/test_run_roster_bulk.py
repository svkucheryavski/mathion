"""Bulk roster operation tests — POST /students/bulk-delete and bulk-move."""


def _make_run(admin_client, seed_publishable_version, groups_enabled=True, slug="stats", name="Stats"):
    course, _ = seed_publishable_version(slug=slug, name=name)
    return admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={
            "title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01",
            "groups_enabled": groups_enabled,
        },
    ).json()


def _add_student(admin_client, run_id, email, group_id=None):
    body = {"email": email}
    if group_id is not None:
        body["group_id"] = group_id
    return admin_client.post(f"/api/runs/{run_id}/students", json=body).json()


def _make_group(admin_client, run_id, name):
    return admin_client.post(f"/api/runs/{run_id}/groups", json={"name": name}).json()


# ---- bulk-delete -----------------------------------------------------------

def test_bulk_delete_requires_admin_or_teacher(admin_client, auth_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    response = auth_client.post(
        f"/api/runs/{run['id']}/students/bulk-delete", json={"user_ids": [1]}
    )
    assert response.status_code == 403


def test_bulk_delete_returns_404_for_missing_run(admin_client):
    response = admin_client.post(
        "/api/runs/9999/students/bulk-delete", json={"user_ids": [1]}
    )
    assert response.status_code == 404


def test_bulk_delete_rejects_empty_and_oversize_lists(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    r1 = admin_client.post(f"/api/runs/{run['id']}/students/bulk-delete", json={"user_ids": []})
    assert r1.status_code == 422
    r2 = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-delete",
        json={"user_ids": list(range(201))},
    )
    assert r2.status_code == 422


def test_bulk_delete_rejects_duplicates(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-delete",
        json={"user_ids": [1, 1, 2]},
    )
    assert response.status_code == 422
    assert "duplicates" in response.text


def test_bulk_delete_happy_path_with_enrollment_cascade(admin_client, db, seed_publishable_version):
    """3 students removed; 2 had no other run on the course (enrollment deactivated);
    1 also exists on a sibling run on the same course (enrollment stays active).

    Uses two runs on the SAME published version — exercises the cross-run
    sibling check (run.id-level), not the cross-version branch. The
    cross-version branch is locked by existing single-DELETE tests in
    test_run_roster.py.
    """
    from mathion.models_auth import StudentEnrollment

    course, _ = seed_publishable_version()
    run1 = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R1", "start_date": "2026-01-01", "end_date": "2026-06-01"},
    ).json()
    run2 = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R2", "start_date": "2026-07-01", "end_date": "2026-12-01"},
    ).json()

    a = _add_student(admin_client, run1["id"], "a@example.com")
    b = _add_student(admin_client, run1["id"], "b@example.com")
    c = _add_student(admin_client, run1["id"], "c@example.com")
    # c also enrolled on run2 (sibling run on the same course).
    _add_student(admin_client, run2["id"], "c@example.com")

    response = admin_client.post(
        f"/api/runs/{run1['id']}/students/bulk-delete",
        json={"user_ids": [a["user_id"], b["user_id"], c["user_id"]]},
    )
    assert response.status_code == 207
    body = response.json()
    assert len(body["results"]) == 3
    assert all(r["status"] == "ok" for r in body["results"])
    assert {r["user_id"] for r in body["results"]} == {a["user_id"], b["user_id"], c["user_id"]}

    db.expire_all()
    # a and b had only run1 → enrollment deactivated.
    for sid in [a["user_id"], b["user_id"]]:
        enr = db.query(StudentEnrollment).filter_by(
            user_id=sid, version_id=run1["version_id"]
        ).one()
        assert enr.is_active is False
    # c also has run2 → enrollment for run1's version stays active.
    enr_c = db.query(StudentEnrollment).filter_by(
        user_id=c["user_id"], version_id=run1["version_id"]
    ).one()
    assert enr_c.is_active is True


def test_bulk_delete_mixed_results(admin_client, seed_publishable_version):
    """Some user_ids are in the run, some aren't — per-row results reflect both."""
    run = _make_run(admin_client, seed_publishable_version)
    a = _add_student(admin_client, run["id"], "a@example.com")
    b = _add_student(admin_client, run["id"], "b@example.com")
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-delete",
        json={"user_ids": [a["user_id"], 99999, b["user_id"]]},
    )
    assert response.status_code == 207
    by_uid = {r["user_id"]: r for r in response.json()["results"]}
    assert by_uid[a["user_id"]]["status"] == "ok"
    assert by_uid[b["user_id"]]["status"] == "ok"
    assert by_uid[99999]["status"] == "error"
    assert by_uid[99999]["detail"] == "Student not in run"


def test_bulk_delete_returns_207_even_when_all_succeed(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    a = _add_student(admin_client, run["id"], "a@example.com")
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-delete",
        json={"user_ids": [a["user_id"]]},
    )
    assert response.status_code == 207


# ---- bulk-move pre-flight --------------------------------------------------

def test_bulk_move_requires_admin_or_teacher(admin_client, auth_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    response = auth_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [1], "group_id": 1},
    )
    assert response.status_code == 403


def test_bulk_move_returns_404_for_missing_run(admin_client):
    response = admin_client.post(
        "/api/runs/9999/students/bulk-move",
        json={"user_ids": [1], "group_id": 1},
    )
    assert response.status_code == 404


def test_bulk_move_returns_400_when_group_belongs_to_other_run(admin_client, seed_publishable_version):
    run1 = _make_run(admin_client, seed_publishable_version, slug="mv1", name="MV1")
    run2 = _make_run(admin_client, seed_publishable_version, slug="mv2", name="MV2")
    g_other = _make_group(admin_client, run2["id"], "Group X")
    a = _add_student(admin_client, run1["id"], "a@example.com")

    response = admin_client.post(
        f"/api/runs/{run1['id']}/students/bulk-move",
        json={"user_ids": [a["user_id"]], "group_id": g_other["id"]},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Group not in this run"


def test_bulk_move_returns_409_for_disabled_group(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    g = _make_group(admin_client, run["id"], "Group A")
    a = _add_student(admin_client, run["id"], "a@example.com")
    # Disable the group.
    admin_client.patch(f"/api/groups/{g['id']}", json={"is_disabled": True})

    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [a["user_id"]], "group_id": g["id"]},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Cannot move student into disabled group"


# ---- bulk-move per-row -----------------------------------------------------

def test_bulk_move_happy_path(admin_client, db, seed_publishable_version):
    from mathion.models import RunStudent

    run = _make_run(admin_client, seed_publishable_version)
    src = _make_group(admin_client, run["id"], "Source")
    dst = _make_group(admin_client, run["id"], "Dest")
    s1 = _add_student(admin_client, run["id"], "s1@example.com", group_id=src["id"])
    s2 = _add_student(admin_client, run["id"], "s2@example.com", group_id=src["id"])
    s3 = _add_student(admin_client, run["id"], "s3@example.com", group_id=src["id"])

    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={
            "user_ids": [s1["user_id"], s2["user_id"], s3["user_id"]],
            "group_id": dst["id"],
        },
    )
    assert response.status_code == 207
    results = response.json()["results"]
    assert len(results) == 3
    assert all(r["status"] == "ok" for r in results)
    assert all(r["group_id"] == dst["id"] for r in results)

    db.expire_all()
    for s in [s1, s2, s3]:
        rs = db.query(RunStudent).filter_by(run_id=run["id"], user_id=s["user_id"]).one()
        assert rs.group_id == dst["id"]


def test_bulk_move_already_in_target_is_noop(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    g = _make_group(admin_client, run["id"], "G")
    s = _add_student(admin_client, run["id"], "s@example.com", group_id=g["id"])

    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [s["user_id"]], "group_id": g["id"]},
    )
    assert response.status_code == 207
    results = response.json()["results"]
    assert results[0]["status"] == "ok"
    assert results[0]["group_id"] == g["id"]


def test_bulk_move_unassign_with_null_group(admin_client, db, seed_publishable_version):
    from mathion.models import RunStudent

    run = _make_run(admin_client, seed_publishable_version)
    g = _make_group(admin_client, run["id"], "G")
    s = _add_student(admin_client, run["id"], "s@example.com", group_id=g["id"])

    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [s["user_id"]], "group_id": None},
    )
    assert response.status_code == 207
    assert response.json()["results"][0]["status"] == "ok"
    assert response.json()["results"][0]["group_id"] is None

    db.expire_all()
    rs = db.query(RunStudent).filter_by(run_id=run["id"], user_id=s["user_id"]).one()
    assert rs.group_id is None


def test_bulk_move_unassigns_already_unassigned_student_as_noop(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    s = _add_student(admin_client, run["id"], "s@example.com")  # no group

    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [s["user_id"]], "group_id": None},
    )
    assert response.status_code == 207
    assert response.json()["results"][0]["status"] == "ok"


def test_bulk_move_user_not_in_run_returns_per_row_error(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    g = _make_group(admin_client, run["id"], "G")

    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [99999], "group_id": g["id"]},
    )
    assert response.status_code == 207
    row = response.json()["results"][0]
    assert row["status"] == "error"
    assert row["detail"] == "Student not in run"


def test_bulk_move_capacity_fills_mid_loop(admin_client, db, seed_publishable_version):
    """Target has room for 2; 4 movers requested. First 2 succeed, last 2 fail."""
    from mathion.models import RunStudent
    from mathion.models_auth import User

    run = _make_run(admin_client, seed_publishable_version)
    src = _make_group(admin_client, run["id"], "Source")
    dst = _make_group(admin_client, run["id"], "Dest")
    # Pre-fill dst with 8 students.
    for i in range(8):
        u = User(email=f"prefill{i}@example.com")
        db.add(u); db.flush()
        db.add(RunStudent(run_id=run["id"], user_id=u.id, group_id=dst["id"]))
    db.commit()

    movers = [_add_student(admin_client, run["id"], f"m{i}@example.com", group_id=src["id"])
              for i in range(4)]
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [m["user_id"] for m in movers], "group_id": dst["id"]},
    )
    assert response.status_code == 207
    results = response.json()["results"]
    assert results[0]["status"] == "ok"
    assert results[1]["status"] == "ok"
    assert results[2]["status"] == "error"
    assert results[2]["detail"] == "Group capacity reached"
    assert results[3]["status"] == "error"
    assert results[3]["detail"] == "Group capacity reached"

    # DB-state assertion: failed rows must remain in source, not silently
    # land in dst, even if the HTTP error message is right.
    db.expire_all()
    for m in movers[:2]:
        rs = db.query(RunStudent).filter_by(run_id=run["id"], user_id=m["user_id"]).one()
        assert rs.group_id == dst["id"]
    for m in movers[2:]:
        rs = db.query(RunStudent).filter_by(run_id=run["id"], user_id=m["user_id"]).one()
        assert rs.group_id == src["id"]


def test_bulk_move_noop_plus_fill_mix(admin_client, db, seed_publishable_version):
    """Regression-locking case from the spec.

    Target B has 9 students (room for 1). user_X is already in B; user_Y and
    user_Z are in C. Request: [user_X, user_Y, user_Z]. Expected:
    - user_X: ok no-op (B unchanged at 9)
    - user_Y: ok (B fills to 10)
    - user_Z: error capacity
    """
    from mathion.models import RunStudent
    from mathion.models_auth import User

    run = _make_run(admin_client, seed_publishable_version)
    b = _make_group(admin_client, run["id"], "B")
    c = _make_group(admin_client, run["id"], "C")

    # Pre-fill B with 8 students (we'll add user_X bringing it to 9).
    for i in range(8):
        u = User(email=f"bfill{i}@example.com")
        db.add(u); db.flush()
        db.add(RunStudent(run_id=run["id"], user_id=u.id, group_id=b["id"]))
    db.commit()

    user_x = _add_student(admin_client, run["id"], "x@example.com", group_id=b["id"])  # in B; B=9
    user_y = _add_student(admin_client, run["id"], "y@example.com", group_id=c["id"])  # in C
    user_z = _add_student(admin_client, run["id"], "z@example.com", group_id=c["id"])  # in C

    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={
            "user_ids": [user_x["user_id"], user_y["user_id"], user_z["user_id"]],
            "group_id": b["id"],
        },
    )
    assert response.status_code == 207
    results = response.json()["results"]
    assert results[0]["user_id"] == user_x["user_id"]
    assert results[0]["status"] == "ok"
    assert results[1]["user_id"] == user_y["user_id"]
    assert results[1]["status"] == "ok"
    assert results[2]["user_id"] == user_z["user_id"]
    assert results[2]["status"] == "error"
    assert results[2]["detail"] == "Group capacity reached"

    # DB-state invariant: B must end at exactly 10 (the cap), never above.
    # Locks the no-op-before-capacity ordering: if user_X were ever charged
    # against capacity, B would land at 11.
    db.expire_all()
    final_b_count = db.query(RunStudent).filter_by(group_id=b["id"]).count()
    assert final_b_count == 10


def test_bulk_move_mixed_results(admin_client, seed_publishable_version):
    """One success, one not-in-run, one already-in-target."""
    run = _make_run(admin_client, seed_publishable_version)
    g = _make_group(admin_client, run["id"], "G")
    a = _add_student(admin_client, run["id"], "a@example.com")  # ungrouped
    b = _add_student(admin_client, run["id"], "b@example.com", group_id=g["id"])  # already in G

    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [a["user_id"], 99999, b["user_id"]], "group_id": g["id"]},
    )
    assert response.status_code == 207
    by_uid = {r["user_id"]: r for r in response.json()["results"]}
    assert by_uid[a["user_id"]]["status"] == "ok"
    assert by_uid[a["user_id"]]["group_id"] == g["id"]
    assert by_uid[99999]["status"] == "error"
    assert by_uid[99999]["detail"] == "Student not in run"
    assert by_uid[b["user_id"]]["status"] == "ok"
    assert by_uid[b["user_id"]]["group_id"] == g["id"]


# ---- bulk-move auth + 422 (endpoint-level) ---------------------------------

def test_bulk_move_rejects_empty_and_oversize_lists(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    g = _make_group(admin_client, run["id"], "G")
    r1 = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [], "group_id": g["id"]},
    )
    assert r1.status_code == 422
    r2 = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": list(range(201)), "group_id": g["id"]},
    )
    assert r2.status_code == 422


def test_bulk_move_rejects_duplicates(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    g = _make_group(admin_client, run["id"], "G")
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [1, 1, 2], "group_id": g["id"]},
    )
    assert response.status_code == 422
    assert "duplicates" in response.text


def test_bulk_move_returns_207_even_when_all_succeed(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    g = _make_group(admin_client, run["id"], "G")
    a = _add_student(admin_client, run["id"], "a@example.com")
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [a["user_id"]], "group_id": g["id"]},
    )
    assert response.status_code == 207
