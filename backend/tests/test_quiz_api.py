from mathion.models_auth import StudentEnrollment, User


def _setup_quiz(admin_client, db):
    """Create a published course with a quiz: 1 single-choice + 1 numeric question."""
    from mathion.auth import request_pin, verify_pin

    course = admin_client.post("/api/courses", json={"slug": "quiz-course", "name": "Quiz", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Quiz", "slug": "quiz", "type": "quiz",
    }).json()

    # Single choice question with 2 options
    q1 = admin_client.post(f"/api/items/{item['id']}/questions", json={
        "text_md": "What is 2+2?", "type": "single_choice",
    }).json()
    opt_a = admin_client.post(f"/api/questions/{q1['id']}/options", json={"text": "3", "is_correct": False}).json()
    opt_b = admin_client.post(f"/api/questions/{q1['id']}/options", json={"text": "4", "is_correct": True}).json()

    # Numeric question
    q2 = admin_client.post(f"/api/items/{item['id']}/questions", json={
        "text_md": "sqrt(9)?", "type": "numeric_answer", "correct_numeric": 3.0, "precision": 0,
    }).json()

    admin_client.post(f"/api/versions/{version['id']}/publish")

    # Create student and enroll
    student = User(email="quizstudent@example.com", full_name="Quiz Student")
    db.add(student)
    db.commit()
    enrollment = StudentEnrollment(user_id=student.id, version_id=version["id"], is_active=True)
    db.add(enrollment)
    db.commit()
    raw_pin = request_pin(db, student.email)
    token = verify_pin(db, student.email, raw_pin, duration_days=7)
    db.refresh(student)

    return {
        "version": version, "item": item,
        "q1": q1, "opt_a": opt_a, "opt_b": opt_b,
        "q2": q2, "student": student, "token": token,
    }


def _make_student_client(db, token):
    """Create a TestClient with student auth. Context manager for safe cleanup."""
    from contextlib import contextmanager
    from fastapi.testclient import TestClient
    from mathion.main import app
    from mathion.database import get_db

    @contextmanager
    def _ctx():
        saved = dict(app.dependency_overrides)
        def override():
            try:
                yield db
            finally:
                pass
        app.dependency_overrides[get_db] = override
        sc = TestClient(app)
        sc.cookies.set("session_token", token)
        try:
            yield sc
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(saved)

    return _ctx()


def test_submit_quiz_all_correct(admin_client, db):
    data = _setup_quiz(admin_client, db)
    with _make_student_client(db, data["token"]) as sc:
        response = sc.post(f"/api/items/{data['item']['id']}/submit", json={
            "answers": {
                str(data["q1"]["id"]): [data["opt_b"]["id"]],
                str(data["q2"]["id"]): "3.0",
            }
        }, headers={"X-Requested-With": "mathion"})
        assert response.status_code == 200
        result = response.json()
        assert result["score_correct"] == 2
        assert result["score_total"] == 2
        assert result["attempt_count"] == 1
        assert result["can_retry"] is True


def test_submit_quiz_partial_correct(admin_client, db):
    data = _setup_quiz(admin_client, db)
    with _make_student_client(db, data["token"]) as sc:
        response = sc.post(f"/api/items/{data['item']['id']}/submit", json={
            "answers": {
                str(data["q1"]["id"]): [data["opt_a"]["id"]],  # wrong
                str(data["q2"]["id"]): "3.0",  # correct
            }
        }, headers={"X-Requested-With": "mathion"})
        assert response.status_code == 200
        result = response.json()
        assert result["score_correct"] == 1
        assert result["score_total"] == 2


def test_submit_quiz_max_attempts_reached(admin_client, db):
    data = _setup_quiz(admin_client, db)
    answers = {
        str(data["q1"]["id"]): [data["opt_b"]["id"]],
        str(data["q2"]["id"]): "3.0",
    }
    with _make_student_client(db, data["token"]) as sc:
        # Submit 3 times (default max_quiz_attempts is 3)
        for i in range(3):
            response = sc.post(f"/api/items/{data['item']['id']}/submit",
                               json={"answers": answers},
                               headers={"X-Requested-With": "mathion"})
            assert response.status_code == 200

        # 4th attempt should be rejected
        response = sc.post(f"/api/items/{data['item']['id']}/submit",
                           json={"answers": answers},
                           headers={"X-Requested-With": "mathion"})
        assert response.status_code == 409
        assert "max attempts" in response.json()["detail"].lower()


def test_submit_quiz_not_enrolled(auth_client):
    response = auth_client.post("/api/items/999/submit", json={"answers": {}})
    assert response.status_code in (403, 404)


def test_submit_quiz_missing_question(admin_client, db):
    """Submitting without answering all questions should fail."""
    data = _setup_quiz(admin_client, db)
    with _make_student_client(db, data["token"]) as sc:
        response = sc.post(f"/api/items/{data['item']['id']}/submit", json={
            "answers": {
                str(data["q1"]["id"]): [data["opt_b"]["id"]],
                # q2 missing
            }
        }, headers={"X-Requested-With": "mathion"})
        assert response.status_code == 422


