# Duplicate Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a CourseAdmin duplicate an existing course version into a fresh editable draft (deep-copying the content tree + assets + meta), and give every version an optional human `label`.

**Architecture:** A new `POST /api/versions/{id}/duplicate` endpoint orchestrates: quota check → asset preflight (409) → insert a fresh `created` version + flush (capture its id as a plain int) → `try{ copy assets, render info, clone the Block→Sequence→Item→Question→AnswerOption tree, commit }` with `except{ rollback + rmtree the new version's dir }`. The clone logic lives in a new module `mathion/api/version_clone.py` (three functions) that reuses the existing `render_with_assets` / `sync_asset_references` / `sync_script_reference` helpers, so every rendered URL and `AssetReference` resolves against the new version's copied assets. A small `label` column is wired through every read/write surface, and the version list gets a per-row Duplicate button.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy 2.x / Alembic / pytest (backend); Svelte 5 runes / TypeScript / Vitest (frontend). SQLite in dev/test, Postgres-compatible.

## Global Constraints

- **Backend commands:** always via the venv — `backend/.venv/bin/pytest`, `backend/.venv/bin/alembic`. Never bare `pytest`/`alembic`/`python`. No new backend dependencies.
- **Frontend:** Svelte 5 runes only; no new JS/CSS dependencies. Component tests use `mount`/`unmount`/`flushSync`/`tick` imported from `svelte` — never `@testing-library`.
- **`label` is escaped text only:** render as `{label}` in Svelte, never `@html`; never pass it through `render_markdown`/`render_with_assets` on the backend.
- **Disabled source → 403:** duplicating a disabled version is rejected (settled decision).
- **Git hygiene:** never `git add -A`; stage explicit paths only. NEVER stage these three untracked files: `docs/superpowers/plans/2026-06-04-evaluations-write-surface.md`, `docs/superpowers/specs/2026-06-04-evaluations-write-surface-design.md`, `run-dashboards-smoke.sh`. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Work on branch `feat/duplicate-version` (already checked out).

## Spec

Full design: `docs/superpowers/specs/2026-07-07-duplicate-version-design.md` (converged rev 4). This plan implements it verbatim.

---

## File Structure

**Backend**
- `backend/mathion/models.py` — MODIFY: add `label` column to `CourseVersion`.
- `backend/alembic/versions/<generated>_add_course_version_label.py` — CREATE: migration adding the column.
- `backend/mathion/schemas.py` — MODIFY: `label` on `VersionResponse`/`VersionCreate`/`VersionUpdate`; new `VersionDuplicateRequest`; shared strip validator.
- `backend/mathion/api/content.py` — MODIFY: add `"label"` to the admin-tree version dict.
- `backend/mathion/api/version_clone.py` — CREATE: `copy_version_assets`, `collect_referenced_filenames`, `clone_version_content`.
- `backend/mathion/api/versions.py` — MODIFY: refactor `create_version` to call `copy_version_assets`; wire `label` into create/update; add the `duplicate_version` endpoint.

**Frontend**
- `frontend/src/lib/types.ts` — MODIFY: add required `label: string` to `Version`.
- 6 test fixtures — MODIFY: add `label: ''` to their `Version`/`AdminTreeVersion` literals.
- `frontend/src/pages/editor/VersionsPage.svelte` — MODIFY: per-row Duplicate button + inline state + label display.
- `frontend/src/pages/editor/VersionEditPage.svelte` — MODIFY: render `{v.label}` in the header.
- `frontend/src/components/editor/VersionMetaForm.svelte` — MODIFY: label edit field.

**Task dependency order:** 1 → 2 → 3 → 4 → 5 (backend), then 6 → 7, 8 (frontend). Task 4 reuses Task 2's helper in its test; Task 5 reuses Tasks 2–4. Tasks 7 and 8 both depend on Task 6's type change.

---

## Task 1: Version label — column, migration, schema wiring, serializer

**Files:**
- Modify: `backend/mathion/models.py:45` (CourseVersion)
- Create: `backend/alembic/versions/<generated>_add_course_version_label.py`
- Modify: `backend/mathion/schemas.py:31-62` (Version schemas + validator)
- Modify: `backend/mathion/api/versions.py:40-45` (create_version constructor), `:104-112` (update_version)
- Modify: `backend/mathion/api/content.py:132-144` (admin-tree version dict)
- Test: `backend/tests/test_versions.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CourseVersion.label` (str, non-null, default `""`); `VersionResponse.label: str`; `VersionCreate.label: str = ""`; `VersionUpdate.label: str | None = None`; `VersionDuplicateRequest(label: str = "")` — a Pydantic model consumed by Task 5. Existing `VersionResponse` (`response_model` of every version endpoint) now includes `label`.

- [ ] **Step 1: Write failing tests for label persistence + validation**

Add to `backend/tests/test_versions.py` (append at end of file):

```python
def test_create_version_with_label(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "lbl", "name": "L", "description": ""}).json()
    r = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": "", "label": "  Spring 26  "})
    assert r.status_code == 201
    assert r.json()["label"] == "Spring 26"  # stripped


def test_create_version_label_defaults_empty(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "lbl2", "name": "L", "description": ""}).json()
    r = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""})
    assert r.status_code == 201
    assert r.json()["label"] == ""


def test_patch_version_label(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "lbl3", "name": "L", "description": ""}).json()
    v = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    r = admin_client.patch(f"/api/versions/{v['id']}", json={"label": "Draft A"})
    assert r.status_code == 200
    assert r.json()["label"] == "Draft A"


def test_patch_version_label_too_long_422(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "lbl4", "name": "L", "description": ""}).json()
    v = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    r = admin_client.patch(f"/api/versions/{v['id']}", json={"label": "x" * 201})
    assert r.status_code == 422


def test_patch_version_label_null_is_noop(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "lbl5", "name": "L", "description": ""}).json()
    v = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": "", "label": "keep"}).json()
    r = admin_client.patch(f"/api/versions/{v['id']}", json={"label": None})
    assert r.status_code == 200
    assert r.json()["label"] == "keep"


def test_admin_tree_includes_label(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "lbl6", "name": "L", "description": ""}).json()
    v = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": "", "label": "Tree"}).json()
    tree = admin_client.get(f"/api/versions/{v['id']}/admin-tree").json()
    assert tree["version"]["label"] == "Tree"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_versions.py -k "label" -v`
Expected: FAIL — `test_create_version_with_label` etc. fail because `label` is unknown (extra key ignored → response has no `label` key → KeyError / assertion error).

- [ ] **Step 3: Add the `label` column to the model**

In `backend/mathion/models.py`, inside `CourseVersion`, add the column right after `info_html` (line 45):

```python
    info_html: Mapped[str] = mapped_column(Text, nullable=False, default="")
    label: Mapped[str] = mapped_column(String(200), nullable=False, default="")
```

(`String` is already imported at `models.py:4`.)

- [ ] **Step 4: Wire `label` into the schemas + add the shared strip validator**

In `backend/mathion/schemas.py`:

Add a module-level helper (place it just above `class VersionCreate`, near line 30):

```python
def _strip_label_value(v: str | None) -> str | None:
    """Strip a label before length validation; pass None through so an explicit
    null (VersionUpdate clear/no-op) doesn't AttributeError -> 500."""
    return v.strip() if isinstance(v, str) else v
```

