"""
Access control tests — verify that role-based auth rules are enforced
across all endpoint groups.
"""
from datetime import datetime, timezone

from mathion.models import Course, CourseAdmin, CourseVersion
from mathion.models_auth import StudentEnrollment, User


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_published_course(db, slug="ac-test-course"):
    course = Course(slug=slug, name="AC Test Course", description="")
    db.add(course)
    db.commit()
    db.refresh(course)

    version = CourseVersion(
        course_id=course.id, state="published",
        info_md="", info_html="",
        published_at=datetime.now(timezone.utc),
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return course, version


def _make_draft_course(db, slug="ac-draft-course"):
    course = Course(slug=slug, name="AC Draft Course", description="")
    db.add(course)
    db.commit()
    db.refresh(course)

    version = CourseVersion(course_id=course.id, state="created", info_md="", info_html="")
    db.add(version)
    db.commit()
    db.refresh(version)
    return course, version


# ---------------------------------------------------------------------------
# 1. Unauthenticated requests → 401
# ---------------------------------------------------------------------------

def test_unauth_cannot_list_courses(client):
    response = client.get("/api/courses")
    assert response.status_code == 401


def test_unauth_cannot_create_course(client):
    response = client.post("/api/courses", json={"slug": "x", "name": "X", "description": ""})
    assert response.status_code == 401


def test_unauth_cannot_get_course(client, db):
    course, _ = _make_published_course(db)
    response = client.get(f"/api/courses/{course.id}")
    assert response.status_code == 401


def test_unauth_cannot_access_content(client, db):
    _, version = _make_published_course(db)
    response = client.get(f"/api/versions/{version.id}/content")
    assert response.status_code == 401


def test_unauth_cannot_create_version(client, db):
    course, _ = _make_draft_course(db)
    response = client.post(f"/api/courses/{course.id}/versions", json={"info_md": ""})
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# 2. Regular authenticated user (not superuser, not course admin)
# ---------------------------------------------------------------------------

def test_auth_user_can_list_courses(auth_client):
    """Any authenticated user can list courses."""
    response = auth_client.get("/api/courses")
    assert response.status_code == 200


def test_auth_user_can_get_course(auth_client, db):
    """Any authenticated user can get a specific course."""
    course, _ = _make_published_course(db)
    response = auth_client.get(f"/api/courses/{course.id}")
    assert response.status_code == 200


def test_regular_user_cannot_create_course(auth_client):
    """Regular (non-superuser) user gets 403 when trying to create a course."""
    response = auth_client.post("/api/courses", json={"slug": "noauth", "name": "No Auth", "description": ""})
    assert response.status_code == 403


def test_regular_user_cannot_delete_course(auth_client, db):
    """Regular user gets 403 when trying to delete a course."""
    course, _ = _make_published_course(db)
    response = auth_client.delete(f"/api/courses/{course.id}")
    assert response.status_code == 403


def test_regular_user_cannot_update_course(auth_client, db):
    """Regular user (not a course admin) gets 403 when trying to update a course."""
    course, _ = _make_published_course(db)
    response = auth_client.patch(f"/api/courses/{course.id}", json={"name": "Hacked"})
    assert response.status_code == 403


def test_regular_user_cannot_create_version(auth_client, db):
    """Regular user who is not a course admin gets 403 when creating a version."""
    course, _ = _make_draft_course(db)
    response = auth_client.post(f"/api/courses/{course.id}/versions", json={"info_md": ""})
    assert response.status_code == 403


def test_non_enrolled_user_cannot_access_content(auth_client, db):
    """Authenticated user with no enrollment gets 403 accessing content."""
    _, version = _make_published_course(db)
    response = auth_client.get(f"/api/versions/{version.id}/content")
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# 3. Superuser can do everything
# ---------------------------------------------------------------------------

def test_superuser_can_create_course(admin_client):
    """Superuser can create a course."""
    response = admin_client.post("/api/courses", json={"slug": "su-course", "name": "SU Course", "description": ""})
    assert response.status_code == 201


def test_superuser_can_delete_course(admin_client, db):
    """Superuser can delete a course."""
    course, _ = _make_published_course(db)
    response = admin_client.delete(f"/api/courses/{course.id}")
    assert response.status_code == 204


def test_superuser_can_access_content(admin_client, db):
    """Superuser can access published content without being enrolled."""
    _, version = _make_published_course(db)
    response = admin_client.get(f"/api/versions/{version.id}/content")
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# 4. Enrolled student can access content
# ---------------------------------------------------------------------------

def test_enrolled_student_can_access_content(auth_client, db, test_user):
    """Student with an active enrollment on a version can read its content."""
    _, version = _make_published_course(db)

    enrollment = StudentEnrollment(user_id=test_user.id, version_id=version.id, is_active=True)
    db.add(enrollment)
    db.commit()

    response = auth_client.get(f"/api/versions/{version.id}/content")
    assert response.status_code == 200


def test_inactive_enrollment_cannot_access_content(auth_client, db, test_user):
    """Student with an inactive enrollment gets 403."""
    _, version = _make_published_course(db)

    enrollment = StudentEnrollment(user_id=test_user.id, version_id=version.id, is_active=False)
    db.add(enrollment)
    db.commit()

    response = auth_client.get(f"/api/versions/{version.id}/content")
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# 5. Course admin (non-superuser) can manage their course
# ---------------------------------------------------------------------------

def test_course_admin_can_update_course(auth_client, db, test_user):
    """A course admin can update their course."""
    course, _ = _make_draft_course(db)

    # Make test_user a course admin
    ca = CourseAdmin(course_id=course.id, user_id=test_user.id)
    db.add(ca)
    db.commit()

    response = auth_client.patch(f"/api/courses/{course.id}", json={"name": "Updated Name"})
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Name"


def test_course_admin_can_create_version(auth_client, db, test_user):
    """A course admin can create a new version for their course."""
    course, _ = _make_draft_course(db, slug="admin-course-v")

    ca = CourseAdmin(course_id=course.id, user_id=test_user.id)
    db.add(ca)
    db.commit()

    response = auth_client.post(f"/api/courses/{course.id}/versions", json={"info_md": "New version"})
    assert response.status_code == 201


def test_course_admin_can_access_content(auth_client, db, test_user):
    """A course admin can access published content for their course without enrollment."""
    course, version = _make_published_course(db, slug="admin-content-course")

    ca = CourseAdmin(course_id=course.id, user_id=test_user.id)
    db.add(ca)
    db.commit()

    response = auth_client.get(f"/api/versions/{version.id}/content")
    assert response.status_code == 200


def test_course_admin_cannot_access_other_course_content(auth_client, db, test_user):
    """A course admin for course A cannot access content for course B without enrollment."""
    course_a, _ = _make_published_course(db, slug="course-a-admin")
    _, version_b = _make_published_course(db, slug="course-b-other")

    # Make test_user admin of course A only
    ca = CourseAdmin(course_id=course_a.id, user_id=test_user.id)
    db.add(ca)
    db.commit()

    response = auth_client.get(f"/api/versions/{version_b.id}/content")
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# 6. Health check is public
# ---------------------------------------------------------------------------

def test_health_check_is_public(client):
    """Health check endpoint does not require authentication."""
    response = client.get("/health")
    assert response.status_code == 200
