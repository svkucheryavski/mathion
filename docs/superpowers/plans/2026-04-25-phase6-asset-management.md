# Phase 6: Asset Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add file asset management to course versions — upload, serve, delete, copy on version creation, and integrate with markdown rendering.

**Architecture:** Assets are stored on the filesystem at `{asset_path}/courses/{version_id}/{filename}`. A DB registry (`assets` table) tracks metadata. A join table (`asset_references`) tracks which items reference each asset. The markdown renderer resolves short filenames to full `/assets/{version_id}/{filename}` paths. Admin endpoints manage uploads/deletes; a public serve endpoint checks access. Version creation optionally copies assets from an existing version.

**Tech Stack:** FastAPI, SQLAlchemy 2.x, Pydantic v2, python-multipart (file uploads), shutil (file copy)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `mathion/models.py` | Add `Asset` and `AssetReference` models |
| `mathion/schemas.py` | Add `AssetResponse`, `AssetUploadResponse` schemas |
| `mathion/assets.py` | Pure utility: filename sanitization, extension validation, MIME type mapping |
| `mathion/api/assets.py` | API router: upload, list, serve, delete endpoints |
| `mathion/markdown.py` | Add `extract_asset_filenames()` and `resolve_asset_urls()` |
| `mathion/api/items.py` | Update item save to validate+resolve asset refs, update `AssetReference` |
| `mathion/api/versions.py` | Add optional `copy_assets_from` to version create |
| `mathion/main.py` | Register assets router |
| `tests/test_assets.py` | Unit tests for pure utility functions |
| `tests/test_assets_api.py` | Integration tests for API endpoints |
| `tests/test_asset_markdown.py` | Tests for markdown asset integration |
| `alembic/versions/xxx_add_assets.py` | Migration for new tables |

---

### Task 1: Asset model + AssetReference model + migration

**Files:**
- Modify: `mathion/models.py`
- Create: `alembic/versions/` (new migration)

- [ ] **Step 1: Add Asset and AssetReference models to `mathion/models.py`**

Add before the final import line (`from mathion.models_auth import ...`):

```python
class Asset(Base):
    __tablename__ = "assets"
    __table_args__ = (
        UniqueConstraint("version_id", "filename", name="uq_asset_version_filename"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("course_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    version: Mapped["CourseVersion"] = relationship()


class AssetReference(Base):
    __tablename__ = "asset_references"
    __table_args__ = (
        UniqueConstraint("asset_id", "item_id", name="uq_asset_reference"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), nullable=False, index=True)
```

- [ ] **Step 2: Generate alembic migration**

Run: `.venv/bin/alembic revision --autogenerate -m "add_assets_and_references"`
Expected: New migration file created in `alembic/versions/`

- [ ] **Step 3: Apply migration and verify**

Run: `.venv/bin/alembic upgrade head`
Expected: Migration applies successfully

- [ ] **Step 4: Run existing tests to verify no regressions**

Run: `.venv/bin/pytest -x -q`
Expected: All 260 tests pass

- [ ] **Step 5: Commit**

```bash
git add mathion/models.py alembic/versions/*add_assets*
git commit -m "feat: add Asset and AssetReference models"
```

---

### Task 2: Asset schemas

**Files:**
- Modify: `mathion/schemas.py`

- [ ] **Step 1: Add asset schemas to `mathion/schemas.py`**

Add at the end of the file, before `QuizSubmitRequest`:

```python
class AssetResponse(BaseModel):
    id: int
    version_id: int
    filename: str
    file_size: int
    mime_type: str
    uploaded_at: datetime
    uploaded_by: int | None
    is_referenced: bool = False

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: Update VersionCreate to accept optional copy_assets_from**

Change the `VersionCreate` class:

```python
class VersionCreate(BaseModel):
    info_md: str = ""
    max_quiz_attempts: int = Field(default=3, ge=1, le=10)
    copy_assets_from: int | None = None  # version_id to copy assets from
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `.venv/bin/pytest -x -q`
Expected: All 260 tests pass

- [ ] **Step 4: Commit**

```bash
git add mathion/schemas.py
git commit -m "feat: add asset schemas and copy_assets_from field"
```

---

### Task 3: Filename sanitization + MIME validation utility

**Files:**
- Create: `mathion/assets.py`
- Create: `tests/test_assets.py`

- [ ] **Step 1: Write failing tests for filename sanitization**

Create `tests/test_assets.py`:

