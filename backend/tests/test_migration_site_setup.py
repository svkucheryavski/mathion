"""D10 (superuser Set up): the migration turns the wizard on only on a site
with no course; a site with a course gets no row (over) and keeps its name
and sign-in values. A renamed site keeps its name (D7)."""
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from mathion.database import engine

BEFORE = "f3a9c1e7b2d4"


def _cfg() -> Config:
    return Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))


def _tables() -> set[str]:
    return set(inspect(engine).get_table_names())


def _settings_columns() -> set[str]:
    return {c["name"] for c in inspect(engine).get_columns("site_settings")}


# The settings row as the settings migration leaves it (email off, the defaults).
_SETTINGS_ROW = text(
    "INSERT INTO site_settings (id, email_on, smtp_host, smtp_port, smtp_encryption,"
    " smtp_skip_cert_check, smtp_username, email_from, max_file_mb, max_total_mb,"
    " pin_minutes, pin_requests_per_hour, pin_failures_per_hour, longest_sign_in_days,"
    " email_off_at, send_backoff_step)"
    " VALUES (1, false, '', 587, 'starttls', false, '', '', 20, 500, 10, 3, 5, 30,"
    " '1970-01-01T00:00:00+00:00', 0)"
)
_COURSE = text("INSERT INTO courses (slug, name, description) VALUES ('algebra', 'Algebra', '')")


def _downgrade(db, *statements):
    """Go back to before Set up, run the statements there, and come back."""
    db.close()
    command.downgrade(_cfg(), BEFORE)
    try:
        with engine.begin() as conn:
            conn.execute(text("TRUNCATE courses, site_settings, site_branding CASCADE"))
            for s in statements:
                conn.execute(s)
    finally:
        command.upgrade(_cfg(), "head")


def _setup_row():
    with engine.connect() as conn:
        return conn.execute(text("SELECT id, wizard_on, step, passed_mask FROM site_setup")).all()


def _kept():
    with engine.connect() as conn:
        return conn.execute(text("SELECT site_name_kept, sign_in_kept FROM site_settings")).one()


def test_fresh_database_turns_wizard_on(db):
    _downgrade(db)
    assert _setup_row() == [(1, True, 1, 0)]


def test_upgrade_with_course_is_over_and_kept(db):
    _downgrade(db, _COURSE, _SETTINGS_ROW)
    assert _setup_row() == []
    assert _kept() == (True, True)


def test_upgrade_without_course_turns_wizard_on(db):
    _downgrade(db, _SETTINGS_ROW)
    assert _setup_row() == [(1, True, 1, 0)]
    assert _kept() == (False, False)


def test_upgrade_with_renamed_site_keeps_name(db):
    _downgrade(
        db,
        _SETTINGS_ROW,
        text("INSERT INTO site_branding (id, site_name, theme_changes) VALUES (1, 'Lund', '{}')"),
    )
    assert _setup_row() == [(1, True, 1, 0)]
    assert _kept() == (True, False)


def test_downgrade_drops_table_and_columns(db):
    db.close()
    command.downgrade(_cfg(), BEFORE)
    try:
        assert "site_setup" not in _tables()
        assert not {"site_name_kept", "sign_in_kept", "last_sent_at"} & _settings_columns()
    finally:
        command.upgrade(_cfg(), "head")
    assert "site_setup" in _tables()
    assert {"site_name_kept", "sign_in_kept", "last_sent_at"} <= _settings_columns()


def test_one_row_only(db):
    db.execute(text("INSERT INTO site_setup (id, wizard_on, step, passed_mask) VALUES (1, true, 1, 0)"))
    db.commit()
    with pytest.raises(IntegrityError):
        db.execute(text("INSERT INTO site_setup (id, wizard_on, step, passed_mask) VALUES (2, true, 1, 0)"))
    db.rollback()
    with pytest.raises(IntegrityError):
        db.execute(text("UPDATE site_setup SET step = 5 WHERE id = 1"))
    db.rollback()
