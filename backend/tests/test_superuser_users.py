"""The superuser panel's Users API (spec D14-D21, D25)."""
from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient

from mathion.auth import request_pin, validate_session, verify_pin
from mathion.main import app
from mathion.models import (
    Asset, Block, Course, CourseAdmin, CourseVersion, Evaluation, Group, Item, MiniProject, Run,
    RunAsset, RunStudent, RunTeacher, Sequence, Submission,
)
from mathion.models_auth import (
    LoginPIN, NotificationLogEntry, Session, StudentEnrollment, User, UserItemState,
)
from mathion.superuser import service as panel_service


@pytest.fixture
def panel(admin_client, db):
    """(client, base path) for a superuser with a live panel token."""
    token = panel_service.mint(db)
    return admin_client, f"/api/superuser/{token}"


def _user(db, email="anna@x", name: str | None = "Anna Holm", **kw):
    u = User(email=email, full_name=name, **kw)
    db.add(u)
    db.commit()
    return u


def _msg(r) -> str:
    """The sentence the panel shows: a plain detail, or a 422's first msg."""
    d = r.json()["detail"]
    return d if isinstance(d, str) else d[0]["msg"].removeprefix("Value error, ")


def _world(db, slug="stat", name="Statistics 101"):
    """A course with one version, one run, one item, one group and one mini-project."""
    course = Course(slug=slug, name=name, description="")
    db.add(course)
    db.flush()
    version = CourseVersion(course_id=course.id)
    db.add(version)
    db.flush()
    run = Run(version_id=version.id, title="R", start_date=date(2026, 1, 1), end_date=date(2026, 6, 1))
    block = Block(version_id=version.id, title="B", slug="b", order=1)
    db.add_all([run, block])
    db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    group = Group(run_id=run.id, name="G")
    db.add_all([seq, group])
    db.flush()
    item = Item(sequence_id=seq.id, title="I", slug="i", order=1, type="text")
    mp = MiniProject(run_id=run.id, block_id=block.id, assignment_md="a", assignment_html="a")
    db.add_all([item, mp])
    db.commit()
    return {"course": course, "version": version, "run": run, "item": item, "group": group, "mp": mp}


def _submission(db, w, by):
    sub = Submission(mini_project_id=w["mp"].id, group_id=w["group"].id, submission_number=1,
                     submitted_by=by.id, file_path="x.pdf", file_size=1)
    db.add(sub)
    db.flush()
    return sub


def _rows_by_email(r):
    return {u["email"]: u for u in r.json()["users"]}


# --- list -------------------------------------------------------------------

def test_newest_twenty_and_total(panel, db):
    client, base = panel
    for i in range(25):
        _user(db, f"u{i:02d}@x", None)
    r = client.get(f"{base}/users")
    assert r.status_code == 200
    body = r.json()
    assert [u["email"] for u in body["users"]] == [f"u{i:02d}@x" for i in range(24, 4, -1)]
    assert body["total"] == 26  # the 25 plus the acting superuser
    assert body["counts"]["all"] == 26


def test_same_created_at_orders_by_id_desc(panel, db):
    client, base = panel
    db.add_all([User(email="first@x"), User(email="second@x")])  # one transaction: one now()
    db.commit()
    emails = [u["email"] for u in client.get(f"{base}/users").json()["users"]]
    assert emails.index("second@x") < emails.index("first@x")


def test_search_email_or_name_case_insensitive(panel, db):
    client, base = panel
    _user(db, "anna@x", "Anna Holm")
    _user(db, "bob@x", "Bob HOLMES")
    _user(db, "carl@x", "Carl")
    r = client.get(f"{base}/users", params={"q": "  holm "})
    assert sorted(_rows_by_email(r)) == ["anna@x", "bob@x"]
    assert r.json()["total"] == 2
    r = client.get(f"{base}/users", params={"q": "CARL@"})
    assert list(_rows_by_email(r)) == ["carl@x"]


