"""The superuser panel's Courses API (spec D4-D13, D25)."""
from datetime import date

import pytest
from fastapi.testclient import TestClient

from mathion.config import settings
from mathion.main import app
from mathion.models import (
    Block, Course, CourseAdmin, CourseVersion, Item, Run, RunStudent, Sequence,
)
from mathion.models_auth import NotificationLogEntry, StudentEnrollment, User, UserItemState
from mathion.superuser import service as panel_service


@pytest.fixture
def panel(admin_client, db, monkeypatch):
    """(client, base path) for a superuser with a live panel token; email set up."""
    monkeypatch.setattr(settings, "email_mode", "memory")
    token = panel_service.mint(db)
    return admin_client, f"/api/superuser/{token}"


def _course(db, slug="stat", name="Statistics 101", *, admin=None, versions=1, runs=0, students=0):
    course = Course(slug=slug, name=name, description="")
    db.add(course)
    db.flush()
    vs = [CourseVersion(course_id=course.id) for _ in range(versions)]
    db.add_all(vs)
    db.flush()
    if admin is not None:
        db.add(CourseAdmin(course_id=course.id, user_id=admin.id))
    for i in range(runs):
        run = Run(version_id=vs[0].id, title=f"R{i}", start_date=date(2026, 1, 1), end_date=date(2026, 6, 1))
        db.add(run)
        db.flush()
        for j in range(students):
            u = User(email=f"s{j}@{slug}.x")
            if i == 0:
                db.add(u)
                db.flush()
            else:
                u = db.query(User).filter_by(email=f"s{j}@{slug}.x").one()
            db.add(RunStudent(run_id=run.id, user_id=u.id))
    db.commit()
    return course, vs


def _user(db, email="anna@x", name: str | None = "Anna Holm", **kw):
    u = User(email=email, full_name=name, **kw)
    db.add(u)
    db.commit()
    return u


def _log_rows(db):
    return db.query(NotificationLogEntry).filter_by(kind="course_admin_assigned").all()


# --- list ---------------------------------------------------------------

def test_list_shape_and_counts(panel, db):
    client, base = panel
    anna = _user(db)
    _course(db, "beta", "Beta", admin=anna, versions=2, runs=2, students=2)
    _course(db, "alpha", "alpha", versions=1)
    _course(db, "big-b", "B", versions=0)
    _course(db, "small-b", "b", versions=0)  # created after "B": lower(name) keeps id order
    r = client.get(f"{base}/courses")
    assert r.status_code == 200
    rows = [c for c in r.json() if c["slug"] in ("alpha", "beta")]
    assert [c["slug"] for c in r.json()] == ["alpha", "big-b", "small-b", "beta"]
    beta = rows[1]
    assert beta["admin"] == {"id": anna.id, "email": "anna@x", "full_name": "Anna Holm", "is_disabled": False}
    assert (beta["version_count"], beta["run_count"], beta["student_count"]) == (2, 2, 2)
    assert rows[0]["admin"] is None
    assert (rows[0]["version_count"], rows[0]["run_count"], rows[0]["student_count"]) == (1, 0, 0)


def test_list_requires_panel(client, auth_client, db):
    token = panel_service.mint(db)
    assert client.get(f"/api/superuser/{token}/courses").status_code == 401
    assert auth_client.get(f"/api/superuser/{token}/courses").status_code == 404
    assert auth_client.get("/api/superuser/bogus/courses").status_code == 404


# --- create ---------------------------------------------------------------

def test_create_with_new_admin_creates_account_and_queues(panel, db):
    client, base = panel
    r = client.post(f"{base}/courses", json={"name": "Statistics 101", "slug": "stat", "admin_email": "anna@x.dk"})
    assert r.status_code == 201
    body = r.json()
    assert body["admin_email"] == "queued"
    assert body["admin"]["email"] == "anna@x.dk" and body["admin"]["full_name"] is None
    assert body["course"]["slug"] == "stat" and body["course"]["admin"]["email"] == "anna@x.dk"
    user = db.query(User).filter_by(email="anna@x.dk").one()
    course = db.query(Course).filter_by(slug="stat").one()
    assert db.query(CourseAdmin).filter_by(course_id=course.id).one().user_id == user.id
    assert [(row.user_id, row.payload) for row in _log_rows(db)] == [(user.id, {"course_id": course.id})]


