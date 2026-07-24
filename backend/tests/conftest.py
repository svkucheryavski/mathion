from datetime import date, timedelta
import os

import pytest
from fastapi.testclient import TestClient as BaseTestClient
from sqlalchemy import text
from sqlalchemy.engine import make_url

# ---- MUST RUN BEFORE any mathion.* import. Settings() snapshots the env at
# import time. We ASSIGN (never setdefault) MATHION_DATABASE_URL to a DISTINCT
# test database so the app engine, dispatcher/CLI SessionLocal(), and Alembic all
# share ONE engine bound to the test DB — and so an exported dev/prod URL can
# never be inherited into the destructive DROP SCHEMA/TRUNCATE path below.
_PRIOR_APP_DB_URL = os.environ.get("MATHION_DATABASE_URL")  # captured for the guard
_TEST_DB_URL = os.environ.get(
    "MATHION_TEST_DATABASE_URL",
    "postgresql+psycopg://mathion:mathion@localhost:5432/mathion_test",
)
os.environ["MATHION_DATABASE_URL"] = _TEST_DB_URL
os.environ.setdefault("MATHION_EMAIL_MODE", "disabled")

# ---- mathion.* imports follow after the env is applied.
from mathion.config import settings
from mathion.database import Base, SessionLocal, engine, get_db
from mathion.main import app
from mathion.models_auth import User
from mathion.auth import request_pin, verify_pin


def _same_destructive_target(url_a: str, url_b: str) -> bool:
    """True if two URLs plausibly identify the SAME physical database.

    Compares (resolved host address set, effective port, database) — NOT the
    login user (a different role is not a different database). Conservative:
    on any resolution error, treat as the same target (abort-safe).
    """
    import socket

    a, b = make_url(url_a), make_url(url_b)
    if (a.database or "") != (b.database or ""):
        return False
    if (a.port or 5432) != (b.port or 5432):
        return False

    def addrs(host: str) -> set:
        try:
            return {ai[4][0] for ai in socket.getaddrinfo(host or "localhost", None)}
        except OSError:
            return set()

    aa, ba = addrs(a.host or "localhost"), addrs(b.host or "localhost")
    if not aa or not ba:
        return True  # cannot resolve -> conservatively "same"
    return bool(aa & ba)  # address-set OVERLAP, not full identity


def _host_is_local(host: str) -> bool:
    """True only if the host resolves EXCLUSIVELY to loopback addresses.

    Conservative: an unresolvable host, or one with any non-loopback address,
    returns False so the §5(c) rail demands an explicit opt-in before it can
    DROP SCHEMA on a non-local database.
    """
    import ipaddress
    import socket

    try:
        addresses = {ai[4][0] for ai in socket.getaddrinfo(host or "localhost", None)}
    except OSError:
        return False
    if not addresses:
        return False
    try:
        return all(ipaddress.ip_address(a).is_loopback for a in addresses)
    except ValueError:
        return False


# libpq/psycopg query keys that can redirect the EFFECTIVE connection target away
# from the URL authority (host:port/database). make_url() only parses the authority,
# so a URL like .../mathion_test?dbname=mathion passes the name rail yet actually
# connects to `mathion`, and ?host=remote bypasses the non-local rail. Reject them.
_CONNECTION_INDIRECTION_KEYS = frozenset(
    {"host", "hostaddr", "port", "dbname", "service", "servicefile"}
)


def _reject_connection_indirection(label: str, url_str: str) -> None:
    offending = sorted(
        k for k in make_url(url_str).query if k.lower() in _CONNECTION_INDIRECTION_KEYS
    )
    if offending:
        raise RuntimeError(
            f"Refusing to run: the {label} database URL carries connection-target query "
            f"parameter(s) {offending} that override the URL host/port/database and would "
            "bypass this guard. Put host, port, and database in the URL itself, not the query."
        )


# libpq fills any UNSET connection parameter from these environment variables, so
# they redirect the EFFECTIVE target the same way the query keys above do — but
# invisibly to make_url(). PGHOSTADDR is the sharpest: it overrides the network
# address even when the URL says host=localhost (the host is then used only for
# auth/TLS naming), so the loopback rail would pass while psycopg connects to a
# remote IP. PGSERVICE can inject hostaddr/host/port/dbname via a service file.
# Reject any of them outright rather than reasoning per-field about what the URL
# does or does not pin.
_CONNECTION_INDIRECTION_ENV_VARS = frozenset(
    {"PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGSERVICE", "PGSERVICEFILE"}
)


