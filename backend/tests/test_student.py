from datetime import datetime, timezone

from mathion.main import app
from mathion.models import Block, Course, CourseVersion, Item, Sequence
from mathion.models_auth import StudentEnrollment, User, UserItemState


def _make_item_and_user(db):
    """Create a course structure with one item and one enrolled user."""
    course = Course(slug="stats", name="Stats", description="")
    db.add(course)
    db.commit()
    version = CourseVersion(course_id=course.id, state="published", info_md="", info_html="")
    db.add(version)
    db.commit()
    block = Block(version_id=version.id, title="B1", slug="b1", order=1, info="")
    db.add(block)
    db.commit()
    seq = Sequence(block_id=block.id, title="S1", slug="s1", order=1)
    db.add(seq)
    db.commit()
    item = Item(sequence_id=seq.id, title="Intro", slug="intro", order=1, type="static_page",
                content_md="# Hello", content_html="<h1>Hello</h1>")
    db.add(item)
    db.commit()
    user = User(email="student@example.com", full_name="Student")
    db.add(user)
    db.commit()
    db.refresh(item)
    db.refresh(user)
    db.refresh(version)
    return item, user, version


def test_create_user_item_state(db):
    item, user, version = _make_item_and_user(db)
    state = UserItemState(
        user_id=user.id,
        item_id=item.id,
        is_covered=False,
        time_spent=0,
    )
    db.add(state)
    db.commit()
    db.refresh(state)

    assert state.id is not None
    assert state.is_covered is False
    assert state.time_spent == 0
    assert state.attempt_count == 0
    assert state.last_answers is None
    assert state.last_score_correct is None
    assert state.last_score_total is None


def test_user_item_state_unique_per_user_per_item(db):
    import pytest
    from sqlalchemy.exc import IntegrityError

    item, user, version = _make_item_and_user(db)
    s1 = UserItemState(user_id=user.id, item_id=item.id, is_covered=False, time_spent=0)
    db.add(s1)
    db.commit()
    s2 = UserItemState(user_id=user.id, item_id=item.id, is_covered=True, time_spent=100)
    db.add(s2)
    with pytest.raises(IntegrityError):
        db.commit()


def test_update_item_state(db):
    item, user, version = _make_item_and_user(db)
    state = UserItemState(user_id=user.id, item_id=item.id, is_covered=False, time_spent=0)
    db.add(state)
    db.commit()

    state.time_spent = 120
    state.is_covered = True
    state.last_visited_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(state)

    assert state.time_spent == 120
    assert state.is_covered is True
    assert state.last_visited_at is not None


def _setup_enrolled_student(client, db):
    """Create course, publish version, create student, enroll, return (version, student, token).
    Uses admin_client to set up course, then creates a student with their own session."""
    from mathion.auth import request_pin, verify_pin

    # Create course and version via admin
    course = client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": "Welcome"}).json()
    block = client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "B1", "slug": "b1", "info": "",
    }).json()
    seq = client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "S1", "slug": "s1",
    }).json()
    client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Intro", "slug": "intro", "type": "static_page", "content_md": "# Hello",
    })
    client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Quiz", "slug": "quiz", "type": "quiz",
    })
    client.post(f"/api/versions/{version['id']}/publish")

    # Create student and enroll
    student = User(email="student@example.com", full_name="Student")
    db.add(student)
    db.commit()
    enrollment = StudentEnrollment(user_id=student.id, version_id=version["id"], is_active=True)
    db.add(enrollment)
    db.commit()

    # Get student session
    raw_pin = request_pin(db, student.email)
    token = verify_pin(db, student.email, raw_pin, duration_days=7)

    db.refresh(student)
    return version, student, token, course


def _make_student_client(db, token):
    """Create a TestClient with student auth. Use as context manager for safe cleanup."""
    from contextlib import contextmanager
    from fastapi.testclient import TestClient
    from mathion.database import get_db

    @contextmanager
    def _ctx():
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

    return _ctx()


def test_api_get_state_json(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)

    with _make_student_client(db, token) as sc:
        response = sc.get(f"/api/versions/{version['id']}/state")
        assert response.status_code == 200
        data = response.json()

        assert data["version_id"] == version["id"]
        assert "items" in data
        # No states yet — items dict should be empty
        assert data["items"] == {}


