from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
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
    __table_args__ = (
        UniqueConstraint("course_id", "user_id", name="uq_course_admin"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    course: Mapped["Course"] = relationship(back_populates="admins")
    user: Mapped["User"] = relationship()


class CourseVersion(Base):
    __tablename__ = "course_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    state: Mapped[str] = mapped_column(String(20), nullable=False, default="created")
    is_disabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    info_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    info_html: Mapped[str] = mapped_column(Text, nullable=False, default="")
    max_quiz_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    content_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    course: Mapped["Course"] = relationship(back_populates="versions")
    blocks: Mapped[list["Block"]] = relationship(back_populates="version", cascade="all, delete-orphan", order_by="Block.order")


class Block(Base):
    __tablename__ = "blocks"
    __table_args__ = (
        UniqueConstraint("version_id", "slug", name="uq_block_version_slug"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("course_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    info: Mapped[str] = mapped_column(Text, nullable=False, default="")
    info_html: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    version: Mapped["CourseVersion"] = relationship(back_populates="blocks")
    sequences: Mapped[list["Sequence"]] = relationship(back_populates="block", cascade="all, delete-orphan", order_by="Sequence.order")


class Sequence(Base):
    __tablename__ = "sequences"
    __table_args__ = (
        UniqueConstraint("block_id", "slug", name="uq_sequence_block_slug"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    block_id: Mapped[int] = mapped_column(ForeignKey("blocks.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    block: Mapped["Block"] = relationship(back_populates="sequences")
    items: Mapped[list["Item"]] = relationship(back_populates="sequence", cascade="all, delete-orphan", order_by="Item.order")


class Item(Base):
    __tablename__ = "items"
    __table_args__ = (
        UniqueConstraint("sequence_id", "slug", name="uq_item_sequence_slug"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sequence_id: Mapped[int] = mapped_column(ForeignKey("sequences.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)

    # static_page fields
    content_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_html: Mapped[str | None] = mapped_column(Text, nullable=True)

    # video fields
    video_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # interactive_app fields
    script_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    sequence: Mapped["Sequence"] = relationship(back_populates="items")
    questions: Mapped[list["Question"]] = relationship(back_populates="item", cascade="all, delete-orphan", order_by="Question.order")


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), nullable=False, index=True)
    text_md: Mapped[str] = mapped_column(Text, nullable=False)
    text_html: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    explanation_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    explanation_html: Mapped[str | None] = mapped_column(Text, nullable=True)

    # numeric_answer fields
    correct_numeric: Mapped[Decimal | None] = mapped_column(Numeric(precision=20, scale=10), nullable=True)
    precision: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # text_answer fields
    correct_text: Mapped[str | None] = mapped_column(String(500), nullable=True)

    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    item: Mapped["Item"] = relationship(back_populates="questions")
    options: Mapped[list["AnswerOption"]] = relationship(back_populates="question", cascade="all, delete-orphan", order_by="AnswerOption.order")


class AnswerOption(Base):
    __tablename__ = "answer_options"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True)
    text: Mapped[str] = mapped_column(String(500), nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    question: Mapped["Question"] = relationship(back_populates="options")


class Asset(Base):
    __tablename__ = "assets"
    __table_args__ = (
        UniqueConstraint("version_id", "filename", name="uq_asset_version_filename"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("course_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    version: Mapped["CourseVersion"] = relationship()


class AssetReference(Base):
    """Tracks where an asset is referenced. Each row points to exactly one
    owner via item_id, question_id, or info_version_id (info_md on a course
    version). is_referenced for an asset is "any row exists for this asset_id".
    """
    __tablename__ = "asset_references"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), nullable=True, index=True)
    question_id: Mapped[int | None] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), nullable=True, index=True)
    info_version_id: Mapped[int | None] = mapped_column(ForeignKey("course_versions.id", ondelete="CASCADE"), nullable=True, index=True)


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("course_versions.id", ondelete="RESTRICT"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    groups_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    version: Mapped["CourseVersion"] = relationship()
    teachers: Mapped[list["RunTeacher"]] = relationship(back_populates="run", cascade="all, delete-orphan")
    groups: Mapped[list["Group"]] = relationship(back_populates="run", cascade="all, delete-orphan")
    students: Mapped[list["RunStudent"]] = relationship(back_populates="run", cascade="all, delete-orphan")


class RunTeacher(Base):
    __tablename__ = "run_teachers"
    __table_args__ = (
        UniqueConstraint("run_id", "user_id", name="uq_run_teacher"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    run: Mapped["Run"] = relationship(back_populates="teachers")
    user: Mapped["User"] = relationship()


class Group(Base):
    __tablename__ = "groups"
    __table_args__ = (
        UniqueConstraint("run_id", "name", name="uq_group_run_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    is_disabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    run: Mapped["Run"] = relationship(back_populates="groups")
    students: Mapped[list["RunStudent"]] = relationship(back_populates="group")


class RunStudent(Base):
    __tablename__ = "run_students"
    __table_args__ = (
        UniqueConstraint("run_id", "user_id", name="uq_run_student"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    run: Mapped["Run"] = relationship(back_populates="students")
    user: Mapped["User"] = relationship()
    group: Mapped["Group | None"] = relationship(back_populates="students")


class MiniProject(Base):
    __tablename__ = "mini_projects"
    __table_args__ = (
        UniqueConstraint("run_id", "block_id", name="uq_mini_project_run_block"),
        CheckConstraint(
            "soft_deadline IS NULL OR hard_deadline IS NULL OR soft_deadline <= hard_deadline",
            name="ck_mini_project_soft_le_hard",
        ),
        CheckConstraint(
            "hard_deadline IS NULL OR resubmission_deadline IS NULL OR hard_deadline <= resubmission_deadline",
            name="ck_mini_project_hard_le_resubmission",
        ),
        Index("ix_mini_projects_run_published", "run_id", "is_published"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    block_id: Mapped[int] = mapped_column(ForeignKey("blocks.id", ondelete="RESTRICT"), nullable=False, index=True)
    assignment_md: Mapped[str] = mapped_column(Text, nullable=False)
    assignment_html: Mapped[str] = mapped_column(Text, nullable=False)
    soft_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hard_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resubmission_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    first_submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    run: Mapped["Run"] = relationship()
    block: Mapped["Block"] = relationship()


class Submission(Base):
    __tablename__ = "submissions"
    __table_args__ = (
        UniqueConstraint("mini_project_id", "group_id", "submission_number", name="uq_submission_number"),
        CheckConstraint("submission_number >= 1", name="ck_submission_number_positive"),
        CheckConstraint("file_size > 0", name="ck_submission_file_size_positive"),
        Index(
            "ix_submissions_latest",
            "mini_project_id", "group_id", "submission_number",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mini_project_id: Mapped[int] = mapped_column(ForeignKey("mini_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="RESTRICT"), nullable=False, index=True)
    submission_number: Mapped[int] = mapped_column(Integer, nullable=False)
    submitted_by: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    is_late: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_resubmission: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    mini_project: Mapped["MiniProject"] = relationship()
    group: Mapped["Group"] = relationship()


class Evaluation(Base):
    __tablename__ = "evaluations"
    __table_args__ = (
        CheckConstraint(
            "result IN ('rejected', 'major_revision', 'minor_revision', 'accepted')",
            name="ck_evaluation_result_enum",
        ),
        CheckConstraint(
            "score IS NULL OR (score >= 0 AND score <= 100)",
            name="ck_evaluation_score_range",
        ),
        CheckConstraint(
            "result = 'accepted' OR feedback_file IS NOT NULL",
            name="ck_evaluation_feedback_file_required",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, unique=True)
    evaluated_by: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    evaluated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    result: Mapped[str] = mapped_column(String(20), nullable=False)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    feedback_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    feedback_file: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    submission: Mapped["Submission"] = relationship()


class RunAsset(Base):
    __tablename__ = "run_assets"
    __table_args__ = (
        UniqueConstraint("run_id", "filename", name="uq_run_asset_run_filename"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    run: Mapped["Run"] = relationship()


class RunAssetReference(Base):
    __tablename__ = "run_asset_references"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_asset_id: Mapped[int] = mapped_column(ForeignKey("run_assets.id", ondelete="CASCADE"), nullable=False, index=True)
    mini_project_id: Mapped[int] = mapped_column(ForeignKey("mini_projects.id", ondelete="CASCADE"), nullable=False, index=True)


from mathion.models_auth import (  # noqa: F401
    User, Session, LoginPIN, StudentEnrollment, RateLimitEntry,
    UserItemState, NotificationLogEntry,
)
