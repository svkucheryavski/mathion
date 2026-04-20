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


def test_api_create_course(client):
    response = client.post("/api/courses", json={
        "slug": "applied-statistics",
        "name": "Applied Statistics",
        "description": "Learn stats",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["slug"] == "applied-statistics"
    assert data["name"] == "Applied Statistics"
    assert data["id"] is not None


def test_api_create_course_duplicate_slug(client):
    client.post("/api/courses", json={"slug": "stats", "name": "S1", "description": ""})
    response = client.post("/api/courses", json={"slug": "stats", "name": "S2", "description": ""})
    assert response.status_code == 409


def test_api_list_courses(client):
    client.post("/api/courses", json={"slug": "c1", "name": "Course 1", "description": ""})
    client.post("/api/courses", json={"slug": "c2", "name": "Course 2", "description": ""})
    response = client.get("/api/courses")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2


def test_api_get_course(client):
    create_resp = client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": "Desc"})
    course_id = create_resp.json()["id"]
    response = client.get(f"/api/courses/{course_id}")
    assert response.status_code == 200
    assert response.json()["slug"] == "stats"


def test_api_get_course_not_found(client):
    response = client.get("/api/courses/999")
    assert response.status_code == 404


def test_api_update_course(client):
    create_resp = client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""})
    course_id = create_resp.json()["id"]
    response = client.patch(f"/api/courses/{course_id}", json={"name": "Applied Statistics"})
    assert response.status_code == 200
    assert response.json()["name"] == "Applied Statistics"
    assert response.json()["slug"] == "stats"  # unchanged


def test_api_delete_course(client):
    create_resp = client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""})
    course_id = create_resp.json()["id"]
    response = client.delete(f"/api/courses/{course_id}")
    assert response.status_code == 204
    response = client.get(f"/api/courses/{course_id}")
    assert response.status_code == 404
