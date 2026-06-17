from datetime import date, timedelta
import os

import pytest
from fastapi.testclient import TestClient as BaseTestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# ---- MUST RUN BEFORE any mathion.* import — Settings() in config.py:29
# is constructed at import time and snapshots MATHION_EMAIL_MODE.
os.environ.setdefault("MATHION_EMAIL_MODE", "disabled")

# ---- mathion.* imports follow after the env-set is applied.
from mathion.config import settings
from mathion.database import Base, get_db
from mathion.main import app
from mathion.models_auth import User
from mathion.auth import request_pin, verify_pin


def pytest_configure(config):
    assert settings.email_mode == "disabled", (
        f"Test conftest race: settings.email_mode is {settings.email_mode!r} but "
        "the disable_dispatcher_loop recipe expects 'disabled'. A pyproject.toml "
        "plugin or parent conftest imported mathion.config before this conftest's "
        "os.environ.setdefault could run."
    )


# Module-level test-date helpers. Replace hardcoded YYYY-MM-DD strings that
# rot once today crosses them (MP publish requires hard_deadline > now;
# run publish requires end_date >= deadlines). Ordering:
#   NEAR_DEADLINE_ISO  <  FAR_DEADLINE_ISO  <  RUN_END_DATE  <  RUN_END_DATE_FAR
NEAR_DEADLINE_ISO = f"{(date.today() + timedelta(days=60)).isoformat()}T23:59:00Z"
FAR_DEADLINE_ISO = f"{(date.today() + timedelta(days=120)).isoformat()}T23:59:00Z"
RUN_END_DATE = (date.today() + timedelta(days=180)).isoformat()
RUN_END_DATE_FAR = (date.today() + timedelta(days=365)).isoformat()


class CSRFTestClient(BaseTestClient):
    def post(self, *args, **kwargs):
        kwargs.setdefault("headers", {})
        kwargs["headers"].setdefault("X-Requested-With", "mathion")
        return super().post(*args, **kwargs)

    def patch(self, *args, **kwargs):
        kwargs.setdefault("headers", {})
        kwargs["headers"].setdefault("X-Requested-With", "mathion")
        return super().patch(*args, **kwargs)

    def put(self, *args, **kwargs):
        kwargs.setdefault("headers", {})
        kwargs["headers"].setdefault("X-Requested-With", "mathion")
        return super().put(*args, **kwargs)

    def delete(self, *args, **kwargs):
        kwargs.setdefault("headers", {})
        kwargs["headers"].setdefault("X-Requested-With", "mathion")
        return super().delete(*args, **kwargs)

