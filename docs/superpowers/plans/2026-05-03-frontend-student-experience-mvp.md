# Frontend Student Experience MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Svelte 5 frontend that lets a student log in via email + PIN, browse assigned courses, open a course (vertical block tree), navigate a sequence (top-icon strip player), and complete static-page / video / quiz items — backed by the existing FastAPI backend served via SPA static mount.

**Architecture:** Plain Svelte 5 + Vite + TypeScript (no SvelteKit). Hand-rolled History-API router. Per-page data fetching via three reactive stores (`session`, `currentCourse`, `toasts`). `lib/events.ts` (plain `.ts`, single-slot pre-wire buffer) breaks the api↔auth↔router cycle. SPA served by FastAPI `StaticFiles(html=True)` mount, registered after `/health` and after an explicit `/api/{rest:path}` 404 catch-all.

**Tech Stack:** Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`), TypeScript (strict), Vite, vitest + jsdom (devDeps only — nothing else ships to the browser); FastAPI / SQLAlchemy / Alembic on the backend.

**Spec:** `docs/superpowers/specs/2026-05-03-frontend-student-experience-design.md` (commit `6b71c30`).

**Worktree:** Implementer should run `superpowers:using-git-worktrees` to set up an isolated workspace on a feature branch (`feature/frontend-student-mvp`) before starting Task 1.

---

## Scope check

The slice is one coherent unit (chosen during brainstorming). Backend additions A1+A2 (§10 of spec) are tightly coupled to this slice: A1 serves the SPA, A2 supplies `info_html` that `BlockGroup` reads. They ship together. Each task below leaves the project green (tests pass, no broken imports) and produces a committed unit.

---

## File structure

### Backend additions

| File | Responsibility |
|---|---|
| `backend/mathion/config.py` | Add `frontend_dist` absolute-path setting |
| `backend/mathion/main.py` | `/api/{rest:path}` 404 guard + conditional SPA mount; `/health` declared before mount |
| `backend/mathion/models.py` (line ~68) | Add `Block.info_html` column |
| `backend/mathion/schemas.py` (line ~55) | `BlockResponse.info_html: str = ""` |
| `backend/mathion/api/blocks.py` (lines 53, 95-96) | Render `info_html` from `info` on create + update |
| `backend/mathion/api/content.py` (~lines 77-99) | Include `info_html` in block dict |
| `backend/alembic/versions/<rev>_add_block_info_html.py` | Add column + backfill from `info` via `render_markdown` |
| `backend/tests/test_blocks.py` (modify) | New tests for `info_html` write-time render |
| `backend/tests/test_main_spa.py` (new) | SPA mount + catch-all + `/health` tests |

### Frontend layout

```
frontend/
├── package.json                         # only "svelte" as runtime dep; dev: vite, typescript, svelte-check, vitest, jsdom
├── vite.config.ts                       # build.assetsDir = "_app"; dev proxy /api → :8000
├── tsconfig.json                        # strict
├── tsconfig.node.json                   # for vite.config.ts
├── svelte.config.js
├── index.html
├── .gitignore                           # node_modules, dist
└── src/
    ├── main.ts                          # boot order: wire events → bootstrap session → mount App
    ├── app.css                          # imports reset.css + base.css
    ├── App.svelte                       # router outlet + Toaster
    ├── routes.ts                        # route table
    ├── lib/
    │   ├── types.ts                     # Pydantic mirrors + assertNever
    │   ├── events.ts                    # plain .ts; pre-wire single-slot buffer
    │   ├── api.ts                       # fetch wrapper; ApiError; Headers set-last
    │   ├── auth.svelte.ts               # bootstrapSession / requestPin / verifyPin / logout
    │   ├── router.svelte.ts             # History API + hashchange + safeNext
    │   ├── coverage.svelte.ts           # createCoverageTracker(itemId, opts)
    │   └── format.ts                    # tiny formatters
    ├── stores/
    │   ├── session.svelte.ts            # { user, loading } + clearSession()
    │   ├── currentCourse.svelte.ts      # in-tab course cache + state
    │   └── toasts.svelte.ts             # toast queue + clearToasts()
    ├── styles/
    │   ├── reset.css
    │   └── base.css
    ├── components/
    │   ├── chrome/
    │   │   ├── Toaster.svelte
    │   │   └── Toast.svelte
    │   ├── ui/
    │   │   ├── Button.svelte
    │   │   ├── Input.svelte
    │   │   ├── FormRow.svelte
    │   │   └── Spinner.svelte
    │   ├── course/
    │   │   ├── CourseCard.svelte
    │   │   ├── BlockGroup.svelte
    │   │   ├── SequenceLink.svelte
    │   │   └── ItemIcon.svelte
    │   └── items/
    │       ├── ItemRouter.svelte
    │       ├── PageItem.svelte
    │       ├── VideoItem.svelte
    │       ├── QuizItem.svelte
    │       ├── UnsupportedItem.svelte
    │       └── quiz/
    │           ├── SingleChoiceQuestion.svelte
    │           ├── MultiChoiceQuestion.svelte
    │           ├── NumericQuestion.svelte
    │           └── TextQuestion.svelte
    ├── pages/
    │   ├── Login.svelte
    │   ├── CourseList.svelte
    │   ├── CourseView.svelte
    │   ├── SequencePlayer.svelte
    │   └── NotFound.svelte
    └── tests/                           # vitest unit tests for lib/* + stores/*
        ├── events.test.ts
        ├── api.test.ts
        ├── router.test.ts
        ├── coverage.test.ts
        ├── session.test.ts
        ├── currentCourse.test.ts
        ├── toasts.test.ts
        └── format.test.ts
```

### Test coverage

- **Backend (pytest):** A1 SPA mount tests, A2 `info_html` tests. Existing 513 tests must still pass.
- **Frontend lib/ + stores/ (vitest):** TDD per spec §11.
- **Components (manual, deferred per spec §11):** No automated tests in V1; pre-design UI rots fast. Manual checklist in Task 24.

---

# Section A — Backend prerequisites

## Task 1: Add `Block.info_html` column + migration

**Files:**
- Modify: `backend/mathion/models.py:68`
- Create: `backend/alembic/versions/<rev>_add_block_info_html.py`

- [ ] **Step 1: Add `info_html` field to `Block` model**

In `backend/mathion/models.py`, immediately after the existing `info` line (line 68) inside `class Block`:

```python
    info: Mapped[str] = mapped_column(Text, nullable=False, default="")
    info_html: Mapped[str] = mapped_column(Text, nullable=False, default="")
```

- [ ] **Step 2: Generate migration revision**

Run: `cd backend && alembic revision -m "add block info_html"`

This creates a new file `alembic/versions/<rev>_add_block_info_html.py`. Note the generated revision ID and the `down_revision` (which should be `e7923a6b08c1` — the latest existing revision).

- [ ] **Step 3: Replace generated migration body**

Open the new migration file. Replace its body with:

```python
"""add block info_html

Revision ID: <keep generated>
Revises: e7923a6b08c1
Create Date: <keep generated>

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '<keep generated>'
down_revision: Union[str, Sequence[str], None] = 'e7923a6b08c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add Block.info_html with backfill from existing info markdown."""
    # Phase 1: add column as nullable so backfill can populate it row-by-row.
    with op.batch_alter_table('blocks') as batch_op:
        batch_op.add_column(sa.Column('info_html', sa.Text(), nullable=True))

    # Phase 2: backfill — render existing info markdown to HTML.
    from mathion.markdown import render_markdown
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, info FROM blocks")).fetchall()
    for row in rows:
        html = render_markdown(row.info or "")
        conn.execute(
            sa.text("UPDATE blocks SET info_html = :h WHERE id = :i"),
            {"h": html, "i": row.id},
        )

    # Phase 3: tighten to NOT NULL with empty-string default.
    with op.batch_alter_table('blocks') as batch_op:
        batch_op.alter_column('info_html', nullable=False, server_default='')


def downgrade() -> None:
    """Drop Block.info_html column."""
    with op.batch_alter_table('blocks') as batch_op:
        batch_op.drop_column('info_html')
