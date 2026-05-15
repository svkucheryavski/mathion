def _make_course_with_one_item(admin_client, content_md="hello"):
    course = admin_client.post(
        "/api/courses", json={"slug": "tree", "name": "Tree", "description": ""}
    ).json()
    version = admin_client.post(
        f"/api/courses/{course['id']}/versions", json={"info_md": "v-info"}
    ).json()
    block = admin_client.post(
        f"/api/versions/{version['id']}/blocks", json={"title": "B", "info": "b-info"}
    ).json()
    seq = admin_client.post(
        f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}
    ).json()
    item = admin_client.post(
        f"/api/sequences/{seq['id']}/items",
        json={"title": "I", "slug": "i", "type": "static_page", "content_md": content_md},
    ).json()
    return course, version, block, seq, item


def test_admin_tree_in_created_state(admin_client):
    _, version, block, seq, _item = _make_course_with_one_item(admin_client)
    r = admin_client.get(f"/api/versions/{version['id']}/admin-tree")
    assert r.status_code == 200
    body = r.json()
    assert body["version"]["id"] == version["id"]
    assert body["version"]["state"] == "created"
    assert body["version"]["info_md"] == "v-info"
    assert body["blocks"][0]["version_id"] == version["id"]
    assert body["blocks"][0]["info"] == "b-info"
    s = body["blocks"][0]["sequences"][0]
    assert s["block_id"] == block["id"]
    i = s["items"][0]
    assert i["sequence_id"] == seq["id"]
    assert i["content_md"] == "hello"


def test_admin_tree_published_ok(admin_client, seed_publishable_version):
    _, version = seed_publishable_version()
    r = admin_client.get(f"/api/versions/{version['id']}/admin-tree")
    assert r.status_code == 200


def test_admin_tree_archived_ok(admin_client, seed_publishable_version):
    _, version = seed_publishable_version()
    admin_client.post(f"/api/versions/{version['id']}/archive")
    r = admin_client.get(f"/api/versions/{version['id']}/admin-tree")
    assert r.status_code == 200


def test_admin_tree_disabled_ok(admin_client):
    _, version, *_rest = _make_course_with_one_item(admin_client)
    admin_client.post(f"/api/versions/{version['id']}/disable")
    r = admin_client.get(f"/api/versions/{version['id']}/admin-tree")
    assert r.status_code == 200
    assert r.json()["version"]["is_disabled"] is True


def test_admin_tree_non_admin_403(auth_client, admin_client):
    _, version, *_rest = _make_course_with_one_item(admin_client)
    r = auth_client.get(f"/api/versions/{version['id']}/admin-tree")
    assert r.status_code == 403


def test_admin_tree_returns_parent_fks_and_md(admin_client):
    """Frontend deep-link validation reads block.version_id, sequence.block_id, item.sequence_id."""
    _, version, block, seq, _item = _make_course_with_one_item(admin_client, content_md="foo")
    body = admin_client.get(f"/api/versions/{version['id']}/admin-tree").json()
    assert body["blocks"][0]["version_id"] == version["id"]
    assert body["blocks"][0]["sequences"][0]["block_id"] == block["id"]
    assert body["blocks"][0]["sequences"][0]["items"][0]["sequence_id"] == seq["id"]
    assert body["blocks"][0]["sequences"][0]["items"][0]["content_md"] == "foo"
    assert body["version"]["info_md"] == "v-info"


def test_admin_tree_includes_questions_count(admin_client, db):
    """Quiz ItemEditPage needs `questions_count` to show 'N questions' (spec §3, ItemEditPage)."""
    from mathion.models import Block, Sequence, Item, Question
    course = admin_client.post("/api/courses", json={"slug": "q", "name": "Q", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = Block(version_id=version["id"], title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    quiz = Item(sequence_id=seq.id, title="Q1", slug="q1", order=1, type="quiz")
    static = Item(sequence_id=seq.id, title="P1", slug="p1", order=2, type="static_page",
                  content_md="x", content_html="<p>x</p>")
    db.add_all([quiz, static]); db.flush()
    db.add_all([
        Question(item_id=quiz.id, text_md="a", text_html="a", order=1, type="single_choice"),
        Question(item_id=quiz.id, text_md="b", text_html="b", order=2, type="single_choice"),
    ])
    db.commit()
    body = admin_client.get(f"/api/versions/{version['id']}/admin-tree").json()
    items = {it["slug"]: it for it in body["blocks"][0]["sequences"][0]["items"]}
    assert items["q1"]["questions_count"] == 2
    assert items["p1"]["questions_count"] == 0


def test_admin_tree_timestamps_match_typescript_contract(admin_client):
    """`created_at` and `content_updated_at` are server-default non-null columns;
    the JSON shape must always emit them as ISO strings (matches TS frontend
    types `AdminTreeVersion.{created_at, content_updated_at}: string`).
    `published_at` and `archived_at` remain nullable until the version transitions."""
    course = admin_client.post("/api/courses", json={"slug": "ts", "name": "T", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    body = admin_client.get(f"/api/versions/{version['id']}/admin-tree").json()
    v = body["version"]
    assert isinstance(v["created_at"], str) and v["created_at"]
    assert isinstance(v["content_updated_at"], str) and v["content_updated_at"]
    assert v["published_at"] is None
    assert v["archived_at"] is None
