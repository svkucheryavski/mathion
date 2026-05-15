# Auto-Slug-From-Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-14-auto-slug-from-title-design.md` (commit `b1f64d5`).

**Goal:** Backend derives Block/Sequence/Item slugs from titles automatically; admins never see or set a slug input. Frontend stops sending slug in create payloads; error UX keys on the title field.

**Architecture:** Pure `slugify()` helper in `backend/mathion/api/helpers.py`. Create endpoints derive `slug = slugify(data.title)`, reject empty (422) or >80 chars (422), let the existing `uq_*_slug` DB constraints catch duplicates (409). Update endpoints compare submitted-title to stored-title; re-derive slug only on actual change. `update_item` explicitly `db.flush()`s after slug assignment so autoflush-during-content-processing can't escape the IntegrityError wrapper. Frontend drops three slug inputs, three `newSlug` state cells, and three `'slug'` entries from `knownFields`; `formErrors.ts` relaxes its 409 regex to `/slug|title/i` and keys the result on `fieldErrors.title`.

**Tech Stack:** FastAPI + Pydantic v2 + SQLAlchemy 2.x + pytest (backend); Svelte 5 + TypeScript + vitest (frontend). Run pytest via `backend/.venv/bin/pytest` per project convention.

---

## File map

**Backend — created:**
- `backend/tests/test_slugify.py` — unit tests for the new helper.

**Backend — modified:**
- `backend/mathion/api/helpers.py` — adds `slugify()`.
- `backend/mathion/schemas.py` — drops `slug` from `BlockCreate` / `SequenceCreate` / `ItemCreate`; adds `model_config = ConfigDict(extra="forbid")` to all six create + update schemas.
- `backend/mathion/api/blocks.py` — `create_block` and `create_sequence` derive slug from title with 422 guards; `update_block` and `update_sequence` get the title-diff rule, null-guard, and `try/except IntegrityError → 409` wrapper.
- `backend/mathion/api/items.py` — `create_item` derives slug; `update_item` gets the title-diff rule, null-guard, explicit `db.flush()` after slug assignment, and a `try/except IntegrityError → 409` wrapper that spans the post-mutation region.
- `backend/tests/test_blocks.py` — drop `slug` from create payloads; rewrite duplicate-slug tests to use slugify-colliding titles; add new cases (empty title via Cyrillic, >80-char title, `extra="forbid"` rejects slug, info-only PATCH does not re-derive slug, title-edit on published re-derives slug, collision on update, equivalent-after-slugify update, explicit `{ "title": null }`).
- `backend/tests/test_items.py` — same shape for items, including the autoflush collision case.
- `backend/tests/test_admin_tree.py` — sweep `slug` out of block / sequence / item create payloads.
- Also sweep block/sequence/item-create payloads in `tests/test_assets_api.py`, `tests/test_content.py`, `tests/test_questions_api.py`, `tests/test_quiz_api.py`, `tests/test_reorder.py`, `tests/test_student.py`, `tests/test_versions.py` — the exhaustive per-task lists live inside Tasks 2/3/4. (`tests/test_access_control.py` only POSTs courses and is NOT affected.)

**Frontend — modified:**
- `frontend/src/lib/formErrors.ts` — relax 409 regex to `/slug|title/i`; key resulting error on `fieldErrors.title`.
- `frontend/src/tests/formErrors.test.ts` — update existing 409 tests to assert `.title` (not `.slug`); add a 422 case keyed on `body.title`.
- `frontend/src/pages/editor/VersionEditPage.svelte` — remove block-create slug input, `newSlug` state, slug from `knownFields`, slug from "create body" / "is-dirty?" check.
- `frontend/src/components/editor/BlockAccordion.svelte` — same for sequence-create form.
- `frontend/src/components/editor/SequenceAccordion.svelte` — same for item-create form.

---

## Task ordering rationale

1. **Task 1** lands the pure helper first — independent, easy to test, used by every later task.
2. **Tasks 2-4** (create endpoints) each combine schema change + endpoint behavior change + sweep of existing test payloads for that one entity type. Each task ends with all tests green.
3. **Tasks 5-7** (update endpoints) add the title-diff rule, null-guard, and `IntegrityError` wrapper one entity at a time. Task 7 (`update_item`) also adds the explicit `db.flush()` after slug assignment for the autoflush case.
4. **Task 8** updates the frontend `formErrors` helper.
5. **Tasks 9-11** strip slug input from the three create forms (one per file).
6. **Task 12** is the final verification — svelte-check + full pytest + full vitest.

---

## Task 1: `slugify()` helper

**Files:**
- Modify: `backend/mathion/api/helpers.py:1-12` (add `import re` near the top and the `slugify` function below the existing imports/helpers).
- Create: `backend/tests/test_slugify.py`.

- [ ] **Step 1: Write the failing test file**

Create `backend/tests/test_slugify.py`:

```python
import pytest

from mathion.api.helpers import slugify


@pytest.mark.parametrize(
    "title,expected",
    [
        # Pure-Latin alphanumeric
        ("hello", "hello"),
        ("Hello", "hello"),
        ("HELLO123", "hello123"),
        # Mixed punctuation runs collapse to single dashes
        ("Confidence intervals (part 1)", "confidence-intervals-part-1"),
        ("foo   bar", "foo-bar"),
        ("foo---bar", "foo-bar"),
        ("foo  -  bar", "foo-bar"),
        # Leading / trailing punctuation strips
        ("  hello  ", "hello"),
        ("---hello---", "hello"),
        ("!hello!", "hello"),
        # All-uppercase → lowercase
        ("HELLO WORLD", "hello-world"),
        # All-Cyrillic → ""
        ("Привет мир", ""),
        # Empty string
        ("", ""),
        # Single dash / whitespace
        ("-", ""),
        ("   ", ""),
        # Punctuation only
        ("!!!", ""),
        ("---", ""),
        # Mixed Cyrillic + Latin keeps only Latin
        ("Привет hello мир 1", "hello-1"),
        # 200-char Latin title — slugify itself does NOT truncate
        ("a" * 200, "a" * 200),
    ],
)
def test_slugify(title, expected):
    assert slugify(title) == expected


def test_slugify_does_not_truncate_long_titles():
    # Confirms the endpoint is responsible for length rejection, not slugify.
    long_input = "x" * 500
    assert slugify(long_input) == "x" * 500
```

- [ ] **Step 2: Run the test file to verify it fails**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/test_slugify.py -v
```

Expected: `ImportError` / `AttributeError` because `slugify` is not defined yet. (FAIL.)

- [ ] **Step 3: Add `slugify` to `backend/mathion/api/helpers.py`**

Add `import re` near the top of the file (after `import os` on line 1), and the function below the existing top-level imports (before any of the existing helper functions). Concretely, insert this block right after the `from mathion.database import Base` line:

```python
import re

_NON_SLUG = re.compile(r"[^a-z0-9]+")


def slugify(title: str) -> str:
    """Lowercase, collapse runs of non-[a-z0-9] into single dashes, strip
    leading/trailing dashes. Returns '' for titles with no Latin letters or
    digits (Cyrillic, emoji, punctuation only) — caller is responsible for
    rejecting empty results."""
    return _NON_SLUG.sub("-", title.lower()).strip("-")
```

(`import re` may already be imported at the top of the file via a different path; if so, skip that line.)

- [ ] **Step 4: Run the test file to verify it passes**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/test_slugify.py -v
```

Expected: all parametrized cases PASS + `test_slugify_does_not_truncate_long_titles` PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/mathion/api/helpers.py backend/tests/test_slugify.py
git commit -m "feat(backend): add slugify() helper for auto-derived slugs

Pure function: lowercase, collapse non-[a-z0-9] runs to single dashes,
strip leading/trailing dashes. Empty string for titles with no Latin
letters or digits (Cyrillic, emoji, punctuation only). Does NOT truncate
long titles — callers are responsible for rejecting >80-char slugs.

Tests cover Latin alphanumeric, punctuation collapse, all-Cyrillic,
mixed Cyrillic+Latin, punctuation-only, whitespace-only, and a 200-char
title (confirming no truncation)."
```

---

## Task 2: `create_block` — auto-derive slug

**Files:**
- Modify: `backend/mathion/schemas.py:1-5` (import `ConfigDict`) and `:63-67` (`BlockCreate`).
- Modify: `backend/mathion/api/blocks.py:1-20` (import `slugify`) and `:40-69` (`create_block`).
- Test: `backend/tests/test_blocks.py` — drop `slug` from existing block-create payloads; rewrite `test_api_duplicate_block_slug_within_version`; add new cases.
- Test: sweep `slug` from block-create payloads in `tests/test_admin_tree.py`, `tests/test_assets_api.py`, `tests/test_content.py`, `tests/test_items.py`, `tests/test_questions_api.py`, `tests/test_quiz_api.py`, `tests/test_reorder.py`, `tests/test_student.py`, `tests/test_versions.py` (the exhaustive list — see Step 10).

- [ ] **Step 1: Write a failing test asserting the new "no slug in body, slug derived from title" behavior**

Add to `backend/tests/test_blocks.py` (alongside the existing block-create tests):

```python
def test_api_create_block_derives_slug_from_title(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    response = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "Confidence intervals (part 1)",
    })
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["title"] == "Confidence intervals (part 1)"
    assert data["slug"] == "confidence-intervals-part-1"
```

- [ ] **Step 2: Run the new test to verify it fails**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/test_blocks.py::test_api_create_block_derives_slug_from_title -v
```

Expected: FAIL with 422 ("Field required" for `slug`) — the schema still requires slug.

