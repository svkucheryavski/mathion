"""One place that turns a mail-server failure into words (superuser Settings
D9, D9b, D9c).

Some servers echo the login or parts of the password in their replies, so
nothing the server said leaves here: callers log and store only `text()`, the
exception's class name, the SMTP code and one of D9's sentences.
"""
import smtplib
import ssl
from dataclasses import dataclass
from email.utils import parseaddr

from mathion.secret_box import SealError

# Exceptions that come from talking to a mail server (or from opening the saved
# password for it); everything else is Mathion's own and keeps its message.
SMTP_FAILURES = (smtplib.SMTPException, OSError, SealError)

# D9c: failures on the mail server's side. Mid-send, these stop the batch
# without charging any message; a failed connect or session start always does.
_STOP_MID_SEND = (smtplib.SMTPAuthenticationError, ssl.SSLError, SealError, smtplib.SMTPSenderRefused,
                  smtplib.SMTPHeloError)

# The user's sentences (2026-11-12), D9.
NO_LOGIN = "The mail server doesn't take a login: clear the username and password."
NO_SMTPUTF8 = "The mail server can't take an address with letters like æ, ø or å."
TRY_LATER = "The mail server asked Mathion to try again later."
SENDER_REFUSED = "The mail server refused {sender} as the sender."
_SENDER_HEAD, _SENDER_TAIL = SENDER_REFUSED.split("{sender}")
NO_LOGIN_METHOD = "The mail server offers no login method Mathion can use."
USERNAME_ASCII = "The username can't contain letters like æ, ø or å."
SAVED_NOT_ASCII = "The saved password has characters that can't be sent: type it again."


class StartTlsRefused(smtplib.SMTPResponseException):
    """A reply other than 220 to STARTTLS."""


class LoginClosing(smtplib.SMTPResponseException):
    """A 421 to the login; smtplib would try the next method on a closed socket."""


class NoLoginMethod(smtplib.SMTPException):
    """The server offers no login method smtplib can use."""


class UsernameNotAscii(smtplib.SMTPException):
    """A username smtplib can't send."""


class PasswordNotAscii(smtplib.SMTPException):
    """A saved password smtplib can't send."""


def sender_side(sentence: str | None) -> bool:
    """D9d, rev 8: a line about the sender, which a login doesn't disprove;
    only a message that gets past the sender does."""
    return sentence is not None and (
        sentence in (TRY_LATER, NO_SMTPUTF8)
        or (sentence.startswith(_SENDER_HEAD) and sentence.endswith(_SENDER_TAIL)))


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


def _letters_in_from(exc: BaseException, sender: str) -> bool:
    """D9c, rev 8: a server without SMTPUTF8 and a From whose own address has
    other letters (copied by D2): every message would fail the same way. The
    same error for a recipient's address is that one message's."""
    return (isinstance(exc, smtplib.SMTPNotSupportedError) and "SMTPUTF8" in str(exc)
            and not parseaddr(sender)[1].isascii())


def closing(exc: BaseException) -> bool:
    """A 421 at RCPT or DATA: the server is closing the connection."""
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return any(code == 421 for code, _msg in (exc.recipients or {}).values())
    return isinstance(exc, smtplib.SMTPDataError) and exc.smtp_code == 421


def stops_the_batch(exc: BaseException, *, sender: str) -> bool:
    """D9c, mid-send: True for a failure on the server's side (no message is
    charged). A disconnect and a 421 are charged to their message and also end
    the batch; the dispatcher handles those itself."""
    return isinstance(exc, _STOP_MID_SEND) or _letters_in_from(exc, sender) or closing(exc)


def _code(exc: BaseException) -> int | None:
    if closing(exc):
        return 421
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        codes = [code for code, _msg in (exc.recipients or {}).values()]
        return codes[0] if codes else None
    code = getattr(exc, "smtp_code", None)
    return code if isinstance(code, int) else None


def _timed_out(exc: BaseException) -> bool:
    """smtplib turns a read that timed out (a server that never greets) into a
    disconnect, raised while the timeout is handled."""
    return isinstance(exc.__cause__, TimeoutError) or isinstance(exc.__context__, TimeoutError)


def describe(exc: BaseException, *, host: str, port: int, sender: str, recipient: str,
             encryption: str = "", timeout: int = 20) -> SmtpFailure:
    """D9's sentence for `exc`, which never quotes the server."""
    hint = _PORT_HINT if (encryption, port) in (("ssl", 587), ("starttls", 465)) else ""
    reach = f"Couldn't reach {host} on port {port}.{hint}"
    if isinstance(exc, smtplib.SMTPResponseException) and exc.smtp_code == 421:
        sentence, batch = TRY_LATER, True
    elif isinstance(exc, smtplib.SMTPAuthenticationError):
        sentence, batch = "The mail server refused the login.", True
    elif isinstance(exc, StartTlsRefused):
        sentence, batch = f"The secure connection to {host} failed.{hint}", True
    elif isinstance(exc, NoLoginMethod):
        sentence, batch = NO_LOGIN_METHOD, True
    elif isinstance(exc, UsernameNotAscii):
        sentence, batch = USERNAME_ASCII, True
    elif isinstance(exc, PasswordNotAscii):
        sentence, batch = SAVED_NOT_ASCII, True
    elif closing(exc):
        sentence, batch = TRY_LATER, True
    elif isinstance(exc, SealError):
        sentence, batch = "The saved password can't be read on this server: type it again.", True
    elif isinstance(exc, smtplib.SMTPSenderRefused):
        # A 4xx is a provider's sending limit and the like, not a bad From.
        temporary = isinstance(exc.smtp_code, int) and 400 <= exc.smtp_code <= 499
        sentence = TRY_LATER if temporary else SENDER_REFUSED.format(sender=sender)
        batch = True
    elif isinstance(exc, smtplib.SMTPRecipientsRefused):
        sentence, batch = f"The mail server refused to send to {recipient}.", False
    elif isinstance(exc, smtplib.SMTPHeloError):
        sentence, batch = "The mail server refused Mathion's greeting.", True
    elif isinstance(exc, ssl.SSLCertVerificationError):
        sentence, batch = "The mail server's certificate couldn't be checked.", True
    elif isinstance(exc, smtplib.SMTPNotSupportedError) and "SMTPUTF8" in str(exc):
        sentence, batch = NO_SMTPUTF8, _letters_in_from(exc, sender)
    elif isinstance(exc, smtplib.SMTPNotSupportedError) and "AUTH" in str(exc):
        sentence, batch = NO_LOGIN, True
    elif isinstance(exc, (ssl.SSLError, smtplib.SMTPNotSupportedError)):
        # The one SMTPNotSupportedError left is a server without STARTTLS.
        sentence, batch = f"The secure connection to {host} failed.{hint}", True
    elif isinstance(exc, TimeoutError) or (isinstance(exc, smtplib.SMTPServerDisconnected) and _timed_out(exc)):
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