def _reject_connection_indirection_env() -> None:
    # Truthy check: an empty value (e.g. PGHOST="") is treated by libpq as unset and
    # cannot redirect, so only a non-empty value is a real bypass.
    offending = sorted(k for k in _CONNECTION_INDIRECTION_ENV_VARS if os.environ.get(k))
    if offending:
        raise RuntimeError(
            f"Refusing to run: libpq environment variable(s) {offending} are set. They fill "
            "unset connection parameters and can override the effective host/port/database "
            "(e.g. PGHOSTADDR redirects the network address even when the URL says "
            "host=localhost), bypassing this guard. Unset them before running the test suite."
        )


def pytest_configure(config):
    # Last rail before the destructive DROP SCHEMA/TRUNCATE. Runs at collection.
    # Uses explicit raise (not assert) so `python -O`/PYTHONOPTIMIZE cannot strip a
    # data-loss guard. Every rail validates the EFFECTIVE connection target: query
    # indirection is rejected first and an explicit host is required, so make_url's
    # authority fields ARE what psycopg connects to.
    url = settings.database_url
    # Effective app default when the env var was absent before conftest overwrote it.
    prior = _PRIOR_APP_DB_URL or "postgresql+psycopg://mathion:mathion@localhost:5432/mathion"
    # (0) Reject libpq ENVIRONMENT indirection first: it applies to every psycopg
    # connection this process makes, independent of either URL, so it must fall before
    # we trust any authority field.
    _reject_connection_indirection_env()
    # (0a) Reject libpq QUERY indirection on BOTH URLs before trusting their authority.
    _reject_connection_indirection("test", url)
    _reject_connection_indirection("application", prior)
    parsed = make_url(url)
    # (0b) Require an explicit host so PGHOST / a unix socket cannot redirect the
    # connection somewhere the loopback check never sees.
    if not parsed.host:
        raise RuntimeError(
            "Refusing to run: the test database URL must specify an explicit host "
            "(e.g. localhost). An absent host lets PGHOST/PGSERVICE redirect the "
            "connection past this guard."
        )
    # (0c) Require an explicit port so the destructive target is fully pinned and the
    # same-target check below compares exact ports rather than an assumed 5432 default.
    if parsed.port is None:
        raise RuntimeError(
            "Refusing to run: the test database URL must specify an explicit port "
            "(e.g. :5432) so the destructive target is fully pinned."
        )
    dbname = parsed.database or ""
    if not (dbname == "mathion_test" or dbname.startswith("mathion_test_")):
        raise RuntimeError(
            f"Refusing to run: test DB name {dbname!r} is not mathion_test / mathion_test_*. "
            "The harness DROPs and TRUNCATEs this database."
        )
    # §5(c): a non-local test host requires an exact affirmative opt-in — otherwise
    # a mathion_test* DB on a remote host would get DROP SCHEMA with no extra rail.
    if not _host_is_local(parsed.host) and os.environ.get("MATHION_TEST_ALLOW_NONLOCAL") != "1":
        raise RuntimeError(
            f"Refusing to run: test DB host {parsed.host!r} is not local (does not resolve to "
            "loopback). The harness DROPs SCHEMA on this database. Set "
            "MATHION_TEST_ALLOW_NONLOCAL=1 to explicitly permit a non-local test target."
        )
    if _same_destructive_target(url, prior):
        raise RuntimeError(
            f"Refusing to run: the test DB {url!r} resolves to the SAME physical database "
            f"as the application URL {prior!r}. Point MATHION_TEST_DATABASE_URL at a distinct DB."
        )
    if settings.email_mode != "disabled":
        raise RuntimeError(
            "Test conftest race: settings.email_mode is not 'disabled' — a plugin/parent "
            "conftest imported mathion.config before os.environ could be set."
        )


# Module-level test-date helpers (unchanged from prior harness).
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


