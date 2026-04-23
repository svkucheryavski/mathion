from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


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

    model_config = {"from_attributes": True}


class VersionCreate(BaseModel):
    info_md: str = ""
    max_quiz_attempts: int = Field(default=3, ge=1, le=10)


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
    title: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    info: str = ""


class BlockResponse(BaseModel):
    id: int
    version_id: int
    title: str
    slug: str
    order: int
    info: str
    model_config = {"from_attributes": True}


class SequenceCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class SequenceResponse(BaseModel):
    id: int
    block_id: int
    title: str
    slug: str
    order: int
    model_config = {"from_attributes": True}


class ItemCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
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
    title: str | None = Field(default=None, min_length=1, max_length=200)
    info: str | None = None


class SequenceUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)


class ItemUpdate(BaseModel):
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
    version_id: int
    version_state: str
    total_items: int
    covered_items: int
    is_active: bool


class QuestionCreate(BaseModel):
    text_md: str = Field(min_length=1)
    type: Literal["single_choice", "multiple_choice", "numeric_answer", "text_answer"]
    explanation_md: str | None = None
    correct_numeric: float | None = None
    precision: int | None = Field(default=None, ge=0)
    correct_text: str | None = None


class QuestionUpdate(BaseModel):
    text_md: str | None = Field(default=None, min_length=1)
    explanation_md: str | None = None
    correct_numeric: float | None = None
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
    correct_numeric: float | None
    precision: int | None
    correct_text: str | None

    model_config = {"from_attributes": True}


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


class QuizSubmitRequest(BaseModel):
    answers: dict[str, list[int] | str]  # question_id -> [option_ids] or "value"


class QuizSubmitResponse(BaseModel):
    item_id: int
    attempt_count: int
    max_attempts: int
    score_correct: int
    score_total: int
    can_retry: bool