def test_create_normalises_email(panel, db):
    client, base = panel
    r = client.post(f"{base}/courses", json={"name": "S", "slug": "s", "admin_email": "  Anna@X.DK "})
    assert r.status_code == 201
    assert r.json()["admin"]["email"] == "anna@x.dk"


def _msg(r) -> str:
    """The plain sentence a 422 carries for the panel (Task 5 strips the prefix)."""
    return r.json()["detail"][0]["msg"].removeprefix("Value error, ")


@pytest.mark.parametrize("email", ["anna", "   ", "", "a@", "@x", "a b@x", "a@" + "x" * 260])
def test_create_rejects_bad_email(panel, db, email):
    client, base = panel
    r = client.post(f"{base}/courses", json={"name": "S", "slug": "s", "admin_email": email})
    assert r.status_code == 422
    assert _msg(r) in ("Enter an email address", "An email address is at most 254 characters")
    assert db.query(Course).count() == 0


@pytest.mark.parametrize("slug,msg", [
    ("", "Enter an address"),
    ("Stat 101", "An address uses only lowercase letters, digits and single hyphens"),
    ("-stat", "An address uses only lowercase letters, digits and single hyphens"),
    ("a--b", "An address uses only lowercase letters, digits and single hyphens"),
    ("a" * 81, "An address is at most 80 characters"),
])
def test_bad_slug_gets_a_plain_sentence(panel, db, slug, msg):
    client, base = panel
    r = client.post(f"{base}/courses", json={"name": "S", "slug": slug, "admin_email": "a@x"})
    assert r.status_code == 422 and _msg(r) == msg
    course, _ = _course(db)
    r = client.patch(f"{base}/courses/{course.id}", json={"slug": slug})
    assert r.status_code == 422 and _msg(r) == msg


@pytest.mark.parametrize("name", ["", "   ", "Line\nbreak", "Tab\there", "x" * 201])
def test_create_rejects_bad_name(panel, db, name):
    # A control character would make the admin email's Subject raise (T2 review).
    client, base = panel
    r = client.post(f"{base}/courses", json={"name": name, "slug": "s", "admin_email": "a@x"})
    assert r.status_code == 422
    assert _msg(r) in ("Enter a course name", "A course name is at most 200 characters",
                       "A course name can't contain line breaks or tabs")
    assert db.query(Course).count() == 0


def test_create_trims_name(panel, db):
    client, base = panel
    r = client.post(f"{base}/courses", json={"name": "  Stat  ", "slug": "s", "admin_email": "a@x"})
    assert r.json()["course"]["name"] == "Stat"


def test_create_taken_slug_409(panel, db):
    client, base = panel
    _course(db, "stat")
    r = client.post(f"{base}/courses", json={"name": "Other", "slug": "stat", "admin_email": "new@x"})
    assert r.status_code == 409
    assert r.json()["detail"] == "This address is already used by another course"
    assert db.query(User).filter_by(email="new@x").count() == 0


def test_create_existing_disabled_admin_reports_disabled(panel, db):
    client, base = panel
    _user(db, "off@x", "Off", is_disabled=True)
    r = client.post(f"{base}/courses", json={"name": "S", "slug": "s", "admin_email": "off@x"})
    assert r.status_code == 201
    assert r.json()["admin_email"] == "disabled"
    assert r.json()["admin"]["is_disabled"] is True
    assert _log_rows(db) == []


# --- the email outcome (D5a) ------------------------------------------------

def test_assign_with_email_disabled_in_debug_reports_email_off(panel, db, monkeypatch):
    client, base = panel
    monkeypatch.setattr(settings, "debug", True)
    monkeypatch.setattr(settings, "email_mode", "disabled")
    course, _ = _course(db)
    r = client.put(f"{base}/courses/{course.id}/admin", json={"email": "anna@x"})
    assert r.status_code == 200
    assert r.json()["admin_email"] == "email_off"
    assert _log_rows(db) == []


def test_disabled_wins_over_email_off(panel, db, monkeypatch):
    client, base = panel
    monkeypatch.setattr(settings, "email_mode", "disabled")
    _user(db, "off@x", "Off", is_disabled=True)
    course, _ = _course(db)
    assert client.put(f"{base}/courses/{course.id}/admin", json={"email": "off@x"}).json()["admin_email"] == "disabled"


def test_result_carries_pin_minutes_and_sign_in_url(panel, db):
    client, base = panel
    course, _ = _course(db, "stat")
    body = client.put(f"{base}/courses/{course.id}/admin", json={"email": "anna@x"}).json()
    assert body["pin_minutes"] == settings.pin_expiry_minutes
    assert body["sign_in_url"] == f"{settings.base_url}/courses/stat/edit"


