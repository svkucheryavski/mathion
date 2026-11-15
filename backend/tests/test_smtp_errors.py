"""D9, D9b (superuser Settings): one helper turns a mail-server failure into
its class, code and D9's sentence; nothing the server said gets through."""
import contextlib
import logging
import smtplib
import socket
import ssl
import threading
from email.message import EmailMessage

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


def test_a_421_to_the_login_reads_try_later():
    f = describe(smtplib.SMTPAuthenticationError(421, b"closing"), **WHERE)
    assert f.sentence == "The mail server asked Mathion to try again later."
    assert (f.code, f.batch_level) == (421, True)


@pytest.mark.parametrize("exc,sentence,batch", [
    (ConnectionRefusedError("nope"), "Couldn't reach mail.uni.dk on port 587.", True),
    (socket.gaierror("no DNS"), "Couldn't reach mail.uni.dk on port 587.", True),
    (smtplib.SMTPConnectError(554, b"busy S3ntinel"), "Couldn't reach mail.uni.dk on port 587.", True),
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
    (smtplib.SMTPRecipientsRefused({"a@b.dk": (450, b"x")}), False),  # only a 421 stops
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


def _talker(replies, seen=None, default=b"250 ok"):
    """A stub that answers each verb from `replies` (else `default`) and notes
    every line it hears in `seen`."""
    def talk(conn, f):
        f.write(b"220 stub ready\r\n")
        f.flush()
        for line in f:
            if seen is not None:
                seen.append(line)
            verb = line[:4].upper().strip()
            if verb == b"QUIT":
                f.write(b"221 bye\r\n")
                f.flush()
                return
            f.write(replies.get(verb, default) + b"\r\n")
            f.flush()
    return talk


def test_starttls_refused_says_secure_connection_failed():
    from mathion.notifications.mailer import SMTPMailer
    from mathion.notifications.smtp_errors import StartTlsRefused
    talk = _talker({b"EHLO": b"250-stub\r\n250 STARTTLS", b"STAR": b"454 TLS not available"})
    with _stub(talk) as port:
        mailer = SMTPMailer("127.0.0.1", port, "starttls", "", "", True, timeout=5)
        with pytest.raises(StartTlsRefused) as caught:
            with mailer.session():
                pass
    f = describe(caught.value, **WHERE)
    assert (f.sentence, f.batch_level) == ("The secure connection to mail.uni.dk failed.", True)
    hinted = describe(caught.value, **{**WHERE, "port": 465})
    assert hinted.sentence == ("The secure connection to mail.uni.dk failed."
                               " Port 465 usually means SSL/TLS, and 587 STARTTLS.")


def test_no_login_method_says_so():
    from mathion.notifications.mailer import SMTPMailer
    from mathion.notifications.smtp_errors import NO_LOGIN_METHOD, NoLoginMethod
    with _stub(_talker({b"EHLO": b"250-stub\r\n250 AUTH XOAUTH2"})) as port:
        client = smtplib.SMTP("127.0.0.1", port, timeout=5)
        try:
            with pytest.raises(NoLoginMethod) as caught:
                SMTPMailer._login(client, "u@uni.dk", "pw")
        finally:
            client.quit()
    f = describe(caught.value, **WHERE)
    assert (f.sentence, f.batch_level) == (NO_LOGIN_METHOD, True)
    assert NO_LOGIN_METHOD == "The mail server offers no login method Mathion can use."


def test_non_ascii_username_says_so():
    from mathion.notifications.mailer import SMTPMailer
    from mathion.notifications.smtp_errors import USERNAME_ASCII, UsernameNotAscii
    seen = []
    with _stub(_talker({b"EHLO": b"250-stub\r\n250 AUTH PLAIN"}, seen)) as port:
        client = smtplib.SMTP("127.0.0.1", port, timeout=5)
        try:
            with pytest.raises(UsernameNotAscii) as caught:
                SMTPMailer._login(client, "søren@uni.dk", "pw")
        finally:
            client.quit()
    assert not any(line.upper().startswith(b"AUTH") for line in seen)
    f = describe(caught.value, **WHERE)
    assert (f.sentence, f.batch_level) == (USERNAME_ASCII, True)
    assert USERNAME_ASCII == "The username can't contain letters like æ, ø or å."


def test_421_at_rcpt_stops_the_batch():
    with _stub(_talker({b"RCPT": b"421 closing"})) as port:
        client = smtplib.SMTP("127.0.0.1", port, timeout=5)
        with pytest.raises(smtplib.SMTPRecipientsRefused) as caught:
            client.sendmail("noreply@uni.dk", ["anna@uni.dk"], "Subject: x\r\n\r\nx")
        client.close()
    for exc in (caught.value, smtplib.SMTPDataError(421, b"closing")):
        assert stops_the_batch(exc, sender=WHERE["sender"]) is True
        f = describe(exc, **WHERE)
        assert (f.sentence, f.batch_level) == (TRY_LATER, True)


def test_non_ascii_password_says_so():
    from mathion.notifications.mailer import SMTPMailer
    from mathion.notifications.smtp_errors import SAVED_NOT_ASCII, PasswordNotAscii
    seen = []
    with _stub(_talker({b"EHLO": b"250-stub\r\n250 AUTH PLAIN"}, seen)) as port:
        client = smtplib.SMTP("127.0.0.1", port, timeout=5)
        try:
            with pytest.raises(PasswordNotAscii) as caught:
                SMTPMailer._login(client, "u@uni.dk", "pässword")
        finally:
            client.quit()
    assert not any(line.upper().startswith(b"AUTH") for line in seen)
    f = describe(caught.value, **WHERE)
    assert (f.sentence, f.batch_level) == (SAVED_NOT_ASCII, True)
    assert SAVED_NOT_ASCII == "The saved password has characters that can't be sent: type it again."


def test_an_auth_loop_is_not_no_login_method():
    # smtplib's other plain SMTPException from login() keeps its old path.
    from mathion.notifications.mailer import SMTPMailer
    replies = {b"EHLO": b"250-stub\r\n250 AUTH LOGIN", b"QUIT": b"221 bye"}
    with _stub(_talker(replies, default=b"334 VXNlcm5hbWU6")) as port:
        client = smtplib.SMTP("127.0.0.1", port, timeout=5)
        try:
            with pytest.raises(smtplib.SMTPException) as caught:
                SMTPMailer._login(client, "u@uni.dk", "pw")
        finally:
            client.close()
    assert type(caught.value) is smtplib.SMTPException


def _hangs_up_on_auth(auth_line):
    """A stub offering `auth_line` that answers AUTH with 421 and closes."""
    def talk(conn, f):
        f.write(b"220 stub ready\r\n")
        f.flush()
        for line in f:
            if line[:4].upper() == b"AUTH":
                f.write(b"421 4.7.0 too many connections\r\n")
                f.flush()
                return
            f.write((b"250-stub\r\n" + auth_line if line[:4].upper() == b"EHLO" else b"250 ok") + b"\r\n")
            f.flush()
    return talk


@pytest.mark.parametrize("auth_line", [b"250 AUTH PLAIN", b"250 AUTH PLAIN LOGIN"])
def test_a_421_to_the_login_then_a_hang_up_reads_try_later(auth_line):
    # smtplib tries the next method on the closed socket unless _login stops it.
    from mathion.notifications.mailer import SMTPMailer
    from mathion.notifications.smtp_errors import LoginClosing
    with _stub(_hangs_up_on_auth(auth_line)) as port:
        client = smtplib.SMTP("127.0.0.1", port, timeout=5)
        try:
            with pytest.raises(smtplib.SMTPException) as caught:
                SMTPMailer._login(client, "u@uni.dk", "pw")
        finally:
            client.close()
    assert type(caught.value) is LoginClosing
    f = describe(caught.value, **WHERE)
    assert (f.sentence, f.code, f.batch_level) == (TRY_LATER, 421, True)


def test_a_421_greeting_reads_try_later():
    def talk(conn, f):
        f.write(b"421 4.7.0 too many connections\r\n")
        f.flush()
    with _stub(talk) as port:
        with pytest.raises(smtplib.SMTPConnectError) as caught:
            smtplib.SMTP("127.0.0.1", port, timeout=5)
    f = describe(caught.value, **WHERE)
    assert (f.sentence, f.code, f.batch_level) == (TRY_LATER, 421, True)


def test_a_421_to_ehlo_reads_try_later():
    f = describe(smtplib.SMTPHeloError(421, b"closing"), **WHERE)
    assert (f.sentence, f.code, f.batch_level) == (TRY_LATER, 421, True)


def _hangs_up_on_ehlo(nth):
    """A stub that answers the `nth` EHLO with 421 and closes."""
    def talk(conn, f):
        f.write(b"220 stub ready\r\n")
        f.flush()
        ehlos = 0
        for line in f:
            if line[:4].upper() == b"EHLO":
                ehlos += 1
                if ehlos == nth:
                    f.write(b"421 4.7.0 Try again later, closing connection. (EHLO)\r\n")
                    f.flush()
                    return
            f.write(b"250 ok\r\n")
            f.flush()
    return talk


def test_a_421_to_ehlo_then_a_hang_up_reads_try_later():
    # smtplib would send HELO on the closed socket and lose the 421.
    from mathion.notifications.mailer import SMTPMailer
    with _stub(_hangs_up_on_ehlo(1)) as port:
        with pytest.raises(smtplib.SMTPHeloError) as caught:
            with SMTPMailer("127.0.0.1", port, "none", "", "", True, timeout=5).session():
                pass
    f = describe(caught.value, **WHERE)
    assert (f.sentence, f.code, f.batch_level) == (TRY_LATER, 421, True)


def _helo_only(ehlo_reply, helo_reply, seen):
    """A stub that answers EHLO and HELO as given and takes a whole message."""
    def talk(conn, f):
        f.write(b"220 stub ready\r\n")
        f.flush()
        in_body = False
        for line in f:
            seen.append(line[:4].upper())
            if in_body:
                if line == b".\r\n":
                    in_body = False
                    f.write(b"250 queued\r\n")
                    f.flush()
                continue
            verb = line[:4].upper()
            reply = {b"EHLO": ehlo_reply, b"HELO": helo_reply, b"DATA": b"354 go on",
                     b"QUIT": b"221 bye"}.get(verb, b"250 ok")
            f.write(reply + b"\r\n")
            f.flush()
            in_body = verb == b"DATA"
            if verb == b"QUIT":
                return
    return talk


def test_a_refused_ehlo_falls_back_to_helo_and_sends():
    from mathion.notifications.mailer import SMTPMailer
    seen = []
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = "noreply@uni.dk", "anna@uni.dk", "x"
    msg.set_content("x")
    with _stub(_helo_only(b"502 no", b"250 hi", seen)) as port:
        mailer = SMTPMailer("127.0.0.1", port, "none", "", "", True, timeout=5)
        with mailer.session():
            mailer.send(msg)
    assert b"HELO" in seen and b"DATA" in seen


def test_a_refused_ehlo_and_helo_reads_the_greeting_sentence():
    from mathion.notifications.mailer import SMTPMailer
    with _stub(_helo_only(b"554 no", b"554 no", [])) as port:
        with pytest.raises(smtplib.SMTPHeloError) as caught:
            with SMTPMailer("127.0.0.1", port, "none", "", "", True, timeout=5).session():
                pass
    f = describe(caught.value, **WHERE)
    assert (f.sentence, f.code) == ("The mail server refused Mathion's greeting.", 554)


def test_a_421_to_the_second_ehlo_stops_the_batch():
    # After STARTTLS smtplib greets again inside login() or the first send.
    from mathion.notifications.mailer import SMTPMailer
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = "noreply@uni.dk", "anna@uni.dk", "x"
    msg.set_content("x")
    with _stub(_hangs_up_on_ehlo(2)) as port:
        mailer = SMTPMailer("127.0.0.1", port, "none", "", "", True, timeout=5)
        with pytest.raises(smtplib.SMTPHeloError) as caught:
            with mailer.session():
                mailer._smtp.ehlo_resp = mailer._smtp.helo_resp = None  # as starttls() leaves it
                mailer.send(msg)
    assert stops_the_batch(caught.value, sender=WHERE["sender"]) is True
    assert describe(caught.value, **WHERE).sentence == TRY_LATER


def test_a_421_after_another_refused_recipient_still_stops():
    exc = smtplib.SMTPRecipientsRefused({"a@uni.dk": (550, b"no"), "b@uni.dk": (421, b"closing")})
    assert stops_the_batch(exc, sender=WHERE["sender"]) is True
    f = describe(exc, **WHERE)
    assert (f.sentence, f.code) == (TRY_LATER, 421)


@pytest.mark.parametrize("data_reply,dot_reply", [(b"421 closing", b"250 ok"), (b"354 go on", b"421 closing")])
def test_421_at_data_or_after_the_body_stops_the_batch(data_reply, dot_reply):
    def talk(conn, f):
        f.write(b"220 stub ready\r\n")
        f.flush()
        in_body = False
        for line in f:
            if in_body:
                if line == b".\r\n":
                    in_body = False
                    f.write(dot_reply + b"\r\n")
                    f.flush()
                continue
            verb = line[:4].upper()
            if verb == b"DATA":
                f.write(data_reply + b"\r\n")
                in_body = data_reply.startswith(b"354")
            elif verb == b"QUIT":
                f.write(b"221 bye\r\n")
                f.flush()
                return
            else:
                f.write(b"250 ok\r\n")
            f.flush()

    with _stub(talk) as port:
        client = smtplib.SMTP("127.0.0.1", port, timeout=5)
        with pytest.raises(smtplib.SMTPDataError) as caught:
            client.sendmail("noreply@uni.dk", ["anna@uni.dk"], "Subject: x\r\n\r\nx")
        client.close()
    assert stops_the_batch(caught.value, sender=WHERE["sender"]) is True
    assert describe(caught.value, **WHERE).sentence == TRY_LATER


def test_421_to_starttls_says_try_later():
    from mathion.notifications.mailer import SMTPMailer
    from mathion.notifications.smtp_errors import StartTlsRefused
    talk = _talker({b"EHLO": b"250-stub\r\n250 STARTTLS", b"STAR": b"421 too many connections"})
    with _stub(talk) as port:
        mailer = SMTPMailer("127.0.0.1", port, "starttls", "", "", True, timeout=5)
        with pytest.raises(StartTlsRefused) as caught:
            with mailer.session():
                pass
    f = describe(caught.value, **{**WHERE, "port": 465})
    assert (f.sentence, f.batch_level) == (TRY_LATER, True)
