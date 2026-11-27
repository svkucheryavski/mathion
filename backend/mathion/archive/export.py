"""Export a course version: its archive document, its files, and the archive's name."""
import io
import json
import os
import tarfile
import time
from collections.abc import Iterator
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from mathion.api.version_clone import collect_referenced_filenames
from mathion.archive.format import (
    ASSET_DIR, DOC_NAME, FORMAT, ArchiveBlock, ArchiveCourse, ArchiveDoc, ArchiveItem, ArchiveOption, ArchiveQuestion,
    ArchiveSequence, ArchiveVersion,
)
from mathion.config import settings
from mathion.models import Asset, Block, CourseVersion, Item, Question, Sequence


@dataclass(frozen=True)
class ArchiveFile:
    filename: str
    path: str
    mtime: float


def _question(q: Question) -> ArchiveQuestion:
    return ArchiveQuestion(
        type=q.type, text_md=q.text_md, explanation_md=q.explanation_md,
        correct_numeric=q.correct_numeric, precision=q.precision, correct_text=q.correct_text,
        options=[ArchiveOption(text=o.text, is_correct=o.is_correct) for o in q.options],
    )


def _item(i: Item) -> ArchiveItem:
    app = i.type == "interactive_app"
    return ArchiveItem(
        title=i.title, slug=i.slug, type=i.type,
        content_md=None if app else i.content_md, video_url=i.video_url,
        script=i.script_url if app else None,
        questions=[_question(q) for q in i.questions],
    )


def build_document(db: Session, version: CourseVersion) -> ArchiveDoc:
    blocks = db.execute(
        select(Block).where(Block.version_id == version.id).order_by(Block.order, Block.id)
        .options(selectinload(Block.sequences).selectinload(Sequence.items)
                 .selectinload(Item.questions).selectinload(Question.options))
    ).scalars().all()
    course = version.course
    return ArchiveDoc(
        format=FORMAT, made_by=settings.version,
        course=ArchiveCourse(name=course.name, slug=course.slug, description=course.description),
        version=ArchiveVersion(label=version.label, info_md=version.info_md,
                               max_quiz_attempts=version.max_quiz_attempts),
        blocks=[
            ArchiveBlock(title=b.title, slug=b.slug, info=b.info, sequences=[
                ArchiveSequence(title=s.title, slug=s.slug, items=[_item(i) for i in s.items])
                for s in b.sequences
            ])
            for b in blocks
        ],
    )


def document_bytes(doc: ArchiveDoc) -> bytes:
    return json.dumps(doc.model_dump(mode="json"), ensure_ascii=False, indent=2).encode("utf-8")


def preflight(db: Session, version: CourseVersion) -> list[ArchiveFile]:
    """Every file of the version, or 409 when the text or the disk lacks one."""
    # sorted in Python: the database's collation may order hyphens differently
    assets = sorted(db.execute(select(Asset).where(Asset.version_id == version.id)).scalars().all(),
                    key=lambda a: a.filename)
    dangling = collect_referenced_filenames(db, version) - {a.filename for a in assets}
    if dangling:
        raise HTTPException(status_code=409,
                            detail="This version links to files it does not hold: " + ", ".join(sorted(dangling)))
    folder = os.path.join(settings.asset_path, "courses", str(version.id))
    files = [ArchiveFile(a.filename, os.path.join(folder, a.filename), a.uploaded_at.timestamp()) for a in assets]
    missing = [f.filename for f in files if not os.path.isfile(f.path)]
    if missing:
        raise HTTPException(status_code=409,
                            detail="These files of the version are missing on the server: " + ", ".join(missing))
    return files


def archive_filename(course_slug: str, version_id: int) -> str:
    return f"{course_slug}-v{version_id}.tar.gz"


class _Sink:
    """Collects what tarfile writes until the stream hands it on."""

    def __init__(self) -> None:
        self.buf = bytearray()

    def write(self, data: bytes) -> int:
        self.buf += data
        return len(data)

    def take(self) -> memoryview:
        out, self.buf = self.buf, bytearray()
        return memoryview(out)


def _info(name: str, size: int, mtime: float) -> tarfile.TarInfo:
    info = tarfile.TarInfo(name)
    info.size, info.mtime, info.mode = size, int(mtime), 0o644
    return info


def stream_archive(doc: bytes, files: list[ArchiveFile]) -> Iterator[memoryview]:
    """The tar.gz, one entry at a time; a file that cannot be opened stops it."""
    sink = _Sink()
    # level 6: level 9 is much slower and gains almost nothing on images and scripts
    with tarfile.open(fileobj=sink, mode="w|gz", compresslevel=6) as tar:
        tar.addfile(_info(DOC_NAME, len(doc), time.time()), io.BytesIO(doc))
        if chunk := sink.take():
            yield chunk
        for f in files:
            with open(f.path, "rb") as fh:
                tar.addfile(_info(ASSET_DIR + f.filename, os.fstat(fh.fileno()).st_size, f.mtime), fh)
            if chunk := sink.take():
                yield chunk
    if chunk := sink.take():
        yield chunk
