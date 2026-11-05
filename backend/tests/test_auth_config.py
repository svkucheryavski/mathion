import pytest

from mathion.config import settings
from tests.conftest import set_site


@pytest.mark.parametrize(
    "debug,email_mode,expected",
    [
        (False, "smtp", True),
        (False, "file", True),
        (False, "memory", False),   # one-shot MemoryMailer delivers nowhere retrievable
        (False, "disabled", False),
        (True, "smtp", True),
        (True, "file", True),
        (True, "memory", True),     # console print
        (True, "disabled", True),   # console print
    ],
)
def test_config_matrix(client, monkeypatch, debug, email_mode, expected):
    monkeypatch.setattr(settings, "debug", debug)
    monkeypatch.setattr(settings, "email_mode", email_mode)
    resp = client.get("/api/auth/config")
    assert resp.status_code == 200
    assert resp.json()["send_pin_enabled"] is expected


def test_config_without_a_row_reports_the_defaults(client):
    assert client.get("/api/auth/config").json() == {
        "send_pin_enabled": False, "longest_sign_in_days": 30, "max_file_mb": 20,
    }


def test_config_reports_longest_and_file_limit(client, db):
    # D10b: the login page and the upload checks read these (D11b, D12).
    set_site(db, longest_sign_in_days=7, max_file_mb=33)
    body = client.get("/api/auth/config").json()
    assert (body["longest_sign_in_days"], body["max_file_mb"]) == (7, 33)
    assert set(body) == {"send_pin_enabled", "longest_sign_in_days", "max_file_mb"}  # public: nothing else
