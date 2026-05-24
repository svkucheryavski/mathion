# Mini-Projects Authoring Frontend (slice A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5th "Mini-projects" tab on `RunDetailPage` for course-admin authoring (CRUD, publish, run-asset upload) with a modal hosting MarkdownEditor + AssetSidebar against a new `runAssetContext` adapter.

**Architecture:** Backend gains one ~20-line `POST /api/runs/{rid}/render` endpoint mirroring the existing version-render. Frontend introduces `AssetContext` adapter to replace `versionId: number` on MarkdownEditor + AssetSidebar; both components are refactored to share a single `uploadOne(file, batch?)` helper inside MarkdownEditor (controller + state lives there; sidebar receives `uploadOne` as `onUploadFile`). Sidebar `fetchAssets` gets a `loadToken` ratchet for race-safety. New components: `RunMiniProjectsTab` (list, gating, banners, force-delete confirm) and `MiniProjectModal` (create/edit/publish with `closeForCurrentStage` dirty-confirm via inline footer-row).

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest + jsdom, FastAPI/SQLAlchemy/pytest on backend.

**Spec:** `docs/superpowers/specs/2026-05-24-mini-projects-frontend-design.md` — read all cited line numbers in this plan as relative to that spec; section refs like §"Internal architecture" point into the spec.

