"""Settings D7b rev 13: the migration straightens a curly pair around a saved
From name, as a save now does; any other From stays as it was."""
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from mathion.database import engine
from mathion.site_settings import load
from tests.conftest import set_site

BEFORE = "a6d2e9c4f1b8"


def _cfg() -> Config:
    return Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))


def _migrate_again(db, *statements):
    """Step back before the migration, run the statements there, and come back."""
    db.close()
    command.downgrade(_cfg(), BEFORE)
    try:
        with engine.begin() as conn:
            for s in statements:
                conn.execute(s)
    finally:
        command.upgrade(_cfg(), "head")
    db.expire_all()


@pytest.mark.parametrize("saved,after", [
    ("“Mathion, AAU” <m@uni.dk>", '"Mathion, AAU" <m@uni.dk>'),
    ("»Mathion«<m@uni.dk>", '"Mathion"<m@uni.dk>'),
    ("“Matte” og “Fysik” <m@uni.dk>", "“Matte” og “Fysik” <m@uni.dk>"),
    ("Mathion “AAU” <m@uni.dk>", "Mathion “AAU” <m@uni.dk>"),
    ("“m@uni.dk”", "“m@uni.dk”"),
    ('“A "b"” <m@uni.dk>', '“A "b"” <m@uni.dk>'),
    ("“A\\B” <m@uni.dk>", "“A\\B” <m@uni.dk>"),
    ("m@uni.dk", "m@uni.dk"),
    ("", ""),
])
def test_migration_straightens_a_saved_curly_pair(db, saved, after):
    set_site(db, email_from=saved)
    _migrate_again(db)
    assert load(db).email_from == after


def test_migration_runs_with_no_settings_row(db):
    _migrate_again(db, text("TRUNCATE site_settings"))
    assert load(db).email_from == ""
