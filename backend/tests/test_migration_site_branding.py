"""D12 (superuser Branding): the migration creates the branding row's table
and the images' table; downgrade drops both."""
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from mathion.database import engine

BEFORE = "e8c4f2a6b1d7"


def _cfg() -> Config:
    return Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))


def _tables() -> set[str]:
    return set(inspect(engine).get_table_names())


def test_downgrade_drops_and_upgrade_creates(db):
    db.close()
    command.downgrade(_cfg(), BEFORE)
    try:
        assert not {"site_branding", "site_branding_images"} & _tables()
    finally:
        command.upgrade(_cfg(), "head")
    assert {"site_branding", "site_branding_images"} <= _tables()


def test_one_row_and_known_kinds_only(db):
    db.execute(text("INSERT INTO site_branding (id, site_name, theme_changes) VALUES (1, 'Mathion', '{}')"))
    db.commit()
    with pytest.raises(IntegrityError):
        db.execute(text("INSERT INTO site_branding (id, site_name, theme_changes) VALUES (2, 'Other', '{}')"))
    db.rollback()
    with pytest.raises(IntegrityError):
        db.execute(text("INSERT INTO site_branding_images (kind, data) VALUES ('page', '\\x00')"))
    db.rollback()