def test_submit_non_quiz_item_rejected(admin_client, db):
    """Cannot submit answers to a non-quiz item."""
    from mathion.auth import request_pin, verify_pin
    course = admin_client.post("/api/courses", json={"slug": "c2", "name": "C", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Page", "slug": "page", "type": "static_page", "content_md": "# Hi",
    }).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    student = User(email="qs2@example.com", full_name="S")
    db.add(student)
    db.commit()
    enrollment = StudentEnrollment(user_id=student.id, version_id=version["id"], is_active=True)
    db.add(enrollment)
    db.commit()
    raw_pin = request_pin(db, student.email)
    token = verify_pin(db, student.email, raw_pin, duration_days=7)

    with _make_student_client(db, token) as sc:
        response = sc.post(f"/api/items/{item['id']}/submit", json={"answers": {}},
                           headers={"X-Requested-With": "mathion"})
        assert response.status_code == 409


def test_reveal_after_max_attempts(admin_client, db):
    data = _setup_quiz(admin_client, db)
    answers = {
        str(data["q1"]["id"]): [data["opt_b"]["id"]],
        str(data["q2"]["id"]): "3.0",
    }
    with _make_student_client(db, data["token"]) as sc:
        for _ in range(3):
            sc.post(f"/api/items/{data['item']['id']}/submit",
                    json={"answers": answers},
                    headers={"X-Requested-With": "mathion"})

        response = sc.get(f"/api/items/{data['item']['id']}/reveal")
        assert response.status_code == 200
        reveal = response.json()
        assert len(reveal["questions"]) == 2

        # Single choice question should show correct option
        q1_reveal = [q for q in reveal["questions"] if q["id"] == data["q1"]["id"]][0]
        assert data["opt_b"]["id"] in q1_reveal["correct_option_ids"]

        # Numeric question should show correct value
        q2_reveal = [q for q in reveal["questions"] if q["id"] == data["q2"]["id"]][0]
        assert q2_reveal["correct_numeric"] == 3.0


def test_reveal_before_max_attempts_blocked(admin_client, db):
    data = _setup_quiz(admin_client, db)
    answers = {
        str(data["q1"]["id"]): [data["opt_b"]["id"]],
        str(data["q2"]["id"]): "3.0",
    }
    with _make_student_client(db, data["token"]) as sc:
        # Only 1 attempt (max is 3)
        sc.post(f"/api/items/{data['item']['id']}/submit",
                json={"answers": answers},
                headers={"X-Requested-With": "mathion"})

        response = sc.get(f"/api/items/{data['item']['id']}/reveal")
        assert response.status_code == 403


def test_reveal_without_any_attempt_blocked(admin_client, db):
    data = _setup_quiz(admin_client, db)
    with _make_student_client(db, data["token"]) as sc:
        response = sc.get(f"/api/items/{data['item']['id']}/reveal")
        assert response.status_code == 403


def test_submit_disabled_version_blocked(admin_client, db):
    """Cannot submit quiz on a disabled version."""
    data = _setup_quiz(admin_client, db)
    admin_client.post(f"/api/versions/{data['version']['id']}/disable")

    with _make_student_client(db, data["token"]) as sc:
        response = sc.post(f"/api/items/{data['item']['id']}/submit", json={
            "answers": {
                str(data["q1"]["id"]): [data["opt_b"]["id"]],
                str(data["q2"]["id"]): "3.0",
            }
        }, headers={"X-Requested-With": "mathion"})
        assert response.status_code == 403


def test_submit_response_no_answer_leak(admin_client, db):
    """Submit response must not contain correct answers."""
    data = _setup_quiz(admin_client, db)
    with _make_student_client(db, data["token"]) as sc:
        response = sc.post(f"/api/items/{data['item']['id']}/submit", json={
            "answers": {
                str(data["q1"]["id"]): [data["opt_b"]["id"]],
                str(data["q2"]["id"]): "3.0",
            }
        }, headers={"X-Requested-With": "mathion"})
        result = response.json()
        assert "correct_option_ids" not in result
        assert "correct_numeric" not in result
        assert "correct_text" not in result


def test_reveal_includes_student_answer_and_explanation(admin_client, db):
    """Reveal response includes student's answers and explanation_html."""
    data = _setup_quiz(admin_client, db)
    answers = {
        str(data["q1"]["id"]): [data["opt_b"]["id"]],
        str(data["q2"]["id"]): "3.0",
    }
    with _make_student_client(db, data["token"]) as sc:
        for _ in range(3):
            sc.post(f"/api/items/{data['item']['id']}/submit",
                    json={"answers": answers},
                    headers={"X-Requested-With": "mathion"})

        reveal = sc.get(f"/api/items/{data['item']['id']}/reveal").json()
        q1_reveal = [q for q in reveal["questions"] if q["id"] == data["q1"]["id"]][0]
        # student_answer should be included
        assert q1_reveal["student_answer"] == [data["opt_b"]["id"]]
        # explanation_html may be None but must be present in response
        assert "explanation_html" in q1_reveal


def test_submit_quiz_inactive_enrollment_blocked(admin_client, db):
    """Deactivated student cannot submit quiz answers."""
    from sqlalchemy import select
    data = _setup_quiz(admin_client, db)
    # Deactivate the enrollment
    enrollment = db.execute(
        select(StudentEnrollment).where(
            StudentEnrollment.user_id == data["student"].id,
            StudentEnrollment.version_id == data["version"]["id"],
        )
    ).scalar_one()
    enrollment.is_active = False
    db.commit()

    with _make_student_client(db, data["token"]) as sc:
        response = sc.post(f"/api/items/{data['item']['id']}/submit", json={
            "answers": {
                str(data["q1"]["id"]): [data["opt_b"]["id"]],
                str(data["q2"]["id"]): "3.0",
            }
        }, headers={"X-Requested-With": "mathion"})
        assert response.status_code == 403
