"""The harness must run on Postgres with real per-test isolation."""
from sqlalchemy import text

from mathion.config import settings
from mathion.models_auth import User


def test_harness_targets_the_test_database():
    from sqlalchemy.engine import make_url
    name = make_url(settings.database_url).database or ""
    # Same predicate the conftest guard enforces (mathion_test or a mathion_test_* shard).
    assert name == "mathion_test" or name.startswith("mathion_test_")


def test_identity_restarts_between_tests_first(db):
    u = User(email="iso-a@example.com", full_name="A")
    db.add(u); db.commit(); db.refresh(u)
    assert u.id == 1  # RESTART IDENTITY gives a fresh sequence each test


def test_identity_restarts_between_tests_second(db):
    # If truncation+RESTART IDENTITY works, this independent test also sees id 1.
    u = User(email="iso-b@example.com", full_name="B")
    db.add(u); db.commit(); db.refresh(u)
    assert u.id == 1


def test_tables_are_empty_at_test_start(db):
    n = db.execute(text("select count(*) from users")).scalar()
    assert n == 0