```python
from mathion.assets import sanitize_filename, validate_extension, get_mime_type


def test_sanitize_lowercase():
    assert sanitize_filename("MyFile.PDF") == "myfile.pdf"


def test_sanitize_spaces_to_hyphens():
    assert sanitize_filename("my file name.png") == "my-file-name.png"


def test_sanitize_special_chars_removed():
    assert sanitize_filename("hello@world#1.jpg") == "helloworld1.jpg"


def test_sanitize_unicode_normalized():
    assert sanitize_filename("cafe\u0301.pdf") == "cafe.pdf"


def test_sanitize_multiple_hyphens_collapsed():
    assert sanitize_filename("a---b.png") == "a-b.png"


def test_sanitize_leading_trailing_hyphens_stripped():
    assert sanitize_filename("-test-.pdf") == "test.pdf"


def test_sanitize_underscores_to_hyphens():
    assert sanitize_filename("my_file_name.png") == "my-file-name.png"


def test_sanitize_empty_base_uses_fallback():
    assert sanitize_filename("!!!.png") == "file.png"


def test_sanitize_no_extension():
    assert sanitize_filename("README") == "readme"


def test_validate_extension_allowed():
    assert validate_extension("diagram.png") == "png"
    assert validate_extension("slides.PDF") == "pdf"
    assert validate_extension("data.csv") == "csv"
    assert validate_extension("app.js") == "js"
    assert validate_extension("analysis.r") == "r"
    assert validate_extension("script.py") == "py"
    assert validate_extension("code.m") == "m"


def test_validate_extension_blocked():
    assert validate_extension("hack.svg") is None
    assert validate_extension("virus.exe") is None
    assert validate_extension("page.html") is None
    assert validate_extension("noext") is None


def test_get_mime_type():
    assert get_mime_type("png") == "image/png"
    assert get_mime_type("jpg") == "image/jpeg"
    assert get_mime_type("pdf") == "application/pdf"
    assert get_mime_type("js") == "application/javascript"
    assert get_mime_type("unknown") == "application/octet-stream"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_assets.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'mathion.assets'`

- [ ] **Step 3: Implement `mathion/assets.py`**

```python
import re
import unicodedata

ALLOWED_EXTENSIONS = {
    "png", "jpg", "jpeg", "gif",
    "pdf", "csv", "xls", "xlsx", "ppt", "pptx",
    "r", "py", "m",
    "js",
}

_EXTENSION_TO_MIME = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "pdf": "application/pdf",
    "csv": "text/csv",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "r": "text/plain",
    "py": "text/plain",
    "m": "text/plain",
    "js": "application/javascript",
}


def sanitize_filename(name: str) -> str:
    """Sanitize filename: lowercase, spaces to hyphens, strip special chars."""
    if "." in name:
        base, ext = name.rsplit(".", 1)
        ext = ext.lower()
    else:
        base = name
        ext = ""

    base = unicodedata.normalize("NFKD", base)
    base = base.encode("ascii", "ignore").decode("ascii")
    base = base.lower()
    base = re.sub(r"[\s_]+", "-", base)
    base = re.sub(r"[^a-z0-9-]", "", base)
    base = re.sub(r"-+", "-", base)
    base = base.strip("-")

    if not base:
        base = "file"

    return f"{base}.{ext}" if ext else base


def validate_extension(filename: str) -> str | None:
    """Return the lowercase extension if allowed, None otherwise."""
    if "." not in filename:
        return None
    ext = filename.rsplit(".", 1)[1].lower()
    return ext if ext in ALLOWED_EXTENSIONS else None


def get_mime_type(ext: str) -> str:
    """Get MIME type for a file extension."""
    return _EXTENSION_TO_MIME.get(ext, "application/octet-stream")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_assets.py -v`
Expected: All 14 tests pass

- [ ] **Step 5: Commit**

```bash
git add mathion/assets.py tests/test_assets.py
git commit -m "feat: add filename sanitization and extension validation"
```

---

### Task 4: Asset upload + list endpoints

**Files:**
- Create: `mathion/api/assets.py`
- Modify: `mathion/main.py`
- Create: `tests/test_assets_api.py`

- [ ] **Step 1: Write failing tests for upload and list**

Create `tests/test_assets_api.py`:

```python
import io
import os
import tempfile

import pytest

from mathion.config import settings


@pytest.fixture(autouse=True)
def asset_tmpdir(tmp_path):
    """Override asset_path to use a temp directory for tests."""
    original = settings.asset_path
    settings.asset_path = str(tmp_path)
    yield tmp_path
    settings.asset_path = original


def _create_published_version(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "asset-course", "name": "AC", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Page", "slug": "page", "type": "static_page", "content_md": "# Hi",
    })
    admin_client.post(f"/api/versions/{version['id']}/publish")
    return course, version


def test_upload_asset(admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    file_content = b"fake png content"
    response = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("My Diagram.PNG", io.BytesIO(file_content), "image/png")},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["filename"] == "my-diagram.png"
    assert data["file_size"] == len(file_content)
    assert data["mime_type"] == "image/png"
    # File exists on disk
    path = asset_tmpdir / "courses" / str(version["id"]) / "my-diagram.png"
    assert path.exists()
    assert path.read_bytes() == file_content


def test_upload_duplicate_filename_rejected(admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("test.png", io.BytesIO(b"a"), "image/png")},
    )
    response = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("test.png", io.BytesIO(b"b"), "image/png")},
    )
    assert response.status_code == 409


def test_upload_svg_rejected(admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    response = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("hack.svg", io.BytesIO(b"<svg></svg>"), "image/svg+xml")},
    )
    assert response.status_code == 400
    assert "extension" in response.json()["detail"].lower()


def test_upload_too_large_rejected(admin_client, asset_tmpdir):
    original = settings.max_file_size
    settings.max_file_size = 100  # 100 bytes
    course, version = _create_published_version(admin_client)
    response = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("big.png", io.BytesIO(b"x" * 200), "image/png")},
    )
    settings.max_file_size = original
    assert response.status_code == 400
    assert "size" in response.json()["detail"].lower()


def test_upload_version_total_exceeded(admin_client, asset_tmpdir):
    original = settings.max_course_size
    settings.max_course_size = 50
    course, version = _create_published_version(admin_client)
    # First upload succeeds (10 bytes < 50)
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("a.png", io.BytesIO(b"x" * 10), "image/png")},
    )
    # Second upload exceeds total (10 + 50 > 50)
    response = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("b.png", io.BytesIO(b"x" * 50), "image/png")},
    )
    settings.max_course_size = original
    assert response.status_code == 400
    assert "total" in response.json()["detail"].lower()


def test_upload_non_admin_rejected(auth_client, admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    response = auth_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("test.png", io.BytesIO(b"a"), "image/png")},
    )
    assert response.status_code == 403


def test_upload_disabled_version_rejected(admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    admin_client.post(f"/api/versions/{version['id']}/disable")
    response = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("test.png", io.BytesIO(b"a"), "image/png")},
    )
    assert response.status_code == 403


def test_list_assets(admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("a.png", io.BytesIO(b"aaa"), "image/png")},
    )
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("b.pdf", io.BytesIO(b"bbb"), "application/pdf")},
    )
    response = admin_client.get(f"/api/versions/{version['id']}/assets")
    assert response.status_code == 200
    assets = response.json()
    assert len(assets) == 2
    filenames = {a["filename"] for a in assets}
    assert filenames == {"a.png", "b.pdf"}


def test_list_assets_non_admin_rejected(auth_client, admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    response = auth_client.get(f"/api/versions/{version['id']}/assets")
    assert response.status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_assets_api.py -v`
