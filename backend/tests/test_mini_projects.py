def test_create_mini_project(admin_client, db, seed_run_with_groups):
    from mathion.models import Block, Run

    run, _, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(
        __import__("sqlalchemy").select(Block).where(Block.version_id == run_obj.version_id)
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
    from sqlalchemy import select
    from mathion.models import Block, Run

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
    from mathion.models import Block
    from sqlalchemy import select
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
    assert any("resubmission_deadline" in v for v in response.json()["detail"])


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