def test_search_escapes_like(panel, db):
    client, base = panel
    _user(db, "a_b@x", None)
    _user(db, "axb@x", None)
    _user(db, "c%d@x", None)
    _user(db, "cd@x", None)
    _user(db, "e\\f@x", None)
    _user(db, "ef@x", None)
    assert list(_rows_by_email(client.get(f"{base}/users", params={"q": "a_b"}))) == ["a_b@x"]
    assert list(_rows_by_email(client.get(f"{base}/users", params={"q": "c%d"}))) == ["c%d@x"]
    assert list(_rows_by_email(client.get(f"{base}/users", params={"q": "e\\f"}))) == ["e\\f@x"]


def _roles_fixture(db):
    w = _world(db)
    admin = _user(db, "admin@x", "Ada")
    teacher = _user(db, "teacher@x", "Tom", is_disabled=True)
    student = _user(db, "student@x", "Sue")
    _user(db, "nobody@x", "Ned")
    db.add_all([
        CourseAdmin(course_id=w["course"].id, user_id=admin.id),
        RunTeacher(run_id=w["run"].id, user_id=teacher.id),
        RunStudent(run_id=w["run"].id, user_id=student.id),
    ])
    db.commit()
    return w


def test_role_filters_and_totals(panel, db):
    client, base = panel
    _roles_fixture(db)
    expected = {
        "all": ["nobody@x", "student@x", "teacher@x", "admin@x", "admin@example.com"],
        "admins": ["admin@x"],
        "teachers": ["teacher@x"],
        "students": ["student@x"],
        "disabled": ["teacher@x"],
    }
    for role, emails in expected.items():
        r = client.get(f"{base}/users", params={"role": role})
        assert r.status_code == 200, role
        assert [u["email"] for u in r.json()["users"]] == emails, role
        assert r.json()["total"] == len(emails), role
    assert r.json()["counts"] == {"all": 5, "admins": 1, "teachers": 1, "students": 1, "disabled": 1}


def test_role_combines_with_search(panel, db):
    client, base = panel
    _roles_fixture(db)
    r = client.get(f"{base}/users", params={"role": "teachers", "q": "sue"})
    assert r.json()["users"] == [] and r.json()["total"] == 0


def test_unknown_role_422(panel, db):
    client, base = panel
    assert client.get(f"{base}/users", params={"role": "owners"}).status_code == 422


def test_counts_ignore_search(panel, db):
    client, base = panel
    _roles_fixture(db)
    r = client.get(f"{base}/users", params={"q": "ada"})
    assert r.json()["total"] == 1
    assert r.json()["counts"] == {"all": 5, "admins": 1, "teachers": 1, "students": 1, "disabled": 1}


def test_row_shape(panel, db):
    client, base = panel
    w = _world(db, "stat", "Statistics 101")
    other = Course(slug="alg", name="algebra", description="")
    db.add(other)
    db.flush()
    anna = _user(db)
    seen = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
    anna.last_seen_at = seen
    run2 = Run(version_id=w["version"].id, title="R2", start_date=date(2026, 1, 1), end_date=date(2026, 6, 1))
    db.add(run2)
    db.flush()
    db.add_all([
        CourseAdmin(course_id=w["course"].id, user_id=anna.id),
        CourseAdmin(course_id=other.id, user_id=anna.id),
        RunTeacher(run_id=w["run"].id, user_id=anna.id),
        RunTeacher(run_id=run2.id, user_id=anna.id),
        RunStudent(run_id=run2.id, user_id=anna.id),
    ])
    _user(db, "fresh@x", None)
    db.commit()
    rows = _rows_by_email(client.get(f"{base}/users"))
    a = rows["anna@x"]
    assert a["id"] == anna.id and a["full_name"] == "Anna Holm"
    assert a["admin_of"] == [{"id": other.id, "name": "algebra"}, {"id": w["course"].id, "name": "Statistics 101"}]
    assert (a["teacher_runs"], a["student_runs"], a["has_data"]) == (2, 1, True)
    assert datetime.fromisoformat(a["last_seen_at"]) == seen
    assert a["is_superuser"] is False and a["is_disabled"] is False and a["created_at"]
    f = rows["fresh@x"]
    assert (f["admin_of"], f["teacher_runs"], f["student_runs"], f["has_data"], f["last_seen_at"]) == ([], 0, 0, False, None)
    assert rows["admin@example.com"]["is_superuser"] is True