- [ ] **Step 3: Update `BlockCreate` in `backend/mathion/schemas.py`**

First, extend the pydantic import at line 5 to include `ConfigDict`:

```python
from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator, model_validator
```

Then replace the `BlockCreate` class (currently lines 63-67):

```python
class BlockCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    info: str = ""
```

(`slug` removed; `info` defaults to empty as before; `extra="forbid"` rejects any extra fields, including a stray `slug`.)

- [ ] **Step 4: Update `create_block` in `backend/mathion/api/blocks.py`**

Update the import on line 6 to also import `slugify`:

```python
from mathion.api.helpers import get_or_404, require_course_admin, slugify
```

Replace the body of `create_block` (lines 40-69) with:

```python
@router.post("/api/versions/{version_id}/blocks", status_code=201, response_model=BlockResponse)
def create_block(version_id: int, data: BlockCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only add blocks to versions in 'created' state")
    count = db.scalar(select(func.count()).where(Block.version_id == version_id))
    if count >= MAX_BLOCKS:
        raise HTTPException(status_code=409, detail=f"Maximum {MAX_BLOCKS} blocks per version")

    slug = slugify(data.title)
    if not slug:
        raise HTTPException(
            status_code=422,
            detail=[{
                "loc": ["body", "title"],
                "msg": "Title must contain at least one Latin letter or digit",
                "type": "value_error",
            }],
        )
    if len(slug) > 80:
        raise HTTPException(
            status_code=422,
            detail=[{
                "loc": ["body", "title"],
                "msg": "Title is too long — the auto-generated slug exceeds the 80-character limit. Please shorten the title.",
                "type": "value_error",
            }],
        )

    # NOTE: order assignment is not safe under concurrent writes.
    # For PostgreSQL, consider SELECT ... FOR UPDATE or a serializable transaction.
    next_order = (db.scalar(select(func.max(Block.order)).where(Block.version_id == version_id)) or 0) + 1
    block = Block(
        version_id=version_id,
        title=data.title,
        slug=slug,
        order=next_order,
        info=data.info,
        info_html=render_markdown(data.info or ""),
    )
    db.add(block)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A block with the same auto-generated slug already exists in this version — choose a different title.",
        )
    db.refresh(block)
    return block
```

- [ ] **Step 5: Run the new test to verify it passes**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/test_blocks.py::test_api_create_block_derives_slug_from_title -v
```

Expected: PASS.

- [ ] **Step 6: Run full test_blocks.py to see existing tests fail**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/test_blocks.py -v 2>&1 | tail -40
```

Expected: many block-creation tests now fail with 422 ("Extra inputs are not permitted" for `slug`). That's the sweep we're about to do.

- [ ] **Step 7: Sweep block-create payloads in `tests/test_blocks.py`**

For every `admin_client.post(f"/api/versions/{...}/blocks", json={...})` call, remove the `"slug": "..."` key-value pair from the JSON body. Titles like `"B1"` will slugify to `"b1"` — matching the original explicit slug. Concrete edits (line numbers approximate; match by content):

| Existing line | Edit |
|---|---|
| `json={"title": "Descriptive Stats", "slug": "descriptive-stats", "info": "Learning goals", ...` | drop the `"slug": "descriptive-stats",` segment |
| `json={"title": f"Block {i+1}", "slug": f"block-{i+1}", "info": "", ...` | drop the `"slug": f"block-{i+1}",` segment |
| `json={"title": "Block 9", "slug": "block-9", "info": "", ...` | drop `"slug": "block-9",` |
| `json={"title": "New Block", "slug": "new-block", "info": "", ...` | drop `"slug": "new-block",` |
| `json={"title": "B1", "slug": "b1", "info": ""}` (multiple) | drop `"slug": "b1",` |
| `json={"title": "Old Title", "slug": "b1", "info": ""}` | drop `"slug": "b1",` |
| `json={"title": "B", "slug": "b"}` / `json={"title": "B", "slug": "b", "info": ""}` | drop `"slug": "b",` |