def test_api_get_state_json_with_progress(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)

    # Add some progress
    intro_item = db.query(Item).filter_by(slug="intro").first()

    state = UserItemState(
        user_id=student.id,
        item_id=intro_item.id,
        is_covered=True,
        time_spent=120,
    )
    db.add(state)
    db.commit()

    with _make_student_client(db, token) as sc:
        response = sc.get(f"/api/versions/{version['id']}/state")
        assert response.status_code == 200
        data = response.json()

        assert str(intro_item.id) in data["items"]
        item_state = data["items"][str(intro_item.id)]
        assert item_state["is_covered"] is True
        assert item_state["time_spent"] == 120


def test_api_get_state_json_unenrolled_returns_403(admin_client, db):
    # Create a real published version, then check as unenrolled user
    course = admin_client.post("/api/courses", json={"slug": "phys", "name": "Physics", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "B1", "slug": "b1", "info": "",
    }).json()
    admin_client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "S1", "slug": "s1",
    })
    admin_client.post(f"/api/versions/{version['id']}/publish")

    # Create a non-enrolled user with their own session
    from mathion.auth import request_pin, verify_pin
    other = User(email="other@example.com", full_name="Other")
    db.add(other)
    db.commit()
    raw_pin = request_pin(db, other.email)
    token = verify_pin(db, other.email, raw_pin, duration_days=7)

    with _make_student_client(db, token) as sc:
        response = sc.get(f"/api/versions/{version['id']}/state")
        assert response.status_code == 403


def test_api_get_state_json_nonexistent_version_returns_404(auth_client):
    response = auth_client.get("/api/versions/999/state")
    assert response.status_code == 404


def test_api_get_state_json_disabled_version_returns_403(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)

    # Disable the version
    admin_client.post(f"/api/versions/{version['id']}/disable")

    with _make_student_client(db, token) as sc:
        response = sc.get(f"/api/versions/{version['id']}/state")
        assert response.status_code == 403


def test_api_track_item(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)
    intro_item = db.query(Item).filter_by(slug="intro").first()

    with _make_student_client(db, token) as sc:
        response = sc.post(f"/api/items/{intro_item.id}/track", json={
            "time_spent": 45,
        }, headers={"X-Requested-With": "mathion"})
        assert response.status_code == 200
        data = response.json()
        assert data["time_spent"] == 45
        assert data["is_covered"] is False


def test_api_track_item_accumulates_time(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)
    intro_item = db.query(Item).filter_by(slug="intro").first()

    with _make_student_client(db, token) as sc:
        sc.post(f"/api/items/{intro_item.id}/track", json={"time_spent": 20},
                headers={"X-Requested-With": "mathion"})
        response = sc.post(f"/api/items/{intro_item.id}/track", json={"time_spent": 30},
                           headers={"X-Requested-With": "mathion"})
        assert response.status_code == 200
        assert response.json()["time_spent"] == 50  # accumulated


def test_api_track_item_mark_covered(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)
    intro_item = db.query(Item).filter_by(slug="intro").first()

    with _make_student_client(db, token) as sc:
        response = sc.post(f"/api/items/{intro_item.id}/track", json={
            "time_spent": 30, "is_covered": True,
        }, headers={"X-Requested-With": "mathion"})
        assert response.status_code == 200
        assert response.json()["is_covered"] is True


def test_api_my_courses(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)

    with _make_student_client(db, token) as sc:
        response = sc.get("/api/my-courses")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["course"]["slug"] == "stats"
        assert data[0]["version_id"] == version["id"]
        assert data[0]["total_items"] == 2
        assert data[0]["covered_items"] == 0


def test_api_my_courses_with_progress(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)

    # Mark one item as covered
    intro = db.query(Item).filter_by(slug="intro").first()
    state = UserItemState(user_id=student.id, item_id=intro.id, is_covered=True, time_spent=60)
    db.add(state)
    db.commit()

    with _make_student_client(db, token) as sc:
        response = sc.get("/api/my-courses")
        data = response.json()
        assert data[0]["covered_items"] == 1
        assert data[0]["total_items"] == 2


def test_api_my_courses_empty(auth_client):
    response = auth_client.get("/api/my-courses")
    assert response.status_code == 200
    assert response.json() == []