def test_list_requires_panel(client, auth_client, db):
    token = panel_service.mint(db)
    assert client.get(f"/api/superuser/{token}/users").status_code == 401
    assert auth_client.get(f"/api/superuser/{token}/users").status_code == 404


# --- create -----------------------------------------------------------------

def test_create_account_sends_no_email(panel, db):
    client, base = panel
    r = client.post(f"{base}/users", json={"email": "  New@X ", "full_name": "  Nina  "})
    assert r.status_code == 201
    assert (r.json()["email"], r.json()["full_name"]) == ("new@x", "Nina")
    assert (r.json()["has_data"], r.json()["admin_of"]) == (False, [])
    assert db.query(User).filter_by(email="new@x").one()
    assert db.query(NotificationLogEntry).count() == 0


def test_create_without_name(panel, db):
    client, base = panel
    for body in ({"email": "a@x"}, {"email": "b@x", "full_name": "   "}, {"email": "c@x", "full_name": None}):
        r = client.post(f"{base}/users", json=body)
        assert r.status_code == 201, body
        assert r.json()["full_name"] is None, body


def test_create_duplicate_409(panel, db):
    client, base = panel
    _user(db, "anna@x")
    r = client.post(f"{base}/users", json={"email": "ANNA@x"})
    assert (r.status_code, _msg(r)) == (409, "An account with this email already exists")


@pytest.mark.parametrize("email, sentence", [
    ("", "Enter an email address"),
    ("anna", "Enter an email address"),
    ("a@b@c", "Enter an email address"),
    ("a" * 250 + "@x.io", "An email address is at most 254 characters"),
])
def test_create_bad_email_422(panel, db, email, sentence):
    client, base = panel
    r = client.post(f"{base}/users", json={"email": email})
    assert (r.status_code, _msg(r)) == (422, sentence)


@pytest.mark.parametrize("name, sentence", [
    ("x" * 201, "A name is at most 200 characters"),
    ("Anna\nHolm", "A name can't contain line breaks or tabs"),
])
def test_create_bad_name_422(panel, db, name, sentence):
    client, base = panel
    r = client.post(f"{base}/users", json={"email": "a@x", "full_name": name})
    assert (r.status_code, _msg(r)) == (422, sentence)
    assert db.query(User).filter_by(email="a@x").first() is None


# --- edit -------------------------------------------------------------------

def test_edit_name_and_clear_name(panel, db):
    client, base = panel
    anna = _user(db)
    r = client.patch(f"{base}/users/{anna.id}", json={"full_name": " Anna B. Holm "})
    assert (r.status_code, r.json()["full_name"], r.json()["email"]) == (200, "Anna B. Holm", "anna@x")
    r = client.patch(f"{base}/users/{anna.id}", json={"full_name": None})
    assert (r.status_code, r.json()["full_name"]) == (200, None)
    r = client.patch(f"{base}/users/{anna.id}", json={"full_name": "Anna"})
    r = client.patch(f"{base}/users/{anna.id}", json={"full_name": ""})
    assert r.json()["full_name"] is None


def test_edit_needs_a_field(panel, db):
    client, base = panel
    anna = _user(db)
    r = client.patch(f"{base}/users/{anna.id}", json={})
    assert (r.status_code, _msg(r)) == (422, "Send a name or an email")


def test_edit_email_none_422(panel, db):
    client, base = panel
    anna = _user(db)
    r = client.patch(f"{base}/users/{anna.id}", json={"email": None})
    assert (r.status_code, _msg(r)) == (422, "Enter an email address")


def _sign_in(db, user) -> str:
    return verify_pin(db, user.email, request_pin(db, user.email), duration_days=7)


