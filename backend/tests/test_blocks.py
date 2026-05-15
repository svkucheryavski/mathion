from sqlalchemy import select

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
        "title": "Descriptive Stats", "info": "Learning goals",
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
            "title": f"Block {i+1}", "info": "",
        })
        assert resp.status_code == 201
    resp = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "Block 9", "info": "",
    })
    assert resp.status_code == 409


def test_api_cannot_add_block_to_published_version(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    response = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "New Block", "info": "",
    })
    assert response.status_code == 409


def test_api_create_sequence(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "B1", "info": "",
    }).json()
    response = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "Quantiles",
    })
    assert response.status_code == 201
    assert response.json()["title"] == "Quantiles"
    assert response.json()["order"] == 1


def test_api_max_8_sequences(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "B1", "info": "",
    }).json()
    for i in range(8):
        resp = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={
            "title": f"Seq {i+1}",
        })
        assert resp.status_code == 201
    resp = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "Seq 9",
    })
    assert resp.status_code == 409


def _setup_version(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    return version


def test_api_patch_block_title_in_created_state(admin_client):
    version = _setup_version(admin_client)
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Old Title", "info": ""}).json()
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": "New Title"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "New Title"


def test_api_patch_block_title_in_published_state(admin_client):
    """Title is in the allowed set for published state, so PATCH should succeed."""
    version = _setup_version(admin_client)
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Old Title", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": "Updated Title"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Updated Title"


def test_api_patch_block_in_archived_state(admin_client):
    """PATCH block in archived version must return 409."""
    version = _setup_version(admin_client)
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "I", "type": "static_page", "content_md": "hello"})
    admin_client.post(f"/api/versions/{version['id']}/publish")
    admin_client.post(f"/api/versions/{version['id']}/archive")
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": "Archived Title"})
    assert resp.status_code == 409


def test_api_delete_block_in_created_state(admin_client):
    version = _setup_version(admin_client)
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "info": ""}).json()
    resp = admin_client.delete(f"/api/blocks/{block['id']}")
    assert resp.status_code == 204


def test_api_delete_block_in_published_state(admin_client):
    """DELETE block in published version must return 409."""
    version = _setup_version(admin_client)
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "I", "type": "static_page", "content_md": "hello"})
    admin_client.post(f"/api/versions/{version['id']}/publish")
    resp = admin_client.delete(f"/api/blocks/{block['id']}")
    assert resp.status_code == 409


def test_api_duplicate_block_slug_within_version(admin_client):
    """Two titles that slugify to the same string must return 409 on the second."""
    version = _setup_version(admin_client)
    # "Foo Bar" and "Foo-Bar" both slugify to "foo-bar"
    first = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Foo Bar"})
    assert first.status_code == 201
    resp = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Foo-Bar"})
    assert resp.status_code == 409
    assert "slug" in resp.json()["detail"].lower() or "title" in resp.json()["detail"].lower()


def test_api_duplicate_sequence_slug_within_block(admin_client):
    """Creating two sequences whose titles slugify identically must return 409."""
    version = _setup_version(admin_client)
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "info": ""}).json()
    admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "Foo Bar"})
    resp = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "Foo-Bar"})
    assert resp.status_code == 409
    assert "slug" in resp.json()["detail"].lower() or "title" in resp.json()["detail"].lower()


def test_api_list_blocks_nonexistent_version(admin_client):
    """Listing blocks for a version that doesn't exist must return 404."""
    resp = admin_client.get("/api/versions/999/blocks")
    assert resp.status_code == 404


