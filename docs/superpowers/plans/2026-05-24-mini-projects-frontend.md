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
- Reference: `backend/mathion/api/helpers.py:421` (call `render_with_run_assets`)
- Reference: `backend/mathion/api/run_assets.py` (gating pattern `require_run_admin_or_teacher`)
- Modify or create: `backend/mathion/api/run_assets.py` (recommended — endpoint cohabits with the run-asset surface)
- Create: `backend/tests/test_run_render.py`

**Sub-step before coding:** Read `versions.py:120` end-to-end to understand the existing render endpoint's request body shape (`RenderRequest` Pydantic model), response shape (`{ html: str }`), 422-on-unknown-asset behavior. Mirror exactly; only the helper-function call changes.

- [ ] **Step 1: Write the failing backend test**

Create `backend/tests/test_run_render.py`:

```python
import pytest
from fastapi import status


def test_run_render_rewrites_asset_refs(client, course_admin_token, run, run_asset_factory):
    """POST /api/runs/{rid}/render returns HTML with mathion:asset://X rewritten to /api/runs/{rid}/assets/X."""
    asset = run_asset_factory(run_id=run.id, filename="diagram.png", mime_type="image/png")
    body = {"content_md": f"![diagram](mathion:asset://{asset.filename})"}
    r = client.post(
        f"/api/runs/{run.id}/render",
        json=body,
        headers={"Authorization": f"Bearer {course_admin_token}"},
    )
    assert r.status_code == status.HTTP_200_OK
    html = r.json()["html"]
    assert f"/api/runs/{run.id}/assets/{asset.filename}" in html
    assert "mathion:asset://" not in html


def test_run_render_gated_by_run_admin_or_teacher(client, run, outsider_token):
    """Gating: outsider → 403; course-admin OK; run-teacher OK (covered by happy path)."""
    r = client.post(
        f"/api/runs/{run.id}/render",
        json={"content_md": "hi"},
        headers={"Authorization": f"Bearer {outsider_token}"},
    )
    assert r.status_code == status.HTTP_403_FORBIDDEN


def test_run_render_422_on_missing_asset(client, course_admin_token, run):
    """422 lists the missing filenames in the detail message."""
    body = {"content_md": "![x](mathion:asset://missing.png)"}
    r = client.post(
        f"/api/runs/{run.id}/render",
        json=body,
        headers={"Authorization": f"Bearer {course_admin_token}"},
    )
    assert r.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "missing.png" in r.json()["detail"]


def test_run_render_no_reference_rows_created(client, course_admin_token, run, run_asset_factory, db_session):
    """Side-effect-free: rendering does NOT create RunAssetReference rows."""
    from mathion.models import RunAssetReference
    asset = run_asset_factory(run_id=run.id, filename="d.png", mime_type="image/png")
    before = db_session.query(RunAssetReference).filter_by(run_asset_id=asset.id).count()
    client.post(
        f"/api/runs/{run.id}/render",
        json={"content_md": f"![](mathion:asset://{asset.filename})"},
        headers={"Authorization": f"Bearer {course_admin_token}"},
    )
    after = db_session.query(RunAssetReference).filter_by(run_asset_id=asset.id).count()
    assert before == after
```

(Adjust fixture names — `course_admin_token`, `outsider_token`, `run_asset_factory` — to match existing `backend/tests/conftest.py`. Read conftest first; if fixture names differ, use the existing ones.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
backend/.venv/bin/pytest backend/tests/test_run_render.py -v
```

Expected: 4 failures (endpoint doesn't exist yet → 404 on all calls).

- [ ] **Step 3: Implement the endpoint**

Open `backend/mathion/api/run_assets.py`. Locate the existing endpoint definitions and the `require_run_admin_or_teacher` import. After the last existing endpoint, add:

```python
from .helpers import render_with_run_assets  # add to existing import block at top if not present

class RenderRequest(BaseModel):
    content_md: str

class RenderResponse(BaseModel):
    html: str

@router.post("/{rid}/render", response_model=RenderResponse)
def render_run_markdown(
    rid: int,
    body: RenderRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_run_admin_or_teacher),
) -> RenderResponse:
    """Render markdown with mathion:asset:// refs resolved against this run's asset pool.

    Side-effect-free: SELECTs only; no RunAssetReference rows are written here.
    422 if any referenced asset is not found in the run pool.
    """
    html = render_with_run_assets(db, rid, body.content_md)
    return RenderResponse(html=html)