def test_change_email_ends_sessions_and_pins(panel, db):
    client, base = panel
    anna = _user(db)
    token = _sign_in(db, anna)
    request_pin(db, "anna@x")  # an unused PIN, still valid
    used = db.query(LoginPIN).filter_by(user_id=anna.id, is_used=True).count()
    r = client.patch(f"{base}/users/{anna.id}", json={"email": "Anna.Holm@X"})
    assert (r.status_code, r.json()["email"]) == (200, "anna.holm@x")
    db.expire_all()
    assert db.query(Session).filter_by(user_id=anna.id).count() == 0
    assert db.query(LoginPIN).filter_by(user_id=anna.id, is_used=False).count() == 0
    assert db.query(LoginPIN).filter_by(user_id=anna.id, is_used=True).count() == used
    assert validate_session(db, token) is None


def test_change_email_to_same_keeps_sessions(panel, db):
    client, base = panel
    anna = _user(db)
    token = _sign_in(db, anna)
    r = client.patch(f"{base}/users/{anna.id}", json={"email": "ANNA@x"})
    assert r.status_code == 200
    assert validate_session(db, token) is not None


def test_change_email_taken_409(panel, db):
    client, base = panel
    anna = _user(db)
    _user(db, "bob@x", "Bob")
    token = _sign_in(db, anna)
    r = client.patch(f"{base}/users/{anna.id}", json={"email": "bob@x", "full_name": "New"})
    assert (r.status_code, _msg(r)) == (409, "Another account already uses this email")
    db.expire_all()
    assert (db.get(User, anna.id).email, db.get(User, anna.id).full_name) == ("anna@x", "Anna Holm")
    assert validate_session(db, token) is not None


def test_edit_gone_409(panel, db):
    client, base = panel
    anna = _user(db)
    db.delete(anna)
    db.commit()
    for method, url, body in [
        ("PATCH", f"{base}/users/{anna.id}", {"full_name": "X"}),
        ("POST", f"{base}/users/{anna.id}/disable", None),
        ("POST", f"{base}/users/{anna.id}/enable", None),
        ("DELETE", f"{base}/users/{anna.id}", None),
    ]:
        r = client.request(method, url, json=body, headers={"X-Requested-With": "mathion"})
        assert (r.status_code, _msg(r)) == (409, "This account was deleted"), method + url


# --- disable / enable ---------------------------------------------------------

def test_disable_ends_sessions_keeps_admin_row(panel, db):
    client, base = panel
    w = _world(db)
    anna = _user(db)
    db.add(CourseAdmin(course_id=w["course"].id, user_id=anna.id))
    db.commit()
    token = _sign_in(db, anna)
    r = client.post(f"{base}/users/{anna.id}/disable")
    assert (r.status_code, r.json()["is_disabled"]) == (200, True)
    db.expire_all()
    assert db.query(Session).filter_by(user_id=anna.id).count() == 0
    assert db.query(CourseAdmin).filter_by(user_id=anna.id).count() == 1
    assert validate_session(db, token) is None
    assert verify_pin(db, "anna@x", request_pin(db, "anna@x"), duration_days=7) is None


def test_enable(panel, db):
    client, base = panel
    anna = _user(db, is_disabled=True)
    r = client.post(f"{base}/users/{anna.id}/enable")
    assert (r.status_code, r.json()["is_disabled"]) == (200, False)
    db.expire_all()
    assert db.get(User, anna.id).is_disabled is False


# --- delete -------------------------------------------------------------------

def test_delete_unused_account(panel, db):
    client, base = panel
    anna = _user(db)
    _sign_in(db, anna)
    request_pin(db, "anna@x")
    uid = anna.id
    db.add(NotificationLogEntry(user_id=uid, kind="x", payload={}))
    db.commit()
    r = client.delete(f"{base}/users/{uid}", headers={"X-Requested-With": "mathion"})
    assert r.status_code == 204
    db.expire_all()
    assert db.get(User, uid) is None
    assert db.query(Session).filter_by(user_id=uid).count() == 0
    assert db.query(LoginPIN).filter_by(user_id=uid).count() == 0
    assert db.query(NotificationLogEntry).filter_by(user_id=uid).count() == 0


def _ref_course_admin(db, w, u):
    db.add(CourseAdmin(course_id=w["course"].id, user_id=u.id))


def _ref_run_teacher(db, w, u):
    db.add(RunTeacher(run_id=w["run"].id, user_id=u.id))


def _ref_run_student(db, w, u):
    db.add(RunStudent(run_id=w["run"].id, user_id=u.id))


