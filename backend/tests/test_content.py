from mathion.models import AnswerOption, Item, Question


def _build_course_with_quiz(admin_client, db):
    """Create a course with one block, one sequence, a static page and a quiz with questions."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Applied Statistics", "description": "Desc"}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": "Welcome"}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "Descriptive Stats", "slug": "descriptive-stats", "info": "Goals",
    }).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "Quantiles", "slug": "quantiles",
    }).json()

    # Static page via API
    admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Introduction", "slug": "intro", "type": "static_page", "content_md": "# Intro",
    })

    # Quiz item + questions via direct DB (question API not built yet)
    quiz_item = Item(sequence_id=seq["id"], title="Quiz 1", slug="quiz-1", order=2, type="quiz")
    db.add(quiz_item)
    db.commit()
    db.refresh(quiz_item)

    q = Question(item_id=quiz_item.id, text_md="2+2?", text_html="<p>2+2?</p>", type="single_choice", order=1,
                 explanation_md="Basic arithmetic", explanation_html="<p>Basic arithmetic</p>")
    db.add(q)
    db.commit()
    db.refresh(q)

    db.add_all([
        AnswerOption(question_id=q.id, text="3", is_correct=False, order=1),
        AnswerOption(question_id=q.id, text="4", is_correct=True, order=2),
    ])
    db.commit()

    return course, version


def test_content_json_structure(admin_client, db):
    course, version = _build_course_with_quiz(admin_client, db)

    # Publish so the content endpoint allows access
    admin_client.post(f"/api/versions/{version['id']}/publish")

    response = admin_client.get(f"/api/versions/{version['id']}/content")
    assert response.status_code == 200
    data = response.json()

    # Top-level
    assert data["course"]["slug"] == "stats"
    assert data["course"]["name"] == "Applied Statistics"
    assert data["version"]["id"] == version["id"]

    # Blocks
    assert len(data["blocks"]) == 1
    block = data["blocks"][0]
    assert block["title"] == "Descriptive Stats"
    assert block["slug"] == "descriptive-stats"

    # Sequences
    assert len(block["sequences"]) == 1
    seq = block["sequences"][0]
    assert seq["title"] == "Quantiles"

    # Items
    assert len(seq["items"]) == 2
    static = seq["items"][0]
    assert static["type"] == "static_page"
    assert static["title"] == "Introduction"

    quiz = seq["items"][1]
    assert quiz["type"] == "quiz"
    assert len(quiz["questions"]) == 1

    # CRITICAL: options must NOT contain is_correct
    question = quiz["questions"][0]
    # Publish re-renders all markdown, so text_html is the canonical render of text_md.
    assert question["text_html"].strip() == "<p>2+2?</p>"
    assert len(question["options"]) == 2
    for opt in question["options"]:
        assert "is_correct" not in opt

    # CRITICAL: questions must NOT contain correct answers or explanations
    assert "correct_numeric" not in question
    assert "correct_text" not in question
    assert "explanation_md" not in question
    assert "explanation_html" not in question


def test_content_json_404(admin_client):
    response = admin_client.get("/api/versions/999/content")
    assert response.status_code == 404


def test_content_json_draft_version_returns_403(admin_client):
    """Content endpoint returns 403 for a version in 'created' (draft) state."""
    course = admin_client.post("/api/courses", json={"slug": "empty", "name": "Empty Course", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    response = admin_client.get(f"/api/versions/{version['id']}/content")
    assert response.status_code == 403


def test_content_json_empty_published_version(admin_client):
    """Content endpoint returns 200 with an empty blocks array for a published version with no blocks."""
    course = admin_client.post("/api/courses", json={"slug": "empty", "name": "Empty Course", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    response = admin_client.get(f"/api/versions/{version['id']}/content")
    assert response.status_code == 200
    data = response.json()
    assert data["blocks"] == []
    assert data["course"]["slug"] == "empty"
    assert data["version"]["id"] == version["id"]


def test_content_json_disabled_version_returns_403(admin_client):
    """Content endpoint returns 403 for a disabled version."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(f"/api/versions/{version['id']}/disable")
    response = admin_client.get(f"/api/versions/{version['id']}/content")
    assert response.status_code == 403
