# Phase 9-C — `helpers.py` God-Module Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 686-line `backend/mathion/api/helpers.py` god-module (28 functions + 2 public constants + 1 private) into six focused, feature-named modules and delete `helpers.py`, changing only each function's home module and the import sites — no behavior change.

**Architecture:** Strangler refactor. Six extraction tasks each create a new module, **move** its functions verbatim, and replace the definitions in `helpers.py` with a re-export (`from mathion.api.M import <moved names>`) so `helpers.py`'s public surface stays byte-identical and all 36 importers keep working untouched. Two final tasks then repoint every importer to the specific new module(s) and delete `helpers.py`. The only new load-time `api→api` edge is `authz → lookups` (for `require_course_admin_for_run`'s call to `get_or_404`), which is acyclic — so `lookups` is extracted before `authz`.

**Tech Stack:** Python 3, FastAPI, SQLAlchemy 2.0, psycopg3, PostgreSQL 17, pytest. No new dependencies, no Alembic migration, no new tooling.

**Reference spec (converged, do not re-litigate):** `docs/superpowers/specs/2026-07-24-phase9-c-helpers-split-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Pure, behavior-preserving move.** Every moved function keeps its exact signature, body, and docstring. The **only** non-verbatim edit to moved code is dropping two stale `(helpers.py:NNN)` docstring citations in Task 5 (spelled out there). No function is renamed; no logic, status code, or message changes.
- **New modules must NOT add `from __future__ import annotations`.** `helpers.py` has none, so annotations (`db: Session`, `type[Base]`, `dt: datetime | None`) evaluate at module load. Matching this is load-bearing: it keeps every module-level import that an annotation references genuinely required, so a forgotten one reds at collection time. Carry the load-time imports listed in each task.
- **Preserve import PLACEMENT verbatim.** Functions that import models / sibling `api` modules inside their bodies keep those imports inside their bodies (they dodge load-time cycles). Do not hoist them to module level. Do not convert the one module-level model import (`roster_ops`, Task 4) into a body import.
- **Preserve import LOCATION when repointing.** A `from mathion.api.helpers import …` at module top becomes module-top per-module lines; the 7 sites that import inside a function body stay inside that function body.
- **Tooling:** always invoke pytest via `backend/.venv` (never bare). Run the suite from the `backend/` directory: `cd backend && .venv/bin/pytest -q`.
- **Git:** `git add` only the exact named paths (never `-A` / `.`). Commit trailer, exactly:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Per-task gate:** each task ends with the **full suite green** at the same pass/skip counts as the recorded baseline — no new failures, no new skips. There is no red step (this is a move, not new behavior); green after the move is the regression net.

---

## File Structure

New modules, all under `backend/mathion/api/`:

| Module | Functions moved (verbatim) | Public constants |
|---|---|---|
| `text_utils.py` | `slugify`, `bump_content_updated_at`, `to_utc_aware` | (private `_NON_SLUG`) |
| `lookups.py` | `get_or_404`, `get_or_create_user`, `get_newest_published_version` | `INT4_MAX` |
| `authz.py` | `require_course_admin`, `require_course_admin_for_run`, `require_run_admin_or_teacher`, `is_run_admin_or_teacher`, `has_run_teacher_on_course`, `has_run_pinned_to_version` | — |
| `roster_ops.py` | `enroll_user_in_run`, `remove_run_student`, `find_student_active_conflicts`, `make_already_active_409_body` | `STUDENT_ALREADY_ACTIVE_ERROR_CODE` |
| `asset_render.py` | `render_with_assets`, `sync_asset_references`, `sync_script_reference`, `render_with_run_assets`, `sync_run_asset_references` | — |
| `submission_files.py` | `build_submission_filename`, `build_feedback_filename`, `submission_storage_dir`, `run_asset_storage_dir`, `mini_project_visible_to_student`, `get_submitter_group`, `has_submissions` | — |

Deleted at the end: `backend/mathion/api/helpers.py`.

**Name → module map (used by the repoint tasks 7–8):**

| Name | Module | | Name | Module |
|---|---|---|---|---|
| `slugify` | `text_utils` | | `enroll_user_in_run` | `roster_ops` |
| `bump_content_updated_at` | `text_utils` | | `remove_run_student` | `roster_ops` |
| `to_utc_aware` | `text_utils` | | `find_student_active_conflicts` | `roster_ops` |
| `get_or_404` | `lookups` | | `make_already_active_409_body` | `roster_ops` |
| `get_or_create_user` | `lookups` | | `STUDENT_ALREADY_ACTIVE_ERROR_CODE` | `roster_ops` |
| `get_newest_published_version` | `lookups` | | `render_with_assets` | `asset_render` |
| `INT4_MAX` | `lookups` | | `sync_asset_references` | `asset_render` |
| `require_course_admin` | `authz` | | `sync_script_reference` | `asset_render` |
| `require_course_admin_for_run` | `authz` | | `render_with_run_assets` | `asset_render` |
| `require_run_admin_or_teacher` | `authz` | | `sync_run_asset_references` | `asset_render` |
| `is_run_admin_or_teacher` | `authz` | | `build_submission_filename` | `submission_files` |
| `has_run_teacher_on_course` | `authz` | | `build_feedback_filename` | `submission_files` |
| `has_run_pinned_to_version` | `authz` | | `submission_storage_dir` | `submission_files` |
| | | | `run_asset_storage_dir` | `submission_files` |
| | | | `mini_project_visible_to_student` | `submission_files` |
| | | | `get_submitter_group` | `submission_files` |
| | | | `has_submissions` | `submission_files` |

**Extraction reference — pre-refactor `helpers.py` line spans** (orientation only; **locate functions by name** when cutting, because line numbers shift as earlier tasks remove code):

- module import block: 1–17 · `STUDENT_ALREADY_ACTIVE_ERROR_CODE`: 20 · `INT4_MAX` (+ comment): 22–24 · `_NON_SLUG`: 27
- `slugify`: 30–35 · `bump_content_updated_at`: 38–40 · `to_utc_aware`: 43–52
- `get_or_404`: 55–60 · `get_or_create_user`: 63–84 · `get_newest_published_version`: 87–99
- `require_course_admin`: 102–114 · `require_course_admin_for_run`: 117–123 · `require_run_admin_or_teacher`: 126–149 · `is_run_admin_or_teacher`: 152–173
- `enroll_user_in_run`: 176–230 · `remove_run_student`: 233–277
- `has_submissions`: 280–295
- `render_with_assets`: 298–331 · `sync_asset_references`: 334–381 · `sync_script_reference`: 384–455
- `build_submission_filename`: 458–466 · `build_feedback_filename`: 469–472 · `submission_storage_dir`: 475–481 · `run_asset_storage_dir`: 484–490 · `mini_project_visible_to_student`: 493–500 · `get_submitter_group`: 503–515
- `render_with_run_assets`: 518–556 · `sync_run_asset_references`: 559–591
- `has_run_teacher_on_course`: 594–615 · `has_run_pinned_to_version`: 618–638
- `find_student_active_conflicts`: 641–665 · `make_already_active_409_body`: 668–686

**Shared shim rule for extraction tasks 1–6:** when you move functions out of `helpers.py`, cut their full `def … : … ` (and the named constants), then add a **single** re-export line per module. Group the re-export lines together, immediately **below** `helpers.py`'s top-of-file import block (the `if TYPE_CHECKING:` block ends at line 17). **Do NOT edit `helpers.py`'s import block** — leftover unused imports there are harmless during the strangler and vanish when `helpers.py` is deleted in Task 8. `helpers.py` never internally calls any of these functions after a task removes them, so re-export placement is not load-order-sensitive.

---

### Task 1: Extract `text_utils.py`

**Files:**
- Create: `backend/mathion/api/text_utils.py`
- Modify: `backend/mathion/api/helpers.py` (cut `_NON_SLUG`, `slugify`, `bump_content_updated_at`, `to_utc_aware`; add one re-export line)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `mathion.api.text_utils` exporting `slugify`, `bump_content_updated_at`, `to_utc_aware` (identical signatures). `_NON_SLUG` is private and not exported.

- [ ] **Step 1: Record the green baseline**

Run: `cd backend && .venv/bin/pytest -q`
Expected: all pass (≈1160 passed / 1 skipped). Note the exact `N passed / M skipped` line — every later task must match it.

- [ ] **Step 2: Create `backend/mathion/api/text_utils.py`**

Write this exact header, then **move verbatim** (copy the full source unchanged from `helpers.py`) the `_NON_SLUG` assignment and the three functions `slugify`, `bump_content_updated_at`, `to_utc_aware`, in that order:

```python
import re
from datetime import datetime, timezone
```

Do **not** add `from __future__ import annotations`. `_NON_SLUG = re.compile(r"[^a-z0-9]+")` goes above `slugify`.

- [ ] **Step 3: Update `helpers.py`**

Delete `_NON_SLUG`, `slugify`, `bump_content_updated_at`, `to_utc_aware` from `helpers.py`. Add (grouped just below the top import block):

```python
from mathion.api.text_utils import bump_content_updated_at, slugify, to_utc_aware
```

Do not touch `helpers.py`'s import block.

- [ ] **Step 4: Run the full suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: identical pass/skip counts to Step 1. (Any missing import/name reds collection or a test.)

- [ ] **Step 5: Commit**

```bash
git add backend/mathion/api/text_utils.py backend/mathion/api/helpers.py
git commit -m "refactor(api): extract text_utils from helpers (strangler step 1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Extract `lookups.py`