# --- assign / remove ---------------------------------------------------------

def test_assign_replaces_in_place(panel, db):
    client, base = panel
    anna, ole = _user(db), _user(db, "ole@x", "Ole")
    course, _ = _course(db, admin=anna)
    row_id = db.query(CourseAdmin).filter_by(course_id=course.id).one().id
    r = client.put(f"{base}/courses/{course.id}/admin", json={"email": "ole@x"})
    assert r.status_code == 200 and r.json()["admin_email"] == "queued"
    db.expire_all()
    row = db.query(CourseAdmin).filter_by(course_id=course.id).one()
    assert (row.id, row.user_id) == (row_id, ole.id)
    assert db.get(User, anna.id) is not None


@pytest.mark.parametrize("disabled,email_mode", [(True, "memory"), (False, "disabled"), (True, "disabled")])
def test_unchanged_wins_over_disabled_and_email_off(panel, db, monkeypatch, disabled, email_mode):
    client, base = panel
    monkeypatch.setattr(settings, "email_mode", email_mode)
    anna = _user(db, is_disabled=disabled)
    course, _ = _course(db, admin=anna)
    assert client.put(f"{base}/courses/{course.id}/admin", json={"email": "anna@x"}).json()["admin_email"] == "unchanged"


def test_assign_same_admin_is_unchanged(panel, db):
    client, base = panel
    anna = _user(db)
    course, _ = _course(db, admin=anna)
    r = client.put(f"{base}/courses/{course.id}/admin", json={"email": " ANNA@x "})
    assert r.json()["admin_email"] == "unchanged"
    assert _log_rows(db) == []


def test_assign_to_course_without_admin_creates_row(panel, db):
    client, base = panel
    course, _ = _course(db)
    client.put(f"{base}/courses/{course.id}/admin", json={"email": "anna@x"})
    assert db.query(CourseAdmin).filter_by(course_id=course.id).count() == 1


def test_remove_admin(panel, db):
    client, base = panel
    course, _ = _course(db, admin=_user(db))
    assert client.delete(f"{base}/courses/{course.id}/admin").status_code == 204
    assert db.query(CourseAdmin).filter_by(course_id=course.id).count() == 0


def test_remove_when_none_409(panel, db):
    client, base = panel
    course, _ = _course(db)
    r = client.delete(f"{base}/courses/{course.id}/admin")
    assert r.status_code == 409 and r.json()["detail"] == "This course has no admin"


def test_assign_gone_course_409(panel, db):
    client, base = panel
    r = client.put(f"{base}/courses/999/admin", json={"email": "anna@x"})
    assert r.status_code == 409 and r.json()["detail"] == "This course was deleted"
    assert db.query(User).filter_by(email="anna@x").count() == 0


# --- update -------------------------------------------------------------------

def test_rename(panel, db):
    client, base = panel
    course, _ = _course(db)
    r = client.patch(f"{base}/courses/{course.id}", json={"name": "Stats II"})
    assert r.status_code == 200 and r.json()["name"] == "Stats II" and r.json()["slug"] == "stat"


def test_change_slug(panel, db):
    client, base = panel
    course, _ = _course(db)
    r = client.patch(f"{base}/courses/{course.id}", json={"slug": "stat-2027"})
    assert r.status_code == 200 and r.json()["slug"] == "stat-2027"


def test_change_slug_taken_409(panel, db):
    client, base = panel
    course, _ = _course(db, "stat")
    _course(db, "taken", "Taken")
    r = client.patch(f"{base}/courses/{course.id}", json={"slug": "taken"})
    assert r.status_code == 409 and r.json()["detail"] == "This address is already used by another course"


def test_update_empty_body_422(panel, db):
    client, base = panel
    course, _ = _course(db)
    assert client.patch(f"{base}/courses/{course.id}", json={}).status_code == 422


def test_update_gone_409(panel, db):
    client, base = panel
    assert client.patch(f"{base}/courses/999", json={"name": "X"}).status_code == 409


# --- delete ---------------------------------------------------------------------

def test_delete_refuses_with_runs_409(panel, db):
    client, base = panel
    course, _ = _course(db, runs=1)
    r = client.delete(f"{base}/courses/{course.id}")
    assert r.status_code == 409 and r.json()["detail"] == "This course has runs and can't be deleted"
    assert db.get(Course, course.id) is not None