```

Mirror `versions.py:120` for `RenderRequest`/`RenderResponse` shapes. If `render_with_run_assets` raises a domain error for missing assets, ensure the handler converts to `HTTPException(422, detail="Referenced run-assets not found: ...")` — check helper signature first; if it returns a tuple `(html, missing: list[str])`, raise the 422 explicitly here.

- [ ] **Step 4: Run tests to verify they pass**

```bash
backend/.venv/bin/pytest backend/tests/test_run_render.py -v
```

Expected: 4 passed.

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

### T2.A — TZ pin in vitest.setup.ts

- [ ] **Step 1: Check whether `frontend/vitest.setup.ts` exists**

```bash
cat frontend/vitest.setup.ts 2>/dev/null || echo "MISSING"
```

If it exists, extend it. If `MISSING`, create it. Either way, ensure this block runs ONCE at setup:

```ts
// Pin TZ for deterministic datetime tests (see lib/datetime.ts).
// Must be set BEFORE any Date is constructed by other test setup.
process.env.TZ = 'Europe/Copenhagen';
```

If `frontend/vitest.config.ts` doesn't already reference the setup file via `test.setupFiles`, add it. Read the config first to determine.

### T2.B — `lib/types.ts` additions

- [ ] **Step 2: Add the new type exports**

Read `frontend/src/lib/types.ts` to confirm the existing pattern (Pydantic-mirror style). Then add:

```ts
export type BlockResponse = {
  id: number;
  version_id: number;
  order: number;
  title: string;
  // (mirror remaining BlockResponse fields from backend/mathion/schemas.py — verify against schemas.py before finalizing)
};

export type MiniProjectResponse = {
  id: number;
  run_id: number;
  block_id: number;
  assignment_md: string;
  soft_deadline: string | null;       // ISO 8601 UTC ending in "Z"
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
  mime_type: string;
  file_size: number;
  is_referenced: boolean;
  created_at: string;
};

export type MiniProjectRowStatus = 'draft' | 'published' | 'locked';
```

**Before adding:** open `backend/mathion/schemas.py` and pattern-match the exact field names + nullability. Copy verbatim. Don't invent fields.

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
    const blocks: BlockResponse[] = [
      { id: 1, version_id: 7, order: 0, title: 'Intro' },
      { id: 2, version_id: 7, order: 1, title: 'Theory' },
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

  it('list() GETs /api/assets/{vid}', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    await ctx.list();
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/assets/7'), expect.any(Object));
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

  it('upload threads AbortSignal to fetch', async () => {
    fetchSpy.mockImplementation((_url, init) => {
      expect(init?.signal).toBeDefined();
      return jres({ id: 1, filename: 'x.png', mime_type: 'image/png', file_size: 1, is_referenced: false });
    });
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const controller = new AbortController();
    await ctx.upload(file, controller.signal);
    expect(fetchSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 12: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/tests/assetContext.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 13: Implement `lib/assetContext.ts`**

```ts
// frontend/src/lib/assetContext.ts
import { api } from './api';
// Course-asset functions live in lib/assets.ts (existing).
import { listAssets, uploadAsset, deleteAsset } from './assets';

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
      // Use the existing fetch wrapper that supports FormData + signal — see how
      // assets.ts:uploadAsset does it and mirror. If api.post doesn't accept FormData,
      // call fetch directly here (FormData implies multipart Content-Type set by browser).
      const r = await fetch(`/api/runs/${runId}/assets`, { method: 'POST', body: fd, signal, credentials: 'same-origin' });
      if (!r.ok) {
        const detail = await r.json().catch(() => ({ detail: 'Upload failed' }));
        throw Object.assign(new Error(detail.detail ?? 'Upload failed'), { status: r.status, detail: detail.detail });
      }
      return r.json();
    },
    remove: (id) => api.delete(`/api/runs/${runId}/assets/${id}`),
    imgSrc: (item) => `/api/runs/${runId}/assets/${item.filename}`,
    renderPreview: (content_md) => api.post<{ html: string }>(`/api/runs/${runId}/render`, { content_md }),
  };
}
```

**Sub-step:** before implementing `runAssetContext.upload`, read `frontend/src/lib/assets.ts:uploadAsset` to see how the existing course-side upload threads `FormData + AbortSignal`. Mirror exactly to avoid divergent fetch error-handling.

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
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch(`/api/runs/${runId}/assets`, {
    method: 'POST',
    body: fd,
    signal,
    credentials: 'same-origin',
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({ detail: 'Upload failed' }));
    throw Object.assign(new Error(detail.detail ?? 'Upload failed'), { status: r.status, detail: detail.detail });
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
- Modify: `frontend/src/pages/editor/ItemEditPage.svelte`
- Modify (if needed): existing tests under `frontend/src/tests/` that mount MarkdownEditor/AssetSidebar with `versionId={...}` prop — migrate to `assetContext={courseAssetContext(...)}`.

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
}: {
  assetContext: AssetContext;
  value?: string;
  readOnly?: boolean;
  disabled?: boolean;
  refreshKey?: number;
  uploadAbortController?: AbortController | null;
} = $props();
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
  bind:refreshKey
  onInsert={(snippet) => insertAtCursor(snippet)}
  onUploadFile={uploadOne}
  bind:uploading
  bind:uploadProgress
  bind:uploadError
/>
```

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