Replace `VersionCreate`, `VersionUpdate`, and `VersionResponse` (lines 31-62) and add `VersionDuplicateRequest`:

```python
class VersionCreate(BaseModel):
    info_md: str = ""
    max_quiz_attempts: int = Field(default=3, ge=1, le=10)
    copy_assets_from: int | None = None
    label: str = Field(default="", max_length=200)

    @field_validator("label", mode="before")
    @classmethod
    def _strip_label(cls, v: str | None) -> str | None:
        return _strip_label_value(v)


class VersionUpdate(BaseModel):
    info_md: str | None = None
    max_quiz_attempts: int | None = Field(default=None, ge=1, le=10)
    label: str | None = Field(default=None, max_length=200)

    @field_validator("label", mode="before")
    @classmethod
    def _strip_label(cls, v: str | None) -> str | None:
        return _strip_label_value(v)


class VersionDuplicateRequest(BaseModel):
    label: str = Field(default="", max_length=200)

    @field_validator("label", mode="before")
    @classmethod
    def _strip_label(cls, v: str | None) -> str | None:
        return _strip_label_value(v)


class VersionRenderRequest(BaseModel):
    content_md: str


class VersionRenderResponse(BaseModel):
    html: str


class VersionResponse(BaseModel):
    id: int
    course_id: int
    state: str
    is_disabled: bool
    info_md: str
    info_html: str
    max_quiz_attempts: int
    label: str
    created_at: datetime
    published_at: datetime | None
    archived_at: datetime | None

    model_config = {"from_attributes": True}
```

(`field_validator` and `Field` are already imported at `schemas.py:7`. Note `mode="before"` runs the strip BEFORE the `max_length` check, so a value with trailing spaces trims then validates.)

- [ ] **Step 5: Wire `label` into create_version and update_version**

In `backend/mathion/api/versions.py`, in `create_version`, add `label` to the constructor (lines 40-45):

```python
    version = CourseVersion(
        course_id=course_id,
        info_md=data.info_md,
        info_html="",
        max_quiz_attempts=data.max_quiz_attempts,
        label=data.label,
    )
```

In `update_version`, add a branch after the `max_quiz_attempts` branch (after line 112):

```python
    if "max_quiz_attempts" in updates:
        version.max_quiz_attempts = updates["max_quiz_attempts"]
    if "label" in updates:
        version.label = updates["label"]
```

