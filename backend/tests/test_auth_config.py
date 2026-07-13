import pytest

from mathion.config import settings


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
    assert resp.json() == {"send_pin_enabled": expected}