def test_create_block_renders_info_html(admin_client):
    version = _setup_version(admin_client)
    response = admin_client.post(
        f"/api/versions/{version['id']}/blocks",
        json={"title": "B1", "info": "Goal **A**"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["info"] == "Goal **A**"
    assert body["info_html"] == "<p>Goal <strong>A</strong></p>\n"


def test_update_block_re_renders_info_html(admin_client):
    version = _setup_version(admin_client)
    block = admin_client.post(
        f"/api/versions/{version['id']}/blocks",
        json={"title": "B1", "info": "old"},
    ).json()
    response = admin_client.patch(
        f"/api/blocks/{block['id']}",
        json={"info": "new **bold**"},
    )
    assert response.status_code == 200
    assert response.json()["info_html"] == "<p>new <strong>bold</strong></p>\n"


def test_delete_block_empty_succeeds(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "c", "name": "C", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(
        f"/api/versions/{version['id']}/blocks", json={"title": "B"}
    ).json()
    r = admin_client.delete(f"/api/blocks/{block['id']}")
    assert r.status_code == 204


def test_delete_block_with_sequences_blocked(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "c", "name": "C", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(
        f"/api/versions/{version['id']}/blocks", json={"title": "B"}
    ).json()
    admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S"})
    r = admin_client.delete(f"/api/blocks/{block['id']}")
    assert r.status_code == 409
    assert "remove its sequences first" in r.json()["detail"]


def test_delete_block_state_error_precedes_child_count(admin_client, db, seed_publishable_version):
    """On a published version (state forbids delete), the state error wins over child-count
    so the more actionable message surfaces."""
    from mathion.models import Block
    _, version = seed_publishable_version()
    block = db.execute(select(Block).where(Block.version_id == version["id"])).scalar_one()
    r = admin_client.delete(f"/api/blocks/{block.id}")
    assert r.status_code == 409
    assert "'created' state" in r.json()["detail"]
    assert "remove its sequences" not in r.json()["detail"]


def test_delete_sequence_empty_succeeds(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "c", "name": "C", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S"}).json()
    r = admin_client.delete(f"/api/sequences/{seq['id']}")
    assert r.status_code == 204


def test_delete_sequence_with_items_blocked(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "c", "name": "C", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S"}).json()
    admin_client.post(
        f"/api/sequences/{seq['id']}/items",
        json={"title": "I", "type": "static_page", "content_md": "x"},
    )
    r = admin_client.delete(f"/api/sequences/{seq['id']}")
    assert r.status_code == 409
    assert "remove its items first" in r.json()["detail"]


def test_delete_sequence_state_error_precedes_child_count(admin_client, db, seed_publishable_version):
    from mathion.models import Sequence
    seed_publishable_version()
    seq = db.execute(select(Sequence)).scalar()
    r = admin_client.delete(f"/api/sequences/{seq.id}")
    assert r.status_code == 409
    assert "'created' state" in r.json()["detail"]
    assert "remove its items" not in r.json()["detail"]


def test_api_create_block_derives_slug_from_title(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    response = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "Confidence intervals (part 1)",
    })
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["title"] == "Confidence intervals (part 1)"
    assert data["slug"] == "confidence-intervals-part-1"


def test_api_create_block_rejects_extra_slug_field(admin_client):
    """extra='forbid' rejects clients still sending slug."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    resp = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "Block A",
        "slug": "block-a",
    })
    assert resp.status_code == 422, resp.text
    # Pydantic v2 reports loc = ['body', 'slug'] for extra-forbid violations.
    locs = [tuple(d["loc"]) for d in resp.json()["detail"]]
    assert ("body", "slug") in locs


def test_api_create_block_empty_slug_after_slugify(admin_client):
    """Cyrillic-only title -> slugify('') -> 422 keyed to body.title."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    resp = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "Привет",
    })
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert any(tuple(d["loc"]) == ("body", "title") for d in detail)


def test_api_create_block_title_too_long_for_slug(admin_client):
    """200-char Latin title -> slug >80 -> 422 keyed to body.title."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    resp = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "a" * 100,  # slug = "a" * 100, exceeds 80
    })
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert any(tuple(d["loc"]) == ("body", "title") for d in detail)


def test_api_create_sequence_derives_slug_from_title(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    resp = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "Confidence intervals (part 1)",
    })
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["title"] == "Confidence intervals (part 1)"
    assert data["slug"] == "confidence-intervals-part-1"


def test_api_create_sequence_rejects_extra_slug_field(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    resp = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "Seq A",
        "slug": "seq-a",
    })
    assert resp.status_code == 422, resp.text
    locs = [tuple(d["loc"]) for d in resp.json()["detail"]]
    assert ("body", "slug") in locs


def test_api_create_sequence_empty_slug_after_slugify(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    resp = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "Привет"})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_create_sequence_title_too_long_for_slug(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    resp = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "a" * 100})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_block_title_edit_re_derives_slug(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Old"}).json()
    assert block["slug"] == "old"
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": "New Name"})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["title"] == "New Name"
    assert data["slug"] == "new-name"


def test_api_update_block_info_only_does_not_re_derive_slug(admin_client):
    """Frontend always resends title on info-only edits — title-diff rule prevents slug churn."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Same Title"}).json()
    original_slug = block["slug"]
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={
        "title": "Same Title",  # resent unchanged
        "info": "new info",
    })
    assert resp.status_code == 200
    assert resp.json()["slug"] == original_slug
    assert resp.json()["info"] == "new info"


