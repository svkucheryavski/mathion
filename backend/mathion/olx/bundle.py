"""Request bodies of the import calls: the export's text files, its static files and the picked app files."""
import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_FILES = 20000
MAX_TEXT_BYTES = 20 * 1024 * 1024


def _safe_path(path: str) -> str:
    if not path or path.startswith("/") or "\\" in path or "\x00" in path or ".." in path.split("/"):
        raise ValueError(f"unsafe path: {path[:200]!r}")
    try:
        path.encode("utf-8")
    except UnicodeEncodeError:
        raise ValueError("unsafe path: not valid text") from None
    return path


class StaticEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str
    size: int = Field(ge=0)
    skipped: Literal["empty", "type", "size"] | None = None

    @field_validator("path")
    @classmethod
    def _path_ok(cls, v: str) -> str:
        return _safe_path(v)


class AppEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=255, pattern=r"^[^\x00/\\]+$")
    size: int = Field(ge=0)


class ReportLineIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    level: Literal["skipped", "changed", "note"]
    where: str = Field(max_length=600, pattern=r"^[^\x00]*$")
    text: str = Field(max_length=2000, pattern=r"^[^\x00]*$")


class CheckBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    files: dict[str, str]
    static: list[StaticEntry] = Field(max_length=MAX_FILES)     # a long list stops at its first error
    apps: list[AppEntry] = Field(max_length=MAX_FILES)

    @model_validator(mode="after")
    def _caps(self) -> "CheckBody":
        if len(self.files) > MAX_FILES:
            raise ValueError(f"more than {MAX_FILES} text files")
        total = 0
        for path, text in self.files.items():
            _safe_path(path)
            if "\x00" in text:
                raise ValueError(f"NUL character in {path[:200]}")
            total += len(text) if text.isascii() else len(text.encode("utf-8"))
        if total > MAX_TEXT_BYTES:
            raise ValueError("more than 20 MB of text")
        return self


class BuildBody(CheckBody):
    report: list[ReportLineIn] = Field(max_length=20000)
    date: datetime.date
