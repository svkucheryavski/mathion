from mathion.models import Block, Course, CourseVersion, Sequence


def _make_version(db):
    course = Course(slug="stats", name="Stats", description="")
    db.add(course)
    db.commit()
    version = CourseVersion(course_id=course.id, state="created", info_md="", info_html="")
    db.add(version)
    db.commit()
    db.refresh(version)
    return version


def test_create_block(db):
    version = _make_version(db)
    block = Block(version_id=version.id, title="Descriptive Stats", slug="descriptive-stats", order=1, info="Goals")
    db.add(block)
    db.commit()
    db.refresh(block)
    assert block.id is not None
    assert block.title == "Descriptive Stats"
    assert block.slug == "descriptive-stats"
    assert block.order == 1


def test_create_sequence(db):
    version = _make_version(db)
    block = Block(version_id=version.id, title="B1", slug="b1", order=1, info="")
    db.add(block)
    db.commit()
    seq = Sequence(block_id=block.id, title="Quantiles", slug="quantiles", order=1)
    db.add(seq)
    db.commit()
    db.refresh(seq)
    assert seq.id is not None
    assert seq.block_id == block.id


def test_cascade_delete_version_deletes_blocks(db):
    version = _make_version(db)
    block = Block(version_id=version.id, title="B1", slug="b1", order=1, info="")
    db.add(block)
    db.commit()
    seq = Sequence(block_id=block.id, title="S1", slug="s1", order=1)
    db.add(seq)
    db.commit()
    db.delete(version)
    db.commit()
    assert db.query(Block).count() == 0
    assert db.query(Sequence).count() == 0


def test_api_create_block(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    response = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "Descriptive Stats", "slug": "descriptive-stats", "info": "Learning goals",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Descriptive Stats"
    assert data["order"] == 1


def test_api_max_8_blocks(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    for i in range(8):
        resp = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
            "title": f"Block {i+1}", "slug": f"block-{i+1}", "info": "",
        })
        assert resp.status_code == 201
    resp = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "Block 9", "slug": "block-9", "info": "",
    })
    assert resp.status_code == 409


def test_api_cannot_add_block_to_published_version(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    response = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "New Block", "slug": "new-block", "info": "",
    })
    assert response.status_code == 409


def test_api_create_sequence(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "B1", "slug": "b1", "info": "",
    }).json()
    response = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "Quantiles", "slug": "quantiles",
    })
    assert response.status_code == 201
    assert response.json()["title"] == "Quantiles"
    assert response.json()["order"] == 1


def test_api_max_8_sequences(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "B1", "slug": "b1", "info": "",
    }).json()
    for i in range(8):
        resp = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={
            "title": f"Seq {i+1}", "slug": f"seq-{i+1}",
        })
        assert resp.status_code == 201
    resp = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "Seq 9", "slug": "seq-9",
    })
    assert resp.status_code == 409


def _setup_version(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    return version


def test_api_patch_block_title_in_created_state(admin_client):
    version = _setup_version(admin_client)
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Old Title", "slug": "b1", "info": ""}).json()
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": "New Title"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "New Title"


def test_api_patch_block_title_in_published_state(admin_client):
    """Title is in the allowed set for published state, so PATCH should succeed."""
    version = _setup_version(admin_client)
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Old Title", "slug": "b1", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1", "slug": "s1"}).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": "Updated Title"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Updated Title"


def test_api_patch_block_in_archived_state(admin_client):
    """PATCH block in archived version must return 409."""
    version = _setup_version(admin_client)
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "slug": "b1", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1", "slug": "s1"}).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    admin_client.post(f"/api/versions/{version['id']}/archive")
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": "Archived Title"})
    assert resp.status_code == 409


def test_api_delete_block_in_created_state(admin_client):
    version = _setup_version(admin_client)
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "slug": "b1", "info": ""}).json()
    resp = admin_client.delete(f"/api/blocks/{block['id']}")
    assert resp.status_code == 204


def test_api_delete_block_in_published_state(admin_client):
    """DELETE block in published version must return 409."""
    version = _setup_version(admin_client)
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "slug": "b1", "info": ""}).json()
    admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1", "slug": "s1"})
    admin_client.post(f"/api/versions/{version['id']}/publish")
    resp = admin_client.delete(f"/api/blocks/{block['id']}")
    assert resp.status_code == 409


def test_api_duplicate_block_slug_within_version(admin_client):
    """Creating two blocks with the same slug in the same version must fail."""
    version = _setup_version(admin_client)
    admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "slug": "dup-slug", "info": ""})
    resp = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B2", "slug": "dup-slug", "info": ""})
    assert resp.status_code == 409


def test_api_duplicate_sequence_slug_within_block(admin_client):
    """Creating two sequences with the same slug in the same block must return 409."""
    version = _setup_version(admin_client)
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "slug": "b1", "info": ""}).json()
    admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1", "slug": "dup-slug"})
    resp = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S2", "slug": "dup-slug"})
    assert resp.status_code == 409


def test_api_list_blocks_nonexistent_version(admin_client):
    """Listing blocks for a version that doesn't exist must return 404."""
    resp = admin_client.get("/api/versions/999/blocks")
    assert resp.status_code == 404
