from mathion.models import Course


def test_create_course(db):
    course = Course(slug="applied-statistics", name="Applied Statistics", description="A course on stats")
    db.add(course)
    db.commit()
    db.refresh(course)

    assert course.id is not None
    assert course.slug == "applied-statistics"
    assert course.name == "Applied Statistics"
    assert course.description == "A course on stats"


def test_course_slug_unique(db):
    import pytest
    from sqlalchemy.exc import IntegrityError

    c1 = Course(slug="stats", name="Stats 1", description="")
    c2 = Course(slug="stats", name="Stats 2", description="")
    db.add(c1)
    db.commit()
    db.add(c2)
    with pytest.raises(IntegrityError):
        db.commit()


def test_api_create_course(admin_client):
    response = admin_client.post("/api/courses", json={
        "slug": "applied-statistics",
        "name": "Applied Statistics",
        "description": "Learn stats",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["slug"] == "applied-statistics"
    assert data["name"] == "Applied Statistics"
    assert data["id"] is not None


def test_api_create_course_duplicate_slug(admin_client):
    admin_client.post("/api/courses", json={"slug": "stats", "name": "S1", "description": ""})
    response = admin_client.post("/api/courses", json={"slug": "stats", "name": "S2", "description": ""})
    assert response.status_code == 409


def test_api_list_courses(admin_client):
    admin_client.post("/api/courses", json={"slug": "c1", "name": "Course 1", "description": ""})
    admin_client.post("/api/courses", json={"slug": "c2", "name": "Course 2", "description": ""})
    response = admin_client.get("/api/courses")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2


def test_api_get_course(admin_client):
    create_resp = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": "Desc"})
    course_id = create_resp.json()["id"]
    response = admin_client.get(f"/api/courses/{course_id}")
    assert response.status_code == 200
    assert response.json()["slug"] == "stats"


def test_api_get_course_not_found(auth_client):
    response = auth_client.get("/api/courses/999")
    assert response.status_code == 404


def test_api_update_course(admin_client):
    create_resp = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""})
    course_id = create_resp.json()["id"]
    response = admin_client.patch(f"/api/courses/{course_id}", json={"name": "Applied Statistics"})
    assert response.status_code == 200
    assert response.json()["name"] == "Applied Statistics"
    assert response.json()["slug"] == "stats"  # unchanged


def test_api_delete_course(admin_client):
    create_resp = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""})
    course_id = create_resp.json()["id"]
    response = admin_client.delete(f"/api/courses/{course_id}")
    assert response.status_code == 204
    response = admin_client.get(f"/api/courses/{course_id}")
    assert response.status_code == 404


def test_api_create_course_missing_slug(admin_client):
    response = admin_client.post("/api/courses", json={"name": "Stats", "description": ""})
    assert response.status_code == 422


def test_api_create_course_invalid_slug_uppercase(admin_client):
    response = admin_client.post("/api/courses", json={"slug": "Applied-Statistics", "name": "Stats", "description": ""})
    assert response.status_code == 422


def test_api_create_course_invalid_slug_spaces(admin_client):
    response = admin_client.post("/api/courses", json={"slug": "applied statistics", "name": "Stats", "description": ""})
    assert response.status_code == 422


def test_api_create_course_empty_name(admin_client):
    response = admin_client.post("/api/courses", json={"slug": "stats", "name": "", "description": ""})
    assert response.status_code == 422


def test_api_get_course_forbidden_for_non_enrolled_user(client, db, test_user):
    """Non-enrolled, non-admin user gets 403 when fetching a specific course."""
    from mathion.auth import request_pin, verify_pin
    from mathion.models import Course

    # Create course directly in db (no superuser needed)
    course = Course(slug="secret", name="Secret", description="")
    db.add(course)
    db.commit()
    db.refresh(course)

    # Log in as test_user (regular user, not enrolled, not admin)
    raw_pin = request_pin(db, test_user.email)
    token = verify_pin(db, test_user.email, raw_pin, duration_days=7)
    client.cookies.set("session_token", token)

    response = client.get(f"/api/courses/{course.id}")
    assert response.status_code == 403


def test_api_get_course_allowed_for_course_admin(client, db, test_user):
    """A course admin can fetch their course."""
    from mathion.auth import request_pin, verify_pin
    from mathion.models import Course, CourseAdmin

    course = Course(slug="admincourse", name="Admin Course", description="")
    db.add(course)
    db.commit()
    db.refresh(course)

    ca = CourseAdmin(course_id=course.id, user_id=test_user.id)
    db.add(ca)
    db.commit()

    raw_pin = request_pin(db, test_user.email)
    token = verify_pin(db, test_user.email, raw_pin, duration_days=7)
    client.cookies.set("session_token", token)

    response = client.get(f"/api/courses/{course.id}")
    assert response.status_code == 200
    assert response.json()["slug"] == "admincourse"