Expected: FAIL — import errors

- [ ] **Step 3: Create `mathion/api/assets.py` with upload + list endpoints**

```python
import os
import shutil

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, require_course_admin
from mathion.assets import get_mime_type, sanitize_filename, validate_extension
from mathion.config import settings
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Asset, AssetReference, CourseVersion
from mathion.models_auth import User
from mathion.schemas import AssetResponse

router = APIRouter(tags=["assets"])


def _asset_dir(version_id: int) -> str:
    return os.path.join(settings.asset_path, "courses", str(version_id))


@router.post("/api/versions/{version_id}/assets", status_code=201, response_model=AssetResponse)
def upload_asset(
    version_id: int,
    file: UploadFile,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = validate_extension(file.filename)
    if ext is None:
        raise HTTPException(status_code=400, detail=f"File extension not allowed: {file.filename}")

    content = file.file.read()
    if len(content) > settings.max_file_size:
        raise HTTPException(
            status_code=400,
            detail=f"File size {len(content)} exceeds max {settings.max_file_size}",
        )

    # Check total version size
    current_total = db.scalar(
        select(func.coalesce(func.sum(Asset.file_size), 0)).where(Asset.version_id == version_id)
    )
    if current_total + len(content) > settings.max_course_size:
        raise HTTPException(
            status_code=400,
            detail=f"Total version asset size would exceed limit ({settings.max_course_size} bytes)",
        )

    filename = sanitize_filename(file.filename)
    mime_type = get_mime_type(ext)

    asset = Asset(
        version_id=version_id,
        filename=filename,
        file_size=len(content),
        mime_type=mime_type,
        uploaded_by=user.id,
    )
    db.add(asset)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Asset '{filename}' already exists in this version")

    # Write file to disk
    dirpath = _asset_dir(version_id)
    os.makedirs(dirpath, exist_ok=True)
    filepath = os.path.join(dirpath, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    db.commit()
    db.refresh(asset)
    return asset


@router.get("/api/versions/{version_id}/assets", response_model=list[AssetResponse])
def list_assets(
    version_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)

    assets = db.execute(
        select(Asset).where(Asset.version_id == version_id).order_by(Asset.filename)
    ).scalars().all()

    # Annotate with reference status
    result = []
    for a in assets:
        ref_count = db.scalar(
            select(func.count()).where(AssetReference.asset_id == a.id)
        )
        resp = AssetResponse.model_validate(a)
        resp.is_referenced = ref_count > 0
        result.append(resp)
    return result
```

- [ ] **Step 4: Register the router in `mathion/main.py`**

Add after the quiz router import:

```python
from mathion.api.assets import router as assets_router
```

And add after `app.include_router(quiz_router)`:

```python
app.include_router(assets_router)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_assets_api.py -v`
Expected: All 10 tests pass

- [ ] **Step 6: Run full test suite**

Run: `.venv/bin/pytest -x -q`
Expected: All tests pass (no regressions)

- [ ] **Step 7: Commit**

```bash
git add mathion/api/assets.py mathion/main.py tests/test_assets_api.py
git commit -m "feat: add asset upload and list endpoints"
```

---

### Task 5: Asset serve endpoint with access control

**Files:**
- Modify: `mathion/api/assets.py`
- Modify: `tests/test_assets_api.py`

- [ ] **Step 1: Write failing tests for serve endpoint**

Append to `tests/test_assets_api.py`:

```python
from mathion.models_auth import StudentEnrollment, User


def test_serve_asset_as_admin(admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("test.png", io.BytesIO(b"png-content"), "image/png")},
    )
    response = admin_client.get(f"/assets/{version['id']}/test.png")
    assert response.status_code == 200
    assert response.content == b"png-content"
    assert response.headers["content-type"] == "image/png"


def test_serve_asset_as_enrolled_student(admin_client, db, asset_tmpdir):
    from mathion.auth import request_pin, verify_pin
    course, version = _create_published_version(admin_client)
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("doc.pdf", io.BytesIO(b"pdf-bytes"), "application/pdf")},
    )
    student = User(email="st@example.com", full_name="St")
    db.add(student)
    db.commit()
    enrollment = StudentEnrollment(user_id=student.id, version_id=version["id"], is_active=True)
    db.add(enrollment)
    db.commit()
    raw_pin = request_pin(db, student.email)
    token = verify_pin(db, student.email, raw_pin, duration_days=7)

    from tests.test_quiz_api import _make_student_client
    with _make_student_client(db, token) as sc:
        response = sc.get(f"/assets/{version['id']}/doc.pdf")
        assert response.status_code == 200
        assert response.content == b"pdf-bytes"


def test_serve_asset_unenrolled_rejected(auth_client, admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("test.png", io.BytesIO(b"data"), "image/png")},
    )
    response = auth_client.get(f"/assets/{version['id']}/test.png")
    assert response.status_code == 403


def test_serve_asset_disabled_version_blocked(admin_client, db, asset_tmpdir):
    from mathion.auth import request_pin, verify_pin
    course, version = _create_published_version(admin_client)
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("test.png", io.BytesIO(b"data"), "image/png")},
    )
    student = User(email="st2@example.com", full_name="St")
    db.add(student)
    db.commit()
    enrollment = StudentEnrollment(user_id=student.id, version_id=version["id"], is_active=True)
    db.add(enrollment)
    db.commit()
    raw_pin = request_pin(db, student.email)
    token = verify_pin(db, student.email, raw_pin, duration_days=7)

    admin_client.post(f"/api/versions/{version['id']}/disable")

    from tests.test_quiz_api import _make_student_client
    with _make_student_client(db, token) as sc:
        response = sc.get(f"/assets/{version['id']}/test.png")
        assert response.status_code == 403


def test_serve_asset_not_found(admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    response = admin_client.get(f"/assets/{version['id']}/nonexistent.png")
    assert response.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_assets_api.py::test_serve_asset_as_admin -v`
Expected: FAIL — 404 (endpoint does not exist)

- [ ] **Step 3: Add serve endpoint to `mathion/api/assets.py`**

Add to `mathion/api/assets.py`:

```python
from fastapi.responses import FileResponse
from mathion.models import CourseAdmin
from mathion.models_auth import StudentEnrollment


@router.get("/assets/{version_id}/{filename}")
def serve_asset(
    version_id: int,
    filename: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    version = get_or_404(db, CourseVersion, version_id)

    # Access check: superuser, course admin, or enrolled student
    if not user.is_superuser:
        is_admin = db.execute(
            select(CourseAdmin).where(
                CourseAdmin.course_id == version.course_id,
                CourseAdmin.user_id == user.id,
            )
        ).scalar_one_or_none()
        if not is_admin:
            # Students blocked from disabled versions
            if version.is_disabled:
                raise HTTPException(status_code=403, detail="Version is disabled")
            is_enrolled = db.execute(
                select(StudentEnrollment).where(
                    StudentEnrollment.version_id == version_id,
                    StudentEnrollment.user_id == user.id,
                    StudentEnrollment.is_active == True,
                )
            ).scalar_one_or_none()
            if not is_enrolled:
                raise HTTPException(status_code=403, detail="No access to this version")

    # Look up asset in registry
    asset = db.execute(
        select(Asset).where(
            Asset.version_id == version_id,
            Asset.filename == filename,
        )
    ).scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    filepath = os.path.join(_asset_dir(version_id), filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Asset file missing")

    return FileResponse(filepath, media_type=asset.mime_type, filename=filename)
```

- [ ] **Step 4: Run serve tests to verify they pass**

Run: `.venv/bin/pytest tests/test_assets_api.py -v`
Expected: All 15 tests pass

- [ ] **Step 5: Commit**

```bash
git add mathion/api/assets.py tests/test_assets_api.py
git commit -m "feat: add asset serve endpoint with access control"
```

---

### Task 6: Asset delete endpoint with reference warning

**Files:**
- Modify: `mathion/api/assets.py`
- Modify: `tests/test_assets_api.py`

- [ ] **Step 1: Write failing tests for delete endpoint**

Append to `tests/test_assets_api.py`:

```python
from mathion.models import Asset, AssetReference, Item, Sequence, Block


def test_delete_asset(admin_client, db, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    upload = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("del.png", io.BytesIO(b"data"), "image/png")},
    ).json()
    path = asset_tmpdir / "courses" / str(version["id"]) / "del.png"
    assert path.exists()

    response = admin_client.delete(f"/api/assets/{upload['id']}")
    assert response.status_code == 204
    assert not path.exists()

    # Asset gone from DB
    response = admin_client.get(f"/api/versions/{version['id']}/assets")
    assert len(response.json()) == 0


def test_delete_referenced_asset_warns(admin_client, db, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    upload = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("ref.png", io.BytesIO(b"data"), "image/png")},
    ).json()

    # Create a reference manually
    asset = db.get(Asset, upload["id"])
    items = db.execute(
        select(Item)
        .join(Sequence, Sequence.id == Item.sequence_id)
        .join(Block, Block.id == Sequence.block_id)
        .where(Block.version_id == version["id"])
    ).scalars().all()
    ref = AssetReference(asset_id=asset.id, item_id=items[0].id)
    db.add(ref)
    db.commit()

    # Delete should return 409 with warning
    response = admin_client.delete(f"/api/assets/{upload['id']}")
    assert response.status_code == 409
    assert "referenced" in response.json()["detail"].lower()


def test_delete_referenced_asset_force(admin_client, db, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    upload = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("ref2.png", io.BytesIO(b"data"), "image/png")},
    ).json()

    asset = db.get(Asset, upload["id"])
    items = db.execute(
        select(Item)
        .join(Sequence, Sequence.id == Item.sequence_id)
        .join(Block, Block.id == Sequence.block_id)
        .where(Block.version_id == version["id"])
    ).scalars().all()
    ref = AssetReference(asset_id=asset.id, item_id=items[0].id)
    db.add(ref)
    db.commit()

    # Force delete succeeds
    response = admin_client.delete(f"/api/assets/{upload['id']}?force=true")
    assert response.status_code == 204


def test_delete_asset_non_admin_rejected(auth_client, admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    upload = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("x.png", io.BytesIO(b"data"), "image/png")},
    ).json()
    response = auth_client.delete(f"/api/assets/{upload['id']}")
    assert response.status_code == 403


def test_delete_asset_disabled_version_rejected(admin_client, asset_tmpdir):
    course, version = _create_published_version(admin_client)
    upload = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("x.png", io.BytesIO(b"data"), "image/png")},
    ).json()
    admin_client.post(f"/api/versions/{version['id']}/disable")
    response = admin_client.delete(f"/api/assets/{upload['id']}")
    assert response.status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_assets_api.py::test_delete_asset -v`
Expected: FAIL — 405 (endpoint does not exist)

- [ ] **Step 3: Add delete endpoint to `mathion/api/assets.py`**

```python
@router.delete("/api/assets/{asset_id}", status_code=204)
def delete_asset(
    asset_id: int,
    force: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    asset = get_or_404(db, Asset, asset_id)
    version = get_or_404(db, CourseVersion, asset.version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")

    # Check references
    if not force:
        ref_count = db.scalar(
            select(func.count()).where(AssetReference.asset_id == asset_id)
        )
        if ref_count > 0:
            raise HTTPException(
                status_code=409,
                detail=f"Asset '{asset.filename}' is referenced by {ref_count} item(s). Use ?force=true to delete.",
            )

    # Remove file from disk
    filepath = os.path.join(_asset_dir(asset.version_id), asset.filename)
    if os.path.isfile(filepath):
        os.remove(filepath)

    db.delete(asset)
    db.commit()
```

- [ ] **Step 4: Run all asset tests**

Run: `.venv/bin/pytest tests/test_assets_api.py -v`
Expected: All 20 tests pass

- [ ] **Step 5: Commit**

```bash
git add mathion/api/assets.py tests/test_assets_api.py
git commit -m "feat: add asset delete endpoint with reference warning"
```

---

### Task 7: Markdown asset reference extraction + resolution

**Files:**
- Modify: `mathion/markdown.py`
- Create: `tests/test_asset_markdown.py`

- [ ] **Step 1: Write failing tests for extract + resolve**

Create `tests/test_asset_markdown.py`:

```python
from mathion.markdown import extract_asset_filenames, resolve_asset_urls, render_markdown


def test_extract_image_references():
    md = "Some text ![diagram](chart.png) and more"
    assert extract_asset_filenames(md) == {"chart.png"}


def test_extract_link_references():
    md = "Download [slides](slides.pdf) here"
    assert extract_asset_filenames(md) == {"slides.pdf"}


def test_extract_ignores_urls():
    md = "![img](https://example.com/pic.png) and [link](http://example.com)"
    assert extract_asset_filenames(md) == set()


def test_extract_ignores_mailto():
    md = "[email](mailto:test@example.com)"
    assert extract_asset_filenames(md) == set()


def test_extract_ignores_anchors():
    md = "[section](#heading)"
    assert extract_asset_filenames(md) == set()


def test_extract_multiple_refs():
    md = "![a](one.png) text ![b](two.jpg) and [c](three.pdf)"
    assert extract_asset_filenames(md) == {"one.png", "two.jpg", "three.pdf"}


def test_extract_no_refs():
    md = "Just plain text with no references"
    assert extract_asset_filenames(md) == set()


def test_resolve_image_urls():
    html = '<p><img src="chart.png" alt="diagram"></p>'
    result = resolve_asset_urls(html, 42, {"chart.png"})
    assert 'src="/assets/42/chart.png"' in result


def test_resolve_link_urls():
    html = '<p><a href="slides.pdf">download</a></p>'
    result = resolve_asset_urls(html, 42, {"slides.pdf"})
    assert 'href="/assets/42/slides.pdf"' in result


def test_resolve_leaves_external_urls():
    html = '<p><a href="https://example.com">link</a></p>'
    result = resolve_asset_urls(html, 42, set())
    assert 'href="https://example.com"' in result


def test_resolve_only_known_filenames():
    html = '<p><img src="unknown.png" alt="x"></p>'
    result = resolve_asset_urls(html, 42, {"known.png"})
    assert 'src="unknown.png"' in result  # not resolved


def test_full_render_with_asset_resolution():
    """End-to-end: markdown → HTML → resolve."""
    md = "See ![chart](data.png) for details"
    html = render_markdown(md)
    resolved = resolve_asset_urls(html, 99, {"data.png"})
    assert 'src="/assets/99/data.png"' in resolved
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_asset_markdown.py -v`
Expected: FAIL — `ImportError: cannot import name 'extract_asset_filenames'`

