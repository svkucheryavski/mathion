from datetime import datetime, timezone

import pytest

from mathion.models import Course, CourseAdmin, CourseVersion
from mathion.models_auth import StudentEnrollment, User

CSRF = {"X-Requested-With": "mathion"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_published_course(db, slug="test-course"):
    """Create a course with one published version and return (course, version)."""
    course = Course(slug=slug, name="Test Course", description="")
    db.add(course)
    db.commit()
    db.refresh(course)

    version = CourseVersion(course_id=course.id, state="published", info_md="", info_html="",
                            published_at=datetime.now(timezone.utc))
    db.add(version)
    db.commit()
    db.refresh(version)
    return course, version


def _add_course_admin(db, course_id, user_id):
    admin = CourseAdmin(course_id=course_id, user_id=user_id)
    db.add(admin)
    db.commit()


# ---------------------------------------------------------------------------
# Model tests
# ---------------------------------------------------------------------------

def test_model_create_enrollment(db):
    user = User(email="student@example.com")
    db.add(user)
    db.commit()

    course, version = _make_published_course(db)

    enrollment = StudentEnrollment(user_id=user.id, version_id=version.id)
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)

    assert enrollment.id is not None
    assert enrollment.user_id == user.id
    assert enrollment.version_id == version.id
    assert enrollment.is_active is True
    assert enrollment.created_at is not None
    assert enrollment.user.email == "student@example.com"


def test_model_one_active_enrollment_per_course(db):
    """Deactivating old enrollment and creating a new one works correctly."""
    user = User(email="student@example.com")
    db.add(user)
    db.commit()

    course, version1 = _make_published_course(db, slug="course-a")

    # Create a second published version
    version2 = CourseVersion(course_id=course.id, state="published", info_md="", info_html="",
                              published_at=datetime.now(timezone.utc))
    db.add(version2)
    db.commit()
    db.refresh(version2)

    # Enroll on v1
    e1 = StudentEnrollment(user_id=user.id, version_id=version1.id, is_active=True)
    db.add(e1)
    db.commit()

    # Deactivate e1 and create enrollment on v2
    e1.is_active = False
    e2 = StudentEnrollment(user_id=user.id, version_id=version2.id, is_active=True)
    db.add(e2)
    db.commit()
    db.refresh(e1)
    db.refresh(e2)

    assert e1.is_active is False
    assert e2.is_active is True


# ---------------------------------------------------------------------------
# API tests
# ---------------------------------------------------------------------------

