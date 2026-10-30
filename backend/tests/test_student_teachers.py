"""D80 (Polish 2): GET /api/courses/{slug}/my-teachers — the names of the
teachers of the student's own run, for the course page's Teachers card.

Names only: a teacher's email is their PIN sign-in name, so it never leaves
the server. Disabled teachers and teachers without a name are skipped.
The run lookup is `_resolve_student_run` (the mini-project endpoints'), so
401 / 404 / 403 mirror the mini-project list.
"""

from __future__ import annotations

from sqlalchemy import select

from mathion.models_auth import User

from tests.conftest import RUN_END_DATE_FAR


def _set_user(db, email: str, **fields) -> None:
    user = db.execute(select(User).where(User.email == email)).scalar_one()
    for k, v in fields.items():
        setattr(user, k, v)
    db.commit()


def _run_with(admin_client, course: dict, teachers: list[str], students: list[str]) -> dict:
    run = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01",
              "end_date": RUN_END_DATE_FAR, "groups_enabled": False},
    ).json()
    for email in teachers:
        r = admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": email})
        assert r.status_code == 201, r.text
    pub = admin_client.post(f"/api/runs/{run['id']}/publish")
    assert pub.status_code == 200, pub.text
    for email in students:
        r = admin_client.post(f"/api/runs/{run['id']}/students", json={"email": email})
        assert r.status_code == 201, r.text
    return run


def _url(course: dict) -> str:
    return f"/api/courses/{course['slug']}/my-teachers"


def test_names_only_sorted_by_name(admin_client, student_client_for, db, seed_publishable_version):
    course, _v = seed_publishable_version()
    _run_with(admin_client, course, ["zed@example.com", "anna@example.com"], ["alice@example.com"])
    _set_user(db, "zed@example.com", full_name="Zed Olsen")
    _set_user(db, "anna@example.com", full_name="anna Larsen")

    resp = student_client_for("alice@example.com").get(_url(course))

    assert resp.status_code == 200, resp.text
    assert resp.json() == [{"full_name": "anna Larsen"}, {"full_name": "Zed Olsen"}]
    assert "example.com" not in resp.text


def test_skips_disabled_and_nameless_teachers(admin_client, student_client_for, db, seed_publishable_version):
    course, _v = seed_publishable_version()
    _run_with(
        admin_client, course,
        ["named@example.com", "off@example.com", "noname@example.com", "blank@example.com"],
        ["alice@example.com"],
    )
    _set_user(db, "named@example.com", full_name="Named Teacher")
    _set_user(db, "off@example.com", full_name="Off Teacher", is_disabled=True)
    _set_user(db, "noname@example.com", full_name=None)
    _set_user(db, "blank@example.com", full_name="   ")

    resp = student_client_for("alice@example.com").get(_url(course))

    assert resp.status_code == 200, resp.text
    assert resp.json() == [{"full_name": "Named Teacher"}]


def test_only_the_students_own_run(admin_client, student_client_for, db, seed_publishable_version):
    """Another run of the same course has its own teacher; it never leaks."""
    course, _v = seed_publishable_version()
    _run_with(admin_client, course, ["mine@example.com"], ["alice@example.com"])
    _run_with(admin_client, course, ["other@example.com"], ["bob@example.com"])
    _set_user(db, "mine@example.com", full_name="My Teacher")
    _set_user(db, "other@example.com", full_name="Other Teacher")

    resp = student_client_for("alice@example.com").get(_url(course))

    assert resp.status_code == 200, resp.text
    assert resp.json() == [{"full_name": "My Teacher"}]


def test_empty_list_when_no_named_teacher(admin_client, student_client_for, db, seed_publishable_version):
    """A published run needs a teacher; here the only one has no name."""
    course, _v = seed_publishable_version()
    _run_with(admin_client, course, ["noname@example.com"], ["alice@example.com"])
    _set_user(db, "noname@example.com", full_name=None)

    resp = student_client_for("alice@example.com").get(_url(course))

    assert resp.status_code == 200, resp.text
    assert resp.json() == []


def test_401_without_session(client, seed_publishable_version):
    course, _v = seed_publishable_version()
    assert client.get(_url(course)).status_code == 401


def test_403_when_enrolled_without_a_run(student_client_for, seed_published_course_version_with_enrollment_only):
    student, course = seed_published_course_version_with_enrollment_only()
    resp = student_client_for(student.email).get(f"/api/courses/{course.slug}/my-teachers")
    assert resp.status_code == 403


def test_404_when_course_missing(auth_client):
    assert auth_client.get("/api/courses/no-such-course/my-teachers").status_code == 404