def test_api_update_block_title_edit_on_published_re_derives_slug(admin_client, db):
    """title is in _BLOCK_EDITABLE_PUBLISHED, so a published version still re-derives slug on title edit."""
    from mathion.models import CourseVersion
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version_resp = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block_resp = admin_client.post(f"/api/versions/{version_resp['id']}/blocks", json={"title": "Old"}).json()
    v = db.get(CourseVersion, version_resp["id"])
    v.state = "published"
    db.commit()
    resp = admin_client.patch(f"/api/blocks/{block_resp['id']}", json={"title": "Renamed On Published"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["slug"] == "renamed-on-published"


def test_api_update_block_collision_returns_409(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Foo Bar"})  # slug=foo-bar
    second = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Other"}).json()  # slug=other
    resp = admin_client.patch(f"/api/blocks/{second['id']}", json={"title": "Foo-Bar"})  # also slugifies to foo-bar
    assert resp.status_code == 409


def test_api_update_block_equivalent_after_slugify_is_no_op_for_slug(admin_client):
    """Title 'Foo Bar' -> 'Foo Bar!' both slugify to 'foo-bar'. Slug-write is identical; no IntegrityError on self-row."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Foo Bar"}).json()
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": "Foo Bar!"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Foo Bar!"
    assert resp.json()["slug"] == "foo-bar"


def test_api_update_block_explicit_null_title_returns_422(admin_client):
    """{ 'title': null } in PATCH body is a client error keyed to body.title (not 500 from slugify(None))."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": None})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_block_rejects_extra_slug_field(admin_client):
    """extra='forbid' on update schema rejects clients trying to override slug."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": "New", "slug": "rogue-slug"})
    assert resp.status_code == 422, resp.text
    locs = [tuple(d["loc"]) for d in resp.json()["detail"]]
    assert ("body", "slug") in locs


def test_api_update_block_unchanged_title_preserves_legacy_slug(admin_client, db):
    """Spec lines 56, 142: a row with an existing non-derived slug (the
    'legacy custom slug' case) must NOT have its slug snapped to
    slugify(title) when an info-only PATCH resends the unchanged title.
    A naive 'title key present means rederive' implementation would fail
    this — only the title-diff check should rederive."""
    from mathion.models import Block
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block_resp = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "My Title"}).json()
    # Directly mutate the row to simulate a pre-existing custom slug that
    # doesn't match slugify(title). This is the migration scenario.
    row = db.get(Block, block_resp["id"])
    row.slug = "legacy-custom-slug"
    db.commit()
    # PATCH resending the unchanged title + an info edit (BlockAccordion's
    # actual save shape).
    resp = admin_client.patch(f"/api/blocks/{block_resp['id']}", json={
        "title": "My Title",  # unchanged
        "info": "new info",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["slug"] == "legacy-custom-slug"  # NOT snapped to "my-title"


def test_api_update_block_empty_slug_after_slugify(admin_client):
    """Title edit to a Cyrillic-only string -> slugify('') -> 422 keyed to body.title."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": "Привет"})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_block_title_too_long_for_slug(admin_client):
    """Title edit producing >80-char slug -> 422 keyed to body.title."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": "a" * 100})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


# ==================== SEQUENCE UPDATE TESTS ====================


def test_api_update_sequence_title_edit_re_derives_slug(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "Old"}).json()
    assert seq["slug"] == "old"
    resp = admin_client.patch(f"/api/sequences/{seq['id']}", json={"title": "Renamed Seq"})
    assert resp.status_code == 200
    assert resp.json()["slug"] == "renamed-seq"


def test_api_update_sequence_collision_returns_409(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "Foo Bar"})
    other = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "Other"}).json()
    resp = admin_client.patch(f"/api/sequences/{other['id']}", json={"title": "Foo-Bar"})
    assert resp.status_code == 409


def test_api_update_sequence_explicit_null_title_returns_422(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    resp = admin_client.patch(f"/api/sequences/{seq['id']}", json={"title": None})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_sequence_rejects_extra_slug_field(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    resp = admin_client.patch(f"/api/sequences/{seq['id']}", json={"title": "New", "slug": "rogue"})
    assert resp.status_code == 422
    locs = [tuple(d["loc"]) for d in resp.json()["detail"]]
    assert ("body", "slug") in locs


def test_api_update_sequence_unchanged_title_preserves_legacy_slug(admin_client, db):
    """Legacy custom slug preserved on unchanged-title PATCH (spec lines 56, 142)."""
    from mathion.models import Sequence
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq_resp = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "My Title"}).json()
    row = db.get(Sequence, seq_resp["id"])
    row.slug = "legacy-custom-slug"
    db.commit()
    resp = admin_client.patch(f"/api/sequences/{seq_resp['id']}", json={"title": "My Title"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["slug"] == "legacy-custom-slug"


def test_api_update_sequence_empty_slug_after_slugify(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    resp = admin_client.patch(f"/api/sequences/{seq['id']}", json={"title": "Привет"})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_sequence_title_too_long_for_slug(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    resp = admin_client.patch(f"/api/sequences/{seq['id']}", json={"title": "a" * 100})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_sequence_title_edit_on_published_re_derives_slug(admin_client, db):
    """title is in _SEQUENCE_EDITABLE_PUBLISHED, so published versions still re-derive."""
    from mathion.models import CourseVersion
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "Old"}).json()
    v = db.get(CourseVersion, version["id"])
    v.state = "published"
    db.commit()
    resp = admin_client.patch(f"/api/sequences/{seq['id']}", json={"title": "Renamed On Published"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["slug"] == "renamed-on-published"


def test_api_update_sequence_unchanged_title_keeps_slug(admin_client):
    """Title resent unchanged — slug stays (no rederive)."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    original_slug = seq["slug"]
    resp = admin_client.patch(f"/api/sequences/{seq['id']}", json={"title": "S1"})
    assert resp.status_code == 200
    assert resp.json()["slug"] == original_slug


def test_api_update_sequence_equivalent_after_slugify(admin_client):
    """Title 'Foo Bar' -> 'Foo Bar!' both slugify to 'foo-bar'."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "Foo Bar"}).json()
    resp = admin_client.patch(f"/api/sequences/{seq['id']}", json={"title": "Foo Bar!"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Foo Bar!"
    assert resp.json()["slug"] == "foo-bar"