test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(test_engine, "connect")
def set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestSession = sessionmaker(bind=test_engine)


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=test_engine)
    yield
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def db():
    session = TestSession()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    """Bare unauthenticated TestClient. Sets up the db override for the request."""
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    yield CSRFTestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def test_user(db):
    user = User(email="test@example.com", full_name="Test User")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def superuser(db):
    user = User(email="admin@example.com", full_name="Admin", is_superuser=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# auth_client and admin_client return INDEPENDENT TestClient instances with
# their own cookie jars. Tests can request both in the same signature without
# cookies overlapping. Both share the same db override via the `client`
# fixture's setup (we depend on it for that side effect).


@pytest.fixture
def auth_client(client, db, test_user):
    c = CSRFTestClient(app)
    raw_pin = request_pin(db, test_user.email)
    token = verify_pin(db, test_user.email, raw_pin, duration_days=7)
    c.cookies.set("session_token", token)
    return c


@pytest.fixture
def admin_client(client, db, superuser):
    c = CSRFTestClient(app)
    raw_pin = request_pin(db, superuser.email)
    token = verify_pin(db, superuser.email, raw_pin, duration_days=7)
    c.cookies.set("session_token", token)
    return c


@pytest.fixture
def teacher_user(db):
    user = User(email="teacher@example.com", full_name="Teacher User")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def teacher_client(client, db, teacher_user):
    """An authenticated client for a non-admin user. Tests that need this user
    to be a RunTeacher on a specific run must add the RunTeacher row directly
    (the user is plain — not a course admin and not a superuser)."""
    c = CSRFTestClient(app)
    raw_pin = request_pin(db, teacher_user.email)
    token = verify_pin(db, teacher_user.email, raw_pin, duration_days=7)
    c.cookies.set("session_token", token)
    return c


@pytest.fixture
def seed_publishable_version(admin_client, db):
    """Create a course + version with a single static-page item, then publish.
    Returns a callable; tests do `course, version = seed_publishable_version()`.
    Used across run/teacher/group/roster test files."""
    from mathion.models import Block, Sequence, Item

    def _seed(slug="stats", name="Stats"):
        course = admin_client.post(
            "/api/courses", json={"slug": slug, "name": name, "description": ""}
        ).json()
        version = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        block = Block(version_id=version["id"], title="B", slug="b", order=1)
        db.add(block); db.flush()
        seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
        db.add(seq); db.flush()
        db.add(Item(sequence_id=seq.id, title="I", slug="i", order=1, type="static_page",
                    content_md="x", content_html="<p>x</p>"))
        db.commit()
        admin_client.post(f"/api/versions/{version['id']}/publish")
        return course, version

    return _seed


@pytest.fixture(autouse=True)
def asset_tmpdir(tmp_path):
    """Override settings.asset_path to a tmp dir for every test.

    autouse=True ensures any unintended file write is sandboxed to the
    per-test tmpdir, never the configured production asset_path.
    """
    original = settings.asset_path
    settings.asset_path = str(tmp_path)
    yield tmp_path
    settings.asset_path = original


@pytest.fixture
def student_client_for(client, db):
    """Return a factory: email -> CSRFTestClient logged in as that user.

    Uses the standard request_pin/verify_pin flow (same pattern as auth_client
    and admin_client). The user must already exist in the db.
    """
    def _factory(email: str) -> CSRFTestClient:
        raw_pin = request_pin(db, email)
        assert raw_pin is not None, f"request_pin returned None for {email}; user may not exist"
        token = verify_pin(db, email, raw_pin, duration_days=7)
        c = CSRFTestClient(app)
        c.cookies.set("session_token", token)
        return c
    return _factory


@pytest.fixture
def seed_run_with_published_mp(admin_client, db, seed_run_with_groups):
    """Factory: returns (run, group_a, group_b, mini_project). Promoted from
    test_submissions.py per C26 (rev 2). The underlying run already has two
    groups with alice/bob assigned, so submission paths work without extra
    setup.

    Optional overrides (kwargs):
        assignment_md: defaults to "Report."
        hard_deadline: ISO string, defaults to NEAR_DEADLINE_ISO
        resubmission_deadline: ISO string, defaults to FAR_DEADLINE_ISO
        publish: bool, defaults to True (POSTs /publish after create)
    """
    from sqlalchemy import select

    def _factory(**overrides):
        from mathion.models import Block, Run
        run, ga, gb = seed_run_with_groups()
        run_obj = db.get(Run, run["id"])
        block = db.execute(
            select(Block).where(Block.version_id == run_obj.version_id)
        ).scalars().first()
        mp = admin_client.post(
            f"/api/runs/{run['id']}/mini-projects",
            json={
                "block_id": block.id,
                "assignment_md": overrides.get("assignment_md", "Report."),
                "hard_deadline": overrides.get("hard_deadline", NEAR_DEADLINE_ISO),
                "resubmission_deadline": overrides.get(
                    "resubmission_deadline", FAR_DEADLINE_ISO
                ),
            },
        ).json()
        if overrides.get("publish", True):
            admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
        return run, ga, gb, mp

    return _factory


@pytest.fixture
def seed_two_published_runs_same_course(db, seed_publishable_version):
    """Factory: returns (run_a, run_b, student) as ORM objects. Both runs are
    published, share the same course/version, and `student` is an active
    RunStudent on BOTH (legacy duplicate scenario). Used by the constraint
    helper + add_student endpoint tests, plus the student-MP resolver D6
    test (which also requires `run_b.start_date > run_a.start_date` so the
    defensive pick deterministically lands on `run_b`).

    A StudentEnrollment row is also created so resolvers that gate on
    `StudentEnrollment.is_active` (e.g. `_resolve_student_run`) treat the
    student as enrolled. The existing A4-A6 constraint tests do not
    inspect StudentEnrollment, so the extra row is harmless to them.

    Inline run/user creation (no admin_client API hops) — published-run gate
    is irrelevant to this fixture's purpose, so set is_published=True directly.
    """
    from datetime import date as _date

    def _factory():
        from mathion.models import Run, RunStudent
        from mathion.models_auth import StudentEnrollment
        course, version = seed_publishable_version()
        run_a = Run(
            version_id=version["id"],
            title="Spring 26",
            start_date=_date(2026, 1, 1),
            end_date=_date(2026, 6, 1),
            is_published=True,
        )
        run_b = Run(
            version_id=version["id"],
            title="Summer 26",
            start_date=_date(2026, 6, 1),
            end_date=_date(2026, 12, 1),
            is_published=True,
        )
        db.add_all([run_a, run_b])
        db.flush()
        student = User(email="s@example.com", full_name="Sam")
        db.add(student)
        db.flush()
        db.add(RunStudent(run_id=run_a.id, user_id=student.id))
        db.add(RunStudent(run_id=run_b.id, user_id=student.id))
        db.add(StudentEnrollment(
            user_id=student.id, version_id=version["id"], is_active=True,
        ))
        db.commit()
        db.refresh(run_a)
        db.refresh(run_b)
        db.refresh(student)
        return run_a, run_b, student

    return _factory


@pytest.fixture
def seed_run_and_draft_run_same_course(db, seed_publishable_version):
    """Factory: returns (published_run, draft_run, student) as ORM objects.
    Both runs share the same course/version. `student` is an active RunStudent
    on the DRAFT (is_published=False) run only. Used to verify that the
    constraint helper excludes unpublished runs from the conflict set."""
    from datetime import date as _date

    def _factory():
        from mathion.models import Run, RunStudent
        course, version = seed_publishable_version()
        published_run = Run(
            version_id=version["id"],
            title="Spring 26",
            start_date=_date(2026, 1, 1),
            end_date=_date(2026, 6, 1),
            is_published=True,
        )
        draft_run = Run(
            version_id=version["id"],
            title="Summer 26 (draft)",
            start_date=_date(2026, 6, 1),
            end_date=_date(2026, 12, 1),
            is_published=False,
        )
        db.add_all([published_run, draft_run])
        db.flush()
        student = User(email="s@example.com", full_name="Sam")
        db.add(student)
        db.flush()
        db.add(RunStudent(run_id=draft_run.id, user_id=student.id))
        db.commit()
        db.refresh(published_run)
        db.refresh(draft_run)
        db.refresh(student)
        return published_run, draft_run, student

    return _factory


@pytest.fixture
def seed_run_with_groups(admin_client, seed_publishable_version, asset_tmpdir):
    """Create a published run with groups_enabled, two groups each with one student.

    Returns a factory that creates (run, group_a, group_b). All entities are
    committed and ready to use. Run is is_published=True. Asset writes are
    redirected to tmp via asset_tmpdir.
    """
    def _factory():
        course, _ = seed_publishable_version()
        run_resp = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01", "end_date": RUN_END_DATE_FAR, "groups_enabled": True},
        )
        assert run_resp.status_code == 201
        run = run_resp.json()
        admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "teach@example.com"})
        ga = admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "Group A"}).json()
        gb = admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "Group B"}).json()
        # Publish before adding students (gate requires is_published=True)
        pub = admin_client.post(f"/api/runs/{run['id']}/publish")
        assert pub.status_code == 200
        admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "alice@example.com", "group_id": ga["id"]})
        admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "bob@example.com", "group_id": gb["id"]})
        return run, ga, gb
    return _factory


