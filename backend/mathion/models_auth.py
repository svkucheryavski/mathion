from datetime import datetime, timezone

from sqlalchemy import Boolean, CheckConstraint, DateTime, Integer, JSON, String, Text, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from mathion.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False, index=True)
    full_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_superuser: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_disabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    # D22: survives logout (sessions don't); set at sign-in and on the throttled session bump.
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    sessions: Mapped[list["Session"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_active_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="sessions")


class SuperuserPanelToken(Base):
    __tablename__ = "superuser_panel_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_active_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class LoginPIN(Base):
    __tablename__ = "login_pins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    pin_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user: Mapped["User"] = relationship()


class StudentEnrollment(Base):
    __tablename__ = "student_enrollments"
    __table_args__ = (
        UniqueConstraint("user_id", "version_id", name="uq_student_enrollment"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("course_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user: Mapped["User"] = relationship()


class RateLimitEntry(Base):
    __tablename__ = "rate_limit_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(300), nullable=False, index=True)  # e.g., "pin_request:alice@example.com"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class UserItemState(Base):
    __tablename__ = "user_item_states"
    __table_args__ = (
        UniqueConstraint("user_id", "item_id", name="uq_user_item_state"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), nullable=False, index=True)
    is_covered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    time_spent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # seconds
    last_visited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Quiz-specific fields
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_answers: Mapped[list | dict | None] = mapped_column(JSON, nullable=True)
    last_score_correct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_score_total: Mapped[int | None] = mapped_column(Integer, nullable=True)

    user: Mapped["User"] = relationship()


class NotificationLogEntry(Base):
    __tablename__ = "notification_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)

    user: Mapped["User"] = relationship()


# D10a: a row that wasn't copied as "on" is off since the start of time.
OFF_SINCE_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


class SiteSettings(Base):
    """The panel's Settings (superuser Settings spec): one row, id 1. A missing
    row means the defaults with email off (`mathion.site_settings.load`)."""
    __tablename__ = "site_settings"
    __table_args__ = (CheckConstraint("id = 1", name="ck_site_settings_one_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    # D7, D7a, D8: email.
    email_on: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    smtp_host: Mapped[str] = mapped_column(String(253), nullable=False, default="")
    smtp_port: Mapped[int] = mapped_column(Integer, nullable=False, default=587)
    smtp_encryption: Mapped[str] = mapped_column(String(10), nullable=False, default="starttls")
    smtp_skip_cert_check: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    smtp_username: Mapped[str] = mapped_column(String(254), nullable=False, default="")
    smtp_password_sealed: Mapped[str | None] = mapped_column(Text, nullable=True)
    email_from: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    # D11: whole MB of 1,048,576 bytes.
    max_file_mb: Mapped[int] = mapped_column(Integer, nullable=False, default=20)
    max_total_mb: Mapped[int] = mapped_column(Integer, nullable=False, default=500)
    # D12.
    pin_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    pin_requests_per_hour: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    pin_failures_per_hour: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    longest_sign_in_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    # D10a: the off interval is [email_off_at, email_on_at); both NULL means none.
    email_off_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=OFF_SINCE_EPOCH)
    email_on_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # D9a: the latest test of any values, and the card's test.
    test_fp: Mapped[str | None] = mapped_column(String(64), nullable=True)
    test_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    test_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    test_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    card_test_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    card_test_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    card_test_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # D9c, D9d: a stuck queue and its backoff.
    send_failure_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    send_failure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    send_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    send_backoff_step: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