```

- [ ] **Step 4: Run migration on test fixture and verify**

Run: `cd backend && alembic upgrade head`
Expected: completes without error.

Run: `cd backend && pytest tests/ -x --tb=short 2>&1 | tail -20`
Expected: full suite still passes (513 tests, 0 failures). Existing tests that construct `Block(...)` directly still work because the new column has `default=""` at the model level.

- [ ] **Step 5: Commit**

```bash
git add backend/mathion/models.py backend/alembic/versions/
git commit -m "feat(blocks): add info_html column + backfill migration"
```

---

## Task 2: Render `info_html` on block create + update + content

**Files:**
- Modify: `backend/mathion/api/blocks.py:5,53,95-96`
- Modify: `backend/mathion/schemas.py:55-62`
- Modify: `backend/mathion/api/content.py` (block serialization, ~lines 77-99)
- Test: `backend/tests/test_blocks.py` (modify)

- [ ] **Step 1: Write the failing test for create**

Add to `backend/tests/test_blocks.py` (at the bottom of the file, alongside other create tests):

```python
def test_create_block_renders_info_html(admin_client):
    from tests.conftest import create_course_with_admin
    course = create_course_with_admin(admin_client)
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={}).json()
    response = admin_client.post(
        f"/api/versions/{version['id']}/blocks",
        json={"title": "B1", "slug": "b1", "info": "Goal **A**"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["info"] == "Goal **A**"
    assert body["info_html"] == "<p>Goal <strong>A</strong></p>\n"


def test_update_block_re_renders_info_html(admin_client):
    from tests.conftest import create_course_with_admin
    course = create_course_with_admin(admin_client)
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={}).json()
    block = admin_client.post(
        f"/api/versions/{version['id']}/blocks",
        json={"title": "B1", "slug": "b1", "info": "old"},
    ).json()
    response = admin_client.patch(
        f"/api/blocks/{block['id']}",
        json={"info": "new **bold**"},
    )
    assert response.status_code == 200
    assert response.json()["info_html"] == "<p>new <strong>bold</strong></p>\n"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_blocks.py::test_create_block_renders_info_html tests/test_blocks.py::test_update_block_re_renders_info_html -v`
Expected: FAIL — `KeyError: 'info_html'` or value is empty string (column exists but write paths don't render it yet).

- [ ] **Step 3: Update `BlockResponse` schema**

In `backend/mathion/schemas.py`, change the `BlockResponse` class (lines 55-62):

```python
class BlockResponse(BaseModel):
    id: int
    version_id: int
    title: str
    slug: str
    order: int
    info: str
    info_html: str = ""
    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Wire create-time render in `blocks.py`**

In `backend/mathion/api/blocks.py`, change the import line (line 6):

```python
from mathion.api.helpers import get_or_404, require_course_admin
from mathion.markdown import render_markdown
```

Then change the create-block call (line 53):

```python
    block = Block(
        version_id=version_id,
        title=data.title,
        slug=data.slug,
        order=next_order,
        info=data.info,
        info_html=render_markdown(data.info or ""),
    )
```

- [ ] **Step 5: Wire update-time render in `blocks.py`**

In `backend/mathion/api/blocks.py`, change the update loop (lines 95-96):

```python
    for field, value in updates.items():
        setattr(block, field, value)
        if field == "info":
            block.info_html = render_markdown(value or "")
```

- [ ] **Step 6: Add `info_html` to content.py block serialization**

Find the inline block dict construction in `backend/mathion/api/content.py` (look for where `"info": block.info` appears). Add `"info_html": block.info_html` next to it. Run `grep -n "block.info" backend/mathion/api/content.py` to find the exact line.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_blocks.py -v`
Expected: all block tests pass, including the two new ones.

Run: `cd backend && pytest tests/ -x --tb=short 2>&1 | tail -10`
Expected: full suite green (515 tests now: 513 + 2 new).

- [ ] **Step 8: Commit**

```bash
git add backend/mathion/api/blocks.py backend/mathion/api/content.py backend/mathion/schemas.py backend/tests/test_blocks.py
git commit -m "feat(blocks): write-time render of info_html on create/update + expose in /content"
```

---

## Task 3: Add SPA static mount + `/api/{rest:path}` 404 guard

**Files:**
- Modify: `backend/mathion/config.py`
- Modify: `backend/mathion/main.py`
- Test: `backend/tests/test_main_spa.py` (new)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_main_spa.py`:

```python
"""SPA static-mount + /api catch-all behavior."""
import os
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def _client_with_dist(tmp_path, monkeypatch):
    """Return a TestClient where settings.frontend_dist points at a real dir."""
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><html>SPA</html>")
    assets_dir = dist / "_app"
    assets_dir.mkdir()
    (assets_dir / "bundle.js").write_text("console.log('hi')")
    monkeypatch.setenv("MATHION_FRONTEND_DIST", str(dist))
    # Force re-import so the conditional mount sees the env var.
    import importlib
    import mathion.config
    import mathion.main
    importlib.reload(mathion.config)
    importlib.reload(mathion.main)
    return TestClient(mathion.main.app)


def test_health_still_works_with_spa_mount(tmp_path, monkeypatch):
    client = _client_with_dist(tmp_path, monkeypatch)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_unknown_api_route_returns_json_404(tmp_path, monkeypatch):
    client = _client_with_dist(tmp_path, monkeypatch)
    response = client.get("/api/clearly-not-a-route")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}
    assert response.headers["content-type"].startswith("application/json")


def test_real_api_route_404_still_json(tmp_path, monkeypatch):
    """Existing API routes that 404 (e.g. nonexistent course slug) keep JSON 404."""
    client = _client_with_dist(tmp_path, monkeypatch)
    response = client.get("/api/courses/nonexistent-slug/my-version")
    # Could be 401 if no session, but it must be JSON not the SPA shell.
    assert response.headers["content-type"].startswith("application/json")
    assert response.status_code in (401, 404)


def test_deep_spa_path_serves_index_html(tmp_path, monkeypatch):
    client = _client_with_dist(tmp_path, monkeypatch)
    response = client.get("/courses/some-deep-spa-path")
    assert response.status_code == 200
    assert "SPA" in response.text


def test_app_bundle_served(tmp_path, monkeypatch):
    client = _client_with_dist(tmp_path, monkeypatch)
    response = client.get("/_app/bundle.js")
    assert response.status_code == 200
    assert "hi" in response.text


def test_missing_dist_does_not_break_app(tmp_path, monkeypatch):
    """Conditional mount: pure-backend dev / CI without a frontend build still works."""
    monkeypatch.setenv("MATHION_FRONTEND_DIST", str(tmp_path / "definitely-not-here"))
    import importlib
    import mathion.config
    import mathion.main
    importlib.reload(mathion.config)
    importlib.reload(mathion.main)
    client = TestClient(mathion.main.app)
    assert client.get("/health").status_code == 200
    # No SPA fallback — non-API path returns 404.
    assert client.get("/courses/anything").status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_main_spa.py -v`
Expected: FAIL — `frontend_dist` setting doesn't exist; mount + catch-all not present.

- [ ] **Step 3: Add `frontend_dist` setting**

Replace `backend/mathion/config.py` entirely:

```python
from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///./mathion.db"
    asset_path: str = "/data/mathion/assets"
    max_file_size: int = 20 * 1024 * 1024  # 20MB
    max_course_size: int = 500 * 1024 * 1024  # 500MB
    secret_key: str = "dev-secret-key-change-in-production"
    pin_expiry_minutes: int = 10
    max_pin_requests_per_hour: int = 3
    max_pin_failures_per_hour: int = 5
    cookie_secure: bool = False  # Set True in production (HTTPS)
    # Absolute path to the built frontend (Vite dist/). Resolved against the
    # backend package, NOT process CWD, so deploys are deterministic. Override
    # via MATHION_FRONTEND_DIST.
    frontend_dist: str = str(
        (Path(__file__).resolve().parent.parent.parent / "frontend" / "dist")
    )

    model_config = {"env_prefix": "MATHION_"}


settings = Settings()
```

- [ ] **Step 4: Add SPA mount + `/api` catch-all to `main.py`**

Replace `backend/mathion/main.py` entirely:

```python
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from mathion.api.auth import router as auth_router
from mathion.api.blocks import router as blocks_router
from mathion.api.content import router as content_router
from mathion.api.courses import router as courses_router
from mathion.api.dashboard import router as dashboard_router
from mathion.api.enrollment import router as enrollment_router
from mathion.api.evaluations import router as evaluations_router
from mathion.api.groups import router as groups_router
from mathion.api.student import router as student_router
from mathion.api.items import router as items_router
from mathion.api.questions import router as questions_router
from mathion.api.quiz import router as quiz_router
from mathion.api.assets import router as assets_router
from mathion.api.mini_projects import router as mini_projects_router
from mathion.api.run_assets import router as run_assets_router
from mathion.api.run_roster import router as run_roster_router
from mathion.api.run_teachers import router as run_teachers_router
from mathion.api.runs import router as runs_router
from mathion.api.submissions import router as submissions_router
from mathion.api.versions import router as versions_router
from mathion.config import settings

app = FastAPI(title="Mathion", version="0.1.0")
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.include_router(auth_router)
app.include_router(courses_router)
app.include_router(versions_router)
app.include_router(blocks_router)
app.include_router(items_router)
app.include_router(content_router)
app.include_router(enrollment_router)
app.include_router(student_router)
app.include_router(questions_router)
app.include_router(quiz_router)
app.include_router(assets_router)
app.include_router(mini_projects_router)
app.include_router(run_assets_router)
app.include_router(runs_router)
app.include_router(run_teachers_router)
app.include_router(groups_router)
app.include_router(run_roster_router)
app.include_router(submissions_router)
app.include_router(evaluations_router)
app.include_router(dashboard_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}


# The two SPA additions MUST come AFTER the include_router() calls above AND
# AFTER /health — the `/` mount otherwise shadows /health (Starlette tries
# top-level routes in registration order, and a Mount matches every prefix
# below it).

# Guard 1: explicit catch-all for unknown /api/* so router typos return JSON
# 404 rather than falling through to the SPA mount and getting index.html
# (without this, unknown /api/foo would serve the SPA shell with a 200 —
# silently masking API typos in production).
@app.api_route(
    "/api/{rest:path}",
    methods=["GET", "POST", "PATCH", "DELETE", "PUT", "HEAD", "OPTIONS"],
)
def _api_not_found(rest: str):
    raise HTTPException(status_code=404, detail="Not Found")


# Guard 2: conditional SPA mount. StaticFiles(html=True) raises at init if
# the directory is missing — which would break every backend test before a
# frontend build has run, and break uvicorn startup in pure-backend dev.
_frontend_dist = Path(settings.frontend_dist)
if _frontend_dist.is_dir():
    app.mount(
        "/",
        StaticFiles(directory=_frontend_dist, html=True, check_dir=False),
        name="spa",
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_main_spa.py -v`
Expected: all 6 tests pass.

Run: `cd backend && pytest tests/ -x --tb=short 2>&1 | tail -10`
Expected: full suite green (now 521 tests: 513 + 2 from Task 2 + 6 from this task).

- [ ] **Step 6: Commit**

```bash
git add backend/mathion/config.py backend/mathion/main.py backend/tests/test_main_spa.py
git commit -m "feat(main): conditional SPA mount + /api/{rest:path} 404 guard + frontend_dist setting"
```

---

# Section B — Frontend foundation

## Task 4: Frontend project scaffold + smoke test

**Files (all new under `frontend/`):**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/svelte.config.js`
- Create: `frontend/index.html`
- Create: `frontend/.gitignore`
- Create: `frontend/src/main.ts`
- Create: `frontend/src/app.css`
- Create: `frontend/src/App.svelte`
- Create: `frontend/src/tests/smoke.test.ts`

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "mathion-frontend",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-check --tsconfig ./tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "svelte": "^5.0.0"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "@tsconfig/svelte": "^5.0.0",
    "jsdom": "^25.0.0",
    "svelte-check": "^4.0.0",
    "tslib": "^2.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `frontend/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
      '/assets': 'http://localhost:8000',
    },
  },
  build: {
    outDir: 'dist',
    // Pinned to "_app" (NOT default "assets") so frontend bundle URLs land at
    // /_app/index-abc.js and never collide with the backend's
    // /assets/{version_id}/{filename} route.
    assetsDir: '_app',
  },
  test: {
    environment: 'jsdom',
    globals: false,
  },
});
```

- [ ] **Step 3: Create `frontend/tsconfig.json`**

```json
{
  "extends": "@tsconfig/svelte/tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "resolveJsonModule": true,
    "allowJs": false,
    "checkJs": false,
    "isolatedModules": true,
    "moduleDetection": "force",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*.ts", "src/**/*.svelte", "src/**/*.svelte.ts"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Create `frontend/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Create `frontend/svelte.config.js`**

```js
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
};
```

- [ ] **Step 6: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mathion</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `frontend/.gitignore`**

```
node_modules
dist
.svelte-kit
.vite
*.log
```

- [ ] **Step 8: Create minimal `src/app.css`, `src/App.svelte`, `src/main.ts`**

`frontend/src/app.css`:
```css
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
```

`frontend/src/App.svelte`:
```svelte
<script lang="ts">
  let { title = 'Mathion' } = $props();
</script>

<h1>{title}</h1>
```

`frontend/src/main.ts`:
```ts
import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

const app = mount(App, { target: document.getElementById('app')! });
export default app;
```

- [ ] **Step 9: Write smoke test**

`frontend/src/tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('arithmetic still works', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 10: Install + verify build + tests**

Run: `cd frontend && npm install`
Expected: completes; creates `node_modules/`.

Run: `cd frontend && npm run check`
Expected: `0 errors, 0 warnings`.

Run: `cd frontend && npm run test`
Expected: `1 passed`.

Run: `cd frontend && npm run build`
Expected: produces `frontend/dist/index.html` and `frontend/dist/_app/<hash>.js`.

- [ ] **Step 11: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): scaffold Svelte 5 + Vite + TS + vitest"
```

---

## Task 5: `lib/types.ts` — Pydantic mirrors + `assertNever`

**Files:**
- Create: `frontend/src/lib/types.ts`

- [ ] **Step 1: Write the file**

`frontend/src/lib/types.ts`:

```ts
// TypeScript mirrors of backend Pydantic shapes.
// If a backend response shape changes, every consumer breaks at `svelte-check` time.

// ---- Auth ----
export type User = {
  id: number;
  email: string;
  full_name: string | null;
  is_superuser: boolean;
  is_disabled: boolean;
  photo_url: string | null;
};

// ---- Course list ----
export type CourseListItem = {
  course_id: number;
  course_slug: string;
  course_title: string;
  version_id: number;
  version_state: 'created' | 'published' | 'archived';
  covered_items: number;
  total_items: number;
};

// ---- Course tree (`/api/versions/:id/content`) ----
export type VersionContent = {
  version: {
    id: number;
    course_id: number;
    state: 'created' | 'published' | 'archived';
    info_md: string;
    info_html: string;
    max_quiz_attempts: number;
  };
  blocks: BlockContent[];
};

export type BlockContent = {
  id: number;
  title: string;
  slug: string;
  order: number;
  info: string;
  info_html: string;
  sequences: SequenceContent[];
};

export type SequenceContent = {
  id: number;
  title: string;
  slug: string;
  order: number;
  items: Item[];
};

// ---- Items: discriminated union over backend Item.type ----
export type Item =
  | StaticPageItem
  | VideoItem
  | QuizItem
  | MiniProjectItem
  | InteractiveAppItem;

type ItemBase = {
  id: number;
  sequence_id: number;
  title: string;
  slug: string;
  order: number;
};

export type StaticPageItem = ItemBase & {
  type: 'static_page';
  content_md: string;
  content_html: string;
};

export type VideoItem = ItemBase & {
  type: 'video';
  video_url: string;
};

export type QuizItem = ItemBase & {
  type: 'quiz';
  questions: Question[];
};

export type MiniProjectItem = ItemBase & {
  type: 'mini_project';
};

export type InteractiveAppItem = ItemBase & {
  type: 'interactive_app';
  script_url: string;
};

// ---- Questions: discriminated union ----
export type Question =
  | SingleChoiceQuestion
  | MultipleChoiceQuestion
  | NumericQuestion
  | TextQuestion;

type QuestionBase = {
  id: number;
  text_md: string;
  text_html: string;
  order: number;
};

export type SingleChoiceQuestion = QuestionBase & {
  type: 'single_choice';
  options: { id: number; text: string }[];
};

export type MultipleChoiceQuestion = QuestionBase & {
  type: 'multiple_choice';
  options: { id: number; text: string }[];
};

export type NumericQuestion = QuestionBase & {
  type: 'numeric_answer';
};

export type TextQuestion = QuestionBase & {
  type: 'text_answer';
};

// ---- State (`/api/versions/:id/state`) ----
export type VersionState = {
  version_id: number;
  items: Record<string, ItemStateEntry>; // key is item_id as string
};

export type ItemStateEntry = {
  is_covered: boolean;
  time_spent_seconds: number;
  last_visited_at: string | null; // ISO datetime
  last_answers: Record<string, number[] | string> | null;
  attempt_count: number;
  score_correct: number | null;
  score_total: number | null;
};

// ---- Quiz submit ----
export type QuizSubmitRequest = {
  answers: Record<string, number[] | string>;
};

export type QuizSubmitResponse = {
  item_id: number;
  attempt_count: number;
  max_attempts: number;
  score_correct: number;
  score_total: number;
  can_retry: boolean;
};

// ---- Quiz reveal ----
export type QuizRevealResponse = {
  item_id: number;
  questions: {
    id: number;
    type: Question['type'];
    correct_options?: number[];
    correct_value?: string | number;
    explanation_html?: string;
  }[];
};

// ---- Toasts ----
export type Toast = {
  id: number;
  message: string;
  kind: 'info' | 'error' | 'success';
};

// ---- Validation errors (FastAPI 422) ----
export type ValidationErrorDetail = {
  loc: (string | number)[];
  msg: string;
  type: string;
};

// ---- Exhaustiveness helper ----
export function assertNever(x: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(x)}`);
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd frontend && npm run check`
Expected: `0 errors`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/types.ts
git commit -m "feat(frontend): types.ts — backend wire-shape mirrors + assertNever"
```

---

## Task 6: `lib/events.ts` — pre-wire single-slot buffer

**Files:**
- Create: `frontend/src/lib/events.ts`
- Create: `frontend/src/tests/events.test.ts`

- [ ] **Step 1: Write the failing test**

`frontend/src/tests/events.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('lib/events', () => {
  let events: typeof import('../lib/events');

  beforeEach(async () => {
    vi.resetModules();
    events = await import('../lib/events');
  });

  it('replays a pre-wire emit when the handler wires up', () => {
    events.emitUnauthorized('/courses/foo');
    const calls: string[] = [];
    events.onUnauthorized((p) => calls.push(p));
    expect(calls).toEqual(['/courses/foo']);
  });

  it('coalesces multiple pre-wire emits to the most recent path', () => {
    events.emitUnauthorized('/first');
    events.emitUnauthorized('/second');
    events.emitUnauthorized('/third');
    const calls: string[] = [];
    events.onUnauthorized((p) => calls.push(p));
    expect(calls).toEqual(['/third']);
  });

  it('routes post-wire emits straight to the handler', () => {
    const calls: string[] = [];
    events.onUnauthorized((p) => calls.push(p));
    events.emitUnauthorized('/a');
    events.emitUnauthorized('/b');
    expect(calls).toEqual(['/a', '/b']);
  });

  it('clears the pending slot after replay so re-wiring doesnt re-fire', () => {
    events.emitUnauthorized('/once');
    const a: string[] = [];
    events.onUnauthorized((p) => a.push(p));
    expect(a).toEqual(['/once']);
    const b: string[] = [];
    events.onUnauthorized((p) => b.push(p));
    expect(b).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- events.test`
