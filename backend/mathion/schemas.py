from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator, model_validator


class CourseCreate(BaseModel):
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    name: str = Field(min_length=1, max_length=200)
    description: str = ""


class CourseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class CourseResponse(BaseModel):
    id: int
    slug: str
    name: str
    description: str
    is_admin: bool = False  # populated per-request; defaults False so model_validate(course) keeps working

    model_config = {"from_attributes": True}


class VersionCreate(BaseModel):
    info_md: str = ""
    max_quiz_attempts: int = Field(default=3, ge=1, le=10)
    copy_assets_from: int | None = None


class VersionUpdate(BaseModel):
    info_md: str | None = None
    max_quiz_attempts: int | None = Field(default=None, ge=1, le=10)


class VersionRenderRequest(BaseModel):
    content_md: str


class VersionRenderResponse(BaseModel):
    html: str


class VersionResponse(BaseModel):
    id: int
    course_id: int
    state: str
    is_disabled: bool
    info_md: str
    info_html: str
    max_quiz_attempts: int
    created_at: datetime
    published_at: datetime | None
    archived_at: datetime | None

    model_config = {"from_attributes": True}


class BlockCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    info: str = ""


class BlockResponse(BaseModel):
    id: int
    version_id: int
    title: str
    slug: str
    order: int
    info: str
    info_html: str = ""
    model_config = {"from_attributes": True}


class SequenceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)


class SequenceResponse(BaseModel):
    id: int
    block_id: int
    title: str
    slug: str
    order: int
    model_config = {"from_attributes": True}


class ItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    type: Literal["static_page", "video", "quiz", "interactive_app"]
    content_md: str | None = None
    video_url: str | None = None
    script_url: str | None = None

    @field_validator("video_url", "script_url", mode="before")
    @classmethod
    def validate_url(cls, v: str | None) -> str | None:
        if v is not None and not v.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return v

    @model_validator(mode="after")
    def check_type_fields(self):
        if self.type == "static_page" and not self.content_md:
            raise ValueError("content_md is required for static_page items")
        if self.type == "video" and not self.video_url:
            raise ValueError("video_url is required for video items")
        if self.type == "interactive_app" and not self.script_url:
            raise ValueError("script_url is required for interactive_app items")
        return self


class BlockUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=200)
    info: str | None = None


class SequenceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=200)


class ItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content_md: str | None = None
    video_url: str | None = None
    script_url: str | None = None

    @field_validator("video_url", "script_url", mode="before")
    @classmethod
    def validate_url(cls, v: str | None) -> str | None:
        if v is not None and not v.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return v


class ItemResponse(BaseModel):
    id: int
    sequence_id: int
    title: str
    slug: str
    order: int
    type: str
    content_md: str | None
    content_html: str | None
    video_url: str | None
    script_url: str | None
    model_config = {"from_attributes": True}


class PinRequestSchema(BaseModel):
    email: str = Field(min_length=1, max_length=254)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class PinVerifySchema(BaseModel):
    email: str = Field(min_length=1, max_length=254)
    pin: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    duration_days: int = Field(ge=1, le=30)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str | None
    is_superuser: bool
    is_disabled: bool
    photo_url: str | None
    has_course_admin: bool = False   # NEW — overwritten by _user_response_with_flags
    has_run_teacher: bool = False    # NEW — overwritten by _user_response_with_flags

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)


class EnrollRequest(BaseModel):
    email: str = Field(min_length=1, max_length=254)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class EnrollBatchRequest(BaseModel):
    emails: list[str] = Field(min_length=1)


class EnrollmentResponse(BaseModel):
    id: int
    user_id: int
    version_id: int
    is_active: bool
    user_email: str
    user_full_name: str | None

    model_config = {"from_attributes": True}


class ItemStateResponse(BaseModel):
    is_covered: bool
    time_spent: int
    last_visited_at: datetime | None = None
    attempt_count: int = 0
    max_attempts: int = 3
    last_score: dict | None = None  # {"correct": N, "total": N}
    last_answers: list | dict | None = None


