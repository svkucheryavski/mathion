"""One place that turns a mail-server failure into words (superuser Settings
D9, D9b, D9c).

Some servers echo the login or parts of the password in their replies, so
nothing the server said leaves here: callers log and store only `text()`, the
exception's class name, the SMTP code and one of D9's sentences.
"""
import smtplib
import ssl
from dataclasses import dataclass

from mathion.secret_box import SealError

# Exceptions that come from talking to a mail server (or from opening the saved
# password for it); everything else is Mathion's own and keeps its message.
SMTP_FAILURES = (smtplib.SMTPException, OSError, SealError)

# D9c: failures on the mail server's side. Mid-send, these stop the batch
# without charging any message; a failed connect or session start always does.
_STOP_MID_SEND = (smtplib.SMTPAuthenticationError, ssl.SSLError, SealError, smtplib.SMTPSenderRefused,
                  smtplib.SMTPHeloError)

_PORT_HINT = " Port 465 usually means SSL/TLS, and 587 STARTTLS."


@dataclass(frozen=True)
class SmtpFailure:
    cls: str
    code: int | None
    sentence: str
    batch_level: bool

    def text(self) -> str:
        """What a log line or a stored error may say."""
        code = f" {self.code}" if self.code is not None else ""
        return f"{self.cls}{code}: {self.sentence}"


def stops_the_batch(exc: BaseException) -> bool:
    """D9c, mid-send: True for a failure on the server's side (no message is
    charged). A disconnect is charged to its message and also ends the batch;
    the dispatcher handles that one itself."""
    return isinstance(exc, _STOP_MID_SEND)


def _code(exc: BaseException) -> int | None:
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        codes = [code for code, _msg in (exc.recipients or {}).values()]
        return codes[0] if codes else None
    code = getattr(exc, "smtp_code", None)
    return code if isinstance(code, int) else None


def describe(exc: BaseException, *, host: str, port: int, sender: str, recipient: str,
             encryption: str = "", timeout: int = 20) -> SmtpFailure:
    """D9's sentence for `exc`, which never quotes the server."""
    hint = _PORT_HINT if (encryption, port) in (("ssl", 587), ("starttls", 465)) else ""
    reach = f"Couldn't reach {host} on port {port}.{hint}"
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        sentence, batch = "The mail server refused the login.", True
    elif isinstance(exc, SealError):
        sentence, batch = "The saved password can't be read on this server: type it again.", True
    elif isinstance(exc, smtplib.SMTPSenderRefused):
        sentence, batch = f"The mail server refused {sender} as the sender.", True
    elif isinstance(exc, smtplib.SMTPRecipientsRefused):
        sentence, batch = f"The mail server refused to send to {recipient}.", False
    elif isinstance(exc, smtplib.SMTPHeloError):
        sentence, batch = "The mail server refused Mathion's greeting.", True
    elif isinstance(exc, ssl.SSLCertVerificationError):
        sentence, batch = "The mail server's certificate couldn't be checked.", True
    elif isinstance(exc, (ssl.SSLError, smtplib.SMTPNotSupportedError)):
        sentence, batch = f"The secure connection to {host} failed.{hint}", True
    elif isinstance(exc, TimeoutError):
        sentence, batch = f"The mail server didn't answer within {timeout} seconds.{hint}", True
    elif isinstance(exc, (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected)):
        sentence, batch = reach, True
    elif isinstance(exc, smtplib.SMTPException):
        # A refused message (a 5xx data error and the like): D9 names no
        # sentence for it, so it says what happened, per message. Checked before
        # OSError: SMTPException is an OSError subclass.
        sentence, batch = "The mail server refused the message.", False
    elif isinstance(exc, OSError):  # refused, DNS, reset, unreachable
        sentence, batch = reach, True
    else:
        sentence, batch = f"Sending failed ({type(exc).__name__}).", False
    return SmtpFailure(cls=type(exc).__name__, code=_code(exc), sentence=sentence, batch_level=batch)
