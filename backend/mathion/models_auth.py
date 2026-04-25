from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, JSON, String, ForeignKey, UniqueConstraint, func
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

    user: Mapped["User"] = relationship()
