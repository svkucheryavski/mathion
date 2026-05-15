def _setup_course(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "c1", "name": "C", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    return course, version


def test_reorder_blocks(admin_client):
    course, version = _setup_course(admin_client)
    b1 = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "info": ""}).json()
    b2 = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B2", "info": ""}).json()
    response = admin_client.post(f"/api/versions/{version['id']}/blocks/reorder", json={
        "order": [{"id": b2["id"], "order": 1}, {"id": b1["id"], "order": 2}],
    })
    assert response.status_code == 200
    blocks = admin_client.get(f"/api/versions/{version['id']}/blocks").json()
    assert blocks[0]["id"] == b2["id"]
    assert blocks[1]["id"] == b1["id"]


def test_reorder_blocks_published_blocked(admin_client):
    course, version = _setup_course(admin_client)
    b1 = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{b1['id']}/sequences", json={"title": "S"}).json()
    admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "I", "type": "static_page", "content_md": "hello"})
    admin_client.post(f"/api/versions/{version['id']}/publish")
    response = admin_client.post(f"/api/versions/{version['id']}/blocks/reorder", json={
        "order": [{"id": b1["id"], "order": 1}],
    })
    assert response.status_code == 409


def test_reorder_sequences(admin_client):
    course, version = _setup_course(admin_client)
    b = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "info": ""}).json()
    s1 = admin_client.post(f"/api/blocks/{b['id']}/sequences", json={"title": "S1"}).json()
    s2 = admin_client.post(f"/api/blocks/{b['id']}/sequences", json={"title": "S2"}).json()
    response = admin_client.post(f"/api/blocks/{b['id']}/sequences/reorder", json={
        "order": [{"id": s2["id"], "order": 1}, {"id": s1["id"], "order": 2}],
    })
    assert response.status_code == 200


def test_reorder_items(admin_client):
    course, version = _setup_course(admin_client)
    b = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "info": ""}).json()
    s = admin_client.post(f"/api/blocks/{b['id']}/sequences", json={"title": "S"}).json()
    i1 = admin_client.post(f"/api/sequences/{s['id']}/items", json={"title": "I1", "type": "quiz"}).json()
    i2 = admin_client.post(f"/api/sequences/{s['id']}/items", json={"title": "I2", "type": "quiz"}).json()
    response = admin_client.post(f"/api/sequences/{s['id']}/items/reorder", json={
        "order": [{"id": i2["id"], "order": 1}, {"id": i1["id"], "order": 2}],
    })
    assert response.status_code == 200


def test_reorder_questions(admin_client):
    course, version = _setup_course(admin_client)
    b = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "info": ""}).json()
    s = admin_client.post(f"/api/blocks/{b['id']}/sequences", json={"title": "S"}).json()
    item = admin_client.post(f"/api/sequences/{s['id']}/items", json={"title": "Quiz", "type": "quiz"}).json()
    q1 = admin_client.post(f"/api/items/{item['id']}/questions", json={"text_md": "Q1", "type": "single_choice"}).json()
    q2 = admin_client.post(f"/api/items/{item['id']}/questions", json={"text_md": "Q2", "type": "single_choice"}).json()
    response = admin_client.post(f"/api/items/{item['id']}/questions/reorder", json={
        "order": [{"id": q2["id"], "order": 1}, {"id": q1["id"], "order": 2}],
    })
    assert response.status_code == 200


def test_reorder_options(admin_client):
    course, version = _setup_course(admin_client)
    b = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "info": ""}).json()
    s = admin_client.post(f"/api/blocks/{b['id']}/sequences", json={"title": "S"}).json()
    item = admin_client.post(f"/api/sequences/{s['id']}/items", json={"title": "Quiz", "type": "quiz"}).json()
    q = admin_client.post(f"/api/items/{item['id']}/questions", json={"text_md": "Q?", "type": "single_choice"}).json()
    o1 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": True}).json()
    o2 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "B", "is_correct": False}).json()
    response = admin_client.post(f"/api/questions/{q['id']}/options/reorder", json={
        "order": [{"id": o2["id"], "order": 1}, {"id": o1["id"], "order": 2}],
    })
    assert response.status_code == 200


def test_reorder_sequences_verify_order(admin_client):
    """Verify reorder actually changes the DB order."""
    course, version = _setup_course(admin_client)
    b = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "info": ""}).json()
    s1 = admin_client.post(f"/api/blocks/{b['id']}/sequences", json={"title": "S1"}).json()
    s2 = admin_client.post(f"/api/blocks/{b['id']}/sequences", json={"title": "S2"}).json()
    admin_client.post(f"/api/blocks/{b['id']}/sequences/reorder", json={
        "order": [{"id": s2["id"], "order": 1}, {"id": s1["id"], "order": 2}],
    })
    seqs = admin_client.get(f"/api/blocks/{b['id']}/sequences").json()
    assert seqs[0]["id"] == s2["id"]
    assert seqs[1]["id"] == s1["id"]


def test_reorder_blocks_duplicate_order_rejected(admin_client):
    """Duplicate order values should be rejected."""
    course, version = _setup_course(admin_client)
    b1 = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "info": ""}).json()
    b2 = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B2", "info": ""}).json()
    response = admin_client.post(f"/api/versions/{version['id']}/blocks/reorder", json={
        "order": [{"id": b1["id"], "order": 1}, {"id": b2["id"], "order": 1}],
    })
    assert response.status_code == 400


def test_reorder_blocks_partial_list_rejected(admin_client):
    """Reorder must include all children."""
    course, version = _setup_course(admin_client)
    b1 = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "info": ""}).json()
    admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B2", "info": ""})
    response = admin_client.post(f"/api/versions/{version['id']}/blocks/reorder", json={
        "order": [{"id": b1["id"], "order": 1}],
    })
    assert response.status_code == 400
