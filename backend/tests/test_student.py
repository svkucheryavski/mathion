from datetime import datetime, timezone

from mathion.models import Block, Course, CourseAdmin, CourseVersion, Item, Sequence
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
        "title": "B1", "info": "",
    }).json()
    seq = client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "S1",
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
    """Create a TestClient with student auth. Use as context manager for safe cleanup.

    Saves and restores existing dependency overrides so it doesn't break
    admin_client or other fixtures if called within the same test.
    """
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
        "title": "B1", "info": "",
    }).json()
    admin_client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "S1",
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


def test_api_get_state_json_disabled_version_student_gets_403(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)

    # Disable the version
    admin_client.post(f"/api/versions/{version['id']}/disable")

    with _make_student_client(db, token) as sc:
        response = sc.get(f"/api/versions/{version['id']}/state")
        assert response.status_code == 403


def test_api_get_state_json_disabled_version_superuser_allowed(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)

    # Disable the version — superuser (admin_client) should still have access
    admin_client.post(f"/api/versions/{version['id']}/disable")

    response = admin_client.get(f"/api/versions/{version['id']}/state")
    assert response.status_code == 200


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


def test_api_resolve_version(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)

    with _make_student_client(db, token) as sc:
        response = sc.get("/api/courses/stats/my-version")
        assert response.status_code == 200
        data = response.json()
        assert data["version_id"] == version["id"]
        assert data["course_slug"] == "stats"


def test_api_resolve_version_not_enrolled(auth_client):
    response = auth_client.get("/api/courses/nonexistent/my-version")
    assert response.status_code == 404


def test_api_resolve_version_no_enrollment(admin_client, db, auth_client):
    # Create course directly in DB — admin_client and auth_client share
    # the same get_db override via the client fixture, so both work.
    course = Course(slug="physics", name="Physics", description="")
    db.add(course)
    db.commit()

    response = auth_client.get("/api/courses/physics/my-version")
    assert response.status_code == 404


# --- Additional coverage tests from review ---


def test_api_get_state_json_with_score(admin_client, db):
    """Verify last_score dict is populated when score data exists."""
    version, student, token, course = _setup_enrolled_student(admin_client, db)
    intro_item = db.query(Item).filter_by(slug="intro").first()

    state = UserItemState(
        user_id=student.id,
        item_id=intro_item.id,
        is_covered=True,
        time_spent=60,
        attempt_count=2,
        last_score_correct=3,
        last_score_total=5,
        last_answers=[{"q": 1, "a": "x"}],
    )
    db.add(state)
    db.commit()

    with _make_student_client(db, token) as sc:
        response = sc.get(f"/api/versions/{version['id']}/state")
        assert response.status_code == 200
        data = response.json()

        item_state = data["items"][str(intro_item.id)]
        assert item_state["last_score"] == {"correct": 3, "total": 5}
        assert item_state["attempt_count"] == 2
        assert item_state["last_answers"] == [{"q": 1, "a": "x"}]
        assert item_state["max_attempts"] == 3  # default from version


def test_api_get_state_json_course_admin_access(admin_client, db):
    """Verify course admin (non-superuser) can access version state."""
    from mathion.auth import request_pin, verify_pin

    version, student, token, course = _setup_enrolled_student(admin_client, db)

    # Create a non-superuser course admin
    admin_user = User(email="courseadmin@example.com", full_name="Course Admin")
    db.add(admin_user)
    db.commit()
    ca = CourseAdmin(course_id=course["id"], user_id=admin_user.id)
    db.add(ca)
    db.commit()

    raw_pin = request_pin(db, admin_user.email)
    admin_token = verify_pin(db, admin_user.email, raw_pin, duration_days=7)

    with _make_student_client(db, admin_token) as sc:
        response = sc.get(f"/api/versions/{version['id']}/state")
        assert response.status_code == 200


def test_api_get_state_json_course_admin_disabled_version(admin_client, db):
    """Verify course admin can access disabled version state."""
    from mathion.auth import request_pin, verify_pin

    version, student, token, course = _setup_enrolled_student(admin_client, db)

    admin_user = User(email="courseadmin@example.com", full_name="Course Admin")
    db.add(admin_user)
    db.commit()
    ca = CourseAdmin(course_id=course["id"], user_id=admin_user.id)
    db.add(ca)
    db.commit()

    # Disable the version
    admin_client.post(f"/api/versions/{version['id']}/disable")

    raw_pin = request_pin(db, admin_user.email)
    admin_token = verify_pin(db, admin_user.email, raw_pin, duration_days=7)

    with _make_student_client(db, admin_token) as sc:
        response = sc.get(f"/api/versions/{version['id']}/state")
        assert response.status_code == 200