**Files:**
- Create: `backend/mathion/api/lookups.py`
- Modify: `backend/mathion/api/helpers.py` (cut `INT4_MAX`, `get_or_404`, `get_or_create_user`, `get_newest_published_version`; add one re-export line)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `mathion.api.lookups` exporting `get_or_404`, `get_or_create_user`, `get_newest_published_version`, and the constant `INT4_MAX`. **Must import no `mathion.api` module at load time** (Task 3's `authz` depends on this to stay acyclic).

- [ ] **Step 1: Create `backend/mathion/api/lookups.py`**

Write this exact header, then move verbatim the `INT4_MAX` constant (with its two-line comment) and the three functions `get_or_404`, `get_or_create_user`, `get_newest_published_version`. Keep each function's body imports (`from mathion.models_auth import User` in `get_or_create_user`; `from mathion.models import CourseVersion` in `get_newest_published_version`) inside their bodies, unchanged:

```python
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.database import Base
```

Place `INT4_MAX` (with its comment) above the functions.

- [ ] **Step 2: Update `helpers.py`**

Delete `INT4_MAX` (and its comment), `get_or_404`, `get_or_create_user`, `get_newest_published_version`. Add:

```python
from mathion.api.lookups import INT4_MAX, get_newest_published_version, get_or_404, get_or_create_user
```

- [ ] **Step 3: Run the full suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: identical pass/skip counts to the baseline.

- [ ] **Step 4: Commit**

```bash
git add backend/mathion/api/lookups.py backend/mathion/api/helpers.py
git commit -m "refactor(api): extract lookups from helpers (strangler step 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Extract `authz.py`

**Files:**
- Create: `backend/mathion/api/authz.py`
- Modify: `backend/mathion/api/helpers.py` (cut the six authz functions; add one re-export line)

**Interfaces:**
- Consumes: `mathion.api.lookups.get_or_404` (Task 2) — imported at **module level** (this is the one new load-time `api→api` edge; it is why `lookups` precedes `authz`). If `lookups.py` did not exist, this import would raise `ModuleNotFoundError`.
- Produces: `mathion.api.authz` exporting `require_course_admin`, `require_course_admin_for_run`, `require_run_admin_or_teacher`, `is_run_admin_or_teacher`, `has_run_teacher_on_course`, `has_run_pinned_to_version`.

- [ ] **Step 1: Create `backend/mathion/api/authz.py`**

Write this exact header, then move verbatim the six functions `require_course_admin`, `require_course_admin_for_run`, `require_run_admin_or_teacher`, `is_run_admin_or_teacher`, `has_run_teacher_on_course`, `has_run_pinned_to_version`. Keep every body import (`CourseAdmin`, `CourseVersion`, `RunTeacher`, `exists`, and `require_course_admin_for_run`'s `from mathion.models import CourseVersion`) inside its function body. `require_course_admin_for_run` calls `get_or_404` (now resolved from the module-level import below) and `require_course_admin` (same module) — both stay as bare-name calls, verbatim:

```python
from typing import TYPE_CHECKING

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.api.lookups import get_or_404

if TYPE_CHECKING:
    from mathion.models_auth import User
```

- [ ] **Step 2: Update `helpers.py`**

Delete the six authz functions. Add:

```python
from mathion.api.authz import has_run_pinned_to_version, has_run_teacher_on_course, is_run_admin_or_teacher, require_course_admin, require_course_admin_for_run, require_run_admin_or_teacher
```

- [ ] **Step 3: Run the full suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: identical pass/skip counts to the baseline.

- [ ] **Step 4: Commit**

```bash
git add backend/mathion/api/authz.py backend/mathion/api/helpers.py
git commit -m "refactor(api): extract authz from helpers (strangler step 3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Extract `roster_ops.py`

**Files:**
- Create: `backend/mathion/api/roster_ops.py`
- Modify: `backend/mathion/api/helpers.py` (cut `STUDENT_ALREADY_ACTIVE_ERROR_CODE` and the four roster functions; add one re-export line)

**Interfaces:**
- Consumes: nothing from earlier tasks (its cross-module reach — `enrollment._enroll_user`, `advisory` — is via **body** imports, preserved verbatim).
- Produces: `mathion.api.roster_ops` exporting `enroll_user_in_run`, `remove_run_student`, `find_student_active_conflicts`, `make_already_active_409_body`, and the constant `STUDENT_ALREADY_ACTIVE_ERROR_CODE`.

- [ ] **Step 1: Create `backend/mathion/api/roster_ops.py`**

Write this exact header, then move verbatim the constant `STUDENT_ALREADY_ACTIVE_ERROR_CODE` and the four functions `enroll_user_in_run`, `remove_run_student`, `find_student_active_conflicts`, `make_already_active_409_body`. **The module-level `from mathion.models import CourseVersion, Run, RunStudent` is required** — `find_student_active_conflicts` reads those names as module-level (it has no body import of them). Keep every body import inside its function (`enroll_user_in_run`: `func`, `advisory`, `_enroll_user`, `CourseVersion, RunStudent`, `NotificationLogEntry`; `remove_run_student`: `CourseVersion, Run, RunStudent`, `StudentEnrollment`) — these body imports legitimately shadow the module-level names within their own scope; do not remove or hoist them:

```python
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.models import CourseVersion, Run, RunStudent
```

Place `STUDENT_ALREADY_ACTIVE_ERROR_CODE = "student_already_active_in_course"` above the functions.

- [ ] **Step 2: Update `helpers.py`**

Delete `STUDENT_ALREADY_ACTIVE_ERROR_CODE` and the four roster functions. Add:

```python
from mathion.api.roster_ops import STUDENT_ALREADY_ACTIVE_ERROR_CODE, enroll_user_in_run, find_student_active_conflicts, make_already_active_409_body, remove_run_student
```

- [ ] **Step 3: Run the full suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: identical pass/skip counts to the baseline.

- [ ] **Step 4: Commit**

```bash
git add backend/mathion/api/roster_ops.py backend/mathion/api/helpers.py
git commit -m "refactor(api): extract roster_ops from helpers (strangler step 4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Extract `asset_render.py`

**Files:**
- Create: `backend/mathion/api/asset_render.py`
- Modify: `backend/mathion/api/helpers.py` (cut the five asset-render functions; add one re-export line)

**Interfaces:**
- Consumes: nothing from earlier tasks (`sync_script_reference` reaches `assets._asset_dir` via a **body** import, preserved verbatim).
- Produces: `mathion.api.asset_render` exporting `render_with_assets`, `sync_asset_references`, `sync_script_reference`, `render_with_run_assets`, `sync_run_asset_references`.

- [ ] **Step 1: Create `backend/mathion/api/asset_render.py`**

Write this exact header, then move verbatim the five functions `render_with_assets`, `sync_asset_references`, `sync_script_reference`, `render_with_run_assets`, `sync_run_asset_references`. Keep every body import inside its function (`extract_asset_filenames`/`render_markdown`/`resolve_asset_urls`, `sa_delete`, `func`, `_asset_dir`, `Asset`, `AssetReference`, `RunAsset`, `RunAssetReference`):

```python
import os

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
```

- [ ] **Step 2: Apply the two docstring carve-outs (the ONLY non-verbatim edit in this plan)**

In the moved `render_with_run_assets` docstring, drop the stale `(helpers.py:179)` citation and its single preceding space:

- Before: `    Mirrors \`render_with_assets\` (helpers.py:179) but resolves filenames`
- After:  `    Mirrors \`render_with_assets\` but resolves filenames`

In the moved `sync_run_asset_references` docstring, drop the stale `(helpers.py:215)` citation and its single preceding space:

- Before: `    Mirrors \`sync_asset_references\` (helpers.py:215): deletes all`
- After:  `    Mirrors \`sync_asset_references\`: deletes all`

**Leave every other reference untouched** — in particular the co-located `# resolve_asset_urls (markdown.py:71) style` comment inside `render_with_run_assets` stays (that file is not deleted).

- [ ] **Step 3: Update `helpers.py`**

Delete the five asset-render functions. Add:

```python
from mathion.api.asset_render import render_with_assets, render_with_run_assets, sync_asset_references, sync_run_asset_references, sync_script_reference
```

- [ ] **Step 4: Run the full suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: identical pass/skip counts to the baseline.

- [ ] **Step 5: Commit**

```bash
git add backend/mathion/api/asset_render.py backend/mathion/api/helpers.py
git commit -m "refactor(api): extract asset_render from helpers (strangler step 5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Extract `submission_files.py`

**Files:**
- Create: `backend/mathion/api/submission_files.py`
- Modify: `backend/mathion/api/helpers.py` (cut the seven submission/file functions; add one re-export line — after this, `helpers.py` is a pure re-export shim)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `mathion.api.submission_files` exporting `build_submission_filename`, `build_feedback_filename`, `submission_storage_dir`, `run_asset_storage_dir`, `mini_project_visible_to_student`, `get_submitter_group`, `has_submissions`.

- [ ] **Step 1: Create `backend/mathion/api/submission_files.py`**

Write this exact header, then move verbatim the seven functions `build_submission_filename`, `build_feedback_filename`, `submission_storage_dir`, `run_asset_storage_dir`, `mini_project_visible_to_student`, `get_submitter_group`, `has_submissions`. Keep body imports inside their functions (`has_submissions`: `exists`, `MiniProject, Submission`; `get_submitter_group`: `Group, RunStudent`). None of these seven raises `HTTPException`, so it is correctly absent from the header:

```python
import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.assets import sanitize_filename
from mathion.config import settings
```

- [ ] **Step 2: Update `helpers.py`**

Delete the seven functions. Add:

```python
from mathion.api.submission_files import build_feedback_filename, build_submission_filename, get_submitter_group, has_submissions, mini_project_visible_to_student, run_asset_storage_dir, submission_storage_dir
```

`helpers.py` is now only its (partly-unused) import block + six re-export lines. That is expected.

- [ ] **Step 3: Run the full suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: identical pass/skip counts to the baseline.

- [ ] **Step 4: Commit**

```bash
git add backend/mathion/api/submission_files.py backend/mathion/api/helpers.py
git commit -m "refactor(api): extract submission_files from helpers; helpers now a shim (strangler step 6)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Repoint production + script importers

**Files (modify — import lines only):** all 21 production `api/` modules that import from `helpers`, plus the seed script. `helpers.py` stays a re-export shim after this task (tests still import it).

**Interfaces:**
- Consumes: all six new modules (Tasks 1–6).
- Produces: no production/script file imports `mathion.api.helpers` any more (tests still do, until Task 8).

**Rule:** in each file, replace the single `from mathion.api.helpers import …` statement with the per-module lines below. **Preserve the import's location** — all sites in this task are module-level except `content.py:109` and `version_clone.py:107`, which stay **inside their function bodies** (indent the replacement lines to match). Do not reorder surrounding imports.

- [ ] **Step 1: Repoint each production module + the seed script**

`backend/mathion/api/assets.py` (module level):
```python
from mathion.api.lookups import get_or_404
from mathion.api.authz import has_run_pinned_to_version, require_course_admin
```
`backend/mathion/api/blocks.py` (module level):
```python
from mathion.api.text_utils import slugify
from mathion.api.lookups import INT4_MAX, get_or_404
from mathion.api.authz import has_run_pinned_to_version, require_course_admin
```
`backend/mathion/api/content.py:109` (inside `get_admin_tree()` body — keep indented):
```python
from mathion.api.authz import require_course_admin
```
`backend/mathion/api/courses.py` (module level):
```python
from mathion.api.lookups import get_or_404
from mathion.api.authz import has_run_teacher_on_course, require_course_admin
```
`backend/mathion/api/dashboard.py` (module level):
```python
from mathion.api.lookups import get_or_404
from mathion.api.authz import require_run_admin_or_teacher
```
`backend/mathion/api/enrollment.py` (module level):
```python
from mathion.api.lookups import get_newest_published_version, get_or_404, get_or_create_user
from mathion.api.authz import require_course_admin
```
`backend/mathion/api/evaluations.py` (module level):
```python
from mathion.api.lookups import get_or_404
from mathion.api.authz import is_run_admin_or_teacher
from mathion.api.submission_files import build_feedback_filename, get_submitter_group, mini_project_visible_to_student, submission_storage_dir
```
`backend/mathion/api/groups.py` (module level):
```python
from mathion.api.lookups import get_or_404
from mathion.api.authz import require_run_admin_or_teacher
```
`backend/mathion/api/items.py` (module level):
```python
from mathion.api.text_utils import bump_content_updated_at, slugify
from mathion.api.lookups import INT4_MAX, get_or_404
from mathion.api.authz import require_course_admin
from mathion.api.asset_render import render_with_assets, sync_asset_references, sync_script_reference
```
`backend/mathion/api/mini_projects.py` (module level):
```python
from mathion.api.text_utils import to_utc_aware
from mathion.api.lookups import get_or_404
from mathion.api.authz import is_run_admin_or_teacher, require_course_admin, require_run_admin_or_teacher
from mathion.api.asset_render import render_with_run_assets, sync_run_asset_references
from mathion.api.submission_files import mini_project_visible_to_student, submission_storage_dir
```
`backend/mathion/api/questions.py` (module level):
```python
from mathion.api.text_utils import bump_content_updated_at
from mathion.api.lookups import INT4_MAX, get_or_404
from mathion.api.authz import require_course_admin
from mathion.api.asset_render import render_with_assets, sync_asset_references
```
`backend/mathion/api/quiz.py` (module level):
```python
from mathion.api.lookups import get_or_404
```
`backend/mathion/api/run_assets.py` (module level):
```python
from mathion.api.lookups import get_or_404
from mathion.api.authz import require_course_admin_for_run, require_run_admin_or_teacher
from mathion.api.asset_render import render_with_run_assets
from mathion.api.submission_files import run_asset_storage_dir
```
`backend/mathion/api/run_roster.py` (module level):
```python
from mathion.api.lookups import get_or_404, get_or_create_user
from mathion.api.authz import require_run_admin_or_teacher
from mathion.api.roster_ops import STUDENT_ALREADY_ACTIVE_ERROR_CODE, enroll_user_in_run, find_student_active_conflicts, make_already_active_409_body, remove_run_student
```
`backend/mathion/api/run_teachers.py` (module level):
```python
from mathion.api.lookups import get_or_404, get_or_create_user
from mathion.api.authz import require_course_admin_for_run, require_run_admin_or_teacher
```
`backend/mathion/api/runs.py` (module level):
```python
from mathion.api.lookups import get_newest_published_version, get_or_404
from mathion.api.authz import require_course_admin, require_course_admin_for_run, require_run_admin_or_teacher
from mathion.api.roster_ops import find_student_active_conflicts, make_already_active_409_body
from mathion.api.submission_files import has_submissions
```
`backend/mathion/api/student.py` (module level):
```python
from mathion.api.lookups import get_or_404
```
`backend/mathion/api/student_mini_projects.py` (module level):
```python
from mathion.api.text_utils import to_utc_aware
from mathion.api.submission_files import get_submitter_group, mini_project_visible_to_student
```
`backend/mathion/api/submissions.py` (module level):
```python
from mathion.api.text_utils import to_utc_aware
from mathion.api.lookups import get_or_404
from mathion.api.authz import is_run_admin_or_teacher
from mathion.api.submission_files import build_submission_filename, get_submitter_group, mini_project_visible_to_student, submission_storage_dir
```
`backend/mathion/api/version_clone.py:107` (inside `clone_version_content()` body — keep indented):
```python
from mathion.api.asset_render import render_with_assets, sync_asset_references, sync_script_reference
```
`backend/mathion/api/versions.py` (module level):
```python
from mathion.api.text_utils import bump_content_updated_at
from mathion.api.lookups import get_or_404
from mathion.api.authz import has_run_teacher_on_course, require_course_admin
from mathion.api.asset_render import render_with_assets, sync_asset_references
```
`backend/scripts/seed_teaching_dashboards_smoke.py` (module level):
```python
from mathion.api.submission_files import build_feedback_filename, build_submission_filename, submission_storage_dir
```

- [ ] **Step 2: Run the full suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: identical pass/skip counts to the baseline. (`helpers.py` still exists as a shim, so any test still importing it works.)

- [ ] **Step 3: Import-check the seed script (not covered by pytest)**

Run: `cd backend && .venv/bin/python -c "import scripts.seed_teaching_dashboards_smoke"`
Expected: exit 0, no output.

- [ ] **Step 4: Commit**

```bash
git add backend/mathion/api/assets.py backend/mathion/api/blocks.py backend/mathion/api/content.py backend/mathion/api/courses.py backend/mathion/api/dashboard.py backend/mathion/api/enrollment.py backend/mathion/api/evaluations.py backend/mathion/api/groups.py backend/mathion/api/items.py backend/mathion/api/mini_projects.py backend/mathion/api/questions.py backend/mathion/api/quiz.py backend/mathion/api/run_assets.py backend/mathion/api/run_roster.py backend/mathion/api/run_teachers.py backend/mathion/api/runs.py backend/mathion/api/student.py backend/mathion/api/student_mini_projects.py backend/mathion/api/submissions.py backend/mathion/api/version_clone.py backend/mathion/api/versions.py backend/scripts/seed_teaching_dashboards_smoke.py
git commit -m "refactor(api): repoint production + script importers off helpers (strangler step 7)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Repoint test importers, delete `helpers.py`

**Files (modify — import lines only):** the 14 test modules that import from `helpers` (16 statements; 5 of them inside function bodies). **Delete:** `backend/mathion/api/helpers.py`.

**Interfaces:**
- Consumes: all six new modules.
- Produces: `helpers.py` no longer exists; zero references to `mathion.api.helpers` remain in `backend/`.

**Rule:** same as Task 7 — replace each `from mathion.api.helpers import …` with the per-module lines below, preserving location. Body-import sites (`test_run_assets.py:351`, `test_run_assets.py:398`, `test_run_roster.py:285`, `test_run_roster.py:295`, `test_version_clone.py:137`) stay indented inside their test-function bodies.

- [ ] **Step 1: Repoint each test module**

`backend/tests/test_active_constraint_helpers.py` (module level):
```python
from mathion.api.roster_ops import STUDENT_ALREADY_ACTIVE_ERROR_CODE, find_student_active_conflicts, make_already_active_409_body
```
`backend/tests/test_concurrency_batch.py` (module level):
```python
from mathion.api.roster_ops import enroll_user_in_run
```
`backend/tests/test_concurrency_capacity.py` (module level):
```python
from mathion.api.roster_ops import enroll_user_in_run
```
`backend/tests/test_concurrency_enrollment.py` (module level):
```python
from mathion.api.lookups import get_newest_published_version, get_or_404, get_or_create_user
from mathion.api.authz import require_course_admin
from mathion.api.roster_ops import enroll_user_in_run, find_student_active_conflicts
```
`backend/tests/test_concurrency_foundations.py` (module level):
```python
from mathion.api.lookups import get_or_create_user
```
`backend/tests/test_concurrency_mini_project.py` (module level):
```python
from mathion.api.text_utils import to_utc_aware
from mathion.api.submission_files import submission_storage_dir
```
`backend/tests/test_concurrency_submission.py` (module level):
```python
from mathion.api.text_utils import to_utc_aware
from mathion.api.submission_files import submission_storage_dir
```
`backend/tests/test_notifications_triggers.py` (module level):
```python
from mathion.api.roster_ops import enroll_user_in_run
```
`backend/tests/test_run_assets.py:351` (inside `test_put_replace_404_on_missing_asset_no_orphan_temp()` body — keep indented):
```python
from mathion.api.submission_files import run_asset_storage_dir
```
`backend/tests/test_run_assets.py:398` (inside `test_put_replace_404_on_cross_run_asset_id()` body — keep indented):
```python
from mathion.api.submission_files import run_asset_storage_dir
```
`backend/tests/test_run_permissions.py` (module level):
```python
from mathion.api.authz import is_run_admin_or_teacher, require_run_admin_or_teacher
```
`backend/tests/test_run_roster.py:285` (inside `test_remove_run_student_helper_returns_false_for_unknown_user()` body — keep indented):
```python
from mathion.api.roster_ops import remove_run_student
```
`backend/tests/test_run_roster.py:295` (inside `test_remove_run_student_helper_deletes_and_returns_true()` body — keep indented):
```python
from mathion.api.roster_ops import remove_run_student
```
`backend/tests/test_slugify.py` (module level):
```python
from mathion.api.text_utils import slugify
```
`backend/tests/test_teaching.py` (module level):
```python
from mathion.api.authz import has_run_pinned_to_version, has_run_teacher_on_course
```
`backend/tests/test_version_clone.py:137` (inside `_build_full_source()` body — keep indented):
```python
from mathion.api.asset_render import sync_script_reference
```

- [ ] **Step 2: Delete the shim**

Run: `git rm backend/mathion/api/helpers.py`

- [ ] **Step 3: Grep-confirm zero residual references (escaped dot; whole `backend/` tree)**

Run: `cd backend && grep -rnE --include='*.py' --exclude-dir=.venv 'mathion\.api\.helpers|import helpers' . ; echo "exit=$?"`
Expected: `exit=1` (grep found nothing). `--include='*.py'` restricts the search to source, and `--exclude-dir=.venv` keeps the virtualenv's site-packages out — together they prevent false positives on unrelated third-party code and on the non-`.py` `mathion.egg-info/SOURCES.txt` (whose `mathion/api/helpers.py` path the escaped `\.` would not match anyway). The two alternatives cover every import form: `mathion\.api\.helpers` matches `from mathion.api.helpers import …` and `import mathion.api.helpers`; `import helpers` matches `from mathion.api import helpers`. The knowingly-retained stale `helpers.py:NNN` comments in `run_assets.py:359/362` and `test_dashboard_item_drilldown.py:91/92` contain neither pattern, so they do not match.

- [ ] **Step 4: Run the full suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: identical pass/skip counts to the baseline.

- [ ] **Step 5: Import-check the seed script again (post-deletion)**

Run: `cd backend && .venv/bin/python -c "import scripts.seed_teaching_dashboards_smoke"`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/test_active_constraint_helpers.py backend/tests/test_concurrency_batch.py backend/tests/test_concurrency_capacity.py backend/tests/test_concurrency_enrollment.py backend/tests/test_concurrency_foundations.py backend/tests/test_concurrency_mini_project.py backend/tests/test_concurrency_submission.py backend/tests/test_notifications_triggers.py backend/tests/test_run_assets.py backend/tests/test_run_permissions.py backend/tests/test_run_roster.py backend/tests/test_slugify.py backend/tests/test_teaching.py backend/tests/test_version_clone.py backend/mathion/api/helpers.py
git commit -m "refactor(api): repoint tests + delete helpers.py god-module (strangler step 8)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Success Criteria

- `backend/mathion/api/helpers.py` no longer exists; the six modules exist with the exact function/constant assignment in the File Structure table.
- Zero references to `mathion.api.helpers` remain in `backend/` source (Task 8 Step 3 grep exits 1; the escaped dot excludes the `SOURCES.txt` path).
- No function's behavior, signature, or message changed. Within the six new modules the only non-verbatim edit is the two dropped `(helpers.py:NNN)` docstring citations (Task 5).
- Full suite green at the recorded baseline (≈1160 passed / 1 skipped) after every task and on the final result; the seed script import-checks clean.
- No Alembic migration; no non-import changes to any file outside the six new modules and `helpers.py`.
