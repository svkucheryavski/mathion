"""Migration round-trip tests for notification_dispatcher_columns.

CRITICAL: this file opts out of the autouse `setup_db` fixture from
backend/tests/conftest.py:64. That fixture creates the FULL post-migration
schema via Base.metadata.create_all, which would defeat any test that
asserts pre-upgrade column absence. We override at module scope.
"""
from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import mathion.config as _config_mod


# Resolve alembic.ini cwd-independently. Pytest runs from `backend/` (per
# backend/pyproject.toml testpaths = ["tests"]), so `Config("backend/alembic.ini")`
# would resolve to `backend/backend/alembic.ini` and FileNotFoundError.
ALEMBIC_INI = str(Path(__file__).resolve().parent.parent / "alembic.ini")

PRIOR_REV = "2f3e694d3544"
THIS_REV  = "378c62a02d4e"


@pytest.fixture(autouse=True)
def setup_db():
    """Override the parent conftest's autouse fixture. Pytest resolves
    nearest-scope autouse, so this no-op wins for tests in this file."""
    yield


@pytest.fixture
def make_engine():
    """Factory that creates engines and disposes them at test teardown.

    SQLite on-disk engines hold a file handle; tmp_path cleanup is session-scoped,
    so without explicit dispose the handles accumulate across tests in this module.
    """
    engines = []
    def _factory(url: str):
        eng = create_engine(url)
        engines.append(eng)
        return eng
    yield _factory
    for eng in engines:
        eng.dispose()


def _make_alembic_cfg() -> Config:
    """Construct an Alembic Config that respects the test-monkeypatched DB URL.

    env.py imports `settings` at module-load time (`from mathion.config import settings`)
    and on every `command.upgrade()` re-executes `config.set_main_option("sqlalchemy.url",
    settings.database_url)` (env.py:28 inside the `run_migrations_online` flow). Because
    env.py holds a *reference* to the singleton `Settings()` instance and our tests
    monkeypatch the `database_url` attribute on that same object, env.py picks up the
    patched URL on every upgrade/downgrade call. We do NOT need (and must not) call
    set_main_option here — env.py overrides anything we'd set.
    """
    return Config(ALEMBIC_INI)


def test_upgrade_backfills_sent_at(tmp_path, monkeypatch, make_engine):
    db_url = f"sqlite:///{tmp_path}/migration_test.db"
    monkeypatch.setattr(_config_mod.settings, "database_url", db_url)

    cfg = _make_alembic_cfg()
    command.upgrade(cfg, PRIOR_REV)

    tmp_engine = make_engine(db_url)
    with tmp_engine.begin() as conn:
        conn.execute(text("INSERT INTO notification_log (user_id, kind, payload, created_at, sent_at) "
                          "VALUES (1, 'evaluation_received', '{}', CURRENT_TIMESTAMP, NULL)"))

    command.upgrade(cfg, THIS_REV)

    with tmp_engine.begin() as conn:
        row = conn.execute(text("SELECT sent_at FROM notification_log")).fetchone()
        assert row.sent_at is not None


def test_upgrade_new_rows_default_correctly(tmp_path, monkeypatch, make_engine):
    db_url = f"sqlite:///{tmp_path}/defaults_test.db"
    monkeypatch.setattr(_config_mod.settings, "database_url", db_url)

    cfg = _make_alembic_cfg()
    command.upgrade(cfg, THIS_REV)

    tmp_engine = make_engine(db_url)
    with tmp_engine.begin() as conn:
        conn.execute(text("INSERT INTO notification_log (user_id, kind, payload, created_at) "
                          "VALUES (1, 'run_enrolled', '{}', CURRENT_TIMESTAMP)"))
        row = conn.execute(text("SELECT retry_count, next_attempt_at, error FROM notification_log")).fetchone()
        assert row.retry_count == 0
        assert row.next_attempt_at is None
        assert row.error is None


def test_downgrade_drops_columns(tmp_path, monkeypatch, make_engine):
    db_url = f"sqlite:///{tmp_path}/downgrade_test.db"
    monkeypatch.setattr(_config_mod.settings, "database_url", db_url)

    cfg = _make_alembic_cfg()
    command.upgrade(cfg, THIS_REV)
    command.downgrade(cfg, PRIOR_REV)

    tmp_engine = make_engine(db_url)
    with tmp_engine.begin() as conn:
        cols = {r[1] for r in conn.execute(text("PRAGMA table_info(notification_log)"))}
        assert "retry_count" not in cols
        assert "next_attempt_at" not in cols
        assert "error" not in cols


def test_downgrade_preserves_backfill(tmp_path, monkeypatch, make_engine):
    db_url = f"sqlite:///{tmp_path}/preserve_test.db"
    monkeypatch.setattr(_config_mod.settings, "database_url", db_url)

    cfg = _make_alembic_cfg()
    command.upgrade(cfg, PRIOR_REV)
    tmp_engine = make_engine(db_url)
    with tmp_engine.begin() as conn:
        conn.execute(text("INSERT INTO notification_log (user_id, kind, payload, created_at, sent_at) "
                          "VALUES (1, 'evaluation_received', '{}', CURRENT_TIMESTAMP, NULL)"))
    command.upgrade(cfg, THIS_REV)
    command.downgrade(cfg, PRIOR_REV)
    with tmp_engine.begin() as conn:
        row = conn.execute(text("SELECT sent_at FROM notification_log")).fetchone()
        assert row.sent_at is not None  # backfill survives downgrade


def test_migration_uses_batch_alter_table():
    # Source-level assertion to lock in the SQLite-safe convention.
    versions_dir = Path(__file__).resolve().parent.parent / "alembic" / "versions"
    files = list(versions_dir.glob("*notification_dispatcher_columns*"))
    assert len(files) == 1
    source = files[0].read_text()
    assert "with op.batch_alter_table" in source


@pytest.mark.skip(reason="re-enabled in T11 once tick + MemoryMailer land")
def test_dispatcher_filters_backfilled_rows(tmp_path, monkeypatch, make_engine):
    """Safety net test: backfilled rows have sent_at IS NOT NULL after upgrade
    and the dispatcher's `sent_at.is_(None)` clause excludes them. This makes
    the SQLite naive-vs-aware timestamp asymmetry benign per §3 note."""
    from mathion.notifications.dispatcher import tick
    from mathion.notifications.mailer import MemoryMailer

    db_url = f"sqlite:///{tmp_path}/dispatch_test.db"
    monkeypatch.setattr(_config_mod.settings, "database_url", db_url)

    cfg = _make_alembic_cfg()
    command.upgrade(cfg, PRIOR_REV)
    tmp_engine = make_engine(db_url)
    with tmp_engine.begin() as conn:
        conn.execute(text("INSERT INTO notification_log (user_id, kind, payload, created_at, sent_at) "
                          "VALUES (1, 'run_enrolled', '{}', CURRENT_TIMESTAMP, NULL)"))
    command.upgrade(cfg, THIS_REV)

    LocalSession = sessionmaker(bind=tmp_engine)
    with LocalSession() as db:
        mailer = MemoryMailer()
        processed = tick(db, mailer, now=datetime.now(timezone.utc))
        assert processed == 0
        assert len(mailer.sent) == 0
