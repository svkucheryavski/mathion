import os
import shutil
from typing import TYPE_CHECKING

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.config import settings
from mathion.models import Asset

if TYPE_CHECKING:
    from mathion.models import CourseVersion


def copy_version_assets(db: Session, src_version_id: int, dst_version_id: int, uploaded_by: int | None) -> None:
    """Copy every Asset row + on-disk file from src_version_id to dst_version_id.

    Preflights that every source file exists on disk BEFORE writing any row or
    file (raises HTTPException 500 if any is missing). Does NOT roll back the
    session — each caller owns rollback (create_version wraps this with its own
    rollback; the /duplicate endpoint wraps it in a broader try/except). Flushes
    the inserted Asset rows before returning.
    """
    source_assets = db.execute(
        select(Asset).where(Asset.version_id == src_version_id)
    ).scalars().all()
    if not source_assets:
        return

    source_dir = os.path.join(settings.asset_path, "courses", str(src_version_id))
    dest_dir = os.path.join(settings.asset_path, "courses", str(dst_version_id))
    missing = [
        a.filename for a in source_assets
        if not os.path.isfile(os.path.join(source_dir, a.filename))
    ]
    if missing:
        raise HTTPException(
            status_code=500,
            detail=f"Source asset files missing on disk: {', '.join(sorted(missing))}",
        )

    os.makedirs(dest_dir, exist_ok=True)
    for src_asset in source_assets:
        db.add(Asset(
            version_id=dst_version_id,
            filename=src_asset.filename,
            file_size=src_asset.file_size,
            mime_type=src_asset.mime_type,
            uploaded_by=uploaded_by,
        ))
        shutil.copy2(
            os.path.join(source_dir, src_asset.filename),
            os.path.join(dest_dir, src_asset.filename),
        )
    db.flush()


def collect_referenced_filenames(db: Session, source: "CourseVersion") -> set[str]:
    """Every asset filename referenced anywhere in a version's content: version
    info_md, each item's content_md, each question's text_md/explanation_md, and
    each interactive_app item's script_url (skipped when None). Used by the
    /duplicate preflight to guarantee no render_with_assets/sync_script_reference
    call can 422 mid-clone after files have been written."""
    from mathion.markdown import extract_asset_filenames
    from mathion.models import Block, Item, Question, Sequence

    names: set[str] = set()
    if source.info_md:
        names |= extract_asset_filenames(source.info_md)

    items = db.execute(
        select(Item)
        .join(Sequence, Sequence.id == Item.sequence_id)
        .join(Block, Block.id == Sequence.block_id)
        .where(Block.version_id == source.id)
    ).scalars().all()
    for item in items:
        if item.content_md:
            names |= extract_asset_filenames(item.content_md)
        if item.type == "interactive_app" and item.script_url:
            names.add(item.script_url)

    questions = db.execute(
        select(Question)
        .join(Item, Item.id == Question.item_id)
        .join(Sequence, Sequence.id == Item.sequence_id)
        .join(Block, Block.id == Sequence.block_id)
        .where(Block.version_id == source.id)
    ).scalars().all()
    for q in questions:
        if q.text_md:
            names |= extract_asset_filenames(q.text_md)
        if q.explanation_md:
            names |= extract_asset_filenames(q.explanation_md)

    return names


def clone_version_content(db: Session, source, new) -> None:
    """Deep-copy source's Block->Sequence->Item->Question->AnswerOption tree into
    `new` (a freshly-flushed, asset-populated version). Renders each markdown
    field against `new`'s assets and rebuilds AssetReference rows so every URL and
    reference points at the new version. Assumes copy_version_assets has already
    run for `new`. Slugs copy verbatim — uniqueness is scoped to the fresh empty
    parents, so no collision is possible."""
    from mathion.api.helpers import render_with_assets, sync_asset_references, sync_script_reference
    from mathion.models import AnswerOption, Block, Item, Question, Sequence

    src_blocks = db.execute(
        select(Block).where(Block.version_id == source.id).order_by(Block.order)
    ).scalars().all()
    for sb in src_blocks:
        nb = Block(version_id=new.id, title=sb.title, slug=sb.slug, order=sb.order,
                   info=sb.info, info_html=sb.info_html)
        db.add(nb)
        db.flush()

        src_seqs = db.execute(
            select(Sequence).where(Sequence.block_id == sb.id).order_by(Sequence.order)
        ).scalars().all()
        for ss in src_seqs:
            ns = Sequence(block_id=nb.id, title=ss.title, slug=ss.slug, order=ss.order)
            db.add(ns)
            db.flush()

            src_items = db.execute(
                select(Item).where(Item.sequence_id == ss.id).order_by(Item.order)
            ).scalars().all()
            for si in src_items:
                ni = Item(sequence_id=ns.id, title=si.title, slug=si.slug, order=si.order,
                          type=si.type, video_url=si.video_url,
                          content_md=None, content_html="", script_url=None)
                db.add(ni)
                db.flush()

                if si.type == "interactive_app":
                    ni.script_url = si.script_url
                    ni.content_html = ""
                    sync_script_reference(db, new.id, ni.id, si.script_url)
                else:
                    ni.content_md = si.content_md
                    ni.content_html = render_with_assets(db, new.id, si.content_md)
                    sync_asset_references(db, new.id, [si.content_md], {"item_id": ni.id})

                src_questions = db.execute(
                    select(Question).where(Question.item_id == si.id).order_by(Question.order)
                ).scalars().all()
                for sq in src_questions:
                    nq = Question(
                        item_id=ni.id, text_md=sq.text_md,
                        text_html=render_with_assets(db, new.id, sq.text_md),
                        type=sq.type, order=sq.order,
                        explanation_md=sq.explanation_md,
                        explanation_html=render_with_assets(db, new.id, sq.explanation_md),
                        correct_numeric=sq.correct_numeric, precision=sq.precision,
                        correct_text=sq.correct_text,
                    )
                    db.add(nq)
                    db.flush()
                    sync_asset_references(db, new.id, [sq.text_md, sq.explanation_md], {"question_id": nq.id})

                    src_options = db.execute(
                        select(AnswerOption).where(AnswerOption.question_id == sq.id).order_by(AnswerOption.order)
                    ).scalars().all()
                    for so in src_options:
                        db.add(AnswerOption(question_id=nq.id, text=so.text,
                                            is_correct=so.is_correct, order=so.order))
    db.flush()
