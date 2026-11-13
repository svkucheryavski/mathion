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


# D2a (rev 11): one clear line per key, each flushed (`mathion update` reads it
# through a pipe), sizes in MB, and a short ASCII echo of the raw value.
def test_copy_zero_file_size_is_noted(rerun):
    row, out = rerun(MATHION_MAX_FILE_SIZE="0")
    assert row.max_file_mb == 1
    assert "site-settings: MATHION_MAX_FILE_SIZE=0 is out of range; using 1 MB\n" in out


def test_copy_negative_file_size_is_noted(rerun):
    row, out = rerun(MATHION_MAX_FILE_SIZE="-5")
    assert row.max_file_mb == 1
    assert "site-settings: MATHION_MAX_FILE_SIZE=-5 is out of range; using 1 MB\n" in out


def test_copy_course_below_file_shows_the_old_value(rerun):
    raw = str(10 * 1_048_576)
    row, out = rerun(MATHION_MAX_COURSE_SIZE=raw)
    assert row.max_total_mb == 20
    assert out == f"site-settings: MATHION_MAX_COURSE_SIZE={raw} is below the largest file; using 20 MB\n"


def test_copy_over_long_username_turns_email_off(rerun):
    row, out = rerun(MATHION_EMAIL_MODE="smtp", MATHION_SMTP_HOST="h",
                     MATHION_SMTP_USERNAME="u" * 255, MATHION_SMTP_PASSWORD="pw")
    assert row.email_on is False and row.smtp_skip_cert_check is False
    assert row.smtp_username == "" and row.smtp_password_sealed is None
    assert row.email_from == ""
    assert out == ("site-settings: MATHION_SMTP_USERNAME is longer than 254 characters; "
                   "it is not copied, and neither is MATHION_SMTP_PASSWORD, so email is copied as off\n")


def test_copy_over_long_host_says_it_once(rerun):
    row, out = rerun(MATHION_EMAIL_MODE="smtp", MATHION_SMTP_HOST="h" * 300)
    assert row.email_on is False
    assert out == ("site-settings: MATHION_SMTP_HOST is longer than 253 characters; "
                   "it is not copied, so email is copied as off\n")


def test_copy_over_long_text_with_email_off_just_says_not_copied(rerun):
    _, out = rerun(MATHION_SMTP_HOST="h" * 300)
    assert out == "site-settings: MATHION_SMTP_HOST is longer than 253 characters; it is not copied\n"


def test_copy_over_long_from_keeps_email_on_in_one_line(rerun):
    row, out = rerun(MATHION_EMAIL_MODE="smtp", MATHION_SMTP_HOST="h",
                     MATHION_EMAIL_FROM="x" * 400 + "@uni.dk")
    assert row.email_on is True and row.email_from == "Mathion <noreply@mathion.test>"
    assert out == ("site-settings: MATHION_EMAIL_FROM is longer than 320 characters; it is not copied, "
                   "so email stays on with the default From Mathion <noreply@mathion.test>\n")


def test_copy_password_not_utf8_says_it_once(rerun):
    row, out = rerun(MATHION_EMAIL_MODE="smtp", MATHION_SMTP_HOST="h",
                     MATHION_SMTP_USERNAME="u", MATHION_SMTP_PASSWORD="p\udcff")
    assert row.email_on is False and row.smtp_password_sealed is None
    assert out == ("site-settings: MATHION_SMTP_PASSWORD is not valid UTF-8 text; "
                   "it is not copied, so email is copied as off\n")


def test_copy_size_not_a_number_names_the_default_in_mb(rerun):
    row, out = rerun(MATHION_MAX_FILE_SIZE="20MB")
    assert row.max_file_mb == 20
    assert out == "site-settings: MATHION_MAX_FILE_SIZE=20MB is not a number; using the default 20 MB\n"


def test_copy_cuts_a_long_echo(rerun):
    _, out = rerun(MATHION_MAX_FILE_SIZE="9" * 400, MATHION_MAX_COURSE_SIZE="9" * 5000)
    lines = out.splitlines()
    assert len(lines) == 2
    for line in lines:
        assert "=" + "9" * 40 + "... " in line and "9" * 41 not in line


def test_copy_echo_shows_control_characters_escaped(rerun):
    _, out = rerun(MATHION_SMTP_PORT="ab\x1bc")
    assert out == "site-settings: MATHION_SMTP_PORT='ab\\x1bc' is not a number; using the default 587\n"


def test_copy_lines_are_flushed(rerun, monkeypatch):
    import builtins
    seen: list[bool] = []
    real = builtins.print

    def spy(*args, **kwargs):
        if args and str(args[0]).startswith("site-settings:"):
            seen.append(kwargs.get("flush") is True)
        real(*args, **kwargs)
    monkeypatch.setattr(builtins, "print", spy)
    rerun(MATHION_MAX_FILE_SIZE="0", MATHION_SMTP_PORT="abc", MATHION_SMTP_HOST="h" * 300)
    assert len(seen) == 3 and all(seen)


def test_copy_dropped_username_with_email_off_names_the_password(rerun):
    row, out = rerun(MATHION_SMTP_USERNAME="u" * 255, MATHION_SMTP_PASSWORD="pw")
    assert row.smtp_username == "" and row.smtp_password_sealed is None
    assert out == ("site-settings: MATHION_SMTP_USERNAME is longer than 254 characters; "
                   "it is not copied, and neither is MATHION_SMTP_PASSWORD\n")