**Per-task review loop:** After each task ships green tests, run BOTH a reviewer agent (Opus, high effort, lens = spec compliance + code quality) AND a codex round (paste-prompt template); fix all Critical/Important; re-review until clean before moving on. (Captured in user's `feedback_review_loop_per_task.md`.)

**Branch:** Create feature branch `frontend-mini-projects` off `main` before T1.

```bash
git checkout main
git pull
git checkout -b frontend-mini-projects
```

---

## File Structure

### Created
- `backend/mathion/api/run_render.py` OR extension to `run_assets.py` — `POST /api/runs/{rid}/render` endpoint (Task 1 decides which file based on existing layout)
- `backend/tests/test_run_render.py` — backend test for the new endpoint
- `frontend/src/lib/blocks.ts` — `listBlocks(versionId)`
- `frontend/src/lib/datetime.ts` — TZ helpers
- `frontend/src/lib/assetContext.ts` — `AssetContext` type + `courseAssetContext` / `runAssetContext` factories
- `frontend/src/lib/miniProjects.ts` — MP CRUD wrappers
- `frontend/src/lib/runAssets.ts` — run-asset CRUD wrappers + pre-validation constants
- `frontend/src/tests/blocks.test.ts`
- `frontend/src/tests/datetime.test.ts`
- `frontend/src/tests/assetContext.test.ts`
- `frontend/src/tests/miniProjects.test.ts`
- `frontend/src/tests/runAssets.test.ts`
- `frontend/src/components/runs/RunMiniProjectsTab.svelte`
- `frontend/src/components/runs/MiniProjectModal.svelte`
- `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts`
- `frontend/src/tests/MiniProjectModal.create-edit.svelte.test.ts` (T6a tests)
- `frontend/src/tests/MiniProjectModal.publish.svelte.test.ts` (T6b tests)

### Modified
- `frontend/src/lib/types.ts` — add `BlockResponse`, `MiniProjectCreate/Update/Response`, `RunAssetResponse`, `MiniProjectRowStatus`
- `frontend/src/components/editor/MarkdownEditor.svelte` — `assetContext` prop, `uploadOne` helper, `editorMounted`, `disabled`, multi-file textarea/wrapper loop
- `frontend/src/components/editor/AssetSidebar.svelte` — `assetContext` prop, injected `onUploadFile`, `loadToken` ratchet, `disabled`, stop-on-any-invalid pre-pass
- `frontend/src/pages/editor/ItemEditPage.svelte` — pass `courseAssetContext(vid)` instead of bare `versionId`
- `frontend/src/pages/runs/RunDetailPage.svelte` — 5th tab wiring, `loadAll` sequencing for blocks-after-versions, reset-effect close-modal fold-in, `onNavigateToTab`
- `frontend/vitest.setup.ts` — pin `TZ=Europe/Copenhagen` (extend if exists, create otherwise)
- `frontend/src/tests/MarkdownEditor.svelte.test.ts` (and existing AssetSidebar tests) — migrate to `courseAssetContext`; add run-mode case (T5b)

---

## Task 1: Backend `POST /api/runs/{rid}/render`

**Files:**
- Reference: `backend/mathion/api/versions.py:120` (mirror this endpoint's shape)
- Reference: `backend/mathion/api/helpers.py:421` (call `render_with_run_assets`; **note** this helper already raises `HTTPException(422, ...)` internally at `helpers.py:448-450` with the missing-filenames message — so the endpoint body is a one-liner, no try/except needed)
- Reference: `backend/mathion/api/run_assets.py` (gating pattern `require_run_admin_or_teacher`, existing routes at `run_assets.py:27`/`:99`/`:122`/`:177` — all use FULL paths like `/api/runs/{run_id}/assets`; the router is declared `APIRouter(tags=["run-assets"])` with NO prefix)
- Reference: `backend/tests/test_run_assets.py` (canonical test pattern: uses `admin_client` fixture + `seed_run_with_groups()` — cookie auth via CSRFTestClient, NOT bearer tokens)
- Modify: `backend/mathion/api/run_assets.py` (endpoint cohabits with the run-asset surface)
- Create: `backend/tests/test_run_render.py`

**Sub-step before coding:** Read `backend/tests/test_run_assets.py:22-80` to lift the exact test pattern (`admin_client.post(...)`, `seed_run_with_groups()` returns `(run, _, _)` tuple, no token strings needed). Then read `versions.py:120` for response shape (`{html: str}`).

- [ ] **Step 1: Write the failing backend test**

Create `backend/tests/test_run_render.py`:

```python
"""Tests for POST /api/runs/{run_id}/render — slice-A T1."""
import io
from fastapi import status


def _upload_asset(admin_client, run_id: int, filename: str, content: bytes = b"x") -> dict:
    r = admin_client.post(
        f"/api/runs/{run_id}/assets",
        files={"file": (filename, io.BytesIO(content), "image/png")},
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_run_render_rewrites_asset_refs(admin_client, seed_run_with_groups):
    """POST /api/runs/{rid}/render returns HTML with bare filename refs rewritten to /api/runs/{rid}/assets/{filename}.

    Reviewer-4 catch (round 2): the production markdown convention uses BARE filenames
    (`![diagram](diagram.png)`), NOT a fictional `mathion:asset://` URI scheme.
    Verified in `backend/mathion/markdown.py:52-68` (`extract_asset_filenames` scans for
    `![..](filename)` patterns that don't start with `http://`/`https://`/`mailto:`/`#`).
    `render_with_run_assets` rewrites `src="{filename}"` → `src="/api/runs/{rid}/assets/{filename}"`
    (helpers.py:455-458), so the assertion targets the rewritten src= attribute.
    """
    run, _, _ = seed_run_with_groups()
    asset = _upload_asset(admin_client, run["id"], "diagram.png")
    r = admin_client.post(
        f"/api/runs/{run['id']}/render",
        json={"content_md": f"![diagram]({asset['filename']})"},
    )
    assert r.status_code == status.HTTP_200_OK, r.text
    html = r.json()["html"]
    assert f'src="/api/runs/{run["id"]}/assets/{asset["filename"]}"' in html


def test_run_render_admin_ok(admin_client, seed_run_with_groups):
    """Course-admin authenticated session: 200."""
    run, _, _ = seed_run_with_groups()
    r = admin_client.post(f"/api/runs/{run['id']}/render", json={"content_md": "hi"})
    assert r.status_code == status.HTTP_200_OK


def test_run_render_run_teacher_ok(teacher_client, seed_run_with_groups, admin_client):
    """Run-teacher authenticated session: 200 (require_run_admin_or_teacher dep).

    Reviewer-4 catch (round 2): the `teacher_client` fixture (`conftest.py:128-137`)
    creates a session for `teacher@example.com`. But `seed_run_with_groups`
    (`conftest.py:213`) attaches `teach@example.com` as the run's teacher — a
    DIFFERENT email. Without an extra POST attaching `teacher@example.com` to the
    run, this test would assert 200 but actually get 403 (and pass falsely if the
    assert window included 403, which the original draft did via `status_code in
    (200,)`-style permissiveness). Fix: explicitly attach the teacher_client user
    to the run before calling the endpoint, AND assert strict 200.
    """
    run, _, _ = seed_run_with_groups()
    # Attach the teacher_client user (teacher@example.com per conftest.py:121) to this run.
    attach_r = admin_client.post(
        f"/api/runs/{run['id']}/teachers", json={"email": "teacher@example.com"}
    )
    assert attach_r.status_code in (200, 201), attach_r.text
    r = teacher_client.post(f"/api/runs/{run['id']}/render", json={"content_md": "hi"})
    assert r.status_code == status.HTTP_200_OK, r.text


def test_run_render_outsider_403(client, seed_run_with_groups):
    """Unauthenticated / non-member: 403 (or 401 if no session at all)."""
    run, _, _ = seed_run_with_groups()
    r = client.post(f"/api/runs/{run['id']}/render", json={"content_md": "hi"})
    assert r.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)


def test_run_render_422_on_missing_asset(admin_client, seed_run_with_groups):
    """422 lists the missing filenames in the detail message."""
    run, _, _ = seed_run_with_groups()
    r = admin_client.post(
        f"/api/runs/{run['id']}/render",
        json={"content_md": "![x](missing.png)"},
    )
    assert r.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "missing.png" in r.json()["detail"]


def test_run_render_no_reference_rows_created(admin_client, seed_run_with_groups):
    """Side-effect-free: rendering does NOT create RunAssetReference rows."""
    from mathion.models import RunAssetReference
    from mathion.database import SessionLocal
    run, _, _ = seed_run_with_groups()
    asset = _upload_asset(admin_client, run["id"], "d.png")
    with SessionLocal() as s:
        before = s.query(RunAssetReference).filter_by(run_asset_id=asset["id"]).count()
    admin_client.post(
        f"/api/runs/{run['id']}/render",
        json={"content_md": f"![]({asset['filename']})"},
    )
    with SessionLocal() as s:
        after = s.query(RunAssetReference).filter_by(run_asset_id=asset["id"]).count()
    assert before == after
```

**Verified fixture pattern** (round-2 review): `teacher_client` exists at `backend/tests/conftest.py:128-137` and authenticates `teacher@example.com`. `seed_run_with_groups` at `:198` attaches a DIFFERENT email (`teach@example.com`) as the run's teacher, so the test must additionally POST `/api/runs/{id}/teachers` with `teacher@example.com` to grant the teacher_client user run-teacher rights. The test above does this explicitly.

- [ ] **Step 2: Run tests to verify they fail**

```bash
backend/.venv/bin/pytest backend/tests/test_run_render.py -v
```

Expected: 6 failures (endpoint doesn't exist yet → 404 on all calls). Round-3 reviewer-5 recount: the test file at lines 88-170 has 6 `def test_` functions (rewrites, admin_ok, teacher_ok, outsider_403, 422_missing, no_reference_rows). The prior "4" count predated the teacher + reference-rows tests.

- [ ] **Step 3: Implement the endpoint**

Open `backend/mathion/api/run_assets.py`. Verify the imports at the top — `BaseModel` from pydantic must be present; if not, add it. Also verify `render_with_run_assets` is imported from `.helpers`; if not, add it. Then **at the end of the file** (after the existing routes at `:27`/`:99`/`:122`/`:177`) add:

```python
# Add to imports at top of file if not already present:
from pydantic import BaseModel
from .helpers import render_with_run_assets


class RunRenderRequest(BaseModel):
    content_md: str


class RunRenderResponse(BaseModel):
    html: str


@router.post("/api/runs/{run_id}/render", response_model=RunRenderResponse)
def render_run_markdown(
    run_id: int,
    body: RunRenderRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(require_run_admin_or_teacher),
) -> RunRenderResponse:
    """Render markdown with bare-filename asset refs resolved against this run's asset pool.

    Convention is `![alt](filename.png)` (markdown.py:52-68 extracts non-URL refs);
    `render_with_run_assets` validates each against the run's RunAsset pool and rewrites
    `src="{filename}"` / `href="{filename}"` to `/api/runs/{run_id}/assets/{filename}`.
    Side-effect-free: SELECTs only; no RunAssetReference rows are written here
    (sync_run_asset_references runs only on PATCH/POST of mini-projects).
    422 raised internally by render_with_run_assets when any referenced asset
    is not in the run pool (see helpers.py:448-450).
    """
    html = render_with_run_assets(db, run_id, body.content_md)
    return RunRenderResponse(html=html)
```

**Three corrections vs the previous draft (from reviewer-4 catch):**
1. **Full path** `/api/runs/{run_id}/render` — the router has NO prefix (`APIRouter(tags=["run-assets"])` at `:24`), so existing routes use full literal paths. Using `/{rid}/render` would resolve to `/render` (broken).
2. **Param name `run_id`** to match the rest of the file (`:27`/`:99` etc. all use `run_id`).
3. **No try/except for 422** — `render_with_run_assets` already raises `HTTPException(422, detail="Referenced run-assets not found: foo.csv, bar.png")` internally at `helpers.py:448-450`. The endpoint is a one-liner pass-through.

- [ ] **Step 4: Run tests to verify they pass**

```bash
backend/.venv/bin/pytest backend/tests/test_run_render.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Run full backend test suite to check no regressions**

```bash
backend/.venv/bin/pytest -x
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/mathion/api/run_assets.py backend/tests/test_run_render.py
git commit -m "feat(backend): POST /api/runs/{rid}/render — slice-A T1

Mirrors POST /api/versions/{vid}/render but uses render_with_run_assets.
Gated by require_run_admin_or_teacher to match the rest of the run-asset
surface (so future by-slug relaxation works for preview too).
Side-effect-free; 422 on unknown asset ref carries the missing filenames."
```

- [ ] **Step 7: Per-task review loop**

Spawn reviewer agent (Opus high) AND build codex script per `feedback_codex_script_template.md`. Each receives the diff for T1 (`git diff HEAD~1`) and the spec sections "Backend Touchpoints → New" + "Backend test addition". Apply any Critical/Important findings; re-review until clean.

---

## Task 2: Frontend lib helpers — types, blocks, datetime, assetContext

This task lands four small lib modules + a vitest setup pin. It's bundled because each is < 30 lines and they share one review cycle.

**Files:**
- Modify: `frontend/src/lib/types.ts` — add type exports
- Create: `frontend/src/lib/blocks.ts`
- Create: `frontend/src/lib/datetime.ts`
- Create: `frontend/src/lib/assetContext.ts`
- Modify (or create): `frontend/vitest.setup.ts` — pin `TZ=Europe/Copenhagen`
- Create: `frontend/src/tests/blocks.test.ts`
- Create: `frontend/src/tests/datetime.test.ts`
- Create: `frontend/src/tests/assetContext.test.ts`

### T2.A — TZ pin via npm test script (NOT via setup.ts)

**Reviewer-2 catch:** Node caches the host TZ at process startup; setting `process.env.TZ` from a vitest `setupFiles` script runs AFTER worker boot and has no effect on `Date` formatting. The correct mechanism is to set `TZ` in the process environment BEFORE Node launches — via the npm script that runs vitest.

- [ ] **Step 1: Update the `test` script in `frontend/package.json`**

Read `frontend/package.json`. The existing `"test"` script likely runs `vitest` or `vitest run`. Change it to prepend `TZ=Europe/Copenhagen`:

```json
{
  "scripts": {
    "test": "TZ=Europe/Copenhagen vitest run",
    "test:watch": "TZ=Europe/Copenhagen vitest",
    ...
  }
}
```

This makes `TZ` part of the process environment before Node sees its first `new Date()`. Verify by adding a sanity check in `tests/datetime.test.ts` (it's already there — the CEST/CET assertions only pass with TZ pinned).

- [ ] **Step 2: Document the requirement in README or top of vitest.config.ts**

Add a comment in `frontend/vitest.config.ts` (read it first to find the right spot):

```ts
// IMPORTANT: tests in lib/datetime.ts depend on TZ=Europe/Copenhagen being set
// BEFORE vitest launches. The `npm test` script prepends it. Running vitest
// directly (e.g., `npx vitest run`) without TZ in the env will produce
// host-TZ-dependent failures on datetime tests.
```

- [ ] **Step 3 (optional defensive belt-and-suspenders)**: in `frontend/src/tests/datetime.test.ts`, add an `expect.fail` guard if the pin didn't take:

```ts
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  if (process.env.TZ !== 'Europe/Copenhagen') {
    throw new Error(`TZ pin required: expected Europe/Copenhagen, got ${process.env.TZ ?? 'unset'}. Run via npm test (which prepends TZ=...) not bare npx vitest.`);
  }
});
```

This converts a silent flaky-on-CI failure into a loud config error.

### T2.B — `lib/types.ts` additions

- [ ] **Step 2: Add the new type exports**

Read `frontend/src/lib/types.ts` to confirm the existing pattern (Pydantic-mirror style). Then add:

**Types verified against `backend/mathion/schemas.py:69` (BlockResponse), `:588` (MiniProjectResponse), `:651` (RunAssetResponse) — copy verbatim:**

```ts
export type BlockResponse = {
  id: number;
  version_id: number;
  title: string;
  slug: string;
  order: number;
  info: string;
  info_html: string;
};

export type MiniProjectResponse = {
  id: number;
  run_id: number;
  block_id: number;
  title: string;                       // service-populated "Mini project for Block {block.order}"
  assignment_md: string;
  assignment_html: string;             // server-rendered preview HTML
  soft_deadline: string | null;        // ISO 8601 UTC ending in "Z"
  hard_deadline: string | null;
  resubmission_deadline: string | null;
  is_published: boolean;
  first_submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MiniProjectCreate = {
  block_id: number;
  assignment_md: string;
  soft_deadline: string | null;
  hard_deadline: string | null;
  resubmission_deadline: string | null;
};

export type MiniProjectUpdate = Partial<Omit<MiniProjectCreate, 'block_id'>>;

export type RunAssetResponse = {
  id: number;
  run_id: number;
  filename: string;
  file_size: number;
  mime_type: string;
  uploaded_at: string;                 // ISO datetime (NOT created_at — verified schemas.py:657)
  uploaded_by: number | null;
  is_referenced: boolean;
};

export type MiniProjectRowStatus = 'draft' | 'published' | 'locked';
```

(Reviewer-2 catch: prior draft had `RunAssetResponse.created_at` — wrong; backend uses `uploaded_at/uploaded_by`. `MiniProjectResponse` was missing `title`+`assignment_html`. `BlockResponse` was missing `slug`+`info`+`info_html`. All fixed.)

### T2.C — `lib/blocks.ts`

- [ ] **Step 3: Write the failing test**

Create `frontend/src/tests/blocks.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listBlocks } from '../lib/blocks';
import type { BlockResponse } from '../lib/types';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

describe('listBlocks', () => {
  it('GETs /api/versions/{vid}/blocks and returns the list', async () => {
    // Round-2 reviewer-5 catch: BlockResponse is 7-field (id, version_id, title,
    // slug, order, info, info_html — verified schemas.py:69 + types.ts addition in T2.B).
    // Old 4-field literals fail strict TypeScript compilation. Use complete shape.
    const blocks: BlockResponse[] = [
      { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 0, info: '', info_html: '' },
      { id: 2, version_id: 7, title: 'Theory', slug: 'theory', order: 1, info: '', info_html: '' },
    ];
    fetchSpy.mockImplementation(() => jres(blocks));
    const result = await listBlocks(7);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/versions/7/blocks'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual(blocks);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/tests/blocks.test.ts
```

Expected: FAIL with "Cannot find module '../lib/blocks'".

- [ ] **Step 5: Implement `lib/blocks.ts`**

Read `frontend/src/lib/api.ts` to see the `api.get` wrapper shape. Then:

```ts
// frontend/src/lib/blocks.ts
import { api } from './api';
import type { BlockResponse } from './types';

export function listBlocks(versionId: number): Promise<BlockResponse[]> {
  return api.get<BlockResponse[]>(`/api/versions/${versionId}/blocks`);
}
```

- [ ] **Step 6: Test passes**

```bash
cd frontend && npx vitest run src/tests/blocks.test.ts
```

Expected: PASS.

### T2.D — `lib/datetime.ts`

- [ ] **Step 7: Write the failing tests**

Create `frontend/src/tests/datetime.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { localInputToISO, isoToLocalInput, formatLocalWithTz, localTzLabel } from '../lib/datetime';

// TZ pinned to Europe/Copenhagen via vitest.setup.ts.
// In summer, Europe/Copenhagen is GMT+2 (CEST); in winter GMT+1 (CET).

describe('localInputToISO', () => {
  it('converts local naive string to UTC Z ISO (summer / CEST)', () => {
    // 2026-06-07 23:59 CEST = 21:59 UTC
    expect(localInputToISO('2026-06-07T23:59')).toBe('2026-06-07T21:59:00.000Z');
  });

  it('converts local naive string to UTC Z ISO (winter / CET)', () => {
    // 2026-01-15 12:00 CET = 11:00 UTC
    expect(localInputToISO('2026-01-15T12:00')).toBe('2026-01-15T11:00:00.000Z');
  });

  it('DST spring-forward normalizes non-existent local times +1h per ECMA-262', () => {
    // 2026-03-29 02:30 doesn't exist in Europe/Copenhagen (clocks jump 02:00 → 03:00).
    // Per ECMA-262 §21.4.3.2, parsed as 03:30 local = 01:30 UTC.
    expect(localInputToISO('2026-03-29T02:30')).toBe('2026-03-29T01:30:00.000Z');
  });
});

describe('isoToLocalInput', () => {
  it('round-trips ISO UTC back to naive local input string (summer)', () => {
    expect(isoToLocalInput('2026-06-07T21:59:00Z')).toBe('2026-06-07T23:59');
  });

  it('round-trips winter UTC', () => {
    expect(isoToLocalInput('2026-01-15T11:00:00Z')).toBe('2026-01-15T12:00');
  });
});

describe('formatLocalWithTz', () => {
  it('formats UTC ISO with browser-local label', () => {
    const out = formatLocalWithTz('2026-06-07T21:59:00Z');
    expect(out).toMatch(/2026-06-07/);
    expect(out).toMatch(/23:59/);
    expect(out).toMatch(/GMT\+2/);
  });
});

describe('localTzLabel', () => {
  it('returns a short-offset label string', () => {
    // shape "(GMT+2)" or "(UTC)" depending on TZ; pinned to Copenhagen so GMT+1 (winter) or GMT+2 (summer)
    const label = localTzLabel();
    expect(label).toMatch(/^\(GMT[+-]?\d?\)$|^\(UTC\)$/);
  });
});
```

- [ ] **Step 8: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/tests/datetime.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 9: Implement `lib/datetime.ts`**

```ts
// frontend/src/lib/datetime.ts

// Browser-local naive "YYYY-MM-DDTHH:MM" → ISO 8601 UTC string ending in "Z".
// Implementation note: `new Date(naive)` parses naive strings as local per ECMA-262
// §21.4.3.2; `.toISOString()` serializes as UTC ending in "Z". DST spring-forward
// non-existent times normalize forward by +1h (test asserts this).
export function localInputToISO(value: string): string {
  return new Date(value).toISOString();
}

// Backend UTC ISO → naive local "YYYY-MM-DDTHH:MM" for <input type="datetime-local">.
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Format a UTC ISO for human display in browser-local TZ: "YYYY-MM-DD HH:MM GMT+2".
export function formatLocalWithTz(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const tz = localTzLabel().replace(/^\(|\)$/g, '');
  return `${base} ${tz}`;
}

// Browser-local TZ short offset, parenthesized for inline labels: "(GMT+2)" / "(UTC)".
// Pinned to Intl.DateTimeFormat shortOffset for cross-browser stability — the unpinned
// 'short' option returns locale-dependent abbreviations (e.g. Chrome "GMT+2" vs Safari
// "CEST") that are test-flaky.
export function localTzLabel(): string {
  const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'shortOffset' }).formatToParts(new Date());
  const tz = parts.find(p => p.type === 'timeZoneName')?.value ?? 'UTC';
  return `(${tz})`;
}
```

- [ ] **Step 10: Tests pass**

```bash
cd frontend && npx vitest run src/tests/datetime.test.ts
```

Expected: all PASS.

### T2.E — `lib/assetContext.ts`

- [ ] **Step 11: Write the failing tests**

Create `frontend/src/tests/assetContext.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { courseAssetContext, runAssetContext } from '../lib/assetContext';
import type { AssetItem } from '../lib/assetContext';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

describe('courseAssetContext', () => {
  const ctx = courseAssetContext(7);

  it('kind is "course"', () => expect(ctx.kind).toBe('course'));

  it('list() GETs /api/versions/{vid}/assets (verified frontend/src/lib/assets.ts:62)', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    await ctx.list();
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/versions/7/assets'), expect.any(Object));
  });

  it('renderPreview POSTs /api/versions/{vid}/render', async () => {
    fetchSpy.mockImplementation(() => jres({ html: '<p>x</p>' }));
    await ctx.renderPreview('hi');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/versions/7/render'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('imgSrc returns /assets/{vid}/{filename} (no /api prefix, per assets.py:130)', () => {
    const item: AssetItem = { id: 1, filename: 'pic.png', mime_type: 'image/png', file_size: 100, is_referenced: false };
    expect(ctx.imgSrc(item)).toBe('/assets/7/pic.png');
  });
});

describe('runAssetContext', () => {
  const ctx = runAssetContext(42);

  it('kind is "run"', () => expect(ctx.kind).toBe('run'));

  it('list() GETs /api/runs/{rid}/assets', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    await ctx.list();
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/runs/42/assets'), expect.any(Object));
  });

  it('renderPreview POSTs /api/runs/{rid}/render', async () => {
    fetchSpy.mockImplementation(() => jres({ html: '<p>x</p>' }));
    await ctx.renderPreview('hi');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/42/render'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('imgSrc returns /api/runs/{rid}/assets/{filename} (WITH /api prefix, per run_assets.py:122)', () => {
    const item: AssetItem = { id: 1, filename: 'd.png', mime_type: 'image/png', file_size: 100, is_referenced: false };
    expect(ctx.imgSrc(item)).toBe('/api/runs/42/assets/d.png');
  });

  it('upload threads AbortSignal AND propagates abort as AbortError rejection', async () => {
    // Verify the signal is threaded into fetch:
    let capturedSignal: AbortSignal | undefined;
    fetchSpy.mockImplementation((_url, init) => {
      capturedSignal = init?.signal;
      // Simulate a fetch that respects abort
      return new Promise((resolve, reject) => {
        if (capturedSignal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        capturedSignal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
        // Don't resolve unless aborted in this test — we're testing abort path.
      });
    });
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const controller = new AbortController();
    const uploadPromise = ctx.upload(file, controller.signal);
    expect(capturedSignal).toBe(controller.signal);
    controller.abort();
    await expect(uploadPromise).rejects.toThrowError(/abort/i);
  });

  it('upload throws ApiError shape on 409 (NOT plain Error) — so downstream instanceof ApiError checks work', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Asset already exists' }, 409));
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    await expect(ctx.upload(file)).rejects.toThrow();
    // Once rejected, the error must satisfy `e instanceof ApiError` checks used by
    // AssetSidebar/MarkdownEditor (sidebar's fetchAssets catch uses e instanceof ApiError;
    // existing AssetSidebar.svelte:88-94 rename-hint also uses it).
    try { await ctx.upload(file); } catch (e: any) {
      const { ApiError } = await import('../lib/api');
      expect(e).toBeInstanceOf(ApiError);
      expect(e.status).toBe(409);
    }
  });
});
```

- [ ] **Step 12: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/tests/assetContext.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 13a: Extend `lib/assets.ts:uploadAsset` to accept an `AbortSignal`**

Reviewer-4 catch: the current `uploadAsset(versionId, file)` signature at `frontend/src/lib/assets.ts:32` has no `signal` param. `courseAssetContext.upload` would silently drop the signal, breaking abort semantics for the course-asset path. Extend:

```ts
// frontend/src/lib/assets.ts (existing file — modify uploadAsset only)
export async function uploadAsset(versionId: number, file: File, signal?: AbortSignal): Promise<AssetResponse> {
  // ... existing body, but add `signal` to the fetch call options.
}
```

Existing AssetResponse-handling and ApiError-throwing stay exactly as they were. Re-run the existing `ItemEditPage.refreshKey.svelte.test.ts` and any other tests that exercise `uploadAsset` to confirm no regression from the signature widening.

- [ ] **Step 13b: Implement `lib/assetContext.ts`** (uses the now-signal-aware `uploadAsset` for course, and throws `ApiError` for run upload — reviewer-4 catch)

Read `frontend/src/lib/api.ts` first to confirm:
- `ApiError` class export shape (with `displayMessage`, `status`, `detail` fields)
- `credentials` setting (existing `uploadAsset` uses `credentials: 'include'` + `'X-Requested-With': 'mathion'` header for CSRF — mirror exactly)

Then:

```ts
// frontend/src/lib/assetContext.ts
import { api, ApiError } from './api';
import { listAssets, uploadAsset, deleteAsset } from './assets';   // existing course wrappers (uploadAsset NOW accepts signal per 13a)

export type AssetItem = {
  id: number;
  filename: string;
  mime_type: string;
  file_size: number;
  is_referenced: boolean;
};

export type AssetContext = {
  kind: 'course' | 'run';
  list(): Promise<AssetItem[]>;
  upload(file: File, signal?: AbortSignal): Promise<AssetItem>;
  remove(assetId: number): Promise<void>;
  imgSrc(item: AssetItem): string;
  renderPreview(content_md: string): Promise<{ html: string }>;
};

export function courseAssetContext(versionId: number): AssetContext {
  return {
    kind: 'course',
    list: () => listAssets(versionId),
    upload: (file, signal) => uploadAsset(versionId, file, signal),
    remove: (id) => deleteAsset(id),
    imgSrc: (item) => `/assets/${versionId}/${item.filename}`,
    renderPreview: (content_md) => api.post<{ html: string }>(`/api/versions/${versionId}/render`, { content_md }),
  };
}

export function runAssetContext(runId: number): AssetContext {
  return {
    kind: 'run',
    list: () => api.get(`/api/runs/${runId}/assets`),
    upload: async (file, signal) => {
      const fd = new FormData();
      fd.append('file', file);
      // Mirror the existing uploadAsset (lib/assets.ts) wire pattern EXACTLY:
      //   - credentials: 'include' (NOT 'same-origin' — Vite dev runs on a different port
      //     than the backend so cookies need 'include'; reviewer-5 catch).
      //   - 'X-Requested-With': 'mathion' header for CSRF.
      //   - On non-ok: throw ApiError (NOT plain Error) so downstream `e instanceof
      //     ApiError` checks in AssetSidebar/MarkdownEditor work.
      const r = await fetch(`/api/runs/${runId}/assets`, {
        method: 'POST',
        body: fd,
        signal,
        credentials: 'include',
        headers: { 'X-Requested-With': 'mathion' },
      });
      if (!r.ok) {
        const payload = await r.json().catch(() => ({ detail: 'Upload failed' }));
        // Round-2 reviewer-5 catch: ApiError's 3rd arg is `errorCode: string`
        // (see lib/api.ts:4-12), NOT the full payload. Mirror api.ts:46 verbatim —
        // pass payload.error_code (a string discriminant), not the whole object.
        throw new ApiError(r.status, payload.detail ?? 'Upload failed', payload.error_code);
      }
      return r.json();
    },
    remove: (id) => api.delete(`/api/runs/${runId}/assets/${id}`),
    imgSrc: (item) => `/api/runs/${runId}/assets/${item.filename}`,
    renderPreview: (content_md) => api.post<{ html: string }>(`/api/runs/${runId}/render`, { content_md }),
  };
}
```

**Verified `ApiError` constructor** (round-2 review): `lib/api.ts:4-12` defines `new ApiError(status, detail, errorCode?: string)`. The 3rd arg is a STRING (matches `body.error_code` from backend ValidationErrorDetail responses) — see api.ts:46. The plan's call sites pass `payload.error_code` (which is `undefined` when the backend doesn't include one — fine, the param is optional).

- [ ] **Step 14: Tests pass**

```bash
cd frontend && npx vitest run src/tests/assetContext.test.ts src/tests/blocks.test.ts src/tests/datetime.test.ts
```

Expected: all PASS.

- [ ] **Step 15: Run full frontend test suite to catch regressions from `types.ts` edit**

```bash
cd frontend && npx vitest run
```

Expected: all PASS (existing 402 + new tests).

- [ ] **Step 16: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/blocks.ts frontend/src/lib/datetime.ts frontend/src/lib/assetContext.ts frontend/vitest.setup.ts frontend/src/tests/blocks.test.ts frontend/src/tests/datetime.test.ts frontend/src/tests/assetContext.test.ts frontend/vitest.config.ts
git commit -m "feat(frontend): lib helpers for mini-projects slice — T2

- types.ts: BlockResponse, MiniProject{Create,Update,Response},
  RunAssetResponse, MiniProjectRowStatus
- blocks.ts: listBlocks(versionId)
- datetime.ts: localInputToISO/isoToLocalInput/formatLocalWithTz/localTzLabel
- assetContext.ts: courseAssetContext + runAssetContext factories
- vitest.setup.ts: TZ=Europe/Copenhagen pin for deterministic datetime tests"
```

- [ ] **Step 17: Per-task review loop** (reviewer + codex)

---

## Task 3: `lib/miniProjects.ts`

**Files:**
- Create: `frontend/src/lib/miniProjects.ts`
- Create: `frontend/src/tests/miniProjects.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/tests/miniProjects.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  listMiniProjects, getMiniProject, createMiniProject,
  updateMiniProject, publishMiniProject, deleteMiniProject,
} from '../lib/miniProjects';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

describe('miniProjects wrappers', () => {
  it('listMiniProjects GETs /api/runs/{rid}/mini-projects', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    await listMiniProjects(10);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/10/mini-projects'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('getMiniProject GETs /api/mini-projects/{mpId}', async () => {
    fetchSpy.mockImplementation(() => jres({}));
    await getMiniProject(99);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/mini-projects/99'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('createMiniProject POSTs to /api/runs/{rid}/mini-projects with body', async () => {
    fetchSpy.mockImplementation(() => jres({}));
    await createMiniProject(10, {
      block_id: 1, assignment_md: 'x',
      soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/10/mini-projects'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('updateMiniProject PATCHes /api/mini-projects/{mpId}', async () => {
    fetchSpy.mockImplementation(() => jres({}));
    await updateMiniProject(99, { assignment_md: 'y' });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/mini-projects/99'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('publishMiniProject POSTs /api/mini-projects/{mpId}/publish', async () => {
    fetchSpy.mockImplementation(() => jres({}));
    await publishMiniProject(99);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/mini-projects/99/publish'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('deleteMiniProject DELETEs /api/mini-projects/{mpId} (no force by default)', async () => {
    fetchSpy.mockImplementation(() => jres('', 204));
    await deleteMiniProject(99);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/mini-projects\/99(?!.*force=true)/),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('deleteMiniProject with force=true appends ?force=true', async () => {
    fetchSpy.mockImplementation(() => jres('', 204));
    await deleteMiniProject(99, { force: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/mini-projects/99?force=true'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('throws ApiError on 409 (locked, no force)', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Mini-project is locked (has submissions); use ?force=true' }, 409));
    await expect(deleteMiniProject(99)).rejects.toThrowError(/locked/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/tests/miniProjects.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `lib/miniProjects.ts`**

```ts
// frontend/src/lib/miniProjects.ts
import { api } from './api';
import type { MiniProjectResponse, MiniProjectCreate, MiniProjectUpdate } from './types';

export function listMiniProjects(runId: number): Promise<MiniProjectResponse[]> {
  return api.get(`/api/runs/${runId}/mini-projects`);
}

export function getMiniProject(mpId: number): Promise<MiniProjectResponse> {
  return api.get(`/api/mini-projects/${mpId}`);
}

export function createMiniProject(runId: number, body: MiniProjectCreate): Promise<MiniProjectResponse> {
  return api.post(`/api/runs/${runId}/mini-projects`, body);
}

export function updateMiniProject(mpId: number, body: MiniProjectUpdate): Promise<MiniProjectResponse> {
  return api.patch(`/api/mini-projects/${mpId}`, body);
}

export function publishMiniProject(mpId: number): Promise<MiniProjectResponse> {
  return api.post(`/api/mini-projects/${mpId}/publish`);
}

export function deleteMiniProject(mpId: number, opts?: { force?: boolean }): Promise<void> {
  const qs = opts?.force ? '?force=true' : '';
  return api.delete(`/api/mini-projects/${mpId}${qs}`);
}
```

(If `api.delete` doesn't accept a query suffix the same way other wrappers do, mirror the existing pattern from `lib/runRoster.ts` or wherever query-strings are handled.)

- [ ] **Step 4: Tests pass**

```bash
cd frontend && npx vitest run src/tests/miniProjects.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/miniProjects.ts frontend/src/tests/miniProjects.test.ts
git commit -m "feat(frontend): lib/miniProjects.ts CRUD wrappers — T3"
```

- [ ] **Step 6: Per-task review loop** (reviewer + codex)

---

## Task 4: `lib/runAssets.ts` (incl. AbortSignal + pre-validation constants)

**Files:**
- Create: `frontend/src/lib/runAssets.ts`
- Create: `frontend/src/tests/runAssets.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/tests/runAssets.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  listRunAssets, uploadRunAsset, deleteRunAsset,
  MAX_FILE_SIZE_BYTES, ALLOWED_EXTENSIONS,
} from '../lib/runAssets';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

describe('runAssets wrappers', () => {
  it('listRunAssets GETs /api/runs/{rid}/assets', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    await listRunAssets(10);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/10/assets'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('uploadRunAsset POSTs FormData with field "file" and threads AbortSignal', async () => {
    fetchSpy.mockImplementation((_url, init) => {
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
      expect((init.body as FormData).get('file')).toBeInstanceOf(File);
      expect(init.signal).toBeDefined();
      return jres({ id: 1, filename: 'x.png', mime_type: 'image/png', file_size: 1, is_referenced: false });
    });
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const c = new AbortController();
    await uploadRunAsset(10, file, c.signal);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/10/assets'),
      expect.any(Object),
    );
  });

  it('uploadRunAsset propagates AbortError when signal fires', async () => {
    fetchSpy.mockImplementation(() => Promise.reject(new DOMException('Aborted', 'AbortError')));
    const c = new AbortController();
    c.abort();
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    await expect(uploadRunAsset(10, file, c.signal)).rejects.toThrowError(/abort/i);
  });

  it('deleteRunAsset DELETEs /api/runs/{rid}/assets/{assetId}', async () => {
    fetchSpy.mockImplementation(() => jres('', 204));
    await deleteRunAsset(10, 99);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/10/assets/99'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('pre-validation constants', () => {
  it('MAX_FILE_SIZE_BYTES is 20 MB (matches backend config.py:9 default)', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(20 * 1024 * 1024);
  });

  it('ALLOWED_EXTENSIONS mirrors backend assets.py:4-9 exactly (no leading dots)', () => {
    expect(ALLOWED_EXTENSIONS).toEqual(new Set([
      'png', 'jpg', 'jpeg', 'gif', 'pdf',
      'csv', 'xls', 'xlsx', 'ppt', 'pptx',
      'r', 'py', 'm', 'js',
    ]));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/tests/runAssets.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `lib/runAssets.ts`**

```ts
// frontend/src/lib/runAssets.ts
import { api } from './api';
import type { RunAssetResponse } from './types';

// MUST stay in sync with backend Settings.max_file_size (config.py:9), default 20 MB.
// Backend value is env-overridable via MATHION_MAX_FILE_SIZE; a deploy bumping the
// backend constant must hand-update this. Accepted drift for slice A; a
// /api/config/limits endpoint is the principled fix (Phase 9).
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

// MUST stay in sync with backend ALLOWED_EXTENSIONS (backend/mathion/assets.py:4-9).
// Backend list stores extensions WITHOUT leading dot; mirrored verbatim:
export const ALLOWED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'pdf',
  'csv', 'xls', 'xlsx', 'ppt', 'pptx',
  'r', 'py', 'm', 'js',
]);

export function listRunAssets(runId: number): Promise<RunAssetResponse[]> {
  return api.get(`/api/runs/${runId}/assets`);
}

export async function uploadRunAsset(
  runId: number,
  file: File,
  signal?: AbortSignal,
): Promise<RunAssetResponse> {
  // Mirrors lib/assets.ts:uploadAsset wire pattern verbatim — credentials: 'include'
  // (cross-port dev cookie), X-Requested-With CSRF header, ApiError on non-ok so
  // downstream `e instanceof ApiError` checks work.
  const { ApiError } = await import('./api');
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch(`/api/runs/${runId}/assets`, {
    method: 'POST',
    body: fd,
    signal,
    credentials: 'include',
    headers: { 'X-Requested-With': 'mathion' },
  });
  if (!r.ok) {
    const payload = await r.json().catch(() => ({ detail: 'Upload failed' }));
    // Round-2 reviewer-5 catch: ApiError(status, detail, errorCode?: string) —
    // pass the string `payload.error_code` (matches api.ts:46), NOT the whole payload.
    throw new ApiError(r.status, payload.detail ?? 'Upload failed', payload.error_code);
  }
  return r.json();
}

export function deleteRunAsset(runId: number, assetId: number): Promise<void> {
  return api.delete(`/api/runs/${runId}/assets/${assetId}`);
}
```

- [ ] **Step 4: Tests pass**

```bash
cd frontend && npx vitest run src/tests/runAssets.test.ts
```

Expected: PASS.

- [ ] **Step 5: Refactor — `assetContext.ts` runAssetContext.upload now delegates to uploadRunAsset**

Now that `uploadRunAsset` exists and is tested, update `runAssetContext` in `lib/assetContext.ts` to call it (DRY — single upload path):

```ts
upload: (file, signal) => uploadRunAsset(runId, file, signal),
```

Similarly for `list` and `remove` if you originally inlined fetch in T2.E. The intent is: lib/runAssets.ts is the wire layer; assetContext is the adapter.

Re-run T2 tests after the refactor to confirm they still pass:

```bash
cd frontend && npx vitest run src/tests/assetContext.test.ts src/tests/runAssets.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/runAssets.ts frontend/src/lib/assetContext.ts frontend/src/tests/runAssets.test.ts
git commit -m "feat(frontend): lib/runAssets.ts + pre-validation constants — T4

uploadRunAsset threads AbortSignal; ALLOWED_EXTENSIONS / MAX_FILE_SIZE_BYTES
mirror backend exactly (Settings.max_file_size=20MB, 14 file types from
assets.py:4-9). assetContext.runAssetContext refactored to delegate to
lib/runAssets.ts so there is one wire layer."
```

- [ ] **Step 7: Per-task review loop** (reviewer + codex)

---

## Task 5a: MarkdownEditor + AssetSidebar refactor

This is the most substantive task in the plan. It refactors two existing components to:
1. Take `assetContext: AssetContext` instead of `versionId: number`
2. Introduce a single shared `uploadOne(file, batch?)` helper in MarkdownEditor
3. Inject `uploadOne` into AssetSidebar as `onUploadFile`
4. Add `disabled` prop to both
5. Replace AssetSidebar's `fetchAssets` with the `loadToken`-ratcheted version
6. Add textarea/wrapper multi-file loop
7. Add stop-on-any-invalid pre-validation pre-pass in sidebar
8. Migrate `ItemEditPage` call sites

**The full uploadOne + loop bodies are in the spec, §"MarkdownEditor.svelte" lines 232-301 and §"AssetSidebar.svelte" lines 305-366.** Don't reinvent; copy verbatim, adjusting only for the existing surrounding code.

**Files:**
- Modify: `frontend/src/components/editor/MarkdownEditor.svelte`
- Modify: `frontend/src/components/editor/AssetSidebar.svelte`
- Modify: `frontend/src/pages/editor/ItemEditPage.svelte` (two MarkdownEditor instances at `:270` and `:305`)
- **Modify: `frontend/src/tests/ItemEditPage.refreshKey.harness.svelte`** (reviewer-4 catch: the harness file referenced by `ItemEditPage.refreshKey.svelte.test.ts:3` mounts MarkdownEditor too — must migrate to `courseAssetContext`).
- Modify (REQUIRED — reviewer-4 catch): all existing tests at `frontend/src/tests/MarkdownEditor.svelte.test.ts` and `frontend/src/tests/AssetSidebar.svelte.test.ts` that use `vi.spyOn(assetsModule, 'listAssets'/'uploadAsset'/...)`. After the refactor those spies become NO-OPS because the components no longer import `listAssets`/`uploadAsset` directly — they call through `assetContext.list()` / `assetContext.upload()`. **Without migration, tests will silently pass while making real fetch calls in jsdom.** Replace each `vi.spyOn(assetsModule, 'X')` with one of:
  - inject a stub `assetContext = { list: vi.fn(), upload: vi.fn(), ... }` as the prop value, OR
  - keep mounting with `courseAssetContext(...)` AND use the canonical `fetchSpy = vi.fn()` against `globalThis.fetch` (matches the `RunTeachersTab.svelte.test.ts` pattern).
  Audit count (round-2 reviewer-4 recount): `grep -c "vi.spyOn" frontend/src/tests/MarkdownEditor.svelte.test.ts frontend/src/tests/AssetSidebar.svelte.test.ts` returns **24 + 21 = 45** spies, NOT the ~25 the first round estimated. Plan the migration with 45 spies in mind — this is a larger surface area than the prior count suggested, so allocate time accordingly.

### T5a.A — MarkdownEditor refactor

- [ ] **Step 1: Read current MarkdownEditor.svelte end-to-end** (249 lines)

```bash
cat frontend/src/components/editor/MarkdownEditor.svelte | less
```

Note the existing $state declarations, the textarea drop handler around line 93, the wrapper drop handler, the preview button, and where AssetSidebar is mounted. Map each spec change to a concrete edit location.

- [ ] **Step 2: Replace the prop signature**

Old:
```ts
let { versionId, value = $bindable(''), readOnly = false, refreshKey = $bindable(0) }: {
  versionId: number; value?: string; readOnly?: boolean; refreshKey?: number;
} = $props();
```

New:
```ts
import type { AssetContext, AssetItem } from '../../lib/assetContext';

let {
  assetContext,
  value = $bindable(''),
  readOnly = false,
  disabled = false,
  refreshKey = $bindable(0),
  uploadAbortController = $bindable<AbortController | null>(null),
  ariaDescribedby = undefined,
}: {
  assetContext: AssetContext;
  value?: string;
  readOnly?: boolean;
  disabled?: boolean;
  refreshKey?: number;
  uploadAbortController?: AbortController | null;
  ariaDescribedby?: string;
} = $props();
```

Codex re-review catch: forward `ariaDescribedby` onto the textarea element
(not the wrapper). T6a's 422 field-level UX needs the `<textarea>` itself
to carry `aria-describedby="err-assignment_md"` so assistive tech announces
the error when focus lands. Update the textarea opening tag at the existing
`MarkdownEditor.svelte:209-219` to read:

```svelte
<textarea
  bind:this={textareaEl}
  bind:value
  rows="14"
  spellcheck="false"
  disabled={disabled}
  aria-describedby={ariaDescribedby}
  ondragover={handleTextareaDragOver}
  ondrop={handleTextareaDrop}
  onfocus={onTextareaFocus}
  onblur={onTextareaBlur}
  onselectionchange={onTextareaSelectionChange}
></textarea>
```

- [ ] **Step 3: Add `editorMounted` lifecycle flag**

```ts
import { onMount, onDestroy } from 'svelte';
let editorMounted = $state(false);
onMount(() => { editorMounted = true; });
onDestroy(() => { editorMounted = false; });
```

- [ ] **Step 4: Add `uploading` / `uploadProgress` / `uploadError` $state with $bindable**

(They already exist in the existing component — search for them. If they're plain `$state`, change to `$bindable` so the consumer modal can `bind:`. Sidebar continues to receive them as `$bindable`.)

```ts
let uploading = $state(false);
let uploadProgress = $state<{ current: number; total: number; filename: string } | null>(null);
let uploadError = $state<{ detail: string; stoppedAt?: { n: number; m: number } } | null>(null);
```

Make them `$bindable` if not already.

- [ ] **Step 5: Add `uploadOne(file, batch?)` helper — verbatim from spec lines 242-281**

Paste the helper body from the spec. The helper replaces every existing inline upload site in MarkdownEditor.

- [ ] **Step 6: Replace textarea-drop and wrapper-drop handlers with the multi-file loop**

Verbatim from spec lines 285-301:

```ts
async function handleTextareaDrop(files: File[]) {
  for (let i = 0; i < files.length; i++) {
    const result = await uploadOne(files[i], { current: i + 1, total: files.length });
    if (result === null) break;
    insertRefAtCursor(formatRef(result));
    refreshKey += 1;
  }
}

async function handleWrapperDrop(files: File[]) {
  for (let i = 0; i < files.length; i++) {
    const result = await uploadOne(files[i], { current: i + 1, total: files.length });
    if (result === null) break;
    refreshKey += 1;  // no insertRefAtCursor for wrapper drop
  }
}
```

(Keep existing `insertRefAtCursor` and `formatRef` calls — they're shape-agnostic.)

- [ ] **Step 7: Replace `loadPreview` to call `assetContext.renderPreview`**

```ts
async function loadPreview() {
  // existing loadToken pattern preserved
  const myToken = ++previewToken;  // or whatever name exists
  try {
    const result = await assetContext.renderPreview(value);
    if (myToken === previewToken) previewHtml = result.html;
  } catch (e) {
    // existing error handling
  }
}
```

- [ ] **Step 8: Apply `disabled` prop to all interactive handlers**

For every `<textarea>`, `<button>`, drag-drop event handler, mode-toggle, and the `<AssetSidebar>` mount:
- Textarea: `disabled={disabled || readOnly}` (combine with existing readOnly)
- Buttons: `disabled={disabled}`
- Drop handlers: early-return when `disabled` is true
- Sidebar prop: `disabled={disabled}` passed through

- [ ] **Step 9: Mount AssetSidebar with the new prop signature**

```svelte
<AssetSidebar
  {assetContext}
  {disabled}
  refreshKey={refreshKey}
  onInsert={(snippet) => insertAtCursor(snippet)}
  onUploadFile={uploadOne}
  bind:uploading
  bind:uploadProgress
  bind:uploadError
/>
```

**Round-3 reviewer-1 catch: `refreshKey` is a one-way observed prop on the sidebar**
(spec line 310: "plain observed prop (NOT $bindable — sidebar never writes it in
the refactored design)"). MarkdownEditor owns the counter and bumps it after
textarea/wrapper uploads; the sidebar's $effect just READS it as a refetch
ratchet. A `bind:refreshKey` would assert a write-back path the sidebar must not
have. The bound `uploading`/`uploadProgress`/`uploadError` props ARE two-way
because the sidebar's drop path writes to them on behalf of the shared overlay.

### T5a.B — AssetSidebar refactor

- [ ] **Step 10: Read current AssetSidebar.svelte end-to-end** (316 lines)

Map the existing `fetchAssets`, `runUpload`, `pickFile`, drop handlers, and `imgSrc`/`extChip` functions.

- [ ] **Step 11: Replace the prop signature**

Verbatim from spec lines 305-317:

```ts
import type { AssetContext, AssetItem } from '../../lib/assetContext';

let {
  assetContext,
  disabled = false,
  refreshKey = 0,
  onInsert,
  onUploadFile,
  uploading = $bindable(false),
  uploadProgress = $bindable<{ current: number; total: number; filename: string } | null>(null),
  uploadError = $bindable<{ detail: string; stoppedAt?: { n: number; m: number } } | null>(null),
}: {
  assetContext: AssetContext;
  disabled?: boolean;
  refreshKey?: number;
  onInsert: (snippet: string) => void;
  onUploadFile: (file: File, batch?: { current: number; total: number }) => Promise<AssetItem | null>;
  uploading?: boolean;
  uploadProgress?: { current: number; total: number; filename: string } | null;
  uploadError?: { detail: string; stoppedAt?: { n: number; m: number } } | null;
} = $props();
```

- [ ] **Step 12: Replace `fetchAssets` with loadToken-ratcheted version**

Verbatim from spec lines 322-336:

```ts
let assets = $state<AssetItem[]>([]);
let loading = $state(false);
let listError = $state<string | null>(null);
let mountDone = $state(false);
let loadToken = 0;  // plain `let`, NOT $state (codex round-9: would cause refetch loop)

async function fetchAssets() {
  loadToken += 1;
  const myToken = loadToken;
  loading = true;
  listError = null;
  try {
    const list = await assetContext.list();
    if (myToken === loadToken) assets = list;
  } catch (e) {
    if (myToken === loadToken) listError = e instanceof ApiError ? e.displayMessage : 'Could not load assets.';
  } finally {
    if (myToken === loadToken) loading = false;
  }
}

$effect(() => { void refreshKey; if (mountDone) void fetchAssets(); });
onMount(() => { mountDone = true; void fetchAssets(); });
```

- [ ] **Step 13: Replace the multi-file drop handler with stop-on-any-invalid pre-pass + iterating loop**

Verbatim from spec lines 342-350 + 360-366:

```ts
function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE_BYTES) return `${file.name} (file exceeds 20MB)`;
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  if (!ALLOWED_EXTENSIONS.has(ext)) return `${file.name} (extension not allowed)`;
  return null;
}

async function handleDrop(files: File[]) {
  if (disabled || uploading) return;
  // Pre-pass: validate ALL files; stop-on-any-invalid
  const invalid: string[] = [];
  for (const f of files) {
    const err = validateFile(f);
    if (err) invalid.push(err);
  }
  if (invalid.length > 0) {
    uploadError = {
      detail: invalid.length === 1
        ? `Cannot upload: ${invalid[0]}`
        : `Cannot upload ${invalid.length} files: ${invalid.join(', ')}`,
    };
    return;
  }
  // All valid — iterate, refetch per success
  for (let i = 0; i < files.length; i++) {
    const result = await onUploadFile(files[i], { current: i + 1, total: files.length });
    if (result === null) break;
    await fetchAssets();
  }
}

// Round-4 reviewer-1 catch (spec line 339): the existing file-picker `<input type="file">`
// (upload button) MUST route through the SAME `handleDrop` pre-pass so multi-file picker
// selections enforce stop-on-any-invalid. Wire the existing `pickFile`/onchange handler
// to call `handleDrop(Array.from(input.files))` instead of its old per-file upload loop.
function handleFileInputChange(ev: Event) {
  const input = ev.currentTarget as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  void handleDrop(Array.from(input.files));
  input.value = '';   // reset so re-picking the same files re-triggers change
}
// In the template: <input type="file" multiple onchange={handleFileInputChange} disabled={disabled || uploading} ... />
```

- [ ] **Step 14: Apply `disabled` prop to file-input, upload button, "Insert ref" buttons, per-row delete buttons**

Each gets `disabled={disabled}` AND its onClick early-returns when `disabled` is true.

- [ ] **Step 15: Update `imgSrc(asset)` to call `assetContext.imgSrc(asset)`**

```ts
function imgSrc(a: AssetItem) {
  return assetContext.imgSrc(a);
}
```

- [ ] **Step 16: Update section label to switch on `assetContext.kind`**

```svelte
<h3>{assetContext.kind === 'run' ? 'Run assets — shared across all MPs in this run' : 'Course assets'}</h3>
```

### T5a.C — ItemEditPage call-site migration

- [ ] **Step 17: Update both MarkdownEditor instantiations at `pages/editor/ItemEditPage.svelte:270` and `:305`**

Old (line 270):
```svelte
<MarkdownEditor versionId={vid} bind:value={t.current.content_md} bind:refreshKey />
```

New:
```svelte
<MarkdownEditor assetContext={courseAssetContext(vid)} bind:value={t.current.content_md} bind:refreshKey />
```

For memoization, wrap in `$derived`:

```ts
const editAssetContext = $derived(courseAssetContext(vid));
```

Then use `assetContext={editAssetContext}` in both spots.

Add the import:
```ts
import { courseAssetContext } from '../../lib/assetContext';
```

### T5a.D — Migrate existing tests

- [ ] **Step 18: Run the existing test suite to find breakages**

```bash
cd frontend && npx vitest run
```

Any test that mounts MarkdownEditor or AssetSidebar with `versionId={...}` prop will fail. Update each:

Old:
```ts
mount(MarkdownEditor, { target, props: { versionId: 7, value: '' } });
```

New:
```ts
mount(MarkdownEditor, { target, props: { assetContext: courseAssetContext(7), value: '' } });
```

(Add `import { courseAssetContext } from '../lib/assetContext'`.)

- [ ] **Step 19: Verify all migrated tests pass**

```bash
cd frontend && npx vitest run
```

Expected: green (existing tests still pass with the new prop shape).

- [ ] **Step 20: Commit**

```bash
git add frontend/src/components/editor/MarkdownEditor.svelte frontend/src/components/editor/AssetSidebar.svelte frontend/src/pages/editor/ItemEditPage.svelte frontend/src/tests/MarkdownEditor.svelte.test.ts frontend/src/tests/AssetSidebar.svelte.test.ts frontend/src/tests/ItemEditPage*
git commit -m "refactor(frontend): MarkdownEditor + AssetSidebar take assetContext — T5a

- AssetContext adapter replaces bare versionId prop (course/run polymorphism)
- Single shared uploadOne(file, batch?) helper inside MarkdownEditor; all
  three upload entry points (textarea drop, wrapper drop, sidebar drop)
  route through it
- editorMounted local guard for post-await writes inside uploadOne
- AssetSidebar.fetchAssets gets loadToken ratchet (plain let, not \$state)
  with all three post-await writes token-gated (assets, listError, loading=false)
- Stop-on-any-invalid pre-pass validation in sidebar before onUploadFile
- disabled prop added to both components
- ItemEditPage call-site migrates to courseAssetContext(vid)
- Existing tests migrated; all regression cases pass"
```

- [ ] **Step 21: Per-task review loop** (reviewer + codex — critical for this task)

---

## Task 5b: Run-mode tests for MarkdownEditor + AssetSidebar

**Files:**
- Modify: `frontend/src/tests/MarkdownEditor.svelte.test.ts` (or split into a new run-mode file)
- Modify: `frontend/src/tests/AssetSidebar.svelte.test.ts`

- [ ] **Step 1: Add run-mode test cases**

Each is a top-level `it()` block; mount the component with `assetContext: runAssetContext(42)`.

The test file MUST start with the `makeDropEvent` helper at top-level (round-5 reviewers 2 + 5 catch: prior plan placed this in Step 3, causing Step 2's `vitest run` to fail with `ReferenceError: makeDropEvent is not defined` instead of the intended assertion failure — breaking TDD's red→green signal).

```ts
import { runAssetContext } from '../lib/assetContext';

// Module-level helper used by every drop-related `it(...)` body below.
// Must be defined BEFORE any `describe`/`it` so the bodies see it at parse time.
function makeDropEvent(files: File[]): DragEvent {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  return new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
}

describe('AssetSidebar with runAssetContext', () => {
  it('list hits /api/runs/{rid}/assets', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(AssetSidebar, { target, props: {
      assetContext: runAssetContext(42),
      onInsert: vi.fn(),
      onUploadFile: vi.fn(),
    } });
    await settle();
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/42/assets'),
      expect.any(Object),
    );
    unmount(cmp);
  });

  it('imgSrc renders /api/runs/{rid}/assets/{file}', async () => {
    fetchSpy.mockImplementation(() => jres([{ id: 1, filename: 'd.png', mime_type: 'image/png', file_size: 1, is_referenced: false }]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(AssetSidebar, { target, props: { assetContext: runAssetContext(42), onInsert: vi.fn(), onUploadFile: vi.fn() } });
    await settle();
    const img = target.querySelector('img[src*="/api/runs/42/assets/d.png"]');
    expect(img).toBeTruthy();
  });

  it('section label says "Run assets"', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(AssetSidebar, { target, props: { assetContext: runAssetContext(42), onInsert: vi.fn(), onUploadFile: vi.fn() } });
    await settle();
    expect(target.textContent).toContain('Run assets');
  });

  it('AbortController cancellation propagates: signal-abort rejects upload via DOMException', async () => {
    // Sidebar calls onUploadFile which is the MarkdownEditor's uploadOne in production.
    // For this isolated AssetSidebar test, inject a uploadOne-shape mock that aborts.
    let injectedSignal: AbortSignal | undefined;
    const abortableUpload = vi.fn(async (file: File) => {
      const c = new AbortController();
      injectedSignal = c.signal;
      setTimeout(() => c.abort(), 5);
      await new Promise((_resolve, reject) => {
        c.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
      return null;
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(AssetSidebar, { target, props: {
      assetContext: runAssetContext(42),
      onInsert: vi.fn(),
      onUploadFile: abortableUpload,
    } });
    await settle();
    // abortableUpload resolves to null; sidebar's drop-loop must break on null without throwing.
    const dropZone = target.querySelector('[data-testid="drop-zone"]') as HTMLElement;
    dropZone.dispatchEvent(makeDropEvent([new File(['x'], 'x.png', { type: 'image/png' })]));
    await settle();
    expect(abortableUpload).toHaveBeenCalledTimes(1);
  });

  it('stop-on-any-invalid pre-pass: one bad file in 3-drop sets uploadError and skips ALL uploads', async () => {
    const onUploadFile = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    let uploadError = $state(null);
    mount(AssetSidebar, { target, props: {
      assetContext: runAssetContext(42),
      onInsert: vi.fn(),
      onUploadFile,
      get uploadError() { return uploadError; },
      set uploadError(v) { uploadError = v; },
    } });
    await settle();
    const dropZone = target.querySelector('[data-testid="drop-zone"]') as HTMLElement;
    dropZone.dispatchEvent(makeDropEvent([
      new File(['ok'], 'a.png', { type: 'image/png' }),
      new File(['bad'], 'evil.exe', { type: 'application/octet-stream' }),
    ]));
    await settle();
    expect(onUploadFile).not.toHaveBeenCalled();
    expect(uploadError?.detail).toContain('extension not allowed');
  });

  it('multi-file sidebar drop: 3 valid files → onUploadFile called 3 times with batch counters, fetchAssets refetches 3 times after initial mount', async () => {
    fetchSpy.mockImplementation(() => jres([{ id: 1, filename: 'a.png', mime_type: 'image/png', file_size: 1, is_referenced: false }]));
    const onUploadFile = vi.fn().mockResolvedValue({ id: 1, filename: 'a.png', mime_type: 'image/png', file_size: 1, is_referenced: false });
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(AssetSidebar, { target, props: {
      assetContext: runAssetContext(42),
      onInsert: vi.fn(),
      onUploadFile,
    } });
    await settle();
    fetchSpy.mockClear();   // reset after initial-mount fetch
    const dropZone = target.querySelector('[data-testid="drop-zone"]') as HTMLElement;
    const files = ['a.png', 'b.png', 'c.png'].map(n => new File(['x'], n, { type: 'image/png' }));
    dropZone.dispatchEvent(makeDropEvent(files));
    await settle();
    expect(onUploadFile).toHaveBeenCalledTimes(3);
    expect(onUploadFile.mock.calls[0][1]).toEqual({ current: 1, total: 3 });
    expect(onUploadFile.mock.calls[1][1]).toEqual({ current: 2, total: 3 });
    expect(onUploadFile.mock.calls[2][1]).toEqual({ current: 3, total: 3 });
    // 3 GET refetches (one per success), filtered to /assets endpoint.
    const listCalls = fetchSpy.mock.calls.filter(c => String(c[0]).includes('/api/runs/42/assets') && (c[1] as any)?.method !== 'POST');
    expect(listCalls.length).toBe(3);
  });
});

describe('MarkdownEditor with runAssetContext', () => {
  it('renderPreview POSTs /api/runs/{rid}/render', async () => {
    fetchSpy.mockImplementation(() => jres({ html: '<p>x</p>' }));
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(MarkdownEditor, { target, props: {
      assetContext: runAssetContext(42),
      value: 'hi',
    } });
    await settle();
    const previewBtn = target.querySelector('button[data-action="preview"]') as HTMLButtonElement;
    previewBtn.click();
    await settle();
    const renderCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/runs/42/render') && (c[1] as any)?.method === 'POST');
    expect(renderCall).toBeTruthy();
  });

  it('textarea-drop hits /api/runs/{rid}/assets (not /api/assets/...)', async () => {
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/runs/42/assets') && (init as any)?.method === 'POST') {
        return jres({ id: 1, filename: 'x.png', mime_type: 'image/png', file_size: 1, is_referenced: false });
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(MarkdownEditor, { target, props: {
      assetContext: runAssetContext(42),
      value: '',
    } });
    await settle();
    const textarea = target.querySelector('textarea') as HTMLTextAreaElement;
    textarea.dispatchEvent(makeDropEvent([new File(['x'], 'x.png', { type: 'image/png' })]));
    await settle();
    const postCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/runs/42/assets') && (c[1] as any)?.method === 'POST');
    expect(postCall).toBeTruthy();
    expect(String(postCall![0])).not.toContain('/api/assets/');
  });

  it('disabled prop blocks all interactive handlers', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(MarkdownEditor, { target, props: {
      assetContext: runAssetContext(42),
      value: '',
      disabled: true,
    } });
    await settle();
    const textarea = target.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    const previewBtn = target.querySelector('button[data-action="preview"]') as HTMLButtonElement;
    expect(previewBtn.disabled).toBe(true);
  });

  it('editorMounted local guard: late upload resolve after unmount does NOT write state', async () => {
    // Round-2 reviewer-1 catch: T6a covers `mounted` (modal-level), but the
    // MarkdownEditor-internal `editorMounted` flag introduced in T5a.A Step 3
    // has no test of its own. Without coverage, a regression that drops the
    // `if (!editorMounted) return;` guard inside uploadOne goes unnoticed.
    let resolveUpload: (r: Response) => void = () => {};
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/runs/42/assets') && (init as any)?.method === 'POST') {
        return new Promise<Response>((resolve) => { resolveUpload = resolve; });
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(MarkdownEditor, { target, props: {
      assetContext: runAssetContext(42),
      value: '',
    } });
    await settle();
    // Trigger a textarea drop to start an upload
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'x.png', { type: 'image/png' }));
    ta.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await settle();
    // Unmount BEFORE the upload resolves
    unmount(cmp);
    await settle();
    // Late resolve — uploadOne's editorMounted guard must short-circuit; no throw,
    // no insertAtCursor on a destroyed component.
    expect(() => {
      resolveUpload({ ok: true, status: 200, json: () => Promise.resolve({ id: 1, filename: 'x.png', mime_type: 'image/png', file_size: 1, is_referenced: false }) } as Response);
    }).not.toThrow();
    await settle();
    // No assertion on DOM (target may still contain the unmounted shell) — the
    // contract is "no error from a post-await state write on a destroyed component".
  });
});

describe('AssetSidebar error surfaces (reviewer-1 catch — spec lines 525, 527)', () => {
  it('asset delete 409: surfaces backend message in sidebar error slot', async () => {
    // Mount sidebar with one asset; click delete; mock DELETE to return 409 with
    // {detail: "Asset 'X' is referenced by N mini-project(s). Use ?force=true to delete."}.
    // Assert the message renders in the sidebar's error slot (post-delete state).
    //
    // Codex catch: AssetSidebar.svelte:231-236 hides the trash button entirely
    // when `is_referenced: true` (renders `<span class="used">` badge instead).
    // The 409 path exists for the race where the asset becomes referenced
    // server-side BETWEEN page load and the delete click — so seed
    // `is_referenced: false` (client thinks it's deletable) and have the
    // server return 409 to model the race.
    const target = document.createElement('div');
    document.body.appendChild(target);
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/assets/1') && (init as any)?.method === 'DELETE') {
        return jres({ detail: "Asset 'pic.png' is referenced by 2 mini-project(s). Use ?force=true to delete." }, 409);
      }
      return jres([{ id: 1, filename: 'pic.png', mime_type: 'image/png', file_size: 100, is_referenced: false }]);
    });
    mount(AssetSidebar, { target, props: {
      assetContext: runAssetContext(42),
      onInsert: vi.fn(),
      onUploadFile: vi.fn(),
    } });
    await settle();
    // Round-2 reviewer-5 catch: AssetSidebar uses data-testid="delete-trash" /
    // "delete-confirm" / "delete-cancel" with NO id suffix (verified
    // AssetSidebar.svelte:241/247/255). Scope the selector to the asset row by
    // its data-testid="asset-row-1" wrapper.
    const row1 = target.querySelector('[data-testid="asset-row-1"]') as HTMLElement;
    (row1.querySelector('[data-testid="delete-trash"]') as HTMLButtonElement).click();
    await settle();
    (row1.querySelector('[data-testid="delete-confirm"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain("referenced by 2 mini-project");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/tests/AssetSidebar src/tests/MarkdownEditor
```

Expected: new test cases FAIL because the run-mode behaviors (run-asset URLs, runAssetContext upload path, etc.) haven't been implemented yet. The `makeDropEvent` helper is defined at the top of the file (Step 1 above), so failures are assertion failures, not `ReferenceError`s.


- [ ] **Step 3: Implement the run-mode behaviors**

T5a already implemented the AssetContext abstraction; these tests verify the run-mode path through it. Any remaining gaps (e.g., the section-label "Run assets" if not yet conditional) get implemented here.

- [ ] **Step 4: Tests pass**

```bash
cd frontend && npx vitest run
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tests/MarkdownEditor* frontend/src/tests/AssetSidebar*
git commit -m "test(frontend): MarkdownEditor + AssetSidebar run-mode regression tests — T5b

Covers: preview URL hits /api/runs/{rid}/render, list URL, imgSrc URL,
textarea drop hits run endpoint not course endpoint, AbortController
cancellation propagation, stop-on-any-invalid pre-pass, multi-file
sidebar drop with batch counters and per-success fetchAssets refetch."
```

- [ ] **Step 6: Per-task review loop** (reviewer + codex)

---

## Task 6a: `MiniProjectModal.svelte` — create + edit + closeForCurrentStage

This is the modal shell with everything EXCEPT publish (T6b).

**Files:**
- Create: `frontend/src/components/runs/MiniProjectModal.svelte`
- Create: `frontend/src/tests/MiniProjectModal.create-edit.svelte.test.ts`

**Read the spec §"MiniProjectModal.svelte" lines 414-485 before starting.** Code patterns are listed verbatim there; copy them.

- [ ] **Step 1: Write the failing test for create-mode happy path**

Create `frontend/src/tests/MiniProjectModal.create-edit.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import MiniProjectModal from '../components/runs/MiniProjectModal.svelte';
import type { MiniProjectResponse, BlockResponse } from '../lib/types';

const fetchSpy = vi.fn();
// Round-5 reviewer-2 catch: T6a's modal registers a `window` keydown listener
// in onMount and removes it in onDestroy. If a test forgets `unmount(cmp)`,
// the listener leaks across tests — subsequent Escape dispatches fire stale
// onClose spies. Track mounted components and unmount them in afterEach.
const mounted: ReturnType<typeof mount>[] = [];
function trackedMount(...args: Parameters<typeof mount>): ReturnType<typeof mount> {
  const cmp = mount(...args);
  mounted.push(cmp);
  return cmp;
}

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
});

afterEach(() => {
  while (mounted.length) {
    try { unmount(mounted.pop()!); } catch { /* already unmounted by test */ }
  }
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

// Round-2 reviewer-2/5 catch: the assignment textarea lives INSIDE MarkdownEditor
// (verified `frontend/src/components/editor/MarkdownEditor.svelte:209-219`), which
// renders a bare `<textarea>` with no `name` attribute. Since MiniProjectModal has
// exactly one textarea in its DOM tree, `target.querySelector('textarea')` is the
// canonical, unambiguous selector. If a future change introduces a second textarea
// (e.g., a notes field), narrow with `.body textarea` instead.

const blocks: BlockResponse[] = [
  // Round-2 reviewer-5 catch: full 7-field shape (schemas.py:69, types.ts T2.B).
  { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 0, info: '', info_html: '' },
];

describe('MiniProjectModal — create mode', () => {
  it('renders block picker for create; POST body shape correct on Save (including all-null deadlines)', async () => {
    // Reviewer-2 catch: arrow functions don't have `arguments`. Use explicit (url, init).
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/runs/10/mini-projects') && (init as any)?.method === 'POST') {
        return jres({ id: 99 } as MiniProjectResponse);
      }
      return jres([]);  // list endpoint
    });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: {
      runId: 10,
      mode: 'create',
      initial: null,
      availableBlocks: blocks,
      currentBlock: null,
      runIsPublished: true,
      runEndDate: '2026-06-30',
      onClose, onSaved,
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    expect(target.textContent).toContain('Intro');
    const textarea = target.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'My assignment';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const saveBtn = target.querySelector('button[data-action="save"]') as HTMLButtonElement;
    saveBtn.click();
    await settle();
    const postCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/runs/10/mini-projects') && (c[1] as any)?.method === 'POST');
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as any).body);
    expect(body.block_id).toBe(1);
    expect(body.assignment_md).toBe('My assignment');
    // Reviewer-2 catch: verify all three null deadlines are PRESENT (not undefined-removed by JSON.stringify)
    expect(body.soft_deadline).toBeNull();
    expect(body.hard_deadline).toBeNull();
    expect(body.resubmission_deadline).toBeNull();
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Save disabled when availableBlocks is empty (block_id would be null)', async () => {
    // Reviewer-5 catch: formData.block_id initializer falls back to null when
    // availableBlocks[0]?.id is undefined; saveError must catch this so we don't POST {block_id: null}.
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: {
      runId: 10, mode: 'create', initial: null,
      availableBlocks: [],  // empty
      currentBlock: null, runIsPublished: true, runEndDate: '2026-06-30',
      onClose: vi.fn(), onSaved: vi.fn(),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    const textarea = target.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'x';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const saveBtn = target.querySelector('button[data-action="save"]') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('422 on POST: renders field-level error spans + aria-describedby wiring (spec line 526)', async () => {
    // Codex catch: spec 526 mandates field-level UX for 422. Backend returns
    // ValidationErrorDetail[] like `[{ loc: ['body', 'assignment_md'], msg: 'must be non-empty', type: 'value_error' }]`.
    // ApiError.validationErrors() returns the array; handleSave maps last-loc-segment → msg.
    // Template renders <span id="err-assignment_md"> + the input/editor gets aria-describedby.
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/runs/10/mini-projects') && (init as any)?.method === 'POST') {
        return jres({
          detail: [
            { loc: ['body', 'assignment_md'], msg: 'must be non-empty', type: 'value_error' },
            { loc: ['body', 'hard_deadline'], msg: 'must be ISO 8601', type: 'value_error' },
          ],
        }, 422);
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: {
      runId: 10, mode: 'create', initial: null,
      availableBlocks: blocks, currentBlock: null,
      runIsPublished: true, runEndDate: '2026-06-30',
      onClose: vi.fn(), onSaved: vi.fn(),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'x';  // satisfy client saveError so handleSave proceeds to POST
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    (target.querySelector('button[data-action="save"]') as HTMLButtonElement).click();
    await settle();
    // Field-level error spans rendered with stable IDs:
    const assignErr = target.querySelector('#err-assignment_md');
    expect(assignErr).toBeTruthy();
    expect(assignErr!.textContent).toContain('must be non-empty');
    const hardErr = target.querySelector('#err-hard_deadline');
    expect(hardErr).toBeTruthy();
    expect(hardErr!.textContent).toContain('must be ISO 8601');
    // aria-describedby wired on the corresponding inputs:
    const hardInput = Array.from(target.querySelectorAll('input[type="datetime-local"]'))
      .find(el => el.getAttribute('aria-describedby') === 'err-hard_deadline');
    expect(hardInput).toBeTruthy();
    // Codex re-review catch: ALSO assert the <textarea> (inside MarkdownEditor)
    // carries aria-describedby="err-assignment_md". This locks in the
    // T5a forwarding of `ariaDescribedby` onto the inner textarea — a
    // future regression that drops the forwarding would otherwise pass
    // the per-input check on hard_deadline but silently break the
    // assignment-text affordance.
    const textareaEl = target.querySelector('textarea') as HTMLTextAreaElement;
    expect(textareaEl.getAttribute('aria-describedby')).toBe('err-assignment_md');
    // Summary banner also rendered (per ApiError.displayMessage on 422):
    expect(target.textContent).toContain('Please correct the highlighted fields.');
  });
});

describe('MiniProjectModal — edit mode + dirty close', () => {
  // Round-4 reviewer-1 catch: MiniProjectResponse requires `title` and `assignment_html`
  // (non-optional per types.ts T2.B addition). Old fixtures omitted them; strict TS would
  // reject. Widened to the full 11-field shape across all MP literals in this plan.
  const initial: MiniProjectResponse = {
    id: 99, run_id: 10, block_id: 1, title: 'Mini project for Block 1',
    assignment_md: 'orig text', assignment_html: '<p>orig text</p>',
    soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
    is_published: false, first_submitted_at: null,
    created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
  };

  it('prefills assignment_md and disables block picker for edit', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: {
      runId: 10, mode: 'edit', initial, availableBlocks: [],
      currentBlock: blocks[0], runIsPublished: true, runEndDate: '2026-06-30',
      onClose: vi.fn(), onSaved: vi.fn(),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.value).toBe('orig text');
  });

  it('clean close: backdrop click → onClose called', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: {
      runId: 10, mode: 'edit', initial, availableBlocks: [],
      currentBlock: blocks[0], runIsPublished: true, runEndDate: '2026-06-30',
      onClose, onSaved: vi.fn(),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    const backdrop = target.querySelector('[data-role="backdrop"]') as HTMLElement;
    backdrop.click();
    await settle();
    expect(onClose).toHaveBeenCalled();
  });

  it('clean close: Escape key → onClose called (spec line 482 — backdrop/X/Escape route through closeForCurrentStage)', async () => {
    // Round-4 reviewer-1 catch: prior test list omitted Escape coverage.
    // Round-5 reviewer-2 catch: capture cmp + unmount so the window listener is
    // removed before subsequent tests fire dispatchEvent.
    fetchSpy.mockImplementation(() => jres([]));
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(MiniProjectModal, { target, props: {
      runId: 10, mode: 'edit', initial, availableBlocks: [],
      currentBlock: blocks[0], runIsPublished: true, runEndDate: '2026-06-30',
      onClose, onSaved: vi.fn(),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(onClose).toHaveBeenCalled();
    unmount(cmp);
  });

  it('dirty close: typing then X flips footer to InlineConfirm; Keep editing reverts; Discard closes', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: {
      runId: 10, mode: 'edit', initial, availableBlocks: [],
      currentBlock: blocks[0], runIsPublished: true, runEndDate: '2026-06-30',
      onClose, onSaved: vi.fn(),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'modified';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    // click X
    (target.querySelector('button[data-action="close-x"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Discard unsaved changes?');
    expect(onClose).not.toHaveBeenCalled();
    // Keep editing — InlineConfirm cancel button selected by class (no data-action on cancel)
    (target.querySelector('button.cancel') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).not.toContain('Discard unsaved changes?');
    // X again → InlineConfirm again → Discard via confirmDataAction
    (target.querySelector('button[data-action="close-x"]') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('button[data-action="confirm-discard"]') as HTMLButtonElement).click();
    await settle();
    expect(onClose).toHaveBeenCalled();
  });

  it('mounted-flag rule: close during in-flight save → post-await writes do not fire AND no throw on late-resolve', async () => {
    // Reviewer-2 catch: `onSaved.not.toHaveBeenCalled()` is necessary but not sufficient.
    // Strengthen: wrap the late-resolve in expect().not.toThrow() to confirm Svelte 5
    // doesn't throw on post-destroy reactive writes (which it would if the `mounted`
    // guard were missing in the success branch).
    let resolvePost!: (v: unknown) => void;
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/mini-projects/99') && (init as any)?.method === 'PATCH') {
        return new Promise(r => { resolvePost = r; });
      }
      return jres([]);
    });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(MiniProjectModal, { target, props: {
      runId: 10, mode: 'edit', initial, availableBlocks: [],
      currentBlock: blocks[0], runIsPublished: true, runEndDate: '2026-06-30',
      onClose: vi.fn(), onSaved,
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    (target.querySelector('button[data-action="save"]') as HTMLButtonElement).click();
    await settle();
    unmount(cmp);
    // Resolve the hung PATCH AFTER unmount. The mounted-guard in handleSave must
    // prevent the success branch from writing $state on a destroyed component.
    expect(() => {
      resolvePost({ ok: true, status: 200, json: () => Promise.resolve(initial) } as Response);
    }).not.toThrow();
    await settle();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('inputs disabled while submitting: textarea, datetime fields, block picker, MarkdownEditor all set disabled', async () => {
    // Spec line 606: verify all interactive inputs disable simultaneously when submitting.
    let resolvePost!: (v: unknown) => void;
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/mini-projects') && (init as any)?.method === 'PATCH') {
        return new Promise(r => { resolvePost = r; });
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: {
      runId: 10, mode: 'edit', initial, availableBlocks: [],
      currentBlock: blocks[0], runIsPublished: true, runEndDate: '2026-06-30',
      onClose: vi.fn(), onSaved: vi.fn().mockResolvedValue(undefined),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    (target.querySelector('button[data-action="save"]') as HTMLButtonElement).click();
    await settle();
    // All inputs disabled mid-flight
    expect((target.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
    target.querySelectorAll('input[type="datetime-local"]').forEach(el => {
      expect((el as HTMLInputElement).disabled).toBe(true);
    });
    expect((target.querySelector('button[data-action="save"]') as HTMLButtonElement).disabled).toBe(true);
    resolvePost({ ok: true, status: 200, json: () => Promise.resolve(initial) } as Response);
    await settle();
  });

  it('X during submitting is ignored; subsequent click after submit resolves closes normally', async () => {
    // Spec line 615.
    let resolvePost!: (v: unknown) => void;
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/mini-projects') && (init as any)?.method === 'PATCH') {
        return new Promise(r => { resolvePost = r; });
      }
      return jres([]);
    });
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: {
      runId: 10, mode: 'edit', initial, availableBlocks: [],
      currentBlock: blocks[0], runIsPublished: true, runEndDate: '2026-06-30',
      onClose, onSaved: vi.fn().mockResolvedValue(undefined),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    (target.querySelector('button[data-action="save"]') as HTMLButtonElement).click();
    await settle();
    // X mid-submit: dropped
    (target.querySelector('button[data-action="close-x"]') as HTMLButtonElement).click();
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    // Resolve
    resolvePost({ ok: true, status: 200, json: () => Promise.resolve(initial) } as Response);
    await settle();
    // Now onClose has been called by the save-success path; if not (e.g., dirty),
    // a fresh X click should close cleanly.
    if (!onClose.mock.calls.length) {
      (target.querySelector('button[data-action="close-x"]') as HTMLButtonElement).click();
      await settle();
      expect(onClose).toHaveBeenCalled();
    }
  });

  it('close-during-upload aborts the in-flight upload via bind:uploadAbortController', async () => {
    // Spec line 612. Mount with a stub MarkdownEditor that exposes a controller via
    // its bind:uploadAbortController prop; trigger an upload that hangs; click X;
    // assert the controller's .abort() was called.
    // Implementation hint: this test can't easily use the real MarkdownEditor
    // because controller is internal. Verify behavior by intercepting AbortController
    // via vi.spyOn(globalThis, 'AbortController') OR by injecting a test-double
    // MarkdownEditor through a Svelte test harness. Simplest: spy on AbortController
    // prototype's abort method globally for this test.
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    let resolveUpload!: (v: unknown) => void;
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/runs/10/assets') && (init as any)?.method === 'POST') {
        return new Promise(r => { resolveUpload = r; });
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: {
      runId: 10, mode: 'edit', initial, availableBlocks: [],
      currentBlock: blocks[0], runIsPublished: true, runEndDate: '2026-06-30',
      onClose: vi.fn(), onSaved: vi.fn(),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    // Simulate a drop on the textarea — the real MarkdownEditor will create the
    // AbortController and assign it via $bindable to the modal. The test relies on
    // production behavior, not stubbed editor.
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'x.png', { type: 'image/png' }));
    ta.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await settle();
    // Click X mid-upload
    (target.querySelector('button[data-action="close-x"]') as HTMLButtonElement).click();
    await settle();
    // closeForCurrentStage should have called abort on the in-flight controller
    expect(abortSpy).toHaveBeenCalled();
    // Cleanup the hanging promise so vitest doesn't hold the worker
    resolveUpload({ ok: true, status: 200, json: () => Promise.resolve({ id: 1, filename: 'x.png' }) } as Response);
    // Round-6 reviewer-5 catch: vitest only auto-restores spies when
    // `restoreMocks: true` is set in vitest.config — otherwise the
    // AbortController.prototype.abort spy persists into subsequent tests and
    // pollutes their mock-call state. Explicit restore.
    abortSpy.mockRestore();
  });

  it('modal layout: container element + header + footer present (structural check, NOT computed-style)', async () => {
    // Round-2 reviewer-3 catch: jsdom does NOT implement CSSOM well — `getComputedStyle`
    // returns empty strings for unset properties and only echoes inline `style="..."`
    // attributes. Scoped-CSS `max-width: 1100px` from <style> blocks WILL NOT show up.
    // The original draft's `computed.maxWidth === '1100px'` assertion fails in jsdom
    // even with correct CSS. Layout/visual regressions belong in Playwright/Cypress;
    // here we only assert structural presence (the elements exist with the expected
    // selectors so styling has somewhere to attach).
    // Spec line 488 + line 616.
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: {
      runId: 10, mode: 'edit', initial, availableBlocks: [],
      currentBlock: blocks[0], runIsPublished: true, runEndDate: '2026-06-30',
      onClose: vi.fn(), onSaved: vi.fn(),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    expect(target.querySelector('.modal')).toBeTruthy();
    expect(target.querySelector('.modal > header')).toBeTruthy();
    expect(target.querySelector('.modal > footer')).toBeTruthy();
    expect(target.querySelector('.backdrop')).toBeTruthy();
    // Visual regression (1100px / 90vh / sticky positioning) is owned by a future
    // Playwright suite — see `accepted-gap` note about visual coverage.
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/tests/MiniProjectModal.create-edit.svelte.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `MiniProjectModal.svelte`** (create + edit + closeForCurrentStage; defer publish to T6b)

Read the spec §"MiniProjectModal.svelte" lines 414-528 verbatim. Skip the publish bullet for now (`[Publish…]` button — comment-stub it; T6b implements). Implementation skeleton:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ApiError } from '../../lib/api';   // round-3 reviewer-1 catch: use e.displayMessage
  import { runAssetContext } from '../../lib/assetContext';
  import { localInputToISO, isoToLocalInput, localTzLabel } from '../../lib/datetime';
  import { createMiniProject, updateMiniProject } from '../../lib/miniProjects';
  import MarkdownEditor from '../editor/MarkdownEditor.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { MiniProjectResponse, BlockResponse } from '../../lib/types';

  let { runId, mode, initial, availableBlocks, currentBlock, runIsPublished, runEndDate, onClose, onSaved, onNavigateToTab }: {
    runId: number;
    mode: 'create' | 'edit';
    initial: MiniProjectResponse | null;
    availableBlocks: BlockResponse[];
    currentBlock: BlockResponse | null;
    runIsPublished: boolean;
    runEndDate: string | null;
    onClose: () => void;
    onSaved: () => Promise<void>;
    onNavigateToTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster') => void;
  } = $props();

  const assetContext = $derived(runAssetContext(runId));

  let formData = $state({
    block_id: initial?.block_id ?? availableBlocks[0]?.id ?? null,
    soft_local: initial?.soft_deadline ? isoToLocalInput(initial.soft_deadline) : '',
    hard_local: initial?.hard_deadline ? isoToLocalInput(initial.hard_deadline) : '',
    resub_local: initial?.resubmission_deadline ? isoToLocalInput(initial.resubmission_deadline) : '',
    assignment_md: initial?.assignment_md ?? '',
  });

  let submitting = $state(false);
  let mounted = $state(false);
  let uploadAbortController = $state<AbortController | null>(null);

  // Dirty-confirm snapshot — see spec lines 444-470
  function currentFormSnapshot() {
    return {
      block_id: formData.block_id ?? null,
      soft_local: formData.soft_local,
      hard_local: formData.hard_local,
      resub_local: formData.resub_local,
      assignment_md: formData.assignment_md,
    };
  }
  // Round-3 reviewer-3 catch: initialize inline (at module-init time, AFTER formData
  // is constructed two lines above). The prior version set this inside onMount, but
  // plain-let writes aren't reactive — the dirty $derived would only re-evaluate the
  // initial snapshot on the first formData mutation, working by happy-path coincidence.
  // Inline initialization is deterministic: at $derived-evaluation time, snapshot is
  // already defined.
  const initialFormSnapshot = currentFormSnapshot();
  // Spec line 482 mandates Escape route through closeForCurrentStage alongside
  // backdrop and [×]. Register a window-level keydown listener (modal renders
  // top-level via parent's {#if}; focus can be on any descendant).
  //
  // Round-5 reviewer-4/5 catch: the COMMENT used to claim a target check for
  // contenteditable/textarea but the CODE didn't implement it. We DO want Escape
  // inside the assignment textarea to close the modal (that's the spec: Escape
  // anywhere in the modal triggers closeForCurrentStage). So we drop the
  // (mis-stated) target check and the listener fires on any Escape — matching
  // the existing spec contract.
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeForCurrentStage();
    }
  }
  onMount(() => {
    mounted = true;
    window.addEventListener('keydown', onWindowKeydown);
  });
  onDestroy(() => {
    mounted = false;
    window.removeEventListener('keydown', onWindowKeydown);
  });
  // Invariant: only ONE MiniProjectModal mounts at a time. RunMiniProjectsTab's
  // template uses `{#if modalMode != null}` so modeswitching from edit→create
  // unmounts the prior instance (calling onDestroy → removeEventListener) before
  // mounting the new one. No listener-stack concern.

  let pendingClose = $state(false);
  let discarding = $state(false);   // reviewer-3 catch: discarding flag avoids closeForCurrentStage re-entrancy

  // Round-2 reviewer-3 catch: hoist localTzLabel() out of the template — it was
  // being called 3x per render (once per deadline label). One $derived call is
  // enough; the value only changes when the host TZ changes (effectively never
  // within one session). Inline `{tzLabel}` in template instead of `{localTzLabel()}`.
  const tzLabel = $derived(localTzLabel());
  const dirty = $derived(
    // initialFormSnapshot is non-null by inline init; drop the prior null guard.
    JSON.stringify(currentFormSnapshot()) !== JSON.stringify(initialFormSnapshot),
  );

  function closeForCurrentStage() {
    if (submitting) return;
    if (dirty && !pendingClose && !discarding) {   // skip the gate when discarding=true
      pendingClose = true;
      return;
    }
    uploadAbortController?.abort();
    onClose();
    // Round-3 reviewer-5 catch: reset `discarding` AFTER onClose, not before.
    // Resetting before onClose meant a transitional parent re-entering after a delay
    // (still with the form dirty) would re-enter the dirty gate — opposite of intent.
    // After onClose, the modal will unmount in the normal case (so this is a no-op),
    // but if the parent paused unmount, a subsequent call sees discarding=false AND
    // the bypass has already happened — which is the safe default.
    discarding = false;
  }

  function confirmDiscard() {
    // Called from InlineConfirm's onConfirm. Set discarding=true so the next call to
    // closeForCurrentStage bypasses the dirty gate and proceeds straight to onClose.
    discarding = true;
    pendingClose = false;
    closeForCurrentStage();
  }

  // Validation (spec lines 491-502, Publish-specific in T6b)
  const saveError = $derived.by((): string | null => {
    // Reviewer-5 catch: create mode with empty availableBlocks gives block_id=null;
    // Save must be blocked or it'll POST {block_id: null} → 422.
    if (mode === 'create' && formData.block_id == null) return 'No available blocks to assign — every block already has a mini-project';
    if (!formData.assignment_md.trim()) return 'Assignment text is required';
    if (formData.soft_local && formData.hard_local) {
      if (new Date(localInputToISO(formData.soft_local)) > new Date(localInputToISO(formData.hard_local))) {
        return 'Soft deadline must be before hard deadline';
      }
    }
    if (formData.hard_local && formData.resub_local) {
      if (new Date(localInputToISO(formData.hard_local)) > new Date(localInputToISO(formData.resub_local))) {
        return 'Hard deadline must be before resubmission deadline';
      }
    }
    return null;
  });

  let serverError = $state<string | null>(null);  // for 409/PATCH banner, 404, 5xx
  // Codex catch: spec line 526 mandates field-level UX for 422
  // ValidationErrorDetail[] payloads — not just a single banner. Map
  // ApiError.validationErrors() → `{ [fieldName]: msg }` so the template can
  // render per-field error spans with stable IDs that match each input's
  // `aria-describedby`. Field names come from the last segment of each
  // ValidationErrorDetail.loc (api.ts:21-24 + types.ts:186-190 —
  // `loc: (string|number)[]`, typical shape `['body', 'block_id']`).
  let fieldErrors = $state<Record<string, string>>({});

  function mapValidationErrors(details: import('../../lib/types').ValidationErrorDetail[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of details) {
      // Pick the last string segment of loc; if loc is empty or all-numeric,
      // bucket under '_' so the banner still surfaces something.
      const segs = d.loc.filter((s): s is string => typeof s === 'string');
      const key = segs.length > 0 ? segs[segs.length - 1] : '_';
      // First wins — backend rarely emits multiple errors per field.
      if (!(key in out)) out[key] = d.msg;
    }
    return out;
  }

  async function handleSave() {
    if (saveError) return;
    submitting = true;
    serverError = null;
    fieldErrors = {};   // Codex catch: clear stale field errors on retry.
    try {
      const body = {
        block_id: formData.block_id!,
        assignment_md: formData.assignment_md,
        soft_deadline: formData.soft_local ? localInputToISO(formData.soft_local) : null,
        hard_deadline: formData.hard_local ? localInputToISO(formData.hard_local) : null,
        resubmission_deadline: formData.resub_local ? localInputToISO(formData.resub_local) : null,
      };
      if (mode === 'create') {
        await createMiniProject(runId, body);
      } else {
        const { block_id, ...patchBody } = body;
        await updateMiniProject(initial!.id, patchBody);
      }
      if (!mounted) return;
      await onSaved();
      if (!mounted) return;
      onClose();
    } catch (e: any) {
      if (!mounted) return;
      // map errors per spec lines 519-531
      // Round-3 reviewer-1 catch: use `e.displayMessage` (the ApiError getter), NOT
      // `e.detail`. `e.detail` may be a `ValidationErrorDetail[]` on 422 (api.ts:7);
      // String-templating that array renders as "[object Object]". `displayMessage`
      // returns a friendly string ("Please correct the highlighted fields.") for that
      // shape and the raw string for plain errors. See api.ts:14-19.
      //
      // Codex catch: for 422 also populate `fieldErrors` from
      // `e.validationErrors()` so the template renders per-field spans
      // (spec line 526). The banner stays as a summary; field spans
      // are the actionable affordance.
      if (e instanceof ApiError && e.status === 404) {
        serverError = 'This mini-project has been deleted. Select-all (Ctrl/Cmd+A) and copy (Ctrl/Cmd+C) from the assignment textarea if you want to preserve your work before closing.';
      } else if (e instanceof ApiError && e.status === 409) {
        serverError = `${e.displayMessage} Refresh the page to see latest.`;
      } else if (e instanceof ApiError && e.status === 422) {
        const details = e.validationErrors();
        if (details) fieldErrors = mapValidationErrors(details);
        serverError = e.displayMessage;  // 'Please correct the highlighted fields.'
      } else if (e instanceof ApiError) {
        serverError = e.displayMessage;
      } else {
        serverError = e?.message ?? 'Save failed';
      }
    } finally {
      if (mounted) submitting = false;
    }
  }
</script>

<!-- Layout: max-width 1100, max-height 90vh, sticky header/footer, side-by-side body w/ @media 880px stack -->
<div class="backdrop" data-role="backdrop" onclick={closeForCurrentStage}></div>
<div class="modal" role="dialog">
  <header>
    <h2>{mode === 'create' ? 'New mini-project' : `Edit — Block ${currentBlock?.order ?? '?'} — ${currentBlock?.title ?? ''}`}</h2>
    <button data-action="close-x" onclick={closeForCurrentStage} aria-label="Close">×</button>
  </header>
  <div class="body">
    <!--
      Codex catch: spec line 526 mandates field-level UX for 422 errors.
      Each input below renders an `aria-describedby` pointing at a stable
      ID; if `fieldErrors[name]` is set, render a `<span id="err-{name}">`
      after the input. Screen readers announce the error when focus lands.
      The keys (`block_id`, `assignment_md`, `soft_deadline`, etc.) match
      the request body field names — the backend's Pydantic loc will
      typically end in those names, and `mapValidationErrors()` keys by
      the last loc segment.
    -->
    <!-- block picker (create) or read-only label (edit) -->
    {#if mode === 'create'}
      <label>
        Block
        <select bind:value={formData.block_id} disabled={submitting}
          aria-describedby={fieldErrors.block_id ? 'err-block_id' : undefined}>
          {#each availableBlocks as b (b.id)}
            <option value={b.id}>Block {b.order} — {b.title}</option>
          {/each}
        </select>
      </label>
      {#if fieldErrors.block_id}<span id="err-block_id" class="field-error" role="alert">{fieldErrors.block_id}</span>{/if}
    {/if}
    <!-- deadlines: 3 datetime-local inputs; tzLabel hoisted to $derived to avoid 3 redundant calls per render (round-2 reviewer-3 catch) -->
    <label>Soft deadline {tzLabel}
      <input type="datetime-local" bind:value={formData.soft_local} disabled={submitting}
        aria-describedby={fieldErrors.soft_deadline ? 'err-soft_deadline' : undefined} />
    </label>
    {#if fieldErrors.soft_deadline}<span id="err-soft_deadline" class="field-error" role="alert">{fieldErrors.soft_deadline}</span>{/if}
    <label>Hard deadline {tzLabel}
      <input type="datetime-local" bind:value={formData.hard_local} disabled={submitting}
        aria-describedby={fieldErrors.hard_deadline ? 'err-hard_deadline' : undefined} />
    </label>
    {#if fieldErrors.hard_deadline}<span id="err-hard_deadline" class="field-error" role="alert">{fieldErrors.hard_deadline}</span>{/if}
    <label>Resubmission deadline {tzLabel}
      <input type="datetime-local" bind:value={formData.resub_local} disabled={submitting}
        aria-describedby={fieldErrors.resubmission_deadline ? 'err-resubmission_deadline' : undefined} />
    </label>
    {#if fieldErrors.resubmission_deadline}<span id="err-resubmission_deadline" class="field-error" role="alert">{fieldErrors.resubmission_deadline}</span>{/if}
    <!-- markdown editor + run assets sidebar.
         Codex re-review catch: `aria-describedby={...}` on a Svelte 5
         child component lands on the rendered wrapper, NOT inner elements.
         The textarea inside MarkdownEditor needs the attribute for
         assistive-tech focus announcements. T5a now declares a
         camelCase `ariaDescribedby?: string` prop on MarkdownEditor that
         it forwards to the inner `<textarea aria-describedby={...}>` —
         passed here with the same value the wrapping span ID uses. -->
    <MarkdownEditor
      {assetContext}
      bind:value={formData.assignment_md}
      disabled={submitting}
      bind:uploadAbortController
      ariaDescribedby={fieldErrors.assignment_md ? 'err-assignment_md' : undefined}
    />
    {#if fieldErrors.assignment_md}<span id="err-assignment_md" class="field-error" role="alert">{fieldErrors.assignment_md}</span>{/if}
    {#if serverError}
      <div class="banner banner-error" role="alert">{serverError}</div>
    {/if}
  </div>
  <footer>
    {#if pendingClose}
      <InlineConfirm
        warning="Discard unsaved changes?"
        confirmLabel="Discard"
        confirmDataAction="confirm-discard"
        onCancel={() => { pendingClose = false; }}
        onConfirm={confirmDiscard}
      />
      <!-- Note: InlineConfirm actual API only exposes `confirmDataAction` on the
           confirm button (verified frontend/src/components/ui/InlineConfirm.svelte:4-20).
           The cancel button has class="cancel" but no data-action. Tests must select
           the cancel button via `button.cancel` (NOT `button[data-action=...]`).
           Reviewer-2/3/5 catch. -->
    {:else}
      <button onclick={closeForCurrentStage}>Cancel</button>
      <button data-action="save" disabled={submitting || !!saveError} onclick={handleSave}>
        {submitting ? 'Saving…' : 'Save'}
      </button>
      <!-- [Publish…] stub — T6b implements -->
    {/if}
  </footer>
</div>

<style>
  /* Round-7 reviewer-1 catch: spec line 488 mandates sticky header + footer.
     `.modal` is `overflow: auto`, so the sticky elements stick to its
     scrolling viewport (top: 0 for header, bottom: 0 for footer). Without
     these, long body content scrolls header/footer out of view — failing
     spec line 488 + the related smoke step at spec 641-653. The T6a
     "modal layout" test only asserts structural presence (jsdom can't
     reliably check computed styles for scoped CSS), so this rule would
     silently regress if dropped. */
  .modal { max-width: 1100px; max-height: 90vh; overflow: auto; }
  .modal > header { position: sticky; top: 0; background: inherit; z-index: 1; }
  .modal > footer { position: sticky; bottom: 0; background: inherit; z-index: 1; }
  @media (max-width: 880px) {
    .body { display: flex; flex-direction: column; }
  }
</style>
```

(This is a skeleton — fill in remaining UI details from the spec. The test recipe drives exactness. `data-action="..."` attributes are for test selectors.)

- [ ] **Step 4: Run tests until all green**

```bash
cd frontend && npx vitest run src/tests/MiniProjectModal.create-edit.svelte.test.ts
```

Iterate: fix issues; re-run.

- [ ] **Step 5: Full test suite green**

```bash
cd frontend && npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/runs/MiniProjectModal.svelte frontend/src/tests/MiniProjectModal.create-edit.svelte.test.ts
git commit -m "feat(frontend): MiniProjectModal create/edit + closeForCurrentStage — T6a

- create + edit modes via runAssetContext(runId)
- closeForCurrentStage flow: backdrop/X/Escape route through it;
  pendingClose two-pass via InlineConfirm footer-row; clean form passes
  straight to onClose; dirty form flips footer to confirm
- mounted flag rule for post-await state writes (close-during-Save
  unmount-state-write race protected)
- Inputs disabled while submitting (textarea, datetime inputs, block
  picker, MarkdownEditor via disabled prop)
- 404 on Save → Ctrl/Cmd+A/+C banner copy
- 409 on PATCH → Refresh banner
- Tests cover: create POST body shape, edit prefill, clean close,
  dirty close (Keep editing / Discard), mounted-flag close-mid-save"
```

- [ ] **Step 7: Per-task review loop** (reviewer + codex)

---

## Task 6b: `MiniProjectModal.svelte` — publish flow

**Files:**
- Modify: `frontend/src/components/runs/MiniProjectModal.svelte`
- Create: `frontend/src/tests/MiniProjectModal.publish.svelte.test.ts`

- [ ] **Step 1: Write failing tests for publish flow**

Create `frontend/src/tests/MiniProjectModal.publish.svelte.test.ts`. Cover (reviewer-1/2 catches added — error-mapping rows 4-7 of spec lines 519-531 now have coverage):

- `[Publish…]` button rendered only in edit mode AND `!initial.is_published`
- Publish click → InlineConfirm with copy "Once published, this cannot be undone..."
- Publish confirm → POST /api/mini-projects/{id}/publish → onSaved + close
- Missing-deadline precondition: inline banner shows "Hard deadline must be set" with `aria-describedby`
- Missing-resub-deadline precondition: bullet shows
- `runIsPublished === false`: bullet shows "Run must be published — Open Overview to publish" + clicking link calls `onNavigateToTab('overview')`
- `runEndDate === null`: bullet shows "Run end date must be set — Open Overview to set it"
- `hard_iso > runEndDate + 'T23:59:59Z'`: bullet shows with substituted runEndDate
- `resub_iso > runEndDate + 'T23:59:59Z'`: bullet shows
- **Round-7 reviewer-1 catch — basic ordering preflight (spec lines 495-497)**:
  mount in edit mode with `formData.soft_local > formData.hard_local`; click
  `[Publish…]`; assert precondition banner shows "Soft deadline must be before
  hard deadline" AND that POST /publish is NOT called. Same for `hard > resub`
  asserts "Hard deadline must be before resubmission deadline". Both lock the
  preflight contract so a future refactor doesn't drop them back to server-only.
- **Codex catch — assignment_md preflight (spec lines 491-497)**: mount in edit
  mode, clear the textarea (formData.assignment_md = ''); click `[Publish…]`;
  assert precondition banner shows "Assignment text is required" AND POST
  /publish is NOT called. Locks the contract that the full Save validation is
  re-checked at publish-preflight time, not just the publish-specific gates.
- 409 on publish: inline banner with `e.displayMessage`
- **422 on create (spec line 526)**: mount in create mode; POST returns 422 with `{ detail: [{ loc: ['body', 'block_id'], msg: 'must be set', type: 'value_error' }] }` (codex re-review catch: ApiError.validationErrors() returns null for a string detail per api.ts:21-24, so the field-level branch never executes — must be `ValidationErrorDetail[]`); assert `#err-block_id` span renders with msg AND that `<select>` carries `aria-describedby="err-block_id"`. (Same `ValidationErrorDetail[]` shape as the corresponding T6a test above.)
- **422 on PATCH (spec line 526)**: mount in edit mode; PATCH returns 422 with the same `ValidationErrorDetail[]` shape (e.g., `loc: ['body', 'assignment_md']`); assert the field-level span renders AND the summary banner shows `"Please correct the highlighted fields."`.
- **422 on render preview (spec lines 513, 527)**: mount with markdown that triggers preview render; backend returns 422 `{detail: "Referenced run-assets not found: foo.csv"}`; click Preview; assert inline preview-pane error shows the missing filenames.
- **5xx on publish (spec line 530)**: mount with valid preconditions; POST /publish returns 503; assert red banner stays; modal does NOT close.
- Save and Publish share `submitting`: clicking Publish disables Save and vice versa; button text changes to "Publishing…"
- **Mounted-flag rule for Publish (reviewer-2 catch)**: same shape as the T6a close-during-Save test — close mid-Publish, assert no post-await write fires and the late resolve doesn't throw.

Use the same test scaffold from T6a (mount, settle, fetch spy).

- [ ] **Step 2: Implement the publish flow**

Read spec lines 484, 491-510, 519-531 verbatim. **Note on `runEndDate` type** (reviewer-5 catch): `frontend/src/lib/types.ts:271` currently types `Run.end_date` as non-null `string`. Spec line 499 says "Run table currently allows nullable end_date in some legacy rows, so the prop type stays `string | null`". Resolution for the plan: accept `runEndDate: string | null` on the MiniProjectModal prop, AND treat the null path as defensive (most runs in practice have an end_date). If a future spec hardens the backend to non-null, drop the null bullet then. Don't change `lib/types.ts:271` in this task — that's a wider type-tightening initiative.

Add:

```ts
import { publishMiniProject } from '../../lib/miniProjects';

const publishCheckResult = $derived.by(() => {
  if (mode !== 'edit' || initial?.is_published) return null;
  const unmet: string[] = [];
  // Round-7 reviewer-1 + codex catch: spec lines 491-497 say "For Publish,
  // ALL of the above PLUS" — where "the above" is the full Save validation
  // (assignment_md non-empty AND soft<=hard AND hard<=resub when both set).
  // Without these here, a user could clear assignment_md or invert ordering
  // and click Publish, getting only a server 422 — failing spec 497's
  // preflight contract. We INCLUDE all three Save-level checks here (in
  // addition to the publish-specific preconditions below) so the precondition
  // banner surfaces them before any network call.
  if (!formData.assignment_md.trim()) unmet.push('Assignment text is required');
  if (formData.soft_local && formData.hard_local) {
    if (new Date(localInputToISO(formData.soft_local)) > new Date(localInputToISO(formData.hard_local))) {
      unmet.push('Soft deadline must be before hard deadline');
    }
  }
  if (formData.hard_local && formData.resub_local) {
    if (new Date(localInputToISO(formData.hard_local)) > new Date(localInputToISO(formData.resub_local))) {
      unmet.push('Hard deadline must be before resubmission deadline');
    }
  }
  if (!formData.hard_local) unmet.push('Hard deadline must be set');
  if (!formData.resub_local) unmet.push('Resubmission deadline must be set');
  if (formData.hard_local) {
    const hardIso = localInputToISO(formData.hard_local);
    if (new Date(hardIso) <= new Date()) unmet.push('Hard deadline must be in the future');
    if (runEndDate === null) {
      unmet.push('Run end date must be set — Open Overview to set it.');
    } else if (hardIso > `${runEndDate}T23:59:59Z`) {
      unmet.push(`Hard deadline must be before run end (${runEndDate})`);
    }
  }
  if (formData.resub_local && runEndDate !== null) {
    const resubIso = localInputToISO(formData.resub_local);
    if (resubIso > `${runEndDate}T23:59:59Z`) {
      unmet.push(`Resubmission deadline must be before run end (${runEndDate})`);
    }
  }
  if (!runIsPublished) unmet.push('Run must be published — Open Overview to publish.');
  return unmet;
});

let pendingPublishConfirm = $state(false);

async function handlePublishClick() {
  pendingPublishConfirm = true;
}

async function confirmPublish() {
  pendingPublishConfirm = false;
  if (publishCheckResult && publishCheckResult.length > 0) return;
  submitting = true;
  serverError = null;
  try {
    await publishMiniProject(initial!.id);
    if (!mounted) return;
    await onSaved();
    if (!mounted) return;
    onClose();
  } catch (e: any) {
    if (!mounted) return;
    // Round-3 reviewer-1 catch: use ApiError.displayMessage (api.ts:14-19) so
    // 422 ValidationErrorDetail[] payloads render as a friendly string instead
    // of "[object Object]".
    serverError = (e instanceof ApiError) ? e.displayMessage : (e?.message ?? 'Publish failed');
  } finally {
    if (mounted) submitting = false;
  }
}
```

Update template to render `[Publish…]` button and the publish-precondition banner with `aria-describedby` linking each bullet to its offending field. Render `pendingPublishConfirm` as InlineConfirm in the footer.

- [ ] **Step 3: Tests pass**

```bash
cd frontend && npx vitest run src/tests/MiniProjectModal.publish.svelte.test.ts
```

- [ ] **Step 4: Full test suite green**

```bash
cd frontend && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/runs/MiniProjectModal.svelte frontend/src/tests/MiniProjectModal.publish.svelte.test.ts
git commit -m "feat(frontend): MiniProjectModal publish flow — T6b

- [Publish…] only in edit mode + !initial.is_published
- Precondition checks (hard set, resub set, hard in future, runEndDate
  set, hard_iso <= runEndDate end-of-day UTC, resub_iso <= runEndDate
  end-of-day UTC, runIsPublished=true) render as inline-banner bullets
  with aria-describedby on offending fields
- 'Open Overview' links call onNavigateToTab('overview')
- Confirm dialog copy: 'Once published, this cannot be undone. To remove
  a published mini-project, use force-delete (also removes submissions).'
- 409 on publish surfaces as inline banner with e.displayMessage
- Save + Publish share submitting; both disabled while either is in flight"
```

- [ ] **Step 6: Per-task review loop** (reviewer + codex)

---

## Task 7: `RunMiniProjectsTab.svelte`

**Files:**
- Create: `frontend/src/components/runs/RunMiniProjectsTab.svelte`
- Create: `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts`

Read spec §"RunMiniProjectsTab.svelte" lines 372-412 + States/Edge Cases table lines 544-557. Code patterns are mostly straightforward template + a force-delete confirm.

- [ ] **Step 1: Write failing tests**

Create `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts`. Cover each row in the States/Edge Cases table:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunMiniProjectsTab from '../components/runs/RunMiniProjectsTab.svelte';
import type { MiniProjectResponse, BlockResponse } from '../lib/types';

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
});

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

const blocks: BlockResponse[] = [
  // Round-2 reviewer-5 catch: full 7-field shape (schemas.py:69, types.ts T2.B).
  { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 0, info: '', info_html: '' },
  { id: 2, version_id: 7, title: 'Theory', slug: 'theory', order: 1, info: '', info_html: '' },
];

describe('RunMiniProjectsTab', () => {
  it('empty state CTA with explainer + create hint when no MPs', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks, miniProjects: [],
      onRefetchMiniProjects: vi.fn().mockResolvedValue(undefined),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    expect(target.textContent).toContain('No mini-projects yet');
    expect(target.textContent).toContain('Click + New mini-project');
  });

  it('actionable banner when !runGroupsEnabled; link → onNavigateToTab("overview")', async () => {
    const onNav = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: true, runGroupsEnabled: false,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks, miniProjects: [],
      onRefetchMiniProjects: vi.fn(),
      onNavigateToTab: onNav,
    } });
    await settle();
    expect(target.textContent).toContain('Mini-projects require groups');
    const link = target.querySelector('a[data-action="nav-overview"]') as HTMLElement;
    link.click();
    expect(onNav).toHaveBeenCalledWith('overview');
  });

  it('actionable banner when versionIsDisabled; [+ New] disabled with tooltip (spec lines 546-548, 594)', async () => {
    // Codex catch: spec testing 594 + states table 546-548 require explicit
    // coverage that the versionIsDisabled banner renders AND that [+ New] is
    // disabled with the "version disabled" tooltip when versionIsDisabled=true.
    const onNav = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: true, pinnedAvailable: true,
      blocks, miniProjects: [],
      onRefetchMiniProjects: vi.fn(),
      onNavigateToTab: onNav,
    } });
    await settle();
    expect(target.textContent).toContain("This run's course version is disabled");
    const link = target.querySelector('a[data-action="nav-overview"]') as HTMLElement;
    link.click();
    expect(onNav).toHaveBeenCalledWith('overview');
    const newBtn = target.querySelector('button[data-action="new-mp"]') as HTMLButtonElement;
    expect(newBtn.disabled).toBe(true);
    expect(newBtn.getAttribute('title')).toContain("course version is disabled");
    // Codex re-review catch: lock the modal-only-publish contract (no
    // row-level Publish button — see the rowStatus comment block in the
    // RunMiniProjectsTab implementation for the rationale).
    expect(target.querySelector('button[data-action="publish"]')).toBeNull();
  });

  it('actionable banner when !runIsPublished; [+ New] and Edit remain enabled; NO row-level Publish button (spec lines 546-548, 595 — intentional divergence)', async () => {
    // Codex catch: spec line 595 — !runIsPublished surfaces a banner BUT
    // does NOT disable authoring (unlike versionIsDisabled or
    // !runGroupsEnabled). User can still draft mini-projects while the
    // run itself is unpublished.
    //
    // Codex re-review catch (spec lines 548/552/595): spec describes a
    // row-level `[Publish]` action that should be DISABLED when
    // !runIsPublished. Plan intentionally diverges: publishing happens
    // ONLY through the modal (T6b's `[Publish…]` button), not via a
    // row-level button. The publishCheckResult inside the modal already
    // gates on `runIsPublished` (pushes "Run must be published — Open
    // Overview to publish" when false), so the user experience is:
    //   1. Click Edit on a draft row → modal opens
    //   2. Click [Publish…] → precondition banner shows "Run must be
    //      published — Open Overview to publish"
    //   3. Confirm-publish is blocked; user navigates to Overview.
    // This single-publish-path keeps the row UI simple. The assertion
    // below LOCKS THIS DIVERGENCE by verifying there is no row-level
    // `data-action="publish"` button on the draft row.
    const onNav = vi.fn();
    // One draft MP so Edit button renders alongside [+ New].
    const draftMp: MiniProjectResponse = {
      id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0',
      assignment_md: 'x', assignment_html: '<p>x</p>',
      soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
      is_published: false, first_submitted_at: null,
      created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: false, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks, miniProjects: [draftMp],
      onRefetchMiniProjects: vi.fn(),
      onNavigateToTab: onNav,
    } });
    await settle();
    expect(target.textContent).toContain('Run is not yet published');
    const link = target.querySelector('a[data-action="nav-overview"]') as HTMLElement;
    link.click();
    expect(onNav).toHaveBeenCalledWith('overview');
    // Authoring still enabled despite the banner.
    const newBtn = target.querySelector('button[data-action="new-mp"]') as HTMLButtonElement;
    expect(newBtn.disabled).toBe(false);
    const editBtn = target.querySelector('button[data-action="edit"]') as HTMLButtonElement;
    expect(editBtn).toBeTruthy();
    expect(editBtn.disabled).toBe(false);
    // Codex re-review catch: lock the modal-only-publish contract by
    // asserting there is no row-level Publish button on the draft row.
    expect(target.querySelector('button[data-action="publish"]')).toBeNull();
  });

  it('pinnedAvailable=false: "Cannot load — pinned version not found"', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: false,
      blocks: [], miniProjects: [],
      onRefetchMiniProjects: vi.fn(),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    expect(target.textContent).toContain('Cannot load');
  });

  it('all-blocks-used → [+ New] disabled', async () => {
    // Round-5 reviewer-1 catch: full 11-field MiniProjectResponse shape (title + assignment_html).
    const mps: MiniProjectResponse[] = blocks.map((b, i) => ({
      id: i + 1, run_id: 10, block_id: b.id,
      title: `Mini project for Block ${b.order}`,
      assignment_md: 'x', assignment_html: '<p>x</p>',
      soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
      is_published: false, first_submitted_at: null,
      created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
    }));
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks, miniProjects: mps,
      onRefetchMiniProjects: vi.fn(),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    const btn = target.querySelector('button[data-action="new-mp"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('already have a mini-project');
  });

  it('MP rows sorted by block.order asc; status pill mapping', async () => {
    const mps: MiniProjectResponse[] = [
      // Round-4 reviewer-1 catch: full 11-field MiniProjectResponse shape (title + assignment_html).
      { id: 2, run_id: 10, block_id: 2, title: 'Mini project for Block 1', assignment_md: 'x', assignment_html: '<p>x</p>', soft_deadline: null, hard_deadline: null, resubmission_deadline: null, is_published: true, first_submitted_at: null, created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
      { id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0', assignment_md: 'x', assignment_html: '<p>x</p>', soft_deadline: null, hard_deadline: null, resubmission_deadline: null, is_published: false, first_submitted_at: '2026-05-22T00:00:00Z', created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
    ];
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks, miniProjects: mps,
      onRefetchMiniProjects: vi.fn(),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    const rows = Array.from(target.querySelectorAll('[data-role="mp-row"]'));
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Block 0');
    expect(rows[0].textContent).toContain('Locked');  // first_submitted_at set
    expect(rows[1].textContent).toContain('Block 1');
    expect(rows[1].textContent).toContain('Published');
    // Locked row: no [Edit]
    expect(rows[0].querySelector('button[data-action="edit"]')).toBeNull();
  });

  it('force-delete confirm: copy includes "permanently remove" + checkbox + danger button (no count)', async () => {
    // Round-4 reviewer-1 catch: full 11-field MiniProjectResponse shape.
    const mp: MiniProjectResponse = {
      id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0',
      assignment_md: 'x', assignment_html: '<p>x</p>',
      soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
      is_published: true, first_submitted_at: '2026-05-22T00:00:00Z',
      created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks, miniProjects: [mp],
      onRefetchMiniProjects: vi.fn().mockResolvedValue(undefined),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    (target.querySelector('button[data-action="delete"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Force delete will permanently remove');
    expect(target.querySelector('input[type="checkbox"]')).toBeTruthy();
    expect(target.textContent).not.toMatch(/\d+ submission/);
  });

  it('409 on non-locked delete: flips row into force-confirm view (spec line 524)', async () => {
    // Round-5 reviewers 1+2+3+5 ALL flagged round-4's TestHarness approach as broken
    // (`export let miniProjects = $state(...)` is invalid Svelte 5 runes syntax; the
    // "mirrors RunTeachersTab.svelte.test.ts" reference was fictional — that test
    // actually uses a `propsRef = $state({...})` + `mount(Comp, { props: propsRef })`
    // + mutate-propsRef pattern with NO separate .svelte harness file). Round-5
    // rewrite adopts the actual pattern (verified at
    // frontend/src/tests/RunTeachersTab.svelte.test.ts:75-145) for prop re-pass.
    const blocks: BlockResponse[] = [
      { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 0, info: '', info_html: '' },
    ];
    const mp: MiniProjectResponse = {
      id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0',
      assignment_md: 'x', assignment_html: '<p>x</p>',
      soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
      is_published: true, first_submitted_at: null,
      created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
    };
    const lockedMp = { ...mp, first_submitted_at: '2026-05-22T00:00:00Z' };

    fetchSpy.mockImplementation((url, init) => {
      if ((init as any)?.method === 'DELETE' && String(url).endsWith('/api/mini-projects/1')) {
        return jres(
          { detail: 'Mini-project has submissions; use ?force=true to delete.' },
          409,
        );
      }
      return jres([lockedMp]);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks,
      miniProjects: [mp],
      onRefetchMiniProjects: vi.fn().mockImplementation(async () => {
        // Mutate the $state propsRef so RunMiniProjectsTab sees the locked MP on
        // its next render. Svelte 5 passes the $state object BY REFERENCE; the
        // child re-evaluates `miniProjects` on each render and sees the mutation.
        propsRef.miniProjects = [lockedMp];
      }),
      onNavigateToTab: vi.fn(),
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunMiniProjectsTab, { target, props: propsRef });
    await settle();

    // Open the InlineConfirm (non-locked branch) — initial MP is draft.
    (target.querySelector('button[data-action="delete"]') as HTMLButtonElement).click();
    await settle();
    const confirmBtn = target.querySelector('button[data-action="confirm-delete"]') as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();

    // Confirm → DELETE → 409 → catch awaits propsRef.onRefetchMiniProjects()
    // → mutate propsRef.miniProjects → child re-renders with lockedMp
    // → rowStatus='locked' → `{#if locked}` branch wins → force-confirm view.
    confirmBtn.click();
    await settle();

    // Spec line 524 contract — observable outcomes:
    expect(propsRef.onRefetchMiniProjects).toHaveBeenCalledTimes(1);
    expect(target.textContent).toContain('Force delete will permanently remove');
    expect(target.querySelector('input[type="checkbox"]')).toBeTruthy();
    expect(target.querySelector('button.danger')).toBeTruthy();

    unmount(cmp);
  });

  it('force-delete fails (5xx): surfaces deleteError banner, keeps force-confirm view open, clears checkbox', async () => {
    // Round-6 reviewer-4 catch (Critical C5): prior handleForceDelete had only
    // `try { ... } finally { deleteConfirmId = null; }` — if the force-DELETE
    // rejected, the rejection escaped the inline-arrow onclick and was
    // swallowed. Production now routes errors to the shared deleteError banner
    // AND keeps the force-confirm view open (deleteConfirmId not nulled) so
    // the user can retry. Test asserts the banner copy and the surviving
    // force-confirm DOM.
    const blocks: BlockResponse[] = [
      { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 0, info: '', info_html: '' },
    ];
    const lockedMp: MiniProjectResponse = {
      id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0',
      assignment_md: 'x', assignment_html: '<p>x</p>',
      soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
      is_published: true, first_submitted_at: '2026-05-22T00:00:00Z',
      created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
    };
    fetchSpy.mockImplementation((url, init) => {
      if ((init as any)?.method === 'DELETE' && String(url).includes('force=true')) {
        return jres({ detail: 'Internal server error' }, 503);
      }
      return jres([lockedMp]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks, miniProjects: [lockedMp],
      onRefetchMiniProjects: vi.fn().mockResolvedValue(undefined),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    // Locked row → click × opens the force-confirm view directly.
    (target.querySelector('button[data-action="delete"]') as HTMLButtonElement).click();
    await settle();
    // Tick the checkbox; click Force delete.
    const checkbox = target.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    (target.querySelector('button.danger') as HTMLButtonElement).click();
    await settle();
    // Force-DELETE rejects with 503 → deleteError banner appears with the
    // server detail; force-confirm view STAYS open (deleteConfirmId not nulled)
    // so the user can retry; checkbox is cleared so they re-affirm intent.
    expect(target.textContent).toMatch(/Internal server error/);
    expect(target.querySelector('[data-role="delete-error-banner"]')).toBeTruthy();
    expect(target.textContent).toContain('Force delete will permanently remove');  // force-confirm still rendered
    expect((target.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    unmount(cmp);
  });

  it('409 on non-locked delete + refetch ALSO fails: surfaces deleteError banner, resets confirm state', async () => {
    // Round-5 reviewer-4 catch: prior version relied on `unhandledrejection` event
    // which jsdom + vitest do NOT reliably dispatch (the rejection hits Node's
    // process-level handler first, failing the test). Production now sets a
    // `deleteError = $state<string | null>(null)` banner in the inner catch
    // instead of rethrowing — see T7 implementation below. Test asserts the
    // banner text.
    const blocks: BlockResponse[] = [
      { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 0, info: '', info_html: '' },
    ];
    const mp: MiniProjectResponse = {
      id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0',
      assignment_md: 'x', assignment_html: '<p>x</p>',
      soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
      is_published: true, first_submitted_at: null,
      created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
    };
    fetchSpy.mockImplementation((url, init) => {
      if ((init as any)?.method === 'DELETE') {
        return jres({ detail: 'has submissions; use ?force=true' }, 409);
      }
      return jres([mp]);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks,
      miniProjects: [mp],
      onRefetchMiniProjects: vi.fn().mockRejectedValue(new Error('network down')),
      onNavigateToTab: vi.fn(),
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunMiniProjectsTab, { target, props: propsRef });
    await settle();
    (target.querySelector('button[data-action="delete"]') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('button[data-action="confirm-delete"]') as HTMLButtonElement).click();
    await settle();

    // Contract — observable outcomes:
    expect(propsRef.onRefetchMiniProjects).toHaveBeenCalledTimes(1);
    // InlineConfirm is gone (deleteConfirmId reset).
    expect(target.querySelector('button[data-action="confirm-delete"]')).toBeNull();
    // Delete-error banner visible with retry-affordance copy.
    expect(target.textContent).toMatch(/Could not refresh.*retry/i);
    expect(target.querySelector('[data-role="delete-error-banner"]')).toBeTruthy();

    unmount(cmp);
  });
});
```

- [ ] **Step 2: Tests fail with module-not-found**

```bash
cd frontend && npx vitest run src/tests/RunMiniProjectsTab.svelte.test.ts
```

- [ ] **Step 3: Implement `RunMiniProjectsTab.svelte`**

Follow spec §"RunMiniProjectsTab.svelte" lines 372-412. Key shape:

```svelte
<script lang="ts">
  import { ApiError } from '../../lib/api';   // round-3 reviewer-1 catch: needed for 409→force-reveal branch
  import { formatLocalWithTz } from '../../lib/datetime';
  import { deleteMiniProject } from '../../lib/miniProjects';
  import MiniProjectModal from './MiniProjectModal.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { MiniProjectResponse, BlockResponse } from '../../lib/types';

  let { runId, runIsPublished, runGroupsEnabled, runEndDate, versionIsDisabled, pinnedAvailable, blocks, miniProjects, onRefetchMiniProjects, onNavigateToTab }: {
    runId: number; runIsPublished: boolean; runGroupsEnabled: boolean;
    runEndDate: string | null; versionIsDisabled: boolean; pinnedAvailable: boolean;
    blocks: BlockResponse[]; miniProjects: MiniProjectResponse[];
    onRefetchMiniProjects: () => Promise<void>;
    onNavigateToTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster') => void;
  } = $props();

  const usedBlockIds = $derived(new Set(miniProjects.map(mp => mp.block_id)));
  const availableBlocks = $derived(blocks.filter(b => !usedBlockIds.has(b.id)));
  const sortedRows = $derived(
    miniProjects
      .map(mp => ({ mp, block: blocks.find(b => b.id === mp.block_id) }))
      .filter(r => r.block != null)
      .sort((a, b) => a.block!.order - b.block!.order)
  );

  function rowStatus(mp: MiniProjectResponse): 'draft' | 'published' | 'locked' {
    if (mp.first_submitted_at) return 'locked';
    if (mp.is_published) return 'published';
    return 'draft';
  }
  // Codex re-review catch — INTENTIONAL spec divergence (spec lines
  // 547-548, 552, 595): the spec table references a row-level [Publish]
  // action that should be disabled under versionIsDisabled / !runIsPublished
  // and hidden when is_published=true. The plan implements publishing as
  // MODAL-ONLY: the only Publish entry point is T6b's `[Publish…]` button
  // inside MiniProjectModal, which already gates on runIsPublished /
  // versionIsDisabled via publishCheckResult. Single-publish-path
  // keeps row UI to just [Edit] / [×] and avoids two separate gating
  // surfaces. T7 tests lock this contract by asserting `data-action="publish"`
  // is absent from the row DOM in the relevant state-coverage tests.

  let modalMode = $state<'create' | 'edit' | null>(null);
  let editTarget = $state<MiniProjectResponse | null>(null);
  let deleteConfirmId = $state<number | null>(null);
  let forceCheckbox = $state(false);
  // Round-5 reviewer-4 catch: when the 409 refetch path itself fails (network down),
  // the prior round-4 implementation rethrew into the InlineConfirm onclick which
  // discards the rejection — user saw NOTHING. Now surface a banner instead.
  //
  // Round-6 reviewer-4/5 catch: this banner is plan-only enrichment beyond the
  // spec's error-mapping table (spec lines 519-530 cover modal errors, not
  // tab-level delete errors). Banner has explicit lifecycle managed by the
  // handlers (reset at handler entry; cleared by Dismiss button), NOT coupled
  // to deleteConfirmId reactivity — see Fix C1 below.
  let deleteError = $state<string | null>(null);

  // Reviewer-5 catch: forceCheckbox is shared $state across rows. When the user
  // clicks delete on a DIFFERENT row, reset it so the new confirm starts unchecked.
  //
  // Round-6 reviewer-4/5 catch (Critical C1): DO NOT also reset deleteError here.
  // In the catch branches below we set `deleteError = '...'; deleteConfirmId = null;`
  // in the same tick. Svelte 5 schedules $effect runs microtask-after the sync
  // block — the effect would see deleteConfirmId transition and wipe deleteError
  // BEFORE the user ever sees the banner. The 'refetch-also-fails' test would
  // assert the banner text and fail. Instead, deleteError is reset explicitly at
  // handler entry (handleDeleteConfirm / handleForceDelete) and cleared by the
  // Dismiss button on the banner itself. forceCheckbox has the OPPOSITE semantics:
  // it SHOULD reset on any deleteConfirmId change (so a fresh row starts unchecked),
  // and no handler writes to it after a deleteConfirmId-null transition.
  $effect(() => { void deleteConfirmId; forceCheckbox = false; });

  const newDisabled = $derived(
    !runGroupsEnabled || versionIsDisabled || availableBlocks.length === 0
  );
  // Round-2 reviewer-3/5 catch: `$derived(() => {...})` STORES the function — the body
  // never re-evaluates on dep changes. Use `$derived.by(() => {...})` so the body runs
  // each time deps change, and bind `title={newDisabledTitle}` (not `newDisabledTitle()`).
  const newDisabledTitle = $derived.by(() => {
    if (!runGroupsEnabled) return 'Mini-projects require groups. Enable groups on Overview.';
    if (versionIsDisabled) return "This run's course version is disabled.";
    if (availableBlocks.length === 0) return 'All blocks in this course version already have a mini-project.';
    return '';
  });

  // Round-6 reviewer-4 catch (Critical C5): the prior version had only `try { ... }
  // finally { deleteConfirmId = null; forceCheckbox = false; }`. If
  // deleteMiniProject(force=true) rejected with 5xx OR onRefetchMiniProjects()
  // rejected after a successful force-delete, the rejection escaped the inline
  // arrow onclick and was swallowed (same hazard that round 5 fixed for
  // handleDeleteConfirm). Now wrap both awaits in try/catch and route to the
  // shared deleteError banner. Also reset deleteError at handler entry so a
  // stale banner from a prior failed attempt doesn't bleed into the new one.
  async function handleForceDelete(mpId: number) {
    if (!forceCheckbox) return;
    deleteError = null;
    try {
      await deleteMiniProject(mpId, { force: true });
      await onRefetchMiniProjects();
      deleteConfirmId = null;
      forceCheckbox = false;
    } catch (e) {
      deleteError = (e instanceof ApiError) ? e.displayMessage : (e instanceof Error ? e.message : 'Force delete failed');
      // Keep the force-confirm view open so the user can retry; clear the
      // checkbox so they have to re-affirm the destructive intent.
      forceCheckbox = false;
    }
  }

  // Round-5 reviewer-5 catch: extracted from inline InlineConfirm onConfirm closure
  // for testability + readability. Handles the 409→force-reveal race per spec line 524.
  //
  // Round-6 reviewer-4/5 catch: clear deleteError at entry so prior banner doesn't
  // bleed; do NOT rely on a $effect tied to deleteConfirmId (see banner declaration above).
  async function handleDeleteConfirm(mp: MiniProjectResponse) {
    deleteError = null;
    try {
      await deleteMiniProject(mp.id);
      await onRefetchMiniProjects();
      deleteConfirmId = null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Server-side state is now locked. Refetch so the row's rowStatus()
        // returns 'locked' on next render — the `{#if locked}` template branch
        // takes over and renders the force-confirm view. We KEEP deleteConfirmId
        // set so the new render lands on the locked branch (not the InlineConfirm).
        try {
          await onRefetchMiniProjects();
          forceCheckbox = false;
        } catch {
          // Refetch ALSO failed (network drop between 409 and the GET).
          // Surface a retry-affordance banner; reset confirm state so user can act.
          // Round-6 C1: order matters — set deleteError FIRST, then null
          // deleteConfirmId. With the deleteError-reset $effect removed, the
          // banner survives the deleteConfirmId transition.
          deleteError = 'Could not refresh. Please retry.';
          deleteConfirmId = null;
          forceCheckbox = false;
        }
      } else {
        // Some other error (5xx, 404, etc.). Surface a banner; reset confirm.
        deleteError = (e instanceof ApiError) ? e.displayMessage : (e instanceof Error ? e.message : 'Delete failed');
        deleteConfirmId = null;
      }
    }
  }
</script>

{#if !pinnedAvailable}
  <div class="error-banner">Cannot load — pinned version not found.</div>
{:else}
  <header>
    <h2>Mini-projects</h2>
    <!-- Codex catch: spec line 400 calls for disabled + title + aria-disabled.
         `disabled` is functional; `aria-disabled` makes the disabled state
         explicit for assistive tech that doesn't already infer it from the
         attribute. -->
    <button data-action="new-mp" disabled={newDisabled} aria-disabled={newDisabled} title={newDisabledTitle} onclick={() => { modalMode = 'create'; }}>
      + New mini-project
    </button>
  </header>

  {#if !runGroupsEnabled}
    <div class="banner">
      Mini-projects require groups. <a data-action="nav-overview" onclick={() => onNavigateToTab('overview')}>Enable on Overview</a>
    </div>
  {/if}
  {#if versionIsDisabled}
    <div class="banner">
      This run's course version is disabled. <a data-action="nav-overview" onclick={() => onNavigateToTab('overview')}>See Overview</a>
    </div>
  {/if}
  {#if !runIsPublished}
    <div class="banner">
      Run is not yet published. <a data-action="nav-overview" onclick={() => onNavigateToTab('overview')}>Publish on Overview</a>
    </div>
  {/if}
  {#if deleteError}
    <div class="banner banner-error" role="alert" data-role="delete-error-banner">
      {deleteError}
      <button data-action="dismiss-delete-error" onclick={() => { deleteError = null; }}>Dismiss</button>
    </div>
  {/if}

  {#if miniProjects.length === 0}
    <p>No mini-projects yet. A mini-project is a PDF assignment that each group submits and you grade. <strong>Click + New mini-project to assign one to a block.</strong></p>
  {:else}
    <ul>
      {#each sortedRows as { mp, block } (mp.id)}
        <li data-role="mp-row">
          <span>Block {block.order} — {block.title}</span>
          <span class="deadlines">
            {#if mp.soft_deadline}Soft: {formatLocalWithTz(mp.soft_deadline)}{/if}
            {#if mp.hard_deadline}Hard: {formatLocalWithTz(mp.hard_deadline)}{/if}
            {#if mp.resubmission_deadline}Resub: {formatLocalWithTz(mp.resubmission_deadline)}{/if}
          </span>
          <span class="pill pill-{rowStatus(mp)}">{rowStatus(mp) === 'draft' ? 'Draft' : rowStatus(mp) === 'published' ? 'Published' : 'Locked'}</span>
          {#if rowStatus(mp) !== 'locked'}
            <button data-action="edit" disabled={versionIsDisabled} onclick={() => { editTarget = mp; modalMode = 'edit'; }}>Edit</button>
          {/if}
          <button data-action="delete" onclick={() => { deleteConfirmId = mp.id; }}>×</button>
          {#if deleteConfirmId === mp.id && rowStatus(mp) === 'locked'}
            <div class="force-confirm">
              <p>Force delete will permanently remove all submissions and evaluations for this mini-project. This cannot be undone.</p>
              <label><input type="checkbox" bind:checked={forceCheckbox} /> I understand</label>
              <button onclick={() => { deleteConfirmId = null; forceCheckbox = false; }}>Cancel</button>
              <button class="danger" disabled={!forceCheckbox} onclick={() => handleForceDelete(mp.id)}>Force delete</button>
            </div>
          {:else if deleteConfirmId === mp.id}
            <InlineConfirm warning="Delete this mini-project?" confirmLabel="Delete"
              confirmDataAction="confirm-delete"
              onCancel={() => { deleteConfirmId = null; }}
              onConfirm={() => handleDeleteConfirm(mp)} />
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if modalMode != null}
    <MiniProjectModal
      {runId}
      mode={modalMode}
      initial={editTarget}
      availableBlocks={modalMode === 'create' ? availableBlocks : []}
      currentBlock={editTarget ? blocks.find(b => b.id === editTarget.block_id) ?? null : null}
      {runIsPublished} {runEndDate}
      onClose={() => { modalMode = null; editTarget = null; }}
      onSaved={onRefetchMiniProjects}
      {onNavigateToTab}
    />
  {/if}
{/if}
```

- [ ] **Step 4: Tests pass**

```bash
cd frontend && npx vitest run src/tests/RunMiniProjectsTab.svelte.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/runs/RunMiniProjectsTab.svelte frontend/src/tests/RunMiniProjectsTab.svelte.test.ts
git commit -m "feat(frontend): RunMiniProjectsTab — gating, banners, list, force-delete — T7

- Actionable banners for !runGroupsEnabled / versionIsDisabled / !runIsPublished
  with onNavigateToTab('overview') links
- Empty-state CTA + explainer + create hint
- pinnedAvailable=false renders 'Cannot load — pinned version not found'
- MP rows sorted by block.order asc; status pill (Draft/Published/Locked)
  is the primary state signal; row actions secondary
- [Edit] hidden on locked rows
- Force-delete confirm: 'permanently remove' copy + checkbox + danger
  button; no submission count
- [+ New] disabled when no groups / version disabled / all blocks used
  (with tooltip)"
```

- [ ] **Step 6: Per-task review loop** (reviewer + codex)

---

## Task 8: `RunDetailPage` integration

**Files:**
- Modify: `frontend/src/pages/runs/RunDetailPage.svelte`
- Modify (or extend): existing `frontend/src/tests/RunDetailPage.svelte.test.ts`

- [ ] **Step 1: Read `RunDetailPage.svelte` to map insertion points**

```bash
cat frontend/src/pages/runs/RunDetailPage.svelte | less
```

Identify:
- `ActiveTab` type → add `'mini-projects'`
- Tab button row → add 5th button
- `loadAll` → add post-versions sequenced step
- New $state: `blocks`, `miniProjects` ONLY. (Round-5 reviewer-2 catch: `modalMode`/`editTarget` live INSIDE RunMiniProjectsTab, not RunDetailPage. The earlier plan added them here too — dead writes. Remove them.)
- Verify the existing reset effect at `RunDetailPage.svelte:~100` already nulls `activeTab` to `'overview'` (or similar) — that's the path that unmounts RunMiniProjectsTab + its internal modal state on runId change.

- [ ] **Step 2: Write the failing integration test**

Round-5 reviewer-2 catch: prior test stubs had `// ... mount RunDetailPage` placeholders that violated TDD ordering (Step 3 would never see a real assertion failure). Inlined below.

Extend `frontend/src/tests/RunDetailPage.svelte.test.ts`:

```ts
// Reuse the existing RunDetailPage test scaffold (fetchSpy + jres + settle). The
// cascade of fetches is: GET /api/courses/by-slug/{slug} → Promise.all over
// /api/runs/{rid}, /api/courses/{cid}/versions, /api/runs/{rid}/teachers,
// /api/runs/{rid}/groups, /api/runs/{rid}/students → IF pinned in versions,
// Promise.all over /api/versions/{pinnedId}/blocks + /api/runs/{rid}/mini-projects.

function mockCascade(opts: {
  blocksReject?: boolean;
  mpsReject?: boolean;
  noPinned?: boolean;
}) {
  return (url: string, init?: RequestInit) => {
    const s = String(url);
    if (s.includes('/api/courses/by-slug/')) return jres({ id: 1, slug: 'c', name: 'C' });
    if (s.endsWith('/api/runs/10')) return jres({ id: 10, course_id: 1, version_id: opts.noPinned ? 999 : 7, title: 'R', start_date: '2026-01-01', end_date: '2026-12-31', is_published: true, groups_enabled: true });
    if (s.includes('/api/courses/1/versions')) return jres([{ id: 7, course_id: 1, info_md: '', is_published: true, is_disabled: false }]);
    if (s.includes('/api/runs/10/teachers')) return jres([]);
    if (s.includes('/api/runs/10/groups')) return jres([]);
    if (s.includes('/api/runs/10/students')) return jres([]);
    if (s.includes('/api/versions/7/blocks')) {
      if (opts.blocksReject) return jres({ detail: 'blocks 5xx' }, 503);
      return jres([{ id: 1, version_id: 7, title: 'B', slug: 'b', order: 0, info: '', info_html: '' }]);
    }
    if (s.includes('/api/runs/10/mini-projects')) {
      if (opts.mpsReject) return jres({ detail: 'mps 5xx' }, 503);
      return jres([]);
    }
    return jres([]);
  };
}

it('renders 5th "Mini-projects" tab; switching to it shows RunMiniProjectsTab', async () => {
  fetchSpy.mockImplementation(mockCascade({}));
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'c', runId: '10' } });
  await settle();
  await settle();   // second settle for the blocks/MPs inner Promise.all
  const mpTabBtn = Array.from(target.querySelectorAll('button')).find(b => b.textContent?.includes('Mini-projects')) as HTMLButtonElement;
  expect(mpTabBtn).toBeTruthy();
  mpTabBtn.click();
  await settle();
  // Empty-state CTA from RunMiniProjectsTab:
  expect(target.textContent).toContain('No mini-projects yet');
  unmount(cmp);
});

it('pinnedAvailable=false when versions list does not contain run.version_id', async () => {
  fetchSpy.mockImplementation(mockCascade({ noPinned: true }));
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'c', runId: '10' } });
  await settle();
  await settle();
  const mpTabBtn = Array.from(target.querySelectorAll('button')).find(b => b.textContent?.includes('Mini-projects')) as HTMLButtonElement;
  mpTabBtn.click();
  await settle();
  expect(target.textContent).toContain('Cannot load — pinned version not found');
  unmount(cmp);
});

it('listBlocks fails → whole page renders loadError (all-or-nothing load invariant)', async () => {
  // Round-5 reviewer-2 catch: test the partial-fail invariant the plan now documents.
  //
  // Round-6 reviewer-2/4/5 catch (Critical C3): production renders
  // `{loadError.displayMessage}` (RunDetailPage.svelte:~241). For
  // ApiError(503, 'blocks 5xx') the displayMessage getter returns the raw
  // detail string 'blocks 5xx' (api.ts:14-19). The prior regex
  // `/Failed to load|loadError/i` matches NEITHER token — test was permanently
  // red. Assert on the actual rendered detail AND on the structural
  // loadError container so the test stays meaningful if the copy ever changes.
  fetchSpy.mockImplementation(mockCascade({ blocksReject: true }));
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'c', runId: '10' } });
  await settle();
  await settle();
  expect(target.textContent).toMatch(/blocks 5xx/);
  // Tabs above mini-projects are NOT rendered when loadError is set; the
  // mini-projects tab button is absent from the DOM (consistent with current behavior).
  expect(Array.from(target.querySelectorAll('button')).find(b => b.textContent?.includes('Mini-projects'))).toBeUndefined();
  unmount(cmp);
});

it('listMiniProjects fails → whole page renders loadError', async () => {
  // Round-6 C3: same regex correction as blocks-5xx test above.
  fetchSpy.mockImplementation(mockCascade({ mpsReject: true }));
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'c', runId: '10' } });
  await settle();
  await settle();
  expect(target.textContent).toMatch(/mps 5xx/);
  expect(Array.from(target.querySelectorAll('button')).find(b => b.textContent?.includes('Mini-projects'))).toBeUndefined();
  unmount(cmp);
});
```

**Note on the reset-effect test removed in round 5** (reviewer-2 catch): the prior plan listed a "reset-effect closes modal on runId change" test, but modal state (`modalMode`, `editTarget`) actually lives **inside** RunMiniProjectsTab, not on RunDetailPage. Changing `runId` doesn't unmount the tab (tab is mounted by `{:else if activeTab === 'mini-projects'}` which stays true). The tab is the unmount boundary only when `activeTab` changes. So the reset-effect entries `showMiniProjectModal/modalMode/editTarget` on RunDetailPage are DEAD CODE — remove them. The actual unmount path is: user switches to a different tab → `{:else if}` flips → RunMiniProjectsTab unmounts → its $state (including modalMode/editTarget) is destroyed. No explicit reset needed.

- [ ] **Step 3: Implement RunDetailPage changes**

Add to `ActiveTab`:
```ts
type ActiveTab = 'overview' | 'teachers' | 'groups' | 'roster' | 'mini-projects';
```

**Round-2 reviewer-4 catch (revised approach):** `RunDetailPage.svelte:112-113` ALREADY exposes `const pinned = $derived(versions?.find((v) => v.id === run?.version_id))` and `const showDisabledBanner = $derived(pinned?.is_disabled === true)`. These are the canonical sources of truth for "is the run's pinned version disabled?" — the Overview tab uses `showDisabledBanner` at line 281, and `publishBlocked` (`:172`) wires off it too. Creating a parallel `versionIsDisabled = $state(false)` would split the source-of-truth and let it drift on `versions`/`run` reloads.

Resolution: REUSE the existing `pinned` $derived AND `showDisabledBanner` $derived. Add:

```ts
// $derived (NOT $state) — composes with the existing pinned $derived at :112
const pinnedAvailable = $derived(versions == null || pinned != null);

// $state only for async-loaded data; modal state lives INSIDE RunMiniProjectsTab.
let blocks = $state<BlockResponse[] | null>(null);
let miniProjects = $state<MiniProjectResponse[] | null>(null);
```

Pass `versionIsDisabled={showDisabledBanner}` to `<RunMiniProjectsTab>` (reusing the existing $derived alias — no new state variable needed).

Extend `loadAll` post-`versions` resolution. The CORRECT insertion site (round-3 reviewer-5 catch) is **inside the existing `try` block, AFTER the `Promise.all([getRun, listVersions, ...])` resolves and AFTER the token check at line 60, but BEFORE the bulk-assign at line 61** (where `course = c; run = r; versions = vs; ...` writes to $state). Read `RunDetailPage.svelte:46-67` to confirm exact line numbers — they may have drifted; the structural marker is "the line `course = c; run = r; versions = vs; teachers = ts; groups = gs; students = ss;`".

**Why this matters:** the existing code at line 53 destructures `[r, vs, ts, gs, ss]` from `Promise.all`. The new mini-projects fetch needs the *pinned version*, which is `vs.find(v => v.id === r.version_id)` — computed from the LOCAL destructured `r` and `vs`, NOT from the `$derived pinned` (`versions?.find(...) `). At this point in the function, the `versions` $state is still null/stale; reading the `$derived pinned` would always return `undefined` and block/MP loading would silently break.

```ts
// 1) Replace the entry-reset line (existing `course = null; run = null; versions = null; teachers = null; groups = null; students = null; loadError = null;`)
//    with the new variant that ALSO nulls blocks/miniProjects (round-3 reviewer-4 catch):
course = null; run = null; versions = null; teachers = null;
groups = null; students = null; blocks = null; miniProjects = null;
loadError = null;

// 2) After the token check at line 60 (`if (myToken !== loadToken) return;`), compute
//    the pinned version from the LOCAL destructured values, NOT the $derived.
//    Round-5 reviewer-1 catch: `rid` was used in the plan but the existing component
//    actually parameters loadAll as `loadAll(slug: string, rid: number)` (verified
//    RunDetailPage.svelte:46) — so `rid` IS in scope inside loadAll. The OUTER
//    refetchMiniProjects helper (below) needs to read `runIdInt` instead.
const pinnedVersion = vs.find(v => v.id === r.version_id) ?? null;

let blocksResult: BlockResponse[] = [];
let mpsResult: MiniProjectResponse[] = [];
if (pinnedVersion != null) {
  [blocksResult, mpsResult] = await Promise.all([
    listBlocks(pinnedVersion.id),
    listMiniProjects(rid),
  ]);
  if (myToken !== loadToken) return;   // token check AFTER the new Promise.all
}

// 3) Then the existing bulk-assign line, EXTENDED with the new state:
course = c; run = r; versions = vs; teachers = ts; groups = gs; students = ss;
blocks = blocksResult;
miniProjects = mpsResult;
```

**Key invariants:**
- `pinnedVersion` is computed from LOCAL variables (`r`, `vs`) — independent of when the $state writes happen.
- All assignments to $state (`course/run/versions/.../blocks/miniProjects`) happen in ONE block at the end, so the $derived `pinned` resolves correctly post-load.
- The token check is between the two awaits, matching the existing pattern (line 60 + new check after the inner Promise.all).
- Entry-reset nulls `blocks`/`miniProjects` alongside the other fields so a runId change clears stale data immediately (round-3 reviewer-4 defensive catch).
- **All-or-nothing load** (round-4 reviewer-4 catch): if EITHER `listBlocks` OR `listMiniProjects` rejects, `Promise.all` rejects → the existing outer try/catch sets `loadError` → the whole page renders the loadError view (NOT just the mini-projects tab). This matches the existing pattern at line 64-67. Tabs above mini-projects (overview/teachers/groups/roster) are also unavailable until the user retries. Acceptable per spec line 535 ("treat the whole-page reload as one operation").

**Reset-effect entries dropped in round 5** (reviewer-2 catch): the prior plan added `showMiniProjectModal = false; modalMode = null; editTarget = null;` to the RunDetailPage reset effect. But those names refer to state that lives **inside** `RunMiniProjectsTab`, not on RunDetailPage — they were dead writes to declared-but-unused parent state. The actual modal-close path on runId change is: existing reset writes `activeTab = 'overview'` (already present in the reset effect) → `{:else if activeTab === 'mini-projects'}` flips false → `RunMiniProjectsTab` unmounts → its $state (`modalMode`, `editTarget`) is destroyed by component lifecycle. No new reset-effect entries needed.

If `activeTab` is currently `'mini-projects'` and the runId changes but `activeTab` doesn't reset, the tab stays mounted and the modal also stays — but the underlying mini-projects data is reloaded by `loadAll`, so the tab re-renders with fresh data and the modal's `editTarget` would point at a now-stale MP. To avoid that, ensure `activeTab = 'overview'` IS in the reset effect (verify against the current `RunDetailPage.svelte` reset).

Add `refetchMiniProjects` helper. Round-5 reviewer-1 catch + reviewer-3 verification: read
`runIdInt` at the call site (the outer scope of the component) — `runIdInt` is a $derived
declared at module level for the route param. The `pinnedAvailable` double-gate uses the
fact that reading a $derived inside an async function is a one-shot snapshot (no
subscription is created when read outside a reactive context — verified by reviewer-3),
so the post-await re-check correctly snapshots the CURRENT $derived value.

Caveat (round-5 reviewer-1 + 5 catch): `pinnedAvailable = $derived(versions == null || pinned != null)`
evaluates TRUE during `loadAll`'s entry-reset (when `versions` was just nulled). The
double-gate does NOT catch the "runId change mid-flight" race — for that, the next
loadAll cycle will write fresh data over whatever this helper writes. Accept this as the
documented "within-runId re-pin not auto-detected" gap (see Accepted Gaps).

```ts
async function refetchMiniProjects() {
  if (runIdInt === null || !pinnedAvailable) return;
  const fetched = await listMiniProjects(runIdInt);
  // Best-effort drop if a re-pin invalidated pinnedAvailable mid-flight.
  if (!pinnedAvailable) return;
  miniProjects = fetched;
}
```

Add 5th tab button + body:
```svelte
<button class:active={activeTab === 'mini-projects'} onclick={() => activeTab = 'mini-projects'}>Mini-projects</button>
...
{:else if activeTab === 'mini-projects' && runIdInt !== null && run}
  <RunMiniProjectsTab
    runId={runIdInt}
    runIsPublished={run.is_published}
    runGroupsEnabled={run.groups_enabled}
    runEndDate={run.end_date}
    versionIsDisabled={showDisabledBanner}
    {pinnedAvailable}
    blocks={blocks ?? []}
    miniProjects={miniProjects ?? []}
    onRefetchMiniProjects={refetchMiniProjects}
    onNavigateToTab={(t) => { activeTab = t; }}
  />
{/if}
```

(Adjust `run.end_date`, `run.is_published`, `run.groups_enabled` field names to match the existing Run type — verify against `frontend/src/lib/types.ts`.)

- [ ] **Step 4: Tests pass**

```bash
cd frontend && npx vitest run
```

- [ ] **Step 5: Manual sanity check the dev server**

```bash
cd frontend && npm run dev
```

Open localhost, navigate to a run, click Mini-projects tab. Verify empty-state CTA renders, [+ New] opens modal, modal renders sidebar with run-asset URLs. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/runs/RunDetailPage.svelte frontend/src/tests/RunDetailPage.svelte.test.ts
git commit -m "feat(frontend): RunDetailPage integration — 5th tab, blocks+MPs load — T8

- ActiveTab gains 'mini-projects'
- 5th tab button + body wires RunMiniProjectsTab
- loadAll sequenced post-versions: pinned = versions.find(v.id ===
  run.version_id); when pinned is null set pinnedAvailable=false +
  empty arrays (defensive); otherwise Promise.all([listBlocks(pinned.id),
  listMiniProjects(rid)]) in parallel
- Modal state on runId change: NOT folded into RunDetailPage reset effect.
  Modal state (modalMode/editTarget) lives INSIDE RunMiniProjectsTab; the
  existing reset effect already writes activeTab='overview' which unmounts
  the tab via the {:else if} gate, destroying its $state by lifecycle. No
  new reset entries needed (round-5 reviewer-2 catch; intentional
  divergence from spec lines 485/537/539/564 which used 'just add
  showMiniProjectModal=false' wording).
- onNavigateToTab passed through to tab/modal for banner-link navigation"
```

- [ ] **Step 7: Per-task review loop** (reviewer + codex)

---

## Task 9: Manual smoke

This is the final task before merging. No code changes; just the 13-step manual walkthrough from the spec.

**Setup:**
- Backend dev server: `backend/.venv/bin/uvicorn mathion.main:app --reload --port 8000`
- Frontend dev server: `cd frontend && npm run dev`
- Test DB seeded with at least one course, one published run, one teacher account that's also a course-admin.

- [ ] **Step 1: Run all 13 smoke steps from spec lines 641-653 in order**

Spec §"Manual smoke" lines 641-653. Step-by-step (do them in your local browser):

1. Open Mini-projects tab on a run with groups enabled — empty-state CTA + explainer.
2. Click `[+ New]` — modal opens; block picker shows unused blocks; TZ label shows e.g. "(GMT+2)".
3. Fill assignment, upload run-asset via sidebar, insert ref at cursor, switch to Preview — URL resolves.
4. Mid-upload: click Cancel — upload aborts; reopen modal — sidebar reflects server state (incl. any orphan row from abort, which user manually trashes).
5. Try oversize / wrong-extension upload — inline rejection without network call.
6. Save — appears as Draft in list with TZ-labeled deadlines.
7. Click Publish on draft with missing deadlines — precondition bullets show with substituted values + aria links.
8. Set deadlines + run.is_published=true; Publish → confirm → Published.
9. Force-delete a locked MP (after seeding a submission via DB) — checkbox + force confirms; deletes.
10. Disable groups on Overview — banner appears on Mini-projects tab; click link → switches to Overview.
11. Edit modal, type some markdown, click X — footer flips to InlineConfirm "Discard unsaved changes?"; click Keep editing → footer reverts, modal stays; click X again → confirm reappears; click Discard → modal closes; reopen and verify the new text is gone.
12. While Save is in flight, try to type into the textarea / upload an asset — inputs are disabled, nothing happens.
13. 404 path (delete the MP via DB while modal is open, click Save) — banner shows Ctrl/Cmd+A/+C instructions; user selects text manually, copies, then closes (dirty-confirm fires; Discard).

For steps requiring DB manipulation (9 and 13), use `backend/.venv/bin/python -c "..."` or `sqlite3` directly against the dev DB.

- [ ] **Step 2: Document any deviations**

If any step doesn't behave as expected, file an issue with screenshots; fix in a follow-up commit before merging.

- [ ] **Step 3: Final commit (if any fixes)**

If smoke uncovers a defect, fix and commit:

```bash
git add <fixed files>
git commit -m "fix(frontend): <one-line> — caught in T9 smoke step <N>"
```

If smoke is clean, no commit needed; proceed to merge prep.

- [ ] **Step 4: Final per-task review (lightweight)** — reviewer pass over the full diff `git diff main` for any lurking issues. Codex round optional.

---

## Self-Review (run after writing the plan)

- [ ] Spec coverage scan — every spec section maps to a task:
  - Goal/non-goals: prefatory, no task needed.
  - Decisions already fixed: T6a/T6b/T7 honor them in code; T1 honors `require_run_admin_or_teacher`.
  - Backend Touchpoints (consumed): T3 + T4 cover the wrappers; the existing endpoints stay untouched.
  - Backend Touchpoints (new): T1.
  - New Frontend Modules (miniProjects, runAssets, assetContext, datetime, blocks, types): T2 + T3 + T4.
  - Extended Existing Components (MarkdownEditor, AssetSidebar): T5a.
  - Run-mode tests: T5b.
  - RunMiniProjectsTab: T7.
  - MiniProjectModal create/edit/closeForCurrentStage: T6a.
  - MiniProjectModal publish: T6b.
  - RunDetailPage changes: T8.
  - States & Edge Cases table: covered across T5a, T6a, T6b, T7.
  - Race / Staleness Handling: T5a covers loadToken ratchet; T6a covers mounted flag + abort-on-close; T8 covers reset-effect close.
  - Accepted gaps: documented in spec; no code needed. Round-3 reviewer-4 adds one new gap: **within-runId re-pin via Overview is not auto-detected by the mini-projects tab.** If an admin opens Overview, switches the run's pinned version, and switches back to Mini-projects without a page refresh, `pinned` re-derives but `loadAll` doesn't re-fire (the $effect at `RunDetailPage.svelte:94-98` depends on `courseSlug`/`runIdInt`, not `run.version_id`). Stale blocks/MPs would render until the next runId/courseSlug change. Mitigation today: tell admins to refresh after re-pinning. Phase 9: add a `$effect(() => { void run?.version_id; if (run) void loadAll(courseSlug, runIdInt); })` if the workflow becomes common.
  - Testing section: lib unit tests = T2/T3/T4; component tests = T6a/T6b/T7; MarkdownEditor/AssetSidebar regression = T5a/T5b; backend test = T1; manual smoke = T9.

- [ ] Placeholder scan: no "TBD" / "TODO" / "implement later" remain. Round-4 inlined the T5b drag/drop event-firing details into Step 1 so the test file is runnable as written before Step 2; round-3's residual `// ...` comments in T5b are removed.

- [ ] Type consistency: `AssetItem` is exported from `lib/assetContext.ts` and reused in `runAssets.test.ts` import. `RunAssetResponse` (lib/types.ts) is the wire shape; `AssetItem` is the adapter shape — both have the same fields. `MiniProjectResponse` shape mirrored across T3 tests, T6a tests, and T7 tests.

- [ ] Cross-task naming check: `uploadOne(file, batch?)` consistent across T5a (impl) and T5b (tests). `loadToken` plain `let` consistent across T5a impl and any tests that reset spies. `closeForCurrentStage` consistent T6a impl + tests.

---

## Execution Handoff

Plan complete and saved. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration. Matches the user's `feedback_review_loop_per_task.md` (reviewer + codex parallel after every task).

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
