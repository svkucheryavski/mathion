"""Download a course version as a tar.gz archive, and check first that it can be."""
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from mathion.api.authz import require_course_admin
from mathion.api.lookups import get_or_404
from mathion.archive.export import (
    ArchiveFile, archive_filename, build_document, document_bytes, preflight, stream_archive,
)
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import CourseVersion
from mathion.models_auth import User

router = APIRouter(tags=["version-archive"])


def _prepare(db: Session, user: User, version_id: int) -> tuple[bytes, list[ArchiveFile], str]:
    """The document, the files and the name, all read from one snapshot."""
    db.commit()                                            # end the auth reads; the snapshot starts fresh
    try:
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        version = get_or_404(db, CourseVersion, version_id)
        require_course_admin(db, user, version.course_id)
        files = preflight(db, version)
        doc = document_bytes(build_document(db, version))
        return doc, files, archive_filename(version.course.slug, version.id)
    finally:
        db.rollback()                                      # no connection held while the archive streams


@router.get("/api/versions/{version_id}/archive/check")
def check(version_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    _, _, name = _prepare(db, user, version_id)
    return {"filename": name}


@router.get("/api/versions/{version_id}/archive")
def download(version_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> StreamingResponse:
    doc, files, name = _prepare(db, user, version_id)
    return StreamingResponse(stream_archive(doc, files), media_type="application/gzip",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})