def test_api_track_item_nonexistent_returns_404(admin_client, db):
    """Track on nonexistent item returns 404."""
    version, student, token, course = _setup_enrolled_student(admin_client, db)

    with _make_student_client(db, token) as sc:
        response = sc.post("/api/items/999/track", json={"time_spent": 10},
                           headers={"X-Requested-With": "mathion"})
        assert response.status_code == 404


def test_api_track_item_cross_version_denied(admin_client, db):
    """Student enrolled in version A cannot track items from version B."""
    version, student, token, course = _setup_enrolled_student(admin_client, db)

    # Create a second course with its own item
    course2 = admin_client.post("/api/courses", json={"slug": "math", "name": "Math", "description": ""}).json()
    v2 = admin_client.post(f"/api/courses/{course2['id']}/versions", json={"info_md": ""}).json()
    b2 = admin_client.post(f"/api/versions/{v2['id']}/blocks", json={"title": "B", "info": ""}).json()
    s2 = admin_client.post(f"/api/blocks/{b2['id']}/sequences", json={"title": "S"}).json()
    i2 = admin_client.post(f"/api/sequences/{s2['id']}/items", json={
        "title": "Other", "slug": "other", "type": "static_page", "content_md": "# Other",
    }).json()
    admin_client.post(f"/api/versions/{v2['id']}/publish")

    with _make_student_client(db, token) as sc:
        response = sc.post(f"/api/items/{i2['id']}/track", json={"time_spent": 10},
                           headers={"X-Requested-With": "mathion"})
        assert response.status_code == 403


def test_api_track_item_covered_stays_covered(admin_client, db):
    """Once an item is covered, subsequent tracks without is_covered keep it covered."""
    version, student, token, course = _setup_enrolled_student(admin_client, db)
    intro_item = db.query(Item).filter_by(slug="intro").first()

    with _make_student_client(db, token) as sc:
        # Mark as covered
        sc.post(f"/api/items/{intro_item.id}/track", json={"time_spent": 30, "is_covered": True},
                headers={"X-Requested-With": "mathion"})
        # Track again without is_covered
        response = sc.post(f"/api/items/{intro_item.id}/track", json={"time_spent": 10},
                           headers={"X-Requested-With": "mathion"})
        assert response.status_code == 200
        assert response.json()["is_covered"] is True
        assert response.json()["time_spent"] == 40


def test_api_my_courses_disabled_version_skipped(admin_client, db):
    """Enrollments on disabled versions don't appear in my-courses."""
    version, student, token, course = _setup_enrolled_student(admin_client, db)

    admin_client.post(f"/api/versions/{version['id']}/disable")

    with _make_student_client(db, token) as sc:
        response = sc.get("/api/my-courses")
        assert response.status_code == 200
        assert response.json() == []


def test_api_my_courses_dedup_multiple_enrollments(admin_client, db):
    """Multiple enrollments in same course: only one entry shown (deduplication)."""
    version, student, token, course = _setup_enrolled_student(admin_client, db)

    # Create second version, add structure, publish, and enroll
    v2 = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": "v2"}).json()
    b2 = admin_client.post(f"/api/versions/{v2['id']}/blocks", json={"title": "B", "info": ""}).json()
    admin_client.post(f"/api/blocks/{b2['id']}/sequences", json={"title": "S"})
    admin_client.post(f"/api/versions/{v2['id']}/publish")
    enrollment2 = StudentEnrollment(user_id=student.id, version_id=v2["id"], is_active=True)
    db.add(enrollment2)
    db.commit()

    with _make_student_client(db, token) as sc:
        response = sc.get("/api/my-courses")
        data = response.json()
        # Only one entry per course, regardless of how many enrollments
        assert len(data) == 1


def test_api_resolve_version_disabled_skipped(admin_client, db):
    """resolve_my_version skips disabled versions."""
    version, student, token, course = _setup_enrolled_student(admin_client, db)

    admin_client.post(f"/api/versions/{version['id']}/disable")

    with _make_student_client(db, token) as sc:
        response = sc.get("/api/courses/stats/my-version")
        assert response.status_code == 404


def test_api_resolve_version_multiple_enrollments(admin_client, db):
    """resolve_my_version works when student has multiple enrollments in same course."""
    version, student, token, course = _setup_enrolled_student(admin_client, db)

    # Create second version and enroll again (old enrollment stays)
    v2 = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": "v2"}).json()
    b2 = admin_client.post(f"/api/versions/{v2['id']}/blocks", json={"title": "B", "info": ""}).json()
    admin_client.post(f"/api/blocks/{b2['id']}/sequences", json={"title": "S"})
    admin_client.post(f"/api/versions/{v2['id']}/publish")
    enrollment2 = StudentEnrollment(user_id=student.id, version_id=v2["id"], is_active=True)
    db.add(enrollment2)
    db.commit()

    with _make_student_client(db, token) as sc:
        response = sc.get("/api/courses/stats/my-version")
        assert response.status_code == 200
        # Should not crash with MultipleResultsFound
        data = response.json()
        assert data["is_active"] is True


