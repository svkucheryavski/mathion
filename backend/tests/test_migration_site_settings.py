"""D2 and D2a (superuser Settings): the migration copies today's .env values
into `site_settings` once, and nothing in .env makes it fail."""
from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

from mathion.models_auth import SiteSettings
from mathion.secret_box import unseal

BEFORE = "d5b1e7a3c9f4"
DEV_SECRET = "dev-secret-key-change-in-production"
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
KEYS = (
    "MATHION_EMAIL_MODE", "MATHION_SMTP_HOST", "MATHION_SMTP_PORT", "MATHION_SMTP_USERNAME",
    "MATHION_SMTP_PASSWORD", "MATHION_EMAIL_FROM", "MATHION_MAX_FILE_SIZE", "MATHION_MAX_COURSE_SIZE",
    "MATHION_PIN_EXPIRY_MINUTES", "MATHION_MAX_PIN_REQUESTS_PER_HOUR", "MATHION_MAX_PIN_FAILURES_PER_HOUR",
)


def _cfg() -> Config:
    return Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))


@pytest.fixture
def rerun(db, monkeypatch, capsys):
    """Step back before this revision, set the given .env values, upgrade to
    head again; return the copied row and the migration's printed lines."""
    def _run(**env: str):
        db.close()
        for k in KEYS:
            monkeypatch.delenv(k, raising=False)
        monkeypatch.delenv("MATHION_SECRET_KEY", raising=False)
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        command.downgrade(_cfg(), BEFORE)
        capsys.readouterr()
        command.upgrade(_cfg(), "head")
        out = capsys.readouterr().out
        return db.get(SiteSettings, 1), out
    return _run


def test_copy_smtp_full(rerun):
    row, _ = rerun(
        MATHION_EMAIL_MODE="smtp", MATHION_SMTP_HOST="mail.uni.dk", MATHION_SMTP_PORT="2525",
        MATHION_SMTP_USERNAME="mathion@uni.dk", MATHION_SMTP_PASSWORD="S3ntinel-pw",
        MATHION_EMAIL_FROM="Mathion <noreply@uni.dk>",
    )
    assert row.email_on is True
    assert (row.smtp_host, row.smtp_port, row.smtp_encryption) == ("mail.uni.dk", 2525, "starttls")
    assert row.smtp_skip_cert_check is True  # a server that sends today still sends (D7a)
    assert row.smtp_username == "mathion@uni.dk"
    assert "S3ntinel" not in row.smtp_password_sealed
    assert unseal(row.smtp_password_sealed, DEV_SECRET) == "S3ntinel-pw"
    assert row.email_from == "Mathion <noreply@uni.dk>"
    assert row.email_off_at is None and row.email_on_at is None  # D10a: no off interval


def test_copy_prints_no_password(rerun):
    _, out = rerun(MATHION_EMAIL_MODE="smtp", MATHION_SMTP_USERNAME="u", MATHION_SMTP_PASSWORD="S3ntinel-pw",
                   MATHION_MAX_FILE_SIZE="abc")
    assert out and "S3ntinel" not in out


def test_copy_smtp_without_from_keeps_sending(rerun):
    row, out = rerun(
        MATHION_EMAIL_MODE="smtp", MATHION_SMTP_HOST="mail.uni.dk",
        MATHION_SMTP_USERNAME="u", MATHION_SMTP_PASSWORD="p",
    )
    assert row.email_on is True
    assert row.email_from == "Mathion <noreply@mathion.test>"
    assert "MATHION_EMAIL_FROM" in out and "default" in out


def test_copy_uses_the_secret_key_when_set(rerun):
    row, _ = rerun(
        MATHION_SECRET_KEY="s" * 48, MATHION_EMAIL_MODE="smtp", MATHION_SMTP_HOST="h",
        MATHION_SMTP_USERNAME="u", MATHION_SMTP_PASSWORD="pw",
    )
    assert unseal(row.smtp_password_sealed, "s" * 48) == "pw"


def test_copy_disabled_gives_empty_from_and_epoch_off(rerun):
    row, _ = rerun(MATHION_EMAIL_MODE="disabled", MATHION_SMTP_HOST="mail.uni.dk")
    assert row.email_on is False
    assert row.email_from == ""
    assert row.email_off_at == EPOCH and row.email_on_at is None
    assert row.smtp_skip_cert_check is False
    assert row.smtp_host == "mail.uni.dk"