Expected: FAIL — `Cannot find module '../lib/events'`.

- [ ] **Step 3: Write the implementation**

`frontend/src/lib/events.ts`:

```ts
// Tiny callback registry, plain `.ts` (no runes). Lives outside both
// `lib/api.ts` and `lib/auth.svelte.ts` so neither imports the other —
// breaks the api↔auth↔router cycle that ESM partial-init would expose.

type UnauthorizedHandler = (path: string) => void;

let handler: UnauthorizedHandler | null = null;
let pendingUnauthorized: string | null = null;

export function onUnauthorized(cb: UnauthorizedHandler): void {
  handler = cb;
  if (pendingUnauthorized !== null) {
    const path = pendingUnauthorized;
    pendingUnauthorized = null;
    cb(path);
  }
}

export function emitUnauthorized(path: string): void {
  if (handler !== null) {
    handler(path);
    return;
  }
  // Coalescing single slot — multiple pre-wire emits collapse to the most
  // recent path. We never replay more than one redirect; the wired handler
  // clears the session and navigates on first replay.
  pendingUnauthorized = path;
  if (import.meta.env.DEV) {
    console.error(
      '[events] emitUnauthorized called before onUnauthorized was wired:',
      path,
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- events.test`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/events.ts frontend/src/tests/events.test.ts
git commit -m "feat(frontend): events.ts pub-sub with coalescing pre-wire buffer"
```

---

## Task 7: `lib/api.ts` — fetch wrapper + ApiError

**Files:**
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/tests/api.test.ts`

- [ ] **Step 1: Write the failing tests**

`frontend/src/tests/api.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ApiError, api } from '../lib/api';
import * as events from '../lib/events';

describe('lib/api', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/courses/foo'),
      writable: true,
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('attaches X-Requested-With on every request', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await api.get('/api/foo');
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('X-Requested-With')).toBe('mathion');
  });

  it('X-Requested-With cannot be overridden by callers (set-last)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await api.get('/api/foo', { headers: { 'X-Requested-With': 'attacker' } });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('X-Requested-With')).toBe('mathion');
  });

  it('preserves caller Content-Type for JSON posts', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await api.post('/api/foo', { a: 1 });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('throws ApiError with status + detail on non-ok', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Boom' }), { status: 500, headers: { 'content-type': 'application/json' } }),
    );
    await expect(api.get('/api/foo')).rejects.toMatchObject({
      status: 500,
      detail: 'Boom',
    });
  });

  it('emits unauthorized + throws on 401', async () => {
    const emitSpy = vi.spyOn(events, 'emitUnauthorized');
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(api.get('/api/foo')).rejects.toBeInstanceOf(ApiError);
    expect(emitSpy).toHaveBeenCalledWith('/courses/foo');
  });

  it('skipAuthRedirect=true does not emit on 401', async () => {
    const emitSpy = vi.spyOn(events, 'emitUnauthorized');
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(api.get('/api/foo', { skipAuthRedirect: true })).rejects.toMatchObject({ status: 401 });
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('returns parsed JSON on 200', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ x: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const out = await api.get<{ x: number }>('/api/foo');
    expect(out).toEqual({ x: 1 });
  });

  it('returns undefined on 204', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const out = await api.delete('/api/foo');
    expect(out).toBeUndefined();
  });

  it('ApiError.displayMessage handles string and array detail', () => {
    const e1 = new ApiError(400, 'oops');
    expect(e1.displayMessage).toBe('oops');
    const e2 = new ApiError(422, [{ loc: ['body', 'email'], msg: 'bad', type: 'value_error' }]);
    expect(e2.displayMessage).toBe('Please correct the highlighted fields.');
  });

  it('ApiError.validationErrors returns array on 422, null otherwise', () => {
    const e1 = new ApiError(400, 'oops');
    expect(e1.validationErrors()).toBeNull();
    const errs = [{ loc: ['body', 'email'] as (string | number)[], msg: 'bad', type: 'value_error' }];
    const e2 = new ApiError(422, errs);
    expect(e2.validationErrors()).toEqual(errs);
  });

  it('captures error_code from response body', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Nope', error_code: 'capacity_reached' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(api.get('/api/foo')).rejects.toMatchObject({
      status: 409,
      errorCode: 'capacity_reached',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- api.test`
Expected: FAIL — `Cannot find module '../lib/api'`.

- [ ] **Step 3: Write the implementation**

`frontend/src/lib/api.ts`:

```ts
import type { ValidationErrorDetail } from './types';
import { emitUnauthorized } from './events';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string | ValidationErrorDetail[],
    public readonly errorCode?: string,
  ) {
    super(typeof detail === 'string' ? detail : 'Validation error');
    this.name = 'ApiError';
  }

  /** Always-string message for toasts/panels. */
  get displayMessage(): string {
    return typeof this.detail === 'string'
      ? this.detail
      : 'Please correct the highlighted fields.';
  }

  /** Returns per-field validation errors on 422, null otherwise. */
  validationErrors(): ValidationErrorDetail[] | null {
    return Array.isArray(this.detail) ? this.detail : null;
  }
}

export type RequestOpts = RequestInit & { skipAuthRedirect?: boolean };

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { skipAuthRedirect, headers: callerHeaders, ...init } = opts;
  // Build via Headers class so X-Requested-With is set LAST and wins over any
  // caller-provided value (a regression in an earlier revision had spread
  // order reversed, allowing caller clobber).
  const headers = new Headers(callerHeaders ?? {});
  headers.set('X-Requested-With', 'mathion');

  const res = await fetch(path, { credentials: 'include', ...init, headers });

  if (res.status === 401 && !skipAuthRedirect) {
    // Preserve hash so e.g. /courses/foo/seq/12#item=87 survives the bounce.
    emitUnauthorized(location.pathname + location.search + location.hash);
    throw new ApiError(401, 'Not authenticated');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? res.statusText, body.error_code);
  }
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}

export const api = {
  get: <T>(path: string, opts?: RequestOpts) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: RequestOpts) =>
    request<T>(path, {
      ...opts,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
    }),
  patch: <T>(path: string, body: unknown, opts?: RequestOpts) =>
    request<T>(path, {
      ...opts,
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
    }),
  delete: (path: string, opts?: RequestOpts) =>
    request<void>(path, { ...opts, method: 'DELETE' }),
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- api.test`
Expected: `11 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/tests/api.test.ts
git commit -m "feat(frontend): api.ts wrapper — Headers set-last, ApiError, 401 emit"
```

---

## Task 8: `lib/router.svelte.ts` — History API + hashchange + safeNext

**Files:**
- Create: `frontend/src/lib/router.svelte.ts`
- Create: `frontend/src/tests/router.test.ts`

- [ ] **Step 1: Write the failing tests**

`frontend/src/tests/router.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchRoute, safeNext } from '../lib/router.svelte';

describe('lib/router', () => {
  describe('matchRoute', () => {
    const routes = [
      { path: '/login', component: 'Login', auth: false },
      { path: '/courses', component: 'CourseList', auth: true },
      { path: '/courses/:courseSlug', component: 'CourseView', auth: true },
      { path: '/courses/:courseSlug/seq/:sequenceId', component: 'SequencePlayer', auth: true },
    ];

    it('matches a static path', () => {
      const m = matchRoute(routes, '/login');
      expect(m?.route.component).toBe('Login');
      expect(m?.params).toEqual({});
    });

    it('matches a single-param path', () => {
      const m = matchRoute(routes, '/courses/algebra-1');
      expect(m?.route.component).toBe('CourseView');
      expect(m?.params).toEqual({ courseSlug: 'algebra-1' });
    });

    it('matches a multi-param path', () => {
      const m = matchRoute(routes, '/courses/algebra-1/seq/42');
      expect(m?.route.component).toBe('SequencePlayer');
      expect(m?.params).toEqual({ courseSlug: 'algebra-1', sequenceId: '42' });
    });

    it('returns null for no match', () => {
      expect(matchRoute(routes, '/nope/here')).toBeNull();
    });

    it('does not partial-match', () => {
      expect(matchRoute(routes, '/courses/algebra-1/extra/bits')).toBeNull();
    });
  });

  describe('safeNext', () => {
    it('passes through same-origin path', () => {
      expect(safeNext('/courses/foo', 'http://localhost')).toBe('/courses/foo');
    });

    it('preserves search and hash', () => {
      expect(safeNext('/courses/foo?x=1#item=2', 'http://localhost')).toBe('/courses/foo?x=1#item=2');
    });

    it('falls back on cross-origin URL', () => {
      expect(safeNext('https://attacker.com/foo', 'http://localhost')).toBe('/courses');
    });

    it('falls back on protocol-only', () => {
      expect(safeNext('javascript:alert(1)', 'http://localhost')).toBe('/courses');
    });

    it('falls back on backslash-prefixed', () => {
      expect(safeNext('\\\\evil.com', 'http://localhost')).toBe('/courses');
    });

    it('falls back on empty / invalid', () => {
      expect(safeNext('', 'http://localhost')).toBe('/courses');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- router.test`
Expected: FAIL — `Cannot find module '../lib/router.svelte'`.

- [ ] **Step 3: Write the implementation**

`frontend/src/lib/router.svelte.ts`:

```ts
// Hand-rolled History-API router. Reactive via $state. Path-level changes
// fire popstate; #hash-only changes fire hashchange (popstate does NOT fire
// for hash changes), so we listen for both. App.svelte re-renders on any
// change to currentRoute.

export type Route = {
  path: string;            // pattern: '/courses/:courseSlug'
  component: string;       // logical name; App.svelte maps to imported component
  auth: boolean;
};

export type RouteMatch = { route: Route; params: Record<string, string> };

export const currentRoute = $state<{
  path: string;
  search: string;
  hash: string;
}>({
  path: typeof location !== 'undefined' ? location.pathname : '/',
  search: typeof location !== 'undefined' ? location.search : '',
  hash: typeof location !== 'undefined' ? location.hash : '',
});

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) {
    history.replaceState(null, '', path);
  } else {
    history.pushState(null, '', path);
  }
  // Sync currentRoute manually — pushState/replaceState don't fire popstate.
  currentRoute.path = location.pathname;
  currentRoute.search = location.search;
  currentRoute.hash = location.hash;
}

export function startRouter(): void {
  window.addEventListener('popstate', () => {
    currentRoute.path = location.pathname;
    currentRoute.search = location.search;
    currentRoute.hash = location.hash;
  });
  window.addEventListener('hashchange', () => {
    currentRoute.hash = location.hash;
  });
}

/** Match a path against a route table; null if no match. */
export function matchRoute(routes: Route[], path: string): RouteMatch | null {
  for (const route of routes) {
    const m = matchPattern(route.path, path);
    if (m !== null) return { route, params: m };
  }
  return null;
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const patSegs = pattern.split('/').filter(Boolean);
  const pathSegs = path.split('/').filter(Boolean);
  if (patSegs.length !== pathSegs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patSegs.length; i++) {
    const p = patSegs[i];
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(pathSegs[i]);
    } else if (p !== pathSegs[i]) {
      return null;
    }
  }
  return params;
}

/**
 * Validate `next` query-string values: must resolve to the same origin as
 * `origin`. Falls back to '/courses' for any cross-origin, malformed, or
 * scheme-bearing input. Pass `location.origin` in production; tests inject.
 */
export function safeNext(next: string, origin: string): string {
  if (!next) return '/courses';
  // Reject backslash-leading inputs that some browsers normalize to //.
  if (next.startsWith('\\')) return '/courses';
  try {
    const u = new URL(next, origin);
    if (u.origin !== origin) return '/courses';
    return u.pathname + u.search + u.hash;
  } catch {
    return '/courses';
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- router.test`
Expected: `11 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/router.svelte.ts frontend/src/tests/router.test.ts
git commit -m "feat(frontend): router.svelte.ts — History API + hashchange + safeNext"
```

---

## Task 9: `lib/coverage.svelte.ts` — per-item coverage tracker factory

**Files:**
- Create: `frontend/src/lib/coverage.svelte.ts`
- Create: `frontend/src/tests/coverage.test.ts`

- [ ] **Step 1: Write the failing tests**

`frontend/src/tests/coverage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCoverageTracker } from '../lib/coverage.svelte';

describe('lib/coverage', () => {
  let now: number;
  let postCalls: { itemId: number; payload: { time_spent: number; is_covered?: boolean } }[];
  let postTrack: (itemId: number, payload: { time_spent: number; is_covered?: boolean }) => Promise<void>;

  beforeEach(() => {
    now = 0;
    postCalls = [];
    postTrack = async (itemId, payload) => {
      postCalls.push({ itemId, payload });
    };
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
  });

  it('start() is idempotent — second call does not double-count', () => {
    const t = createCoverageTracker(42, { now: () => now, postTrack });
    t.start();
    t.start();
    t.stop();
    expect(postCalls.length).toBeLessThanOrEqual(1);
  });

  it('flushes accumulated time_spent on stop()', async () => {
    const t = createCoverageTracker(42, { now: () => now, postTrack });
    t.start();
    now = 5000; // 5s elapsed
    await t.stop();
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0].payload.time_spent).toBe(5);
  });

  it('clamps time_spent to 60s per post', async () => {
    const t = createCoverageTracker(42, { now: () => now, postTrack });
    t.start();
    now = 999_999; // huge delta (e.g. tab returned after long absence)
    await t.stop();
    expect(postCalls[0].payload.time_spent).toBe(60);
  });

  it('does not accrue time while document.visibilityState is hidden', async () => {
    const t = createCoverageTracker(42, { now: () => now, postTrack });
    t.start();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    now = 10_000;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    now = 12_000;
    await t.stop();
    // Only the 2 seconds while visible should count.
    expect(postCalls[0].payload.time_spent).toBe(2);
  });

  it('markCovered() sends is_covered=true with current accumulated time', async () => {
    const t = createCoverageTracker(42, { now: () => now, postTrack });
    t.start();
    now = 3000;
    await t.markCovered();
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0].payload).toMatchObject({ time_spent: 3, is_covered: true });
  });

  it('silently stops on 403 from postTrack', async () => {
    const failing403: typeof postTrack = async () => {
      const e: Error & { status?: number } = new Error('forbidden');
      e.status = 403;
      throw e;
    };
    const t = createCoverageTracker(42, { now: () => now, postTrack: failing403 });
    t.start();
    now = 1000;
    await t.markCovered(); // first call fails 403; tracker should swallow
    now = 5000;
    await t.markCovered(); // second call should be a no-op (silently stopped)
    expect(true).toBe(true); // didnt throw — pass
  });

  it('stop() removes visibilitychange listener', async () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const t = createCoverageTracker(42, { now: () => now, postTrack });
    t.start();
    await t.stop();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- coverage.test`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`frontend/src/lib/coverage.svelte.ts`:

```ts
// Per-item coverage tracker factory.
// - Accrues active time from performance.now() deltas while document is visible
// - Posts incremental time_spent every 15s (clamped to 60s per post)
// - markCovered() sends is_covered=true with the current accumulated delta
// - 403 from /track => silently stop (admin disabled the version)
// - start() is idempotent; stop() removes listeners + cancels interval + flushes

const POST_INTERVAL_MS = 15_000;
const MAX_POST_SECONDS = 60;

export type TrackPayload = { time_spent: number; is_covered?: boolean };
export type PostTrack = (itemId: number, payload: TrackPayload) => Promise<void>;

export type CoverageOpts = {
  /** Test seam — defaults to performance.now. */
  now?: () => number;
  /** Test seam — defaults to a real fetch via /api/items/:id/track. */
  postTrack?: PostTrack;
};

export type CoverageTracker = {
  start: () => void;
  stop: () => Promise<void>;
  markCovered: () => Promise<void>;
};

export function createCoverageTracker(
  itemId: number,
  opts: CoverageOpts = {},
): CoverageTracker {
  const now = opts.now ?? (() => performance.now());
  const postTrack = opts.postTrack ?? defaultPostTrack;

  let started = false;
  let stopped = false;
  let killed = false; // 403 latch: stop accruing + posting forever
  let lastSampleMs: number | null = null;
  let pendingMs = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function visibilityHandler(): void {
    if (killed) return;
    if (document.visibilityState === 'visible') {
      lastSampleMs = now();
    } else {
      sample();
      lastSampleMs = null;
    }
  }

  function sample(): void {
    if (killed) return;
    if (lastSampleMs === null) return;
    if (document.visibilityState !== 'visible') return;
    const t = now();
    pendingMs += t - lastSampleMs;
    lastSampleMs = t;
  }

  async function flush(extra: { is_covered?: boolean } = {}): Promise<void> {
    if (killed) return;
    sample();
    const seconds = Math.min(MAX_POST_SECONDS, Math.floor(pendingMs / 1000));
    if (seconds <= 0 && !extra.is_covered) return;
    pendingMs = Math.max(0, pendingMs - seconds * 1000);
    try {
      await postTrack(itemId, { time_spent: seconds, ...extra });
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status;
      if (status === 403) {
        killed = true;
        // Silently stop accruing/posting; tracker remains alive for stop()
        return;
      }
      // Swallow other errors here — coverage tracking is best-effort.
    }
  }

  return {
    start(): void {
      if (started) return; // idempotent
      started = true;
      stopped = false;
      lastSampleMs = document.visibilityState === 'visible' ? now() : null;
      document.addEventListener('visibilitychange', visibilityHandler);
      intervalId = setInterval(() => {
        void flush();
      }, POST_INTERVAL_MS);
    },

    async stop(): Promise<void> {
      if (!started || stopped) return;
      stopped = true;
      document.removeEventListener('visibilitychange', visibilityHandler);
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      await flush();
    },

    async markCovered(): Promise<void> {
      if (killed) return;
      await flush({ is_covered: true });
    },
  };
}

const defaultPostTrack: PostTrack = async (itemId, payload) => {
  const { api } = await import('./api');
  await api.post(`/api/items/${itemId}/track`, payload);
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- coverage.test`
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/coverage.svelte.ts frontend/src/tests/coverage.test.ts
git commit -m "feat(frontend): coverage.svelte.ts — active-time tracker with 60s clamp + 403 latch"
```

---

## Task 10: `lib/format.ts` — small formatters

**Files:**
- Create: `frontend/src/lib/format.ts`
- Create: `frontend/src/tests/format.test.ts`

- [ ] **Step 1: Write the failing tests**

`frontend/src/tests/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatProgress } from '../lib/format';

