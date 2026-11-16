from abc import ABC, abstractmethod
from collections.abc import Callable
from contextlib import contextmanager, AbstractContextManager
from email.message import EmailMessage
from pathlib import Path
import functools, smtplib, ssl, uuid, datetime as dt

from mathion.notifications.smtp_errors import LoginClosing, NoLoginMethod, PasswordNotAscii, StartTlsRefused, UsernameNotAscii
from mathion.secret_box import unseal

# The From when nothing is saved (a developer mode on a fresh install); the
# panel's From replaces it (superuser Settings D10b).
DEFAULT_FROM = "Mathion <noreply@mathion.test>"
DEV_MODES = ("file", "memory")


class Mailer(ABC):
    sender: str = DEFAULT_FROM  # the From every message gets

    @abstractmethod
    def session(self) -> AbstractContextManager[None]:
        """Return a context manager scoping one batch of sends."""
        ...

    @abstractmethod
    def send(self, msg: EmailMessage) -> None: ...


class MemoryMailer(Mailer):
    def __init__(self):
        self.sent: list[EmailMessage] = []

    @contextmanager
    def session(self):
        yield

    def send(self, msg):
        self.sent.append(msg)


class FileMailer(Mailer):
    def __init__(self, outbox_dir: Path):
        if outbox_dir.exists() and not outbox_dir.is_dir():
            raise RuntimeError(f"MATHION_EMAIL_OUTBOX={outbox_dir} exists but is not a directory")
        outbox_dir.mkdir(parents=True, exist_ok=True)
        self.outbox = outbox_dir

    @contextmanager
    def session(self):
        yield

    @classmethod
    @functools.cache
    def _allowed_kinds(cls) -> frozenset[str]:
        # Lazy import: templates.py does not import mailer.py, so this is not a
        # cycle break — it minimizes mailer.py's import-time graph so the module
        # loads early in `build_mailer` without dragging
        # templates.py's transitive deps along.
        from .templates import TEMPLATES
        return frozenset(TEMPLATES.keys()) | {"login_pin"}

    def send(self, msg):
        ts = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S")
        raw_kind = msg.get("X-Mathion-Kind", "unknown")
        kind = raw_kind if raw_kind in self._allowed_kinds() else "unknown"
        path = self.outbox / f"{ts}-{kind}-{uuid.uuid4().hex[:8]}.eml"
        tmp = path.with_suffix(".eml.tmp")
        tmp.write_bytes(bytes(msg))
        tmp.rename(path)


def logs_in(username: str | None, encryption: str | None) -> bool:
    """D7, D7a: a login happens only with a username and encryption."""
    return bool(username) and encryption in ("starttls", "ssl")


