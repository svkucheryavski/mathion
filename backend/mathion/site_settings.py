"""The panel's Settings as the app reads them (superuser Settings spec D1, D2).

`load` answers the saved values. A missing row or table (a fresh install
starts the app before migrating; tests truncate after each test) means the
defaults with email off. Writers take the row with `get_row`.
"""
from dataclasses import dataclass, fields
from datetime import datetime

from psycopg.errors import UndefinedTable
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from mathion.models_auth import OFF_SINCE_EPOCH, SiteSettings

MB = 1_048_576

# D11, D12. max_total_mb's floor is the saved max_file_mb.
RANGES = {
    "max_file_mb": (1, 50),
    "max_total_mb": (1, 102_400),
    "pin_minutes": (5, 60),
    "pin_requests_per_hour": (3, 20),
    "pin_failures_per_hour": (3, 20),
}
SIGN_IN_DAYS = (1, 7, 30)
ENCRYPTIONS = ("starttls", "ssl", "none")


@dataclass(frozen=True)
class SiteSettingsView:
    email_on: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_encryption: str = "starttls"
    smtp_skip_cert_check: bool = False
    smtp_username: str = ""
    smtp_password_sealed: str | None = None
    email_from: str = ""
    max_file_mb: int = 20
    max_total_mb: int = 500
    pin_minutes: int = 10
    pin_requests_per_hour: int = 3
    pin_failures_per_hour: int = 5
    longest_sign_in_days: int = 30
    email_off_at: datetime | None = OFF_SINCE_EPOCH
    email_on_at: datetime | None = None
    test_fp: str | None = None
    test_at: datetime | None = None
    test_ok: bool | None = None
    test_message: str | None = None
    card_test_at: datetime | None = None
    card_test_ok: bool | None = None
    card_test_message: str | None = None
    send_failure_message: str | None = None
    send_failure_at: datetime | None = None
    send_retry_at: datetime | None = None
    send_backoff_step: int = 0

    @property
    def max_file_bytes(self) -> int:
        return self.max_file_mb * MB

    @property
    def max_total_bytes(self) -> int:
        return self.max_total_mb * MB


DEFAULTS = SiteSettingsView()
_FIELDS = tuple(f.name for f in fields(SiteSettingsView))


def view_of(row: SiteSettings) -> SiteSettingsView:
    return SiteSettingsView(**{name: getattr(row, name) for name in _FIELDS})


def load(db: Session) -> SiteSettingsView:
    # A savepoint, so a missing table (before the migration) never rolls back
    # the caller's own work.
    try:
        with db.begin_nested():
            row = db.get(SiteSettings, 1)
    except ProgrammingError as e:
        if not isinstance(e.orig, UndefinedTable):
            raise
        return DEFAULTS
    return DEFAULTS if row is None else view_of(row)


def get_row(db: Session) -> SiteSettings:
    """The row to write, created from the defaults when it's absent."""
    row = db.get(SiteSettings, 1)
    if row is None:
        db.execute(insert(SiteSettings).values(id=1).on_conflict_do_nothing(index_elements=["id"]))
        row = db.get(SiteSettings, 1)
    return row
