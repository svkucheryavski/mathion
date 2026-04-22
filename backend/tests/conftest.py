import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from mathion.database import Base, get_db
from mathion.main import app
from mathion.models_auth import User
from mathion.auth import request_pin, verify_pin

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
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
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


@pytest.fixture
def auth_client(client, db, test_user):
    raw_pin = request_pin(db, test_user.email)
    token = verify_pin(db, test_user.email, raw_pin, duration_days=7)
    client.cookies.set("session_token", token)
    return client


@pytest.fixture
def admin_client(client, db, superuser):
    raw_pin = request_pin(db, superuser.email)
    token = verify_pin(db, superuser.email, raw_pin, duration_days=7)
    client.cookies.set("session_token", token)
    return client
