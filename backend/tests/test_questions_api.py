from mathion.models import Item


def _make_quiz_via_api(admin_client):
    """Create course -> version -> block -> sequence -> quiz item via API, return IDs."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "B1", "slug": "b1", "info": "",
    }).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "S1", "slug": "s1",
    }).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Quiz", "slug": "quiz", "type": "quiz",
    }).json()
    return {"course": course, "version": version, "block": block, "seq": seq, "item": item}


def test_create_question(admin_client):
    ids = _make_quiz_via_api(admin_client)
    response = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "What is 2+2?",
        "type": "single_choice",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["text_md"] == "What is 2+2?"
    assert data["type"] == "single_choice"
    assert data["order"] == 1


def test_create_question_not_quiz_item(admin_client):
    """Cannot add questions to non-quiz items."""
    course = admin_client.post("/api/courses", json={"slug": "c1", "name": "C", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Page", "slug": "page", "type": "static_page", "content_md": "# Hi",
    }).json()
    response = admin_client.post(f"/api/items/{item['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    })
    assert response.status_code == 409


def test_create_question_published_state_blocked(admin_client):
    ids = _make_quiz_via_api(admin_client)
    # Add a complete question so the quiz passes publish validation
    admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Existing Q?", "type": "numeric_answer", "correct_numeric": 42, "precision": 0,
    })
    admin_client.post(f"/api/versions/{ids['version']['id']}/publish")
    response = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    })
    assert response.status_code == 409


def test_list_questions(admin_client):
    ids = _make_quiz_via_api(admin_client)
    admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={"text_md": "Q1", "type": "single_choice"})
    admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={"text_md": "Q2", "type": "numeric_answer", "correct_numeric": 42, "precision": 0})
    response = admin_client.get(f"/api/items/{ids['item']['id']}/questions")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_update_question(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={"text_md": "Q?", "type": "single_choice"}).json()
    response = admin_client.patch(f"/api/questions/{q['id']}", json={"text_md": "Updated?"})
    assert response.status_code == 200
    assert response.json()["text_md"] == "Updated?"


def test_update_question_published_state(admin_client):
    """In published state, can edit text_md and explanation_md but not type."""
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "numeric_answer", "correct_numeric": 42, "precision": 0,
    }).json()
    admin_client.post(f"/api/versions/{ids['version']['id']}/publish")

    # Text edit should work
    response = admin_client.patch(f"/api/questions/{q['id']}", json={"text_md": "Updated?"})
    assert response.status_code == 200

    # Correct answer edit should work in published state
    response = admin_client.patch(f"/api/questions/{q['id']}", json={"correct_numeric": 99})
    assert response.status_code == 200


def test_delete_question(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={"text_md": "Q?", "type": "single_choice"}).json()
    response = admin_client.delete(f"/api/questions/{q['id']}")
    assert response.status_code == 204


def test_delete_question_published_blocked(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "numeric_answer", "correct_numeric": 42, "precision": 0,
    }).json()
    admin_client.post(f"/api/versions/{ids['version']['id']}/publish")
    response = admin_client.delete(f"/api/questions/{q['id']}")
    assert response.status_code == 409


def test_create_numeric_question_with_answer(admin_client):
    ids = _make_quiz_via_api(admin_client)
    response = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "sqrt(4)?", "type": "numeric_answer", "correct_numeric": 2.0, "precision": 0,
    })
    assert response.status_code == 201
    data = response.json()
    assert data["correct_numeric"] == 2.0
    assert data["precision"] == 0


def test_create_text_question_with_answer(admin_client):
    ids = _make_quiz_via_api(admin_client)
    response = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Chemical formula of water?", "type": "text_answer", "correct_text": "H2O",
    })
    assert response.status_code == 201
    assert response.json()["correct_text"] == "H2O"


def test_create_option(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    response = admin_client.post(f"/api/questions/{q['id']}/options", json={
        "text": "Answer A", "is_correct": False,
    })
    assert response.status_code == 201
    data = response.json()
    assert data["text"] == "Answer A"
    assert data["is_correct"] is False
    assert data["order"] == 1


def test_create_option_non_choice_type_blocked(admin_client):
    """Cannot add options to numeric_answer or text_answer questions."""
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "numeric_answer", "correct_numeric": 42, "precision": 0,
    }).json()
    response = admin_client.post(f"/api/questions/{q['id']}/options", json={
        "text": "A", "is_correct": True,
    })
    assert response.status_code == 409


def test_list_options(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": False})
    admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "B", "is_correct": True})
    response = admin_client.get(f"/api/questions/{q['id']}/options")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_update_option(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    opt = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": False}).json()
    response = admin_client.patch(f"/api/options/{opt['id']}", json={"text": "Updated A"})
    assert response.status_code == 200
    assert response.json()["text"] == "Updated A"


def test_update_option_is_correct_published(admin_client):
    """is_correct can be changed in published state."""
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    opt1 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": True}).json()
    admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "B", "is_correct": False})
    admin_client.post(f"/api/versions/{ids['version']['id']}/publish")

    response = admin_client.patch(f"/api/options/{opt1['id']}", json={"is_correct": False})
    assert response.status_code == 200
    assert response.json()["is_correct"] is False


def test_delete_option(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    opt = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": True}).json()
    response = admin_client.delete(f"/api/options/{opt['id']}")
    assert response.status_code == 204


def test_delete_option_published_blocked(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    opt = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": True}).json()
    admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "B", "is_correct": False})
    admin_client.post(f"/api/versions/{ids['version']['id']}/publish")
    response = admin_client.delete(f"/api/options/{opt['id']}")
    assert response.status_code == 409
