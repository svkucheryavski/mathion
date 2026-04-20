from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from mathion.database import Base


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")

    admins: Mapped[list["CourseAdmin"]] = relationship(back_populates="course", cascade="all, delete-orphan")
    versions: Mapped[list["CourseVersion"]] = relationship(back_populates="course", cascade="all, delete-orphan")


class CourseAdmin(Base):
    __tablename__ = "course_admins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)  # FK to users table added in Phase 2

    course: Mapped["Course"] = relationship(back_populates="admins")


class CourseVersion(Base):
    __tablename__ = "course_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)
    state: Mapped[str] = mapped_column(String(20), nullable=False, default="created")
    is_disabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    info_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    info_html: Mapped[str] = mapped_column(Text, nullable=False, default="")
    max_quiz_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    content_updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    course: Mapped["Course"] = relationship(back_populates="versions")
