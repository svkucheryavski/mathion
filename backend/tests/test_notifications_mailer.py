import smtplib
from email.message import EmailMessage
from pathlib import Path
from unittest.mock import patch
import pytest

from mathion.notifications.mailer import MemoryMailer, FileMailer, SMTPMailer


def test_memory_mailer_send_appends():
    m = MemoryMailer()
    msg = EmailMessage()
    msg["Subject"] = "test"
    with m.session():
        m.send(msg)
        m.send(msg)
    assert len(m.sent) == 2


def test_memory_mailer_session_is_noop():
    m = MemoryMailer()
    with m.session():
        pass  # should not raise
    assert m.sent == []


def _make_msg(kind: str | None) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = "Test"
    msg["To"] = "a@example.com"
    msg["From"] = "noreply@mathion.local"
    msg.set_content("hi")
    if kind is not None:
        msg["X-Mathion-Kind"] = kind
    return msg


def test_filemailer_creates_outbox(tmp_path):
    fm = FileMailer(tmp_path / "outbox")
    assert (tmp_path / "outbox").is_dir()


def test_filemailer_rejects_non_dir(tmp_path):
    (tmp_path / "file_not_dir").write_text("oops")
    with pytest.raises(RuntimeError):
        FileMailer(tmp_path / "file_not_dir")


def test_filemailer_send_writes_eml(tmp_path):
    fm = FileMailer(tmp_path)
    msg = _make_msg("run_enrolled")
    with fm.session():
        fm.send(msg)
    files = list(tmp_path.glob("*.eml"))
    assert len(files) == 1
    assert "run_enrolled" in files[0].name


def test_filemailer_traversal_kind_maps_to_unknown(tmp_path):
    fm = FileMailer(tmp_path)
    with fm.session():
        fm.send(_make_msg("../../tmp/evil"))
    files = list(tmp_path.glob("*.eml"))
    assert len(files) == 1
    assert (tmp_path.parent / "tmp" / "evil").exists() is False


@pytest.mark.parametrize("kind", ["/etc/passwd", "foo\\bar"])
def test_filemailer_slash_backslash_kind_unknown(tmp_path, kind):
    fm = FileMailer(tmp_path)
    with fm.session():
        fm.send(_make_msg(kind))
    files = list(tmp_path.glob("*.eml"))
    assert len(files) == 1
    assert "unknown" in files[0].name


def test_filemailer_missing_header_maps_to_unknown(tmp_path):
    fm = FileMailer(tmp_path)
    with fm.session():
        fm.send(_make_msg(None))
    files = list(tmp_path.glob("*.eml"))
    assert len(files) == 1
    assert "unknown" in files[0].name


def test_filemailer_atomic_rename(tmp_path):
    fm = FileMailer(tmp_path)
    with fm.session():
        fm.send(_make_msg("run_enrolled"))
    # No .tmp leftover after rename
    assert list(tmp_path.glob("*.tmp")) == []


def test_filemailer_uuid_disambiguates_same_timestamp(tmp_path):
    fm = FileMailer(tmp_path)
    with fm.session():
        fm.send(_make_msg("run_enrolled"))
        fm.send(_make_msg("run_enrolled"))
    assert len(list(tmp_path.glob("*.eml"))) == 2


def test_smtp_session_opens_connection_starttls_auth():
    with patch("mathion.notifications.mailer.smtplib.SMTP") as MockSMTP:
        mock_conn = MockSMTP.return_value
        sm = SMTPMailer("host", 587, "user", "pw")
        with sm.session():
            pass
        MockSMTP.assert_called_once_with("host", 587, timeout=30)
        mock_conn.starttls.assert_called_once()
        mock_conn.login.assert_called_once_with("user", "pw")
        mock_conn.quit.assert_called_once()


def test_smtp_send_without_session_raises():
    sm = SMTPMailer("host", 587, "user", "pw")
    msg = EmailMessage()
    msg["Subject"] = "x"
    with pytest.raises(AssertionError):
        sm.send(msg)


def test_smtp_reuses_connection_across_sends():
    with patch("mathion.notifications.mailer.smtplib.SMTP") as MockSMTP:
        mock_conn = MockSMTP.return_value
        sm = SMTPMailer("host", 587, "user", "pw")
        with sm.session():
            for _ in range(5):
                msg = EmailMessage()
                msg["Subject"] = "x"
                sm.send(msg)
        assert MockSMTP.call_count == 1
        assert mock_conn.send_message.call_count == 5


def test_smtp_propagates_recipients_refused():
    with patch("mathion.notifications.mailer.smtplib.SMTP") as MockSMTP:
        mock_conn = MockSMTP.return_value
        mock_conn.send_message.side_effect = smtplib.SMTPRecipientsRefused(
            {"x@x": (550, b"no such user")}
        )
        sm = SMTPMailer("host", 587, "user", "pw")
        with sm.session():
            with pytest.raises(smtplib.SMTPRecipientsRefused):
                msg = EmailMessage()
                msg["Subject"] = "x"
                sm.send(msg)


from mathion.notifications.mailer import build_mailer_from_settings


def _settings(**kwargs):
    """Minimal settings stub with the fields the factory reads."""
    from types import SimpleNamespace
    defaults = dict(email_mode="disabled", smtp_host="", smtp_port=587,
                    smtp_username="", smtp_password="", email_outbox="/tmp/x")
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_factory_disabled_returns_none():
    assert build_mailer_from_settings(_settings(email_mode="disabled")) is None


def test_factory_memory():
    assert isinstance(build_mailer_from_settings(_settings(email_mode="memory")), MemoryMailer)


def test_factory_file(tmp_path):
    s = _settings(email_mode="file", email_outbox=str(tmp_path / "ob"))
    assert isinstance(build_mailer_from_settings(s), FileMailer)


def test_factory_smtp_missing_config_raises():
    with pytest.raises(RuntimeError):
        build_mailer_from_settings(_settings(email_mode="smtp"))


def test_factory_smtp_full_config():
    s = _settings(email_mode="smtp", smtp_host="h", smtp_username="u", smtp_password="p")
    assert isinstance(build_mailer_from_settings(s), SMTPMailer)


def test_factory_unknown_mode_raises():
    with pytest.raises(RuntimeError):
        build_mailer_from_settings(_settings(email_mode="bogus"))
