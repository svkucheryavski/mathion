import pytest

from mathion.config import settings
from tests.conftest import set_site


@pytest.mark.parametrize(
    "debug,email_mode,expected",
    [
        (False, "smtp", False),     # superuser Settings D2c: smtp/disabled mean "the panel
        (False, "file", True),      # decides", and no row means email off (D2)
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
        "branding": {"name": "Mathion", "logo": None, "icon": None, "theme": None},
    }


def test_config_reports_longest_and_file_limit(client, db):
    # D10b: the login page and the upload checks read these (D11b, D12).
    set_site(db, longest_sign_in_days=7, max_file_mb=33)
    body = client.get("/api/auth/config").json()
    assert (body["longest_sign_in_days"], body["max_file_mb"]) == (7, 33)
    assert set(body) == {"send_pin_enabled", "longest_sign_in_days", "max_file_mb", "branding"}  # public: nothing else


def test_send_pin_follows_saved_switch(client, db, monkeypatch):
    # D10b: turning email on in the panel gives the login page its "Send PIN" step.
    from mathion.secret_box import seal
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "email_mode", "disabled")
    get = lambda: client.get("/api/auth/config").json()["send_pin_enabled"]  # noqa: E731
    set_site(db, email_on=False, smtp_host="mail.uni.dk", email_from="a@uni.dk")
    assert get() is False
    set_site(db, email_on=True)                       # no login: nothing to read
    assert get() is True
    set_site(db, smtp_username="u@uni.dk", smtp_password_sealed=seal("pw", settings.secret_key))
    assert get() is True
    set_site(db, smtp_password_sealed=seal("pw", "another-servers-key"))  # D8: can't be read
    assert get() is False
    set_site(db, smtp_password_sealed=None)
    assert get() is False
    monkeypatch.setattr(settings, "debug", True)
    assert get() is True


def test_config_reports_saved_branding(client, db):
    # Branding D13: the dev server and an unfilled page read the branding here.
    from mathion.models_auth import SiteBranding
    db.add(SiteBranding(id=1, site_name="Riverside", logo_width=838, logo_height=174, logo_hash="a" * 16,
                        icon_width=180, icon_height=180, icon_hash="c" * 16, theme_changes={"--bg": "#fff"}))
    db.commit()
    from mathion.branding import short_hash
    assert client.get("/api/auth/config").json()["branding"] == {
        "name": "Riverside", "logo": {"version": "a" * 16, "width": 838, "height": 174},
        "icon": "c" * 16, "theme": short_hash(b":root:root {\n  --bg: #fff;\n}\n"),
    }
