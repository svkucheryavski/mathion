from mathion.models import Block, Course, CourseVersion, Item, Sequence


def _make_sequence(db):
    course = Course(slug="stats", name="Stats", description="")
    db.add(course)
    db.commit()
    version = CourseVersion(course_id=course.id, state="created", info_md="", info_html="")
    db.add(version)
    db.commit()
    block = Block(version_id=version.id, title="B1", slug="b1", order=1, info="")
    db.add(block)
    db.commit()
    seq = Sequence(block_id=block.id, title="S1", slug="s1", order=1)
    db.add(seq)
    db.commit()
    db.refresh(seq)
    return seq


def test_create_static_page(db):
    seq = _make_sequence(db)
    item = Item(sequence_id=seq.id, title="Introduction", slug="introduction", order=1, type="static_page", content_md="# Hello", content_html="<h1>Hello</h1>")
    db.add(item)
    db.commit()
    db.refresh(item)
    assert item.id is not None
    assert item.type == "static_page"


def test_create_video(db):
    seq = _make_sequence(db)
    item = Item(sequence_id=seq.id, title="Lecture", slug="lecture", order=1, type="video", video_url="https://youtube.com/watch?v=abc")
    db.add(item)
    db.commit()
    db.refresh(item)
    assert item.type == "video"


def test_create_quiz(db):
    seq = _make_sequence(db)
    item = Item(sequence_id=seq.id, title="Quiz 1", slug="quiz-1", order=1, type="quiz")
    db.add(item)
    db.commit()
    db.refresh(item)
    assert item.type == "quiz"


def test_create_interactive_app(db):
    seq = _make_sequence(db)
    item = Item(sequence_id=seq.id, title="Simulation", slug="simulation", order=1, type="interactive_app", script_url="https://example.com/app.js")
    db.add(item)
    db.commit()
    db.refresh(item)
    assert item.script_url == "https://example.com/app.js"


def _setup_sequence(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "slug": "b1", "info": ""}).json()
    seq = client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1", "slug": "s1"}).json()
    return seq, version


def test_api_create_static_page(client):
    seq, version = _setup_sequence(client)
    response = client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Intro", "slug": "intro", "type": "static_page", "content_md": "# Hello",
    })
    assert response.status_code == 201
    assert response.json()["type"] == "static_page"
    assert response.json()["order"] == 1


def test_api_create_video(client):
    seq, version = _setup_sequence(client)
    response = client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Lecture", "slug": "lecture", "type": "video", "video_url": "https://youtube.com/watch?v=abc",
    })
    assert response.status_code == 201
    assert response.json()["type"] == "video"


def test_api_list_items(client):
    seq, version = _setup_sequence(client)
    client.post(f"/api/sequences/{seq['id']}/items", json={"title": "I1", "slug": "i1", "type": "static_page", "content_md": "a"})
    client.post(f"/api/sequences/{seq['id']}/items", json={"title": "I2", "slug": "i2", "type": "video", "video_url": "https://example.com"})
    response = client.get(f"/api/sequences/{seq['id']}/items")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_api_create_video_without_video_url(client):
    """Creating a video item without video_url must return 422."""
    seq, version = _setup_sequence(client)
    response = client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Lecture", "slug": "lecture", "type": "video",
    })
    assert response.status_code == 422


def test_api_create_static_page_without_content_md(client):
    """Creating a static_page item without content_md must return 422."""
    seq, version = _setup_sequence(client)
    response = client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Intro", "slug": "intro", "type": "static_page",
    })
    assert response.status_code == 422


def test_api_patch_item_content_md_in_published_state(client):
    """content_md is in the published-editable set, so PATCH must succeed."""
    seq, version = _setup_sequence(client)
    item = client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Intro", "slug": "intro", "type": "static_page", "content_md": "# Old",
    }).json()
    # Need to publish: add a sequence to its block first (block already has 1 seq from _setup_sequence)
    client.post(f"/api/versions/{version['id']}/publish")
    resp = client.patch(f"/api/items/{item['id']}", json={"content_md": "# Updated"})
    assert resp.status_code == 200
    assert resp.json()["content_md"] == "# Updated"


def test_api_delete_item_in_created_state(client):
    seq, version = _setup_sequence(client)
    item = client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Intro", "slug": "intro", "type": "static_page", "content_md": "# Hello",
    }).json()
    resp = client.delete(f"/api/items/{item['id']}")
    assert resp.status_code == 204


def test_api_delete_item_in_published_state(client):
    """DELETE item in published version must return 409."""
    seq, version = _setup_sequence(client)
    item = client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Intro", "slug": "intro", "type": "static_page", "content_md": "# Hello",
    }).json()
    client.post(f"/api/versions/{version['id']}/publish")
    resp = client.delete(f"/api/items/{item['id']}")
    assert resp.status_code == 409


def test_api_list_items_nonexistent_sequence(client):
    """Listing items for a sequence that doesn't exist must return 404."""
    resp = client.get("/api/sequences/999/items")
    assert resp.status_code == 404


def test_api_duplicate_item_slug_within_sequence(client):
    """Creating two items with the same slug in the same sequence must return 409."""
    seq, version = _setup_sequence(client)
    client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "I1", "slug": "dup-slug", "type": "static_page", "content_md": "a",
    })
    resp = client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "I2", "slug": "dup-slug", "type": "static_page", "content_md": "b",
    })
    assert resp.status_code == 409


def test_api_patch_static_page_nullify_content_md_returns_422(client):
    """Patching a static_page to set content_md=None must return 422."""
    seq, version = _setup_sequence(client)
    item = client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Intro", "slug": "intro", "type": "static_page", "content_md": "# Hello",
    }).json()
    resp = client.patch(f"/api/items/{item['id']}", json={"content_md": None})
    assert resp.status_code == 422


def test_api_patch_video_nullify_video_url_returns_422(client):
    """Patching a video item to set video_url=None must return 422."""
    seq, version = _setup_sequence(client)
    item = client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Lecture", "slug": "lecture", "type": "video", "video_url": "https://example.com/v",
    }).json()
    resp = client.patch(f"/api/items/{item['id']}", json={"video_url": None})
    assert resp.status_code == 422


def test_api_patch_interactive_app_nullify_script_url_returns_422(client):
    """Patching an interactive_app item to set script_url=None must return 422."""
    seq, version = _setup_sequence(client)
    item = client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "App", "slug": "app", "type": "interactive_app", "script_url": "https://example.com/app.js",
    }).json()
    resp = client.patch(f"/api/items/{item['id']}", json={"script_url": None})
    assert resp.status_code == 422


def test_api_create_item_invalid_video_url(client):
    """Creating a video item with an invalid URL must return 422."""
    seq, version = _setup_sequence(client)
    resp = client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Lecture", "slug": "lecture", "type": "video", "video_url": "ftp://example.com/v",
    })
    assert resp.status_code == 422


def test_api_create_item_invalid_script_url(client):
    """Creating an interactive_app item with an invalid URL must return 422."""
    seq, version = _setup_sequence(client)
    resp = client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "App", "slug": "app", "type": "interactive_app", "script_url": "not-a-url",
    })
    assert resp.status_code == 422
