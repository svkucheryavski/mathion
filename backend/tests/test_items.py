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


def _setup_sequence(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    return seq, version


def test_api_create_static_page(admin_client):
    seq, version = _setup_sequence(admin_client)
    response = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Intro", "type": "static_page", "content_md": "# Hello",
    })
    assert response.status_code == 201
    assert response.json()["type"] == "static_page"
    assert response.json()["order"] == 1


def test_api_create_video(admin_client):
    seq, version = _setup_sequence(admin_client)
    response = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Lecture", "type": "video", "video_url": "https://youtube.com/watch?v=abc",
    })
    assert response.status_code == 201
    assert response.json()["type"] == "video"


def test_api_list_items(admin_client):
    seq, version = _setup_sequence(admin_client)
    admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "I1", "type": "static_page", "content_md": "a"})
    admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "I2", "type": "video", "video_url": "https://example.com"})
    response = admin_client.get(f"/api/sequences/{seq['id']}/items")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_api_create_video_without_video_url(admin_client):
    """Creating a video item without video_url must return 422."""
    seq, version = _setup_sequence(admin_client)
    response = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Lecture", "type": "video",
    })
    assert response.status_code == 422


def test_api_create_static_page_without_content_md(admin_client):
    """Creating a static_page item without content_md must return 422."""
    seq, version = _setup_sequence(admin_client)
    response = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Intro", "type": "static_page",
    })
    assert response.status_code == 422


def test_api_patch_item_content_md_in_published_state(admin_client):
    """content_md is in the published-editable set, so PATCH must succeed."""
    seq, version = _setup_sequence(admin_client)
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Intro", "type": "static_page", "content_md": "# Old",
    }).json()
    # Need to publish: add a sequence to its block first (block already has 1 seq from _setup_sequence)
    admin_client.post(f"/api/versions/{version['id']}/publish")
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"content_md": "# Updated"})
    assert resp.status_code == 200
    assert resp.json()["content_md"] == "# Updated"


def test_api_delete_item_in_created_state(admin_client):
    seq, version = _setup_sequence(admin_client)
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Intro", "type": "static_page", "content_md": "# Hello",
    }).json()
    resp = admin_client.delete(f"/api/items/{item['id']}")
    assert resp.status_code == 204


def test_api_delete_item_in_published_state(admin_client):
    """DELETE item in published version must return 409."""
    seq, version = _setup_sequence(admin_client)
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Intro", "type": "static_page", "content_md": "# Hello",
    }).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    resp = admin_client.delete(f"/api/items/{item['id']}")
    assert resp.status_code == 409


def test_api_list_items_nonexistent_sequence(admin_client):
    """Listing items for a sequence that doesn't exist must return 404."""
    resp = admin_client.get("/api/sequences/999/items")
    assert resp.status_code == 404


def test_api_duplicate_item_slug_within_sequence(admin_client):
    """Creating two items whose titles produce the same slug in the same sequence must return 409."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Foo Bar", "type": "static_page", "content_md": "x",
    })
    resp = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Foo-Bar", "type": "static_page", "content_md": "y",
    })
    assert resp.status_code == 409
    assert "slug" in resp.json()["detail"].lower() or "title" in resp.json()["detail"].lower()


def test_api_patch_static_page_nullify_content_md_returns_422(admin_client):
    """Patching a static_page to set content_md=None must return 422."""
    seq, version = _setup_sequence(admin_client)
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Intro", "type": "static_page", "content_md": "# Hello",
    }).json()
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"content_md": None})
    assert resp.status_code == 422


def test_api_patch_video_nullify_video_url_returns_422(admin_client):
    """Patching a video item to set video_url=None must return 422."""
    seq, version = _setup_sequence(admin_client)
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Lecture", "type": "video", "video_url": "https://example.com/v",
    }).json()
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"video_url": None})
    assert resp.status_code == 422


def test_api_patch_interactive_app_nullify_script_url_returns_422(admin_client):
    """Patching an interactive_app item to set script_url=None must return 422."""
    seq, version = _setup_sequence(admin_client)
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "App", "type": "interactive_app", "script_url": "https://example.com/app.js",
    }).json()
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"script_url": None})
    assert resp.status_code == 422


def test_api_create_item_invalid_video_url(admin_client):
    """Creating a video item with an invalid URL must return 422."""
    seq, version = _setup_sequence(admin_client)
    resp = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Lecture", "type": "video", "video_url": "ftp://example.com/v",
    })
    assert resp.status_code == 422


def test_api_create_item_invalid_script_url(admin_client):
    """Creating an interactive_app item with an invalid URL must return 422."""
    seq, version = _setup_sequence(admin_client)
    resp = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "App", "type": "interactive_app", "script_url": "not-a-url",
    })
    assert resp.status_code == 422


def test_api_create_item_derives_slug_from_title(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    resp = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Confidence intervals (part 1)",
        "type": "static_page",
        "content_md": "hello",
    })
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["title"] == "Confidence intervals (part 1)"
    assert data["slug"] == "confidence-intervals-part-1"


def test_api_create_item_rejects_extra_slug_field(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    resp = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Item A",
        "slug": "item-a",
        "type": "static_page",
        "content_md": "x",
    })
    assert resp.status_code == 422, resp.text
    locs = [tuple(d["loc"]) for d in resp.json()["detail"]]
    assert ("body", "slug") in locs


def test_api_create_item_empty_slug_after_slugify(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    resp = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Привет",
        "type": "static_page",
        "content_md": "x",
    })
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_create_item_title_too_long_for_slug(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    resp = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "a" * 100,
        "type": "static_page",
        "content_md": "x",
    })
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_item_title_edit_re_derives_slug(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Old", "type": "static_page", "content_md": "x",
    }).json()
    assert item["slug"] == "old"
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"title": "Renamed Item"})
    assert resp.status_code == 200
    assert resp.json()["slug"] == "renamed-item"


def test_api_update_item_collision_via_autoflush_returns_409(admin_client):
    """update_item PATCH that (a) changes title to a colliding slug AND
    (b) includes content_md must return 409 even though autoflush during
    _process_content_md would otherwise fire the IntegrityError outside
    the commit-only try/except.

    The endpoint's explicit db.flush() right after slug assignment is
    what catches this — verify by exercising the exact path."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Foo Bar", "type": "static_page", "content_md": "x",
    })
    other = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Other", "type": "static_page", "content_md": "x",
    }).json()
    resp = admin_client.patch(f"/api/items/{other['id']}", json={
        "title": "Foo-Bar",  # also slugifies to foo-bar
        "content_md": "new content",  # forces _process_content_md to run
    })
    assert resp.status_code == 409, resp.text
    # Crucially NOT 500 — that would mean the IntegrityError escaped.