def test_api_enroll_creates_user_and_enrollment(admin_client, db, superuser):
    course, version = _make_published_course(db)
    _add_course_admin(db, course.id, superuser.id)

    response = admin_client.post(
        f"/api/courses/{course.id}/enroll",
        json={"email": "newstudent@example.com"},
        headers=CSRF,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["user_email"] == "newstudent@example.com"
    assert data["version_id"] == version.id
    assert data["is_active"] is True

    # Verify user was created in DB
    user = db.execute(
        __import__("sqlalchemy").select(User).where(User.email == "newstudent@example.com")
    ).scalar_one_or_none()
    assert user is not None
    assert user.full_name is None


def test_api_enroll_existing_user(admin_client, db, superuser):
    course, version = _make_published_course(db)
    _add_course_admin(db, course.id, superuser.id)

    # Pre-create user
    existing_user = User(email="existing@example.com", full_name="Existing Student")
    db.add(existing_user)
    db.commit()

    response = admin_client.post(
        f"/api/courses/{course.id}/enroll",
        json={"email": "existing@example.com"},
        headers=CSRF,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["user_email"] == "existing@example.com"
    assert data["user_full_name"] == "Existing Student"
    assert data["is_active"] is True

    # Verify only one enrollment exists
    from sqlalchemy import select
    enrollments = db.execute(
        select(StudentEnrollment).where(StudentEnrollment.user_id == existing_user.id)
    ).scalars().all()
    assert len(enrollments) == 1


def test_api_enroll_batch(admin_client, db, superuser):
    course, version = _make_published_course(db)
    _add_course_admin(db, course.id, superuser.id)

    response = admin_client.post(
        f"/api/courses/{course.id}/enroll-batch",
        json={"emails": ["a@example.com", "b@example.com", "c@example.com"]},
        headers=CSRF,
    )
    assert response.status_code == 201
    data = response.json()
    assert len(data) == 3
    emails = {item["user_email"] for item in data}
    assert emails == {"a@example.com", "b@example.com", "c@example.com"}
    for item in data:
        assert item["is_active"] is True
        assert item["version_id"] == version.id


def test_api_list_students(admin_client, db, superuser):
    course, version = _make_published_course(db)
    _add_course_admin(db, course.id, superuser.id)

    # Enroll two students
    admin_client.post(
        f"/api/courses/{course.id}/enroll-batch",
        json={"emails": ["s1@example.com", "s2@example.com"]},
        headers=CSRF,
    )

    response = admin_client.get(f"/api/courses/{course.id}/students", headers=CSRF)
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    emails = {item["user_email"] for item in data}
    assert emails == {"s1@example.com", "s2@example.com"}


def test_api_remove_student(admin_client, db, superuser):
    course, version = _make_published_course(db)
    _add_course_admin(db, course.id, superuser.id)

    enroll_resp = admin_client.post(
        f"/api/courses/{course.id}/enroll",
        json={"email": "student@example.com"},
        headers=CSRF,
    )
    user_id = enroll_resp.json()["user_id"]

    delete_resp = admin_client.delete(
        f"/api/courses/{course.id}/students/{user_id}",
        headers=CSRF,
    )
    assert delete_resp.status_code == 204

    # Student should no longer appear in list
    list_resp = admin_client.get(f"/api/courses/{course.id}/students", headers=CSRF)
    assert list_resp.status_code == 200
    assert list_resp.json() == []


def test_api_enroll_no_published_version_returns_409(admin_client, db, superuser):
    # Course with no published version
    course = Course(slug="unpublished-course", name="Unpublished", description="")
    db.add(course)
    db.commit()
    db.refresh(course)

    version = CourseVersion(course_id=course.id, state="created", info_md="", info_html="")
    db.add(version)
    db.commit()

    _add_course_admin(db, course.id, superuser.id)

    response = admin_client.post(
        f"/api/courses/{course.id}/enroll",
        json={"email": "student@example.com"},
        headers=CSRF,
    )
    assert response.status_code == 409
    assert "No published version" in response.json()["detail"]


def test_api_non_admin_cannot_enroll(auth_client, db):
    course, version = _make_published_course(db)
    # Note: test_user is NOT a course admin

    response = auth_client.post(
        f"/api/courses/{course.id}/enroll",
        json={"email": "student@example.com"},
        headers=CSRF,
    )
    assert response.status_code == 403
    assert "Course admin access required" in response.json()["detail"]


def test_api_enroll_after_deactivation_reactivates(admin_client, db, superuser):
    """Re-enrolling a student who was previously removed must reactivate the existing
    inactive row, not insert a duplicate. The unique constraint on
    (user_id, version_id) makes the duplicate path fail with IntegrityError."""
    course, version = _make_published_course(db)
    _add_course_admin(db, course.id, superuser.id)

    # First enrollment
    r1 = admin_client.post(
        f"/api/courses/{course.id}/enroll",
        json={"email": "rejoin@example.com"},
        headers=CSRF,
    )
    assert r1.status_code == 201
    user_id = r1.json()["user_id"]

    # Remove the student (deactivates the enrollment)
    r2 = admin_client.delete(
        f"/api/courses/{course.id}/students/{user_id}",
        headers=CSRF,
    )
    assert r2.status_code == 204

    # Re-enroll — must reactivate, not insert duplicate
    r3 = admin_client.post(
        f"/api/courses/{course.id}/enroll",
        json={"email": "rejoin@example.com"},
        headers=CSRF,
    )
    assert r3.status_code == 201
    assert r3.json()["is_active"] is True

    # Exactly one enrollment row should exist for this user+version
    from sqlalchemy import select
    rows = db.execute(
        select(StudentEnrollment).where(
            StudentEnrollment.user_id == user_id,
            StudentEnrollment.version_id == version.id,
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].is_active is True


def test_api_enroll_same_version_returns_existing(admin_client, db, superuser):
    """Enrolling same student on the same version returns the existing active enrollment."""
    course, version = _make_published_course(db)
    _add_course_admin(db, course.id, superuser.id)

    # First enrollment
    r1 = admin_client.post(
        f"/api/courses/{course.id}/enroll",
        json={"email": "student@example.com"},
        headers=CSRF,
    )
    assert r1.status_code == 201
    enrollment1_id = r1.json()["id"]

    # Second enrollment on same version returns existing
    r2 = admin_client.post(
        f"/api/courses/{course.id}/enroll",
        json={"email": "student@example.com"},
        headers=CSRF,
    )
    assert r2.status_code == 201
    enrollment2_id = r2.json()["id"]
    assert enrollment2_id == enrollment1_id

    # Only one enrollment exists
    from sqlalchemy import select
    enrollments = db.execute(
        select(StudentEnrollment).where(StudentEnrollment.user_id == r1.json()["user_id"])
    ).scalars().all()
    assert len(enrollments) == 1
    assert enrollments[0].is_active is True


def test_api_remove_nonexistent_student(admin_client, db, superuser):
    """Removing a student that doesn't exist returns 404."""
    course, _ = _make_published_course(db)
    _add_course_admin(db, course.id, superuser.id)
    response = admin_client.delete(f"/api/courses/{course.id}/students/9999")
    assert response.status_code == 404