- [ ] **Step 3: Add functions to `mathion/markdown.py`**

Add to the end of `mathion/markdown.py`:

```python
import re

_IMG_REF = re.compile(r'!\[[^\]]*\]\(([^)\s]+)\)')
_LINK_REF = re.compile(r'(?<!!)\[[^\]]*\]\(([^)\s]+)\)')
_SKIP_PREFIXES = ("http://", "https://", "mailto:", "#")


def extract_asset_filenames(text: str) -> set[str]:
    """Extract non-URL filenames from markdown image and link references."""
    if not text:
        return set()
    filenames = set()
    for pattern in (_IMG_REF, _LINK_REF):
        for m in pattern.finditer(text):
            ref = m.group(1)
            if not ref.startswith(_SKIP_PREFIXES):
                filenames.add(ref)
    return filenames


def resolve_asset_urls(html: str, version_id: int, asset_filenames: set[str]) -> str:
    """Replace bare asset filenames with full paths in rendered HTML.

    Only replaces filenames that are in the known asset_filenames set.
    Must be called AFTER render_markdown() and nh3 sanitization.
    """
    for filename in asset_filenames:
        html = html.replace(f'src="{filename}"', f'src="/assets/{version_id}/{filename}"')
        html = html.replace(f'href="{filename}"', f'href="/assets/{version_id}/{filename}"')
    return html
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_asset_markdown.py -v`
Expected: All 13 tests pass

- [ ] **Step 5: Commit**

```bash
git add mathion/markdown.py tests/test_asset_markdown.py
git commit -m "feat: add markdown asset reference extraction and resolution"
```

---

### Task 8: Item save integration — validate, resolve, track references

**Files:**
- Modify: `mathion/api/items.py`
- Modify: `tests/test_assets_api.py`

- [ ] **Step 1: Write failing tests for item save with asset references**

Append to `tests/test_assets_api.py`:

```python
def test_item_save_resolves_asset_refs(admin_client, db, asset_tmpdir):
    """Creating a static_page item with asset references resolves them in HTML."""
    course = admin_client.post("/api/courses", json={"slug": "md-course", "name": "M", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    # Upload asset first
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("chart.png", io.BytesIO(b"png"), "image/png")},
    )
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Page", "slug": "page", "type": "static_page",
        "content_md": "See ![chart](chart.png) for details",
    }).json()
    assert f'/assets/{version["id"]}/chart.png' in item["content_html"]


def test_item_save_rejects_missing_asset(admin_client, asset_tmpdir):
    """Creating an item referencing a non-existent asset fails."""
    course = admin_client.post("/api/courses", json={"slug": "md2", "name": "M", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    response = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Page", "slug": "page", "type": "static_page",
        "content_md": "See ![chart](nonexistent.png) here",
    })
    assert response.status_code == 422
    assert "nonexistent.png" in response.json()["detail"]


def test_item_update_tracks_references(admin_client, db, asset_tmpdir):
    """Updating item markdown updates asset references."""
    course = admin_client.post("/api/courses", json={"slug": "md3", "name": "M", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("a.png", io.BytesIO(b"a"), "image/png")},
    )
    admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("b.png", io.BytesIO(b"b"), "image/png")},
    )
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "P", "slug": "p", "type": "static_page",
        "content_md": "![img](a.png)",
    }).json()

    # Check a.png is referenced
    assets = admin_client.get(f"/api/versions/{version['id']}/assets").json()
    a_asset = [x for x in assets if x["filename"] == "a.png"][0]
    b_asset = [x for x in assets if x["filename"] == "b.png"][0]
    assert a_asset["is_referenced"] is True
    assert b_asset["is_referenced"] is False

    # Update to reference b.png instead
    admin_client.patch(f"/api/items/{item['id']}", json={"content_md": "![img](b.png)"})
    assets = admin_client.get(f"/api/versions/{version['id']}/assets").json()
    a_asset = [x for x in assets if x["filename"] == "a.png"][0]
    b_asset = [x for x in assets if x["filename"] == "b.png"][0]
    assert a_asset["is_referenced"] is False
    assert b_asset["is_referenced"] is True


def test_item_no_asset_refs_works(admin_client, asset_tmpdir):
    """Items without asset references work normally."""
    course = admin_client.post("/api/courses", json={"slug": "md4", "name": "M", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "P", "slug": "p", "type": "static_page",
        "content_md": "Just text with [external](https://example.com)",
    }).json()
    assert item["content_html"]  # rendered normally
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_assets_api.py::test_item_save_resolves_asset_refs -v`
Expected: FAIL — asset refs not resolved in HTML

- [ ] **Step 3: Update `mathion/api/items.py` to validate+resolve+track asset references**

Add imports at top of `mathion/api/items.py`:

```python
from sqlalchemy import func, select
```

changes to (already has `func` and `select`):

```python
from sqlalchemy import delete as sa_delete, func, select
```

And add new import:

```python
from mathion.markdown import extract_asset_filenames, resolve_asset_urls
from mathion.models import Asset, AssetReference, Block, CourseVersion, Item, Sequence
```

Replace the existing `from mathion.models import Block, CourseVersion, Item, Sequence` line.

