from sqlalchemy import update

from mathion.models import AnswerOption, Item


def _make_quiz_via_api(admin_client):
    """Create course -> version -> block -> sequence -> quiz item via API, return IDs."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"label": "L", "info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "B1", "info": "",
    }).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "S1",
    }).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Quiz", "type": "quiz",
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
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"label": "L", "info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Page", "type": "static_page", "content_md": "# Hi",
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
    """is_correct can be changed in published state; on single choice the old
    correct answer is cleared in the same request (5d D12)."""
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    opt1 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": True}).json()
    opt2 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "B", "is_correct": False}).json()
    admin_client.post(f"/api/versions/{ids['version']['id']}/publish")

    response = admin_client.patch(f"/api/options/{opt2['id']}", json={"is_correct": True})
    assert response.status_code == 200
    assert response.json()["is_correct"] is True
    marks = {o["id"]: o["is_correct"] for o in admin_client.get(f"/api/questions/{q['id']}/options").json()}
    assert marks == {opt1["id"]: False, opt2["id"]: True}


def test_update_option_cannot_remove_last_correct(admin_client):
    """Cannot set the only correct option to false."""
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    opt1 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": True}).json()
    admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "B", "is_correct": False})

    response = admin_client.patch(f"/api/options/{opt1['id']}", json={"is_correct": False})
    assert response.status_code == 422


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


def test_create_question_non_admin_blocked(auth_client, db):
    """Non-admin users cannot list questions (require_course_admin raises 403)."""
    from mathion.models import Course, CourseVersion, Block, Sequence, Item
    # Set up a quiz item directly in the DB so auth_client (non-superuser) can attempt access
    course = Course(slug="na-course", name="NA", description="")
    db.add(course)
    db.commit()
    db.refresh(course)
    version = CourseVersion(course_id=course.id, state="created", info_md="", info_html="")
    db.add(version)
    db.commit()
    db.refresh(version)
    block = Block(version_id=version.id, title="B", slug="b", order=1, info="")
    db.add(block)
    db.commit()
    db.refresh(block)
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq)
    db.commit()
    db.refresh(seq)
    item = Item(sequence_id=seq.id, title="Quiz", slug="quiz", type="quiz", order=1)
    db.add(item)
    db.commit()
    db.refresh(item)
    # auth_client is a regular (non-superuser) user with no course admin role
    response = auth_client.get(f"/api/items/{item.id}/questions")
    assert response.status_code == 403


def test_create_question_disabled_version_blocked(admin_client):
    """Cannot create questions on a disabled version."""
    ids = _make_quiz_via_api(admin_client)
    admin_client.post(f"/api/versions/{ids['version']['id']}/disable")
    response = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    })
    assert response.status_code == 403


def test_update_question_archived_blocked(admin_client):
    """Cannot update questions in archived versions."""
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "numeric_answer", "correct_numeric": 42, "precision": 0,
    }).json()
    # Need to add item to sequence for publish validation
    admin_client.post(f"/api/versions/{ids['version']['id']}/publish")
    admin_client.post(f"/api/versions/{ids['version']['id']}/archive")
    response = admin_client.patch(f"/api/questions/{q['id']}", json={"text_md": "Updated?"})
    assert response.status_code == 409


def test_create_option_disabled_version_blocked(admin_client):
    """Cannot create options on a disabled version."""
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    admin_client.post(f"/api/versions/{ids['version']['id']}/disable")
    response = admin_client.post(f"/api/questions/{q['id']}/options", json={
        "text": "A", "is_correct": True,
    })
    assert response.status_code == 403


def test_update_option_archived_blocked(admin_client):
    """Cannot update options in archived versions."""
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    opt = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": True}).json()
    admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "B", "is_correct": False})
    admin_client.post(f"/api/versions/{ids['version']['id']}/publish")
    admin_client.post(f"/api/versions/{ids['version']['id']}/archive")
    response = admin_client.patch(f"/api/options/{opt['id']}", json={"text": "Updated"})
    assert response.status_code == 409


def _single_choice(admin_client, *marks):
    """A single-choice question with one option per mark, created in order."""
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    opts = [
        admin_client.post(f"/api/questions/{q['id']}/options", json={"text": f"O{i}", "is_correct": m}).json()
        for i, m in enumerate(marks)
    ]
    return q, opts


def _marks(admin_client, qid):
    return [o["is_correct"] for o in admin_client.get(f"/api/questions/{qid}/options").json()]


def test_single_choice_mark_correct_clears_the_old_one(admin_client):
    q, (a, b, c) = _single_choice(admin_client, True, False, False)
    r = admin_client.patch(f"/api/options/{c['id']}", json={"is_correct": True})
    assert r.status_code == 200
    assert _marks(admin_client, q["id"]) == [False, False, True]


def test_single_choice_create_correct_clears_the_old_one(admin_client):
    q, _ = _single_choice(admin_client, True, False)
    r = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "New", "is_correct": True})
    assert r.status_code == 201
    assert _marks(admin_client, q["id"]) == [False, False, True]


def test_single_choice_repairs_two_correct_answers(admin_client, db):
    """Old data (the 5b two-step swap could leave it) has two correct answers;
    marking one of them correct leaves only that one."""
    q, (a, b) = _single_choice(admin_client, True, False)
    db.execute(update(AnswerOption).where(AnswerOption.id == b["id"]).values(is_correct=True))
    db.commit()
    assert _marks(admin_client, q["id"]) == [True, True]
    r = admin_client.patch(f"/api/options/{a['id']}", json={"is_correct": True})
    assert r.status_code == 200
    assert _marks(admin_client, q["id"]) == [True, False]


def test_multiple_choice_keeps_every_mark(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "multiple_choice",
    }).json()
    a = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": True}).json()
    b = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "B", "is_correct": False}).json()
    assert admin_client.patch(f"/api/options/{b['id']}", json={"is_correct": True}).status_code == 200
    assert _marks(admin_client, q["id"]) == [True, True]
    assert admin_client.patch(f"/api/options/{a['id']}", json={"is_correct": False}).status_code == 200
    assert admin_client.patch(f"/api/options/{b['id']}", json={"is_correct": False}).status_code == 422


def test_text_only_update_does_not_touch_the_marks(admin_client):
    q, (a, b) = _single_choice(admin_client, True, False)
    assert admin_client.patch(f"/api/options/{b['id']}", json={"text": "Renamed"}).status_code == 200
    assert _marks(admin_client, q["id"]) == [True, False]
