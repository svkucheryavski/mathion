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
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1", "slug": "s1"}).json()
    admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "I", "slug": "i", "type": "static_page", "content_md": "hello"})
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


def test_api_cannot_revert_version_with_enrolled_students(admin_client, db):
    from mathion.models_auth import StudentEnrollment, User

    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")

    # Enroll a student
    student = User(email="student@example.com")
    db.add(student)
    db.commit()
    enrollment = StudentEnrollment(user_id=student.id, version_id=version["id"], is_active=True)
    db.add(enrollment)
    db.commit()

    # Try to revert — should fail
    response = admin_client.post(f"/api/versions/{version['id']}/revert")
    assert response.status_code == 409
    assert "enrolled students" in response.json()["detail"]


def test_publish_quiz_without_questions_fails(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "q1", "name": "Q", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "Quiz", "slug": "quiz", "type": "quiz"})
    response = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert response.status_code == 409
    assert "question" in response.json()["detail"].lower()


def test_publish_choice_question_without_options_fails(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "q2", "name": "Q", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "Quiz", "slug": "quiz", "type": "quiz"}).json()
    admin_client.post(f"/api/items/{item['id']}/questions", json={"text_md": "Q?", "type": "single_choice"})
    response = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert response.status_code == 409
    assert "option" in response.json()["detail"].lower()


def test_publish_numeric_question_without_answer_fails(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "q3", "name": "Q", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "Quiz", "slug": "quiz", "type": "quiz"}).json()
    admin_client.post(f"/api/items/{item['id']}/questions", json={"text_md": "Q?", "type": "numeric_answer"})
    response = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert response.status_code == 409
    assert "correct_numeric" in response.json()["detail"].lower()


def test_publish_complete_quiz_succeeds(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "q4", "name": "Q", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "Quiz", "slug": "quiz", "type": "quiz"}).json()
    q = admin_client.post(f"/api/items/{item['id']}/questions", json={"text_md": "Q?", "type": "single_choice"}).json()
    admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": True})
    admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "B", "is_correct": False})
    response = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert response.status_code == 200


def test_publish_text_question_without_answer_fails(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "q5", "name": "Q", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "Quiz", "slug": "quiz", "type": "quiz"}).json()
    admin_client.post(f"/api/items/{item['id']}/questions", json={"text_md": "Q?", "type": "text_answer"})
    response = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert response.status_code == 409
    assert "correct_text" in response.json()["detail"].lower()


def test_disable_version_with_active_run_409(admin_client, db, seed_publishable_version):
    """Cannot disable version while an active run exists (published + not ended)."""
    course, version = seed_publishable_version()
    run = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-12-31"},
    ).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "teach@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/publish")
    response = admin_client.post(f"/api/versions/{version['id']}/disable")
    assert response.status_code == 409
    assert "active" in response.json()["detail"].lower()


def test_disable_version_with_only_inactive_runs_ok(admin_client, db, seed_publishable_version):
    """Disable succeeds when all runs are inactive (unpublished or end_date past)."""
    course, version = seed_publishable_version()
    # Create unpublished run — inactive
    run = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-12-31"},
    ).json()
    response = admin_client.post(f"/api/versions/{version['id']}/disable")
    assert response.status_code == 200


def test_publish_disabled_version_returns_403(admin_client):
    course = admin_client.post(
        "/api/courses", json={"slug": "d", "name": "D", "description": ""}
    ).json()
    version = admin_client.post(
        f"/api/courses/{course['id']}/versions", json={"info_md": ""}
    ).json()
    admin_client.post(f"/api/versions/{version['id']}/disable")
    r = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert r.status_code == 403
    assert "disabled" in r.json()["detail"].lower()


def test_patch_version_info_md_in_created(admin_client, db):
    from mathion.models import CourseVersion
    course = admin_client.post("/api/courses", json={"slug": "p", "name": "P", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": "old"}).json()
    before = db.get(CourseVersion, version["id"]).content_updated_at
    r = admin_client.patch(f"/api/versions/{version['id']}", json={"info_md": "new # heading"})
    assert r.status_code == 200
    assert r.json()["info_md"] == "new # heading"
    assert "<p" in r.json()["info_html"]
    after = db.get(CourseVersion, version["id"]).content_updated_at
    assert after > before


def test_patch_version_max_quiz_attempts(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "p", "name": "P", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    r = admin_client.patch(f"/api/versions/{version['id']}", json={"max_quiz_attempts": 5})
    assert r.status_code == 200
    assert r.json()["max_quiz_attempts"] == 5


def test_patch_version_published_409(admin_client, seed_publishable_version):
    _, version = seed_publishable_version()
    r = admin_client.patch(f"/api/versions/{version['id']}", json={"info_md": "x"})
    assert r.status_code == 409


def test_patch_version_archived_409(admin_client, seed_publishable_version):
    _, version = seed_publishable_version()
    admin_client.post(f"/api/versions/{version['id']}/archive")
    r = admin_client.patch(f"/api/versions/{version['id']}", json={"info_md": "x"})
    assert r.status_code == 409


def test_patch_version_disabled_403(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "p", "name": "P", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(f"/api/versions/{version['id']}/disable")
    r = admin_client.patch(f"/api/versions/{version['id']}", json={"info_md": "x"})
    assert r.status_code == 403


def test_patch_version_empty_body_is_noop(admin_client, db):
    from mathion.models import CourseVersion
    course = admin_client.post("/api/courses", json={"slug": "p", "name": "P", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    before = db.get(CourseVersion, version["id"]).content_updated_at
    r = admin_client.patch(f"/api/versions/{version['id']}", json={})
    assert r.status_code == 200
    after = db.get(CourseVersion, version["id"]).content_updated_at
    assert after == before


def test_render_endpoint_admin(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "r", "name": "R", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    r = admin_client.post(
        f"/api/versions/{version['id']}/render", json={"content_md": "# hello"}
    )
    assert r.status_code == 200
    assert "<h1>" in r.json()["html"].lower() or "<h1" in r.json()["html"]


def test_render_endpoint_non_admin_403(auth_client, admin_client):
    course = admin_client.post("/api/courses", json={"slug": "r", "name": "R", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    r = auth_client.post(
        f"/api/versions/{version['id']}/render", json={"content_md": "# x"}
    )
    assert r.status_code == 403


def test_render_endpoint_disabled_403(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "r", "name": "R", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(f"/api/versions/{version['id']}/disable")
    r = admin_client.post(
        f"/api/versions/{version['id']}/render", json={"content_md": "x"}
    )
    assert r.status_code == 403
