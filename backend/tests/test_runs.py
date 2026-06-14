import io

from sqlalchemy import select

from mathion.models import Block, Run

from tests.conftest import NEAR_DEADLINE_ISO, FAR_DEADLINE_ISO


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
    # Publish (no students yet → groups-enabled gate is vacuously satisfied)
    first_publish = admin_client.post(f"/api/runs/{run['id']}/publish")
    assert first_publish.status_code == 200
    # Add an unassigned student via the API (gate allows group_id=None on add)
    add_resp = admin_client.post(
        f"/api/runs/{run['id']}/students", json={"email": "s@example.com"}
    )
    assert add_resp.status_code == 201
    # Unpublish so we can retry the publish-with-unassigned scenario
    unpub = admin_client.post(f"/api/runs/{run['id']}/unpublish")
    assert unpub.status_code == 200
    # Now republish should 409 because there's an unassigned student in a groups-enabled run
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


def test_teacher_cannot_publish(teacher_client, admin_client, db, teacher_user, seed_publishable_version):
    from mathion.models import RunTeacher
    course, _ = seed_publishable_version()
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id)); db.commit()
    response = teacher_client.post(f"/api/runs/{run['id']}/publish")
    assert response.status_code == 403


def test_delete_run_with_students_409(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    # Run is published; unpublish first
    admin_client.post(f"/api/runs/{run['id']}/unpublish")
    response = admin_client.delete(f"/api/runs/{run['id']}")
    assert response.status_code == 409
    assert "students" in response.json()["detail"].lower()


def test_force_delete_published_run(admin_client, db, seed_run_with_groups):
    run, ga, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    mp = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={"block_id": block.id, "assignment_md": "x",
              "hard_deadline": NEAR_DEADLINE_ISO,
              "resubmission_deadline": FAR_DEADLINE_ISO},
    ).json()
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    response = admin_client.delete(f"/api/runs/{run['id']}?force=true")
    assert response.status_code == 204
    db.expire_all()
    assert db.get(Run, run["id"]) is None


def test_lower_end_date_blocked_by_submissions(admin_client, student_client_for, db, seed_run_with_groups):
    """Cannot shorten run end_date once any submission exists."""
    run, _, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    mp = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={"block_id": block.id, "assignment_md": "x",
              "hard_deadline": NEAR_DEADLINE_ISO,
              "resubmission_deadline": FAR_DEADLINE_ISO},
    ).json()
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    alice = student_client_for("alice@example.com")
    alice.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    response = admin_client.patch(
        f"/api/runs/{run['id']}",
        json={"end_date": "2026-07-01"},
    )
    assert response.status_code == 409


def test_delete_run_with_submissions_no_force(admin_client, student_client_for, db, seed_run_with_groups):
    """Cannot delete (without force) a run that has submissions, even if unpublished."""
    run, _, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    mp = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={"block_id": block.id, "assignment_md": "x",
              "hard_deadline": NEAR_DEADLINE_ISO,
              "resubmission_deadline": FAR_DEADLINE_ISO},
    ).json()
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    alice = student_client_for("alice@example.com")
    alice.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    # Clear roster + unpublish so we hit the submissions gate, not the students/published gate
    students = admin_client.get(f"/api/runs/{run['id']}/students").json()
    for s in students:
        admin_client.delete(f"/api/runs/{run['id']}/students/{s['user_id']}")
    admin_client.post(f"/api/runs/{run['id']}/unpublish")
    response = admin_client.delete(f"/api/runs/{run['id']}")
    assert response.status_code == 409
    assert "submissions" in response.json()["detail"].lower()


def test_create_run_on_disabled_version_409(admin_client, db, seed_publishable_version):
    course, version = seed_publishable_version()
    response = admin_client.post(f"/api/versions/{version['id']}/disable")
    assert response.status_code == 200
    response = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R2", "start_date": "2026-01-01", "end_date": "2026-12-31"},
    )
    assert response.status_code == 409
    assert "disabled" in response.json()["detail"].lower()


def test_publish_run_on_disabled_version_409(admin_client, db, seed_publishable_version):
    """Cannot publish an unpublished run if its version was disabled."""
    course, version = seed_publishable_version()
    run = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-12-31"},
    ).json()
    # Add a teacher so publish-gate passes (teachers required by publish-gate)
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "teach@example.com"})
    # Disable version BEFORE publish
    admin_client.post(f"/api/versions/{version['id']}/disable")
    response = admin_client.post(f"/api/runs/{run['id']}/publish")
    assert response.status_code == 409
    assert "disabled" in response.json()["detail"].lower()


def test_extend_end_date_on_disabled_version_run_409(admin_client, db, seed_publishable_version):
    """Cannot extend end_date on a run pinned to a disabled version."""
    course, version = seed_publishable_version()
    run = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-30"},
    ).json()
    # Make run inactive (shortening) so disable succeeds, then disable
    admin_client.patch(f"/api/runs/{run['id']}", json={"end_date": "2026-04-01"})
    admin_client.post(f"/api/versions/{version['id']}/disable")
    # Now try to extend end_date forward — should 409
    response = admin_client.patch(f"/api/runs/{run['id']}", json={"end_date": "2026-12-31"})
    assert response.status_code == 409
    assert "disabled" in response.json()["detail"].lower()