```ts
import { runAssetContext } from '../lib/assetContext';

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
    // simulate a drop — the abortableUpload resolves to null so sidebar stops iterating
    // (test that the loop breaks on null without throwing)
    // ... fire a drop event with one file; assert abortableUpload called once and sidebar continues
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
    // construct a drop with 1 valid + 1 bad-extension file
    // ... fire drop event with mixed files
    expect(onUploadFile).not.toHaveBeenCalled();
    expect(uploadError?.detail).toContain('extension not allowed');
  });

  it('multi-file sidebar drop: 3 valid files → onUploadFile called 3 times with batch counters, fetchAssets refetches 3 times after initial mount', async () => {
    // Reset fetchSpy after initial-mount fetch.
    fetchSpy.mockImplementation(() => jres([]));
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
    // construct 3 valid files; fire drop
    // assert onUploadFile called 3 times with batch={current:1,total:3}, {2,3}, {3,3}
    // assert fetchSpy (list endpoint) called 3 times
    // assert all 3 filenames present in rendered list (set-membership, not tail position)
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
    // trigger preview button click
    // assert POST to /api/runs/42/render
  });

  it('textarea-drop hits /api/runs/{rid}/assets (not /api/assets/...)', async () => {
    // mock fetch for both /api/runs/42/assets POST + /api/runs/42/assets GET (refetch)
    // simulate drop on textarea
    // assert POST URL contains /api/runs/42/assets
  });

  it('disabled prop blocks all interactive handlers', async () => {
    // mount with disabled=true; verify textarea has disabled attribute,
    // preview button disabled, drop handlers no-op
  });
});
```