def _ensure_test_database_exists():
    """CREATE DATABASE mathion_test if absent, via an autocommit maintenance conn."""
    import psycopg
    from psycopg import sql

    u = make_url(settings.database_url)
    # Derive the maintenance DSN from the parsed URL rather than interpolating —
    # an f-string injects the literal "None" for passwordless/.pgpass/PGPASSWORD
    # URLs and drops query args (e.g. ?sslmode=require). `.set` swaps the driver
    # (libpq rejects the +psycopg suffix) and database to the postgres maint DB.
    # (pytest_configure already rejected host/dbname/port query indirection, so this
    # maintenance connection cannot be redirected away from the validated target.)
    maint = u.set(
        drivername="postgresql", database="postgres"
    ).render_as_string(hide_password=False)
    with psycopg.connect(maint, autocommit=True) as c:
        exists = c.execute("select 1 from pg_database where datname = %s", (u.database,)).fetchone()
        if not exists:
            try:
                # Identifier() safely quotes the DB name (a mathion_test_* shard could
                # otherwise contain a `"`); DuplicateDatabase tolerates a concurrent
                # harness that created it between the existence check and here.
                c.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(u.database)))
            except psycopg.errors.DuplicateDatabase:
                pass


@pytest.fixture(scope="session", autouse=True)
def _build_schema():
    """Once per session: ensure the test DB exists, reset its schema, run migrations."""
    from alembic import command
    from alembic.config import Config
    from pathlib import Path

    _ensure_test_database_exists()
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    alembic_cfg = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
    command.upgrade(alembic_cfg, "head")
    yield


# All model tables, child-before-parent irrelevant under CASCADE. alembic_version
# is NOT a model table, so it is left intact.
def _truncate_all(conn):
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    # SET LOCAL confines the timeout to this truncate transaction, so it can't
    # leak onto the pooled connection and shorten a later app query's lock wait.
    conn.execute(text("SET LOCAL lock_timeout = '5s'"))
    conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture(autouse=True)
def _isolation():
    """Function-scoped truncation, autouse so a test that writes through the app
    WITHOUT requesting `db` still cannot leak rows into the next test (spec §5).
    `db` also depends on this fixture, so for DB-using tests pytest LIFO-finalizes
    db (session close) BEFORE this truncates — encoding the teardown order."""
    yield
    with engine.begin() as conn:
        _truncate_all(conn)


@pytest.fixture
def db(_isolation):
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    """Bare unauthenticated TestClient sharing the db session via get_db override.
    NOT entered as a context manager — that would start the app lifespan (dispatcher)
    for every test. The client opens no session of its own."""
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
def seed_student_in_two_courses(admin_client, db):
    """Factory: returns (course_x, course_y, mp_ids_in_x, mp_id_in_y, student).

    Builds two distinct courses (X and Y), each with its own published version,
    published run with groups, and a published mini-project. The student is an
    active StudentEnrollment + RunStudent (assigned to Group A) on BOTH courses.
    Used by the C28 cross-course isolation test to assert that the list endpoint
    on course X only returns X's MPs, never Y's.

    A4 invariant note: one-active-RunStudent-per-course is enforced PER COURSE,
    so a student on two DIFFERENT courses is legal — the fixture exploits this
    deliberately.
    """
    from sqlalchemy import select as _select
    from mathion.models import Course

    def _factory():
        from mathion.models import Block, Run

        def _build_one(slug: str, name: str):
            course = admin_client.post(
                "/api/courses", json={"slug": slug, "name": name, "description": ""}
            ).json()
            version = admin_client.post(
                f"/api/courses/{course['id']}/versions", json={"info_md": ""}
            ).json()
            from mathion.models import Block as _Block, Sequence as _Seq, Item as _Item
            b1 = _Block(version_id=version["id"], title="B1", slug="b1", order=1)
            db.add(b1); db.flush()
            seq = _Seq(block_id=b1.id, title="S", slug="s", order=1)
            db.add(seq); db.flush()
            db.add(_Item(sequence_id=seq.id, title="I", slug="i", order=1,
                         type="static_page", content_md="x", content_html="<p>x</p>"))
            db.commit()
            admin_client.post(f"/api/versions/{version['id']}/publish")
            run = admin_client.post(
                f"/api/courses/{course['id']}/runs",
                json={
                    "title": "R",
                    "start_date": "2026-01-01",
                    "end_date": RUN_END_DATE_FAR,
                    "groups_enabled": True,
                },
            ).json()
            ga = admin_client.post(
                f"/api/runs/{run['id']}/groups", json={"name": "Group A"}
            ).json()
            admin_client.post(
                f"/api/runs/{run['id']}/teachers",
                json={"email": f"teach-{slug}@example.com"},
            )
            admin_client.post(f"/api/runs/{run['id']}/publish")
            mp = admin_client.post(
                f"/api/runs/{run['id']}/mini-projects",
                json={
                    "block_id": b1.id,
                    "assignment_md": f"{slug} mp",
                    "hard_deadline": NEAR_DEADLINE_ISO,
                    "resubmission_deadline": FAR_DEADLINE_ISO,
                },
            ).json()
            admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
            return db.execute(
                _select(Course).where(Course.id == course["id"])
            ).scalar_one(), run["id"], ga["id"], mp["id"]

        course_x, run_x_id, ga_x_id, mp_x_id = _build_one("course-x", "Course X")
        course_y, run_y_id, ga_y_id, mp_y_id = _build_one("course-y", "Course Y")

        # Add a SECOND published MP on course_x to make ordering vs isolation
        # easier to assert (block_order=2 lives on a fresh block).
        from mathion.models import Block as _Block2
        b2 = _Block2(
            version_id=db.execute(
                _select(Run).where(Run.id == run_x_id)
            ).scalar_one().version_id,
            title="B2", slug="b2", order=2,
        )
        db.add(b2); db.commit(); db.refresh(b2)
        mp_x2 = admin_client.post(
            f"/api/runs/{run_x_id}/mini-projects",
            json={
                "block_id": b2.id,
                "assignment_md": "course-x mp2",
                "hard_deadline": NEAR_DEADLINE_ISO,
                "resubmission_deadline": FAR_DEADLINE_ISO,
            },
        ).json()
        admin_client.post(f"/api/mini-projects/{mp_x2['id']}/publish")

        # Enroll a single student on BOTH courses and assign to Group A on each.
        admin_client.post(
            f"/api/runs/{run_x_id}/students",
            json={"email": "two-course@example.com", "group_id": ga_x_id},
        )
        admin_client.post(
            f"/api/runs/{run_y_id}/students",
            json={"email": "two-course@example.com", "group_id": ga_y_id},
        )
        student = db.execute(
            _select(User).where(User.email == "two-course@example.com")
        ).scalar_one()
        return course_x, course_y, {mp_x_id, mp_x2["id"]}, mp_y_id, student

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


