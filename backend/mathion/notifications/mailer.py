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
