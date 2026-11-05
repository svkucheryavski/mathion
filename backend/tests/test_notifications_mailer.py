import smtplib
from email.message import EmailMessage
from pathlib import Path
from unittest.mock import patch
import pytest

import ssl
from dataclasses import replace

from mathion.notifications.mailer import DEFAULT_FROM, MemoryMailer, FileMailer, SMTPMailer, build_mailer
from mathion.secret_box import SealError, seal
from mathion.site_settings import DEFAULTS


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


def _smtp(encryption="starttls", username="user", password="pw", verify_cert=True, port=587):
    return SMTPMailer("host", port, encryption, username, password, verify_cert)


def test_smtp_session_opens_connection_starttls_auth():
    with patch("mathion.notifications.mailer.smtplib.SMTP") as MockSMTP:
        mock_conn = MockSMTP.return_value
        with _smtp().session():
            pass
        MockSMTP.assert_called_once_with("host", 587, timeout=30)
        mock_conn.starttls.assert_called_once()
        mock_conn.login.assert_called_once_with("user", "pw")
        mock_conn.quit.assert_called_once()


def test_starttls_uses_default_context():
    # D7a: certificates are checked.
    with patch("mathion.notifications.mailer.smtplib.SMTP") as MockSMTP:
        with _smtp().session():
            pass
        ctx = MockSMTP.return_value.starttls.call_args.kwargs["context"]
        assert ctx.verify_mode == ssl.CERT_REQUIRED and ctx.check_hostname is True


def test_skip_cert_uses_unverified_context():
    with patch("mathion.notifications.mailer.smtplib.SMTP") as MockSMTP:
        with _smtp(verify_cert=False).session():
            pass
        ctx = MockSMTP.return_value.starttls.call_args.kwargs["context"]
        assert ctx.verify_mode == ssl.CERT_NONE and ctx.check_hostname is False


def test_ssl_uses_smtp_ssl():
    with patch("mathion.notifications.mailer.smtplib.SMTP") as MockSMTP, \
         patch("mathion.notifications.mailer.smtplib.SMTP_SSL") as MockSSL:
        with _smtp("ssl", port=465).session():
            pass
        MockSMTP.assert_not_called()
        assert MockSSL.call_args.args == ("host", 465)
        assert MockSSL.call_args.kwargs["timeout"] == 30
        assert MockSSL.call_args.kwargs["context"].verify_mode == ssl.CERT_REQUIRED
        MockSSL.return_value.starttls.assert_not_called()
        MockSSL.return_value.login.assert_called_once_with("user", "pw")


def test_none_never_calls_starttls_or_login():
    # D7a: a login needs encryption, so plain SMTP never sends the password.
    with patch("mathion.notifications.mailer.smtplib.SMTP") as MockSMTP:
        with _smtp("none", port=25).session():
            pass
        MockSMTP.return_value.starttls.assert_not_called()
        MockSMTP.return_value.login.assert_not_called()


def test_login_only_with_username():
    with patch("mathion.notifications.mailer.smtplib.SMTP") as MockSMTP:
        with _smtp(username="", password="").session():
            pass
        MockSMTP.return_value.starttls.assert_called_once()
        MockSMTP.return_value.login.assert_not_called()


@pytest.mark.parametrize("encryption,port", [("none", 25), ("ssl", 465), ("starttls", 587)])
def test_greeting_at_session_start(encryption, port):
    # A refused EHLO/HELO fails at session start (batch-level, D9c), not on the
    # first message, whatever the encryption or login.
    target = "SMTP_SSL" if encryption == "ssl" else "SMTP"
    with patch(f"mathion.notifications.mailer.smtplib.{target}") as Mock:
        Mock.return_value.ehlo_or_helo_if_needed.side_effect = smtplib.SMTPHeloError(554, b"go away")
        with pytest.raises(smtplib.SMTPHeloError):
            with _smtp(encryption, port=port, username="", password="").session():
                pytest.fail("the session started after a refused greeting")


