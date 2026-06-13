import socket
import smtplib

import pytest

from mathion.notifications.errors import classify


@pytest.mark.parametrize("exc", [
    ConnectionRefusedError("refused"),
    TimeoutError("timed out"),
    socket.gaierror("no DNS"),
    smtplib.SMTPServerDisconnected("disconnected"),
    smtplib.SMTPResponseException(421, "service not available"),
    smtplib.SMTPResponseException(450, "mailbox busy"),
    smtplib.SMTPResponseException(451, "local error"),
    smtplib.SMTPResponseException(452, "insufficient storage"),
    smtplib.SMTPHeloError(421, "..."),
    smtplib.SMTPConnectError(450, "..."),
    smtplib.SMTPSenderRefused(450, b"...", "from@x"),
    smtplib.SMTPRecipientsRefused({"a@x": (450, b"greylist"), "b@x": (451, b"overload")}),
    smtplib.SMTPRecipientsRefused({"a@x": (-1, b"malformed reply")}),
])
def test_classify_transient(exc):
    assert classify(exc) == 'transient'


@pytest.mark.parametrize("exc", [
    smtplib.SMTPResponseException(500, "syntax error"),
    smtplib.SMTPResponseException(535, "auth failed"),
    smtplib.SMTPResponseException(550, "mailbox unavailable"),
    smtplib.SMTPResponseException(551, "user not local"),
    smtplib.SMTPResponseException(553, "mailbox name not allowed"),
    smtplib.SMTPHeloError(500, "..."),
    smtplib.SMTPConnectError(550, "..."),
    smtplib.SMTPSenderRefused(550, b"...", "from@x"),
    smtplib.SMTPRecipientsRefused({"a@x": (550, b"no such user")}),
    smtplib.SMTPRecipientsRefused({"a@x": (450, b"greylist"), "b@x": (550, b"no such user")}),
    smtplib.SMTPRecipientsRefused({}),  # empty dict → permanent (defensive)
    KeyError("missing payload key"),
    ValueError("empty email"),
    LookupError("referent missing"),
    Exception("unknown"),
])
def test_classify_permanent(exc):
    assert classify(exc) == 'permanent'
