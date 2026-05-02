"""Bulk roster operation tests — POST /students/bulk-delete and bulk-move."""

import pytest


def _make_run(admin_client, seed_publishable_version, groups_enabled=True):
    course, _ = seed_publishable_version()
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
