"""D9, D9b (superuser Settings): one helper turns a mail-server failure into
its class, code and D9's sentence; nothing the server said gets through."""
import logging
import smtplib
import socket
import ssl

import pytest

from mathion.notifications.smtp_errors import describe, stops_the_batch
from mathion.secret_box import SealError

WHERE = dict(host="mail.uni.dk", port=587, sender="Mathion <noreply@uni.dk>",
             recipient="anna@uni.dk", encryption="starttls")


def test_auth_failure_reply_never_logged(caplog):
    caplog.set_level(logging.DEBUG)
    f = describe(smtplib.SMTPAuthenticationError(535, b"bad S3ntinel-pw"), **WHERE)
    assert f.sentence == "The mail server refused the login."
    assert (f.cls, f.code, f.batch_level) == ("SMTPAuthenticationError", 535, True)
    assert "S3ntinel" not in f.text() and "S3ntinel" not in caplog.text


@pytest.mark.parametrize("exc,sentence,batch", [
    (ConnectionRefusedError("nope"), "Couldn't reach mail.uni.dk on port 587.", True),
    (socket.gaierror("no DNS"), "Couldn't reach mail.uni.dk on port 587.", True),
    (smtplib.SMTPConnectError(421, b"busy S3ntinel"), "Couldn't reach mail.uni.dk on port 587.", True),
    (smtplib.SMTPServerDisconnected("Connection unexpectedly closed"),
     "Couldn't reach mail.uni.dk on port 587.", True),
    (ssl.SSLError(1, "wrong version number"), "The secure connection to mail.uni.dk failed.", True),
    (smtplib.SMTPNotSupportedError("STARTTLS extension not supported by server."),
     "The secure connection to mail.uni.dk failed.", True),
    (ssl.SSLCertVerificationError(1, "self-signed certificate"),
     "The mail server's certificate couldn't be checked.", True),
    (smtplib.SMTPSenderRefused(553, b"S3ntinel not allowed", "noreply@uni.dk"),
     "The mail server refused Mathion <noreply@uni.dk> as the sender.", True),
    (smtplib.SMTPRecipientsRefused({"anna@uni.dk": (550, b"S3ntinel no such user")}),
     "The mail server refused to send to anna@uni.dk.", False),
    (TimeoutError("timed out"), "The mail server didn't answer within 20 seconds.", True),
    (SealError("tag mismatch"), "The saved password can't be read on this server: type it again.", True),
    (smtplib.SMTPDataError(554, b"S3ntinel spam"), "The mail server refused the message.", False),
    (smtplib.SMTPHeloError(554, b"S3ntinel go away"), "The mail server refused Mathion's greeting.", True),
])
def test_each_sentence(exc, sentence, batch):
    f = describe(exc, **WHERE)
    assert (f.sentence, f.batch_level) == (sentence, batch)
    assert "S3ntinel" not in f.text()


def test_codes_come_through():
    assert describe(smtplib.SMTPSenderRefused(553, b"x", "a@b"), **WHERE).code == 553
    assert describe(smtplib.SMTPRecipientsRefused({"a@b": (550, b"x")}), **WHERE).code == 550
    assert describe(ConnectionRefusedError("x"), **WHERE).code is None


def test_text_is_class_code_and_sentence():
    f = describe(smtplib.SMTPSenderRefused(553, b"x", "a@b"), **WHERE)
    assert f.text() == "SMTPSenderRefused 553: The mail server refused Mathion <noreply@uni.dk> as the sender."
    assert describe(TimeoutError(), **WHERE).text() == (
        "TimeoutError: The mail server didn't answer within 20 seconds.")


def test_timeout_says_the_real_seconds():
    f = describe(TimeoutError(), **WHERE, timeout=30)
    assert f.sentence == "The mail server didn't answer within 30 seconds."


@pytest.mark.parametrize("encryption,port", [("ssl", 587), ("starttls", 465)])
@pytest.mark.parametrize("exc", [ssl.SSLError(1, "wrong version number"), TimeoutError(),
                                 ConnectionRefusedError(), smtplib.SMTPServerDisconnected("x")])
def test_port_hint_on_a_failed_connection(encryption, port, exc):
    # D9: SSL/TLS on 587 or STARTTLS on 465 adds the hint.
    f = describe(exc, **{**WHERE, "encryption": encryption, "port": port})
    assert f.sentence.endswith(" Port 465 usually means SSL/TLS, and 587 STARTTLS.")


@pytest.mark.parametrize("encryption,port", [("ssl", 465), ("starttls", 587), ("none", 25), ("none", 587)])
def test_no_port_hint_when_ports_match(encryption, port):
    f = describe(TimeoutError(), **{**WHERE, "encryption": encryption, "port": port})
    assert "usually means" not in f.sentence


def test_no_port_hint_on_a_refused_login():
    f = describe(smtplib.SMTPAuthenticationError(535, b"x"), **{**WHERE, "encryption": "ssl", "port": 587})
    assert "usually means" not in f.sentence


@pytest.mark.parametrize("exc,stops", [
    (smtplib.SMTPAuthenticationError(535, b"x"), True),
    (ssl.SSLError(1, "x"), True),
    (SealError("x"), True),
    (smtplib.SMTPSenderRefused(553, b"x", "a@b"), True),
    (smtplib.SMTPHeloError(554, b"x"), True),
    (ConnectionRefusedError("x"), False),          # mid-batch: per message, as today
    (smtplib.SMTPServerDisconnected("x"), False),  # charged to its message (D9c)
    (smtplib.SMTPRecipientsRefused({"a@b": (550, b"x")}), False),
    (smtplib.SMTPDataError(554, b"x"), False),
])
def test_what_stops_a_batch_mid_send(exc, stops):
    # D9c: these stop the batch without charging any message.
    assert stops_the_batch(exc) is stops
