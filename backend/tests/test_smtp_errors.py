"""D9, D9b (superuser Settings): one helper turns a mail-server failure into
its class, code and D9's sentence; nothing the server said gets through."""
import contextlib
import logging
import smtplib
import socket
import ssl
import threading

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
    (smtplib.SMTPNotSupportedError("SMTPUTF8 not supported by server"), False),  # an ASCII From: the recipient's
])
def test_what_stops_a_batch_mid_send(exc, stops):
    # D9c: these stop the batch without charging any message.
    assert stops_the_batch(exc, sender=WHERE["sender"]) is stops


NO_LOGIN = "The mail server doesn't take a login: clear the username and password."
LETTERS = "The mail server can't take an address with letters like æ, ø or å."
TRY_LATER = "The mail server asked Mathion to try again later."


@contextlib.contextmanager
def _stub(talk):
    """A mail server on 127.0.0.1 for one client; `talk(conn, file)` speaks
    for it. Real smtplib talks to it, so the tests see smtplib's own
    exceptions, not hand-made ones."""
    srv = socket.create_server(("127.0.0.1", 0))

    def serve():
        try:
            conn, _ = srv.accept()
        except OSError:
            return
        with conn, conn.makefile("rwb") as f:
            try:
                talk(conn, f)
            except OSError:
                pass

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    try:
        yield srv.getsockname()[1]
    finally:
        srv.close()
        thread.join(5)


def _no_auth(conn, f):
    f.write(b"220 stub ready\r\n")
    f.flush()
    for line in f:
        verb = line[:4].upper()
        if verb in (b"EHLO", b"HELO"):
            f.write(b"250-stub\r\n250 8BITMIME\r\n")
        elif verb == b"QUIT":
            f.write(b"221 bye\r\n")
            f.flush()
            return
        else:
            f.write(b"502 not here\r\n")
        f.flush()


def _silent(conn, f):
    conn.recv(1)  # never greets; waits for the client to give up


def test_no_auth_server_says_no_login():
    with _stub(_no_auth) as port:
        client = smtplib.SMTP("127.0.0.1", port, timeout=5)
        try:
            with pytest.raises(smtplib.SMTPNotSupportedError) as caught:
                client.login("u@uni.dk", "pw")
        finally:
            client.quit()
    f = describe(caught.value, **WHERE)
    assert (f.sentence, f.batch_level) == (NO_LOGIN, True)


def test_greeting_timeout_says_did_not_answer():
    with _stub(_silent) as port:
        with pytest.raises(smtplib.SMTPServerDisconnected) as caught:
            smtplib.SMTP("127.0.0.1", port, timeout=1)
    f = describe(caught.value, **WHERE, timeout=1)
    assert f.sentence == "The mail server didn't answer within 1 seconds."
    assert not f.sentence.startswith("Couldn't reach")


@pytest.mark.parametrize("text", [
    "SMTPUTF8 not supported by server",
    "One or more source or delivery addresses require internationalized email support,"
    " but the server does not advertise the required SMTPUTF8 capability",
])
def test_smtputf8_missing_says_letters(text):
    # D9c, rev 8: the server's side only when the From's own address has
    # such letters; otherwise it is one recipient's address, per message.
    exc = smtplib.SMTPNotSupportedError(text)
    f = describe(exc, **WHERE)
    assert (f.sentence, f.batch_level) == (LETTERS, False)
    assert not stops_the_batch(exc, sender=WHERE["sender"])
    f = describe(exc, **{**WHERE, "sender": "Mathion <nø@uni.dk>"})
    assert (f.sentence, f.batch_level) == (LETTERS, True)
    assert stops_the_batch(exc, sender="Mathion <nø@uni.dk>")


@pytest.mark.parametrize("code", [400, 421, 451, 499])
def test_4xx_sender_refused_is_try_later(code):
    # 421 is smtplib's own when a busy server closes at MAIL FROM.
    f = describe(smtplib.SMTPSenderRefused(code, b"4.7.1 slow down", "noreply@uni.dk"), **WHERE)
    assert (f.sentence, f.batch_level) == (TRY_LATER, True)
    f = describe(smtplib.SMTPSenderRefused(550, b"no", "noreply@uni.dk"), **WHERE)
    assert f.sentence == "The mail server refused Mathion <noreply@uni.dk> as the sender."
