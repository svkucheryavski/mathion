from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from mathion.auth import hash_token
from mathion.models_auth import SuperuserPanelToken
from mathion.superuser import service as panel_service


def _token_count(db):
    return db.scalar(select(func.count()).select_from(SuperuserPanelToken))


def test_mint_stores_only_hash(db):
    raw = panel_service.mint(db)
    row = db.execute(select(SuperuserPanelToken)).scalar_one()
    assert row.token_hash != raw
    assert row.token_hash == hash_token(raw)
    assert len(row.token_hash) == 64


def test_validate_accepts_fresh_token(db):
    raw = panel_service.mint(db)
    row = panel_service.validate(db, raw)
    assert row.token_hash == hash_token(raw)


def test_validate_rejects_absent_token(db):
    with pytest.raises(HTTPException) as exc:
        panel_service.validate(db, "nope")
    assert exc.value.status_code == 404


def test_mint_replaces_previous_token(db):
    old = panel_service.mint(db)
    new = panel_service.mint(db)
    assert _token_count(db) == 1
    with pytest.raises(HTTPException) as exc:
        panel_service.validate(db, old)
    assert exc.value.status_code == 404
    assert panel_service.validate(db, new).token_hash == hash_token(new)


def test_validate_expires_and_deletes_stale_token(db):
    raw = panel_service.mint(db)
    row = db.execute(select(SuperuserPanelToken)).scalar_one()
    row.last_active_at = datetime.now(timezone.utc) - timedelta(minutes=31)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        panel_service.validate(db, raw)
    assert exc.value.status_code == 404
    assert _token_count(db) == 0


def test_validate_bump_is_throttled(db):
    raw = panel_service.mint(db)
    row = db.execute(select(SuperuserPanelToken)).scalar_one()
    # 10 min ago -> inside window, older than the 5-min throttle -> first validate bumps.
    row.last_active_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    db.commit()
    panel_service.validate(db, raw)
    db.refresh(row)
    bumped = row.last_active_at
    # Second validate within the throttle window -> no re-write.
    panel_service.validate(db, raw)
    db.refresh(row)
    assert row.last_active_at == bumped


def test_destroy_active_removes_token(db):
    panel_service.mint(db)
    panel_service.destroy_active(db)
    assert _token_count(db) == 0
