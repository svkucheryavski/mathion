"""env.py must not route the DB URL through Alembic's ConfigParser (a %-encoded
credential would raise InterpolationSyntaxError), and must configure both online
and offline modes from settings.database_url directly.
"""
import ast
from pathlib import Path

from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable
from sqlalchemy.sql.elements import TextClause

ENV_PY = Path(__file__).resolve().parent.parent / "alembic" / "env.py"


def _func_source(name: str) -> str:
    """Return the source of the named top-level function in env.py.

    Scoping assertions to the correct migration mode matters: a whole-file
    substring check cannot tell online from offline, so a compare flag could
    silently move to the wrong mode (or the online engine could stop using
    settings.database_url) while the test stayed green.
    """
    src = ENV_PY.read_text()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            segment = ast.get_source_segment(src, node)
            assert segment is not None
            return segment
    raise AssertionError(f"{name}() not found in env.py")


def test_env_does_not_set_main_option_url():
    src = ENV_PY.read_text()
    assert 'set_main_option("sqlalchemy.url"' not in src
    assert "set_main_option('sqlalchemy.url'" not in src


def test_offline_mode_configures_from_settings_url():
    offline = _func_source("run_migrations_offline")
    assert "url=settings.database_url" in offline


def test_online_mode_builds_engine_from_settings_and_enables_compare_flags():
    online = _func_source("run_migrations_online")
    # Engine built directly from settings.database_url — not engine_from_config
    # (which would re-introduce the ConfigParser URL path this task removed).
    assert "create_engine(settings.database_url" in online
    # Both drift-detection flags must live on the ONLINE configure specifically
    # (they are meaningless offline; scoping the assertion here prevents a
    # regression that moves them out of online mode from passing).
    assert "compare_type=True" in online
    assert "compare_server_default=True" in online


def test_is_disabled_server_default_is_pg_native_false():
    from mathion.models import Group

    col = Group.__table__.c.is_disabled
    arg = col.server_default.arg
    # Must be an unquoted SQL expression (text("false")), NOT a quoted string
    # literal: server_default="false" also makes str(arg) == "false" but renders
    # DEFAULT 'false', which is wrong on Postgres and would drift.
    assert isinstance(arg, TextClause)
    assert str(arg) == "false"
    # Behavioral proof: the compiled Postgres DDL renders DEFAULT false, unquoted.
    ddl = str(CreateTable(Group.__table__).compile(dialect=postgresql.dialect()))
    assert "DEFAULT false" in ddl
    assert "DEFAULT 'false'" not in ddl