def _assert_hidden(forbidden, missing):
    """A forbidden response must be byte-indistinguishable from the missing-row 404:
    same status, same raw body, same Content-Type/Content-Length."""
    assert missing.status_code == 404
    assert forbidden.status_code == 404
    assert forbidden.content == missing.content
    assert forbidden.headers["content-type"] == missing.headers["content-type"]
    assert forbidden.headers["content-length"] == missing.headers["content-length"]


class _Concurrency:
    """Owns a dedicated NullPool engine + the worker sessions/threads a
    concurrency test spawns, so teardown can join threads and release
    connections BEFORE the autouse _isolation TRUNCATE."""

    def __init__(self, maker):
        self._maker = maker
        self.sessions = []
        self.threads = []

    def make_sessions(self, n):
        made = [self._maker() for _ in range(n)]
        self.sessions.extend(made)
        return made

    def spawn(self, target, *args, **kwargs):
        import threading
        t = threading.Thread(target=target, args=args, kwargs=kwargs)
        t.start()
        self.threads.append(t)
        return t


@pytest.fixture
def concurrency(_isolation):
    """Dedicated NullPool engine (never the app pool) yielding real separate
    connections for multi-thread race tests. Depends on _isolation so pytest
    LIFO-finalizes this fixture (join threads -> release locks) BEFORE the
    autouse TRUNCATE runs."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import NullPool

    eng = create_engine(
        settings.database_url,
        poolclass=NullPool,
        isolation_level="READ COMMITTED",
        connect_args={
            "connect_timeout": 10,
            "options": "-c statement_timeout=30000 -c TimeZone=UTC",
        },
    )
    helper = _Concurrency(sessionmaker(bind=eng))
    yield helper
    for t in helper.threads:
        t.join(timeout=10)
        if t.is_alive():
            raise RuntimeError("concurrency worker thread did not finish within 10s")
    for s in helper.sessions:
        s.rollback()
        s.close()
    eng.dispose()


def record_lock_calls(monkeypatch):
    """Spy on advisory.advisory_xact_lock: append ('lock', namespace, ids) to a
    shared ordered list, then delegate to the real implementation. Returned list
    lets a wiring/ordering test assert the lock args AND that the lock precedes a
    later-recorded ('read', ...) event."""
    from mathion.api import advisory
    events = []
    real = advisory.advisory_xact_lock

    def spy(db, namespace, *ids):
        events.append(("lock", namespace, tuple(ids)))
        return real(db, namespace, *ids)

    monkeypatch.setattr(advisory, "advisory_xact_lock", spy)
    return events
