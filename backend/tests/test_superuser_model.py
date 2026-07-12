def test_superuser_panel_token_roundtrip(db):
    from mathion.models_auth import SuperuserPanelToken

    row = SuperuserPanelToken(token_hash="a" * 64)
    db.add(row)
    db.commit()
    db.refresh(row)

    assert row.id is not None
    assert row.token_hash == "a" * 64
    assert row.created_at is not None
    assert row.last_active_at is not None