class SMTPMailer(Mailer):
    """Superuser Settings D7, D7a: STARTTLS, SSL/TLS or plain SMTP; the
    certificate is checked unless the box says not to; a login only with a
    username, and never in clear text. `password` may be a callable, opened at
    session start, so an unreadable saved password (D8) fails there."""

    def __init__(self, host, port, encryption, username, password: "str | Callable[[], str]",
                 verify_cert, timeout=30):
        self.host, self.port, self.encryption = host, port, encryption
        self.username, self.password = username, password
        self.verify_cert, self.timeout = verify_cert, timeout
        self._smtp: smtplib.SMTP | None = None
        self._closed_by: BaseException | None = None

    def _context(self) -> ssl.SSLContext:
        ctx = ssl.create_default_context()
        if not self.verify_cert:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        return ctx

    @contextmanager
    def session(self):
        login = logs_in(self.username, self.encryption)
        password = self.password() if (login and callable(self.password)) else self.password
        if self.encryption == "ssl":
            self._smtp = smtplib.SMTP_SSL(self.host, self.port, timeout=self.timeout, context=self._context())
        else:
            self._smtp = smtplib.SMTP(self.host, self.port, timeout=self.timeout)
        try:
            self._stop_on_421(self._smtp)
            self._watch_reset(self._smtp)
            # The greeting now, so a refused EHLO/HELO fails the session start
            # (D9c) instead of the first message.
            self._smtp.ehlo_or_helo_if_needed()
            if self.encryption == "starttls":
                try:
                    self._smtp.starttls(context=self._context())
                except smtplib.SMTPResponseException as exc:
                    if type(exc) is not smtplib.SMTPResponseException:
                        raise
                    raise StartTlsRefused(exc.smtp_code, exc.smtp_error) from exc
            if login:
                self._login(self._smtp, self.username, password)
            yield
        finally:
            try:
                self._smtp.quit()
            except Exception:
                pass
            self._smtp = None

    @staticmethod
    def _stop_on_421(smtp) -> None:
        """A 421 to any EHLO raises; smtplib would send HELO on the closed socket."""
        real_ehlo = smtp.ehlo

        def ehlo(*args, **kwargs):
            reply = real_ehlo(*args, **kwargs)
            if reply[0] == 421:
                raise smtplib.SMTPHeloError(*reply)
            return reply

        smtp.ehlo = ehlo

    def _watch_reset(self, smtp) -> None:
        """Keep a 421 or a hang-up at RSET, which smtplib drops; reset after a refused DATA."""
        def rset_kept():
            try:
                code, msg = smtp.rset()
            except smtplib.SMTPServerDisconnected as exc:
                self._closed_by = exc
                return
            except smtplib.SMTPResponseException:
                # An over-long reply: smtplib has closed the connection, so it counts as a hang-up.
                self._closed_by = smtplib.SMTPServerDisconnected("unreadable reply to RSET")
                return
            if code == 421:
                self._closed_by = smtplib.SMTPResponseException(code, msg)
                smtp.close()

        real_data = smtp.data

        def data(*args, **kwargs):
            try:
                return real_data(*args, **kwargs)
            except smtplib.SMTPDataError as exc:
                # data() raises only for the DATA command; smtplib then skips its RSET.
                if exc.smtp_code != 421:
                    rset_kept()
                raise

        smtp._rset = rset_kept
        smtp.data = data

    @staticmethod
    def _login(smtp, username: str, password: str) -> None:
        """Log in; a failure smtplib gives no class of its own gets one."""
        if not username.isascii():
            raise UsernameNotAscii("username")
        if not (password or "").isascii():
            raise PasswordNotAscii("password")
        real_auth = smtp.auth

        def auth(*args, **kwargs):
            try:
                return real_auth(*args, **kwargs)
            except smtplib.SMTPAuthenticationError as exc:
                if exc.smtp_code != 421:
                    raise
                raise LoginClosing(exc.smtp_code, exc.smtp_error) from exc

        smtp.auth = auth
        try:
            smtp.login(username, password)
        except smtplib.SMTPException as exc:
            # smtplib's own words, not the server's.
            if type(exc) is not smtplib.SMTPException or not str(exc).startswith("No suitable authentication method"):
                raise
            raise NoLoginMethod("no login method") from exc

    def send(self, msg):
        assert self._smtp is not None, "SMTPMailer.send called outside session()"
        self._closed_by = None
        try:
            self._smtp.send_message(msg)
        except Exception as exc:
            if self._closed_by is not None:
                exc.closed_after = self._closed_by
            raise


def build_mailer(view, secret: str, mode: str) -> Mailer | None:
    """The mailer for this moment (superuser Settings D2c, D10).

    `file` and `memory` follow `.env` (a developer outbox). Otherwise the
    panel's saved settings decide: None while email is off (or before there is
    a row, `view` None), else an SMTPMailer. Building never raises on a saved
    password that can't be read; the session does (D8)."""
    if mode not in ("smtp", "disabled", *DEV_MODES):
        raise RuntimeError(f"Unknown MATHION_EMAIL_MODE={mode!r}")
    if mode in DEV_MODES:
        from mathion.config import settings  # lazy: the live settings, after any reload
        mailer: Mailer = FileMailer(Path(settings.email_outbox)) if mode == "file" else MemoryMailer()
    elif view is None or not view.email_on or not view.smtp_host:
        return None
    else:
        password: "str | Callable[[], str]" = ""
        if view.smtp_username and view.smtp_password_sealed:
            password = functools.partial(unseal, view.smtp_password_sealed, secret)
        mailer = SMTPMailer(view.smtp_host, view.smtp_port, view.smtp_encryption, view.smtp_username,
                            password, verify_cert=not view.smtp_skip_cert_check)
    if view is not None and view.email_from:
        mailer.sender = view.email_from
    return mailer
