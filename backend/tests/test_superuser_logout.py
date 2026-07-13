from sqlalchemy import func, select

from mathion.models_auth import SuperuserPanelToken
from mathion.superuser import service as panel_service


def _token_count(db):
    return db.scalar(select(func.count()).select_from(SuperuserPanelToken))


def test_superuser_logout_destroys_panel_token(admin_client, db):
    panel_service.mint(db)
    assert _token_count(db) == 1
    resp = admin_client.post("/api/auth/logout")
    assert resp.status_code == 200
    assert _token_count(db) == 0


def test_non_superuser_logout_leaves_panel_token(auth_client, db):
    panel_service.mint(db)
    resp = auth_client.post("/api/auth/logout")
    assert resp.status_code == 200
    assert _token_count(db) == 1
