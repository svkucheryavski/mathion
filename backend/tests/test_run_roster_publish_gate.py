"""§8 publish-gate tests: roster Add endpoints reject 409 on unpublished runs."""

import pytest
from sqlalchemy import select, delete

from mathion.models import Run, RunStudent, Group
from mathion.models_auth import User, NotificationLogEntry


# === Fixtures (local) ===

@pytest.fixture
def seeded_draft_run(admin_client, seed_publishable_version, db):
    """Run with is_published=False (no admin POST /publish call)."""
    course, _ = seed_publishable_version()
    resp = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "Draft Run", "start_date": "2026-01-01",
              "end_date": "2030-01-01", "groups_enabled": False},
    )
    assert resp.status_code == 201
    run_dict = resp.json()
    run = db.get(Run, run_dict["id"])
    return {"run": run}


@pytest.fixture
def seeded_published_run(admin_client, seed_publishable_version, db):
    """Run with is_published=True (calls /publish)."""
    course, _ = seed_publishable_version()
    resp = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "Pub Run", "start_date": "2026-01-01",
              "end_date": "2030-01-01", "groups_enabled": False},
    )
    run_dict = resp.json()
    # Run must have a teacher before publish
    admin_client.post(f"/api/runs/{run_dict['id']}/teachers",
                      json={"email": "teach@example.com"})
    pub = admin_client.post(f"/api/runs/{run_dict['id']}/publish")
    assert pub.status_code == 200
    run = db.get(Run, run_dict["id"])
    return {"run": run}


@pytest.fixture
def seeded_draft_run_with_student(admin_client, seed_publishable_version, db):
    """Draft run with a pre-enrolled student (created via direct ORM since
    the API gate would reject it). Needed for the PATCH (move) un-gated test."""
    course, _ = seed_publishable_version()
    resp = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "Draft Run", "start_date": "2026-01-01",
              "end_date": "2030-01-01", "groups_enabled": False},
    )
    run_dict = resp.json()
    run = db.get(Run, run_dict["id"])

    # Direct ORM insert to bypass the API gate
    user = User(email="alice@example.com", full_name="Alice")
    db.add(user); db.flush()
    rs = RunStudent(run_id=run.id, user_id=user.id, group_id=None)
    db.add(rs); db.commit()
    return {"run": run, "student": user, "run_student": rs}


# === Tests ===

def test_add_student_returns_409_on_draft(admin_client, seeded_draft_run):
    r = admin_client.post(
        f"/api/runs/{seeded_draft_run['run'].id}/students",
        json={"email": "anyone@example.com"},
    )
    assert r.status_code == 409
    body = r.json()
    assert body["detail"] == "Cannot add students to an unpublished run"
    assert body["error_code"] == "run_unpublished"  # TOP-LEVEL


def test_add_student_status_unchanged_on_published(admin_client, seeded_published_run):
    r = admin_client.post(
        f"/api/runs/{seeded_published_run['run'].id}/students",
        json={"email": "anyone@example.com"},
    )
    # 200 or 201 — whichever the existing happy path returns
    assert r.status_code in (200, 201)


def test_batch_add_returns_whole_call_409(admin_client, seeded_draft_run):
    r = admin_client.post(
        f"/api/runs/{seeded_draft_run['run'].id}/students/batch",
        json={"rows": [{"email": "a@x"}, {"email": "b@x"}]},
    )
    assert r.status_code == 409
    assert r.json()["error_code"] == "run_unpublished"


def test_constant_parity():
    from mathion.api.run_roster import RUN_UNPUBLISHED_ERROR_CODE
    assert RUN_UNPUBLISHED_ERROR_CODE == "run_unpublished"


def test_openapi_documents_409(client):
    schema = client.get("/openapi.json").json()
    path = schema["paths"]["/api/runs/{run_id}/students"]["post"]
    assert "409" in path["responses"]
    assert (path["responses"]["409"]["content"]["application/json"]["example"]
            == {"detail": "Cannot add students to an unpublished run",
                "error_code": "run_unpublished"})


def test_patch_group_move_still_works_on_draft(admin_client, seeded_draft_run_with_student):
    """Move endpoint is NOT gated — see §8 'Endpoints NOT gated'."""
    fixture = seeded_draft_run_with_student
    r = admin_client.patch(
        f"/api/runs/{fixture['run'].id}/students/{fixture['student'].id}",
        json={"group_id": None},
    )
    assert r.status_code == 200
