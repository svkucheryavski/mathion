"""Engine-level guarantees for the Postgres migration (Phase 9-A1).

Runs against the test database wired up by conftest (mathion_test).
"""
from sqlalchemy import text

from mathion.database import engine


def test_engine_is_postgres_psycopg():
    assert engine.dialect.name == "postgresql"
    assert engine.dialect.driver == "psycopg"


def test_connection_timezone_is_utc():
    with engine.connect() as conn:
        tz = conn.execute(text("SHOW TimeZone")).scalar()
    assert tz == "UTC"


def test_enable_sqlite_fk_is_gone():
    import mathion.database as db
    assert not hasattr(db, "enable_sqlite_fk")
