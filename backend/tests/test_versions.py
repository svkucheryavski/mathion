import pytest
from sqlalchemy.exc import IntegrityError

from mathion.models import Course, CourseVersion


def _make_course(db, slug="test-course"):
    course = Course(slug=slug, name="Test", description="")
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


def test_create_version(db):
    course = _make_course(db)
    version = CourseVersion(course_id=course.id, state="created", info_md="", info_html="")
    db.add(version)
    db.commit()
    db.refresh(version)

    assert version.id is not None
    assert version.state == "created"
    assert version.course_id == course.id
    assert version.created_at is not None
    assert version.published_at is None
    assert version.archived_at is None
    assert version.max_quiz_attempts == 3
    assert version.is_disabled is False


def test_version_belongs_to_course(db):
    course = _make_course(db)
    v1 = CourseVersion(course_id=course.id, state="created", info_md="", info_html="")
    v2 = CourseVersion(course_id=course.id, state="created", info_md="", info_html="")
    db.add_all([v1, v2])
    db.commit()

    db.refresh(course)
    assert len(course.versions) == 2


def test_api_create_version(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    response = admin_client.post(f"/api/courses/{course['id']}/versions", json={
        "info_md": "Course info",
        "max_quiz_attempts": 5,
    })
    assert response.status_code == 201
    data = response.json()
    assert data["state"] == "created"
    assert data["max_quiz_attempts"] == 5
    assert data["is_disabled"] is False


def test_api_publish_version(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    response = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert response.status_code == 200
    assert response.json()["state"] == "published"
    assert response.json()["published_at"] is not None


def test_api_archive_version(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    response = admin_client.post(f"/api/versions/{version['id']}/archive")
    assert response.status_code == 200
    assert response.json()["state"] == "archived"
    assert response.json()["archived_at"] is not None


def test_api_revert_published_to_created(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    response = admin_client.post(f"/api/versions/{version['id']}/revert")
    assert response.status_code == 200
    assert response.json()["state"] == "created"


def test_api_cannot_archive_created(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    response = admin_client.post(f"/api/versions/{version['id']}/archive")
    assert response.status_code == 409


def test_api_cannot_revert_archived(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    admin_client.post(f"/api/versions/{version['id']}/archive")
    response = admin_client.post(f"/api/versions/{version['id']}/revert")
    assert response.status_code == 409


def test_api_delete_created_version(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    response = admin_client.delete(f"/api/versions/{version['id']}")
    assert response.status_code == 204


def test_api_cannot_delete_published_version(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    response = admin_client.delete(f"/api/versions/{version['id']}")
    assert response.status_code == 409


def test_api_list_versions(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": "v1"})
    admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": "v2"})
    response = admin_client.get(f"/api/courses/{course['id']}/versions")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_api_publish_version_no_blocks(admin_client):
    """Publish succeeds when the version has no blocks (empty course)."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    response = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert response.status_code == 200
    assert response.json()["state"] == "published"


def test_api_publish_version_block_with_no_sequences_fails(admin_client):
    """Publish fails with 409 when a block has no sequences."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "slug": "b1", "info": ""})
    response = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert response.status_code == 409


def test_api_publish_version_block_with_sequences_succeeds(admin_client):
    """Publish succeeds when every block has at least one sequence."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "slug": "b1", "info": ""}).json()
    admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1", "slug": "s1"})
    response = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert response.status_code == 200
    assert response.json()["state"] == "published"


def test_api_disable_enable_version(admin_client):
    """Disable a version, then enable it; is_disabled reflects each state."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    assert version["is_disabled"] is False

    # Disable
    resp = admin_client.post(f"/api/versions/{version['id']}/disable")
    assert resp.status_code == 200
    assert resp.json()["is_disabled"] is True

    # Re-enable
    resp = admin_client.post(f"/api/versions/{version['id']}/enable")
    assert resp.status_code == 200
    assert resp.json()["is_disabled"] is False
