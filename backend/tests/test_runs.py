def _seed_minimal_publishable_version(admin_client, db):
    """Create a course + version with a single static-page item, then publish.
    Returns (course_dict, version_dict). Imported by other test files."""
    from mathion.models import Block, Sequence, Item
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = Block(version_id=version["id"], title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    db.add(Item(sequence_id=seq.id, title="I", slug="i", order=1, type="static_page",
                content_md="x", content_html="<p>x</p>"))
    db.commit()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    return course, version


def test_create_run_pins_to_newest_published_version(admin_client, db):
    course, version = _seed_minimal_publishable_version(admin_client, db)
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


def test_create_run_end_before_start_422(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    response = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "T", "start_date": "2026-06-01", "end_date": "2026-01-01"},
    )
    assert response.status_code == 422


def test_list_runs(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R1", "start_date": "2026-01-01", "end_date": "2026-06-01"})
    admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R2", "start_date": "2026-07-01", "end_date": "2026-12-01"})
    response = admin_client.get(f"/api/courses/{course['id']}/runs")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_get_run(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    response = admin_client.get(f"/api/runs/{run['id']}")
    assert response.status_code == 200
    assert response.json()["id"] == run["id"]


def test_patch_run_title(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "Old", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    response = admin_client.patch(f"/api/runs/{run['id']}", json={"title": "New"})
    assert response.status_code == 200
    assert response.json()["title"] == "New"


def test_patch_run_version_id_ignored(admin_client, db):
    """version_id in PATCH body must be silently ignored or rejected — never accepted."""
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    response = admin_client.patch(f"/api/runs/{run['id']}", json={"version_id": 999})
    assert response.status_code == 200
    assert response.json()["version_id"] == run["version_id"]


def test_delete_unpublished_run(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    response = admin_client.delete(f"/api/runs/{run['id']}")
    assert response.status_code == 204
    assert admin_client.get(f"/api/runs/{run['id']}").status_code == 404


def test_non_admin_cannot_create_run(auth_client, admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    response = auth_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"})
    assert response.status_code == 403
