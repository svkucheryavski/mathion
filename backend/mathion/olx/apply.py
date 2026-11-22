"""Write a converted plan into a draft version, inside the caller's transaction."""
from datetime import date

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from mathion.api.asset_render import render_with_assets, sync_asset_references, sync_script_reference
from mathion.api.text_utils import bump_content_updated_at
from mathion.models import AnswerOption, Asset, Block, CourseVersion, Item, Question, Sequence
from mathion.olx.convert import Plan, PlanItem, final_label


NOT_IN_DRAFT = "was not uploaded, so it is not in the draft"


class ApplyRefused(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _before_lock() -> None:
    """Test seam: runs after authorisation, before the version lock."""


def _lock(db: Session, version_id: int) -> CourseVersion:
    version = db.execute(
        select(CourseVersion).where(CourseVersion.id == version_id)
        .with_for_update().execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if version is None:
        raise ApplyRefused(404, "Version not found")
    if version.is_disabled:
        raise ApplyRefused(403, "Version is disabled")
    if version.state != "created":
        raise ApplyRefused(409, "Can only import into a draft version")
    if db.scalar(select(exists().where(Block.version_id == version_id))):
        raise ApplyRefused(409, "This draft already has content; import into a new draft")
    return version


def _files(plan: Plan, version_id: int, db: Session) -> None:
    present = set(db.scalars(select(Asset.filename).where(Asset.version_id == version_id)))
    missing = sorted((plan.linked_assets | plan.used_app_targets) - present)
    if missing:
        raise ApplyRefused(409, "These files are linked from the course but are not in the draft: " + ", ".join(missing))
    for upload in plan.uploads:
        if upload.target not in present:
            plan.not_uploaded.add(upload.source)
            plan.report.add("skipped", "", f"The file “{upload.source}” {NOT_IN_DRAFT}")


def _item(db: Session, version_id: int, sequence_id: int, order: int, p: PlanItem) -> list[str]:
    item = Item(sequence_id=sequence_id, title=p.title, slug=p.slug, order=order, type=p.type,
                content_md=p.content_md, content_html="", video_url=p.video_url, script_url=p.app_target)
    db.add(item)
    db.flush()
    # the same steps as the item and question editors
    item.content_html = render_with_assets(db, version_id, p.content_md)
    sync_asset_references(db, version_id, [p.content_md], {"item_id": item.id})
    removed = sync_script_reference(db, version_id, item.id, p.app_target) if p.app_target else []
    for qn, q in enumerate(p.questions, 1):
        question = Question(item_id=item.id, text_md=q.text_md, text_html=render_with_assets(db, version_id, q.text_md),
                            type=q.type, order=qn, explanation_md=q.explanation_md,
                            explanation_html=render_with_assets(db, version_id, q.explanation_md),
                            correct_numeric=q.correct_numeric, precision=q.precision, correct_text=q.correct_text)
        db.add(question)
        db.flush()
        sync_asset_references(db, version_id, [q.text_md, q.explanation_md], {"question_id": question.id})
        for on, o in enumerate(q.options, 1):
            db.add(AnswerOption(question_id=question.id, text=o.text, is_correct=o.is_correct, order=on))
    return removed


def apply(plan: Plan, version_id: int, db: Session, day: date) -> list[str]:
    """Create the plan's content; returns script files to unlink after the caller commits."""
    _before_lock()
    version = _lock(db, version_id)
    _files(plan, version_id, db)
    removed: list[str] = []
    for bn, pb in enumerate(plan.blocks, 1):
        block = Block(version_id=version_id, title=pb.title, slug=pb.slug, order=bn, info="", info_html="")
        db.add(block)
        db.flush()
        for sn, ps in enumerate(pb.sequences, 1):
            seq = Sequence(block_id=block.id, title=ps.title, slug=ps.slug, order=sn)
            db.add(seq)
            db.flush()
            for n, p in enumerate(ps.items, 1):
                removed += _item(db, version_id, seq.id, n, p)
    version.label = final_label(plan.course_name, day)
    bump_content_updated_at(version)
    db.flush()
    return removed
