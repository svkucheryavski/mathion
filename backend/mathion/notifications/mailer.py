from abc import ABC, abstractmethod
from contextlib import contextmanager, AbstractContextManager
from email.message import EmailMessage
from pathlib import Path
import functools, smtplib, uuid, datetime as dt


class Mailer(ABC):
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
        # loads early in `build_mailer_from_settings` without dragging
        # templates.py's transitive deps along.
        from .templates import TEMPLATES
        return frozenset(TEMPLATES.keys())

    def send(self, msg):
        ts = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S")
        raw_kind = msg.get("X-Mathion-Kind", "unknown")
        kind = raw_kind if raw_kind in self._allowed_kinds() else "unknown"
        path = self.outbox / f"{ts}-{kind}-{uuid.uuid4().hex[:8]}.eml"
        tmp = path.with_suffix(".eml.tmp")
        tmp.write_bytes(bytes(msg))
        tmp.rename(path)


class SMTPMailer(Mailer):
    def __init__(self, host, port, username, password):
        self.host, self.port = host, port
        self.username, self.password = username, password
        self._smtp: smtplib.SMTP | None = None

    @contextmanager
    def session(self):
        self._smtp = smtplib.SMTP(self.host, self.port, timeout=30)
        try:
            self._smtp.starttls()
            self._smtp.login(self.username, self.password)
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
