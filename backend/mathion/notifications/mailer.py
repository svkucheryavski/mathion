from abc import ABC, abstractmethod
from collections.abc import Callable
from contextlib import contextmanager, AbstractContextManager
from email.message import EmailMessage
from pathlib import Path
import functools, smtplib, ssl, uuid, datetime as dt

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

    def _context(self) -> ssl.SSLContext:
        ctx = ssl.create_default_context()
        if not self.verify_cert:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        return ctx

    @contextmanager
    def session(self):
        login = bool(self.username) and self.encryption in ("starttls", "ssl")
        password = self.password() if (login and callable(self.password)) else self.password
        if self.encryption == "ssl":
            self._smtp = smtplib.SMTP_SSL(self.host, self.port, timeout=self.timeout, context=self._context())
        else:
            self._smtp = smtplib.SMTP(self.host, self.port, timeout=self.timeout)
        try:
            # The greeting now, so a refused EHLO/HELO fails the session start
            # (D9c) instead of the first message.
            self._smtp.ehlo_or_helo_if_needed()
            if self.encryption == "starttls":
                self._smtp.starttls(context=self._context())
            if login:
                self._smtp.login(self.username, password)
            yield
        finally:
            try:
                self._smtp.quit()
            except Exception:
                pass
            self._smtp = None

    def send(self, msg):
        assert self._smtp is not None, "SMTPMailer.send called outside session()"
        self._smtp.send_message(msg)


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
