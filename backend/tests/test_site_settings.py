"""D2: one row of settings; a missing row means the defaults with email off."""
from datetime import datetime, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from mathion.models_auth import SiteSettings, User
from mathion.site_settings import DEFAULTS, MB, get_row, load

EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def test_load_without_row_gives_defaults(db):
    assert db.query(SiteSettings).count() == 0
    view = load(db)
    assert view == DEFAULTS
    assert view.email_on is False
    assert view.max_file_mb == 20 and view.max_total_mb == 500
    assert (view.pin_minutes, view.pin_requests_per_hour, view.pin_failures_per_hour) == (10, 3, 5)
    assert view.longest_sign_in_days == 30
    assert MB == 1_048_576


def test_load_reads_the_row(db):
    row = get_row(db)
    row.max_file_mb = 33
    db.commit()
    assert load(db).max_file_mb == 33


def test_get_row_creates_once(db):
    a = get_row(db)
    db.commit()
    b = get_row(db)
    assert a.id == b.id == 1
    assert db.query(SiteSettings).count() == 1


def test_second_row_violates_check(db):
    get_row(db)
    db.commit()
    db.add(SiteSettings(id=2))
    with pytest.raises(IntegrityError, match="ck_site_settings_one_row"):
        db.flush()
    db.rollback()


def test_load_when_table_missing_keeps_the_callers_transaction(db):
    # D2: a fresh install starts the app before migrating.
    db.add(User(email="kept@x"))
    db.flush()
    db.execute(text("DROP TABLE site_settings"))
    assert load(db) == DEFAULTS
    assert db.query(User).filter_by(email="kept@x").count() == 1  # not rolled back
    db.rollback()  # brings the table back
    assert load(db) == DEFAULTS


def test_off_since_epoch_without_a_copy(db):
    # D10a: a first turn-on skips everything queued before it.
    assert DEFAULTS.email_off_at == EPOCH
    assert get_row(db).email_off_at == EPOCH


def test_long_sentences_fit(db):
    row = get_row(db)
    row.test_message = row.card_test_message = row.send_failure_message = "x" * 900
    db.commit()