def test_delete_removes_course_versions_and_files(panel, db, asset_tmpdir):
    client, base = panel
    anna = _user(db)
    course, vs = _course(db, admin=anna, versions=2)
    student = _user(db, "st@x", "St")
    db.add(StudentEnrollment(user_id=student.id, version_id=vs[0].id, is_active=False))
    item = _item(db, vs[0])
    db.add(UserItemState(user_id=student.id, item_id=item.id))
    db.commit()
    for v in vs:
        d = asset_tmpdir / "courses" / str(v.id)
        d.mkdir(parents=True)
        (d / "x.txt").write_text("x")
    other_dir = asset_tmpdir / "courses" / "999999"
    other_dir.mkdir(parents=True)
    course_id, vids = course.id, [v.id for v in vs]

    assert client.delete(f"{base}/courses/{course_id}").status_code == 204
    db.expire_all()
    assert db.get(Course, course_id) is None
    assert db.query(CourseVersion).filter_by(course_id=course_id).count() == 0
    assert db.query(CourseAdmin).count() == 0
    assert db.query(StudentEnrollment).count() == 0
    assert db.query(UserItemState).count() == 0
    assert all(not (asset_tmpdir / "courses" / str(v)).exists() for v in vids)
    assert other_dir.exists()  # only this course's folders go
    assert db.get(User, anna.id) is not None and db.get(User, student.id) is not None


def _item(db, version, n=1):
    block = Block(version_id=version.id, title="B", slug=f"b{n}", order=n)
    db.add(block)
    db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq)
    db.flush()
    item = Item(sequence_id=seq.id, title="I", slug="i", order=1, type="text")
    db.add(item)
    db.flush()
    return item


def test_delete_impact_counts_progress_excluding_admin_and_superusers(panel, db, superuser):
    client, base = panel
    anna = _user(db)
    course, vs = _course(db, admin=anna)
    item = _item(db, vs[0])
    item2 = _item(db, vs[0], 2)
    people = [_user(db, f"p{i}@x", None) for i in range(3)] + [anna, superuser]
    for p in people:
        db.add(UserItemState(user_id=p.id, item_id=item.id))
    db.add(UserItemState(user_id=people[0].id, item_id=item2.id))  # one person, two items
    db.commit()
    r = client.get(f"{base}/courses/{course.id}/delete-impact")
    assert r.status_code == 200 and r.json() == {"progress_students": 3}


def test_delete_gone_409(panel, db):
    client, base = panel
    assert client.delete(f"{base}/courses/999").status_code == 409
    assert client.get(f"{base}/courses/999/delete-impact").status_code == 409


# --- account lookup --------------------------------------------------------------

def test_lookup_new_existing_disabled(panel, db):
    client, base = panel
    _user(db, "anna@x", "Anna")
    _user(db, "off@x", None, is_disabled=True)
    look = lambda e: client.post(f"{base}/accounts/lookup", json={"email": e}).json()
    assert look("new@x") == {"status": "new", "full_name": None}
    assert look(" ANNA@x") == {"status": "existing", "full_name": "Anna"}
    assert look("off@x") == {"status": "disabled", "full_name": None}
    assert db.query(User).filter_by(email="new@x").count() == 0


# --- CSRF and the old endpoint --------------------------------------------------

def test_writes_need_csrf(panel, db):
    client, base = panel
    course, _ = _course(db)
    plain = TestClient(app)
    plain.cookies = client.cookies
    calls = [
        ("POST", f"{base}/courses", {"name": "S", "slug": "s", "admin_email": "a@x"}),
        ("PATCH", f"{base}/courses/{course.id}", {"name": "X"}),
        ("PUT", f"{base}/courses/{course.id}/admin", {"email": "a@x"}),
        ("DELETE", f"{base}/courses/{course.id}/admin", None),
        ("DELETE", f"{base}/courses/{course.id}", None),
        ("POST", f"{base}/accounts/lookup", {"email": "a@x"}),
    ]
    for method, url, body in calls:
        r = plain.request(method, url, json=body)
        assert r.status_code == 403, (method, url, r.status_code)


def test_old_course_delete_is_gone(admin_client, db):
    # D12b: removed. main.py's /api catch-all answers any unmatched method 404.
    course, _ = _course(db)
    assert admin_client.delete(f"/api/courses/{course.id}").status_code == 404
    assert db.get(Course, course.id) is not None