class StateJsonResponse(BaseModel):
    version_id: int
    current_item_id: int | None = None
    items: dict[str, ItemStateResponse]  # keyed by item ID as string


class TrackItemRequest(BaseModel):
    time_spent: int = Field(ge=0, le=86400)  # seconds to add (max 1 day per call)
    is_covered: bool | None = None  # set to True to mark covered; once covered, cannot be un-covered


class TrackItemResponse(BaseModel):
    item_id: int
    is_covered: bool
    time_spent: int
    last_visited_at: datetime | None = None


class MyVersionResponse(BaseModel):
    course_slug: str
    course_id: int
    version_id: int
    is_active: bool


class MyCourseResponse(BaseModel):
    course: CourseResponse
    version_id: int | None = None
    version_state: str | None = None
    total_items: int = 0
    covered_items: int = 0
    is_active: bool = False
    is_admin: bool = False


class QuestionCreate(BaseModel):
    text_md: str = Field(min_length=1)
    type: Literal["single_choice", "multiple_choice", "numeric_answer", "text_answer"]
    explanation_md: str | None = None
    correct_numeric: Decimal | None = None
    precision: int | None = Field(default=None, ge=0)
    correct_text: str | None = None


class QuestionUpdate(BaseModel):
    text_md: str | None = Field(default=None, min_length=1)
    explanation_md: str | None = None
    correct_numeric: Decimal | None = None
    precision: int | None = Field(default=None, ge=0)
    correct_text: str | None = None


class QuestionResponse(BaseModel):
    id: int
    item_id: int
    text_md: str
    text_html: str
    type: str
    order: int
    explanation_md: str | None
    explanation_html: str | None
    correct_numeric: Decimal | None
    precision: int | None
    correct_text: str | None

    model_config = {"from_attributes": True}

    @field_serializer("correct_numeric")
    @classmethod
    def serialize_decimal(cls, v: Decimal | None) -> float | None:
        return float(v) if v is not None else None


class OptionCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    is_correct: bool


class OptionUpdate(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=500)
    is_correct: bool | None = None


class OptionResponse(BaseModel):
    id: int
    question_id: int
    text: str
    is_correct: bool
    order: int

    model_config = {"from_attributes": True}


class ReorderItem(BaseModel):
    id: int
    order: int = Field(ge=1)


class ReorderRequest(BaseModel):
    order: list[ReorderItem] = Field(min_length=1)


class AssetResponse(BaseModel):
    id: int
    version_id: int
    filename: str
    file_size: int
    mime_type: str
    uploaded_at: datetime
    uploaded_by: int | None
    is_referenced: bool = False

    model_config = {"from_attributes": True}


class QuizSubmitRequest(BaseModel):
    answers: dict[str, list[int] | str]  # question_id -> [option_ids] or "value"


class QuizSubmitResponse(BaseModel):
    item_id: int
    attempt_count: int
    max_attempts: int
    score_correct: int
    score_total: int
    can_retry: bool


class QuestionReveal(BaseModel):
    id: int
    type: str
    text_html: str
    explanation_html: str | None
    correct_option_ids: list[int]
    correct_numeric: Decimal | None
    correct_text: str | None
    student_answer: list[int] | str | None

    @field_serializer("correct_numeric")
    @classmethod
    def serialize_decimal(cls, v: Decimal | None) -> float | None:
        return float(v) if v is not None else None


class QuizRevealResponse(BaseModel):
    item_id: int
    attempt_count: int
    score_correct: int
    score_total: int
    questions: list[QuestionReveal]


class RunCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    start_date: date
    end_date: date
    groups_enabled: bool = False

    @model_validator(mode="after")
    def check_date_order(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class RunUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    start_date: date | None = None
    end_date: date | None = None
    groups_enabled: bool | None = None


class RunResponse(BaseModel):
    id: int
    version_id: int
    title: str
    start_date: date
    end_date: date
    groups_enabled: bool
    is_published: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class RunTeacherCreate(BaseModel):
    email: str = Field(min_length=1, max_length=254)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class RunTeacherResponse(BaseModel):
    id: int
    run_id: int
    user_id: int
    user_email: str
    user_full_name: str | None
    created_at: datetime


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    is_disabled: bool | None = None


class GroupResponse(BaseModel):
    id: int
    run_id: int
    name: str
    is_disabled: bool = False
    student_count: int = 0

    model_config = {"from_attributes": True}


class RunStudentCreate(BaseModel):
    email: str = Field(min_length=1, max_length=254)
    group_id: int | None = None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class RunStudentBatchRow(BaseModel):
    name: str | None = None
    email: str = Field(min_length=1, max_length=254)
    group: str | None = None  # group name; auto-created if missing

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class RunStudentBatchRequest(BaseModel):
    rows: list[RunStudentBatchRow] = Field(min_length=1)


class RunStudentBatchResultRow(BaseModel):
    email: str
    status: Literal["added", "error"]
    group_id: int | None = None
    detail: str | None = None
    error_code: BulkRosterErrorCode | None = None


class RunStudentBatchResponse(BaseModel):
    results: list[RunStudentBatchResultRow]


# ---- Phase 7d: bulk roster operations ---------------------------------------

def _no_duplicate_user_ids(v: list[int]) -> list[int]:
    if len(set(v)) != len(v):
        raise ValueError("user_ids must not contain duplicates")
    return v


# Stable identifiers for known per-row error categories. Frontend should
# switch on these instead of parsing free-form `detail` strings. `None` means
# the error wasn't categorized (e.g., an unexpected exception); use `detail`.
BulkRosterErrorCode = Literal[
    "not_in_run",        # user is not enrolled in this run
    "capacity_reached",  # target group is at the 10-student cap
    "internal_error",    # unexpected exception during per-row processing
    "student_already_active_in_course",  # student has an active enrollment in another run of the same course
]


class BulkOpSummary(BaseModel):
    total: int
    ok: int
    error: int


class RunStudentBulkMoveRequest(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=200)
    group_id: int | None = None  # explicit None means unassign

    @field_validator("user_ids")
    @classmethod
    def no_duplicates(cls, v: list[int]) -> list[int]:
        return _no_duplicate_user_ids(v)


class RunStudentBulkMoveResultRow(BaseModel):
    user_id: int
    status: Literal["ok", "error"]
    group_id: int | None = None  # populated on success (target group, or null for unassign)
    detail: str | None = None    # populated on error
    error_code: BulkRosterErrorCode | None = None  # stable code on error rows


class RunStudentBulkMoveResponse(BaseModel):
    results: list[RunStudentBulkMoveResultRow]
    summary: BulkOpSummary


class RunStudentBulkDeleteRequest(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=200)

    @field_validator("user_ids")
    @classmethod
    def no_duplicates(cls, v: list[int]) -> list[int]:
        return _no_duplicate_user_ids(v)


class RunStudentBulkDeleteResultRow(BaseModel):
    user_id: int
    status: Literal["ok", "error"]
    detail: str | None = None  # populated on error
    error_code: BulkRosterErrorCode | None = None  # stable code on error rows


class RunStudentBulkDeleteResponse(BaseModel):
    results: list[RunStudentBulkDeleteResultRow]
    summary: BulkOpSummary


class RunStudentUpdate(BaseModel):
    group_id: int | None = None  # explicit None means unassign


class RunStudentResponse(BaseModel):
    id: int
    run_id: int
    user_id: int
    user_email: str
    user_full_name: str | None
    group_id: int | None
    created_at: datetime


# ============================================================================
# Phase 7b: Mini-Projects
# ============================================================================

class MiniProjectCreate(BaseModel):
    block_id: int
    assignment_md: str = Field(min_length=1)
    soft_deadline: datetime | None = None
    hard_deadline: datetime | None = None
    resubmission_deadline: datetime | None = None


class MiniProjectUpdate(BaseModel):
    assignment_md: str | None = Field(default=None, min_length=1)
    soft_deadline: datetime | None = None
    hard_deadline: datetime | None = None
    resubmission_deadline: datetime | None = None


class MiniProjectResponse(BaseModel):
    id: int
    run_id: int
    block_id: int
    title: str = ""  # service-populated: f"Mini project for Block {block.order}"
    assignment_md: str
    assignment_html: str
    soft_deadline: datetime | None
    hard_deadline: datetime | None
    resubmission_deadline: datetime | None
    is_published: bool
    first_submitted_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ============================================================================
# Phase 7b: Submissions
# ============================================================================

class SubmissionResponse(BaseModel):
    id: int
    mini_project_id: int
    group_id: int
    submission_number: int
    submitted_by: int
    submitted_at: datetime
    file_size: int
    is_late: bool
    is_resubmission: bool

    model_config = {"from_attributes": True}


# ============================================================================
# Phase 7b: Evaluations
# ============================================================================

class EvaluationUpdate(BaseModel):
    result: Literal["rejected", "major_revision", "minor_revision", "accepted"] | None = None
    score: int | None = Field(default=None, ge=0, le=100)
    feedback_text: str | None = None


class EvaluationResponse(BaseModel):
    id: int
    submission_id: int
    evaluated_by: int
    evaluated_at: datetime
    result: Literal["rejected", "major_revision", "minor_revision", "accepted"]
    score: int | None
    feedback_text: str | None
    has_feedback_file: bool = False

    model_config = {"from_attributes": True}


# ============================================================================
# Phase 7b: Run-Assets
# ============================================================================

class RunAssetResponse(BaseModel):
    id: int
    run_id: int
    filename: str
    file_size: int
    mime_type: str
    uploaded_at: datetime
    uploaded_by: int | None
    uploaded_by_email: str | None = None
    is_referenced: bool = False

    model_config = {"from_attributes": True}


# ============================================================================
# Slice A T4: Teacher monitoring — landing page row
# ============================================================================


class TeachingRunRow(BaseModel):
    run: "RunResponse"
    course_id: int
    course_name: str
    course_slug: str
    student_count: int
    # No `model_config` — this row is built field-by-field in the handler, not
    # from a single ORM model, so `from_attributes` would not apply correctly.


# ============================================================================
# Teacher Dashboards (T1): per-(student, sequence) item drilldown
# Spec: docs/superpowers/specs/2026-05-31-teacher-dashboards-design.md §5.1
# ============================================================================


class SequenceItemScore(BaseModel):
    """Quiz score on a single item — nested object on SequenceItemState."""
    correct: int
    total: int


class SequenceItemState(BaseModel):
    """Per-item state row in the drilldown response."""
    item_id: int
    item_order: int
    item_title: str
    item_type: Literal["static_page", "video", "quiz", "interactive_app"]
    is_covered: bool
    # last_score is null when: (a) item is not quiz, (b) no UIS row exists,
    # OR (c) row exists but BOTH score columns are None (visited but never attempted).
    last_score: SequenceItemScore | None
    # Top-level field (not nested under last_score) — mirrors UserItemState.last_visited_at.
    last_visited_at: datetime | None


class SequenceMeta(BaseModel):
    """Sequence + parent block metadata for the drilldown panel header."""
    sequence_id: int
    sequence_title: str
    block_id: int
    block_title: str


class StudentMeta(BaseModel):
    """Student metadata for the drilldown panel header."""
    user_id: int
    full_name: str | None
    email: str


class SequenceItemStateResponse(BaseModel):
    """Top-level response for the per-(student, sequence) drilldown endpoint."""
    sequence: SequenceMeta
    student: StudentMeta
    items: list[SequenceItemState]