Fill in the `// ...` event-firing TODOs by mirroring existing test patterns (e.g., `RunTeachersTab.svelte.test.ts` for the form-submit pattern, but here you need DragEvent + DataTransfer construction — borrow from existing AssetSidebar tests if they cover drop).

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/tests/AssetSidebar src/tests/MarkdownEditor
```

Expected: new test cases FAIL until each event-firing TODO is fleshed out.

- [ ] **Step 3: Implement the event-firing details**

Borrow `Blob`/`File`/`DragEvent` construction from existing tests. For the drop event:

```ts
function makeDropEvent(files: File[]): DragEvent {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  return new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
}
```

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
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import MiniProjectModal from '../components/runs/MiniProjectModal.svelte';
import type { MiniProjectResponse, BlockResponse } from '../lib/types';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
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

const blocks: BlockResponse[] = [{ id: 1, version_id: 7, order: 0, title: 'Intro' }];

describe('MiniProjectModal — create mode', () => {
  it('renders block picker for create; POST body shape correct on Save', async () => {
    fetchSpy.mockImplementation((url) => {
      if (String(url).includes('/api/runs/10/mini-projects') && (arguments[1] as any)?.method === 'POST') {
        return jres({ id: 99 } as MiniProjectResponse);
      }
      return jres([]);  // list endpoint
    });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(MiniProjectModal, { target, props: {
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
    // fill assignment_md
    const textarea = target.querySelector('textarea[name="assignment_md"]') as HTMLTextAreaElement;
    textarea.value = 'My assignment';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    // click Save
    const saveBtn = target.querySelector('button[data-action="save"]') as HTMLButtonElement;
    saveBtn.click();
    await settle();
    const postCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/runs/10/mini-projects') && c[1]?.method === 'POST');
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as any).body);
    expect(body.block_id).toBe(1);
    expect(body.assignment_md).toBe('My assignment');
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('MiniProjectModal — edit mode + dirty close', () => {
  const initial: MiniProjectResponse = {
    id: 99, run_id: 10, block_id: 1, assignment_md: 'orig text',
    soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
    is_published: false, first_submitted_at: null,
    created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
  };

  it('prefills assignment_md and disables block picker for edit', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(MiniProjectModal, { target, props: {
      runId: 10, mode: 'edit', initial, availableBlocks: [],
      currentBlock: blocks[0], runIsPublished: true, runEndDate: '2026-06-30',
      onClose: vi.fn(), onSaved: vi.fn(),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    const ta = target.querySelector('textarea[name="assignment_md"]') as HTMLTextAreaElement;
    expect(ta.value).toBe('orig text');
  });

  it('clean close: backdrop click → onClose called', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(MiniProjectModal, { target, props: {
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

  it('dirty close: typing then X flips footer to InlineConfirm; Keep editing reverts; Discard closes', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(MiniProjectModal, { target, props: {
      runId: 10, mode: 'edit', initial, availableBlocks: [],
      currentBlock: blocks[0], runIsPublished: true, runEndDate: '2026-06-30',
      onClose, onSaved: vi.fn(),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    const ta = target.querySelector('textarea[name="assignment_md"]') as HTMLTextAreaElement;
    ta.value = 'modified';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    // click X
    (target.querySelector('button[data-action="close-x"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Discard unsaved changes?');
    expect(onClose).not.toHaveBeenCalled();
    // Keep editing
    (target.querySelector('button[data-action="cancel-inline"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).not.toContain('Discard unsaved changes?');
    // X again → InlineConfirm again → Discard
    (target.querySelector('button[data-action="close-x"]') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('button[data-action="confirm-inline"]') as HTMLButtonElement).click();
    await settle();
    expect(onClose).toHaveBeenCalled();
  });

  it('mounted-flag rule: close during in-flight save → post-await write does not fire', async () => {
    // Make POST hang; close mid-flight; resolve POST; assert no $state write on the
    // unmounted modal (use a sentinel — e.g., onSaved is NOT called).
    let resolvePost!: (v: unknown) => void;
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/mini-projects/99') && init?.method === 'PATCH') {
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
    unmount(cmp);  // simulate parent destroying modal mid-flight
    resolvePost({ ok: true, status: 200, json: () => Promise.resolve(initial) } as Response);
    await settle();
    expect(onSaved).not.toHaveBeenCalled();
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
  let initialFormSnapshot: ReturnType<typeof currentFormSnapshot>;
  onMount(() => {
    initialFormSnapshot = currentFormSnapshot();
    mounted = true;
  });
  onDestroy(() => { mounted = false; });

  let pendingClose = $state(false);
  const dirty = $derived(
    initialFormSnapshot == null
      ? false
      : JSON.stringify(currentFormSnapshot()) !== JSON.stringify(initialFormSnapshot)
  );

  function closeForCurrentStage() {
    if (submitting) return;
    if (dirty && !pendingClose) {
      pendingClose = true;
      return;
    }
    uploadAbortController?.abort();
    onClose();
  }

  // Validation (spec lines 491-502, Publish-specific in T6b)
  const saveError = $derived.by((): string | null => {
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

  async function handleSave() {
    if (saveError) return;
    submitting = true;
    serverError = null;
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
      if (e.status === 404) {
        serverError = 'This mini-project has been deleted. Select-all (Ctrl/Cmd+A) and copy (Ctrl/Cmd+C) from the assignment textarea if you want to preserve your work before closing.';
      } else if (e.status === 409) {
        serverError = `${e.detail ?? 'Conflict.'} Refresh the page to see latest.`;
      } else {
        serverError = e.detail ?? e.message ?? 'Save failed';
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
    <!-- block picker (create) or read-only label (edit) -->
    {#if mode === 'create'}
      <label>
        Block
        <select bind:value={formData.block_id} disabled={submitting}>
          {#each availableBlocks as b (b.id)}
            <option value={b.id}>Block {b.order} — {b.title}</option>
          {/each}
        </select>
      </label>
    {/if}
    <!-- deadlines: 3 datetime-local inputs with localTzLabel() in label -->
    <label>Soft deadline {localTzLabel()} <input type="datetime-local" bind:value={formData.soft_local} disabled={submitting} /></label>
    <label>Hard deadline {localTzLabel()} <input type="datetime-local" bind:value={formData.hard_local} disabled={submitting} /></label>
    <label>Resubmission deadline {localTzLabel()} <input type="datetime-local" bind:value={formData.resub_local} disabled={submitting} /></label>
    <!-- markdown editor + run assets sidebar -->
    <MarkdownEditor
      {assetContext}
      bind:value={formData.assignment_md}
      disabled={submitting}
      bind:uploadAbortController
    />
    {#if serverError}
      <div class="banner banner-error" role="alert">{serverError}</div>
    {/if}
  </div>
  <footer>
    {#if pendingClose}
      <InlineConfirm
        warning="Discard unsaved changes?"
        confirmLabel="Discard"
        onCancel={() => { pendingClose = false; }}
        onConfirm={() => { pendingClose = false; closeForCurrentStage(); }}
        data-action-confirm="confirm-inline"
        data-action-cancel="cancel-inline"
      />
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
  .modal { max-width: 1100px; max-height: 90vh; overflow: auto; }
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

Create `frontend/src/tests/MiniProjectModal.publish.svelte.test.ts`. Cover:

- `[Publish…]` button rendered only in edit mode AND `!initial.is_published`
- Publish click → InlineConfirm with copy "Once published, this cannot be undone..."
- Publish confirm → POST /api/mini-projects/{id}/publish → onSaved + close
- Missing-deadline precondition: inline banner shows "Hard deadline must be set" with `aria-describedby`
- Missing-resub-deadline precondition: bullet shows
- `runIsPublished === false`: bullet shows "Run must be published — Open Overview to publish" + clicking link calls `onNavigateToTab('overview')`
- `runEndDate === null`: bullet shows "Run end date must be set — Open Overview to set it"
- `hard_iso > runEndDate + 'T23:59:59Z'`: bullet shows with substituted runEndDate
- `resub_iso > runEndDate + 'T23:59:59Z'`: bullet shows
- 409 on publish: inline banner with `e.displayMessage`
- Save and Publish share `submitting`: clicking Publish disables Save and vice versa; button text changes to "Publishing…"

Use the same test scaffold from T6a (mount, settle, fetch spy).

- [ ] **Step 2: Implement the publish flow**

Read spec lines 484, 491-510, 519-531 verbatim. Add:

```ts
import { publishMiniProject } from '../../lib/miniProjects';