Add a helper function after the existing helpers:

```python
def _process_content_md(db: Session, version: CourseVersion, item_id: int, content_md: str | None) -> str | None:
    """Render markdown, validate asset refs, resolve URLs, track references."""
    if content_md is None:
        # Clear references for this item
        db.execute(sa_delete(AssetReference).where(AssetReference.item_id == item_id))
        return None

    html = render_markdown(content_md)

    # Extract asset filenames from markdown source
    ref_filenames = extract_asset_filenames(content_md)
    if not ref_filenames:
        # No asset refs — clear any existing references and return rendered HTML
        db.execute(sa_delete(AssetReference).where(AssetReference.item_id == item_id))
        return html

    # Validate all referenced assets exist in this version
    existing = db.execute(
        select(Asset).where(
            Asset.version_id == version.id,
            Asset.filename.in_(ref_filenames),
        )
    ).scalars().all()
    existing_map = {a.filename: a for a in existing}
    missing = ref_filenames - set(existing_map.keys())
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Referenced assets not found in version: {', '.join(sorted(missing))}",
        )

    # Resolve asset URLs in HTML
    html = resolve_asset_urls(html, version.id, ref_filenames)

    # Update references
    db.execute(sa_delete(AssetReference).where(AssetReference.item_id == item_id))
    for asset in existing_map.values():
        db.add(AssetReference(asset_id=asset.id, item_id=item_id))

    return html
```

Update `create_item` — replace the item construction:

```python
    item = Item(
        sequence_id=sequence_id, title=data.title, slug=data.slug, order=next_order,
        type=data.type, content_md=data.content_md, content_html=render_markdown(data.content_md),
        video_url=data.video_url, script_url=data.script_url,
    )
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An item with this slug already exists in this sequence")
```

With:

```python
    item = Item(
        sequence_id=sequence_id, title=data.title, slug=data.slug, order=next_order,
        type=data.type, content_md=data.content_md, content_html="",
        video_url=data.video_url, script_url=data.script_url,
    )
    db.add(item)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An item with this slug already exists in this sequence")

    item.content_html = _process_content_md(db, version, item.id, data.content_md)
    db.commit()
```

Update `update_item` — replace:

```python
    if "content_md" in updates:
        item.content_html = render_markdown(item.content_md)
```

With:

```python
    if "content_md" in updates:
        item.content_html = _process_content_md(db, version, item.id, item.content_md)
```

- [ ] **Step 4: Run asset integration tests**

Run: `.venv/bin/pytest tests/test_assets_api.py -v`
Expected: All 24 tests pass

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `.venv/bin/pytest -x -q`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add mathion/api/items.py tests/test_assets_api.py
git commit -m "feat: integrate asset reference validation and tracking into item save"
```

---

### Task 9: Version copy with assets

**Files:**
- Modify: `mathion/api/versions.py`
- Modify: `tests/test_assets_api.py`

- [ ] **Step 1: Write failing tests for version copy**

Append to `tests/test_assets_api.py`:

```python
def test_version_copy_assets(admin_client, db, asset_tmpdir):
    """Creating a version with copy_assets_from copies files and registry."""
    course = admin_client.post("/api/courses", json={"slug": "copy-course", "name": "C", "description": ""}).json()
    v1 = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()

    # Upload assets to v1
    admin_client.post(
        f"/api/versions/{v1['id']}/assets",
        files={"file": ("a.png", io.BytesIO(b"aaa"), "image/png")},
    )
    admin_client.post(
        f"/api/versions/{v1['id']}/assets",
        files={"file": ("b.pdf", io.BytesIO(b"bbb"), "application/pdf")},
    )

    # Create v2 copying from v1
    v2 = admin_client.post(
        f"/api/courses/{course['id']}/versions",
        json={"info_md": "", "copy_assets_from": v1["id"]},
    ).json()

    # v2 should have the same assets
    assets = admin_client.get(f"/api/versions/{v2['id']}/assets").json()
    assert len(assets) == 2
    filenames = {a["filename"] for a in assets}
    assert filenames == {"a.png", "b.pdf"}

    # Files exist on disk
    v2_dir = asset_tmpdir / "courses" / str(v2["id"])
    assert (v2_dir / "a.png").read_bytes() == b"aaa"
    assert (v2_dir / "b.pdf").read_bytes() == b"bbb"


def test_version_copy_assets_wrong_course_rejected(admin_client, asset_tmpdir):
    """Cannot copy assets from a version belonging to a different course."""
    c1 = admin_client.post("/api/courses", json={"slug": "c1", "name": "C1", "description": ""}).json()
    c2 = admin_client.post("/api/courses", json={"slug": "c2", "name": "C2", "description": ""}).json()
    v1 = admin_client.post(f"/api/courses/{c1['id']}/versions", json={"info_md": ""}).json()

    response = admin_client.post(
        f"/api/courses/{c2['id']}/versions",
        json={"info_md": "", "copy_assets_from": v1["id"]},
    )
    assert response.status_code == 400