def test_my_courses_admin_only_row(auth_client, admin_client, db, test_user):
    """Admin-not-enrolled sees their course with version_id=None."""
    from mathion.models import CourseAdmin
    course = admin_client.post(
        "/api/courses", json={"slug": "adm", "name": "Adm", "description": ""}
    ).json()
    db.add(CourseAdmin(course_id=course["id"], user_id=test_user.id))
    db.commit()
    rows = auth_client.get("/api/my-courses").json()
    matches = [r for r in rows if r["course"]["slug"] == "adm"]
    assert len(matches) == 1
    row = matches[0]
    assert row["is_admin"] is True
    assert row["version_id"] is None
    assert row["version_state"] is None
    assert row["total_items"] == 0
    assert row["covered_items"] == 0
    assert row["is_active"] is False


def test_my_courses_enrolled_only_unchanged(auth_client, admin_client, db, test_user):
    """Enrolled-only behaviour matches pre-existing shape (with is_admin=false default)."""
    from mathion.models_auth import StudentEnrollment
    course = admin_client.post(
        "/api/courses", json={"slug": "enr", "name": "Enr", "description": ""}
    ).json()
    version = admin_client.post(
        f"/api/courses/{course['id']}/versions", json={"info_md": ""}
    ).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    db.add(StudentEnrollment(user_id=test_user.id, version_id=version["id"], is_active=True))
    db.commit()
    rows = auth_client.get("/api/my-courses").json()
    row = next(r for r in rows if r["course"]["slug"] == "enr")
    assert row["is_admin"] is False
    assert row["version_id"] == version["id"]
    assert row["version_state"] == "published"
    assert row["is_active"] is True


def test_my_courses_admin_and_enrolled_merged(auth_client, admin_client, db, test_user):
    """User who is both admin and enrolled sees one row with both fields populated."""
    from mathion.models import CourseAdmin
    from mathion.models_auth import StudentEnrollment
    course = admin_client.post(
        "/api/courses", json={"slug": "both", "name": "Both", "description": ""}
    ).json()
    version = admin_client.post(
        f"/api/courses/{course['id']}/versions", json={"info_md": ""}
    ).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    db.add(CourseAdmin(course_id=course["id"], user_id=test_user.id))
    db.add(StudentEnrollment(user_id=test_user.id, version_id=version["id"], is_active=True))
    db.commit()
    rows = auth_client.get("/api/my-courses").json()
    matches = [r for r in rows if r["course"]["slug"] == "both"]
    assert len(matches) == 1, "admin+enrolled must merge to a single row"
    row = matches[0]
    assert row["is_admin"] is True
    assert row["version_id"] == version["id"]


def test_my_courses_superuser_sees_all(admin_client):
    admin_client.post("/api/courses", json={"slug": "x1", "name": "X1", "description": ""})
    admin_client.post("/api/courses", json={"slug": "x2", "name": "X2", "description": ""})
    rows = admin_client.get("/api/my-courses").json()
    slugs = {r["course"]["slug"] for r in rows}
    assert {"x1", "x2"}.issubset(slugs)
    assert all(r["is_admin"] is True for r in rows)


def test_my_courses_no_role_sees_empty(auth_client):
    """Plain user with no enrollments and no admin role sees []."""
    rows = auth_client.get("/api/my-courses").json()
    assert rows == []


def test_my_courses_active_enrollment_wins_over_newer_inactive(auth_client, admin_client, db, test_user):
    """Two enrollments in same course: active one wins over a newer inactive one (matches resolve_my_version)."""
    from mathion.models_auth import StudentEnrollment
    course = admin_client.post(
        "/api/courses", json={"slug": "ord", "name": "Ord", "description": ""}
    ).json()
    v1 = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    v2 = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(f"/api/versions/{v1['id']}/publish")
    admin_client.post(f"/api/versions/{v2['id']}/publish")
    db.add(StudentEnrollment(user_id=test_user.id, version_id=v1["id"], is_active=True))
    db.commit()
    db.add(StudentEnrollment(user_id=test_user.id, version_id=v2["id"], is_active=False))
    db.commit()
    rows = auth_client.get("/api/my-courses").json()
    matches = [r for r in rows if r["course"]["slug"] == "ord"]
    assert len(matches) == 1
    assert matches[0]["version_id"] == v1["id"]
    assert matches[0]["is_active"] is True
