"""Export a course version: its archive document, its files, and the archive's name."""
import json
import os
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from mathion.api.version_clone import collect_referenced_filenames
from mathion.archive.format import (
    FORMAT, ArchiveBlock, ArchiveCourse, ArchiveDoc, ArchiveItem, ArchiveOption, ArchiveQuestion,
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