def test_version_copy_assets_size_check(admin_client, asset_tmpdir):
    """Version copy fails if total size would exceed limit."""
    original = settings.max_course_size
    settings.max_course_size = 10  # tiny limit

    course = admin_client.post("/api/courses", json={"slug": "sc", "name": "S", "description": ""}).json()
    v1 = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(
        f"/api/versions/{v1['id']}/assets",
        files={"file": ("big.png", io.BytesIO(b"x" * 20), "image/png")},
    )

    response = admin_client.post(
        f"/api/courses/{course['id']}/versions",
        json={"info_md": "", "copy_assets_from": v1["id"]},
    )
    settings.max_course_size = original
    assert response.status_code == 400
    assert "size" in response.json()["detail"].lower()


def test_version_copy_no_assets_is_noop(admin_client, asset_tmpdir):
    """Copying from a version with no assets works fine."""
    course = admin_client.post("/api/courses", json={"slug": "empty", "name": "E", "description": ""}).json()
    v1 = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    v2 = admin_client.post(
        f"/api/courses/{course['id']}/versions",
        json={"info_md": "", "copy_assets_from": v1["id"]},
    ).json()
    assets = admin_client.get(f"/api/versions/{v2['id']}/assets").json()
    assert len(assets) == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_assets_api.py::test_version_copy_assets -v`
Expected: FAIL — `copy_assets_from` not handled

- [ ] **Step 3: Update `mathion/api/versions.py` to handle asset copy**

Add imports:

```python
import os
import shutil

from sqlalchemy import func, select

from mathion.config import settings
from mathion.models import Asset, Block, Course, CourseVersion, Item, Question, Sequence, AnswerOption
```

Replace the existing `from mathion.models import ...` line (keep all existing model imports, add `Asset`).

Update `create_version`:

```python
@router.post("/api/courses/{course_id}/versions", status_code=201, response_model=VersionResponse)
def create_version(course_id: int, data: VersionCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_or_404(db, Course, course_id)
    require_course_admin(db, user, course_id)

    # Validate copy_assets_from if provided
    if data.copy_assets_from is not None:
        source_version = get_or_404(db, CourseVersion, data.copy_assets_from)
        if source_version.course_id != course_id:
            raise HTTPException(status_code=400, detail="Source version belongs to a different course")

        # Check total size
        total_size = db.scalar(
            select(func.coalesce(func.sum(Asset.file_size), 0)).where(
                Asset.version_id == data.copy_assets_from
            )
        )
        if total_size > settings.max_course_size:
            raise HTTPException(
                status_code=400,
                detail=f"Source assets total size ({total_size}) exceeds limit ({settings.max_course_size})",
            )

    version = CourseVersion(
        course_id=course_id,
        info_md=data.info_md,
        info_html="",
        max_quiz_attempts=data.max_quiz_attempts,
    )
    db.add(version)
    db.flush()

    # Copy assets if requested
    if data.copy_assets_from is not None:
        source_assets = db.execute(
            select(Asset).where(Asset.version_id == data.copy_assets_from)
        ).scalars().all()

        if source_assets:
            source_dir = os.path.join(settings.asset_path, "courses", str(data.copy_assets_from))
            dest_dir = os.path.join(settings.asset_path, "courses", str(version.id))
            os.makedirs(dest_dir, exist_ok=True)

            for src_asset in source_assets:
                # Copy registry entry
                new_asset = Asset(
                    version_id=version.id,
                    filename=src_asset.filename,
                    file_size=src_asset.file_size,
                    mime_type=src_asset.mime_type,
                    uploaded_by=user.id,
                )
                db.add(new_asset)

                # Copy file
                src_path = os.path.join(source_dir, src_asset.filename)
                dst_path = os.path.join(dest_dir, src_asset.filename)
                if os.path.isfile(src_path):
                    shutil.copy2(src_path, dst_path)

    db.commit()
    db.refresh(version)
    return version
```

- [ ] **Step 4: Run version copy tests**

Run: `.venv/bin/pytest tests/test_assets_api.py -v`
Expected: All 28 tests pass

- [ ] **Step 5: Run full test suite**

Run: `.venv/bin/pytest -x -q`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add mathion/api/versions.py tests/test_assets_api.py
git commit -m "feat: add asset copy on version creation"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Asset registry DB table (Task 1)
- [x] Upload with file size, type, duplicate validation (Task 4)
- [x] Filename sanitization (Task 3)
- [x] SVG blocked (Task 3 tests)
- [x] Max file size + max version size checks (Task 4)
- [x] Serve with access control (Task 5)
- [x] Disabled version blocks student access (Task 5)
- [x] Delete with reference warning (Task 6)
- [x] Usage tracking via AssetReference (Task 8)
- [x] `is_referenced` flag on list (Task 4, annotated in list)
- [x] Markdown reference extraction (Task 7)
- [x] Asset URL resolution in rendered HTML (Task 7)
- [x] Validate references exist on save (Task 8)
- [x] Version copy — files + registry (Task 9)
- [x] Size check before copy (Task 9)

**Not in scope (deferred per spec):**
- User photo upload (`/assets/users/{user_id}.jpg`) — not mentioned in Phase 6
- Asset insertion toolbar UI — frontend (Phase 6 is backend only)
- Configurable extension whitelist — hardcoded for V1, trivially extensible

**Placeholder scan:** No TBD/TODO found.

**Type consistency:** `Asset`, `AssetReference`, `AssetResponse` used consistently. `sanitize_filename`, `validate_extension`, `get_mime_type` match across all tasks. `extract_asset_filenames`, `resolve_asset_urls` match between Task 7 (definition) and Task 8 (usage).
