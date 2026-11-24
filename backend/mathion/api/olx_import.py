"""Open edX import: check a bundle, build it into a draft, report on and discard an unfinished draft."""
import os
import shutil

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from starlette.requests import ClientDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError
from sqlalchemy import exists, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from mathion.assets import commit_delete
from mathion.api.authz import require_course_admin
from mathion.api.lookups import get_or_404
from mathion.config import settings
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Block, Course, CourseVersion
from mathion.models_auth import User
from mathion.olx.apply import NOT_IN_DRAFT, ApplyRefused, apply
from mathion.olx.bundle import BuildBody, CheckBody
from mathion.olx.convert import UNFINISHED, convert, final_label
from mathion.olx.files import Limits
from mathion.olx.report import ReportLine, _clean_line
from mathion.schemas import OlxBuildResponse, OlxCheckResponse
from mathion.site_settings import load as load_site

router = APIRouter(tags=["olx-import"])

MAX_BODY = 45 * 1024 * 1024
KEPT = "This import finished; the draft was kept."
LOCK_NOT_AVAILABLE = "55P03"
MAX_ERRORS = 20
MAX_LOC = 100


def olx_course_admin(course_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Course:
    try:
        course = get_or_404(db, Course, course_id)
        require_course_admin(db, user, course.id)
        db.expunge(course)
        return course
    finally:
        db.rollback()                                    # no connection held while the body streams


def olx_version_admin(version_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> int:
    try:
        version = get_or_404(db, CourseVersion, version_id)
        require_course_admin(db, user, version.course_id)
        if version.is_disabled:
            raise HTTPException(status_code=403, detail="Version is disabled")
        return version.id
    finally:
        db.rollback()


async def capped_body(request: Request) -> bytes:
    length = request.headers.get("content-length")
    if length is not None and not (length.isascii() and length.isdigit()):
        raise HTTPException(status_code=400, detail="Bad Content-Length")
    if length is not None and int(length) > MAX_BODY:
        raise HTTPException(status_code=413, detail="The import request is too large")
    data = bytearray()
    try:
        async for chunk in request.stream():
            data += chunk
            if len(data) > MAX_BODY:
                raise HTTPException(status_code=413, detail="The import request is too large")
    except ClientDisconnect:
        raise HTTPException(status_code=400, detail="The request ended early") from None
    return bytes(data)


async def course_body(request: Request, course: Course = Depends(olx_course_admin)) -> bytes:
    return await capped_body(request)                    # runs only after the admin check passed


async def version_body(request: Request, version_id: int = Depends(olx_version_admin)) -> tuple[int, bytes]:
    return version_id, await capped_body(request)


def _parse(model: type[BaseModel], raw: bytes):
    try:
        return model.model_validate_json(raw)
    except ValidationError as exc:
        count = exc.error_count()
        if count > MAX_ERRORS:                           # never expand millions of errors
            raise HTTPException(status_code=422, detail=[
                {"type": "too_many_errors", "loc": ["body"], "msg": f"{count} problems in the request body"}]) from None
        # no input and short locations: the answer stays small whatever was sent
        errors = exc.errors(include_url=False, include_context=False, include_input=False)
        cut = lambda part: part[:MAX_LOC] if isinstance(part, str) else part  # noqa: E731
        raise HTTPException(status_code=422, detail=[{**e, "loc": ["body", *map(cut, e["loc"])]} for e in errors]) from None


def _limits(db: Session) -> Limits:
    site = load_site(db)
    return Limits(max_file_bytes=site.max_file_bytes, max_total_bytes=site.max_total_bytes)


def _quoted(text: str) -> list[str]:
    """Each “…” from an opening quote to the next closing one, in one linear pass."""
    out, pos = [], 0
    while (start := text.find("“", pos)) >= 0 and (end := text.find("”", start + 1)) >= 0:
        out.append(text[start:end + 1])
        pos = end + 1
    return out


def _name(ln: ReportLine) -> str:
    found = _quoted(ln.text)
    return found[0] if found else "\0"


def _merged(server: list[ReportLine], browser: list[ReportLine], missing: set[str]) -> list[ReportLine]:
    """Drop server lines about a missing file that the browser already reported or that say it was uploaded."""
    told = {name for ln in browser for name in _quoted(ln.text)}
    gone = {_name(_clean_line(ReportLine("note", "", f"“{source}”"))) for source in missing}

    def drop(ln: ReportLine) -> bool:
        if ln.text.endswith(NOT_IN_DRAFT):
            return _name(ln) in told
        return " was uploaded as " in ln.text and _name(ln) in gone
    return [ln for ln in server if not drop(ln)]


def _lines(lines: list[ReportLine]) -> list[dict]:
    return [{"level": ln.level, "where": ln.where, "text": ln.text} for ln in lines]


@router.post("/api/courses/{course_id}/olx-import/check", response_model=OlxCheckResponse)
def check(raw: bytes = Depends(course_body), db: Session = Depends(get_db)):
    body = _parse(CheckBody, raw)
    limits = _limits(db)
    db.rollback()
    plan = convert(body, limits)
    blockers = plan.report.blockers
    return OlxCheckResponse(
        summary=plan.summary, report=_lines(plan.report.lines()), blockers=_lines(blockers),
        uploads=[{"source": u.source, "target": u.target, "kind": u.kind, "size": u.size} for u in plan.uploads],
        linked=sorted(plan.linked_assets | plan.used_app_targets), max_quiz_attempts=plan.max_quiz_attempts,
        label=plan.label, blocking=bool(blockers),
    )


@router.post("/api/versions/{version_id}/olx-import/build", response_model=OlxBuildResponse)
def build(admin_body: tuple[int, bytes] = Depends(version_body), db: Session = Depends(get_db)):
    version_id, raw = admin_body
    body = _parse(BuildBody, raw)
    limits = _limits(db)
    db.rollback()
    plan = convert(body, limits)
    if plan.report.blockers:
        blockers = _lines(plan.report.blockers)
        return JSONResponse(status_code=409, content={"detail": f"The import is blocked: {blockers[0]['text']}",
                                                      "blockers": blockers})
    try:
        removed = apply(plan, version_id, db, body.date)
        commit_delete(db, removed)                       # files go only after the commit
    except ApplyRefused as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    except BaseException:
        db.rollback()
        raise
    browser = [_clean_line(ReportLine(ln.level, ln.where, ln.text)) for ln in body.report]
    kept = set(_merged(plan.report.lines(), browser, plan.not_uploaded)) | set(browser)
    report = [ln for ln in plan.report.lines(browser) if ln in kept]
    return OlxBuildResponse(report=_lines(report), label=final_label(plan.course_name, body.date))


def _course_admin_version(db: Session, user: User, version_id: int) -> None:
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)


def _lock_nowait(db: Session, version_id: int) -> bool:
    return db.execute(select(CourseVersion.id).where(CourseVersion.id == version_id)
                      .with_for_update(nowait=True, key_share=True)).scalar_one_or_none() is not None


@router.get("/api/versions/{version_id}/olx-import/status")
def status(version_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    try:
        _course_admin_version(db, user, version_id)
        try:
            found = _lock_nowait(db, version_id)
        except OperationalError as exc:
            if getattr(exc.orig, "sqlstate", None) != LOCK_NOT_AVAILABLE:
                raise
            return {"state": "running"}
        if not found:                                    # discarded after the admin check
            raise HTTPException(status_code=404, detail="Version not found")
        built = db.scalar(select(exists().where(Block.version_id == version_id)))
        return {"state": "built" if built else "empty"}
    finally:
        db.rollback()


@router.post("/api/versions/{version_id}/olx-import/discard", status_code=204)
def discard(version_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    _course_admin_version(db, user, version_id)
    version = db.execute(
        select(CourseVersion).where(CourseVersion.id == version_id)
        .with_for_update().execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if version is None:
        db.rollback()
        raise HTTPException(status_code=404, detail="Version not found")
    if version.is_disabled:
        db.rollback()
        raise HTTPException(status_code=403, detail="Version is disabled")
    built = db.scalar(select(exists().where(Block.version_id == version_id)))
    if version.state != "created" or not version.label.startswith(UNFINISHED) or built:
        db.rollback()
        raise HTTPException(status_code=409, detail=KEPT)
    db.delete(version)
    db.commit()
    shutil.rmtree(os.path.join(settings.asset_path, "courses", str(version_id)), ignore_errors=True)
    return Response(status_code=204)