def test_unknown_encryption_never_logs_in():
    # D7a: a login only over STARTTLS or SSL/TLS, never over anything else.
    with patch("mathion.notifications.mailer.smtplib.SMTP") as MockSMTP:
        with _smtp("bogus", port=25).session():
            pass
        MockSMTP.return_value.login.assert_not_called()


def test_password_is_opened_at_session_start():
    def unreadable():
        raise SealError("tag mismatch")
    with patch("mathion.notifications.mailer.smtplib.SMTP") as MockSMTP:
        with pytest.raises(SealError):
            with _smtp(password=unreadable).session():
                pass
        MockSMTP.assert_not_called()  # never connects with a password it can't read


def test_smtp_send_without_session_raises():
    msg = EmailMessage()
    msg["Subject"] = "x"
    with pytest.raises(AssertionError):
        _smtp().send(msg)


def test_smtp_reuses_connection_across_sends():
    with patch("mathion.notifications.mailer.smtplib.SMTP") as MockSMTP:
        mock_conn = MockSMTP.return_value
        sm = _smtp()
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
        sm = _smtp()
        with sm.session():
            with pytest.raises(smtplib.SMTPRecipientsRefused):
                msg = EmailMessage()
                msg["Subject"] = "x"
                sm.send(msg)


# --- build_mailer (D2c, D10): the dev modes follow .env, otherwise the panel ---

SECRET = "s" * 48
ON = replace(DEFAULTS, email_on=True, smtp_host="mail.uni.dk", smtp_port=465, smtp_encryption="ssl",
             smtp_username="u@uni.dk", smtp_password_sealed=seal("pw", SECRET),
             email_from="Mathion <noreply@uni.dk>")


@pytest.mark.parametrize("mode", ["disabled", "smtp"])
def test_factory_off_returns_none(mode):
    assert build_mailer(DEFAULTS, SECRET, mode) is None
    assert build_mailer(None, SECRET, mode) is None  # no row yet


@pytest.mark.parametrize("mode", ["disabled", "smtp"])
def test_factory_on_builds_smtp_from_the_saved_settings(mode):
    m = build_mailer(ON, SECRET, mode)
    assert isinstance(m, SMTPMailer)
    assert (m.host, m.port, m.encryption, m.username, m.verify_cert) == ("mail.uni.dk", 465, "ssl", "u@uni.dk", True)
    assert m.sender == "Mathion <noreply@uni.dk>"
    with patch("mathion.notifications.mailer.smtplib.SMTP_SSL") as MockSSL:
        with m.session():
            pass
    MockSSL.return_value.login.assert_called_once_with("u@uni.dk", "pw")


def test_factory_skip_cert_box():
    assert build_mailer(replace(ON, smtp_skip_cert_check=True), SECRET, "disabled").verify_cert is False


def test_factory_unreadable_password_raises_at_session_start():
    m = build_mailer(ON, "another-secret", "disabled")  # building never raises
    with patch("mathion.notifications.mailer.smtplib.SMTP_SSL") as MockSSL:
        with pytest.raises(SealError):
            with m.session():
                pass
    MockSSL.assert_not_called()


def test_factory_memory_ignores_the_panel():
    # D2c: the developer modes win.
    assert isinstance(build_mailer(DEFAULTS, SECRET, "memory"), MemoryMailer)
    assert isinstance(build_mailer(None, SECRET, "memory"), MemoryMailer)


def test_factory_file(tmp_path, monkeypatch):
    from mathion.config import settings
    monkeypatch.setattr(settings, "email_outbox", str(tmp_path / "ob"))
    m = build_mailer(ON, SECRET, "file")
    assert isinstance(m, FileMailer) and m.outbox == tmp_path / "ob"


def test_dev_modes_use_the_saved_from_or_the_default():
    assert build_mailer(ON, SECRET, "memory").sender == "Mathion <noreply@uni.dk>"
    assert build_mailer(DEFAULTS, SECRET, "memory").sender == DEFAULT_FROM
    assert MemoryMailer().sender == DEFAULT_FROM == "Mathion <noreply@mathion.test>"


def test_factory_unknown_mode_raises():
    with pytest.raises(RuntimeError):
        build_mailer(DEFAULTS, SECRET, "bogus")