const publishCheckResult = $derived.by(() => {
  if (mode !== 'edit' || initial?.is_published) return null;
  const unmet: string[] = [];
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
    serverError = e.detail ?? e.message ?? 'Publish failed';
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
  { id: 1, version_id: 7, order: 0, title: 'Intro' },
  { id: 2, version_id: 7, order: 1, title: 'Theory' },
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
    const mps: MiniProjectResponse[] = blocks.map((b, i) => ({
      id: i + 1, run_id: 10, block_id: b.id, assignment_md: 'x',
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
      { id: 2, run_id: 10, block_id: 2, assignment_md: 'x', soft_deadline: null, hard_deadline: null, resubmission_deadline: null, is_published: true, first_submitted_at: null, created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
      { id: 1, run_id: 10, block_id: 1, assignment_md: 'x', soft_deadline: null, hard_deadline: null, resubmission_deadline: null, is_published: false, first_submitted_at: '2026-05-22T00:00:00Z', created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
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
    const mp: MiniProjectResponse = {
      id: 1, run_id: 10, block_id: 1, assignment_md: 'x',
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

  let modalMode = $state<'create' | 'edit' | null>(null);
  let editTarget = $state<MiniProjectResponse | null>(null);
  let deleteConfirmId = $state<number | null>(null);
  let forceCheckbox = $state(false);

  const newDisabled = $derived(
    !runGroupsEnabled || versionIsDisabled || availableBlocks.length === 0
  );
  const newDisabledTitle = $derived(() => {
    if (!runGroupsEnabled) return 'Mini-projects require groups. Enable groups on Overview.';
    if (versionIsDisabled) return "This run's course version is disabled.";
    if (availableBlocks.length === 0) return 'All blocks in this course version already have a mini-project.';
    return '';
  });

  async function handleForceDelete(mpId: number) {
    if (!forceCheckbox) return;
    try {
      await deleteMiniProject(mpId, { force: true });
      await onRefetchMiniProjects();
    } finally {
      deleteConfirmId = null;
      forceCheckbox = false;
    }
  }
</script>

{#if !pinnedAvailable}
  <div class="error-banner">Cannot load — pinned version not found.</div>
{:else}
  <header>
    <h2>Mini-projects</h2>
    <button data-action="new-mp" disabled={newDisabled} title={newDisabledTitle()} onclick={() => { modalMode = 'create'; }}>
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
              onCancel={() => { deleteConfirmId = null; }}
              onConfirm={async () => { await deleteMiniProject(mp.id); await onRefetchMiniProjects(); deleteConfirmId = null; }} />
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
- Reset effect → add `showMiniProjectModal = false` reset
- New $state: `blocks`, `miniProjects`, `showMiniProjectModal`, `modalMode`, `editTarget`

- [ ] **Step 2: Write the failing integration test**

Extend `frontend/src/tests/RunDetailPage.svelte.test.ts`:

```ts
it('renders 5th "Mini-projects" tab; switching to it shows RunMiniProjectsTab', async () => {
  // Mock fetch responses for: course-by-slug, run, teachers, groups, roster, versions,
  // blocks (versions[0].id → /api/versions/{vid}/blocks), mini-projects.
  // ... mount RunDetailPage; click "Mini-projects" tab; assert tab body contains
  // either empty-state CTA or MP rows depending on the mock fixture.
});

it('pinnedAvailable=false when versions list does not contain run.version_id', async () => {
  // mock versions response missing run.version_id
  // ... assert tab body shows "Cannot load — pinned version not found"
});

it('reset-effect closes modal on runId change', async () => {
  // mount with run id 10; open mini-project modal; change runId prop to 11;
  // assert modal is no longer in the DOM
});
```

- [ ] **Step 3: Implement RunDetailPage changes**

Add to `ActiveTab`:
```ts
type ActiveTab = 'overview' | 'teachers' | 'groups' | 'roster' | 'mini-projects';
```

Add new $state:
```ts
let blocks = $state<BlockResponse[] | null>(null);
let miniProjects = $state<MiniProjectResponse[] | null>(null);
let pinnedAvailable = $state(true);
```

Extend `loadAll` post-`versions` resolution (around `RunDetailPage.svelte:211-232` per existing loadToken pattern):

```ts
// after versions resolves and loadToken check passes:
const pinned = versions.find(v => v.id === run.version_id);
if (pinned == null) {
  pinnedAvailable = false;
  blocks = [];
  miniProjects = [];
} else {
  pinnedAvailable = true;
  const [blocksResult, mpsResult] = await Promise.all([
    listBlocks(pinned.id),
    listMiniProjects(rid),
  ]);
  if (myToken !== loadToken) return;
  blocks = blocksResult;
  miniProjects = mpsResult;
}
```

Add to the existing reset effect (around line ~100 per spec):
```ts
showMiniProjectModal = false;  // add alongside existing activeTab/rosterPrefilter/showImportModal resets
modalMode = null;
editTarget = null;
```

Add `refetchMiniProjects` helper:
```ts
async function refetchMiniProjects() {
  if (!pinnedAvailable) return;
  miniProjects = await listMiniProjects(rid);
}
```

Add 5th tab button + body:
```svelte
<button class:active={activeTab === 'mini-projects'} onclick={() => activeTab = 'mini-projects'}>Mini-projects</button>
...
{:else if activeTab === 'mini-projects'}
  <RunMiniProjectsTab
    runId={rid}
    runIsPublished={run.is_published}
    runGroupsEnabled={run.groups_enabled}
    runEndDate={run.end_date}
    versionIsDisabled={pinned?.is_disabled ?? false}
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
- reset-effect closes mini-project modal on runId change (folds into
  existing reset alongside activeTab/rosterPrefilter/showImportModal)
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
  - Accepted gaps: documented in spec; no code needed.
  - Testing section: lib unit tests = T2/T3/T4; component tests = T6a/T6b/T7; MarkdownEditor/AssetSidebar regression = T5a/T5b; backend test = T1; manual smoke = T9.

- [ ] Placeholder scan: no "TBD" / "TODO" / "implement later" remain (a few `// ...` event-firing details in T5b test stubs intentionally point to the implementer to fill, but the surrounding code shows exactly what the assertion should be).

- [ ] Type consistency: `AssetItem` is exported from `lib/assetContext.ts` and reused in `runAssets.test.ts` import. `RunAssetResponse` (lib/types.ts) is the wire shape; `AssetItem` is the adapter shape — both have the same fields. `MiniProjectResponse` shape mirrored across T3 tests, T6a tests, and T7 tests.

- [ ] Cross-task naming check: `uploadOne(file, batch?)` consistent across T5a (impl) and T5b (tests). `loadToken` plain `let` consistent across T5a impl and any tests that reset spies. `closeForCurrentStage` consistent T6a impl + tests.

---

## Execution Handoff

Plan complete and saved. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration. Matches the user's `feedback_review_loop_per_task.md` (reviewer + codex parallel after every task).

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
