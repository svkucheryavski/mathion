from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from mathion.models import Block, Group, MiniProject, Run, Submission
from mathion.models_auth import User


def test_create_mini_project(admin_client, db, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(
        select(Block).where(Block.version_id == run_obj.version_id)
    ).scalars().first()

    response = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={
            "block_id": block.id,
            "assignment_md": "Write a report about descriptive statistics.",
            "hard_deadline": "2026-06-01T23:59:00Z",
            "resubmission_deadline": "2026-06-15T23:59:00Z",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["block_id"] == block.id
    assert body["is_published"] is False
    assert body["title"] == f"Mini project for Block {block.order}"
    assert "<p>" in body["assignment_html"]


def _create_mp(admin_client, db, seed_run_with_groups, **overrides):
    """Helper: create a mini-project with sensible defaults, return (run, mp)."""
    run, _, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    payload = {
        "block_id": block.id,
        "assignment_md": "Write a report.",
        "hard_deadline": "2026-06-01T23:59:00Z",
        "resubmission_deadline": "2026-06-15T23:59:00Z",
    }
    payload.update(overrides)
    mp = admin_client.post(f"/api/runs/{run['id']}/mini-projects", json=payload).json()
    return run, mp


def test_duplicate_block_409(admin_client, db, seed_run_with_groups):
    run, mp = _create_mp(admin_client, db, seed_run_with_groups)
    response = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={"block_id": mp["block_id"], "assignment_md": "x", "hard_deadline": "2026-06-01T23:59:00Z", "resubmission_deadline": "2026-06-15T23:59:00Z"},
    )
    assert response.status_code == 409


def test_create_requires_groups_enabled(admin_client, db, seed_publishable_version):
    course, _ = seed_publishable_version()
    run = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-12-31", "groups_enabled": False},
    ).json()
    block = db.execute(select(Block).where(Block.version_id == run["version_id"])).scalars().first()
    response = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={"block_id": block.id, "assignment_md": "x", "hard_deadline": "2026-06-01T23:59:00Z", "resubmission_deadline": "2026-06-15T23:59:00Z"},
    )
    assert response.status_code == 409


def test_publish_gate_requires_resubmission_deadline(admin_client, db, seed_run_with_groups):
    run, mp = _create_mp(admin_client, db, seed_run_with_groups, resubmission_deadline=None)
    response = admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    assert response.status_code == 409
    assert "resubmission_deadline" in response.json()["detail"]


def test_publish_succeeds(admin_client, db, seed_run_with_groups):
    run, mp = _create_mp(admin_client, db, seed_run_with_groups)
    response = admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    assert response.status_code == 200
    assert response.json()["is_published"] is True


def test_student_sees_only_published(auth_client, admin_client, db, seed_run_with_groups):
    run, mp = _create_mp(admin_client, db, seed_run_with_groups)
    # Before publish, student gets empty list (or 403 on direct GET)
    response = auth_client.get(f"/api/runs/{run['id']}/mini-projects")
    # auth_client is not enrolled — but list endpoint here doesn't enforce enrollment.
    # Filtered to is_published=True; mp is unpublished so visible list is empty.
    assert response.status_code == 200
    assert response.json() == []
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    response = auth_client.get(f"/api/runs/{run['id']}/mini-projects")
    assert len(response.json()) == 1


def test_delete_unpublished_no_force(admin_client, db, seed_run_with_groups):
    run, mp = _create_mp(admin_client, db, seed_run_with_groups)
    response = admin_client.delete(f"/api/mini-projects/{mp['id']}")
    assert response.status_code == 204


def test_patch_locked_assignment_md_409(admin_client, db, seed_run_with_groups):
    """Once first_submitted_at is set, assignment_md cannot change."""
    run, mp = _create_mp(admin_client, db, seed_run_with_groups)
    mp_obj = db.get(MiniProject, mp["id"])
    mp_obj.first_submitted_at = datetime.now(timezone.utc)
    db.commit()
    response = admin_client.patch(
        f"/api/mini-projects/{mp['id']}",
        json={"assignment_md": "Changed after lock"},
    )
    assert response.status_code == 409
    assert "assignment_md is locked" in response.json()["detail"]


def test_patch_locked_deadline_can_only_extend(admin_client, db, seed_run_with_groups):
    """After lock, deadlines may only be extended (new > old) and not nulled."""
    run, mp = _create_mp(admin_client, db, seed_run_with_groups)
    mp_obj = db.get(MiniProject, mp["id"])
    mp_obj.first_submitted_at = datetime.now(timezone.utc)
    db.commit()
    response = admin_client.patch(
        f"/api/mini-projects/{mp['id']}",
        json={"hard_deadline": "2026-05-01T23:59:00Z"},
    )
    assert response.status_code == 409
    assert "hard_deadline" in response.json()["detail"]


def test_force_delete_with_submissions(admin_client, db, seed_run_with_groups):
    """force=true deletes mini-project, cascades submissions, returns 204."""
    run, mp = _create_mp(admin_client, db, seed_run_with_groups)
    group = db.execute(select(Group).where(Group.run_id == run["id"])).scalars().first()
    user = db.execute(select(User).where(User.email == "alice@example.com")).scalar_one()
    mp_obj = db.get(MiniProject, mp["id"])
    mp_obj.first_submitted_at = datetime.now(timezone.utc)
    db.add(Submission(
        mini_project_id=mp["id"],
        group_id=group.id,
        submitted_by=user.id,
        submission_number=1,
        file_path="x.zip",
        file_size=1,
        is_late=False,
    ))
    db.commit()
    response = admin_client.delete(f"/api/mini-projects/{mp['id']}")
    assert response.status_code == 409
    response = admin_client.delete(f"/api/mini-projects/{mp['id']}?force=true")
    assert response.status_code == 204
    assert db.get(MiniProject, mp["id"]) is None
    assert db.execute(select(Submission).where(Submission.mini_project_id == mp["id"])).first() is None


def test_patch_soft_deadline_recomputes_is_late(admin_client, db, seed_run_with_groups):
    """Changing soft_deadline updates is_late on existing submissions."""
    run, mp = _create_mp(admin_client, db, seed_run_with_groups)
    group = db.execute(select(Group).where(Group.run_id == run["id"])).scalars().first()
    user = db.execute(select(User).where(User.email == "alice@example.com")).scalar_one()
    submitted = datetime(2026, 5, 10, 12, 0, tzinfo=timezone.utc)
    sub = Submission(
        mini_project_id=mp["id"],
        group_id=group.id,
        submitted_by=user.id,
        submission_number=1,
        submitted_at=submitted,
        file_path="x.zip",
        file_size=1,
        is_late=False,
    )
    db.add(sub); db.commit()
    new_soft = (submitted - timedelta(days=1)).isoformat().replace("+00:00", "Z")
    response = admin_client.patch(
        f"/api/mini-projects/{mp['id']}",
        json={"soft_deadline": new_soft},
    )
    assert response.status_code == 200
    db.refresh(sub)
    assert sub.is_late is True


def test_disabled_version_blocks_student_list(admin_client, auth_client, db, seed_run_with_groups):
    """Student-path GET on a run pinned to a disabled version returns 403."""
    run, mp = _create_mp(admin_client, db, seed_run_with_groups)
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    admin_client.post(f"/api/versions/{run['version_id']}/disable")
    response = auth_client.get(f"/api/runs/{run['id']}/mini-projects")
    assert response.status_code == 403