def test_copy_smtp_without_host_is_off(rerun):
    row, out = rerun(MATHION_EMAIL_MODE="smtp", MATHION_SMTP_USERNAME="u", MATHION_SMTP_PASSWORD="p")
    assert row.email_on is False
    assert row.smtp_skip_cert_check is False  # it doesn't send today
    assert "MATHION_SMTP_HOST" in out


def test_copy_smtp_username_without_password_is_off(rerun):
    row, out = rerun(MATHION_EMAIL_MODE="smtp", MATHION_SMTP_HOST="h", MATHION_SMTP_USERNAME="u")
    assert row.email_on is False
    assert row.smtp_skip_cert_check is False
    assert row.smtp_password_sealed is None
    assert "MATHION_SMTP_PASSWORD" in out


def test_copy_clamps_and_logs(rerun):
    row, out = rerun(MATHION_MAX_FILE_SIZE="2147483648", MATHION_PIN_EXPIRY_MINUTES="2")
    assert row.max_file_mb == 50
    assert row.pin_minutes == 5
    assert "MATHION_MAX_FILE_SIZE" in out and "2147483648" in out and "50" in out
    assert "MATHION_PIN_EXPIRY_MINUTES" in out


def test_copy_non_numeric_gets_default(rerun):
    row, out = rerun(MATHION_SMTP_PORT="abc")
    assert row.smtp_port == 587
    assert "MATHION_SMTP_PORT" in out and "abc" in out


def test_copy_total_below_file_is_raised(rerun):
    row, out = rerun(MATHION_MAX_FILE_SIZE=str(30 * 1_048_576), MATHION_MAX_COURSE_SIZE=str(10 * 1_048_576))
    assert (row.max_file_mb, row.max_total_mb) == (30, 30)
    assert "MATHION_MAX_COURSE_SIZE" in out


def test_copy_rounds_bytes_up(rerun):
    row, _ = rerun(MATHION_MAX_FILE_SIZE="20971521")
    assert row.max_file_mb == 21


def test_copy_missing_keys_get_defaults(rerun):
    row, out = rerun()
    assert row.email_on is False
    assert (row.smtp_port, row.smtp_encryption, row.email_from) == (587, "starttls", "")
    assert (row.max_file_mb, row.max_total_mb) == (20, 500)
    assert (row.pin_minutes, row.pin_requests_per_hour, row.pin_failures_per_hour) == (10, 3, 5)
    assert row.longest_sign_in_days == 30
    assert out.strip() == ""  # nothing odd, nothing to say


def test_copy_floors_pin_requests_at_three(rerun):
    row, _ = rerun(MATHION_MAX_PIN_REQUESTS_PER_HOUR="1", MATHION_MAX_PIN_FAILURES_PER_HOUR="99")
    assert (row.pin_requests_per_hour, row.pin_failures_per_hour) == (3, 20)


def test_copy_empty_from_with_smtp_gets_default(rerun):
    row, out = rerun(MATHION_EMAIL_MODE="smtp", MATHION_SMTP_HOST="h", MATHION_EMAIL_FROM="")
    assert row.email_on is True
    assert row.email_from == "Mathion <noreply@mathion.test>"
    assert "MATHION_EMAIL_FROM" in out


def test_copy_over_long_text_is_dropped_and_noted(rerun):
    row, out = rerun(MATHION_EMAIL_MODE="smtp", MATHION_SMTP_HOST="h" * 300,
                     MATHION_EMAIL_FROM="x" * 400 + "@uni.dk")
    assert row.smtp_host == "" and row.email_on is False
    assert "MATHION_SMTP_HOST" in out and "MATHION_EMAIL_FROM" in out


def test_copy_huge_number_is_clamped(rerun):
    row, out = rerun(MATHION_MAX_FILE_SIZE="9" * 400, MATHION_SMTP_PORT="9" * 400)
    assert row.max_file_mb == 50 and row.smtp_port == 65535
    assert "MATHION_MAX_FILE_SIZE" in out


def test_copy_text_that_is_not_utf8_is_dropped(rerun):
    row, out = rerun(MATHION_EMAIL_MODE="smtp", MATHION_SMTP_HOST="mail\udcff.dk")
    assert row.smtp_host == "" and row.email_on is False
    assert "MATHION_SMTP_HOST" in out


def test_copy_caps_total_at_100_gb(rerun):
    row, _ = rerun(MATHION_MAX_COURSE_SIZE=str(200_000 * 1_048_576))
    assert row.max_total_mb == 102_400