The cases that previously asserted `data["slug"] == "..."` against an explicit input slug should now assert against `slugify(title)`. For `"Descriptive Stats"` that's `"descriptive-stats"` — same. For `"B1"` it's `"b1"` — same. For `"Old Title"` it's `"old-title"` — formerly was `"b1"`; update the test's slug expectation accordingly. (Most tests don't actually assert slug; they just pass it.)

- [ ] **Step 8: Rewrite `test_api_duplicate_block_slug_within_version`**

The test (around line 178 of `test_blocks.py`) currently sends two distinct titles with the same explicit slug. Since slug is now derived from title, two distinct titles can collide only if they slugify identically. Rewrite:

```python
def test_api_duplicate_block_slug_within_version(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    # Two titles that slugify to the same string: "Foo Bar" and "Foo-Bar" both → "foo-bar"
    first = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Foo Bar"})
    assert first.status_code == 201
    resp = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Foo-Bar"})
    assert resp.status_code == 409
    assert "slug" in resp.json()["detail"].lower() or "title" in resp.json()["detail"].lower()
```

- [ ] **Step 9: Add new test cases to `test_blocks.py`**

Append these to the bottom of `test_blocks.py` (or alongside the create-block tests):

```python
def test_api_create_block_rejects_extra_slug_field(admin_client):
    """extra='forbid' rejects clients still sending slug."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    resp = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "Block A",
        "slug": "block-a",
    })
    assert resp.status_code == 422, resp.text
    # Pydantic v2 reports loc = ['body', 'slug'] for extra-forbid violations.
    locs = [tuple(d["loc"]) for d in resp.json()["detail"]]
    assert ("body", "slug") in locs


def test_api_create_block_empty_slug_after_slugify(admin_client):
    """Cyrillic-only title → slugify('') → 422 keyed to body.title."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    resp = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "Привет",
    })
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert any(tuple(d["loc"]) == ("body", "title") for d in detail)


def test_api_create_block_title_too_long_for_slug(admin_client):
    """200-char Latin title → slug >80 → 422 keyed to body.title."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    resp = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "a" * 100,  # slug = "a" * 100, exceeds 80
    })
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert any(tuple(d["loc"]) == ("body", "title") for d in detail)
```

- [ ] **Step 10: Sweep all test files that POST blocks with `slug`**

Block-create payloads exist in many test files beyond `test_blocks.py`. Sweep ALL of them:

- `tests/test_admin_tree.py`
- `tests/test_assets_api.py`
- `tests/test_content.py`
- `tests/test_items.py` (yes — `test_items.py` builds its block prerequisites the same way)
- `tests/test_questions_api.py`
- `tests/test_quiz_api.py`
- `tests/test_reorder.py`
- `tests/test_student.py`
- `tests/test_versions.py`

Block-create calls span multiple lines in most files — `admin_client.post(..., json={` on one line, then the payload on the next. A single-line grep misses those. Use:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  for f in tests/test_admin_tree.py tests/test_assets_api.py tests/test_blocks.py \
           tests/test_content.py tests/test_items.py tests/test_questions_api.py \
           tests/test_quiz_api.py tests/test_reorder.py tests/test_student.py \
           tests/test_versions.py; do
    echo "=== $f ==="
    grep -n -A2 '/blocks' "$f" | grep -B1 '"slug"'
  done
```

For each match, drop the `"slug": "..."` segment from the JSON payload, preserving the surrounding dict structure. Sequence and item slugs in these same files are handled in Tasks 3 and 4 — don't touch them now.

(Note: `tests/test_access_control.py` does NOT POST blocks; it only creates courses. Skip it.)

- [ ] **Step 11: Run the full backend test suite as the safety net**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/ 2>&1 | tail -40
```

Expected: all PASS. If any test still fails with 422 "Extra inputs are not permitted" for `slug`, the file slipped through the sweep — find it, drop `slug` from the offending payload, re-run pytest. Repeat until the whole suite is green before committing. This is the atomicity guarantee for Task 2.

- [ ] **Step 12: Commit**

```bash
git add backend/mathion/schemas.py backend/mathion/api/blocks.py backend/tests/
git commit -m "feat(backend): create_block auto-derives slug from title

BlockCreate drops the slug field and gains extra='forbid' to reject
stale clients. create_block computes slug = slugify(data.title); 422
keyed to body.title when slugify returns '' (Cyrillic-only, emoji,
punctuation-only) or when the slug exceeds 80 chars. Existing
IntegrityError -> 409 wrapper kept; the human-readable detail now
references 'auto-generated slug' and 'choose a different title.'

Sweep test_blocks.py / test_admin_tree.py / test_access_control.py to
drop slug from block-create payloads. Rewrite duplicate-slug test to
use two titles that slugify identically ('Foo Bar' and 'Foo-Bar')."
```

---

## Task 3: `create_sequence` — auto-derive slug

**Files:**
- Modify: `backend/mathion/schemas.py` — `SequenceCreate` (currently lines 80-83).
- Modify: `backend/mathion/api/blocks.py:155-178` — `create_sequence`.
- Test: `backend/tests/test_blocks.py` — sweep sequence-create payloads; rewrite duplicate-slug test for sequences; add new cases.
- Test: `backend/tests/test_admin_tree.py` — sweep sequence-create payloads.

- [ ] **Step 1: Write a failing test asserting the new behavior**

Add to `test_blocks.py`:

```python
def test_api_create_sequence_derives_slug_from_title(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    resp = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "Confidence intervals (part 1)",
    })
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["title"] == "Confidence intervals (part 1)"
    assert data["slug"] == "confidence-intervals-part-1"
```

- [ ] **Step 2: Run the new test to verify it fails**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/test_blocks.py::test_api_create_sequence_derives_slug_from_title -v
```

Expected: FAIL — 422 ("Field required" for `slug`).

- [ ] **Step 3: Update `SequenceCreate` in `backend/mathion/schemas.py`**

Replace the `SequenceCreate` class (currently lines 80-83):

```python
class SequenceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
```

- [ ] **Step 4: Update `create_sequence` in `backend/mathion/api/blocks.py`**

Replace lines 155-178 with:

```python
@router.post("/api/blocks/{block_id}/sequences", status_code=201, response_model=SequenceResponse)
def create_sequence(block_id: int, data: SequenceCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    block = get_or_404(db, Block, block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only add sequences to versions in 'created' state")
    count = db.scalar(select(func.count()).where(Sequence.block_id == block_id))
    if count >= MAX_SEQUENCES:
        raise HTTPException(status_code=409, detail=f"Maximum {MAX_SEQUENCES} sequences per block")

    slug = slugify(data.title)
    if not slug:
        raise HTTPException(
            status_code=422,
            detail=[{
                "loc": ["body", "title"],
                "msg": "Title must contain at least one Latin letter or digit",
                "type": "value_error",
            }],
        )
    if len(slug) > 80:
        raise HTTPException(
            status_code=422,
            detail=[{
                "loc": ["body", "title"],
                "msg": "Title is too long — the auto-generated slug exceeds the 80-character limit. Please shorten the title.",
                "type": "value_error",
            }],
        )

    # NOTE: order assignment is not safe under concurrent writes.
    # For PostgreSQL, consider SELECT ... FOR UPDATE or a serializable transaction.
    next_order = (db.scalar(select(func.max(Sequence.order)).where(Sequence.block_id == block_id)) or 0) + 1
    seq = Sequence(block_id=block_id, title=data.title, slug=slug, order=next_order)
    db.add(seq)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A sequence with the same auto-generated slug already exists in this block — choose a different title.",
        )
    db.refresh(seq)
    return seq
```

- [ ] **Step 5: Run the new test to verify it passes**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/test_blocks.py::test_api_create_sequence_derives_slug_from_title -v
```

Expected: PASS.

- [ ] **Step 6: Sweep sequence-create payloads in `test_blocks.py`**

For every `admin_client.post(f"/api/blocks/{...}/sequences", json={...})` call, remove the `"slug": "..."` key.

Concrete cases to edit:

| Existing | Edit |
|---|---|
| `json={"title": "Quantiles", "slug": "quantiles"}` | drop `"slug": "quantiles",` |
| `json={"title": f"Seq {i+1}", "slug": f"seq-{i+1}"}` (loop) | drop `"slug": f"seq-{i+1}",` |
| `json={"title": "Seq 9", "slug": "seq-9"}` | drop `"slug": "seq-9",` |
| `json={"title": "S1", "slug": "s1"}` (multiple) | drop `"slug": "s1",` |
| `json={"title": "S", "slug": "s"}` (multiple) | drop `"slug": "s",` |

Slug assertions in these tests, if any, were `data["slug"] == "quantiles"` etc.; those still hold because `slugify(title)` produces the same string.

- [ ] **Step 7: Rewrite `test_api_duplicate_sequence_slug_within_block`**

Replace (around line 186 of `test_blocks.py`) with:

```python
def test_api_duplicate_sequence_slug_within_block(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "Foo Bar"})
    resp = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "Foo-Bar"})
    assert resp.status_code == 409
    assert "slug" in resp.json()["detail"].lower() or "title" in resp.json()["detail"].lower()
```

- [ ] **Step 8: Add new test cases for sequence create (extra-forbid, empty-slug, too-long)**

```python
def test_api_create_sequence_rejects_extra_slug_field(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    resp = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "Seq A",
        "slug": "seq-a",
    })
    assert resp.status_code == 422, resp.text
    locs = [tuple(d["loc"]) for d in resp.json()["detail"]]
    assert ("body", "slug") in locs


def test_api_create_sequence_empty_slug_after_slugify(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    resp = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "Привет"})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_create_sequence_title_too_long_for_slug(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    resp = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "a" * 100})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])
```

- [ ] **Step 9: Sweep all test files that POST sequences with `slug`**

Same list as the block-sweep in Task 2 (most of these files build full block→sequence→item trees):

- `tests/test_admin_tree.py`
- `tests/test_assets_api.py`
- `tests/test_blocks.py` (already swept for block-creates in Task 2; now sweep its sequence-creates)
- `tests/test_content.py`
- `tests/test_items.py`
- `tests/test_questions_api.py`
- `tests/test_quiz_api.py`
- `tests/test_reorder.py`
- `tests/test_student.py`
- `tests/test_versions.py`

Same multi-line caveat as Task 2: most sequence creates span multiple lines. Locate via:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  for f in tests/test_admin_tree.py tests/test_assets_api.py tests/test_blocks.py \
           tests/test_content.py tests/test_items.py tests/test_questions_api.py \
           tests/test_quiz_api.py tests/test_reorder.py tests/test_student.py \
           tests/test_versions.py; do
    echo "=== $f ==="
    grep -n -A2 '/sequences' "$f" | grep -B1 '"slug"'
  done
```

For each match, drop the `"slug": "..."` segment.

- [ ] **Step 10: Run the full backend test suite as the safety net**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/ 2>&1 | tail -40
```

Expected: all PASS. Any failures with 422 "Extra inputs are not permitted" for `slug` mean a sequence-create payload slipped through the sweep — fix and re-run.

- [ ] **Step 11: Commit**

```bash
git add backend/mathion/schemas.py backend/mathion/api/blocks.py backend/tests/
git commit -m "feat(backend): create_sequence auto-derives slug from title

SequenceCreate drops slug, adds extra='forbid'. Endpoint derives slug
from title with empty/>80 422 guards. Collision message references
'auto-generated slug' and prompts choosing a different title.

Sweep test_blocks.py and test_admin_tree.py to drop slug from
sequence-create payloads. Rewrite duplicate-slug test to use two
titles that slugify identically."
```

---

## Task 4: `create_item` — auto-derive slug

**Files:**
- Modify: `backend/mathion/schemas.py` — `ItemCreate` (currently lines 94-117).
- Modify: `backend/mathion/api/items.py:38-64` — `create_item`.
- Test: `backend/tests/test_items.py` — sweep item-create payloads; rewrite duplicate-slug tests; add new cases.
- Test: sweep `slug` from item-create payloads in `tests/test_admin_tree.py`, `tests/test_assets_api.py`, `tests/test_blocks.py`, `tests/test_content.py`, `tests/test_questions_api.py`, `tests/test_quiz_api.py`, `tests/test_reorder.py`, `tests/test_student.py`, `tests/test_versions.py` (the exhaustive list — see Step 9).

- [ ] **Step 1: Write a failing test asserting the new behavior**

Add to `test_items.py`:

```python
def test_api_create_item_derives_slug_from_title(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    resp = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Confidence intervals (part 1)",
        "type": "static_page",
        "content_md": "hello",
    })
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["title"] == "Confidence intervals (part 1)"
    assert data["slug"] == "confidence-intervals-part-1"
```

- [ ] **Step 2: Run the new test to verify it fails**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/test_items.py::test_api_create_item_derives_slug_from_title -v
```

Expected: FAIL — 422 ("Field required" for `slug`).

- [ ] **Step 3: Update `ItemCreate` in `backend/mathion/schemas.py`**

Replace the `ItemCreate` class (lines 94-117). Keep the existing `@field_validator` and `@model_validator`; just remove the `slug` line and add the config:

```python
class ItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    type: Literal["static_page", "video", "quiz", "interactive_app"]
    content_md: str | None = None
    video_url: str | None = None
    script_url: str | None = None

    @field_validator("video_url", "script_url", mode="before")
    @classmethod
    def validate_url(cls, v: str | None) -> str | None:
        if v is not None and not v.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return v

    @model_validator(mode="after")
    def check_type_fields(self):
        if self.type == "static_page" and not self.content_md:
            raise ValueError("content_md is required for static_page items")
        if self.type == "video" and not self.video_url:
            raise ValueError("video_url is required for video items")
        if self.type == "interactive_app" and not self.script_url:
            raise ValueError("script_url is required for interactive_app items")
        return self
```

- [ ] **Step 4: Update `create_item` in `backend/mathion/api/items.py`**

Update the import on line 6:

```python
from mathion.api.helpers import bump_content_updated_at, get_or_404, render_with_assets, require_course_admin, slugify, sync_asset_references
```

Replace `create_item` (lines 38-64):

```python
@router.post("/api/sequences/{sequence_id}/items", status_code=201, response_model=ItemResponse)
def create_item(sequence_id: int, data: ItemCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = _get_version_for_sequence(db, sequence_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only add items to versions in 'created' state")

    slug = slugify(data.title)
    if not slug:
        raise HTTPException(
            status_code=422,
            detail=[{
                "loc": ["body", "title"],
                "msg": "Title must contain at least one Latin letter or digit",
                "type": "value_error",
            }],
        )
    if len(slug) > 80:
        raise HTTPException(
            status_code=422,
            detail=[{
                "loc": ["body", "title"],
                "msg": "Title is too long — the auto-generated slug exceeds the 80-character limit. Please shorten the title.",
                "type": "value_error",
            }],
        )

    # NOTE: order assignment is not safe under concurrent writes.
    # For PostgreSQL, consider SELECT ... FOR UPDATE or a serializable transaction.
    next_order = (db.scalar(select(func.max(Item.order)).where(Item.sequence_id == sequence_id)) or 0) + 1
    item = Item(
        sequence_id=sequence_id, title=data.title, slug=slug, order=next_order,
        type=data.type, content_md=data.content_md, content_html="",
        video_url=data.video_url, script_url=data.script_url,
    )
    db.add(item)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="An item with the same auto-generated slug already exists in this sequence — choose a different title.",
        )
    item.content_html = _process_content_md(db, version, item.id, data.content_md)
    bump_content_updated_at(version)
    db.commit()
    db.refresh(item)
    return item
```

- [ ] **Step 5: Run the new test to verify it passes**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/test_items.py::test_api_create_item_derives_slug_from_title -v
```

Expected: PASS.

- [ ] **Step 6: Sweep item-create payloads in `test_items.py`**

For every `admin_client.post(f"/api/sequences/{...}/items", json={...})` call, drop the `"slug": "..."` key.

Search:

```bash
grep -n '/items.*"slug"\|sequences/.*items.*slug' /Users/svkucheryavski/Documents/Developing/mathion/backend/tests/test_items.py
```

Edit each match accordingly. Slug assertions on the response (if any — `data["slug"] == "..."`) still pass when title slugifies to the same string.

- [ ] **Step 7: Rewrite item duplicate-slug test if present**

If `test_items.py` has a `test_api_duplicate_item_slug_within_sequence` (or similar) — find it via `grep -n "duplicate.*slug" tests/test_items.py` — rewrite to:

```python
def test_api_duplicate_item_slug_within_sequence(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Foo Bar", "type": "static_page", "content_md": "x",
    })
    resp = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Foo-Bar", "type": "static_page", "content_md": "y",
    })
    assert resp.status_code == 409
    assert "slug" in resp.json()["detail"].lower() or "title" in resp.json()["detail"].lower()
```

If no such test exists yet, add this one.

- [ ] **Step 8: Add new test cases for item create**

```python
def test_api_create_item_rejects_extra_slug_field(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    resp = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Item A",
        "slug": "item-a",
        "type": "static_page",
        "content_md": "x",
    })
    assert resp.status_code == 422, resp.text
    locs = [tuple(d["loc"]) for d in resp.json()["detail"]]
    assert ("body", "slug") in locs


def test_api_create_item_empty_slug_after_slugify(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    resp = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Привет",
        "type": "static_page",
        "content_md": "x",
    })
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_create_item_title_too_long_for_slug(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    resp = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "a" * 100,
        "type": "static_page",
        "content_md": "x",
    })
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])
```

- [ ] **Step 9: Sweep all test files that POST items with `slug`**

Item-create payloads exist in:

- `tests/test_admin_tree.py`
- `tests/test_assets_api.py`
- `tests/test_blocks.py` (some block tests create items down the tree)
- `tests/test_content.py`
- `tests/test_items.py`
- `tests/test_questions_api.py`
- `tests/test_quiz_api.py`
- `tests/test_reorder.py`
- `tests/test_student.py`
- `tests/test_versions.py`

Many of these calls span multiple lines — `admin_client.post(f"/api/sequences/{...}/items", json={` on one line, then `"title": "...", "slug": "...", "type": "..."` on the next. A single-line grep misses them. Use a multi-line-aware sweep:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  grep -n -A2 '/items.*json=' tests/*.py | grep -B1 '"slug"' | head -60
```

Or simpler: grep each file for `/items` and visually scan the following 3-4 lines for `"slug": "..."`:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  for f in tests/test_admin_tree.py tests/test_assets_api.py tests/test_blocks.py \
           tests/test_content.py tests/test_items.py tests/test_questions_api.py \
           tests/test_quiz_api.py tests/test_reorder.py tests/test_student.py \
           tests/test_versions.py; do
    echo "=== $f ==="
    grep -n -A3 '/items' "$f" | grep -B1 '"slug"'
  done
```

For each match, drop the `"slug": "..."` segment from the JSON payload. Sequence and block slugs in these same files were swept in Tasks 2 and 3 already.

(`tests/test_access_control.py` does NOT POST items.)

- [ ] **Step 10: Run the full backend test suite as the safety net**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/ 2>&1 | tail -40
```

Expected: all PASS. Any 422 "Extra inputs are not permitted" failure for `slug` means an item-create payload slipped through — find it, drop the slug, re-run. This is the atomicity guarantee for Task 4.

- [ ] **Step 11: Commit**

```bash
git add backend/mathion/schemas.py backend/mathion/api/items.py backend/tests/
git commit -m "feat(backend): create_item auto-derives slug from title

ItemCreate drops slug, adds extra='forbid'. Endpoint derives slug from
title with empty/>80 422 guards. Collision detection still uses the
existing db.flush()-then-catch-IntegrityError pattern that create_item
already had (for content_md asset processing); the message now
references 'auto-generated slug' and prompts choosing a different title.

Sweep test_items.py / test_admin_tree.py / test_access_control.py to
drop slug from item-create payloads. Rewrite duplicate-slug test to use
slugify-colliding titles."
```

---

## Task 5: `update_block` — title-diff rule + IntegrityError wrapper

**Files:**
- Modify: `backend/mathion/schemas.py` — `BlockUpdate` (currently lines 120-122). Add `extra="forbid"`.
- Modify: `backend/mathion/api/blocks.py:82-109` — `update_block`.
- Test: `backend/tests/test_blocks.py` — add the new update-side test cases.

- [ ] **Step 1: Write a failing test that title edit re-derives slug**

Add to `test_blocks.py`:

```python
def test_api_update_block_title_edit_re_derives_slug(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Old"}).json()
    assert block["slug"] == "old"
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": "New Name"})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["title"] == "New Name"
    assert data["slug"] == "new-name"
```

- [ ] **Step 2: Run the new test to verify it fails**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/test_blocks.py::test_api_update_block_title_edit_re_derives_slug -v
```

Expected: FAIL — the response has the new title but old slug `"old"`.

- [ ] **Step 3: Update `BlockUpdate` in `backend/mathion/schemas.py`**

Replace the `BlockUpdate` class (lines 120-122):

```python
class BlockUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=200)
    info: str | None = None
```

- [ ] **Step 4: Update `update_block` in `backend/mathion/api/blocks.py`**

Replace `update_block` (lines 82-109):

```python
@router.patch("/api/blocks/{block_id}", response_model=BlockResponse)
def update_block(block_id: int, data: BlockUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    block = get_or_404(db, Block, block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    state = version.state

    if state == "archived":
        raise HTTPException(status_code=409, detail="Cannot edit blocks in archived versions")

    updates = data.model_dump(exclude_unset=True)
    if state == "published":
        disallowed = set(updates.keys()) - _BLOCK_EDITABLE_PUBLISHED
        if disallowed:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot edit {disallowed} in published state",
            )

    # Snapshot stored title BEFORE mutating, so the title-diff rule has a
    # stable reference even if loops below run in any order.
    stored_title = block.title

    if "title" in updates:
        if updates["title"] is None:
            raise HTTPException(
                status_code=422,
                detail=[{
                    "loc": ["body", "title"],
                    "msg": "Title must be a non-null string",
                    "type": "value_error",
                }],
            )
        if updates["title"] != stored_title:
            new_slug = slugify(updates["title"])
            if not new_slug:
                raise HTTPException(
                    status_code=422,
                    detail=[{
                        "loc": ["body", "title"],
                        "msg": "Title must contain at least one Latin letter or digit",
                        "type": "value_error",
                    }],
                )
            if len(new_slug) > 80:
                raise HTTPException(
                    status_code=422,
                    detail=[{
                        "loc": ["body", "title"],
                        "msg": "Title is too long — the auto-generated slug exceeds the 80-character limit. Please shorten the title.",
                        "type": "value_error",
                    }],
                )
            updates["slug"] = new_slug

    for field, value in updates.items():
        setattr(block, field, value)
        if field == "info":
            block.info_html = render_markdown(value or "")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A block with the same auto-generated slug already exists in this version — choose a different title.",
        )
    db.refresh(block)
    return block
```

- [ ] **Step 5: Run the new test to verify it passes**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/test_blocks.py::test_api_update_block_title_edit_re_derives_slug -v
```

Expected: PASS.

- [ ] **Step 6: Add the remaining update-side test cases**

```python
def test_api_update_block_info_only_does_not_re_derive_slug(admin_client):
    """Frontend always resends title on info-only edits — title-diff rule prevents slug churn."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Same Title"}).json()
    original_slug = block["slug"]
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={
        "title": "Same Title",  # resent unchanged
        "info": "new info",
    })
    assert resp.status_code == 200
    assert resp.json()["slug"] == original_slug
    assert resp.json()["info"] == "new info"


def test_api_update_block_title_edit_on_published_re_derives_slug(admin_client, db):
    """title is in _BLOCK_EDITABLE_PUBLISHED, so a published version still re-derives slug on title edit."""
    from mathion.models import CourseVersion
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version_resp = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block_resp = admin_client.post(f"/api/versions/{version_resp['id']}/blocks", json={"title": "Old"}).json()
    v = db.get(CourseVersion, version_resp["id"])
    v.state = "published"
    db.commit()
    resp = admin_client.patch(f"/api/blocks/{block_resp['id']}", json={"title": "Renamed On Published"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["slug"] == "renamed-on-published"


def test_api_update_block_collision_returns_409(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Foo Bar"})  # slug=foo-bar
    second = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Other"}).json()  # slug=other
    resp = admin_client.patch(f"/api/blocks/{second['id']}", json={"title": "Foo-Bar"})  # also slugifies to foo-bar
    assert resp.status_code == 409


def test_api_update_block_equivalent_after_slugify_is_no_op_for_slug(admin_client):
    """Title 'Foo Bar' → 'Foo Bar!' both slugify to 'foo-bar'. Slug-write is identical; no IntegrityError on self-row."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "Foo Bar"}).json()
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": "Foo Bar!"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Foo Bar!"
    assert resp.json()["slug"] == "foo-bar"


def test_api_update_block_explicit_null_title_returns_422(admin_client):
    """{ 'title': null } in PATCH body is a client error keyed to body.title (not 500 from slugify(None))."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": None})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_block_rejects_extra_slug_field(admin_client):
    """extra='forbid' on update schema rejects clients trying to override slug."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": "New", "slug": "rogue-slug"})
    assert resp.status_code == 422, resp.text
    locs = [tuple(d["loc"]) for d in resp.json()["detail"]]
    assert ("body", "slug") in locs


def test_api_update_block_unchanged_title_preserves_legacy_slug(admin_client, db):
    """Spec lines 56, 142: a row with an existing non-derived slug (the
    'legacy custom slug' case) must NOT have its slug snapped to
    slugify(title) when an info-only PATCH resends the unchanged title.
    A naïve 'title key present means rederive' implementation would fail
    this — only the title-diff check should rederive."""
    from mathion.models import Block
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block_resp = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "My Title"}).json()
    # Directly mutate the row to simulate a pre-existing custom slug that
    # doesn't match slugify(title). This is the migration scenario.
    row = db.get(Block, block_resp["id"])
    row.slug = "legacy-custom-slug"
    db.commit()
    # PATCH resending the unchanged title + an info edit (BlockAccordion's
    # actual save shape).
    resp = admin_client.patch(f"/api/blocks/{block_resp['id']}", json={
        "title": "My Title",  # unchanged
        "info": "new info",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["slug"] == "legacy-custom-slug"  # NOT snapped to "my-title"


def test_api_update_block_empty_slug_after_slugify(admin_client):
    """Title edit to a Cyrillic-only string → slugify('') → 422 keyed to body.title."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": "Привет"})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_block_title_too_long_for_slug(admin_client):
    """Title edit producing >80-char slug → 422 keyed to body.title."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    resp = admin_client.patch(f"/api/blocks/{block['id']}", json={"title": "a" * 100})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])
```

- [ ] **Step 7: Run the full test_blocks.py suite**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/test_blocks.py -v 2>&1 | tail -40
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/mathion/schemas.py backend/mathion/api/blocks.py backend/tests/test_blocks.py
git commit -m "feat(backend): update_block re-derives slug on title change

BlockUpdate gains extra='forbid'. update_block now:
- Snapshots stored title before mutation.
- Guards explicit { 'title': null } -> 422 keyed to body.title.
- When submitted title differs from stored: re-derives slug, with
  empty (422) and >80 (422) guards mirroring create.
- Wraps db.commit() in try/except IntegrityError -> 409 for the
  concurrent-edit race (two admins renaming siblings to colliding
  titles).
- Info-only PATCHes (where title is resent but unchanged) leave slug
  alone, preventing slug churn on the current frontend save flow that
  always includes title."
```

---

## Task 6: `update_sequence` — title-diff rule + IntegrityError wrapper

**Files:**
- Modify: `backend/mathion/schemas.py` — `SequenceUpdate` (currently lines 125-126).
- Modify: `backend/mathion/api/blocks.py:192-218` — `update_sequence`.
- Test: `backend/tests/test_blocks.py` — sequence update test cases.

- [ ] **Step 1: Write a failing test**

```python
def test_api_update_sequence_title_edit_re_derives_slug(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "Old"}).json()
    assert seq["slug"] == "old"
    resp = admin_client.patch(f"/api/sequences/{seq['id']}", json={"title": "Renamed Seq"})
    assert resp.status_code == 200
    assert resp.json()["slug"] == "renamed-seq"
```

- [ ] **Step 2: Run the new test to verify it fails**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/test_blocks.py::test_api_update_sequence_title_edit_re_derives_slug -v
```

Expected: FAIL — slug stays `"old"`.

- [ ] **Step 3: Update `SequenceUpdate`**

Replace (lines 125-126):

```python
class SequenceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=200)
```

- [ ] **Step 4: Update `update_sequence` in `backend/mathion/api/blocks.py`**

Replace (lines 192-218):

```python
@router.patch("/api/sequences/{sequence_id}", response_model=SequenceResponse)
def update_sequence(sequence_id: int, data: SequenceUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    seq = get_or_404(db, Sequence, sequence_id)
    block = get_or_404(db, Block, seq.block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    state = version.state

    if state == "archived":
        raise HTTPException(status_code=409, detail="Cannot edit sequences in archived versions")

    updates = data.model_dump(exclude_unset=True)
    if state == "published":
        disallowed = set(updates.keys()) - _SEQUENCE_EDITABLE_PUBLISHED
        if disallowed:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot edit {disallowed} in published state",
            )

    stored_title = seq.title

    if "title" in updates:
        if updates["title"] is None:
            raise HTTPException(
                status_code=422,
                detail=[{
                    "loc": ["body", "title"],
                    "msg": "Title must be a non-null string",
                    "type": "value_error",
                }],
            )
        if updates["title"] != stored_title:
            new_slug = slugify(updates["title"])
            if not new_slug:
                raise HTTPException(
                    status_code=422,
                    detail=[{
                        "loc": ["body", "title"],
                        "msg": "Title must contain at least one Latin letter or digit",
                        "type": "value_error",
                    }],
                )
            if len(new_slug) > 80:
                raise HTTPException(
                    status_code=422,
                    detail=[{
                        "loc": ["body", "title"],
                        "msg": "Title is too long — the auto-generated slug exceeds the 80-character limit. Please shorten the title.",
                        "type": "value_error",
                    }],
                )
            updates["slug"] = new_slug

    for field, value in updates.items():
        setattr(seq, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A sequence with the same auto-generated slug already exists in this block — choose a different title.",
        )
    db.refresh(seq)
    return seq
```

- [ ] **Step 5: Run the new test to verify it passes**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/test_blocks.py::test_api_update_sequence_title_edit_re_derives_slug -v
```

Expected: PASS.

- [ ] **Step 6: Add sequence-update edge-case tests**

```python
def test_api_update_sequence_collision_returns_409(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "Foo Bar"})
    other = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "Other"}).json()
    resp = admin_client.patch(f"/api/sequences/{other['id']}", json={"title": "Foo-Bar"})
    assert resp.status_code == 409


def test_api_update_sequence_explicit_null_title_returns_422(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    resp = admin_client.patch(f"/api/sequences/{seq['id']}", json={"title": None})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_sequence_rejects_extra_slug_field(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    resp = admin_client.patch(f"/api/sequences/{seq['id']}", json={"title": "New", "slug": "rogue"})
    assert resp.status_code == 422
    locs = [tuple(d["loc"]) for d in resp.json()["detail"]]
    assert ("body", "slug") in locs


def test_api_update_sequence_unchanged_title_preserves_legacy_slug(admin_client, db):
    """Legacy custom slug preserved on unchanged-title PATCH (spec lines 56, 142)."""
    from mathion.models import Sequence
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq_resp = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "My Title"}).json()
    row = db.get(Sequence, seq_resp["id"])
    row.slug = "legacy-custom-slug"
    db.commit()
    resp = admin_client.patch(f"/api/sequences/{seq_resp['id']}", json={"title": "My Title"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["slug"] == "legacy-custom-slug"


def test_api_update_sequence_empty_slug_after_slugify(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    resp = admin_client.patch(f"/api/sequences/{seq['id']}", json={"title": "Привет"})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_sequence_title_too_long_for_slug(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    resp = admin_client.patch(f"/api/sequences/{seq['id']}", json={"title": "a" * 100})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_sequence_title_edit_on_published_re_derives_slug(admin_client, db):
    """title is in _SEQUENCE_EDITABLE_PUBLISHED, so published versions still re-derive."""
    from mathion.models import CourseVersion
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "Old"}).json()
    v = db.get(CourseVersion, version["id"])
    v.state = "published"
    db.commit()
    resp = admin_client.patch(f"/api/sequences/{seq['id']}", json={"title": "Renamed On Published"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["slug"] == "renamed-on-published"


def test_api_update_sequence_unchanged_title_keeps_slug(admin_client):
    """Title resent unchanged — slug stays."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    original_slug = seq["slug"]
    resp = admin_client.patch(f"/api/sequences/{seq['id']}", json={"title": "S1"})
    assert resp.status_code == 200
    assert resp.json()["slug"] == original_slug


def test_api_update_sequence_equivalent_after_slugify(admin_client):
    """Title 'Foo Bar' → 'Foo Bar!' both slugify to 'foo-bar'."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "Foo Bar"}).json()
    resp = admin_client.patch(f"/api/sequences/{seq['id']}", json={"title": "Foo Bar!"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Foo Bar!"
    assert resp.json()["slug"] == "foo-bar"
```

- [ ] **Step 7: Run the affected test files**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/test_blocks.py -v 2>&1 | tail -25
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/mathion/schemas.py backend/mathion/api/blocks.py backend/tests/test_blocks.py
git commit -m "feat(backend): update_sequence re-derives slug on title change

Mirrors update_block: SequenceUpdate gains extra='forbid';
update_sequence snapshots stored title, guards explicit null, re-derives
slug only when submitted title differs, applies same empty/>80 422
guards, and wraps db.commit() in try/except IntegrityError -> 409 for
the concurrent-edit race."
```

---

## Task 7: `update_item` — title-diff rule + autoflush-safe wrapper

**Files:**
- Modify: `backend/mathion/schemas.py` — `ItemUpdate` (currently lines 129-140).
- Modify: `backend/mathion/api/items.py:77-114` — `update_item`.
- Test: `backend/tests/test_items.py` — item update test cases including the autoflush collision case.

- [ ] **Step 1: Write a failing test that title edit re-derives slug**

```python
def test_api_update_item_title_edit_re_derives_slug(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Old", "type": "static_page", "content_md": "x",
    }).json()
    assert item["slug"] == "old"
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"title": "Renamed Item"})
    assert resp.status_code == 200
    assert resp.json()["slug"] == "renamed-item"
```

- [ ] **Step 2: Run the new test to verify it fails**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/test_items.py::test_api_update_item_title_edit_re_derives_slug -v
```

Expected: FAIL — slug stays `"old"`.

- [ ] **Step 3: Update `ItemUpdate`**

Replace (lines 129-140) — keep the existing `validate_url` validator:

```python
class ItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content_md: str | None = None
    video_url: str | None = None
    script_url: str | None = None

    @field_validator("video_url", "script_url", mode="before")
    @classmethod
    def validate_url(cls, v: str | None) -> str | None:
        if v is not None and not v.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return v
```

- [ ] **Step 4: Update `update_item` in `backend/mathion/api/items.py`**

Replace (lines 77-114):

```python
@router.patch("/api/items/{item_id}", response_model=ItemResponse)
def update_item(item_id: int, data: ItemUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = get_or_404(db, Item, item_id)
    version = _get_version_for_item(db, item)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")

    if version.state == "archived":
        raise HTTPException(status_code=409, detail="Cannot edit items in archived versions")

    updates = data.model_dump(exclude_unset=True)
    if version.state == "published":
        disallowed = set(updates.keys()) - _ITEM_EDITABLE_PUBLISHED
        if disallowed:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot edit {disallowed} in published state",
            )

    stored_title = item.title

    if "title" in updates:
        if updates["title"] is None:
            raise HTTPException(
                status_code=422,
                detail=[{
                    "loc": ["body", "title"],
                    "msg": "Title must be a non-null string",
                    "type": "value_error",
                }],
            )
        if updates["title"] != stored_title:
            new_slug = slugify(updates["title"])
            if not new_slug:
                raise HTTPException(
                    status_code=422,
                    detail=[{
                        "loc": ["body", "title"],
                        "msg": "Title must contain at least one Latin letter or digit",
                        "type": "value_error",
                    }],
                )
            if len(new_slug) > 80:
                raise HTTPException(
                    status_code=422,
                    detail=[{
                        "loc": ["body", "title"],
                        "msg": "Title is too long — the auto-generated slug exceeds the 80-character limit. Please shorten the title.",
                        "type": "value_error",
                    }],
                )
            updates["slug"] = new_slug

    for field, value in updates.items():
        setattr(item, field, value)

    # If slug changed, flush now so the uq_item_sequence_slug constraint
    # fires deterministically *here* — before _process_content_md runs
    # render_with_assets / sync_asset_references, both of which issue
    # db.execute(...) queries that would autoflush the pending slug write
    # and surface the IntegrityError outside our try/except.
    if "slug" in updates:
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail="An item with the same auto-generated slug already exists in this sequence — choose a different title.",
            )

    if "content_md" in updates:
        # _process_content_md calls render_with_assets, which raises 422
        # if content_md references an asset that doesn't exist in this
        # version. After the earlier explicit db.flush() (when slug
        # changed), pending mutations are already in the session — if
        # render_with_assets raises here, those pending mutations would
        # be left in the test session (production get_db() rolls back
        # on close, but tests share the session). Rollback before
        # re-raising so the slug/title write doesn't leak.
        try:
            item.content_html = _process_content_md(db, version, item.id, item.content_md)
        except HTTPException:
            db.rollback()
            raise
        bump_content_updated_at(version)

    # Validate type invariants after applying patch.
    #
    # When slug changed earlier, we explicitly db.flush()ed so the
    # IntegrityError surfaced inside our 409 wrapper. That flush also
    # committed any other pending mutations (new title, new content_html,
    # etc.) to the session. The production get_db() rolls back on close,
    # but tests use a session override that does NOT rollback per-request
    # — and even in production it is more conservative to explicitly
    # rollback before any post-flush 422 so the partially-applied state
    # never has a chance to be observed.
    if item.type == "static_page" and item.content_md is None:
        db.rollback()
        raise HTTPException(status_code=422, detail="content_md cannot be null for static_page items")
    if item.type == "video" and item.video_url is None:
        db.rollback()
        raise HTTPException(status_code=422, detail="video_url cannot be null for video items")
    if item.type == "interactive_app" and item.script_url is None:
        db.rollback()
        raise HTTPException(status_code=422, detail="script_url cannot be null for interactive_app items")

    db.commit()
    db.refresh(item)
    return item
```

(Update the import on line 6 to include `slugify`:)

```python
from mathion.api.helpers import bump_content_updated_at, get_or_404, render_with_assets, require_course_admin, slugify, sync_asset_references
```

— though it was already added in Task 4. Verify it's still present.

- [ ] **Step 5: Run the new test to verify it passes**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/test_items.py::test_api_update_item_title_edit_re_derives_slug -v
```

Expected: PASS.

- [ ] **Step 6: Add the autoflush collision test**

This is the codex-R3-driven test that verifies the IntegrityError fires from the explicit `db.flush()` BEFORE content processing autoflushes:

```python
def test_api_update_item_collision_via_autoflush_returns_409(admin_client):
    """update_item PATCH that (a) changes title to a colliding slug AND
    (b) includes content_md must return 409 even though autoflush during
    _process_content_md would otherwise fire the IntegrityError outside
    the commit-only try/except.

    The endpoint's explicit db.flush() right after slug assignment is
    what catches this — verify by exercising the exact path."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Foo Bar", "type": "static_page", "content_md": "x",
    })
    other = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Other", "type": "static_page", "content_md": "x",
    }).json()
    resp = admin_client.patch(f"/api/items/{other['id']}", json={
        "title": "Foo-Bar",  # also slugifies to foo-bar
        "content_md": "new content",  # forces _process_content_md to run
    })
    assert resp.status_code == 409, resp.text
    # Crucially NOT 500 — that would mean the IntegrityError escaped.
```

- [ ] **Step 7: Add the remaining update-side test cases**

```python
def test_api_update_item_info_only_does_not_re_derive_slug(admin_client):
    """content_md-only edit with title resent unchanged keeps slug stable."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Same Title", "type": "static_page", "content_md": "x",
    }).json()
    original_slug = item["slug"]
    resp = admin_client.patch(f"/api/items/{item['id']}", json={
        "title": "Same Title",
        "content_md": "new content",
    })
    assert resp.status_code == 200
    assert resp.json()["slug"] == original_slug
    assert resp.json()["content_md"] == "new content"


def test_api_update_item_equivalent_after_slugify_is_no_op_for_slug(admin_client):
    """Title 'Foo Bar' → 'Foo Bar!' both slugify to 'foo-bar'; slug write is identical."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Foo Bar", "type": "static_page", "content_md": "x",
    }).json()
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"title": "Foo Bar!"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Foo Bar!"
    assert resp.json()["slug"] == "foo-bar"


def test_api_update_item_explicit_null_title_returns_422(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "I1", "type": "static_page", "content_md": "x",
    }).json()
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"title": None})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_item_rejects_extra_slug_field(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "I1", "type": "static_page", "content_md": "x",
    }).json()
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"title": "New", "slug": "rogue"})
    assert resp.status_code == 422
    locs = [tuple(d["loc"]) for d in resp.json()["detail"]]
    assert ("body", "slug") in locs


def test_api_update_item_unchanged_title_preserves_legacy_slug(admin_client, db):
    """Legacy custom slug preserved on unchanged-title PATCH (spec lines 56, 142)."""
    from mathion.models import Item
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item_resp = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "My Title", "type": "static_page", "content_md": "x",
    }).json()
    row = db.get(Item, item_resp["id"])
    row.slug = "legacy-custom-slug"
    db.commit()
    resp = admin_client.patch(f"/api/items/{item_resp['id']}", json={
        "title": "My Title",
        "content_md": "new content",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["slug"] == "legacy-custom-slug"


def test_api_update_item_empty_slug_after_slugify(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "I1", "type": "static_page", "content_md": "x",
    }).json()
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"title": "Привет"})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_item_title_too_long_for_slug(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "I1", "type": "static_page", "content_md": "x",
    }).json()
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"title": "a" * 100})
    assert resp.status_code == 422
    assert any(tuple(d["loc"]) == ("body", "title") for d in resp.json()["detail"])


def test_api_update_item_title_edit_on_published_re_derives_slug(admin_client, db):
    """title is in _ITEM_EDITABLE_PUBLISHED, so published versions still re-derive."""
    from mathion.models import CourseVersion
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Old", "type": "static_page", "content_md": "x",
    }).json()
    v = db.get(CourseVersion, version["id"])
    v.state = "published"
    db.commit()
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"title": "Renamed On Published"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["slug"] == "renamed-on-published"


def test_api_update_item_missing_asset_rolls_back_flushed_slug(admin_client, db):
    """Codex R2 hazard: when slug changes (explicit db.flush() runs) AND
    content_md references a missing asset, _process_content_md raises
    422. The endpoint must rollback before re-raising so the flushed
    slug/title write doesn't persist in the (test) shared session."""
    from mathion.models import Item
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Original", "type": "static_page", "content_md": "x",
    }).json()
    original_slug = item["slug"]
    original_title = item["title"]
    # Title edit (triggers slug flush) + content_md referencing a
    # non-existent asset → render_with_assets raises 422.
    resp = admin_client.patch(f"/api/items/{item['id']}", json={
        "title": "New Name",
        "content_md": "![missing](nonexistent-asset.png)",
    })
    assert resp.status_code == 422, resp.text
    db.expire_all()
    fresh = db.get(Item, item["id"])
    assert fresh.slug == original_slug
    assert fresh.title == original_title


def test_api_update_item_invariant_422_rolls_back_flushed_slug(admin_client, db):
    """Codex R1 hazard: when slug changes AND a subsequent type-invariant
    422 fires (e.g., content_md set to null on a static_page), the explicit
    db.flush() that committed the new slug to the session must be rolled
    back so the persisted row keeps its old slug/title. The endpoint adds
    db.rollback() before each invariant raise to enforce this."""
    from mathion.models import Item
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S1"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Original", "type": "static_page", "content_md": "x",
    }).json()
    original_slug = item["slug"]
    original_title = item["title"]
    # Edit title (which would change slug) AND set content_md to null (which violates
    # the static_page invariant). The 422 must fire AND the flushed slug/title must NOT persist.
    resp = admin_client.patch(f"/api/items/{item['id']}", json={
        "title": "New Name",
        "content_md": None,
    })
    assert resp.status_code == 422, resp.text
    # Verify persistence: re-read via a fresh DB query.
    db.expire_all()
    fresh = db.get(Item, item["id"])
    assert fresh.slug == original_slug
    assert fresh.title == original_title
```

- [ ] **Step 8: Run the affected test files + entire backend suite**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/ 2>&1 | tail -20
```

Expected: all PASS. (If the entire suite was passing after Task 6, it should still pass; if anything in `test_questions_api.py` / `test_quiz_api.py` etc. POSTs items with `slug`, fix it in this commit.)

- [ ] **Step 9: Commit**

```bash
git add backend/mathion/schemas.py backend/mathion/api/items.py backend/tests/test_items.py
git commit -m "feat(backend): update_item re-derives slug, handles autoflush

ItemUpdate gains extra='forbid'. update_item snapshots stored title,
guards explicit null, re-derives slug only when submitted title differs,
applies same empty/>80 422 guards as create.

Crucially: when slug changes, the endpoint explicitly db.flush()es
right after assigning slug — BEFORE _process_content_md runs
render_with_assets / sync_asset_references, both of which issue
db.execute() queries that would autoflush the pending slug write and
surface the IntegrityError outside the commit-only try/except. The
new explicit flush is wrapped in try/except IntegrityError -> 409 so
collisions return the proper status with the title-focused message,
never a 500.

New test test_api_update_item_collision_via_autoflush_returns_409
exercises the exact path: title-edit-to-collide + content_md change in
one PATCH — would 500 without the explicit flush, returns 409 now."
```

---

## Task 8: Frontend — `formErrors.ts` 409 regex + `.title` key

**Files:**
- Modify: `frontend/src/lib/formErrors.ts:50-52` (the 409 branch).
- Test: `frontend/src/tests/formErrors.test.ts` — update existing 409 tests; add 422 case keyed on `body.title`.

- [ ] **Step 1: Update the 409 test cases to assert `.title`**

In `frontend/src/tests/formErrors.test.ts`:

Replace the `'409 whose body mentions "slug" → inline slug error'` test:

```typescript
  it('409 whose body mentions "slug" or "title" → inline title error', () => {
    const e = new ApiError(409, 'A sequence with the same auto-generated slug already exists in this block — choose a different title.');
    const r = mapCreateError(e, known);
    expect(r.fieldErrors.title).toBe('A sequence with the same auto-generated slug already exists in this block — choose a different title.');
    expect(r.globalMessage).toBe(null);
  });
```

Replace the `'409 with "Slug" capitalized matches case-insensitively'` test:

```typescript
  it('409 with "Slug" or "Title" capitalized matches case-insensitively', () => {
    const e1 = new ApiError(409, 'Slug already exists');
    expect(mapCreateError(e1, known).fieldErrors.title).toBe('Slug already exists');
    const e2 = new ApiError(409, 'Title already taken');
    expect(mapCreateError(e2, known).fieldErrors.title).toBe('Title already taken');
  });
```

Add a new test:

```typescript
  it('422 with loc=["body","title"] maps inline on title field', () => {
    const e = new ApiError(422, [
      { loc: ['body', 'title'], msg: 'Title must contain at least one Latin letter or digit', type: 'value_error' },
    ]);
    const r = mapCreateError(e, known);
    expect(r.fieldErrors.title).toBe('Title must contain at least one Latin letter or digit');
    expect(r.globalMessage).toBe(null);
  });
```

Also update the `const known = ['title', 'slug'] as const;` at the top of the describe block — since the upstream callers will be passing `['title']` (no slug) post-Task-9-11, but the helper itself still treats `slug` as a generic known field. The test fixture can stay as-is to verify the helper's existing 422 handling. Optionally, add `const knownTitleOnly = ['title'] as const;` and use it in the new 422 test for added realism:

```typescript
  it('422 with loc=["body","title"] maps inline on title field (knownFields=[title])', () => {
    const e = new ApiError(422, [
      { loc: ['body', 'title'], msg: 'Title must contain at least one Latin letter or digit', type: 'value_error' },
    ]);
    const r = mapCreateError(e, ['title']);
    expect(r.fieldErrors.title).toBe('Title must contain at least one Latin letter or digit');
    expect(r.globalMessage).toBe(null);
  });
```

- [ ] **Step 2: Run the affected tests to verify they fail**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && \
  npx vitest run src/tests/formErrors.test.ts 2>&1 | tail -20
```

Expected: the modified 409 tests fail because the helper still keys on `.slug`. The new 422 test passes (no helper change needed for it).

- [ ] **Step 3: Update `frontend/src/lib/formErrors.ts`**

Update the header comment (lines 1-18) to reflect the new behavior and the 409 branch (lines 50-52).

Replace the comment block (lines 1-19):

```typescript
// Maps API errors raised by create-form POSTs into per-field inline errors
// + an optional global message.
//
// Why a helper rather than inline mapping in each create flow: the three
// editor create flows (VersionEditPage createBlock, BlockAccordion
// createSequence, SequenceAccordion createItem) all need the same shape,
// and a copy-pasted mapper would drift. Pure function — no runes — so
// it's trivially unit-testable in isolation.
//
// Behavior:
//   - 422: walk `validationErrors()`, key each entry by its last `loc` segment
//     (FastAPI / Pydantic shape). Entries whose key is in `knownFields` land
//     in `fieldErrors`; others fall into `globalMessage` joined by `; `.
//   - 409: if the body message mentions "slug" or "title" (case-insensitive),
//     set `fieldErrors.title = displayMessage`; otherwise `globalMessage`.
//     Backend's auto-derived-slug error messages reference both "slug" and
//     "title"; the frontend always surfaces them on the title input because
//     that's the field the admin actually edits.
//   - All other errors: `globalMessage = displayMessage` (or 'Save failed').
```

Replace the 409 branch (lines 50-52):

```typescript
    if (e.status === 409 && /slug|title/i.test(typeof e.detail === 'string' ? e.detail : '')) {
      return { fieldErrors: { title: e.displayMessage }, globalMessage: null };
    }
```

- [ ] **Step 4: Run the formErrors tests to verify all pass**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && \
  npx vitest run src/tests/formErrors.test.ts 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/formErrors.ts frontend/src/tests/formErrors.test.ts
git commit -m "feat(frontend): formErrors 409 keys on title, matches /slug|title/i

The backend's new auto-derived-slug 409 messages reference both 'slug'
(the constraint name) and 'title' (the field the user can act on).
Always surface these on the title input — the slug input is gone in
the next few commits, and 'title' is the actionable field anyway.

Regex relaxed from /slug/i to /slug|title/i so both backend phrasings
match. Tests updated; new test covers a 422 with loc=['body','title']
which the existing 422 branch already handled (passed without change)."
```

---

## Task 9: Frontend — drop slug from `VersionEditPage` block-create form

**Files:**
- Modify: `frontend/src/pages/editor/VersionEditPage.svelte` — block-create form (around lines 150-200 for state/derived/handlers; line 327-328 for the slug input).

- [ ] **Step 1: Survey the lines to delete**

Run this to locate all slug references in the file:

```bash
grep -n "newSlug\|knownFields.*slug\|'slug'\|\"slug\"" /Users/svkucheryavski/Documents/Developing/mathion/frontend/src/pages/editor/VersionEditPage.svelte
```

- [ ] **Step 2: Remove `newSlug` state and references**

In `VersionEditPage.svelte`:

- Delete the `let newSlug = $state('');` line (around line 150).
- In the `isDirty` derived/getter (around line 158), change:
  ```typescript
  return creating && (newTitle.trim() !== '' || newSlug.trim() !== '');
  ```
  to:
  ```typescript
  return creating && newTitle.trim() !== '';
  ```
- In the reset blocks (around lines 172 and 179), change `newTitle = ''; newSlug = '';` to `newTitle = '';`.
- In the submit guard (around line 184), drop the `!newSlug.trim()` predicate (it appears in the OR-chain inside the `return` early-exit):
  ```typescript
  if (createBusy || busy || !perms?.canEditStructure || !newTitle.trim()) return;
  ```
- In the API call (around line 190), drop `slug: newSlug`:
  ```typescript
  await api.post(`/api/versions/${savedVid}/blocks`, { title: newTitle, info: '' });
  ```
- After successful create (around line 191), change `newTitle = ''; newSlug = ''; creating = false;` to `newTitle = ''; creating = false;`.
- In `mapCreateError` call (around line 196), change `['title', 'slug']` to `['title']`:
  ```typescript
  const mapped = mapCreateError(e, ['title']);
  ```
- In the form template (around lines 327-328), DELETE the entire block:
  ```svelte
  <input placeholder="Slug" bind:value={newSlug} required disabled={createBusy || busy} pattern="[a-z0-9]+(-[a-z0-9]+)*" oninput={() => { if (createErrors.slug) createErrors = { ...createErrors, slug: '' }; }} />
  {#if createErrors.slug}<small class="field-err">{createErrors.slug}</small>{/if}
  ```
- In the Create button's `disabled` predicate (around line 331), drop `!newSlug.trim()`:
  ```svelte
  <Button type="submit" disabled={createBusy || busy || !perms?.canEditStructure || !newTitle.trim()} loading={createBusy}>Create</Button>
  ```

- [ ] **Step 3: Run svelte-check + the relevant tests**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && \
  npm run check 2>&1 | tail -10
```

Expected: 0 errors. (Pre-existing warnings about state-referenced-locally and a11y remain — those are not regressions.)

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && \
  npx vitest run 2>&1 | tail -10
```

Expected: all PASS.

- [ ] **Step 4: Manual sanity smoke (no dev-server-start needed if backend is up)**

Open `VersionEditPage` in the running dev environment (or skip if no dev server up; the Task 12 verification covers a clean run). Create a new block with title `"Smoke Test"` — should succeed and display slug `smoke-test` in the header.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/editor/VersionEditPage.svelte
git commit -m "feat(frontend): VersionEditPage block-create — drop slug input

Slug is now server-derived from title. Remove the slug <input>,
newSlug state, dirty-check participation, knownFields entry, and
disabled-predicate participation. Submit body becomes { title, info: '' }.
mapCreateError keyed on ['title'] (the only client-visible field)."
```

---

## Task 10: Frontend — drop slug from `BlockAccordion` sequence-create form

**Files:**
- Modify: `frontend/src/components/editor/BlockAccordion.svelte` — sequence-create form.

- [ ] **Step 1: Survey slug references**

```bash
grep -n "newSlug\|knownFields.*slug\|'slug'\|\"slug\"" /Users/svkucheryavski/Documents/Developing/mathion/frontend/src/components/editor/BlockAccordion.svelte
```

- [ ] **Step 2: Apply the same set of removals as Task 9 (adjusted line numbers)**

In `BlockAccordion.svelte`:

- Delete `let newSlug = $state('');` (around line 202).
- In `isDirty` getter (around line 210), change `(newTitle.trim() !== '' || newSlug.trim() !== '')` to `newTitle.trim() !== ''`.
- In the reset block (around lines 227 and 240), drop `newSlug = '';`.
- In the submit guard (around line 245), drop `&& !newSlug.trim()`.
- In the API call (around line 252), drop `slug: newSlug`:
  ```typescript
  await api.post(`/api/blocks/${savedBid}/sequences`, { title: newTitle });
  ```
- After-success (around line 253), drop `newSlug = '';`.
- In `mapCreateError` call (around line 259), change `['title', 'slug']` to `['title']`.
- In the template (around lines 324-325), DELETE the slug `<input>` and its `field-err` `<small>`.
- In the Create button's `disabled` predicate (around line 328), drop `!newSlug.trim()`.

- [ ] **Step 3: Run svelte-check + tests**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && \
  npm run check 2>&1 | tail -10 && npx vitest run 2>&1 | tail -10
```

Expected: 0 errors, all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/editor/BlockAccordion.svelte
git commit -m "feat(frontend): BlockAccordion sequence-create — drop slug input

Same shape as the VersionEditPage block-create change: remove slug
state, knownFields entry, input, dirty-check predicate, and
disabled-predicate. Submit body becomes { title }."
```

---

## Task 11: Frontend — drop slug from `SequenceAccordion` item-create form

**Files:**
- Modify: `frontend/src/components/editor/SequenceAccordion.svelte` — item-create form.

- [ ] **Step 1: Survey slug references**

```bash
grep -n "newSlug\|knownFields.*slug\|'slug'\|\"slug\"" /Users/svkucheryavski/Documents/Developing/mathion/frontend/src/components/editor/SequenceAccordion.svelte
```

- [ ] **Step 2: Apply removals**

In `SequenceAccordion.svelte`:

- Delete `let newSlug = $state('');` (around line 192).
- In the `isDirty` getter (around line 213), drop the `newSlug.trim() !== '' ||` clause.
- In the reset block (around line 240), drop `newSlug = '';`.
- In the submit guard (around line 259), drop `&& !newSlug.trim()`.
- In the API-body builder (around line 264), drop `slug: newSlug`:
  ```typescript
  const body: Record<string, unknown> = { title: newTitle, type: newType };
  ```
- In the type-specific `knownFields` arrays (around lines 278-279), drop `'slug'` from both:
  ```typescript
  const knownFields = newType === 'static_page'
    ? ['title', 'content_md', 'type']
    : ['title', 'video_url', 'type'];
  ```
- In the template (around lines 345-346), DELETE the slug `<input>` and its `field-err` `<small>`.
- In the Create button's `disabled` predicate (around line 360), drop `!newSlug.trim()`.

- [ ] **Step 3: Run svelte-check + tests**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && \
  npm run check 2>&1 | tail -10 && npx vitest run 2>&1 | tail -10
```

Expected: 0 errors, all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/editor/SequenceAccordion.svelte
git commit -m "feat(frontend): SequenceAccordion item-create — drop slug input

Same shape as the previous two create-form changes. knownFields drops
'slug' from both the static_page and video variants (the only two
types the create picker currently exposes). Submit body for each type
becomes { title, type, ... } (content_md or video_url depending on
type)."
```

---

## Task 12: Final verification

**Files:** (no edits — verification only.)

- [ ] **Step 1: Run backend tests in full**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && \
  .venv/bin/pytest tests/ 2>&1 | tail -25
```

Expected: ALL PASS, including the new `test_slugify.py` and the new auto-slug-specific cases in `test_blocks.py` and `test_items.py`.

- [ ] **Step 2: Run svelte-check**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && \
  npm run check 2>&1 | tail -10
```

Expected: 0 errors. Pre-existing warnings (a11y, `state_referenced_locally` on the accordion components) carry over from the editor-accordion branch; not introduced by this work.

- [ ] **Step 3: Run vitest in full**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && \
  npx vitest run 2>&1 | tail -15
```

Expected: ALL test files green; the existing 171 tests + any new ones from Task 8.

- [ ] **Step 4: Manual smoke pass against the running dev environment**

Start backend + frontend (`backend/.venv/bin/uvicorn mathion.main:app --reload` and `cd frontend && npm run dev`). Log in as a course admin. In the editor:

1. **Create a block** with title `"Confidence intervals (part 1)"` → block shows slug `confidence-intervals-part-1` in its accordion header. ✓
2. **Create a block** with title `"Привет"` (Cyrillic only) → inline 422 error on the title input: "Title must contain at least one Latin letter or digit". ✓
3. **Create two blocks** with titles `"Foo Bar"` and `"Foo-Bar"` (same slug) → second one's submit returns 409 inline on title: "A block with the same auto-generated slug already exists in this version — choose a different title." ✓
4. **Rename a block** from `"Foo Bar"` to `"Renamed"` → block's slug in the header changes to `renamed`. ✓
5. **Edit a block's info** without changing title → block's slug stays the same. ✓
6. Repeat the rename / collision / cyrillic / info-only flow at the sequence level (in BlockAccordion's create-sequence) and item level (in SequenceAccordion's create-item).

- [ ] **Step 5: Confirm clean working tree and accurate commit log**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion status --short && \
git -C /Users/svkucheryavski/Documents/Developing/mathion log --oneline main..HEAD
```

Expected: clean tree; 11 commits from Tasks 1-11 visible on the `backend-auto-slug-from-title` branch (Task 12 is verification-only and does not produce a commit; fixup commits may appear if review found issues).

---

## Notes for the implementer

- **Test fixtures.** `admin_client` is a `TestClient` configured with an admin-authenticated session (see `backend/tests/conftest.py`). `db` is a SQLAlchemy session bound to the test DB. Both are standard project fixtures — don't introduce new ones.
- **`.venv` requirement.** All pytest invocations must go through `backend/.venv/bin/pytest`. Bare `pytest` will pick up the wrong Python and the wrong dependencies.
- **Frontend dev server.** Not required for the implementation tasks, only for the Task 12 smoke pass. svelte-check + vitest are sufficient for code-level verification.
- **Schema sweep convention.** When dropping `"slug": "..."` from a test payload, drop the comma too if it was internal to the dict literal. Keep the rest of the payload intact.
- **Endpoint error-detail shape.** The `detail` arg to `HTTPException` for 422 is a list of dicts shaped `[{"loc": [...], "msg": "...", "type": "..."}]`. Tests assert against this list via `resp.json()["detail"]`. For 409, detail is a plain string and tests assert against `resp.json()["detail"]`.
- **Order of slug check vs. count limit.** In create endpoints, the spec puts slug derivation *after* the max-count check (which would 409 before any 422 slug error). This matters for tests — a 9th block-create with `title="!!!"` returns 409 ("Maximum 8 blocks") before the empty-slug 422 ever fires. Don't write tests that assume the reverse.