def test_copy_dropped_username_without_password_says_only_that(rerun):
    _, out = rerun(MATHION_SMTP_USERNAME="u" * 255)
    assert out == "site-settings: MATHION_SMTP_USERNAME is longer than 254 characters; it is not copied\n"


def test_copy_bad_password_without_username_keeps_email_on(rerun):
    row, out = rerun(MATHION_EMAIL_MODE="smtp", MATHION_SMTP_HOST="h", MATHION_SMTP_PASSWORD="p\udcff")
    assert row.email_on is True and row.smtp_password_sealed is None
    assert out == ("site-settings: MATHION_SMTP_PASSWORD is not valid UTF-8 text; it is not copied\n"
                   "site-settings: MATHION_EMAIL_FROM is not set; email stays on with the default From "
                   "Mathion <noreply@mathion.test>\n")


def test_copy_dropped_from_with_email_off_just_says_not_copied(rerun):
    row, out = rerun(MATHION_EMAIL_FROM="x" * 400 + "@uni.dk")
    assert row.email_on is False and row.email_from == ""
    assert out == "site-settings: MATHION_EMAIL_FROM is longer than 320 characters; it is not copied\n"


def test_copy_echo_escapes_bytes_that_are_not_utf8(rerun):
    _, out = rerun(MATHION_MAX_FILE_SIZE="1\udcff")
    assert out == ("site-settings: MATHION_MAX_FILE_SIZE='1\\udcff' is not a number; "
                   "using the default 20 MB\n")


def test_copy_prints_only_ascii(rerun):
    # Whatever the container's locale, a line never fails to print (D2a).
    _, out = rerun(MATHION_SMTP_PORT="æøå", MATHION_MAX_FILE_SIZE="9" * 400)
    assert out.isascii()
    assert "MATHION_SMTP_PORT='\\xe6\\xf8\\xe5' is not a number" in out


def test_copy_secret_key_not_utf8_drops_the_password_not_the_migration(rerun):
    row, out = rerun(MATHION_SECRET_KEY="s\udcff", MATHION_EMAIL_MODE="smtp", MATHION_SMTP_HOST="h",
                     MATHION_SMTP_USERNAME="u", MATHION_SMTP_PASSWORD="pw")
    assert row.email_on is False and row.smtp_password_sealed is None
    assert out == ("site-settings: MATHION_SECRET_KEY is not valid UTF-8 text, so MATHION_SMTP_PASSWORD "
                   "can't be sealed; it is not copied, so email is copied as off\n")


def test_copy_secret_key_not_utf8_without_username_keeps_email_on(rerun):
    row, out = rerun(MATHION_SECRET_KEY="s\udcff", MATHION_EMAIL_MODE="smtp", MATHION_SMTP_HOST="h",
                     MATHION_SMTP_PASSWORD="pw")
    assert row.email_on is True and row.smtp_password_sealed is None
    assert out == ("site-settings: MATHION_SECRET_KEY is not valid UTF-8 text, so MATHION_SMTP_PASSWORD "
                   "can't be sealed; it is not copied\n"
                   "site-settings: MATHION_EMAIL_FROM is not set; email stays on with the default From "
                   "Mathion <noreply@mathion.test>\n")


def test_copy_secret_key_not_utf8_with_email_off_says_only_not_copied(rerun):
    row, out = rerun(MATHION_SECRET_KEY="s\udcff", MATHION_SMTP_USERNAME="u", MATHION_SMTP_PASSWORD="pw")
    assert row.email_on is False and row.smtp_password_sealed is None and row.smtp_username == "u"
    assert out == ("site-settings: MATHION_SECRET_KEY is not valid UTF-8 text, so MATHION_SMTP_PASSWORD "
                   "can't be sealed; it is not copied\n")


def test_copy_secret_key_not_utf8_without_password_says_nothing(rerun):
    row, out = rerun(MATHION_SECRET_KEY="s\udcff", MATHION_EMAIL_MODE="smtp", MATHION_SMTP_HOST="h",
                     MATHION_EMAIL_FROM="Mathion <m@uni.dk>")
    assert row.email_on is True
    assert out == ""


def test_copy_echo_drops_the_spaces_around_a_value(rerun):
    _, out = rerun(MATHION_MAX_FILE_SIZE=" 0 ")
    assert out == "site-settings: MATHION_MAX_FILE_SIZE=0 is out of range; using 1 MB\n"


def test_copy_course_below_file_echoes_the_trimmed_value(rerun):
    _, out = rerun(MATHION_MAX_COURSE_SIZE=" 1000 ")
    assert out == "site-settings: MATHION_MAX_COURSE_SIZE=1000 is below the largest file; using 20 MB\n"


def test_copy_echo_of_exactly_40_characters_is_not_cut(rerun):
    _, out = rerun(MATHION_SMTP_PORT="a" * 40)
    assert out == f"site-settings: MATHION_SMTP_PORT={'a' * 40} is not a number; using the default 587\n"


def test_copy_echo_of_41_characters_is_cut_to_40(rerun):
    _, out = rerun(MATHION_SMTP_PORT="a" * 41)
    assert out == f"site-settings: MATHION_SMTP_PORT={'a' * 40}... is not a number; using the default 587\n"


def test_copy_course_size_equal_to_the_file_size_says_nothing(rerun):
    row, out = rerun(MATHION_MAX_COURSE_SIZE=str(20 * 1_048_576))
    assert row.max_total_mb == 20 and out == ""