(The existing `{k: v … if v is not None}` filter at line 104 already lets `label=""` through while no-op'ing `null`/omitted.)

- [ ] **Step 6: Add `label` to the admin-tree serializer**

In `backend/mathion/api/content.py`, in the `get_admin_tree` version dict (line 132-144), add the `label` key (after `info_html`):

```python
            "info_html": version.info_html,
            "label": version.label,
            "max_quiz_attempts": version.max_quiz_attempts,
```

(Do NOT add it to the student `get_content_json` dict at lines 71-76 — students don't see labels.)

- [ ] **Step 7: Run the label tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_versions.py -k "label" -v`
Expected: PASS (all six).

- [ ] **Step 8: Run the full version + content + assets suites to confirm no regressions**

Run: `cd backend && .venv/bin/pytest tests/test_versions.py tests/test_content.py tests/test_assets_api.py -q`
Expected: PASS. (`VersionResponse` now requires `label`; every ORM producer supplies it from the column, so nothing breaks.)

- [ ] **Step 9: Create the Alembic migration**

Run: `cd backend && .venv/bin/alembic revision -m "add course version label"`
This scaffolds a file under `backend/alembic/versions/` with `down_revision` auto-set to the current head (`378c62a02d4e`). Open the generated file and set the body:

```python
def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('course_versions') as batch_op:
        batch_op.add_column(
            sa.Column('label', sa.String(length=200), nullable=False, server_default=''))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('course_versions') as batch_op:
        batch_op.drop_column('label')
```

(`op` and `sa` are already imported in the scaffold. `batch_alter_table` is required for SQLite ALTER; `server_default=''` backfills existing rows.)

- [ ] **Step 10: Apply and verify the migration**

Run: `cd backend && .venv/bin/alembic upgrade head && .venv/bin/alembic downgrade -1 && .venv/bin/alembic upgrade head`
Expected: all three succeed with no error (round-trips cleanly).

- [ ] **Step 11: Commit**

```bash
git add backend/mathion/models.py backend/mathion/schemas.py backend/mathion/api/versions.py backend/mathion/api/content.py backend/alembic/versions/*_add_course_version_label.py backend/tests/test_versions.py
git commit -m "feat(versions): add optional label column wired through read/write surfaces

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Extract `copy_version_assets` (refactor create_version)

**Files:**
- Create: `backend/mathion/api/version_clone.py`
- Modify: `backend/mathion/api/versions.py:49-79` (create_version asset-copy block)
- Test: `backend/tests/test_version_clone.py` (new)

**Interfaces:**
- Consumes: `settings.asset_path`, `Asset` model.
- Produces: `copy_version_assets(db: Session, src_version_id: int, dst_version_id: int, uploaded_by: int | None) -> None` — copies every `Asset` row + on-disk file from src to dst. Preflights that all source files exist (raises `HTTPException(500)` if any missing) BEFORE writing anything. Does NOT roll back — the caller owns rollback. Flushes at the end. Consumed by Tasks 4 and 5.

- [ ] **Step 1: Write the failing unit test for `copy_version_assets`**

Create `backend/tests/test_version_clone.py`:

```python
import io
import os

import pytest
from fastapi import HTTPException

from mathion.api.version_clone import copy_version_assets
from mathion.config import settings
from mathion.models import Asset, CourseVersion


def _mk_course_version(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "vc", "name": "VC", "description": ""}).json()
    v = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    return course, v


def _upload(admin_client, version_id, name, content):
    r = admin_client.post(
        f"/api/versions/{version_id}/assets",
        files={"file": (name, io.BytesIO(content), "image/png")},
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_copy_version_assets_copies_rows_and_files(admin_client, db):
    course, src = _mk_course_version(admin_client)
    _upload(admin_client, src["id"], "a.png", b"AAA")
    _upload(admin_client, src["id"], "b.png", b"BBBBB")

    dst = CourseVersion(course_id=course["id"], info_md="", info_html="", max_quiz_attempts=3)
    db.add(dst)
    db.flush()

    copy_version_assets(db, src["id"], dst.id, None)
    db.commit()

    rows = db.query(Asset).filter(Asset.version_id == dst.id).all()
    assert {r.filename for r in rows} == {"a.png", "b.png"}
    dst_dir = os.path.join(settings.asset_path, "courses", str(dst.id))
    with open(os.path.join(dst_dir, "a.png"), "rb") as fh:
        assert fh.read() == b"AAA"  # byte-identical copy


def test_copy_version_assets_missing_file_raises_500(admin_client, db):
    course, src = _mk_course_version(admin_client)
    a = _upload(admin_client, src["id"], "gone.png", b"X")
    # Delete the file on disk but keep the DB row -> preflight must catch it.
    os.remove(os.path.join(settings.asset_path, "courses", str(src["id"]), "gone.png"))

    dst = CourseVersion(course_id=course["id"], info_md="", info_html="", max_quiz_attempts=3)
    db.add(dst)
    db.flush()

    with pytest.raises(HTTPException) as exc:
        copy_version_assets(db, src["id"], dst.id, None)
    assert exc.value.status_code == 500
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_version_clone.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'mathion.api.version_clone'`.

- [ ] **Step 3: Create `version_clone.py` with `copy_version_assets`**

Create `backend/mathion/api/version_clone.py`:

```python
import os
import shutil

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.config import settings
from mathion.models import Asset


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
```

- [ ] **Step 4: Refactor `create_version` to call the helper**

In `backend/mathion/api/versions.py`, add the import near the top (after line 9's helpers import):

```python
from mathion.api.version_clone import copy_version_assets
```

Replace the asset-copy block (lines 49-79 — the `if data.copy_assets_from is not None:` block that does the source_assets query, preflight, makedirs, copy loop, flush) with:

```python
    if data.copy_assets_from is not None:
        try:
            copy_version_assets(db, data.copy_assets_from, version.id, user.id)
        except HTTPException:
            db.rollback()
            raise
```

(This preserves the exact prior behavior: the helper raises 500 on a missing source file, and `create_version` rolls back before re-raising — same as the old inline `db.rollback(); raise`. The quota check at lines 25-38 stays unchanged, above the insert.)

- [ ] **Step 5: Run the new unit test + the create_version regression suite**

Run: `cd backend && .venv/bin/pytest tests/test_version_clone.py tests/test_assets_api.py -v`
Expected: PASS — the two new unit tests pass, and every existing `copy_assets_from` test in `test_assets_api.py` (the regression guard for this refactor, including the missing-file 500 path) still passes.

- [ ] **Step 6: Commit**

```bash
git add backend/mathion/api/version_clone.py backend/mathion/api/versions.py backend/tests/test_version_clone.py
git commit -m "refactor(versions): extract copy_version_assets into version_clone module

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `collect_referenced_filenames`

**Files:**
- Modify: `backend/mathion/api/version_clone.py`
- Test: `backend/tests/test_version_clone.py`

**Interfaces:**
- Consumes: `mathion.markdown.extract_asset_filenames(text: str) -> set[str]`; `Block`/`Sequence`/`Item`/`Question` models.
- Produces: `collect_referenced_filenames(db: Session, source: CourseVersion) -> set[str]` — the union of every asset filename referenced by the version's `info_md`, each item's `content_md`, each question's `text_md`/`explanation_md`, and each `interactive_app` item's `script_url` (when non-None). Consumed by Task 5's preflight.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_version_clone.py`:

```python
from mathion.api.version_clone import collect_referenced_filenames
from mathion.models import Block, Item, Question, Sequence


def test_collect_referenced_filenames_aggregates_all_owners(admin_client, db):
    course = admin_client.post("/api/courses", json={"slug": "crf", "name": "C", "description": ""}).json()
    v = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    version = db.get(CourseVersion, v["id"])
    # Set info_md via ORM, NOT the create API: create_version renders info_md
    # eagerly (versions.py:82) and 422s on an asset that isn't uploaded.
    # collect_referenced_filenames reads the raw text, so no upload is needed here.
    version.info_md = "Info ![i](info.png)"

    block = Block(version_id=version.id, title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()

    # static_page item referencing a page asset
    page = Item(sequence_id=seq.id, title="P", slug="p", order=1, type="static_page",
                content_md="See ![d](diagram.png)", content_html="")
    # interactive_app with a script filename
    app = Item(sequence_id=seq.id, title="A", slug="a", order=2, type="interactive_app",
               content_md=None, content_html="", script_url="app.js")
    # interactive_app with NO script yet -> must be skipped, not crash
    app2 = Item(sequence_id=seq.id, title="A2", slug="a2", order=3, type="interactive_app",
                content_md=None, content_html="", script_url=None)
    db.add_all([page, app, app2]); db.flush()

    q = Question(item_id=page.id, text_md="Q ![t](tq.png)", text_html="",
                 type="text_answer", order=1, explanation_md="Ex ![e](exp.png)",
                 explanation_html="", correct_text="a")
    db.add(q); db.commit()

    names = collect_referenced_filenames(db, version)
    assert names == {"info.png", "diagram.png", "app.js", "tq.png", "exp.png"}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_version_clone.py::test_collect_referenced_filenames_aggregates_all_owners -v`
Expected: FAIL with `ImportError: cannot import name 'collect_referenced_filenames'`.

- [ ] **Step 3: Implement `collect_referenced_filenames`**

Append to `backend/mathion/api/version_clone.py`:

```python
def collect_referenced_filenames(db: Session, source) -> set[str]:
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
```

(`select` and `Session` are already imported at the top of the module from Task 2. `extract_asset_filenames` takes a plain `str`, so each field is guarded by a truthiness check first.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_version_clone.py -v`
Expected: PASS (all Task 2 + Task 3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/mathion/api/version_clone.py backend/tests/test_version_clone.py
git commit -m "feat(versions): add collect_referenced_filenames for duplicate preflight

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `clone_version_content` (deep tree copy)

**Files:**
- Modify: `backend/mathion/api/version_clone.py`
- Test: `backend/tests/test_version_clone.py`

**Interfaces:**
- Consumes: `copy_version_assets` (Task 2) — the test copies assets into the new version before calling clone; `render_with_assets`, `sync_asset_references`, `sync_script_reference` (helpers); all content models.
- Produces: `clone_version_content(db: Session, source: CourseVersion, new: CourseVersion) -> None` — deep-copies the `Block→Sequence→Item→Question→AnswerOption` tree from `source` into `new` (already flushed and asset-populated). Every `_html` field is re-rendered against `new`'s assets and every `AssetReference` rebuilt to point at `new`. Consumed by Task 5.

- [ ] **Step 1: Write the failing fidelity test**

Add a shared source-builder + the test to `backend/tests/test_version_clone.py`:

```python
from decimal import Decimal

from mathion.api.version_clone import clone_version_content
from mathion.models import AnswerOption, AssetReference


def _build_full_source(admin_client, db):
    """Course + version with all four item types (incl. a video and a quiz item
    that BOTH carry content_md with an image ref), a quiz with all question
    types + options, version info referencing an asset, and a block with info.
    Returns (course, version_dict, {asset filenames}). Assets uploaded via API."""
    course = admin_client.post("/api/courses", json={"slug": "full", "name": "F", "description": ""}).json()
    v = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    for name in ("logo.png", "sp.png", "vid.png", "quiz.png", "tq.png", "exp.png"):
        admin_client.post(
            f"/api/versions/{v['id']}/assets",
            files={"file": (name, io.BytesIO(name.encode() * 4), "image/png")},
        )
    admin_client.post(
        f"/api/versions/{v['id']}/assets",
        files={"file": ("app.js", io.BytesIO(b"console.log(1)"), "text/javascript")},
    )
    version = db.get(CourseVersion, v["id"])
    # Set info_md via ORM AFTER assets exist. Creating the version with an
    # asset-referencing info_md would 422 (create_version renders info_md
    # eagerly at versions.py:82). The /duplicate endpoint later renders this
    # against the COPIED assets, so logo.png must be a real uploaded asset.
    version.info_md = "Welcome ![logo](logo.png)"

    block = Block(version_id=version.id, title="Blk", slug="blk", order=1,
                  info="Block info", info_html="<p>Block info</p>")
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="Seq", slug="seq", order=1)
    db.add(seq); db.flush()

    sp = Item(sequence_id=seq.id, title="SP", slug="sp", order=1, type="static_page",
              content_md="Page ![x](sp.png)", content_html="")
    vid = Item(sequence_id=seq.id, title="Vid", slug="vid", order=2, type="video",
               content_md="Notes ![x](vid.png)", content_html="", video_url="https://e.com/v")
    quiz = Item(sequence_id=seq.id, title="Quiz", slug="quiz", order=3, type="quiz",
                content_md="Intro ![x](quiz.png)", content_html="")
    app = Item(sequence_id=seq.id, title="App", slug="app", order=4, type="interactive_app",
               content_md=None, content_html="", script_url="app.js")
    db.add_all([sp, vid, quiz, app]); db.flush()
    # Establish the source interactive_app's script AssetReference (mirrors the
    # item PATCH-attach path). Without this the source app has ZERO references,
    # so the "source ref survives, no GC" assertion below would be vacuous.
    from mathion.api.helpers import sync_script_reference
    sync_script_reference(db, version.id, app.id, "app.js")

    q_choice = Question(item_id=quiz.id, text_md="Pick ![t](tq.png)", text_html="",
                        type="single_choice", order=1, explanation_md="Why ![e](exp.png)",
                        explanation_html="")
    q_num = Question(item_id=quiz.id, text_md="2+2?", text_html="", type="numeric_answer",
                     order=2, correct_numeric=Decimal("4"), precision=0)
    q_text = Question(item_id=quiz.id, text_md="Name?", text_html="", type="text_answer",
                      order=3, correct_text="ada")
    q_multi = Question(item_id=quiz.id, text_md="Select all", text_html="",
                       type="multiple_choice", order=4)
    db.add_all([q_choice, q_num, q_text, q_multi]); db.flush()
    db.add_all([
        AnswerOption(question_id=q_choice.id, text="A", is_correct=True, order=1),
        AnswerOption(question_id=q_choice.id, text="B", is_correct=False, order=2),
        AnswerOption(question_id=q_multi.id, text="C", is_correct=True, order=1),
        AnswerOption(question_id=q_multi.id, text="D", is_correct=True, order=2),
    ])
    db.commit()
    return course, v, {"logo.png", "sp.png", "vid.png", "quiz.png", "tq.png", "exp.png", "app.js"}


def test_clone_version_content_full_fidelity(admin_client, db):
    course, src_v, filenames = _build_full_source(admin_client, db)
    source = db.get(CourseVersion, src_v["id"])

    new = CourseVersion(course_id=course["id"], state="created", is_disabled=False,
                        label="dup", info_md=source.info_md, info_html="",
                        max_quiz_attempts=source.max_quiz_attempts)
    db.add(new); db.flush()
    copy_version_assets(db, source.id, new.id, None)
    clone_version_content(db, source, new)
    db.commit()

    new_blocks = db.query(Block).filter(Block.version_id == new.id).all()
    assert len(new_blocks) == 1
    nb = new_blocks[0]
    assert nb.title == "Blk" and nb.info_html == "<p>Block info</p>"  # verbatim block html
    items = db.query(Item).join(Sequence).filter(Sequence.block_id == nb.id).order_by(Item.order).all()
    assert [i.type for i in items] == ["static_page", "video", "quiz", "interactive_app"]

    vid_item = items[1]
    assert vid_item.video_url == "https://e.com/v"
    assert vid_item.content_md == "Notes ![x](vid.png)"      # content_md kept on video
    assert f"/assets/{new.id}/vid.png" in vid_item.content_html  # rendered against NEW version

    app_item = items[3]
    assert app_item.script_url == "app.js"
    # the interactive_app's script AssetReference points at the NEW version's asset
    new_app_asset = db.query(Asset).filter(Asset.version_id == new.id, Asset.filename == "app.js").one()
    ref = db.query(AssetReference).filter(AssetReference.item_id == app_item.id).one()
    assert ref.asset_id == new_app_asset.id

    quiz_item = items[2]
    qs = db.query(Question).filter(Question.item_id == quiz_item.id).order_by(Question.order).all()
    assert [q.type for q in qs] == ["single_choice", "numeric_answer", "text_answer", "multiple_choice"]
    assert qs[1].correct_numeric == Decimal("4") and qs[1].precision == 0
    assert qs[2].correct_text == "ada"
    opts = db.query(AnswerOption).filter(AnswerOption.question_id == qs[0].id).order_by(AnswerOption.order).all()
    assert [(o.text, o.is_correct) for o in opts] == [("A", True), ("B", False)]

    # SOURCE untouched: its interactive_app script ref + asset survive (no GC)
    src_app = db.query(Item).filter(Item.sequence_id.in_(
        db.query(Sequence.id).join(Block).filter(Block.version_id == source.id)
    ), Item.type == "interactive_app").one()
    assert db.query(AssetReference).filter(AssetReference.item_id == src_app.id).count() == 1
    assert db.query(Asset).filter(Asset.version_id == source.id, Asset.filename == "app.js").count() == 1
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_version_clone.py::test_clone_version_content_full_fidelity -v`
Expected: FAIL with `ImportError: cannot import name 'clone_version_content'`.

- [ ] **Step 3: Implement `clone_version_content`**

Append to `backend/mathion/api/version_clone.py`:

```python
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
```

- [ ] **Step 4: Run the fidelity test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_version_clone.py -v`
Expected: PASS (all Task 2–4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/mathion/api/version_clone.py backend/tests/test_version_clone.py
git commit -m "feat(versions): add clone_version_content deep tree copy

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `POST /api/versions/{id}/duplicate` endpoint

**Files:**
- Modify: `backend/mathion/api/versions.py` (imports + new endpoint)
- Test: `backend/tests/test_version_duplicate.py` (new)

**Interfaces:**
- Consumes: `copy_version_assets`, `collect_referenced_filenames`, `clone_version_content` (Tasks 2–4); `render_with_assets`, `sync_asset_references`, `get_or_404`, `require_course_admin`; `VersionDuplicateRequest`, `VersionResponse`; `settings.max_course_size`, `settings.asset_path`.
- Produces: `POST /api/versions/{version_id}/duplicate` → **201** `VersionResponse`. Errors: 403 (non-admin / disabled source), 404 (missing), 400 (over-quota), 409 (dangling referenced asset), 500 (missing source file on disk). Consumed by the frontend (Tasks 7).

- [ ] **Step 1: Write the failing endpoint tests**

Create `backend/tests/test_version_duplicate.py` (reuses the source-builder from Task 4's test module):

```python
import io
import os

from mathion.config import settings
from mathion.models import Asset, AssetReference, Block, CourseVersion, Item, Question, Sequence
from tests.test_version_clone import _build_full_source


def _asset_dir(version_id):
    return os.path.join(settings.asset_path, "courses", str(version_id))


def test_duplicate_full_fidelity_and_source_untouched(admin_client, db):
    course, src_v, filenames = _build_full_source(admin_client, db)
    admin_client.post(f"/api/versions/{src_v['id']}/publish")

    r = admin_client.post(f"/api/versions/{src_v['id']}/duplicate", json={"label": "Copy A"})
    assert r.status_code == 201, r.text
    new = r.json()
    assert new["state"] == "created" and new["is_disabled"] is False
    assert new["label"] == "Copy A" and new["course_id"] == course["id"]
    assert new["id"] != src_v["id"]

    # tree copied
    nb = db.query(Block).filter(Block.version_id == new["id"]).all()
    assert len(nb) == 1
    items = db.query(Item).join(Sequence).filter(Sequence.block_id == nb[0].id).all()
    assert len(items) == 4
    # asset files copied byte-identically under the new version dir
    with open(os.path.join(_asset_dir(new["id"]), "logo.png"), "rb") as fh1, \
         open(os.path.join(_asset_dir(src_v["id"]), "logo.png"), "rb") as fh2:
        assert fh1.read() == fh2.read()
    # rendered URLs + AssetReference rows resolve against the NEW version (spec §138-139)
    assert f"/assets/{new['id']}/logo.png" in new["info_html"]     # info_html -> new id
    new_q = db.query(Question).join(Item).join(Sequence).join(Block).filter(
        Block.version_id == new["id"], Question.type == "single_choice",
    ).one()
    assert f"/assets/{new['id']}/tq.png" in new_q.text_html         # text_html -> new id
    new_tq = db.query(Asset).filter(Asset.version_id == new["id"], Asset.filename == "tq.png").one()
    q_ref_asset_ids = {r.asset_id for r in db.query(AssetReference).filter(AssetReference.question_id == new_q.id)}
    assert new_tq.id in q_ref_asset_ids                            # question ref -> COPIED asset
    # source untouched
    assert db.query(Item).join(Sequence).join(Block).filter(Block.version_id == src_v["id"]).count() == 4
    # the duplicate creates NO run-scoped data (spec copy-fidelity requirement)
    from mathion.models import MiniProject, Run
    assert db.query(Run).count() == 0
    assert db.query(MiniProject).count() == 0


def test_duplicate_requires_admin_403(auth_client, admin_client, db):
    _, src_v, _ = _build_full_source(admin_client, db)
    r = auth_client.post(f"/api/versions/{src_v['id']}/duplicate", json={"label": "x"})
    assert r.status_code == 403


def test_duplicate_disabled_source_403(admin_client, db):
    _, src_v, _ = _build_full_source(admin_client, db)
    admin_client.post(f"/api/versions/{src_v['id']}/disable")
    r = admin_client.post(f"/api/versions/{src_v['id']}/duplicate", json={"label": "x"})
    assert r.status_code == 403


def test_duplicate_missing_source_404(admin_client):
    r = admin_client.post("/api/versions/999999/duplicate", json={"label": "x"})
    assert r.status_code == 404


def test_duplicate_over_quota_400(admin_client, db, monkeypatch):
    _, src_v, _ = _build_full_source(admin_client, db)
    monkeypatch.setattr(settings, "max_course_size", 1)  # any real asset exceeds
    r = admin_client.post(f"/api/versions/{src_v['id']}/duplicate", json={"label": "x"})
    assert r.status_code == 400


def test_duplicate_dangling_referenced_asset_409_no_orphan_dir(admin_client, db):
    _, src_v, _ = _build_full_source(admin_client, db)
    admin_client.post(f"/api/versions/{src_v['id']}/publish")
    # force-delete a REFERENCED asset (logo.png is referenced by info_md)
    logo = db.query(Asset).filter(Asset.version_id == src_v["id"], Asset.filename == "logo.png").one()
    dr = admin_client.delete(f"/api/assets/{logo.id}?force=true")
    assert dr.status_code == 204
    before = set(os.listdir(os.path.join(settings.asset_path, "courses")))
    r = admin_client.post(f"/api/versions/{src_v['id']}/duplicate", json={"label": "x"})
    assert r.status_code == 409
    after = set(os.listdir(os.path.join(settings.asset_path, "courses")))
    assert before == after  # no orphaned courses/{new_id}/ dir left behind


def test_duplicate_empty_source_201(admin_client, db):
    course = admin_client.post("/api/courses", json={"slug": "empty", "name": "E", "description": ""}).json()
    src = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    r = admin_client.post(f"/api/versions/{src['id']}/duplicate", json={"label": "e"})
    assert r.status_code == 201
    assert db.query(Block).filter(Block.version_id == r.json()["id"]).count() == 0


def test_duplicate_omitted_body_defaults_label_empty(admin_client, db):
    course = admin_client.post("/api/courses", json={"slug": "nob", "name": "N", "description": ""}).json()
    src = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    r = admin_client.post(f"/api/versions/{src['id']}/duplicate")  # no body
    assert r.status_code == 201
    assert r.json()["label"] == ""


def test_duplicate_label_too_long_422(admin_client, db):
    course = admin_client.post("/api/courses", json={"slug": "lng", "name": "N", "description": ""}).json()
    src = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    r = admin_client.post(f"/api/versions/{src['id']}/duplicate", json={"label": "x" * 201})
    assert r.status_code == 422
```

> Note on cleanup coverage: the 409 test asserts no orphan dir because the preflight fires **before** the version insert (so the try/except `rmtree` never runs there). The endpoint's abort-`rmtree` path (a failure *after* assets are copied) is not directly exercised by an endpoint test — triggering it requires fault injection and the spec doesn't mandate it. The underlying copy-then-rollback discipline is covered by Task 2's `test_copy_version_assets_missing_file_raises_500` and the `create_version` `copy_assets_from` regression.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_version_duplicate.py -v`
Expected: FAIL — the fidelity + error tests fail (POST to the unregistered `/duplicate` path returns 404, so their assertions fail). Note: `test_duplicate_missing_source_404` coincidentally passes even pre-impl (an unmatched route also 404s); after implementation it meaningfully exercises `get_or_404`.

- [ ] **Step 3: Add imports + the endpoint**

In `backend/mathion/api/versions.py`, extend the `version_clone` import (from Task 2) to include all three functions:

```python
from mathion.api.version_clone import clone_version_content, collect_referenced_filenames, copy_version_assets
```

Add `VersionDuplicateRequest` to the schemas import at line 15:

```python
from mathion.schemas import VersionCreate, VersionDuplicateRequest, VersionRenderRequest, VersionRenderResponse, VersionResponse, VersionUpdate
```

Add the endpoint (place it after `create_version`, before `update_version`):

```python
@router.post("/api/versions/{version_id}/duplicate", status_code=201, response_model=VersionResponse)
def duplicate_version(
    version_id: int,
    data: VersionDuplicateRequest = VersionDuplicateRequest(),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    source = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, source.course_id)
    if source.is_disabled:
        raise HTTPException(status_code=403, detail="Cannot duplicate a disabled version")

    # 1. Quota (parity with create_version; coalesce so an empty source is 0, not None)
    total_size = db.scalar(
        select(func.coalesce(func.sum(Asset.file_size), 0)).where(Asset.version_id == source.id)
    )
    if total_size > settings.max_course_size:
        raise HTTPException(
            status_code=400,
            detail=f"Source assets total size ({total_size}) exceeds limit ({settings.max_course_size})",
        )

    # 2. Asset preflight — every referenced filename must have a backing Asset,
    #    BEFORE any disk write, so render_with_assets can't 422 mid-clone.
    referenced = collect_referenced_filenames(db, source)
    if referenced:
        existing = set(db.execute(
            select(Asset.filename).where(
                Asset.version_id == source.id,
                Asset.filename.in_(referenced),
            )
        ).scalars().all())
        missing = referenced - existing
        if missing:
            raise HTTPException(
                status_code=409,
                detail=f"Source references assets with no backing file: {', '.join(sorted(missing))}",
            )

    # 3. Insert the fresh draft; capture its id as a plain int for cleanup.
    new = CourseVersion(
        course_id=source.course_id,
        state="created",
        is_disabled=False,
        label=data.label,
        info_md=source.info_md,
        info_html="",
        max_quiz_attempts=source.max_quiz_attempts,
    )
    db.add(new)
    db.flush()
    new_id = new.id

    # 4. Copy assets, render info, clone tree, commit — all under cleanup.
    try:
        copy_version_assets(db, source.id, new.id, user.id)
        new.info_html = render_with_assets(db, new.id, new.info_md)
        sync_asset_references(db, new.id, [new.info_md], {"info_version_id": new.id})
        clone_version_content(db, source, new)
        db.commit()
    except Exception:
        db.rollback()
        shutil.rmtree(
            os.path.join(settings.asset_path, "courses", str(new_id)),
            ignore_errors=True,
        )
        raise

    # 5. refresh + return OUTSIDE the try — a post-commit refresh failure must
    #    NOT trigger the abort rmtree on an already-committed version's files.
    db.refresh(new)
    return new
```

(`os`, `shutil`, `func`, `select`, `render_with_assets`, `sync_asset_references`, `settings`, `Asset`, `CourseVersion` are all already imported in `versions.py`.)

- [ ] **Step 4: Run the endpoint tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_version_duplicate.py -v`
Expected: PASS (all nine).

- [ ] **Step 5: Run the full backend suite to confirm no regressions**

Run: `cd backend && .venv/bin/pytest -q`
Expected: PASS (whole suite green).

- [ ] **Step 6: Commit**

```bash
git add backend/mathion/api/versions.py backend/tests/test_version_duplicate.py
git commit -m "feat(versions): add POST /api/versions/{id}/duplicate endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Frontend `Version` type + fixtures

**Files:**
- Modify: `frontend/src/lib/types.ts:207-218` (Version)
- Modify (add `label: ''` to each Version/AdminTreeVersion literal):
  - `frontend/src/tests/versionsPageLoader.test.ts`
  - `frontend/src/tests/currentEditorVersion.test.ts`
  - `frontend/src/tests/deriveExpansion.test.ts`
  - `frontend/src/tests/QuizEditor.svelte.test.ts`
  - `frontend/src/tests/ItemEditPage.interactive.svelte.test.ts`
  - `frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Version.label: string` (required) — cascades to `AdminTreeVersion = Version & {…}` automatically. Consumed by Tasks 7, 8.

- [ ] **Step 1: Add `label` to the `Version` type**

In `frontend/src/lib/types.ts`, add `label` to `Version` (after `is_disabled`, mirroring the backend field order):

```typescript
export type Version = {
  id: number;
  course_id: number;
  state: 'created' | 'published' | 'archived';
  is_disabled: boolean;
  info_md: string;
  info_html: string;
  max_quiz_attempts: number;
  label: string;
  created_at: string;
  published_at: string | null;
  archived_at: string | null;
};
```

- [ ] **Step 2: Run svelte-check to surface the fixtures that now fail**

Run: `cd frontend && npm run check`
Expected: FAIL — svelte-check reports missing `label` on the **typed** `Version`/`AdminTreeVersion` literals: `versionsPageLoader.test.ts` (`: Version` return), `deriveExpansion.test.ts` (`: AdminTree` return), `ItemEditPage.interactive.svelte.test.ts` (`: AdminTreeVersion` return), `SequenceAccordion.interactive.svelte.test.ts` (`const version: AdminTreeVersion`). The other two — `currentEditorVersion.test.ts` (untyped `tree`) and `QuizEditor.svelte.test.ts` (untyped `VERSION` consumed via `props: any`) — won't error, but Step 3 still adds `label` to them for fixture consistency (they mirror the real runtime shape).

- [ ] **Step 3: Add `label: ''` to each failing fixture literal**

In each of the six files, locate the object literal typed as `Version` or `AdminTreeVersion` (grep within the file for `is_disabled:` — the version literal — using: `cd frontend && grep -n "is_disabled:" src/tests/<file>`) and add `label: '',` alongside the other fields. For a spread base like `{ ...PUB }`, add `label` to the base literal, not each spread.

- [ ] **Step 4: Run svelte-check to verify it passes**

Run: `cd frontend && npm run check`
Expected: PASS — no errors. (Any fixture missed in Step 3 will still be reported; fix and re-run until clean.)

- [ ] **Step 5: Run the affected test suites to confirm fixtures still behave**

Run: `cd frontend && npm run test`
Expected: PASS (whole vitest suite green with the added field).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/tests/versionsPageLoader.test.ts frontend/src/tests/currentEditorVersion.test.ts frontend/src/tests/deriveExpansion.test.ts frontend/src/tests/QuizEditor.svelte.test.ts frontend/src/tests/ItemEditPage.interactive.svelte.test.ts frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts
git commit -m "feat(frontend): add required label to Version type + fixtures

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: VersionsPage — per-row Duplicate button + label display

**Files:**
- Modify: `frontend/src/pages/editor/VersionsPage.svelte`
- Test: `frontend/src/tests/VersionsPage.duplicate.svelte.test.ts` (new)

**Interfaces:**
- Consumes: `Version.label` (Task 6); `POST /api/versions/{id}/duplicate` (Task 5); `versionsPageState`, `api.post`, `navigate`, `pushToast`, `ApiError`.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing component test**

Create `frontend/src/tests/VersionsPage.duplicate.svelte.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// vi.mock is hoisted above imports, so its factory must NOT reference a
// top-level `const` (TDZ error under Vitest 2). Mock inline with vi.fn(),
// then grab typed handles via vi.mocked AFTER the imports — the repo idiom
// (see RunDetailPage.publish.svelte.test.ts).
vi.mock('../lib/router.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/router.svelte')>();
  return { ...real, navigate: vi.fn() };
});
vi.mock('../lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/api')>();
  return { ...real, api: { ...real.api, post: vi.fn() } };
});
// Stub the loader so the page's onMount $effect doesn't hit the network; we
// seed versionsPageState directly.
vi.mock('../lib/versionsPageLoader.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/versionsPageLoader.svelte')>();
  return { ...real, loadVersionsPage: vi.fn().mockResolvedValue(undefined) };
});

import { navigate } from '../lib/router.svelte';
import { api } from '../lib/api';
import { versionsPageState } from '../lib/versionsPageLoader.svelte';
import VersionsPage from '../pages/editor/VersionsPage.svelte';
import type { Version } from '../lib/types';

// Typed handles to the already-hoisted mock fns (used in assertions + reset).
const navigateMock = vi.mocked(navigate);
const postMock = vi.mocked(api.post);

function mkVersion(over: Partial<Version> = {}): Version {
  return {
    id: 1, course_id: 1, state: 'published', is_disabled: false,
    info_md: '', info_html: '', max_quiz_attempts: 3, label: '',
    created_at: '2026-01-01T00:00:00Z', published_at: null, archived_at: null,
    ...over,
  };
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  navigateMock.mockReset();
  postMock.mockReset();
  versionsPageState.course = { id: 1, slug: 'c', name: 'C', description: '', is_admin: true };
  versionsPageState.versions = [];
  versionsPageState.loading = false;
  versionsPageState.error = null;
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (target.parentNode) target.parentNode.removeChild(target);
});

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

function clickButtonByText(root: HTMLElement, text: string) {
  const btn = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  btn.click();
  flushSync();
}

describe('VersionsPage — Duplicate', () => {
  it('opens with a clamped prefill, POSTs the label, navigates on success', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'Fall' })];
    postMock.mockResolvedValue({ id: 42 });
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();

    // label renders in the row (spec frontend requirement)
    expect(target.querySelector('.vlabel')?.textContent).toBe('Fall');

    clickButtonByText(target, 'Duplicate');
    const input = target.querySelector<HTMLInputElement>('input.dup-label');
    if (!input) throw new Error('duplicate label input missing');
    expect(input.value).toBe('Copy of Fall');       // prefill
    expect(input.maxLength).toBe(200);

    input.value = 'My Copy';
    input.dispatchEvent(new Event('input'));
    flushSync();
    clickButtonByText(target, 'Create copy');
    await settle();

    expect(postMock).toHaveBeenCalledWith('/api/versions/7/duplicate', { label: 'My Copy' });
    expect(navigateMock).toHaveBeenCalledWith('/courses/c/edit/v/42');
  });

  it('on error shows a toast and does NOT navigate', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    postMock.mockRejectedValue(new Error('boom'));
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickButtonByText(target, 'Duplicate');
    clickButtonByText(target, 'Create copy');
    await settle();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('single-open: opening a second row does not keep the first open', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'A' }), mkVersion({ id: 8, label: 'B' })];
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    const dupButtons = [...target.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Duplicate');
    dupButtons[0].click(); flushSync();
    dupButtons[1].click(); flushSync();
    const inputs = target.querySelectorAll('input.dup-label');
    expect(inputs.length).toBe(1);                    // only one row open
    expect((inputs[0] as HTMLInputElement).value).toBe('Copy of B');
  });

  it('the + New version form sends the optional label', async () => {
    postMock.mockResolvedValue({ id: 99 });
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickButtonByText(target, '+ New version');
    const labelInput = target.querySelector<HTMLInputElement>('input.new-label');
    if (!labelInput) throw new Error('new-version label input missing');
    labelInput.value = 'First';
    labelInput.dispatchEvent(new Event('input'));
    flushSync();
    clickButtonByText(target, 'Create');
    await settle();
    expect(postMock).toHaveBeenCalledWith('/api/courses/1/versions', expect.objectContaining({ label: 'First' }));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && TZ=Europe/Copenhagen npx vitest run src/tests/VersionsPage.duplicate.svelte.test.ts`
Expected: FAIL — no `Duplicate` button / no `input.dup-label` / no `input.new-label` exists yet.

- [ ] **Step 3: Add the create-form label + per-row duplicate state + handler to the script**

First, wire an optional label into the existing empty-create form. Add a state var next to the other create-form fields (lines 33-34):

```javascript
  let info_md = $state('');
  let max_quiz_attempts = $state<number | null>(3);
  let newLabel = $state('');
```

And include it in the `createVersion` POST body (line 72):

```javascript
      const v = await api.post<Version>(`/api/courses/${savedCourseId}/versions`, { info_md, max_quiz_attempts: n, label: newLabel });
```

Then add the duplicate state + handler to the `<script>` (after `deleteVersion`, before the closing `</script>` at line 114):

```javascript
  // Duplicate: per-row inline state. `duplicatingId` enforces a single open
  // row; `dupLabel` is the bound input value (clamped to 200 in JS — HTML
  // maxlength only bounds typing, not a programmatically-assigned value).
  let duplicatingId = $state<number | null>(null);
  let dupLabel = $state('');

  function openDuplicate(v: Version) {
    duplicatingId = v.id;
    dupLabel = ('Copy of ' + (v.label || 'v' + v.id)).slice(0, 200);
  }

  async function duplicateVersion(v: Version) {
    // Pin id + slug before the await (prop-change-mid-await guard, mirroring
    // createVersion at lines 68-69).
    const savedId = v.id;
    const savedSlug = courseSlug;
    busy = true;
    try {
      const nv = await api.post<Version>(`/api/versions/${savedId}/duplicate`, { label: dupLabel });
      pushToast('Version duplicated', 'success');
      navigate(`/courses/${savedSlug}/edit/v/${nv.id}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : 'Failed to duplicate version';
      pushToast(msg, 'error');
    } finally {
      busy = false;
    }
  }
```

- [ ] **Step 4: Add the create-form label input + the row label display + Duplicate button + inline form**

First, add a label input to the empty-create form — inside the `<form class="create">` (lines 134-144), before the "Info (markdown)" label at line 135:

```svelte
          <label>Label (optional)
            <input class="new-label" type="text" maxlength="200" bind:value={newLabel} />
          </label>
```

Then replace the row `<li>` block (lines 151-168) with:

```svelte
            <li class="row">
              <div>
                <strong>v{v.id}</strong>
                {#if v.label}<span class="vlabel">{v.label}</span>{/if}
                <span class="badge state-{v.state}">{v.state}</span>
                {#if v.is_disabled}<span class="badge disabled">disabled</span>{/if}
              </div>
              <div class="actions">
                <Button onclick={() => navigate(`/courses/${courseSlug}/edit/v/${v.id}`)} disabled={busy}>Open</Button>
                {#if v.is_disabled}
                  <Button variant="ghost" onclick={() => transition(v, 'enable')} disabled={busy}>Enable</Button>
                {:else}
                  <Button variant="ghost" onclick={() => transition(v, 'disable')} disabled={busy}>Disable</Button>
                  <Button variant="ghost" onclick={() => openDuplicate(v)} disabled={busy}>Duplicate</Button>
                {/if}
                {#if v.state === 'created' && !v.is_disabled}
                  <Button variant="ghost" onclick={() => deleteVersion(v)} disabled={busy}>Delete</Button>
                {/if}
              </div>
            </li>
            {#if duplicatingId === v.id}
              <li class="dup-row">
                <form class="dup" onsubmit={(e) => { e.preventDefault(); duplicateVersion(v); }}>
                  <label>New draft label
                    <input class="dup-label" type="text" maxlength="200" bind:value={dupLabel} disabled={busy} />
                  </label>
                  <Button type="submit" disabled={busy} loading={busy}>Create copy</Button>
                  <Button variant="ghost" onclick={() => (duplicatingId = null)} disabled={busy}>Cancel</Button>
                </form>
              </li>
            {/if}
```

Add these styles to the `<style>` block:

```css
  .vlabel { font-size: 0.85rem; color: var(--muted); margin-left: var(--space-2); }
  .dup-row { padding: 0 0 var(--space-2); }
  .dup { display: flex; align-items: flex-end; gap: var(--space-2); flex-wrap: wrap; }
  .dup input { min-width: 240px; }
```

(Duplicate is only offered on non-disabled rows, matching the backend 403.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && TZ=Europe/Copenhagen npx vitest run src/tests/VersionsPage.duplicate.svelte.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 6: Run svelte-check + full frontend suite**

Run: `cd frontend && npm run check && npm run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/editor/VersionsPage.svelte frontend/src/tests/VersionsPage.duplicate.svelte.test.ts
git commit -m "feat(frontend): per-row Duplicate button on VersionsPage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Version header label + VersionMetaForm label editing

**Files:**
- Modify: `frontend/src/pages/editor/VersionEditPage.svelte:298` (header)
- Modify: `frontend/src/components/editor/VersionMetaForm.svelte`
- Test: `frontend/src/tests/VersionMetaForm.label.svelte.test.ts` (new)

**Interfaces:**
- Consumes: `AdminTreeVersion.label` (Task 6, via cascade); `PATCH /api/versions/{id}` label branch (Task 1).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing meta-form test**

Create `frontend/src/tests/VersionMetaForm.label.svelte.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// Inline vi.fn() in the (hoisted) factory — never capture a top-level const
// (TDZ under Vitest 2). Grab the typed handle via vi.mocked after imports.
vi.mock('../lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/api')>();
  return { ...real, api: { ...real.api, patch: vi.fn() } };
});
vi.mock('../stores/currentEditorVersion.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../stores/currentEditorVersion.svelte')>();
  return { ...real, loadAdminTree: vi.fn().mockResolvedValue('discarded') };
});

import { api } from '../lib/api';
import VersionMetaForm from '../components/editor/VersionMetaForm.svelte';
import type { AdminTreeVersion } from '../lib/types';
import { DIRTY_REGISTRY_KEY, createDirtyRegistry } from '../lib/dirtyRegistry.svelte';

const patchMock = vi.mocked(api.patch);

function mkVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return {
    id: 5, course_id: 1, state: 'created', is_disabled: false,
    info_md: '', info_html: '', max_quiz_attempts: 3, label: 'Old',
    created_at: '2026-01-01T00:00:00Z', published_at: null, archived_at: null,
    content_updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}

// The component reads the dirty registry from getContext(DIRTY_REGISTRY_KEY)
// and throws if it's missing. Svelte 5's mount() takes a `context` Map — the
// same pattern the existing DIRTY_REGISTRY_KEY mount-context tests use.
let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => { patchMock.mockReset(); target = document.createElement('div'); document.body.appendChild(target); });
afterEach(() => { if (component) { unmount(component); component = null; } if (target.parentNode) target.parentNode.removeChild(target); });

async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

describe('VersionMetaForm — label', () => {
  it('PATCHes the edited label (created state)', async () => {
    patchMock.mockResolvedValue({});
    component = mount(VersionMetaForm, {
      target,
      props: { vid: 5, version: mkVersion() },
      context: new Map([[DIRTY_REGISTRY_KEY, createDirtyRegistry()]]),
    });
    await settle();

    const input = target.querySelector<HTMLInputElement>('input.meta-label');
    if (!input) throw new Error('label input missing');
    input.value = 'New Label';
    input.dispatchEvent(new Event('input'));
    flushSync();

    const saveBtn = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save');
    saveBtn!.click();
    await settle();

    expect(patchMock).toHaveBeenCalledWith('/api/versions/5', expect.objectContaining({ label: 'New Label' }));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && TZ=Europe/Copenhagen npx vitest run src/tests/VersionMetaForm.label.svelte.test.ts`
Expected: FAIL — no `input.meta-label`, and the PATCH body has no `label`.

- [ ] **Step 3: Wire `label` into VersionMetaForm**

In `frontend/src/components/editor/VersionMetaForm.svelte`:

Extend the `Meta` type + tracker init (lines 29-33):

```javascript
  type Meta = { info_md: string; max_quiz_attempts: number; label: string };
  const tracker = makeDirtyTracker<Meta>({
    info_md: version.info_md,
    max_quiz_attempts: version.max_quiz_attempts,
    label: version.label,
  });
```

Add `label` to all three other reset/discard sites — the vid-change reset (line 41), the post-save reset (line 75), and `discard()` (line 90):

```javascript
      tracker.reset({ info_md: version.info_md, max_quiz_attempts: version.max_quiz_attempts, label: version.label });
```
```javascript
          tracker.reset({ info_md: fresh.version.info_md, max_quiz_attempts: fresh.version.max_quiz_attempts, label: fresh.version.label });
```

For the refresh-failed reset (line 79) and the PATCH body (line 68), add a `sentLabel` pin next to the existing pins (lines 64-65) and thread it through:

```javascript
    const savedVid = vid;
    const sentInfoMd = tracker.current.info_md;
    const sentAttempts = n;
    const sentLabel = tracker.current.label;
```
```javascript
      await api.patch(`/api/versions/${savedVid}`, { info_md: sentInfoMd, max_quiz_attempts: sentAttempts, label: sentLabel });
```
```javascript
        tracker.reset({ info_md: sentInfoMd, max_quiz_attempts: sentAttempts, label: sentLabel });
```

Add the label input to the markup (inside the `<section class="meta">`, before the Info textarea at line 97):

```svelte
    <label>Label
      <input class="meta-label" type="text" maxlength="200" bind:value={tracker.current.label} disabled={busy || parentBusy} />
    </label>
```

- [ ] **Step 4: Add the header label render**

In `frontend/src/pages/editor/VersionEditPage.svelte`, update the header `<h1>` (line 298) to render the label after the version number:

```svelte
      <h1>{tree.course.name} · v{v.id}{#if v.label} <span class="vlabel">{v.label}</span>{/if} <span class="state state-{v.state}">{v.state}</span>{#if v.is_disabled}<span class="state disabled">disabled</span>{/if}</h1>
```

Add a style rule for `.vlabel` in that file's `<style>` block:

```css
  .vlabel { font-weight: 400; font-size: 0.9rem; color: var(--muted); }
```

Header-render coverage is **svelte-check (types) + the manual smoke** by design — the row render is unit-tested in Task 7, but mounting `VersionEditPage` in a unit test would require standing up its `onMount` admin-tree load, the `currentEditorVersion` store, the `DIRTY_REGISTRY` context, and child forms, which is disproportionate for a one-span escaped-text render that mirrors the tested row idiom.

- [ ] **Step 5: Run the meta-form test to verify it passes**

Run: `cd frontend && TZ=Europe/Copenhagen npx vitest run src/tests/VersionMetaForm.label.svelte.test.ts`
Expected: PASS.

- [ ] **Step 6: Run svelte-check + full frontend suite**

Run: `cd frontend && npm run check && npm run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/editor/VersionMetaForm.svelte frontend/src/pages/editor/VersionEditPage.svelte frontend/src/tests/VersionMetaForm.label.svelte.test.ts
git commit -m "feat(frontend): edit version label in meta form + show it in the header

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] Backend: `cd backend && .venv/bin/pytest -q` → all green.
- [ ] Frontend: `cd frontend && npm run check && npm run test` → all green.
- [ ] Manual smoke (optional, deferred to the usual manual-smoke pass): create a course, author a version with all item types + assets, duplicate it, confirm the new draft opens with the full tree + copied assets and an editable label, and the source is unchanged.