@pytest.fixture
def make_user(db):
    """Factory: create a User with an auto-generated email. Used by tests that
    need a bare user with no enrollments / no run membership.

    Usage: `student = make_user()` or `student = make_user(email="x@y")`.
    """
    counter = {"n": 0}

    def _factory(email: str | None = None, full_name: str = "Test User") -> User:
        counter["n"] += 1
        if email is None:
            email = f"user{counter['n']}@example.com"
        u = User(email=email, full_name=full_name)
        db.add(u)
        db.commit()
        db.refresh(u)
        return u

    return _factory


@pytest.fixture
def seed_published_course(db, seed_publishable_version):
    """Factory: returns a Course ORM object with a published, non-disabled
    CourseVersion but NO StudentEnrollment for any user. Used by student MP
    resolver tests for the 404 'not enrolled in this course' branch.
    """
    from sqlalchemy import select as _select
    from mathion.models import Course

    def _factory(slug: str = "lonely-course", name: str = "Lonely"):
        course_dict, _version_dict = seed_publishable_version(slug=slug, name=name)
        return db.execute(
            _select(Course).where(Course.id == course_dict["id"])
        ).scalar_one()

    return _factory


@pytest.fixture
def seed_published_course_version_with_enrollment_only(db, seed_publishable_version):
    """Factory: returns (student, course) where student has an active
    StudentEnrollment on a published, non-disabled CourseVersion but NO
    RunStudent row on any run of that course. Used by student MP resolver
    tests for the 403 'no active run for this course' branch.
    """
    from sqlalchemy import select as _select
    from mathion.models import Course
    from mathion.models_auth import StudentEnrollment

    def _factory(slug: str = "enroll-only", name: str = "Enroll Only",
                 email: str = "enrolled-only@example.com"):
        course_dict, version_dict = seed_publishable_version(slug=slug, name=name)
        course = db.execute(
            _select(Course).where(Course.id == course_dict["id"])
        ).scalar_one()
        student = User(email=email, full_name="Enrolled Only")
        db.add(student)
        db.flush()
        db.add(StudentEnrollment(
            user_id=student.id, version_id=version_dict["id"], is_active=True,
        ))
        db.commit()
        db.refresh(student)
        return student, course

    return _factory