describe('lib/format', () => {
  it('formatProgress shows n/total', () => {
    expect(formatProgress(3, 10)).toBe('3 / 10');
  });

  it('formatProgress handles zero total', () => {
    expect(formatProgress(0, 0)).toBe('0 / 0');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- format.test`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`frontend/src/lib/format.ts`:

```ts
export function formatProgress(covered: number, total: number): string {
  return `${covered} / ${total}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- format.test`
Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/format.ts frontend/src/tests/format.test.ts
git commit -m "feat(frontend): format.ts — progress formatter"
```

---

# Section C — Stores

## Task 11: `stores/session.svelte.ts`

**Files:**
- Create: `frontend/src/stores/session.svelte.ts`
- Create: `frontend/src/tests/session.test.ts`

- [ ] **Step 1: Write the failing tests**

`frontend/src/tests/session.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { session, clearSession } from '../stores/session.svelte';

describe('stores/session', () => {
  it('starts with user=null and loading=true', () => {
    expect(session.user).toBeNull();
    expect(session.loading).toBe(true);
  });

  it('clearSession sets user=null and loading=false', () => {
    session.user = { id: 1, email: 'a@b', full_name: null, is_superuser: false, is_disabled: false, photo_url: null };
    session.loading = true;
    clearSession();
    expect(session.user).toBeNull();
    expect(session.loading).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- session.test`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`frontend/src/stores/session.svelte.ts`:

```ts
import type { User } from '../lib/types';

export const session = $state<{
  user: User | null;
  loading: boolean;
}>({
  user: null,
  loading: true,
});

export function clearSession(): void {
  session.user = null;
  session.loading = false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- session.test`
Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/session.svelte.ts frontend/src/tests/session.test.ts
git commit -m "feat(frontend): stores/session.svelte.ts"
```

---

## Task 12: `stores/toasts.svelte.ts`

**Files:**
- Create: `frontend/src/stores/toasts.svelte.ts`
- Create: `frontend/src/tests/toasts.test.ts`

- [ ] **Step 1: Write the failing tests**

`frontend/src/tests/toasts.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { toasts, pushToast, clearToasts } from '../stores/toasts.svelte';

describe('stores/toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearToasts();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pushToast adds a toast with default kind=info', () => {
    pushToast('Hello');
    expect(toasts.list).toHaveLength(1);
    expect(toasts.list[0].message).toBe('Hello');
    expect(toasts.list[0].kind).toBe('info');
  });

  it('pushToast accepts explicit kind', () => {
    pushToast('Boom', 'error');
    expect(toasts.list[0].kind).toBe('error');
  });

  it('toasts auto-dismiss after 5 s', () => {
    pushToast('bye');
    expect(toasts.list).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(toasts.list).toHaveLength(0);
  });

  it('clearToasts empties the list immediately', () => {
    pushToast('a');
    pushToast('b');
    clearToasts();
    expect(toasts.list).toHaveLength(0);
  });

  it('toast IDs are unique', () => {
    pushToast('a');
    pushToast('b');
    pushToast('c');
    const ids = toasts.list.map((t) => t.id);
    expect(new Set(ids).size).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- toasts.test`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`frontend/src/stores/toasts.svelte.ts`:

```ts
import type { Toast } from '../lib/types';

const AUTO_DISMISS_MS = 5000;

export const toasts = $state<{ list: Toast[] }>({ list: [] });

let nextId = 1;

export function pushToast(message: string, kind: Toast['kind'] = 'info'): void {
  const id = nextId++;
  toasts.list.push({ id, message, kind });
  setTimeout(() => {
    const idx = toasts.list.findIndex((t) => t.id === id);
    if (idx !== -1) toasts.list.splice(idx, 1);
  }, AUTO_DISMISS_MS);
}

export function clearToasts(): void {
  toasts.list.splice(0, toasts.list.length);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- toasts.test`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/toasts.svelte.ts frontend/src/tests/toasts.test.ts
git commit -m "feat(frontend): stores/toasts.svelte.ts — push/clear/auto-dismiss"
```

---

## Task 13: `stores/currentCourse.svelte.ts` — single-flight + abortable + stale-write guard

**Files:**
- Create: `frontend/src/stores/currentCourse.svelte.ts`
- Create: `frontend/src/tests/currentCourse.test.ts`

- [ ] **Step 1: Write the failing tests**

`frontend/src/tests/currentCourse.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  currentCourse,
  clearCourse,
  markItemCovered,
  recordItemVisit,
  __test__setSlots,
} from '../stores/currentCourse.svelte';

describe('stores/currentCourse', () => {
  beforeEach(() => {
    clearCourse();
  });

  it('starts as null', () => {
    expect(currentCourse.value).toBeNull();
  });

  it('clearCourse resets to null', () => {
    __test__setSlots({
      slug: 's',
      versionId: 1,
      course: { id: 1, slug: 's', title: 'T' },
      version: { id: 1, course_id: 1, state: 'published', info_md: '', info_html: '', max_quiz_attempts: 3 },
      blocks: [],
      state: { version_id: 1, items: {} },
    });
    expect(currentCourse.value).not.toBeNull();
    clearCourse();
    expect(currentCourse.value).toBeNull();
  });

  it('markItemCovered mutates state.items[itemId].is_covered in place', () => {
    __test__setSlots({
      slug: 's',
      versionId: 1,
      course: { id: 1, slug: 's', title: 'T' },
      version: { id: 1, course_id: 1, state: 'published', info_md: '', info_html: '', max_quiz_attempts: 3 },
      blocks: [],
      state: {
        version_id: 1,
        items: {
          '42': { is_covered: false, time_spent_seconds: 0, last_visited_at: null, last_answers: null, attempt_count: 0, score_correct: null, score_total: null },
        },
      },
    });
    markItemCovered(42);
    expect(currentCourse.value!.state.items['42'].is_covered).toBe(true);
  });

  it('recordItemVisit updates last_visited_at to now', () => {
    __test__setSlots({
      slug: 's',
      versionId: 1,
      course: { id: 1, slug: 's', title: 'T' },
      version: { id: 1, course_id: 1, state: 'published', info_md: '', info_html: '', max_quiz_attempts: 3 },
      blocks: [],
      state: {
        version_id: 1,
        items: {
          '42': { is_covered: false, time_spent_seconds: 0, last_visited_at: null, last_answers: null, attempt_count: 0, score_correct: null, score_total: null },
        },
      },
    });
    recordItemVisit(42);
    expect(currentCourse.value!.state.items['42'].last_visited_at).not.toBeNull();
  });

  it('markItemCovered no-ops if itemId not in state.items', () => {
    __test__setSlots({
      slug: 's',
      versionId: 1,
      course: { id: 1, slug: 's', title: 'T' },
      version: { id: 1, course_id: 1, state: 'published', info_md: '', info_html: '', max_quiz_attempts: 3 },
      blocks: [],
      state: { version_id: 1, items: {} },
    });
    expect(() => markItemCovered(999)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- currentCourse.test`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`frontend/src/stores/currentCourse.svelte.ts`:

```ts
import { api } from '../lib/api';
import { ApiError } from '../lib/api';
import type { BlockContent, ItemStateEntry, VersionContent, VersionState } from '../lib/types';

type CourseSnapshot = {
  slug: string;
  versionId: number;
  course: { id: number; slug: string; title: string };
  version: VersionContent['version'];
  blocks: BlockContent[];
  state: VersionState;
};

export const currentCourse = $state<{ value: CourseSnapshot | null }>({ value: null });

type InflightSlot = {
  slug: string;
  promise: Promise<void>;
  controller: AbortController;
};

let inflight: InflightSlot | null = null;

/**
 * Single-flight + abortable course load.
 *
 * - If an in-flight load for the same slug exists, reuse its promise.
 * - If an in-flight load for a different slug exists, abort it and start a
 *   new one (the new load assigns inflight before awaiting).
 * - Stale-write guard: when a load resolves, compare its captured
 *   `startedSlug` against `inflight?.slug` — if they no longer match, discard
 *   the result silently and do NOT touch `currentCourse.value` (a newer load
 *   is already in flight). Comparing against `currentCourse.value?.slug`
 *   would be wrong: the store may be `null` mid-load.
 */
export function loadCourse(slug: string): Promise<void> {
  if (inflight?.slug === slug) return inflight.promise;
  if (inflight !== null) inflight.controller.abort();

  const startedSlug = slug;
  const controller = new AbortController();
  const promise = (async () => {
    try {
      const my = await api.get<{ version_id: number; course: { id: number; slug: string; title: string } }>(
        `/api/courses/${encodeURIComponent(startedSlug)}/my-version`,
        { signal: controller.signal },
      );
      const [content, state] = await Promise.all([
        api.get<VersionContent>(`/api/versions/${my.version_id}/content`, { signal: controller.signal }),
        api.get<VersionState>(`/api/versions/${my.version_id}/state`, { signal: controller.signal }),
      ]);
      // Stale-write guard.
      if (inflight?.slug !== startedSlug) return;
      currentCourse.value = {
        slug: startedSlug,
        versionId: my.version_id,
        course: my.course,
        version: content.version,
        blocks: content.blocks,
        state,
      };
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      // Re-throw API errors — caller (page) decides whether to render 404 panel.
      if (e instanceof ApiError) throw e;
      throw e;
    } finally {
      if (inflight?.slug === startedSlug) inflight = null;
    }
  })();

  inflight = { slug: startedSlug, promise, controller };
  return promise;
}

export function clearCourse(): void {
  if (inflight !== null) {
    inflight.controller.abort();
    inflight = null;
  }
  currentCourse.value = null;
}

export function markItemCovered(itemId: number): void {
  if (currentCourse.value === null) return;
  const entry = currentCourse.value.state.items[String(itemId)];
  if (entry === undefined) return;
  entry.is_covered = true; // deep mutation: $state proxies make this reactive
}

export function recordItemVisit(itemId: number): void {
  if (currentCourse.value === null) return;
  const entry: ItemStateEntry | undefined = currentCourse.value.state.items[String(itemId)];
  if (entry !== undefined) {
    entry.last_visited_at = new Date().toISOString();
  } else {
    // First visit — populate the slot so resume-here heuristic sees it.
    currentCourse.value.state.items[String(itemId)] = {
      is_covered: false,
      time_spent_seconds: 0,
      last_visited_at: new Date().toISOString(),
      last_answers: null,
      attempt_count: 0,
      score_correct: null,
      score_total: null,
    };
  }
}

// Test seam — bypass loadCourse so unit tests can set fixture state directly.
export function __test__setSlots(snap: CourseSnapshot | null): void {
  currentCourse.value = snap;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- currentCourse.test`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/currentCourse.svelte.ts frontend/src/tests/currentCourse.test.ts
git commit -m "feat(frontend): stores/currentCourse — single-flight, abort, stale-write guard"
```

---

# Section D — App shell + auth

## Task 14: `lib/auth.svelte.ts`

**Files:**
- Create: `frontend/src/lib/auth.svelte.ts`

- [ ] **Step 1: Write the file**

`frontend/src/lib/auth.svelte.ts`:

```ts
import { api, ApiError } from './api';
import { session, clearSession } from '../stores/session.svelte';
import { clearCourse } from '../stores/currentCourse.svelte';
import { clearToasts } from '../stores/toasts.svelte';
import type { User } from './types';

export async function bootstrapSession(): Promise<void> {
  try {
    const u = await api.get<User>('/api/auth/me', { skipAuthRedirect: true });
    session.user = u;
  } catch (e: unknown) {
    if (!(e instanceof ApiError && e.status === 401)) throw e;
    session.user = null;
  } finally {
    session.loading = false;
  }
}

export async function requestPin(email: string): Promise<void> {
  await api.post('/api/auth/request-pin', { email });
}

export async function verifyPin(
  email: string,
  pin: string,
  duration_days: 1 | 7 | 30,
): Promise<User> {
  const { user } = await api.post<{ user: User }>('/api/auth/verify-pin', {
    email,
    pin,
    duration_days,
  });
  session.user = user;
  return user;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/api/auth/logout');
  } finally {
    clearSession();
    clearCourse();
    clearToasts();
  }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd frontend && npm run check`
Expected: `0 errors`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/auth.svelte.ts
git commit -m "feat(frontend): auth.svelte.ts — bootstrap/request/verify/logout helpers"
```

---

## Task 15: Global CSS + UI primitives + Toaster

**Files:**
- Create: `frontend/src/styles/reset.css`
- Create: `frontend/src/styles/base.css`
- Modify: `frontend/src/app.css`
- Create: `frontend/src/components/ui/Button.svelte`
- Create: `frontend/src/components/ui/Input.svelte`
- Create: `frontend/src/components/ui/FormRow.svelte`
- Create: `frontend/src/components/ui/Spinner.svelte`
- Create: `frontend/src/components/chrome/Toast.svelte`
- Create: `frontend/src/components/chrome/Toaster.svelte`

- [ ] **Step 1: Create `reset.css`**

`frontend/src/styles/reset.css`:

```css
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { line-height: 1.5; -webkit-font-smoothing: antialiased; }
ul, ol { padding: 0; margin: 0; list-style: none; }
h1, h2, h3, h4, h5, h6 { margin: 0; font-weight: 600; }
p { margin: 0; }
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; background: none; border: none; padding: 0; }
img, video { max-width: 100%; height: auto; display: block; }
a { color: inherit; text-decoration: none; }
```

- [ ] **Step 2: Create `base.css`**

`frontend/src/styles/base.css`:

```css
:root {
  --bg: #fff;
  --text: #1a1a1a;
  --muted: #666;
  --border: #ddd;
  --primary: #444;
  --primary-text: #fff;
  --danger: #c33;
  --success: #285;
  --space-1: .25rem;
  --space-2: .5rem;
  --space-3: 1rem;
  --space-4: 1.5rem;
  --space-6: 3rem;
  --radius: 4px;
  --font-size-base: 16px;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  font-size: var(--font-size-base);
}

a { color: var(--primary); }
a:hover { text-decoration: underline; }

h1 { font-size: 1.75rem; }
h2 { font-size: 1.375rem; }
h3 { font-size: 1.125rem; }
```

- [ ] **Step 3: Replace `app.css`**

`frontend/src/app.css`:

```css
@import './styles/reset.css';
@import './styles/base.css';
```

- [ ] **Step 4: Create UI primitives**

`frontend/src/components/ui/Button.svelte`:

```svelte
<script lang="ts">
  type Variant = 'primary' | 'secondary' | 'ghost';
  let {
    variant = 'primary' as Variant,
    type = 'button' as 'button' | 'submit',
    disabled = false,
    loading = false,
    onclick,
    children,
  } = $props();
</script>

<button
  {type}
  class="btn {variant}"
  {disabled}
  {onclick}
>
  {#if loading}<span class="spinner"></span>{/if}
  {@render children?.()}
</button>

<style>
  .btn {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius);
    border: 1px solid transparent;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .primary { background: var(--primary); color: var(--primary-text); }
  .secondary { background: var(--bg); color: var(--text); border-color: var(--border); }
  .ghost { background: transparent; color: var(--text); }
  .spinner {
    display: inline-block;
    width: .75rem;
    height: .75rem;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
```

`frontend/src/components/ui/Input.svelte`:

```svelte
<script lang="ts">
  let {
    type = 'text',
    value = $bindable(''),
    placeholder = '',
    error = '',
    autocomplete = '',
    autofocus = false,
    name = '',
  } = $props();
</script>

<input
  {type}
  bind:value
  {placeholder}
  {autocomplete}
  {autofocus}
  {name}
  class="input"
  class:error={!!error}
/>

<style>
  .input {
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
  }
  .input.error { border-color: var(--danger); }
</style>
```

`frontend/src/components/ui/FormRow.svelte`:

```svelte
<script lang="ts">
  let { label = '', error = '', helper = '', children } = $props();
</script>

<div class="form-row">
  {#if label}<label>{label}</label>{/if}
  {@render children?.()}
  {#if error}<div class="error-text">{error}</div>{/if}
  {#if helper && !error}<div class="helper-text">{helper}</div>{/if}
</div>

<style>
  .form-row { display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-3); }
  label { font-weight: 500; font-size: 0.875rem; }
  .error-text { color: var(--danger); font-size: 0.875rem; }
  .helper-text { color: var(--muted); font-size: 0.875rem; }
</style>
```

`frontend/src/components/ui/Spinner.svelte`:

```svelte
<div class="spinner" role="status" aria-label="Loading"></div>

<style>
  .spinner {
    display: inline-block;
    width: 1.25rem;
    height: 1.25rem;
    border: 2px solid var(--muted);
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
```

`frontend/src/components/chrome/Toast.svelte`:

```svelte
<script lang="ts">
  import type { Toast } from '../../lib/types';
  let { toast }: { toast: Toast } = $props();
</script>

<div class="toast {toast.kind}" role="status">{toast.message}</div>

<style>
  .toast {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius);
    background: var(--text);
    color: var(--bg);
    margin-bottom: var(--space-2);
    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
    max-width: 360px;
  }
  .error { background: var(--danger); }
  .success { background: var(--success); }
</style>
```

`frontend/src/components/chrome/Toaster.svelte`:

```svelte
<script lang="ts">
  import { toasts } from '../../stores/toasts.svelte';
  import Toast from './Toast.svelte';
</script>

<div class="toaster">
  {#each toasts.list as t (t.id)}
    <Toast toast={t} />
  {/each}
</div>

<style>
  .toaster {
    position: fixed;
    top: var(--space-3);
    right: var(--space-3);
    z-index: 9999;
    display: flex;
    flex-direction: column;
  }
</style>
```

- [ ] **Step 5: Verify check + smoke test still pass**

Run: `cd frontend && npm run check && npm run test`
Expected: 0 errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/styles/ frontend/src/app.css frontend/src/components/
git commit -m "feat(frontend): reset/base CSS + UI primitives + Toaster"
```

---

## Task 16: `routes.ts` + `main.ts` boot wiring + replace `App.svelte`

**Files:**
- Create: `frontend/src/routes.ts`
- Create: `frontend/src/pages/Login.svelte` (placeholder)
- Create: `frontend/src/pages/CourseList.svelte` (placeholder)
- Create: `frontend/src/pages/CourseView.svelte` (placeholder)
- Create: `frontend/src/pages/SequencePlayer.svelte` (placeholder)
- Create: `frontend/src/pages/NotFound.svelte`
- Modify: `frontend/src/main.ts`
- Modify: `frontend/src/App.svelte`

- [ ] **Step 1: Create page placeholders**

`frontend/src/pages/Login.svelte`:
```svelte
<h1>Login (placeholder)</h1>
```

`frontend/src/pages/CourseList.svelte`:
```svelte
<h1>Courses (placeholder)</h1>
```

`frontend/src/pages/CourseView.svelte`:
```svelte
<h1>Course view (placeholder)</h1>
```

`frontend/src/pages/SequencePlayer.svelte`:
```svelte
<h1>Sequence player (placeholder)</h1>
```

`frontend/src/pages/NotFound.svelte`:
```svelte
<h1>Page not found</h1>
<p><a href="/courses">Back to courses</a></p>
```

- [ ] **Step 2: Create `routes.ts`**

`frontend/src/routes.ts`:

```ts
import type { Route } from './lib/router.svelte';

export const routes: Route[] = [
  { path: '/login', component: 'Login', auth: false },
  { path: '/courses', component: 'CourseList', auth: true },
  { path: '/courses/:courseSlug', component: 'CourseView', auth: true },
  { path: '/courses/:courseSlug/seq/:sequenceId', component: 'SequencePlayer', auth: true },
];
```

- [ ] **Step 3: Replace `App.svelte` with router outlet**

`frontend/src/App.svelte`:

```svelte
<script lang="ts">
  import type { Component } from 'svelte';
  import { currentRoute, matchRoute, navigate } from './lib/router.svelte';
  import { routes } from './routes';
  import { session } from './stores/session.svelte';
  import Toaster from './components/chrome/Toaster.svelte';
  import Spinner from './components/ui/Spinner.svelte';
  import Login from './pages/Login.svelte';
  import CourseList from './pages/CourseList.svelte';
  import CourseView from './pages/CourseView.svelte';
  import SequencePlayer from './pages/SequencePlayer.svelte';
  import NotFound from './pages/NotFound.svelte';

  const componentMap: Record<string, Component<Record<string, string>>> = {
    Login: Login as Component<Record<string, string>>,
    CourseList: CourseList as Component<Record<string, string>>,
    CourseView: CourseView as Component<Record<string, string>>,
    SequencePlayer: SequencePlayer as Component<Record<string, string>>,
  };

  const matched = $derived(matchRoute(routes, currentRoute.path));

  // Path-level guard. Hash-only changes do not re-evaluate (intentional).
  $effect(() => {
    if (currentRoute.path === '/' && !session.loading) {
      navigate('/courses', { replace: true });
      return;
    }
    if (matched && matched.route.auth && session.user === null && !session.loading) {
      const next = encodeURIComponent(currentRoute.path + currentRoute.search + currentRoute.hash);
      navigate(`/login?next=${next}`, { replace: true });
    }
  });
</script>

{#if session.loading}
  <div class="loading"><Spinner /></div>
{:else if matched}
  {@const Comp = componentMap[matched.route.component]}
  <Comp {...matched.params} />
{:else}
  <NotFound />
{/if}
<Toaster />

<style>
  .loading { display: flex; justify-content: center; padding: var(--space-6); }
</style>
```

- [ ] **Step 4: Replace `main.ts` with full boot order**

`frontend/src/main.ts`:

```ts
import { mount } from 'svelte';
import App from './App.svelte';
import { onUnauthorized } from './lib/events';
import { startRouter, navigate, safeNext } from './lib/router.svelte';
import { bootstrapSession } from './lib/auth.svelte';
import { clearSession } from './stores/session.svelte';
import { clearCourse } from './stores/currentCourse.svelte';
import { clearToasts } from './stores/toasts.svelte';
import './app.css';

// Step 1: wire events. After this, any 401 from api.ts triggers logout-redirect.
onUnauthorized((path) => {
  clearSession();
  clearCourse();
  clearToasts();
  navigate(`/login?next=${encodeURIComponent(safeNext(path, location.origin))}`);
});

// Step 2: start router (popstate + hashchange listeners).
startRouter();

// Step 3: mount app (renders spinner while session.loading is true).
const app = mount(App, { target: document.getElementById('app')! });

// Step 4: bootstrap session — populates session.user from /api/auth/me, then App
// re-renders the right route.
void bootstrapSession();

export default app;
```

- [ ] **Step 5: Verify check + tests + dev server starts**

Run: `cd frontend && npm run check`
Expected: `0 errors`.

Run: `cd frontend && npm run test`
Expected: all tests pass.

Run: `cd frontend && npm run build`
Expected: builds cleanly.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes.ts frontend/src/pages/ frontend/src/main.ts frontend/src/App.svelte
git commit -m "feat(frontend): boot wiring + router outlet + page placeholders"
```

---

## Task 17: Real `Login.svelte` (email step → PIN step)

**Files:**
- Replace: `frontend/src/pages/Login.svelte`

- [ ] **Step 1: Write the page**

`frontend/src/pages/Login.svelte`:

```svelte
<script lang="ts">
  import { requestPin, verifyPin } from '../lib/auth.svelte';
  import { ApiError } from '../lib/api';
  import { navigate, safeNext } from '../lib/router.svelte';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';
  import FormRow from '../components/ui/FormRow.svelte';

  type Step = 'email' | 'pin';
  let step = $state<Step>('email');
  let email = $state('');
  let pin = $state('');
  let duration = $state<1 | 7 | 30>(7);
  let busy = $state(false);
  let error = $state('');

  async function onSubmitEmail(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = '';
    busy = true;
    try {
      await requestPin(email.trim());
      step = 'pin';
    } catch (err: unknown) {
      error = err instanceof ApiError ? err.displayMessage : 'Could not send PIN. Try again.';
    } finally {
      busy = false;
    }
  }

  async function onSubmitPin(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = '';
    busy = true;
    try {
      await verifyPin(email.trim(), pin.trim(), duration);
      const params = new URLSearchParams(location.search);
      const next = params.get('next') ?? '/courses';
      navigate(safeNext(decodeURIComponent(next), location.origin), { replace: true });
    } catch (err: unknown) {
      error = err instanceof ApiError ? err.displayMessage : 'Could not verify PIN.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="login">
  <h1>Sign in</h1>

  {#if step === 'email'}
    <form onsubmit={onSubmitEmail}>
      <FormRow label="Email" error={error}>
        <Input type="email" bind:value={email} autocomplete="email" autofocus name="email" />
      </FormRow>
      <Button type="submit" loading={busy} disabled={!email || busy}>
        Send PIN
      </Button>
    </form>
  {:else}
    <p class="subtitle">A 6-digit PIN was sent to <strong>{email}</strong> (if registered).</p>
    <form onsubmit={onSubmitPin}>
      <FormRow label="PIN" error={error}>
        <Input type="text" bind:value={pin} autocomplete="one-time-code" autofocus name="pin" />
      </FormRow>
      <FormRow label="Stay signed in for">
        <select bind:value={duration}>
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
        </select>
      </FormRow>
      <div class="actions">
        <Button type="submit" loading={busy} disabled={pin.length !== 6 || busy}>Sign in</Button>
        <Button variant="ghost" onclick={() => { step = 'email'; pin = ''; error = ''; }}>Back</Button>
      </div>
    </form>
  {/if}
</div>

<style>
  .login { max-width: 360px; margin: var(--space-6) auto; padding: var(--space-3); }
  .subtitle { color: var(--muted); margin-bottom: var(--space-3); }
  .actions { display: flex; gap: var(--space-2); }
  select {
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
  }
</style>
```

- [ ] **Step 2: Verify check + manual smoke**

Run: `cd frontend && npm run check`
Expected: `0 errors`.

Run: `cd frontend && npm run dev` (in one terminal) and `cd backend && uvicorn mathion.main:app --reload` (in another). Open `http://localhost:5173/login`. Enter an email, submit, observe transition to PIN step. (Backend will silently 200 even if email isn't registered, per anti-enumeration; without a real PIN you can't complete login here — this is just visual smoke.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Login.svelte
git commit -m "feat(frontend): Login.svelte — email + PIN two-step flow"
```

---

# Section E — Course discovery

## Task 18: `CourseList.svelte` + `CourseCard.svelte`

**Files:**
- Replace: `frontend/src/pages/CourseList.svelte`
- Create: `frontend/src/components/course/CourseCard.svelte`

- [ ] **Step 1: Create `CourseCard.svelte`**

`frontend/src/components/course/CourseCard.svelte`:

```svelte
<script lang="ts">
  import type { CourseListItem } from '../../lib/types';
  import { formatProgress } from '../../lib/format';
  import { navigate } from '../../lib/router.svelte';
  let { course }: { course: CourseListItem } = $props();
</script>

<a class="card" href={`/courses/${course.course_slug}`} onclick={(e) => { e.preventDefault(); navigate(`/courses/${course.course_slug}`); }}>
  <h3>{course.course_title}</h3>
  <div class="progress">{formatProgress(course.covered_items, course.total_items)}</div>
</a>

<style>
  .card {
    display: block;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    text-decoration: none;
    color: var(--text);
  }
  .card:hover { border-color: var(--primary); }
  .progress { color: var(--muted); font-size: 0.875rem; margin-top: var(--space-2); }
</style>
```

- [ ] **Step 2: Replace `CourseList.svelte`**

`frontend/src/pages/CourseList.svelte`:

```svelte
<script lang="ts">
  import { api, ApiError } from '../lib/api';
  import { logout } from '../lib/auth.svelte';
  import { session } from '../stores/session.svelte';
  import { pushToast } from '../stores/toasts.svelte';
  import type { CourseListItem } from '../lib/types';
  import CourseCard from '../components/course/CourseCard.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import Button from '../components/ui/Button.svelte';

  let loading = $state(true);
  let courses = $state<CourseListItem[]>([]);
  let error = $state('');

  $effect(() => {
    loading = true;
    api.get<CourseListItem[]>('/api/my-courses')
      .then((cs) => { courses = cs; })
      .catch((e: unknown) => { error = e instanceof ApiError ? e.displayMessage : 'Failed to load courses.'; })
      .finally(() => { loading = false; });
  });
</script>

<div class="page">
  <header>
    <h1>Your courses</h1>
    <div class="user">
      {session.user?.full_name ?? session.user?.email}
      <Button variant="ghost" onclick={() => { void logout().catch((e) => pushToast(String(e), 'error')); }}>Sign out</Button>
    </div>
  </header>

  {#if loading}
    <Spinner />
  {:else if error}
    <p class="error">{error}</p>
  {:else if courses.length === 0}
    <p class="empty">You're not enrolled in any courses yet — ask your teacher for an invite.</p>
  {:else}
    <div class="grid">
      {#each courses as c (c.course_id)}
        <CourseCard course={c} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-4); }
  .user { display: flex; align-items: center; gap: var(--space-2); color: var(--muted); }
  .grid { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  .empty { color: var(--muted); padding: var(--space-6) 0; text-align: center; }
  .error { color: var(--danger); }
</style>
```

- [ ] **Step 3: Verify check + manual smoke**

Run: `cd frontend && npm run check`. Expected: `0 errors`.

Manual: log in, navigate to `/courses`. Expect either the grid or empty-state message.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/CourseList.svelte frontend/src/components/course/CourseCard.svelte
git commit -m "feat(frontend): CourseList + CourseCard"
```

---

## Task 19: `CourseView.svelte` + `BlockGroup.svelte` + `SequenceLink.svelte`

**Files:**
- Replace: `frontend/src/pages/CourseView.svelte`
- Create: `frontend/src/components/course/BlockGroup.svelte`
- Create: `frontend/src/components/course/SequenceLink.svelte`

- [ ] **Step 1: Create `SequenceLink.svelte`**

`frontend/src/components/course/SequenceLink.svelte`:

```svelte
<script lang="ts">
  import type { SequenceContent, VersionState } from '../../lib/types';
  import { formatProgress } from '../../lib/format';
  import { navigate } from '../../lib/router.svelte';

  let { courseSlug, sequence, state }: { courseSlug: string; sequence: SequenceContent; state: VersionState } = $props();

  const total = sequence.items.length;
  const covered = $derived(
    sequence.items.filter((it) => state.items[String(it.id)]?.is_covered).length,
  );
  const href = `/courses/${courseSlug}/seq/${sequence.id}`;
</script>

<a class="row" {href} onclick={(e) => { e.preventDefault(); navigate(href); }}>
  <span class="title">{sequence.title}</span>
  <span class="progress">
    {formatProgress(covered, total)}
    {#if covered === total && total > 0}<span class="check">✓</span>{/if}
  </span>
</a>

<style>
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius);
    color: var(--text);
  }
  .row:hover { background: var(--border); }
  .progress { color: var(--muted); font-size: 0.875rem; }
  .check { color: var(--success); margin-left: var(--space-1); }
</style>
```

- [ ] **Step 2: Create `BlockGroup.svelte`**

`frontend/src/components/course/BlockGroup.svelte`:

```svelte
<script lang="ts">
  import type { BlockContent, VersionState } from '../../lib/types';
  import SequenceLink from './SequenceLink.svelte';

  let { courseSlug, block, state }: { courseSlug: string; block: BlockContent; state: VersionState } = $props();

  let expanded = $state(true);
</script>

<section class="block">
  <header onclick={() => (expanded = !expanded)}>
    <h2>{block.title}</h2>
    <span class="toggle">{expanded ? '▾' : '▸'}</span>
  </header>
  {#if expanded}
    {#if block.info_html}
      <div class="info">{@html block.info_html}</div>
    {/if}
    <ul>
      {#each block.sequences as s (s.id)}
        <li><SequenceLink {courseSlug} sequence={s} {state} /></li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .block { border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: var(--space-3); padding: var(--space-3); }
  header { display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
  .info { color: var(--muted); margin: var(--space-2) 0; }
  .toggle { color: var(--muted); }
</style>
```

- [ ] **Step 3: Replace `CourseView.svelte`**

`frontend/src/pages/CourseView.svelte`:

```svelte
<script lang="ts">
  import { ApiError } from '../lib/api';
  import { currentCourse, loadCourse } from '../stores/currentCourse.svelte';
  import { navigate } from '../lib/router.svelte';
  import BlockGroup from '../components/course/BlockGroup.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import Button from '../components/ui/Button.svelte';

  let { courseSlug }: { courseSlug: string } = $props();

  let loading = $state(true);
  let error = $state<{ status: number; message: string } | null>(null);

  $effect(() => {
    loading = true;
    error = null;
    loadCourse(courseSlug)
      .catch((e: unknown) => {
        if (e instanceof ApiError) {
          error = { status: e.status, message: e.displayMessage };
        } else {
          error = { status: 500, message: 'Could not load course.' };
        }
      })
      .finally(() => { loading = false; });
  });
</script>

<div class="page">
  {#if loading}
    <Spinner />
  {:else if error}
    {#if error.status === 404}
      <h1>Course not available</h1>
      <p>This course isn't available to you. Ask your teacher for an invite link, or check the URL.</p>
    {:else if error.status === 403}
      <h1>Access denied</h1>
      <p>You don't have access to this course.</p>
    {:else}
      <h1>Couldn't load course</h1>
      <p>{error.message}</p>
    {/if}
    <Button variant="ghost" onclick={() => navigate('/courses')}>Back to courses</Button>
  {:else if currentCourse.value}
    <header>
      <Button variant="ghost" onclick={() => navigate('/courses')}>← Courses</Button>
      <h1>{currentCourse.value.course.title}</h1>
    </header>
    {#if currentCourse.value.version.info_html}
      <div class="info">{@html currentCourse.value.version.info_html}</div>
    {/if}
    {#if currentCourse.value.blocks.length === 0}
      <p class="empty">This course has no published blocks yet.</p>
    {:else}
      {#each currentCourse.value.blocks as b (b.id)}
        <BlockGroup {courseSlug} block={b} state={currentCourse.value.state} />
      {/each}
    {/if}
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  .info { color: var(--muted); margin: var(--space-3) 0; }
  .empty { color: var(--muted); }
</style>
```

- [ ] **Step 4: Verify check + manual smoke**

Run: `cd frontend && npm run check`. Expected: `0 errors`.

Manual: navigate from `/courses` into a course. Expect block tree.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/CourseView.svelte frontend/src/components/course/BlockGroup.svelte frontend/src/components/course/SequenceLink.svelte
git commit -m "feat(frontend): CourseView + BlockGroup + SequenceLink"
```

---

# Section F — Sequence player + items

## Task 20: `ItemRouter.svelte` + `UnsupportedItem.svelte` + simple item viewers

**Files:**
- Create: `frontend/src/components/items/ItemRouter.svelte`
- Create: `frontend/src/components/items/UnsupportedItem.svelte`
- Create: `frontend/src/components/items/PageItem.svelte`
- Create: `frontend/src/components/items/VideoItem.svelte`

(Quiz + MiniProject + InteractiveApp follow in Task 22.)

- [ ] **Step 1: Create `UnsupportedItem.svelte`**

`frontend/src/components/items/UnsupportedItem.svelte`:

```svelte
<script lang="ts">
  let { type }: { type: string } = $props();
</script>

<div class="unsupported">
  <p>This item type ("{type}") isn't available in this view yet.</p>
</div>

<style>
  .unsupported { padding: var(--space-3); border: 1px dashed var(--border); border-radius: var(--radius); color: var(--muted); }
</style>
```

- [ ] **Step 2: Create `PageItem.svelte`**

`frontend/src/components/items/PageItem.svelte`:

```svelte
<script lang="ts">
  import type { StaticPageItem } from '../../lib/types';
  import { createCoverageTracker } from '../../lib/coverage.svelte';
  import { markItemCovered } from '../../stores/currentCourse.svelte';

  let { item }: { item: StaticPageItem } = $props();

  // Trust boundary: content_html is sanitized server-side at write-time via
  // mathion/markdown.py (nh3). Any future content source MUST pass through
  // the same sanitiser before being rendered with @html.
  $effect(() => {
    const tracker = createCoverageTracker(item.id);
    let coveredAt = 0;
    let interval: ReturnType<typeof setInterval> | null = null;
    tracker.start();
    // Set covered after 30 s of *active* time. We poll every 1 s; tracker
    // accrues real visible time internally. We stop polling once covered.
    interval = setInterval(() => {
      coveredAt += 1000;
      if (coveredAt >= 30_000) {
        void tracker.markCovered();
        markItemCovered(item.id);
        if (interval !== null) { clearInterval(interval); interval = null; }
      }
    }, 1000);
    return () => {
      if (interval !== null) clearInterval(interval);
      void tracker.stop();
    };
  });
</script>

<article class="page-item">
  <h2>{item.title}</h2>
  <div class="content">{@html item.content_html}</div>
</article>

<style>
  .page-item { padding: var(--space-3); }
  .content :global(p) { margin-bottom: var(--space-3); line-height: 1.6; }
  .content :global(h1), .content :global(h2), .content :global(h3) { margin: var(--space-4) 0 var(--space-2); }
  .content :global(ul), .content :global(ol) { padding-left: var(--space-4); margin-bottom: var(--space-3); }
  .content :global(li) { list-style: disc; }
</style>
```

- [ ] **Step 3: Create `VideoItem.svelte`**

`frontend/src/components/items/VideoItem.svelte`:

```svelte
<script lang="ts">
  import type { VideoItem } from '../../lib/types';
  import { createCoverageTracker } from '../../lib/coverage.svelte';
  import { markItemCovered } from '../../stores/currentCourse.svelte';
  import Button from '../ui/Button.svelte';

  let { item, isCovered }: { item: VideoItem; isCovered: boolean } = $props();

  let busy = $state(false);
  let tracker: ReturnType<typeof createCoverageTracker> | null = null;

  $effect(() => {
    tracker = createCoverageTracker(item.id);
    tracker.start();
    return () => { void tracker?.stop(); };
  });

  async function markWatched(): Promise<void> {
    if (!tracker) return;
    busy = true;
    try {
      await tracker.markCovered();
      markItemCovered(item.id);
    } finally {
      busy = false;
    }
  }
</script>

<article class="video-item">
  <h2>{item.title}</h2>
  <div class="frame">
    <iframe src={item.video_url} title={item.title} allowfullscreen></iframe>
  </div>
  {#if !isCovered}
    <Button onclick={markWatched} loading={busy}>Mark as watched</Button>
  {:else}
    <p class="watched">✓ Marked as watched</p>
  {/if}
</article>

<style>
  .video-item { padding: var(--space-3); }
  .frame { position: relative; padding-bottom: 56.25%; height: 0; margin-bottom: var(--space-3); }
  .frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
  .watched { color: var(--success); }
</style>
```

- [ ] **Step 4: Create `ItemRouter.svelte`**

`frontend/src/components/items/ItemRouter.svelte`:

```svelte
<script lang="ts">
  import type { Item, VersionState } from '../../lib/types';
  import { assertNever } from '../../lib/types';
  import PageItem from './PageItem.svelte';
  import VideoItem from './VideoItem.svelte';
  import UnsupportedItem from './UnsupportedItem.svelte';

  let { item, state }: { item: Item; state: VersionState } = $props();
  const isCovered = $derived(state.items[String(item.id)]?.is_covered ?? false);
</script>

{#if item.type === 'static_page'}
  <PageItem {item} />
{:else if item.type === 'video'}
  <VideoItem {item} {isCovered} />
{:else if item.type === 'quiz'}
  <UnsupportedItem type="quiz" />
{:else if item.type === 'mini_project'}
  <UnsupportedItem type="mini_project" />
{:else if item.type === 'interactive_app'}
  <UnsupportedItem type="interactive_app" />
{:else}
  {@const _exhaustive = assertNever(item)}
  <UnsupportedItem type={(item as { type: string }).type} />
{/if}
```

- [ ] **Step 5: Verify check**

Run: `cd frontend && npm run check`. Expected: `0 errors`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/items/
git commit -m "feat(frontend): ItemRouter + PageItem + VideoItem + UnsupportedItem"
```

---

## Task 21: `SequencePlayer.svelte` + `ItemIcon.svelte`

**Files:**
- Replace: `frontend/src/pages/SequencePlayer.svelte`
- Create: `frontend/src/components/course/ItemIcon.svelte`

- [ ] **Step 1: Create `ItemIcon.svelte`**

`frontend/src/components/course/ItemIcon.svelte`:

```svelte
<script lang="ts">
  import type { Item } from '../../lib/types';

  type State = 'covered' | 'current' | 'not-yet';
  let { item, state, onclick }: { item: Item; state: State; onclick: () => void } = $props();

  const icon = $derived(
    item.type === 'static_page' ? '📄' :
    item.type === 'video' ? '▶' :
    item.type === 'quiz' ? '?' :
    item.type === 'mini_project' ? '★' :
    '⌘'
  );
</script>

<button class="icon {state}" {onclick} title={item.title} aria-label={item.title}>
  {icon}
</button>

<style>
  .icon {
    width: 36px;
    height: 36px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
  }
  .covered { background: #cde; }
  .current { background: var(--primary); color: var(--primary-text); border-color: var(--primary); }
  .not-yet { opacity: 0.65; }
</style>
```

- [ ] **Step 2: Replace `SequencePlayer.svelte`**

`frontend/src/pages/SequencePlayer.svelte`:

```svelte
<script lang="ts">
  import { ApiError } from '../lib/api';
  import { currentCourse, loadCourse, recordItemVisit } from '../stores/currentCourse.svelte';
  import { currentRoute, navigate } from '../lib/router.svelte';
  import ItemRouter from '../components/items/ItemRouter.svelte';
  import ItemIcon from '../components/course/ItemIcon.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import Button from '../components/ui/Button.svelte';
  import type { SequenceContent, Item } from '../lib/types';

  let { courseSlug, sequenceId }: { courseSlug: string; sequenceId: string } = $props();

  let loading = $state(true);
  let error = $state<{ status: number; message: string } | null>(null);

  $effect(() => {
    if (currentCourse.value?.slug !== courseSlug) {
      loading = true;
      error = null;
      loadCourse(courseSlug)
        .catch((e: unknown) => {
          if (e instanceof ApiError) error = { status: e.status, message: e.displayMessage };
          else error = { status: 500, message: 'Could not load course.' };
        })
        .finally(() => { loading = false; });
    } else {
      loading = false;
    }
  });

  const sequence = $derived<SequenceContent | null>(
    currentCourse.value?.blocks
      .flatMap((b) => b.sequences)
      .find((s) => String(s.id) === sequenceId) ?? null,
  );

  // Initial item resolution: hash → last_visited_at → first.
  function resolveInitialItemId(seq: SequenceContent): number | null {
    if (seq.items.length === 0) return null;
    const m = currentRoute.hash.match(/^#item=(\d+)$/);
    if (m) {
      const hashed = Number(m[1]);
      if (seq.items.some((it) => it.id === hashed)) return hashed;
    }
    const stateItems = currentCourse.value?.state.items ?? {};
    let bestId: number | null = null;
    let bestTime = -Infinity;
    for (const it of seq.items) {
      const visited = stateItems[String(it.id)]?.last_visited_at;
      if (visited) {
        const t = new Date(visited).getTime();
        if (t > bestTime) { bestTime = t; bestId = it.id; }
      }
    }
    return bestId ?? seq.items[0].id;
  }

  let currentItemId = $state<number | null>(null);

  $effect(() => {
    if (sequence && currentItemId === null) {
      const initial = resolveInitialItemId(sequence);
      if (initial !== null) {
        navigate(`/courses/${courseSlug}/seq/${sequenceId}#item=${initial}`, { replace: true });
      }
    }
  });

  // React to hash changes (#item=).
  $effect(() => {
    const m = currentRoute.hash.match(/^#item=(\d+)$/);
    if (m) {
      const newId = Number(m[1]);
      if (newId !== currentItemId) {
        currentItemId = newId;
        recordItemVisit(newId);
      }
    }
  });

  const currentItem = $derived<Item | null>(
    sequence?.items.find((it) => it.id === currentItemId) ?? null,
  );

  function selectItem(id: number): void {
    navigate(`/courses/${courseSlug}/seq/${sequenceId}#item=${id}`, { replace: true });
  }

  const currentIndex = $derived(
    sequence && currentItemId !== null ? sequence.items.findIndex((it) => it.id === currentItemId) : -1,
  );

  function previous(): void {
    if (sequence && currentIndex > 0) selectItem(sequence.items[currentIndex - 1].id);
  }
  function next(): void {
    if (sequence && currentIndex >= 0 && currentIndex < sequence.items.length - 1) {
      selectItem(sequence.items[currentIndex + 1].id);
    }
  }

  function iconState(itemId: number): 'covered' | 'current' | 'not-yet' {
    if (itemId === currentItemId) return 'current';
    if (currentCourse.value?.state.items[String(itemId)]?.is_covered) return 'covered';
    return 'not-yet';
  }
</script>

<div class="page">
  {#if loading}
    <Spinner />
  {:else if error}
    {#if error.status === 404 || error.status === 403}
      <h1>Sequence not available</h1>
      <p>This sequence isn't available to you.</p>
    {:else}
      <h1>Couldn't load</h1>
      <p>{error.message}</p>
    {/if}
    <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}`)}>← Course</Button>
  {:else if !sequence}
    <h1>Sequence not found</h1>
    <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}`)}>← Course</Button>
  {:else if sequence.items.length === 0}
    <header>
      <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}`)}>← {currentCourse.value?.course.title}</Button>
      <h1>{sequence.title}</h1>
    </header>
    <p class="empty">This sequence has no items yet.</p>
  {:else}
    <header>
      <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}`)}>← {currentCourse.value?.course.title}</Button>
      <h1>{sequence.title}</h1>
    </header>

    <nav class="strip" aria-label="Items">
      {#each sequence.items as it (it.id)}
        <ItemIcon item={it} state={iconState(it.id)} onclick={() => selectItem(it.id)} />
      {/each}
      <span class="counter">Item {currentIndex + 1} of {sequence.items.length}</span>
    </nav>

    <main class="content">
      {#if currentItem && currentCourse.value}
        <ItemRouter item={currentItem} state={currentCourse.value.state} />
      {/if}
    </main>

    <footer>
      <Button variant="secondary" onclick={previous} disabled={currentIndex <= 0}>← Previous</Button>
      <Button variant="secondary" onclick={next} disabled={currentIndex >= sequence.items.length - 1}>Next →</Button>
    </footer>
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  .strip {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border);
    align-items: center;
    flex-wrap: wrap;
  }
  .counter { margin-left: auto; color: var(--muted); font-size: 0.875rem; }
  .content { padding: var(--space-3) 0; min-height: 200px; }
  footer { display: flex; justify-content: space-between; padding-top: var(--space-3); border-top: 1px solid var(--border); }
  .empty { color: var(--muted); }
</style>
```

- [ ] **Step 3: Verify check + manual smoke**

Run: `cd frontend && npm run check`. Expected: `0 errors`.

Manual: open a sequence URL like `/courses/<slug>/seq/<id>`. Expect the strip + content. Click icons → URL hash updates, content swaps.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SequencePlayer.svelte frontend/src/components/course/ItemIcon.svelte
git commit -m "feat(frontend): SequencePlayer + ItemIcon — strip nav + hash-driven items + coverage"
```

---

## Task 22: `QuizItem.svelte` + question subcomponents

**Files:**
- Create: `frontend/src/components/items/QuizItem.svelte`
- Create: `frontend/src/components/items/quiz/SingleChoiceQuestion.svelte`
- Create: `frontend/src/components/items/quiz/MultiChoiceQuestion.svelte`
- Create: `frontend/src/components/items/quiz/NumericQuestion.svelte`
- Create: `frontend/src/components/items/quiz/TextQuestion.svelte`
- Modify: `frontend/src/components/items/ItemRouter.svelte`

- [ ] **Step 1: Create `SingleChoiceQuestion.svelte`**

`frontend/src/components/items/quiz/SingleChoiceQuestion.svelte`:

```svelte
<script lang="ts">
  import type { SingleChoiceQuestion } from '../../../lib/types';

  let { question, value, onanswer }: {
    question: SingleChoiceQuestion;
    value: number[] | string | undefined;
    onanswer: (ans: number[]) => void;
  } = $props();

  const selected = $derived(Array.isArray(value) && value.length === 1 ? value[0] : null);
</script>

<fieldset>
  <legend><div class="text">{@html question.text_html}</div></legend>
  {#each question.options as opt (opt.id)}
    <label class="opt">
      <input
        type="radio"
        name={`q-${question.id}`}
        value={opt.id}
        checked={selected === opt.id}
        onchange={() => onanswer([opt.id])}
      />
      {opt.text}
    </label>
  {/each}
</fieldset>

<style>
  fieldset { border: 0; padding: 0; margin: 0 0 var(--space-3) 0; }
  legend { font-weight: 500; }
  .text :global(p) { margin: 0 0 var(--space-2) 0; }
  .opt { display: block; padding: var(--space-1) 0; }
</style>
```

- [ ] **Step 2: Create `MultiChoiceQuestion.svelte`**

`frontend/src/components/items/quiz/MultiChoiceQuestion.svelte`:

```svelte
<script lang="ts">
  import type { MultipleChoiceQuestion } from '../../../lib/types';

  let { question, value, onanswer }: {
    question: MultipleChoiceQuestion;
    value: number[] | string | undefined;
    onanswer: (ans: number[]) => void;
  } = $props();

  const selected = $derived<Set<number>>(new Set(Array.isArray(value) ? value : []));

  function toggle(id: number): void {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onanswer([...next].sort((a, b) => a - b));
  }
</script>

<fieldset>
  <legend><div class="text">{@html question.text_html}</div></legend>
  {#each question.options as opt (opt.id)}
    <label class="opt">
      <input
        type="checkbox"
        checked={selected.has(opt.id)}
        onchange={() => toggle(opt.id)}
      />
      {opt.text}
    </label>
  {/each}
</fieldset>

<style>
  fieldset { border: 0; padding: 0; margin: 0 0 var(--space-3) 0; }
  legend { font-weight: 500; }
  .text :global(p) { margin: 0 0 var(--space-2) 0; }
  .opt { display: block; padding: var(--space-1) 0; }
</style>
```

- [ ] **Step 3: Create `NumericQuestion.svelte`**

`frontend/src/components/items/quiz/NumericQuestion.svelte`:

```svelte
<script lang="ts">
  import type { NumericQuestion } from '../../../lib/types';

  let { question, value, onanswer }: {
    question: NumericQuestion;
    value: number[] | string | undefined;
    onanswer: (ans: string) => void;
  } = $props();

  const text = $derived(typeof value === 'string' ? value : '');
</script>

<div class="row">
  <div class="text">{@html question.text_html}</div>
  <input
    type="text"
    inputmode="decimal"
    value={text}
    oninput={(e) => onanswer((e.currentTarget as HTMLInputElement).value)}
  />
</div>

<style>
  .row { margin-bottom: var(--space-3); }
  .text :global(p) { margin: 0 0 var(--space-2) 0; }
  input { padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius); width: 160px; }
</style>
```

- [ ] **Step 4: Create `TextQuestion.svelte`**

`frontend/src/components/items/quiz/TextQuestion.svelte`:

```svelte
<script lang="ts">
  import type { TextQuestion } from '../../../lib/types';

  let { question, value, onanswer }: {
    question: TextQuestion;
    value: number[] | string | undefined;
    onanswer: (ans: string) => void;
  } = $props();

  const text = $derived(typeof value === 'string' ? value : '');
</script>

<div class="row">
  <div class="text">{@html question.text_html}</div>
  <input
    type="text"
    value={text}
    oninput={(e) => onanswer((e.currentTarget as HTMLInputElement).value)}
  />
</div>

<style>
  .row { margin-bottom: var(--space-3); }
  .text :global(p) { margin: 0 0 var(--space-2) 0; }
  input { padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius); width: 100%; max-width: 480px; }
</style>
```

- [ ] **Step 5: Create `QuizItem.svelte`**

`frontend/src/components/items/QuizItem.svelte`:

```svelte
<script lang="ts">
  import type { QuizItem, Question, QuizSubmitResponse, QuizRevealResponse } from '../../lib/types';
  import { api, ApiError } from '../../lib/api';
  import { markItemCovered } from '../../stores/currentCourse.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import { currentCourse } from '../../stores/currentCourse.svelte';
  import { assertNever } from '../../lib/types';
  import SingleChoice from './quiz/SingleChoiceQuestion.svelte';
  import MultiChoice from './quiz/MultiChoiceQuestion.svelte';
  import Numeric from './quiz/NumericQuestion.svelte';
  import Text from './quiz/TextQuestion.svelte';
  import Button from '../ui/Button.svelte';

  let { item }: { item: QuizItem } = $props();

  let answers = $state<Record<string, number[] | string>>({});
  let inflight = $state<Promise<QuizSubmitResponse> | null>(null);
  let lastResult = $state<QuizSubmitResponse | null>(null);
  let revealed = $state<QuizRevealResponse | null>(null);

  const allAnswered = $derived(
    item.questions.every((q) => {
      const a = answers[String(q.id)];
      if (a === undefined) return false;
      if (Array.isArray(a)) return a.length > 0;
      return typeof a === 'string' && a.trim().length > 0;
    })
  );

  function setAnswer(qid: number, ans: number[] | string): void {
    answers[String(qid)] = ans;
  }

  async function submit(): Promise<void> {
    if (inflight !== null) {
      void inflight;
      return;
    }
    try {
      inflight = api.post<QuizSubmitResponse>(`/api/items/${item.id}/submit`, { answers });
      const res = await inflight;
      lastResult = res;
      markItemCovered(item.id);
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.displayMessage : 'Submit failed.';
      pushToast(msg, 'error');
    } finally {
      inflight = null;
    }
  }

  function tryAgain(): void {
    answers = {};
    lastResult = null;
    revealed = null;
  }

  async function revealAnswers(): Promise<void> {
    try {
      revealed = await api.get<QuizRevealResponse>(`/api/items/${item.id}/reveal`);
    } catch (e: unknown) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Could not load answers.', 'error');
    }
  }

  // Exhaustiveness check — keep `assertNever` reachable so future Question.type
  // additions surface as compile errors at this site.
  function checkExhaustive(q: Question): void {
    switch (q.type) {
      case 'single_choice':
      case 'multiple_choice':
      case 'numeric_answer':
      case 'text_answer':
        return;
      default:
        assertNever(q);
    }
  }
  $effect(() => { item.questions.forEach(checkExhaustive); });
</script>

{#if item.questions.length === 0}
  <article class="quiz">
    <h2>{item.title}</h2>
    <p class="empty">This quiz has no questions yet.</p>
  </article>
{:else}
  <article class="quiz">
    <h2>{item.title}</h2>
    {#each item.questions as q (q.id)}
      {#if q.type === 'single_choice'}
        <SingleChoice question={q} value={answers[String(q.id)]} onanswer={(a) => setAnswer(q.id, a)} />
      {:else if q.type === 'multiple_choice'}
        <MultiChoice question={q} value={answers[String(q.id)]} onanswer={(a) => setAnswer(q.id, a)} />
      {:else if q.type === 'numeric_answer'}
        <Numeric question={q} value={answers[String(q.id)]} onanswer={(a) => setAnswer(q.id, a)} />
      {:else if q.type === 'text_answer'}
        <Text question={q} value={answers[String(q.id)]} onanswer={(a) => setAnswer(q.id, a)} />
      {/if}
    {/each}

    {#if !lastResult}
      <Button onclick={submit} loading={inflight !== null} disabled={!allAnswered || inflight !== null}>
        Submit
      </Button>
    {:else}
      <div class="result">
        <p><strong>Score:</strong> {lastResult.score_correct} / {lastResult.score_total}</p>
        <p class="meta">Attempt {lastResult.attempt_count} of {lastResult.max_attempts}</p>
        {#if lastResult.can_retry}
          <Button onclick={tryAgain}>Try again</Button>
        {:else if !revealed}
          <Button variant="secondary" onclick={revealAnswers}>Show correct answers</Button>
        {/if}
      </div>
      {#if revealed}
        <div class="reveal">
          <h3>Correct answers</h3>
          <ul>
            {#each revealed.questions as r (r.id)}
              <li>
                Q{r.id}:
                {#if r.correct_options}
                  options {r.correct_options.join(', ')}
                {:else if r.correct_value !== undefined}
                  {r.correct_value}
                {/if}
                {#if r.explanation_html}<div class="exp">{@html r.explanation_html}</div>{/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}
    <p class="hint">Maximum {currentCourse.value?.version.max_quiz_attempts ?? '?'} attempts per quiz.</p>
  </article>
{/if}

<style>
  .quiz { padding: var(--space-3); }
  .empty { color: var(--muted); }
  .result { padding: var(--space-3); margin-top: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); }
  .meta { color: var(--muted); font-size: 0.875rem; }
  .hint { color: var(--muted); font-size: 0.875rem; margin-top: var(--space-3); }
  .reveal { margin-top: var(--space-3); }
  .reveal li { margin-bottom: var(--space-2); }
  .exp { color: var(--muted); margin-top: var(--space-1); }
</style>
```

- [ ] **Step 6: Replace the `quiz` branch in `ItemRouter.svelte`**

In `frontend/src/components/items/ItemRouter.svelte`, change the script imports to include `QuizItem`:

```svelte
<script lang="ts">
  import type { Item, VersionState } from '../../lib/types';
  import { assertNever } from '../../lib/types';
  import PageItem from './PageItem.svelte';
  import VideoItem from './VideoItem.svelte';
  import QuizItem from './QuizItem.svelte';
  import UnsupportedItem from './UnsupportedItem.svelte';

  let { item, state }: { item: Item; state: VersionState } = $props();
  const isCovered = $derived(state.items[String(item.id)]?.is_covered ?? false);
</script>

{#if item.type === 'static_page'}
  <PageItem {item} />
{:else if item.type === 'video'}
  <VideoItem {item} {isCovered} />
{:else if item.type === 'quiz'}
  <QuizItem {item} />
{:else if item.type === 'mini_project'}
  <UnsupportedItem type="mini_project" />
{:else if item.type === 'interactive_app'}
  <UnsupportedItem type="interactive_app" />
{:else}
  {@const _exhaustive = assertNever(item)}
  <UnsupportedItem type={(item as { type: string }).type} />
{/if}
```

- [ ] **Step 7: Verify check + manual smoke**

Run: `cd frontend && npm run check`. Expected: `0 errors`.

Manual: open a quiz item. Answer all questions, click Submit, see aggregate score. Click Try again — answers cleared.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/items/
git commit -m "feat(frontend): QuizItem + 4 question subcomponents — single-flight submit + aggregate score"
```

---

## Task 23: Wire `/api/auth/me` to gracefully handle backend down

**Files:**
- Modify: `frontend/src/lib/auth.svelte.ts`

This is a small hardening pass: `bootstrapSession` should not crash the whole app if the backend is unreachable on startup.

- [ ] **Step 1: Update `bootstrapSession`**

In `frontend/src/lib/auth.svelte.ts`, change `bootstrapSession`:

```ts
export async function bootstrapSession(): Promise<void> {
  try {
    const u = await api.get<User>('/api/auth/me', { skipAuthRedirect: true });
    session.user = u;
  } catch (e: unknown) {
    if (e instanceof ApiError && e.status === 401) {
      session.user = null;
    } else {
      // Network error or 5xx — leave user=null, surface a toast for visibility.
      session.user = null;
      const msg = e instanceof ApiError ? e.displayMessage : 'Could not contact server.';
      const { pushToast } = await import('../stores/toasts.svelte');
      pushToast(msg, 'error');
    }
  } finally {
    session.loading = false;
  }
}
```

- [ ] **Step 2: Verify check**

Run: `cd frontend && npm run check`. Expected: `0 errors`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/auth.svelte.ts
git commit -m "fix(frontend): bootstrapSession tolerates network errors / 5xx"
```

---

## Task 24: Manual end-to-end smoke checklist

This task is **not code** — it's a manual verification pass. The implementer runs through the checklist with `cd frontend && npm run dev` + `cd backend && uvicorn mathion.main:app --reload`, checks each box, and reports findings to the user. No commit unless a fix is needed.

- [ ] **Run frontend dev server + backend**

Two terminals:
- Terminal A: `cd backend && uvicorn mathion.main:app --reload`
- Terminal B: `cd frontend && npm run dev`

Open `http://localhost:5173` in a browser.

- [ ] **Check 1: redirect to /login when anonymous**

Visit `/`. Expect redirect to `/login`.

- [ ] **Check 2: email submit transitions to PIN step**

On `/login`, enter any email, submit. Expect transition to PIN step. (Backend always returns 200 for unknown emails — anti-enumeration.)

- [ ] **Check 3: real login works**

Use a real seeded student account. Get the PIN from the backend log (or DB). Enter, click Sign in. Expect redirect to `/courses`.

- [ ] **Check 4: course list renders**

`/courses` shows enrolled courses or empty-state message.

- [ ] **Check 5: open course → block tree renders**

Click a course. Expect block tree with sequence links. Block info_html (if any) renders sanitized HTML.

- [ ] **Check 6: open sequence → strip + first item**

Click a sequence. Expect top-strip, content area, prev/next buttons. URL hash updates to `#item=<id>`.

- [ ] **Check 7: navigate items via strip**

Click different icons. Content swaps. URL hash updates. No page reload.

- [ ] **Check 8: PageItem coverage**

Open a static page. Wait 30 s. Refresh. Expect item shown as covered (icon background changes).

- [ ] **Check 9: VideoItem manual cover**

Open a video item. Click "Mark as watched". Refresh. Expect covered.

- [ ] **Check 10: QuizItem submit + try again**

Open a quiz. Answer all questions. Submit. See aggregate score. If retries left, click "Try again" — answers clear, can resubmit.

- [ ] **Check 11: zero-questions quiz empty state**

If you have an empty quiz, open it. Expect "This quiz has no questions yet." Submit hidden.

- [ ] **Check 12: 404 panel**

Visit `/courses/definitely-not-a-real-slug`. Expect "Course not available" panel + back button.

- [ ] **Check 13: hash deep link**

Visit `/courses/<slug>/seq/<id>#item=<valid-id>` directly while logged in. Expect that item to be the active one.

- [ ] **Check 14: post-login `next` redirect**

Log out (Sign out in CourseList). Visit `/courses/<slug>/seq/<id>#item=<id>` while anonymous. Expect redirect to `/login?next=...`. After login, expect redirect back to that exact URL with hash preserved.

- [ ] **Check 15: build + serve via backend**

Run: `cd frontend && npm run build`. Then run only the backend (no Vite dev server). Visit `http://localhost:8000/courses`. Expect SPA shell to load and route to courses.

Run: `curl -i http://localhost:8000/api/clearly-not-a-route`. Expect `HTTP/1.1 404` with JSON body.

Run: `curl -i http://localhost:8000/health`. Expect `200 OK`.

- [ ] **Step 16: Report**

Report the result of every check to the user. If any check fails, file a follow-up before declaring the slice done.

---

# Summary

**Total tasks:** 24 (3 backend + 7 lib/stores + 14 frontend UI/wiring/manual checklist).

**Test deltas:**
- Backend: +8 tests (2 in `test_blocks.py`, 6 in `test_main_spa.py`).
- Frontend: ~40 vitest unit tests for `lib/*` and `stores/*`.
- Components: no automated tests in V1 (per spec §11); manual checklist (Task 24).

**Branch + merge:**
- Implementer creates feature branch `feature/frontend-student-mvp` (via `superpowers:using-git-worktrees`).
- Each task commits.
- After Task 24 passes manually, dispatch `superpowers:finishing-a-development-branch` for review/merge.

---
