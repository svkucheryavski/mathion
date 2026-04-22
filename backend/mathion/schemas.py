from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


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
