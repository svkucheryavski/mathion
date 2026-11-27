"""The course archive's document: mathion-course.json beside assets/<filename>."""
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_serializer

FORMAT = 1
DOC_NAME = "mathion-course.json"
ASSET_DIR = "assets/"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ArchiveOption(_Strict):
    text: str
    is_correct: bool


class ArchiveQuestion(_Strict):
    type: str
    text_md: str
    explanation_md: str | None
    correct_numeric: Decimal | None
    precision: int | None
    correct_text: str | None
    options: list[ArchiveOption]

    @field_serializer("correct_numeric")
    def _plain(self, v: Decimal | None) -> str | None:
        """Plain digits, never E-notation."""
        return None if v is None else format(v, "f")


class ArchiveItem(_Strict):
    title: str
    slug: str
    type: str
    content_md: str | None
    video_url: str | None
    script: str | None
    questions: list[ArchiveQuestion]


class ArchiveSequence(_Strict):
    title: str
    slug: str
    items: list[ArchiveItem]


class ArchiveBlock(_Strict):
    title: str
    slug: str
    info: str
    sequences: list[ArchiveSequence]


class ArchiveCourse(_Strict):
    name: str
    slug: str
    description: str


class ArchiveVersion(_Strict):
    label: str
    info_md: str
    max_quiz_attempts: int


class ArchiveDoc(_Strict):
    format: int
    made_by: str
    course: ArchiveCourse
    version: ArchiveVersion
    blocks: list[ArchiveBlock]