def _ref_enrollment(db, w, u):
    db.add(StudentEnrollment(user_id=u.id, version_id=w["version"].id))


def _ref_item_state(db, w, u):
    db.add(UserItemState(user_id=u.id, item_id=w["item"].id))


def _ref_submission(db, w, u):
    _submission(db, w, u)


def _ref_evaluation(db, w, u):
    sub = _submission(db, w, _user(db, "author@x", None))
    db.add(Evaluation(submission_id=sub.id, evaluated_by=u.id, result="accepted"))


def _ref_run_created(db, w, u):
    w["run"].created_by = u.id


def _ref_asset(db, w, u):
    db.add(Asset(version_id=w["version"].id, filename="a.png", file_size=1, mime_type="image/png", uploaded_by=u.id))


def _ref_run_asset(db, w, u):
    db.add(RunAsset(run_id=w["run"].id, filename="a.png", file_size=1, mime_type="image/png", uploaded_by=u.id))


BLOCKING = [_ref_course_admin, _ref_run_teacher, _ref_run_student, _ref_enrollment, _ref_item_state,
            _ref_submission, _ref_evaluation, _ref_run_created, _ref_asset, _ref_run_asset]


@pytest.mark.parametrize("add_ref", BLOCKING, ids=lambda f: f.__name__.removeprefix("_ref_"))
def test_delete_refused_for_each_kind_of_data(panel, db, add_ref):
    client, base = panel
    w = _world(db)
    anna = _user(db)
    add_ref(db, w, anna)
    db.commit()
    assert _rows_by_email(client.get(f"{base}/users"))["anna@x"]["has_data"] is True
    r = client.delete(f"{base}/users/{anna.id}", headers={"X-Requested-With": "mathion"})
    assert (r.status_code, _msg(r)) == (409, "This account has data and can only be disabled")
    db.expire_all()
    assert db.get(User, anna.id) is not None


# --- superusers (D21) ---------------------------------------------------------

def test_superuser_rows_refuse_disable_delete_email(panel, db, superuser):
    client, base = panel
    other = _user(db, "root2@x", "Root", is_superuser=True)
    for target in (superuser, other):
        for method, url, body in [
            ("POST", f"{base}/users/{target.id}/disable", None),
            ("DELETE", f"{base}/users/{target.id}", None),
            ("PATCH", f"{base}/users/{target.id}", {"email": "new@x"}),
            ("PATCH", f"{base}/users/{target.id}", {"email": "new@x", "full_name": "N"}),
        ]:
            r = client.request(method, url, json=body, headers={"X-Requested-With": "mathion"})
            assert (r.status_code, _msg(r)) == (403, "A superuser account can't be changed here"), (target.email, method, url)
    db.expire_all()
    for target in (superuser, other):
        u = db.get(User, target.id)
        assert u is not None and not u.is_disabled and u.email in ("admin@example.com", "root2@x")
    assert client.get(f"{base}/users").status_code == 200  # still signed in


def test_superuser_name_can_be_edited(panel, db, superuser):
    client, base = panel
    r = client.patch(f"{base}/users/{superuser.id}", json={"full_name": "Chief"})
    assert (r.status_code, r.json()["full_name"]) == (200, "Chief")


# --- CSRF ---------------------------------------------------------------------

def test_writes_need_csrf(panel, db):
    client, base = panel
    anna = _user(db)
    plain = TestClient(app)
    plain.cookies = client.cookies
    calls = [
        ("POST", f"{base}/users", {"email": "n@x"}),
        ("PATCH", f"{base}/users/{anna.id}", {"full_name": "X"}),
        ("POST", f"{base}/users/{anna.id}/disable", None),
        ("POST", f"{base}/users/{anna.id}/enable", None),
        ("DELETE", f"{base}/users/{anna.id}", None),
    ]
    for method, url, body in calls:
        r = plain.request(method, url, json=body)
        assert r.status_code == 403, (method, url, r.status_code)
    db.expire_all()
    assert (db.get(User, anna.id).full_name, db.get(User, anna.id).is_disabled) == ("Anna Holm", False)