def test_api_update_item_info_only_does_not_re_derive_slug(admin_client):
    """content_md-only edit with title resent unchanged keeps slug stable."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Same Title", "type": "static_page", "content_md": "x",
    }).json()
    original_slug = item["slug"]
    resp = admin_client.patch(f"/api/items/{item['id']}", json={
        "title": "Same Title",
        "content_md": "new content",
    })
    assert resp.status_code == 200
    assert resp.json()["slug"] == original_slug
    assert resp.json()["content_md"] == "new content"


def test_api_update_item_equivalent_after_slugify_is_no_op_for_slug(admin_client):
    """Title 'Foo Bar' -> 'Foo Bar!' both slugify to 'foo-bar'; slug write is identical."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Foo Bar", "type": "static_page", "content_md": "x",
    }).json()
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"title": "Foo Bar!"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Foo Bar!"
    assert resp.json()["slug"] == "foo-bar"


def test_api_update_item_explicit_null_title_returns_422(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "I1", "type": "static_page", "content_md": "x",
    }).json()
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"title": None})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_item_rejects_extra_slug_field(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "I1", "type": "static_page", "content_md": "x",
    }).json()
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"title": "New", "slug": "rogue"})
    assert resp.status_code == 422
    locs = [tuple(d["loc"]) for d in resp.json()["detail"]]
    assert ("body", "slug") in locs


def test_api_update_item_unchanged_title_preserves_legacy_slug(admin_client, db):
    """Legacy custom slug preserved on unchanged-title PATCH (spec lines 56, 142)."""
    from mathion.models import Item
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item_resp = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "My Title", "type": "static_page", "content_md": "x",
    }).json()
    row = db.get(Item, item_resp["id"])
    row.slug = "legacy-custom-slug"
    db.commit()
    resp = admin_client.patch(f"/api/items/{item_resp['id']}", json={
        "title": "My Title",
        "content_md": "new content",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["slug"] == "legacy-custom-slug"


def test_api_update_item_empty_slug_after_slugify(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "I1", "type": "static_page", "content_md": "x",
    }).json()
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"title": "Привет"})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_item_title_too_long_for_slug(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "I1", "type": "static_page", "content_md": "x",
    }).json()
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"title": "a" * 100})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_item_title_edit_on_published_re_derives_slug(admin_client, db):
    """title is in _ITEM_EDITABLE_PUBLISHED, so published versions still re-derive."""
    from mathion.models import CourseVersion
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Old", "type": "static_page", "content_md": "x",
    }).json()
    v = db.get(CourseVersion, version["id"])
    v.state = "published"
    db.commit()
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"title": "Renamed On Published"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["slug"] == "renamed-on-published"


def test_api_update_item_missing_asset_rolls_back_flushed_slug(admin_client, db):
    """Codex R2 hazard: when slug changes (explicit db.flush() runs) AND
    content_md references a missing asset, _process_content_md raises
    422. The endpoint must rollback before re-raising so the flushed
    slug/title write doesn't persist in the (test) shared session."""
    from mathion.models import Item
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Original", "type": "static_page", "content_md": "x",
    }).json()
    original_slug = item["slug"]
    original_title = item["title"]
    # Title edit (triggers slug flush) + content_md referencing a
    # non-existent asset -> render_with_assets raises 422.
    resp = admin_client.patch(f"/api/items/{item['id']}", json={
        "title": "New Name",
        "content_md": "![missing](nonexistent-asset.png)",
    })
    assert resp.status_code == 422, resp.text
    db.expire_all()
    fresh = db.get(Item, item["id"])
    assert fresh.slug == original_slug
    assert fresh.title == original_title


def test_api_update_item_invariant_422_rolls_back_flushed_slug(admin_client, db):
    """Codex R1 hazard: when slug changes AND a subsequent type-invariant
    422 fires (e.g., content_md set to null on a static_page), the explicit
    db.flush() that committed the new slug to the session must be rolled
    back so the persisted row keeps its old slug/title. The endpoint adds
    db.rollback() before each invariant raise to enforce this."""
    from mathion.models import Item
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Original", "type": "static_page", "content_md": "x",
    }).json()
    original_slug = item["slug"]
    original_title = item["title"]
    # Edit title (which would change slug) AND set content_md to null (which violates
    # the static_page invariant). The 422 must fire AND the flushed slug/title must NOT persist.
    resp = admin_client.patch(f"/api/items/{item['id']}", json={
        "title": "New Name",
        "content_md": None,
    })
    assert resp.status_code == 422, resp.text
    # Verify persistence: re-read via a fresh DB query.
    db.expire_all()
    fresh = db.get(Item, item["id"])
    assert fresh.slug == original_slug
    assert fresh.title == original_title
