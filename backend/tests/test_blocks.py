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


def test_api_create_block(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    response = client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "Descriptive Stats", "slug": "descriptive-stats", "info": "Learning goals",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Descriptive Stats"
    assert data["order"] == 1


def test_api_max_8_blocks(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    for i in range(8):
        resp = client.post(f"/api/versions/{version['id']}/blocks", json={
            "title": f"Block {i+1}", "slug": f"block-{i+1}", "info": "",
        })
        assert resp.status_code == 201
    resp = client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "Block 9", "slug": "block-9", "info": "",
    })
    assert resp.status_code == 409


def test_api_cannot_add_block_to_published_version(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    client.post(f"/api/versions/{version['id']}/publish")
    response = client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "New Block", "slug": "new-block", "info": "",
    })
    assert response.status_code == 409


def test_api_create_sequence(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "B1", "slug": "b1", "info": "",
    }).json()
    response = client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "Quantiles", "slug": "quantiles",
    })
    assert response.status_code == 201
    assert response.json()["title"] == "Quantiles"
    assert response.json()["order"] == 1


def test_api_max_8_sequences(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "B1", "slug": "b1", "info": "",
    }).json()
    for i in range(8):
        resp = client.post(f"/api/blocks/{block['id']}/sequences", json={
            "title": f"Seq {i+1}", "slug": f"seq-{i+1}",
        })
        assert resp.status_code == 201
    resp = client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "Seq 9", "slug": "seq-9",
    })
    assert resp.status_code == 409
