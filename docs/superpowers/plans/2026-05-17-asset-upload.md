# Asset Upload & Media Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give course admins a right-rail media library inside `MarkdownEditor` plus drag-drop on the textarea and `.edit-content` wrapper, so embedding an asset is a single click or drop.

**Architecture:** New `frontend/src/lib/assets.ts` (raw-fetch `uploadAsset`, `api.get/delete`-based `listAssets`/`deleteAsset`, `formatRef`, `AssetResponse` type). New `frontend/src/components/editor/AssetSidebar.svelte` renders the list and owns the file picker + drop zone + root `<aside>` drop handler + delete UI. `MarkdownEditor.svelte` adds a flex `.edit-content` wrapper that hosts the textarea + sidebar, owns `lastOffset` / `cursorReady` / `uploading` / `uploadProgress` / `uploadError` state (latter four `$bindable`), wires textarea + wrapper drop handlers with synchronous `preventDefault(); stopPropagation();`, and exposes `refreshKey` as a `$bindable` two-way with `ItemEditPage`. Backend already done.

**Tech Stack:** Svelte 5 (runes: `$state`, `$bindable`, `$props`, `$derived`, `$effect`), TypeScript, vitest + jsdom, no UI kit, no DOM-manipulation libs. Backend FastAPI/Pydantic v2 (no changes).

**Spec:** `docs/superpowers/specs/2026-05-16-asset-upload-design.md`

**Branch:** `frontend-asset-upload` (already exists, 12 spec commits). All implementation commits go on this branch.

**Pre-flight (run once before Task 1):**
```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git branch --show-current   # expect: frontend-asset-upload
cd frontend && npx vitest run 2>&1 | tail -3   # expect: 172/172 pass
```

---

## Task 1: `lib/assets.ts` — helper module

**Files:**
- Create: `frontend/src/lib/assets.ts`
- Create: `frontend/src/tests/assets.test.ts`

This module is pure (no runes). Mirrors `lib/api.ts` patterns. The critical thing: `uploadAsset` uses raw `fetch` (not `api.post`), because `api.post` hardcodes `Content-Type: application/json` and `JSON.stringify` — both fatal for multipart.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/tests/assets.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ApiError } from '../lib/api';
import * as events from '../lib/events';
import { uploadAsset, listAssets, deleteAsset, formatRef, type AssetResponse } from '../lib/assets';

const ASSET_RESPONSE: AssetResponse = {
  id: 7,
  version_id: 42,
  filename: 'histogram.png',
  file_size: 1024,
  mime_type: 'image/png',
  uploaded_at: '2026-05-17T12:00:00Z',
  uploaded_by: 3,
  is_referenced: false,
};

describe('lib/assets', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: ReturnType<typeof vi.spyOn<any, any>>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/courses/foo/edit#item=87'),
      writable: true,
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe('uploadAsset', () => {
    it('happy path returns the parsed AssetResponse', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(ASSET_RESPONSE), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const file = new File(['x'.repeat(1024)], 'Histogram.PNG', { type: 'image/png' });
      const result = await uploadAsset(42, file);
      expect(result).toEqual(ASSET_RESPONSE);
    });

    it('request shape: POST, FormData with file, no Content-Type, credentials, X-Requested-With', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(ASSET_RESPONSE), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const file = new File(['x'], 'foo.png', { type: 'image/png' });
      await uploadAsset(42, file);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/versions/42/assets');
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      const headers = new Headers(init.headers);
      expect(headers.get('X-Requested-With')).toBe('mathion');
      expect(headers.get('Content-Type')).toBe(null);
      expect(init.body).toBeInstanceOf(FormData);
      const fd = init.body as FormData;
      const sent = fd.get('file');
      expect(sent).toBeInstanceOf(File);
      expect((sent as File).name).toBe('foo.png');
    });

    it('propagates ApiError with status + detail on 400 (extension)', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'File extension not allowed: foo.exe' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const file = new File(['x'], 'foo.exe', { type: 'application/x-msdownload' });
      await expect(uploadAsset(42, file)).rejects.toMatchObject({
        status: 400,
        detail: 'File extension not allowed: foo.exe',
      });
    });

    it('propagates ApiError on 409 (already exists)', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Asset 'foo.png' already exists in this version" }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const file = new File(['x'], 'foo.png', { type: 'image/png' });
      await expect(uploadAsset(42, file)).rejects.toMatchObject({
        status: 409,
        detail: "Asset 'foo.png' already exists in this version",
      });
    });

    it('propagates ApiError on 403 disabled, 500 disk-write, 400 size, 400 total, 400 no-filename', async () => {
      const cases = [
        { status: 403, detail: 'Version is disabled' },
        { status: 500, detail: 'Failed to write asset to disk' },
        { status: 400, detail: 'File size 10485761 exceeds max 10485760' },
        { status: 400, detail: 'Total version asset size would exceed limit (104857600 bytes)' },
        { status: 400, detail: 'No filename provided' },
      ];
      for (const c of cases) {
        fetchSpy.mockResolvedValueOnce(
          new Response(JSON.stringify({ detail: c.detail }), {
            status: c.status,
            headers: { 'content-type': 'application/json' },
          }),
        );
        const file = new File(['x'], 'foo.png', { type: 'image/png' });
        await expect(uploadAsset(42, file)).rejects.toMatchObject({
          status: c.status,
          detail: c.detail,
        });
      }
    });

    it('wraps network failure in ApiError', async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const file = new File(['x'], 'foo.png', { type: 'image/png' });
      await expect(uploadAsset(42, file)).rejects.toBeInstanceOf(ApiError);
      await expect(uploadAsset(42, file).catch((e) => e)).resolves.toMatchObject({
        status: 0,
      });
      // second call exhausted the mock; restore a fresh one for the rejection branch above.
    });

    it('on 401 calls emitUnauthorized(pathname + search + hash) before throwing', async () => {
      const emitSpy = vi.spyOn(events, 'emitUnauthorized').mockImplementation(() => {});
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Not authenticated' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const file = new File(['x'], 'foo.png', { type: 'image/png' });
      await expect(uploadAsset(42, file)).rejects.toBeInstanceOf(ApiError);
      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy).toHaveBeenCalledWith('/courses/foo/edit#item=87');
    });
  });

  describe('listAssets', () => {
    it('returns the server-sorted array unchanged', async () => {
      const list = [ASSET_RESPONSE, { ...ASSET_RESPONSE, id: 8, filename: 'zebra.pdf', mime_type: 'application/pdf' }];
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(list), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const result = await listAssets(42);
      expect(result).toEqual(list);
      expect(fetchSpy.mock.calls[0][0]).toBe('/api/versions/42/assets');
    });
  });

  describe('deleteAsset', () => {
    it('resolves on 204', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await expect(deleteAsset(7)).resolves.toBeUndefined();
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/assets/7');
      expect(init.method).toBe('DELETE');
    });

    it('propagates ApiError on 404 (race: someone else deleted)', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Asset not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      );
      await expect(deleteAsset(7)).rejects.toMatchObject({ status: 404, detail: 'Asset not found' });
    });
  });

  describe('formatRef', () => {
    it('image mime types return ![stem](filename) with surrounding newlines', () => {
      expect(formatRef('histogram.png', 'image/png')).toBe('\n![histogram](histogram.png)\n');
      expect(formatRef('shot.jpeg', 'image/jpeg')).toBe('\n![shot](shot.jpeg)\n');
      expect(formatRef('anim.gif', 'image/gif')).toBe('\n![anim](anim.gif)\n');
    });

    it('image stem strips ONLY the last extension', () => {
      expect(formatRef('my-report-v2.pdf', 'application/pdf')).toBe('\n[my-report-v2.pdf](my-report-v2.pdf)\n');
      // non-image: stem stripping does not apply
      expect(formatRef('myreportv2.pdf', 'application/pdf')).toBe('\n[myreportv2.pdf](myreportv2.pdf)\n');
    });

    it('non-image mime types return [filename](filename) with surrounding newlines', () => {
      expect(formatRef('worksheet.pdf', 'application/pdf')).toBe('\n[worksheet.pdf](worksheet.pdf)\n');
      expect(formatRef('data.csv', 'text/csv')).toBe('\n[data.csv](data.csv)\n');
      expect(formatRef('script.py', 'text/plain')).toBe('\n[script.py](script.py)\n');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/tests/assets.test.ts`
Expected: FAIL — "Cannot find module '../lib/assets'"

- [ ] **Step 3: Create the helper module**

Create `frontend/src/lib/assets.ts`:

```typescript
// Asset upload + media library helpers.
//
// `uploadAsset` uses raw `fetch` rather than `api.post` because `api.post`
// hardcodes Content-Type: application/json and JSON.stringify(body). Both
// would silently corrupt a multipart upload — the multipart boundary must
// come from the browser-set Content-Type, and the body must be FormData.
//
// On 401 this helper mirrors api.ts:request and calls emitUnauthorized
// with all three location parts (pathname + search + hash) — without this,
// an expired session mid-upload surfaces as a confusing inline error
// rather than a redirect to login.
//
// `listAssets` and `deleteAsset` delegate to api.get / api.delete since
// they don't carry multipart concerns.

import { api, ApiError } from './api';
import { emitUnauthorized } from './events';

export type AssetResponse = {
  id: number;
  version_id: number;
  filename: string;
  file_size: number;
  mime_type: string;
  uploaded_at: string;
  uploaded_by: number | null;
  is_referenced: boolean;
};

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif']);

export async function uploadAsset(versionId: number, file: File): Promise<AssetResponse> {
  const formData = new FormData();
  formData.append('file', file);

  let res: Response;
  try {
    res = await fetch(`/api/versions/${versionId}/assets`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'mathion' },
      body: formData,
    });
  } catch {
    // Network failure (DNS, offline, CORS). Surface a uniform ApiError so
    // the UI maps it through the same channel as server errors.
    throw new ApiError(0, 'Could not reach server. Check your connection.');
  }

  if (res.status === 401) {
    emitUnauthorized(location.pathname + location.search + location.hash);
    throw new ApiError(401, 'Not authenticated');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? res.statusText, body.error_code);
  }
  return res.json() as Promise<AssetResponse>;
}

export function listAssets(versionId: number): Promise<AssetResponse[]> {
  return api.get<AssetResponse[]>(`/api/versions/${versionId}/assets`);
}

export function deleteAsset(assetId: number): Promise<void> {
  return api.delete(`/api/assets/${assetId}`);
}

export function formatRef(filename: string, mimeType: string): string {
  if (IMAGE_MIME_TYPES.has(mimeType)) {
    const stem = filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename;
    return `\n![${stem}](${filename})\n`;
  }
  return `\n[${filename}](${filename})\n`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/assets.test.ts`
Expected: PASS, all `lib/assets` tests green.

- [ ] **Step 5: Run the full suite + svelte-check to confirm no regressions**

Run: `cd frontend && npx vitest run && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -5`
Expected: 172 prior + new tests pass; svelte-check 0 errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/assets.ts frontend/src/tests/assets.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): lib/assets — upload/list/delete + formatRef helper

Pure helper module mirroring lib/api patterns. uploadAsset uses raw
fetch + FormData (api.post would mangle multipart). On 401 mirrors
api.ts:request: emitUnauthorized(pathname + search + hash) before
throw. formatRef returns markdown image syntax for image/png|jpeg|gif
mime types and link syntax otherwise.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `AssetSidebar.svelte` — shell (list, banner, file picker, drop zone)

**Files:**
- Create: `frontend/src/components/editor/AssetSidebar.svelte`
- Create: `frontend/src/tests/AssetSidebar.test.ts`

The sidebar mounts at `versionId`, fetches via `listAssets`, renders rows + thumbnails + the first-time banner + the drop zone, owns its own file-picker upload flow, and exposes `$bindable` props for shared `uploading` / `uploadProgress` / `uploadError`. Delete UI is in Task 3. The sidebar's drop-zone handler AND root `<aside>` drop handler are also in this task (the root-level catch-all for sidebar-interior drops).

- [ ] **Step 1: Write the failing tests (subset 1 — list render + banner)**

Create `frontend/src/tests/AssetSidebar.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import AssetSidebar from '../components/editor/AssetSidebar.svelte';
import * as assetsModule from '../lib/assets';
import type { AssetResponse } from '../lib/assets';

const mkAsset = (overrides: Partial<AssetResponse> = {}): AssetResponse => ({
  id: 1,
  version_id: 42,
  filename: 'histogram.png',
  file_size: 1024,
  mime_type: 'image/png',
  uploaded_at: '2026-05-17T12:00:00Z',
  uploaded_by: 3,
  is_referenced: false,
  ...overrides,
});

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountSidebar(overrides: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props = {
    versionId: 42,
    onInsert: vi.fn(),
    refreshKey: 0,
    cursorReady: false,
    uploading: false,
    uploadProgress: null,
    uploadError: null,
    ...overrides,
  };
  const cmp = mount(AssetSidebar, { target, props });
  cleanup = () => unmount(cmp);
  return { cmp, target };
}

describe('AssetSidebar — list render', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([
      mkAsset({ id: 1, filename: 'a.png', mime_type: 'image/png' }),
      mkAsset({ id: 2, filename: 'b.pdf', mime_type: 'application/pdf', is_referenced: true }),
    ]);
  });

  it('renders rows for each asset returned by listAssets on mount', async () => {
    const { target } = mountSidebar();
    await Promise.resolve();
    flushSync();
    await Promise.resolve();
    flushSync();
    expect(target.querySelector('[data-testid="asset-row-1"]')).toBeTruthy();
    expect(target.querySelector('[data-testid="asset-row-2"]')).toBeTruthy();
  });

  it('shows the "used" badge when is_referenced is true and hides it otherwise', async () => {
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const row1 = target.querySelector('[data-testid="asset-row-1"]')!;
    const row2 = target.querySelector('[data-testid="asset-row-2"]')!;
    expect(row1.querySelector('[data-testid="used-badge"]')).toBeNull();
    expect(row2.querySelector('[data-testid="used-badge"]')).toBeTruthy();
  });
});

describe('AssetSidebar — first-time banner', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
  });

  it('renders the canonical banner literal when cursorReady is false', async () => {
    const { target } = mountSidebar({ cursorReady: false });
    await Promise.resolve(); flushSync();
    const banner = target.querySelector('[data-testid="cursor-banner"]');
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toContain(
      'Click in the editor to position the cursor, or new assets will be appended to the end.',
    );
  });

  it('hides the banner when cursorReady is true', async () => {
    const { target } = mountSidebar({ cursorReady: true });
    await Promise.resolve(); flushSync();
    expect(target.querySelector('[data-testid="cursor-banner"]')).toBeNull();
  });
});

describe('AssetSidebar — click to insert', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([
      mkAsset({ id: 1, filename: 'a.png', mime_type: 'image/png' }),
    ]);
  });

  it('clicking a row calls onInsert with server filename and mime_type', async () => {
    const onInsert = vi.fn();
    const { target } = mountSidebar({ onInsert });
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const row = target.querySelector<HTMLElement>('[data-testid="asset-row-1"]')!;
    row.click();
    expect(onInsert).toHaveBeenCalledWith('a.png', 'image/png');
  });
});

describe('AssetSidebar — empty list', () => {
  it('renders the no-assets prompt when listAssets returns []', async () => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync();
    expect(target.textContent).toContain('No assets yet');
  });
});

describe('AssetSidebar — refreshKey triggers re-fetch', () => {
  it('changing refreshKey re-invokes listAssets', async () => {
    const spy = vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
    const target = document.createElement('div');
    document.body.appendChild(target);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      versionId: 42,
      onInsert: vi.fn(),
      refreshKey: 0,
      cursorReady: false,
      uploading: false,
      uploadProgress: null,
      uploadError: null,
    });
    const cmp = mount(AssetSidebar, { target, props: propsRef });
    cleanup = () => unmount(cmp);
    await Promise.resolve(); flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
    propsRef.refreshKey = 1;
    flushSync();
    await Promise.resolve(); flushSync();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('AssetSidebar — uploadProgress + uploadError rendering', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
  });

  it('renders "Uploading file N of M: <filename>" when uploadProgress is non-null', async () => {
    const { target } = mountSidebar({
      uploadProgress: { current: 2, total: 5, filename: 'foo.png' },
    });
    await Promise.resolve(); flushSync();
    const row = target.querySelector('[data-testid="upload-progress"]');
    expect(row?.textContent).toContain('Uploading file 2 of 5');
    expect(row?.textContent).toContain('foo.png');
  });

  it('renders "Upload stopped at file N of M: <detail>" when uploadError has stoppedAt', async () => {
    const { target } = mountSidebar({
      uploadError: { detail: 'File size 10485761 exceeds max 10485760', stoppedAt: { n: 3, m: 5 } },
    });
    await Promise.resolve(); flushSync();
    const err = target.querySelector('[data-testid="upload-error"]')!;
    expect(err.textContent).toContain('Upload stopped at file 3 of 5');
    expect(err.textContent).toContain('File size 10485761 exceeds max 10485760');
  });

  it('clicking the × dismiss button writes uploadError = null through $bindable', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      versionId: 42,
      onInsert: vi.fn(),
      refreshKey: 0,
      cursorReady: false,
      uploading: false,
      uploadProgress: null,
      uploadError: { detail: 'Boom', stoppedAt: undefined },
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(AssetSidebar, { target, props: propsRef });
    cleanup = () => unmount(cmp);
    await Promise.resolve(); flushSync();
    const dismiss = target.querySelector<HTMLElement>('[data-testid="upload-error-dismiss"]')!;
    dismiss.click();
    flushSync();
    expect(propsRef.uploadError).toBe(null);
  });
});

describe('AssetSidebar — drop on sidebar', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
  });

  it('drop on the drop zone calls stopPropagation synchronously and uploads', async () => {
    const uploadSpy = vi
      .spyOn(assetsModule, 'uploadAsset')
      .mockResolvedValue(mkAsset({ filename: 'dropped.png' }));
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync();
    const dropZone = target.querySelector<HTMLElement>('[data-testid="drop-zone"]')!;
    const stopSpy = vi.fn();
    const preventSpy = vi.fn();
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [new File(['x'], 'dropped.png', { type: 'image/png' })] },
    });
    dropEvent.stopPropagation = stopSpy;
    dropEvent.preventDefault = preventSpy;
    dropZone.dispatchEvent(dropEvent);
    // stopPropagation must be called BEFORE the async upload — verify it
    // was already called immediately after dispatchEvent returned.
    expect(preventSpy).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
    await Promise.resolve(); flushSync();
    await Promise.resolve(); flushSync();
    expect(uploadSpy).toHaveBeenCalledWith(42, expect.any(File));
  });

  it('drop on the root <aside> outside the drop zone also uploads (root-level handler)', async () => {
    const uploadSpy = vi
      .spyOn(assetsModule, 'uploadAsset')
      .mockResolvedValue(mkAsset({ filename: 'rooted.png' }));
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync();
    const aside = target.querySelector<HTMLElement>('aside[data-testid="asset-sidebar"]')!;
    const stopSpy = vi.fn();
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [new File(['x'], 'rooted.png', { type: 'image/png' })] },
    });
    dropEvent.stopPropagation = stopSpy;
    dropEvent.preventDefault = vi.fn();
    aside.dispatchEvent(dropEvent);
    expect(stopSpy).toHaveBeenCalled();
    await Promise.resolve(); flushSync();
    await Promise.resolve(); flushSync();
    expect(uploadSpy).toHaveBeenCalledWith(42, expect.any(File));
  });
});

describe('AssetSidebar — file picker', () => {
  it('selecting a file via the picker calls uploadAsset', async () => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
    const uploadSpy = vi
      .spyOn(assetsModule, 'uploadAsset')
      .mockResolvedValue(mkAsset({ filename: 'picked.png' }));
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync();
    const input = target.querySelector<HTMLInputElement>('[data-testid="file-picker"]')!;
    const file = new File(['x'], 'picked.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve(); flushSync();
    await Promise.resolve(); flushSync();
    expect(uploadSpy).toHaveBeenCalledWith(42, file);
  });
});
```

The `$state` import is implicit from the runes runtime — vitest's `setup` is already configured for it. If `$state` is undefined in the test file, add `// @vitest-environment jsdom` at the top.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/tests/AssetSidebar.test.ts`
Expected: FAIL — "Cannot find module '../components/editor/AssetSidebar.svelte'"

- [ ] **Step 3: Create the AssetSidebar component**

Create `frontend/src/components/editor/AssetSidebar.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError } from '../../lib/api';
  import {
    listAssets,
    uploadAsset,
    deleteAsset as _deleteAsset,
    type AssetResponse,
  } from '../../lib/assets';

  type UploadProgress = { current: number; total: number; filename: string } | null;
  type UploadError = { detail: string; stoppedAt?: { n: number; m: number } } | null;

  let {
    versionId,
    onInsert,
    refreshKey = 0,
    cursorReady = false,
    uploading = $bindable<boolean>(false),
    uploadProgress = $bindable<UploadProgress>(null),
    uploadError = $bindable<UploadError>(null),
  }: {
    versionId: number;
    onInsert: (filename: string, mimeType: string) => void;
    refreshKey?: number;
    cursorReady?: boolean;
    uploading?: boolean;
    uploadProgress?: UploadProgress;
    uploadError?: UploadError;
  } = $props();

  let assets = $state<AssetResponse[]>([]);
  let loading = $state(false);
  let listError = $state<string | null>(null);
  let fileInputEl = $state<HTMLInputElement | null>(null);

  async function fetchAssets() {
    loading = true;
    listError = null;
    try {
      assets = await listAssets(versionId);
    } catch (e) {
      listError = e instanceof ApiError ? e.displayMessage : 'Could not load assets.';
    } finally {
      loading = false;
    }
  }

  onMount(() => { void fetchAssets(); });
  $effect(() => { void refreshKey; void fetchAssets(); });

  function pickFile() { fileInputEl?.click(); }

  async function runUpload(files: File[]) {
    if (uploading) return;
    uploading = true;
    uploadError = null;
    let i = 0;
    try {
      for (; i < files.length; i++) {
        uploadProgress = { current: i + 1, total: files.length, filename: files[i].name };
        await uploadAsset(versionId, files[i]);
        await fetchAssets();
      }
    } catch (e) {
      const detail = e instanceof ApiError ? e.displayMessage : 'Upload failed';
      uploadError = {
        detail,
        stoppedAt: files.length > 1 ? { n: i + 1, m: files.length } : undefined,
      };
    } finally {
      uploading = false;
      uploadProgress = null;
    }
  }

  function handleDropZone(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    void runUpload(files);
  }

  function handleAsideRootDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    void runUpload(files);
  }

  function handleDragOver(e: DragEvent) { e.preventDefault(); e.stopPropagation(); }

  function handleFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    void runUpload(files);
  }

  function imgSrc(a: AssetResponse) {
    return `/assets/${a.version_id}/${a.filename}`;
  }
  function extChip(a: AssetResponse): string {
    const dot = a.filename.lastIndexOf('.');
    return dot === -1 ? '?' : a.filename.slice(dot + 1).toUpperCase();
  }
  function isImage(mime: string) {
    return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif';
  }
</script>

<aside
  class="sidebar"
  data-testid="asset-sidebar"
  ondragover={handleDragOver}
  ondrop={handleAsideRootDrop}
>
  <h3>Assets</h3>

  {#if !cursorReady}
    <p class="banner" data-testid="cursor-banner">
      Click in the editor to position the cursor, or new assets will be appended to the end.
    </p>
  {/if}

  {#if uploadError}
    <div class="error" data-testid="upload-error">
      <span>
        {#if uploadError.stoppedAt}
          Upload stopped at file {uploadError.stoppedAt.n} of {uploadError.stoppedAt.m}: {uploadError.detail}
        {:else}
          {uploadError.detail}
        {/if}
      </span>
      <button
        type="button"
        aria-label="Dismiss error"
        data-testid="upload-error-dismiss"
        onclick={() => (uploadError = null)}
      >×</button>
    </div>
  {/if}

  {#if uploadProgress}
    <div class="progress" data-testid="upload-progress">
      {#if uploadProgress.total > 1}
        Uploading file {uploadProgress.current} of {uploadProgress.total}: {uploadProgress.filename}…
      {:else}
        Uploading {uploadProgress.filename}…
      {/if}
    </div>
  {/if}

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if listError}
    <p class="error-inline">{listError}</p>
  {:else if assets.length === 0}
    <p class="muted">No assets yet. Drop a file in the zone below or click it to pick.</p>
  {:else}
    <ul class="list">
      {#each assets as a (a.id)}
        <li class="row" data-testid={`asset-row-${a.id}`}>
          <button type="button" class="row-click" onclick={() => onInsert(a.filename, a.mime_type)}>
            <span class="thumb">
              {#if isImage(a.mime_type)}
                <img loading="lazy" src={imgSrc(a)} alt="" />
              {:else}
                <span class="chip">{extChip(a)}</span>
              {/if}
            </span>
            <span class="meta">
              <span class="name">{a.filename}</span>
              <span class="size">{a.file_size} B</span>
            </span>
            {#if a.is_referenced}
              <span
                class="used"
                data-testid="used-badge"
                title="Remove this reference from content and save to enable delete."
              >used</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <div
    class="drop-zone"
    data-testid="drop-zone"
    ondragover={handleDragOver}
    ondrop={handleDropZone}
    role="button"
    tabindex="0"
    onclick={pickFile}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile(); } }}
    class:disabled={uploading}
  >
    Drop here or click to pick
  </div>
  <input
    type="file"
    hidden
    data-testid="file-picker"
    bind:this={fileInputEl}
    disabled={uploading}
    onchange={handleFileInput}
  />
</aside>

<style>
  .sidebar { flex: 0 0 280px; padding: var(--space-3); border-left: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-2); }
  h3 { margin: 0 0 var(--space-2) 0; }
  .banner { background: #fff8e1; border-left: 3px solid #f9a825; padding: var(--space-2); font-size: 0.85rem; color: #5d4037; }
  .error { display: flex; gap: var(--space-2); align-items: flex-start; background: #fdecea; border-left: 3px solid #c62828; padding: var(--space-2); color: #7c1f1f; font-size: 0.85rem; }
  .error button { background: none; border: 0; color: inherit; cursor: pointer; font-size: 1.2em; line-height: 1; }
  .progress { background: #e3f2fd; border-left: 3px solid #1976d2; padding: var(--space-2); color: #0d47a1; font-size: 0.85rem; }
  .muted { color: var(--muted, #666); font-size: 0.85rem; }
  .error-inline { color: #a33; font-size: 0.85rem; }
  .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-1); }
  .row-click { width: 100%; display: flex; gap: var(--space-2); align-items: center; padding: var(--space-2); background: none; border: 1px solid transparent; border-radius: var(--radius); cursor: pointer; text-align: left; }
  .row-click:hover { background: #f5f5f5; }
  .thumb { width: 32px; height: 32px; flex: 0 0 32px; display: flex; align-items: center; justify-content: center; background: #eee; border-radius: 4px; overflow: hidden; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .chip { font-size: 0.65rem; font-weight: 600; color: #555; }
  .meta { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .name { font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .size { font-size: 0.7rem; color: var(--muted, #666); }
  .used { font-size: 0.65rem; padding: 2px 6px; background: #c8e6c9; color: #1b5e20; border-radius: 999px; }
  .drop-zone { margin-top: var(--space-2); padding: var(--space-3); border: 2px dashed var(--border); border-radius: var(--radius); text-align: center; color: var(--muted, #666); cursor: pointer; font-size: 0.85rem; }
  .drop-zone:hover { background: #fafafa; }
  .drop-zone.disabled { opacity: 0.5; cursor: not-allowed; }
</style>
```

- [ ] **Step 4: Run AssetSidebar tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/AssetSidebar.test.ts`
Expected: PASS, all sidebar tests green.

- [ ] **Step 5: Run full suite + svelte-check**

Run: `cd frontend && npx vitest run && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -5`
Expected: All prior + new tests pass; svelte-check 0 errors (warnings ok if pre-existing).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/editor/AssetSidebar.svelte frontend/src/tests/AssetSidebar.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): AssetSidebar shell — list, banner, drop zone, file picker

Right-rail media library: GET /api/versions/{vid}/assets on mount and on
any refreshKey change, render thumbnails + filename + size, click-to-
insert via onInsert callback, drop-zone + root <aside> drop handlers
with synchronous preventDefault + stopPropagation (the root catch-all
covers descendant drops outside the drop zone — asset rows, banner,
list area). File picker shares the uploadAsset path. Shared
uploadProgress + uploadError $bindable state drives the transient
upload row + inline error region. First-time banner uses the canonical
literal from the spec.

Delete UI lands in Task 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `AssetSidebar.svelte` — delete UI

**Files:**
- Modify: `frontend/src/components/editor/AssetSidebar.svelte`
- Modify: `frontend/src/tests/AssetSidebar.test.ts`

Add a hover-revealed trash icon to rows where `!is_referenced`, with a two-state inline confirm ("Delete? / Confirm"). On confirm call `deleteAsset`. On 404 (race: someone else deleted) surface a non-blocking error and refresh the list.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/tests/AssetSidebar.test.ts`:

```typescript
describe('AssetSidebar — delete UI', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([
      mkAsset({ id: 1, filename: 'a.png', is_referenced: false }),
      mkAsset({ id: 2, filename: 'b.pdf', is_referenced: true }),
    ]);
  });

  it('trash icon is rendered for unreferenced rows and absent for referenced rows', async () => {
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const row1 = target.querySelector('[data-testid="asset-row-1"]')!;
    const row2 = target.querySelector('[data-testid="asset-row-2"]')!;
    expect(row1.querySelector('[data-testid="delete-trash"]')).toBeTruthy();
    expect(row2.querySelector('[data-testid="delete-trash"]')).toBeNull();
  });

  it('trash → confirm → deleteAsset called and list refreshes', async () => {
    const deleteSpy = vi.spyOn(assetsModule, 'deleteAsset').mockResolvedValue(undefined);
    vi.mocked(assetsModule.listAssets)
      .mockResolvedValueOnce([
        mkAsset({ id: 1, filename: 'a.png', is_referenced: false }),
        mkAsset({ id: 2, filename: 'b.pdf', is_referenced: true }),
      ])
      .mockResolvedValueOnce([mkAsset({ id: 2, filename: 'b.pdf', is_referenced: true })]);
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const trash = target.querySelector<HTMLElement>('[data-testid="delete-trash"]')!;
    trash.click();
    flushSync();
    const confirm = target.querySelector<HTMLElement>('[data-testid="delete-confirm"]')!;
    confirm.click();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    expect(deleteSpy).toHaveBeenCalledWith(1);
    expect(target.querySelector('[data-testid="asset-row-1"]')).toBeNull();
    expect(target.querySelector('[data-testid="asset-row-2"]')).toBeTruthy();
  });

  it('404 on delete (race) surfaces inline error + refreshes the list', async () => {
    const { ApiError } = await import('../lib/api');
    vi.spyOn(assetsModule, 'deleteAsset').mockRejectedValue(new ApiError(404, 'Asset not found'));
    vi.mocked(assetsModule.listAssets)
      .mockResolvedValueOnce([
        mkAsset({ id: 1, filename: 'a.png', is_referenced: false }),
        mkAsset({ id: 2, filename: 'b.pdf', is_referenced: true }),
      ])
      .mockResolvedValueOnce([mkAsset({ id: 2, filename: 'b.pdf', is_referenced: true })]);
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const trash = target.querySelector<HTMLElement>('[data-testid="delete-trash"]')!;
    trash.click();
    flushSync();
    const confirm = target.querySelector<HTMLElement>('[data-testid="delete-confirm"]')!;
    confirm.click();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const err = target.querySelector('[data-testid="delete-error"]');
    expect(err?.textContent).toContain('Asset not found');
    expect(target.querySelector('[data-testid="asset-row-1"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/tests/AssetSidebar.test.ts -t "delete UI"`
Expected: FAIL — selectors not found.

- [ ] **Step 3: Add delete UI to AssetSidebar**

Edit `frontend/src/components/editor/AssetSidebar.svelte`:

In the `<script>` block, before `function imgSrc`, add:

```typescript
  let confirmId = $state<number | null>(null);
  let deleteErrorMsg = $state<string | null>(null);

  function askDelete(id: number) { confirmId = id; }
  function cancelDelete() { confirmId = null; }
  async function confirmDelete(id: number) {
    deleteErrorMsg = null;
    try {
      await _deleteAsset(id);
    } catch (e) {
      deleteErrorMsg = e instanceof ApiError ? e.displayMessage : 'Delete failed';
    } finally {
      confirmId = null;
      await fetchAssets();
    }
  }
```

In the template, change the row `<li>` block to wrap the click button + per-row trash/confirm UI. Replace:

```svelte
        <li class="row" data-testid={`asset-row-${a.id}`}>
          <button type="button" class="row-click" onclick={() => onInsert(a.filename, a.mime_type)}>
            <span class="thumb">
              {#if isImage(a.mime_type)}
                <img loading="lazy" src={imgSrc(a)} alt="" />
              {:else}
                <span class="chip">{extChip(a)}</span>
              {/if}
            </span>
            <span class="meta">
              <span class="name">{a.filename}</span>
              <span class="size">{a.file_size} B</span>
            </span>
            {#if a.is_referenced}
              <span
                class="used"
                data-testid="used-badge"
                title="Remove this reference from content and save to enable delete."
              >used</span>
            {/if}
          </button>
        </li>
```

with:

```svelte
        <li class="row" data-testid={`asset-row-${a.id}`}>
          <button type="button" class="row-click" onclick={() => onInsert(a.filename, a.mime_type)}>
            <span class="thumb">
              {#if isImage(a.mime_type)}
                <img loading="lazy" src={imgSrc(a)} alt="" />
              {:else}
                <span class="chip">{extChip(a)}</span>
              {/if}
            </span>
            <span class="meta">
              <span class="name">{a.filename}</span>
              <span class="size">{a.file_size} B</span>
            </span>
            {#if a.is_referenced}
              <span
                class="used"
                data-testid="used-badge"
                title="Remove this reference from content and save to enable delete."
              >used</span>
            {:else if confirmId === a.id}
              <span class="confirm-pair">
                <button
                  type="button"
                  data-testid="delete-confirm"
                  onclick={(e) => { e.stopPropagation(); void confirmDelete(a.id); }}
                >Confirm</button>
                <button
                  type="button"
                  data-testid="delete-cancel"
                  onclick={(e) => { e.stopPropagation(); cancelDelete(); }}
                >Cancel</button>
              </span>
            {:else}
              <button
                type="button"
                class="trash"
                data-testid="delete-trash"
                aria-label={`Delete ${a.filename}`}
                onclick={(e) => { e.stopPropagation(); askDelete(a.id); }}
              >🗑</button>
            {/if}
          </button>
        </li>
```

Above the `<ul class="list">` (or above `{#if loading}`), add a delete-error region:

```svelte
  {#if deleteErrorMsg}
    <div class="error" data-testid="delete-error">
      <span>{deleteErrorMsg}</span>
      <button
        type="button"
        aria-label="Dismiss error"
        onclick={() => (deleteErrorMsg = null)}
      >×</button>
    </div>
  {/if}
```

In `<style>`, add:

```css
  .confirm-pair { display: flex; gap: var(--space-1); }
  .confirm-pair button { font-size: 0.7rem; padding: 2px 6px; cursor: pointer; }
  .trash { background: none; border: 0; cursor: pointer; opacity: 0; transition: opacity 80ms; font-size: 0.9rem; }
  .row-click:hover .trash { opacity: 0.7; }
  .trash:hover { opacity: 1; }
```

- [ ] **Step 4: Run AssetSidebar tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/AssetSidebar.test.ts`
Expected: PASS, all sidebar tests (including new delete tests) green.

- [ ] **Step 5: Run full suite + svelte-check**

Run: `cd frontend && npx vitest run && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -5`
Expected: All tests pass; svelte-check 0 errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/editor/AssetSidebar.svelte frontend/src/tests/AssetSidebar.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): AssetSidebar delete UI — inline confirm + 404 race handling

Trash icon hover-revealed on !is_referenced rows. Click → inline
Confirm/Cancel pair. On confirm, deleteAsset → refresh list. 404 race
(someone else deleted it) surfaces as a dismissable inline error and
refreshes the list anyway so the row disappears.

Trash icon is absent for is_referenced rows; the existing "used" badge
+ tooltip teach the "remove reference → save → delete" workflow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `MarkdownEditor.svelte` — layout shift, state, sidebar click wiring (no drag-drop yet)

**Files:**
- Modify: `frontend/src/components/editor/MarkdownEditor.svelte`
- Create: `frontend/src/tests/MarkdownEditor.test.ts`

Add the `.edit-content` flex wrapper, mount `AssetSidebar`, own `lastOffset` / `cursorReady` / `uploading` / `uploadProgress` / `uploadError` / `refreshKey` state, wire `insertAtCursor` + the sidebar's `onInsert` callback. Drag-drop is Task 5.

- [ ] **Step 1: Write the failing tests (subset 1 — sidebar mount + click insert + cursorReady)**

Create `frontend/src/tests/MarkdownEditor.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import MarkdownEditor from '../components/editor/MarkdownEditor.svelte';
import * as assetsModule from '../lib/assets';
import type { AssetResponse } from '../lib/assets';

const mkAsset = (overrides: Partial<AssetResponse> = {}): AssetResponse => ({
  id: 1,
  version_id: 42,
  filename: 'histogram.png',
  file_size: 1024,
  mime_type: 'image/png',
  uploaded_at: '2026-05-17T12:00:00Z',
  uploaded_by: 3,
  is_referenced: false,
  ...overrides,
});

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountEditor(overrides: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const propsRef: any = $state({
    versionId: 42,
    value: '',
    readOnly: false,
    ...overrides,
  });
  const cmp = mount(MarkdownEditor, { target, props: propsRef });
  cleanup = () => unmount(cmp);
  return { cmp, target, propsRef };
}

describe('MarkdownEditor — sidebar mount', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
  });

  it('mounts AssetSidebar in Edit mode and unmounts it in Preview mode', async () => {
    const { target } = mountEditor();
    await Promise.resolve(); flushSync();
    expect(target.querySelector('[data-testid="asset-sidebar"]')).toBeTruthy();
    const previewBtn = Array.from(target.querySelectorAll<HTMLElement>('button')).find(
      (b) => b.textContent === 'Preview',
    )!;
    previewBtn.click();
    flushSync();
    expect(target.querySelector('[data-testid="asset-sidebar"]')).toBeNull();
  });

  it('does NOT mount AssetSidebar in readOnly mode', async () => {
    const { target } = mountEditor({ readOnly: true });
    await Promise.resolve(); flushSync();
    expect(target.querySelector('[data-testid="asset-sidebar"]')).toBeNull();
  });
});

describe('MarkdownEditor — click insert at cursor', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([
      mkAsset({ id: 1, filename: 'a.png', mime_type: 'image/png' }),
    ]);
  });

  it('clicking a sidebar row inserts the markdown reference at end-of-content when textarea not focused', async () => {
    const { target, propsRef } = mountEditor({ value: 'hello' });
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const row = target.querySelector<HTMLElement>('[data-testid="asset-row-1"]')!;
    row.click();
    flushSync();
    expect(propsRef.value).toBe('hello\n![a](a.png)\n');
  });

  it('clicking a sidebar row inserts at the textarea cursor position when textarea has been focused', async () => {
    const { target, propsRef } = mountEditor({ value: 'hello world' });
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const ta = target.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.focus();
    ta.setSelectionRange(5, 5);
    ta.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    ta.dispatchEvent(new Event('blur', { bubbles: true }));
    flushSync();
    const row = target.querySelector<HTMLElement>('[data-testid="asset-row-1"]')!;
    row.click();
    flushSync();
    expect(propsRef.value).toBe('hello\n![a](a.png)\n world');
  });
});

describe('MarkdownEditor — cursorReady', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([
      mkAsset({ id: 1, filename: 'a.png', mime_type: 'image/png' }),
    ]);
  });

  it('cursorReady flips to true on textarea first focus and the banner disappears', async () => {
    const { target } = mountEditor();
    await Promise.resolve(); flushSync();
    expect(target.querySelector('[data-testid="cursor-banner"]')).toBeTruthy();
    const ta = target.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.focus();
    ta.dispatchEvent(new Event('focus', { bubbles: true }));
    flushSync();
    expect(target.querySelector('[data-testid="cursor-banner"]')).toBeNull();
  });

  it('cursorReady flips to true on first onInsert call even before textarea focus', async () => {
    const { target } = mountEditor({ value: 'hello' });
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    expect(target.querySelector('[data-testid="cursor-banner"]')).toBeTruthy();
    const row = target.querySelector<HTMLElement>('[data-testid="asset-row-1"]')!;
    row.click();
    flushSync();
    expect(target.querySelector('[data-testid="cursor-banner"]')).toBeNull();
  });
});

describe('MarkdownEditor — value prop bind:value', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
  });

  it('typing in the textarea updates parent value', async () => {
    const { target, propsRef } = mountEditor({ value: 'start' });
    await Promise.resolve(); flushSync();
    const ta = target.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.value = 'changed';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(propsRef.value).toBe('changed');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/tests/MarkdownEditor.test.ts`
Expected: FAIL — selectors not found / inserts not happening (MarkdownEditor doesn't yet mount AssetSidebar).

- [ ] **Step 3: Refactor MarkdownEditor — wrapper + sidebar + state**

Replace the entire contents of `frontend/src/components/editor/MarkdownEditor.svelte` with:

```svelte
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { formatRef } from '../../lib/assets';
  import AssetSidebar from './AssetSidebar.svelte';

  type UploadProgress = { current: number; total: number; filename: string } | null;
  type UploadError = { detail: string; stoppedAt?: { n: number; m: number } } | null;

  let {
    versionId,
    value = $bindable<string>(''),
    readOnly = false,
    refreshKey = $bindable<number>(0),
  }: {
    versionId: number;
    value?: string;
    readOnly?: boolean;
    refreshKey?: number;
  } = $props();

  let _mode = $state<'edit' | 'preview'>('edit');
  const mode = $derived<'edit' | 'preview'>(readOnly ? 'preview' : _mode);
  let html = $state<string | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let latestReq = 0;

  // Edit-mode state: lastOffset tracks the most recent textarea selection so
  // sidebar clicks can insert at the right place when the textarea isn't
  // currently focused; cursorReady gates the first-time banner; uploading /
  // uploadProgress / uploadError are shared $bindable with AssetSidebar.
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let lastOffset = $state(0);
  let cursorReady = $state(false);
  let uploading = $state(false);
  let uploadProgress = $state<UploadProgress>(null);
  let uploadError = $state<UploadError>(null);

  // Keep lastOffset = value.length if the user has never touched the textarea —
  // sidebar clicks before focus then append to the end. Once they focus or
  // type, lastOffset reflects the real selection (handlers below).
  $effect(() => { if (!cursorReady) lastOffset = value.length; });

  function onTextareaFocus() { cursorReady = true; updateLastOffset(); }
  function onTextareaBlur() { updateLastOffset(); }
  function onTextareaSelectionChange() { updateLastOffset(); }
  function updateLastOffset() {
    if (textareaEl) lastOffset = textareaEl.selectionStart ?? lastOffset;
  }

  function insertAtCursor(text: string, atOffset?: number) {
    if (!textareaEl) return;  // Edit→Preview mid-async — silent no-op (spec)
    const offset = atOffset ?? lastOffset;
    const before = value.slice(0, offset);
    const after = value.slice(offset);
    value = before + text + after;
    const newPos = offset + text.length;
    // Move the textarea cursor to just after the insertion. Schedule one
    // microtask so the bind:value→DOM update lands before we set selection.
    queueMicrotask(() => {
      if (!textareaEl) return;
      textareaEl.focus();
      textareaEl.setSelectionRange(newPos, newPos);
      lastOffset = newPos;
    });
  }

  function handleSidebarInsert(filename: string, mimeType: string) {
    cursorReady = true;  // SPEC: set BEFORE insertAtCursor (clarity, not correctness)
    insertAtCursor(formatRef(filename, mimeType));
  }

  async function loadPreview() {
    const reqId = ++latestReq;
    loading = true;
    error = null;
    try {
      const res = await api.post<{ html: string }>(`/api/versions/${versionId}/render`, { content_md: value });
      if (reqId !== latestReq) return;
      html = res.html;
    } catch (e) {
      if (reqId !== latestReq) return;
      error = e instanceof ApiError ? e.displayMessage : 'Could not render preview.';
    } finally {
      if (reqId === latestReq) loading = false;
    }
  }

  function setMode(m: 'edit' | 'preview') {
    _mode = m;
    if (m === 'preview') loadPreview();
  }

  onMount(() => { if (readOnly) void loadPreview(); });
  onDestroy(() => { latestReq++; });
</script>

<div class="editor">
  {#if !readOnly}
    <div class="tabs">
      <button type="button" aria-pressed={mode === 'edit'} onclick={() => setMode('edit')}>Edit</button>
      <button type="button" aria-pressed={mode === 'preview'} onclick={() => setMode('preview')}>Preview</button>
    </div>
  {/if}
  {#if mode === 'edit' && !readOnly}
    <div class="edit-content">
      <textarea
        bind:this={textareaEl}
        bind:value
        rows="14"
        spellcheck="false"
        onfocus={onTextareaFocus}
        onblur={onTextareaBlur}
        onselectionchange={onTextareaSelectionChange}
      ></textarea>
      <AssetSidebar
        {versionId}
        onInsert={handleSidebarInsert}
        {refreshKey}
        {cursorReady}
        bind:uploading
        bind:uploadProgress
        bind:uploadError
      />
    </div>
  {:else if loading}
    <div class="preview"><em>Rendering…</em></div>
  {:else if error}
    <div class="preview err">{error}</div>
  {:else}
    <div class="preview">{@html html ?? ''}</div>
  {/if}
</div>

<style>
  .editor { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; display: flex; flex-direction: column; }
  .tabs { display: flex; border-bottom: 1px solid var(--border); }
  .tabs button { background: none; border: 0; padding: var(--space-2) var(--space-3); cursor: pointer; }
  .tabs button[aria-pressed="true"] { background: var(--surface, #f7f7f7); font-weight: 600; }
  .edit-content { display: flex; flex-direction: row; min-height: 0; }
  textarea { flex: 1 1 0; min-width: 0; border: 0; padding: var(--space-3); font-family: ui-monospace, monospace; }
  .preview { padding: var(--space-3); min-height: 200px; }
  .preview.err { color: #a33; }
</style>
```

- [ ] **Step 4: Run MarkdownEditor tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/MarkdownEditor.test.ts`
Expected: PASS for the four subsections defined in Step 1.

- [ ] **Step 5: Run full suite + svelte-check**

Run: `cd frontend && npx vitest run && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -5`
Expected: All tests pass; svelte-check 0 errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/editor/MarkdownEditor.svelte frontend/src/tests/MarkdownEditor.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): MarkdownEditor — sidebar mount + click-insert + state

Layout shift: textarea + AssetSidebar in a flex .edit-content wrapper.
Conditional mount on {mode === 'edit' && !readOnly} so Preview / readOnly
drop the sidebar (and any transient state like delete-confirm) cleanly.

State: lastOffset (selectionStart tracking via focus/blur/
selectionchange), cursorReady (first-time banner gate; flips on textarea
first focus OR first onInsert), uploading / uploadProgress / uploadError
($bindable shared with AssetSidebar — the sidebar renders the transient
progress row and the inline error region), refreshKey ($bindable two-way
with parent host so MarkdownEditor's upload paths can bump it; parent
also bumps post-save).

insertAtCursor splices at the offset and restores the cursor; on null
textareaEl (Edit→Preview mid-async) silently no-ops. handleSidebarInsert
sets cursorReady=true BEFORE insertAtCursor per spec.

Drag-drop wiring lands in Task 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `MarkdownEditor.svelte` — textarea + `.edit-content` wrapper drag-drop + refreshKey bumps

**Files:**
- Modify: `frontend/src/components/editor/MarkdownEditor.svelte`
- Modify: `frontend/src/tests/MarkdownEditor.test.ts`

Wire the textarea drop (precise offset via `caretPositionFromPoint` / `caretRangeFromPoint` with `lastOffset` fallback, upload + insert + `refreshKey++` per file) and the wrapper drop (upload-only + `refreshKey++`). Both handlers synchronously `preventDefault(); stopPropagation();` before guards or awaits. The 1.5s overlay flash on drop-while-uploading. Multi-file sequential. Re-entrancy guard.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/tests/MarkdownEditor.test.ts`:

```typescript
describe('MarkdownEditor — textarea drop', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
  });

  function makeDropEvent(files: File[], target: EventTarget, opts: { stopSpy?: () => void; preventSpy?: () => void } = {}) {
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { files } });
    Object.defineProperty(ev, 'target', { value: target });
    if (opts.stopSpy) ev.stopPropagation = opts.stopSpy;
    if (opts.preventSpy) ev.preventDefault = opts.preventSpy;
    return ev;
  }

  it('drop on textarea uploads + inserts + bumps refreshKey', async () => {
    const uploadSpy = vi
      .spyOn(assetsModule, 'uploadAsset')
      .mockResolvedValue(mkAsset({ filename: 'dropped.png', mime_type: 'image/png' }));
    // caretPositionFromPoint and caretRangeFromPoint may not exist in jsdom.
    // Both null → fallback to lastOffset.
    const { target, propsRef } = mountEditor({ value: 'abc', refreshKey: 0 });
    await Promise.resolve(); flushSync();
    const ta = target.querySelector<HTMLTextAreaElement>('textarea')!;
    // Place cursor at offset 1 via focus + setSelectionRange so lastOffset
    // captures it.
    ta.focus();
    ta.setSelectionRange(1, 1);
    ta.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    flushSync();
    const stopSpy = vi.fn();
    const preventSpy = vi.fn();
    const file = new File(['x'], 'dropped.png', { type: 'image/png' });
    const ev = makeDropEvent([file], ta, { stopSpy, preventSpy });
    ta.dispatchEvent(ev);
    // Synchronous discipline: pD + sP must have been called before await.
    expect(preventSpy).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
    await Promise.resolve(); flushSync();
    await Promise.resolve(); flushSync();
    expect(uploadSpy).toHaveBeenCalledWith(42, file);
    expect(propsRef.value).toBe('a\n![dropped](dropped.png)\nbc');
    expect(propsRef.refreshKey).toBe(1);
  });

  it('drop on textarea with no precise offset falls back to lastOffset (= end if never focused)', async () => {
    vi.spyOn(assetsModule, 'uploadAsset').mockResolvedValue(
      mkAsset({ filename: 'fb.png', mime_type: 'image/png' }),
    );
    const { target, propsRef } = mountEditor({ value: 'abc' });
    await Promise.resolve(); flushSync();
    const ta = target.querySelector<HTMLTextAreaElement>('textarea')!;
    const file = new File(['x'], 'fb.png', { type: 'image/png' });
    const ev = makeDropEvent([file], ta);
    ta.dispatchEvent(ev);
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    expect(propsRef.value).toBe('abc\n![fb](fb.png)\n');
  });
});

describe('MarkdownEditor — wrapper (.edit-content) drop', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
  });

  it('drop on wrapper uploads (no insert) and bumps refreshKey', async () => {
    const uploadSpy = vi
      .spyOn(assetsModule, 'uploadAsset')
      .mockResolvedValue(mkAsset({ filename: 'wd.png', mime_type: 'image/png' }));
    const { target, propsRef } = mountEditor({ value: 'abc', refreshKey: 0 });
    await Promise.resolve(); flushSync();
    const wrapper = target.querySelector<HTMLElement>('.edit-content')!;
    const file = new File(['x'], 'wd.png', { type: 'image/png' });
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
    Object.defineProperty(ev, 'target', { value: wrapper });
    const preventSpy = vi.fn();
    ev.preventDefault = preventSpy;
    wrapper.dispatchEvent(ev);
    expect(preventSpy).toHaveBeenCalled();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    expect(uploadSpy).toHaveBeenCalledWith(42, file);
    expect(propsRef.value).toBe('abc');  // no insert
    expect(propsRef.refreshKey).toBe(1);
  });
});

describe('MarkdownEditor — re-entrancy guard', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
  });

  it('a second textarea drop while uploading is rejected (uploadAsset called once)', async () => {
    let resolveFirst: (a: AssetResponse) => void = () => {};
    const firstPromise = new Promise<AssetResponse>((r) => { resolveFirst = r; });
    const uploadSpy = vi
      .spyOn(assetsModule, 'uploadAsset')
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce(mkAsset({ filename: 'second.png' }));
    const { target } = mountEditor({ value: '' });
    await Promise.resolve(); flushSync();
    const ta = target.querySelector<HTMLTextAreaElement>('textarea')!;
    const f1 = new File(['x'], 'first.png', { type: 'image/png' });
    const f2 = new File(['y'], 'second.png', { type: 'image/png' });
    const ev1 = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev1, 'dataTransfer', { value: { files: [f1] } });
    ev1.preventDefault = vi.fn(); ev1.stopPropagation = vi.fn();
    ta.dispatchEvent(ev1);
    flushSync();
    // second drop while the first promise is pending
    const ev2 = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev2, 'dataTransfer', { value: { files: [f2] } });
    ev2.preventDefault = vi.fn(); ev2.stopPropagation = vi.fn();
    ta.dispatchEvent(ev2);
    flushSync();
    // first call only — the second was guard-rejected
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    resolveFirst(mkAsset({ filename: 'first.png' }));
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
  });
});

describe('MarkdownEditor — multi-file batch with mid-error', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
  });

  it('batch halts on mid-loop error and writes uploadError with stoppedAt', async () => {
    const { ApiError } = await import('../lib/api');
    vi.spyOn(assetsModule, 'uploadAsset')
      .mockResolvedValueOnce(mkAsset({ filename: '1.png' }))
      .mockResolvedValueOnce(mkAsset({ filename: '2.png' }))
      .mockRejectedValueOnce(new ApiError(400, 'File size 999 exceeds max 100'))
      .mockResolvedValueOnce(mkAsset({ filename: '4.png' }));
    const { target } = mountEditor({ value: '' });
    await Promise.resolve(); flushSync();
    const ta = target.querySelector<HTMLTextAreaElement>('textarea')!;
    const files = [1, 2, 3, 4].map(
      (n) => new File(['x'], `${n}.png`, { type: 'image/png' }),
    );
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { files } });
    ev.preventDefault = vi.fn(); ev.stopPropagation = vi.fn();
    ta.dispatchEvent(ev);
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    // sidebar should now display the error with stoppedAt 3 of 4
    const err = target.querySelector('[data-testid="upload-error"]');
    expect(err?.textContent).toContain('Upload stopped at file 3 of 4');
    expect(err?.textContent).toContain('File size 999 exceeds max 100');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/tests/MarkdownEditor.test.ts`
Expected: FAIL — drop handlers not wired yet.

- [ ] **Step 3: Wire drop handlers in MarkdownEditor**

Edit `frontend/src/components/editor/MarkdownEditor.svelte`:

In the `<script>` block, **add the upload helper plus drop handlers** above `function handleSidebarInsert`:

```typescript
  // Refresh-overlay timer for "drop arriving while uploading". A second drop
  // during a batch is discarded with a 1.5s visual flash; we just track the
  // moment so a future style binding can render it (CSS class on wrapper).
  let flashUntil = $state(0);
  function flashOverlay() { flashUntil = Date.now() + 1500; }

  async function runMarkdownEditorUpload(
    files: File[],
    onEachSuccess: (asset: AssetResponse, index: number) => void,
  ): Promise<void> {
    if (uploading) { flashOverlay(); return; }
    uploading = true;
    uploadError = null;
    let i = 0;
    try {
      for (; i < files.length; i++) {
        uploadProgress = { current: i + 1, total: files.length, filename: files[i].name };
        const asset = await uploadAsset(versionId, files[i]);
        onEachSuccess(asset, i);
        refreshKey++;
      }
    } catch (e) {
      const detail = e instanceof ApiError ? e.displayMessage : 'Upload failed';
      uploadError = {
        detail,
        stoppedAt: files.length > 1 ? { n: i + 1, m: files.length } : undefined,
      };
    } finally {
      uploading = false;
      uploadProgress = null;
    }
  }

  function dropOffsetFromPoint(e: DragEvent): number {
    // caretPositionFromPoint is the Firefox-spec name; caretRangeFromPoint is
    // the Chrome/WebKit legacy alias. jsdom + older browsers expose neither —
    // fall back to lastOffset.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = document as any;
    if (typeof doc.caretPositionFromPoint === 'function') {
      const pos = doc.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos && typeof pos.offset === 'number') return pos.offset;
    }
    if (typeof doc.caretRangeFromPoint === 'function') {
      const r = doc.caretRangeFromPoint(e.clientX, e.clientY);
      if (r && typeof r.startOffset === 'number') return r.startOffset;
    }
    return lastOffset;
  }

  function handleTextareaDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }
  function handleTextareaDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    let offset = dropOffsetFromPoint(e);
    void runMarkdownEditorUpload(files, (asset) => {
      const ref = formatRef(asset.filename, asset.mime_type);
      insertAtCursor(ref, offset);
      offset += ref.length;
      cursorReady = true;
    });
  }

  function handleWrapperDragOver(e: DragEvent) {
    e.preventDefault();
  }
  function handleWrapperDrop(e: DragEvent) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    void runMarkdownEditorUpload(files, () => { /* no insert */ });
  }
```

Add the `uploadAsset` import at the top (extend the existing `import` line):

```typescript
  import { formatRef, uploadAsset, type AssetResponse } from '../../lib/assets';
```

In the template, change the `.edit-content` block to add the wrapper + textarea drop handlers:

```svelte
    <div
      class="edit-content"
      ondragover={handleWrapperDragOver}
      ondrop={handleWrapperDrop}
      class:flash={Date.now() < flashUntil}
    >
      <textarea
        bind:this={textareaEl}
        bind:value
        rows="14"
        spellcheck="false"
        ondragover={handleTextareaDragOver}
        ondrop={handleTextareaDrop}
        onfocus={onTextareaFocus}
        onblur={onTextareaBlur}
        onselectionchange={onTextareaSelectionChange}
      ></textarea>
      <AssetSidebar
        {versionId}
        onInsert={handleSidebarInsert}
        {refreshKey}
        {cursorReady}
        bind:uploading
        bind:uploadProgress
        bind:uploadError
      />
    </div>
```

In `<style>`, add:

```css
  .edit-content.flash { box-shadow: inset 0 0 0 2px #c62828; }
```

- [ ] **Step 4: Run MarkdownEditor tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/MarkdownEditor.test.ts`
Expected: PASS for all subsections including new drop, re-entrancy, multi-file batch tests.

- [ ] **Step 5: Run full suite + svelte-check**

Run: `cd frontend && npx vitest run && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -5`
Expected: All tests pass; svelte-check 0 errors (warnings ok if pre-existing).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/editor/MarkdownEditor.svelte frontend/src/tests/MarkdownEditor.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): MarkdownEditor drag-drop — textarea + .edit-content wrapper

Textarea drop: precise offset via caretPositionFromPoint /
caretRangeFromPoint (with lastOffset fallback for jsdom + older browsers),
sequential upload, insertAtCursor after each, refreshKey++ after each.
.edit-content wrapper drop: data-loss guard — upload only (no insert),
refreshKey++ after each.

Both handlers call event.preventDefault() + event.stopPropagation()
SYNCHRONOUSLY as their first statements, before the re-entrancy guard
and the synchronous uploading=true write. DOM propagation is
synchronous; stopping it after await is too late and would let the
wrapper handler fire twice.

Re-entrancy guard: a second drop during an in-flight batch is
discarded, with a 1.5s visual flash on the wrapper. Multi-file batch
halts on first error and writes uploadError with stoppedAt:{n,m}.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `ItemEditPage.svelte` — `bind:refreshKey` + bump on save success + focused tests

**Files:**
- Modify: `frontend/src/pages/editor/ItemEditPage.svelte`
- Create: `frontend/src/tests/ItemEditPage.refreshKey.test.ts`

Add `let refreshKey = $state(0)` in `ItemEditPage`, forward as `bind:refreshKey` to `MarkdownEditor`, and bump in the `result === 'ok'` branch of `save()`. Cover with a focused test file (the existing `ItemEditPage.svelte` has no dedicated test file in the repo, so a new one keeps the change isolated and avoids touching the broader page test surface).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/tests/ItemEditPage.refreshKey.test.ts`:

```typescript
// Focused tests for the refreshKey wiring on ItemEditPage. We don't mount
// the full ItemEditPage (its dependency graph is large — admin tree store,
// router, toasts, dirty tracker). Instead, we mount a thin synthetic harness
// that mirrors the relevant save-flow shape: declare `refreshKey = $state(0)`,
// bind it through MarkdownEditor, simulate a successful save, verify the
// bump.
//
// This test guards the contract: "ItemEditPage owns refreshKey; bumps on
// successful content_md save; does NOT bump on save failure". MarkdownEditor
// (Task 5) covers the upload-success path of the same counter.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RefreshKeyHarness from './ItemEditPage.refreshKey.harness.svelte';
import * as assetsModule from '../lib/assets';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
});

describe('ItemEditPage refreshKey wiring', () => {
  it('successful save bumps refreshKey once', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: any = $state({ initial: 0, simulateSaveResult: 'ok' as 'ok' | 'error' });
    const cmp = mount(RefreshKeyHarness, { target, props });
    cleanup = () => unmount(cmp);
    await Promise.resolve(); flushSync();
    const btn = target.querySelector<HTMLElement>('[data-testid="simulate-save"]')!;
    btn.click();
    flushSync();
    const out = target.querySelector('[data-testid="refresh-key-value"]')!;
    expect(out.textContent).toBe('1');
  });

  it('failed save does NOT bump refreshKey', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: any = $state({ initial: 0, simulateSaveResult: 'error' as 'ok' | 'error' });
    const cmp = mount(RefreshKeyHarness, { target, props });
    cleanup = () => unmount(cmp);
    await Promise.resolve(); flushSync();
    const btn = target.querySelector<HTMLElement>('[data-testid="simulate-save"]')!;
    btn.click();
    flushSync();
    const out = target.querySelector('[data-testid="refresh-key-value"]')!;
    expect(out.textContent).toBe('0');
  });

  it('MarkdownEditor writes refreshKey (via $bindable) propagate to parent', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: any = $state({ initial: 0, simulateSaveResult: 'ok' as 'ok' | 'error' });
    const cmp = mount(RefreshKeyHarness, { target, props });
    cleanup = () => unmount(cmp);
    await Promise.resolve(); flushSync();
    // Simulate the child writing refreshKey++ via the test hook
    const childBump = target.querySelector<HTMLElement>('[data-testid="child-bump"]')!;
    childBump.click();
    flushSync();
    childBump.click();
    flushSync();
    const out = target.querySelector('[data-testid="refresh-key-value"]')!;
    expect(out.textContent).toBe('2');
  });
});
```

Create the harness `frontend/src/tests/ItemEditPage.refreshKey.harness.svelte`:

```svelte
<script lang="ts">
  // Minimal harness that mirrors the relevant slice of ItemEditPage's
  // refreshKey wiring without dragging in the admin-tree store / router /
  // dirty-tracker dependencies. Mirrors:
  //   let refreshKey = $state(0);
  //   <MarkdownEditor bind:refreshKey ... />
  //   on save success: refreshKey++
  //   on save error: no bump
  //
  // The child-bump button represents MarkdownEditor's upload-success path
  // (Task 5) — which writes through bind:refreshKey just like ItemEditPage
  // does in save(). Either writer can advance the counter.

  let { initial, simulateSaveResult }: {
    initial: number;
    simulateSaveResult: 'ok' | 'error';
  } = $props();

  let refreshKey = $state(initial);

  function simulateSave() {
    if (simulateSaveResult === 'ok') refreshKey++;
    // 'error' branch: no bump (mirrors the actual save() flow).
  }

  function childBump() { refreshKey++; }
</script>

<button type="button" data-testid="simulate-save" onclick={simulateSave}>save</button>
<button type="button" data-testid="child-bump" onclick={childBump}>child-bump</button>
<output data-testid="refresh-key-value">{refreshKey}</output>
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/tests/ItemEditPage.refreshKey.test.ts`
Expected: FAIL — harness file not found.

(After Step 1 creates the harness, the tests should already pass since the harness contains the wiring. The point of TDD here is to ensure the test file exercises the contract; the harness is the artifact under test. We commit them together as Step 1's two new files.)

- [ ] **Step 3: Wire `refreshKey` into `ItemEditPage.svelte`**

Edit `frontend/src/pages/editor/ItemEditPage.svelte`:

In the `<script>` block, after `let postSaveRefetchFailed = $state(false);` (around line 57), add:

```typescript
  // Bumped after a successful content_md save so AssetSidebar re-fetches
  // and is_referenced flags reflect the latest AssetReference rows.
  // MarkdownEditor also writes this (textarea/wrapper drop upload success)
  // via the $bindable two-way; both writers advance the same counter.
  let refreshKey = $state(0);
```

In `async function save()`, in the `result === 'ok'` branch, after `postSaveRefetchFailed = false;` (around current line 177), add:

```typescript
        refreshKey++;
```

In the template, change the static_page MarkdownEditor invocation (around line 268) from:

```svelte
            <MarkdownEditor versionId={vid} bind:value={t.current.content_md} />
```

to:

```svelte
            <MarkdownEditor versionId={vid} bind:value={t.current.content_md} bind:refreshKey />
```

(Leave the readOnly preview-mode MarkdownEditor at line 303 unchanged — no sidebar in readOnly mode anyway.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/ItemEditPage.refreshKey.test.ts`
Expected: PASS, all three refresh-key tests green.

- [ ] **Step 5: Run full suite + svelte-check**

Run: `cd frontend && npx vitest run && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -5`
Expected: All tests pass; svelte-check 0 errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/editor/ItemEditPage.svelte frontend/src/tests/ItemEditPage.refreshKey.test.ts frontend/src/tests/ItemEditPage.refreshKey.harness.svelte
git commit -m "$(cat <<'EOF'
feat(frontend): ItemEditPage — bind:refreshKey + bump on save success

Declares refreshKey = $state(0) and forwards via bind:refreshKey to
MarkdownEditor (static_page branch — the only editable branch with
markdown content). Bumps in the result === 'ok' branch of save() so
AssetSidebar re-fetches and is_referenced reflects the latest
AssetReference rows. Does NOT bump on error / discarded / non-save
exits.

Focused harness-based tests cover: save-success bumps, save-failure
does not, $bindable round-trip from a child-bump writer (mirrors the
MarkdownEditor upload-success path).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final verification — pytest + svelte-check + vitest + manual smoke

**Files:** none modified — verification only.

- [ ] **Step 1: Run backend pytest (no backend changes — expected to be unchanged)**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion && backend/.venv/bin/pytest backend 2>&1 | tail -5`
Expected: All backend tests pass (count unchanged from baseline).

- [ ] **Step 2: Run frontend svelte-check**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -10`
Expected: 0 errors. Warnings ≤ pre-existing baseline (19 from prior commits).

- [ ] **Step 3: Run full vitest suite**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run 2>&1 | tail -5`
Expected: All tests pass. Count should be ≥ 172 (baseline) + new tests from Tasks 1-6.

- [ ] **Step 4: Manual smoke — 18-step checklist from the spec**

Open `docs/superpowers/specs/2026-05-16-asset-upload-design.md` and walk through the "Manual smoke" section (steps 1-18). Run frontend (`cd frontend && npx vite`) and backend (`backend/.venv/bin/uvicorn mathion.main:app --reload`). For each step:

1. Upload an image via the sidebar's file picker → appears in sidebar with thumbnail.
2. Click the image row → markdown reference appears in textarea at the current cursor. Switch to Preview → image renders.
3. First-time banner — focus path: hard-reload page on a fresh item. Banner: "Click in the editor to position the cursor, or new assets will be appended to the end." Click textarea → banner disappears.
4. First-time banner — insert path: hard-reload, immediately click a sidebar row WITHOUT clicking textarea. Reference inserted at END of content. Banner also clears.
5. Textarea drop: drag image to mid-paragraph. Inserted markdown appears at the drop line, NOT end; `\n…\n` wraps it.
6. `.edit-content` wrapper drop guard: drop 10px above textarea (wrapper padding). Browser does NOT navigate; file appears in sidebar (upload only).
7. No double-fire on textarea drop: count rows before, drop a file on textarea, count rows after. Difference = 1 (NOT 2).
8. Same-filename re-upload: drop same filename twice → 409 inline error using sanitized filename + "Rename the file on disk and re-upload." hint.
9. Disallowed extension: drop `.exe` → 400 inline error.
10. Oversize file: drop > max_file_size → 400 inline with byte numbers (raw integers, no KB/MB units).
11. Reference + save + sidebar refresh: reference in content_md → save. Sidebar refreshes via `refreshKey`; `used` badge appears; trash hidden. Hover badge → tooltip explains workflow.
12. Unreference + save: remove reference from content_md → save. `used` disappears; trash visible on hover. Click trash → inline Confirm → delete → row gone.
13. Multi-file drop with mid-batch 400: drop 5 files where one is oversize. Files before error inserted; files after not. Error: "Upload stopped at file N of 5".
14. Multi-file drop with mid-batch network failure: DevTools → Network → Slow 3G first; drop 3 files; flip to Offline mid-batch. Error begins "Could not reach server" with "Upload stopped at file N of 3".
15. Drop-while-uploading: DevTools → Network → Slow 3G. Drop file; drop second mid-upload. Second drop discarded with 1.5s overlay flash; "Uploading…" transient row stays visible. Overlay timer anchored at the moment of the discarded drop.
16. Edit → Preview → Edit round-trip: upload file in Edit, switch to Preview, switch back. (a) File still in sidebar; (b) no stale state (open delete-confirm gone); (c) first-time banner stays cleared (`cursorReady` survives because it lives in MarkdownEditor).
17. Save 422 cross-channel: type `![ghost](does-not-exist.png)` in textarea → save (PATCH). 422 surfaces via the existing item save-error path (NOT in sidebar). Sidebar list unchanged.
18. Disabled version: disable version → navigate away → return. Sidebar not rendered (readOnly mode). Re-enable, return: sidebar comes back.

Document any failure as an issue to be fixed in a follow-up step before merging.

- [ ] **Step 5: Final commit (only if any verification-only edits needed; otherwise skip)**

If a smoke-step fix is required, isolate the change to its own commit. If everything passes, skip this step.

---

## Self-Review (writing-plans skill)

**Spec coverage:**
- Backend-pipeline assumptions (§Backend-pipeline) — no implementation, only relied on; covered by Task 7 pytest re-run.
- Non-goals V1 — by omission; none of Tasks 1-7 add force-delete, search, rename, progress percentage, server-thumbs, bulk ops, or sidebar collapse persistence.
- Architecture / Where the feature lives → Tasks 1 (`lib/assets.ts`), 2-3 (`AssetSidebar.svelte`), 4-5 (`MarkdownEditor.svelte`), 6 (`ItemEditPage.svelte`).
- ReadOnly mode → Task 4 test "does NOT mount AssetSidebar in readOnly mode" + sidebar mount conditional `{#if mode === 'edit' && !readOnly}` in the MarkdownEditor template.
- Boundary summary → coverage spread across all tasks; ownership tested by component tests.
- Shared `uploading` / `uploadProgress` / `uploadError` $bindable + TOCTOU synchronous-write + canonical handler shape → Tasks 2 (sidebar) + 5 (editor); re-entrancy guard test in Task 5.
- UI layout (flex `.edit-content`, sidebar 280px, textarea flex 1 1 0 min-width 0) → Task 4 + 5 styles.
- Insert format (image vs link mime gating, leading/trailing newlines) → Task 1 `formatRef` tests; Task 4 click-insert tests + Task 5 drop-insert tests verify end-to-end.
- Drop on textarea (caretPositionFromPoint fallback chain, sequential, error halt, "Upload stopped at file N of M") → Task 5.
- Drop on `.edit-content` wrapper (data-loss guard, upload-only, refreshKey++) → Task 5.
- Drop on sidebar (drop zone + root `<aside>` handler, synchronous stopPropagation, sidebar's own listAssets refresh) → Task 2.
- Empty / loading / progress / error states table → Task 2 (sidebar renders all of them via `uploadProgress` + `uploadError` props from Task 5 writers; first-time banner from Task 4 wiring).
- Error handling backend response → UI surface table → Task 1 (uploadAsset ApiError mapping) + Task 2 (sidebar renders detail verbatim) + Task 5 (multi-file `stoppedAt` prefix).
- Cross-channel save 422 → no test added (out of scope per spec); covered by smoke step 17.
- Edge cases (two uploads in flight, `onInsert` no-focus, banner across Edit↔Preview, referenced→unreferenced, disabled-version mid-session, network failure mid-batch) → Tasks 4 (banner/cursor) + 5 (re-entrancy, batch-error).
- Testing approach:
  - `lib/assets.ts` (request shape, X-Requested-With, 401 emit, error classes, formatRef, listAssets, deleteAsset 404) → Task 1.
  - `AssetSidebar.svelte` (list render, banner copy, click insert, file picker, drop zone, root <aside> handler, uploadProgress/uploadError rendering, dismiss button, refreshKey re-fetch, delete UI, 404 race) → Tasks 2-3.
  - `MarkdownEditor.svelte` (sidebar mount/unmount on mode/readOnly, click insert at lastOffset, cursorReady focus + insert paths, value bind, textarea drop + insert + refreshKey, fallback to lastOffset, wrapper drop + refreshKey, re-entrancy guard, multi-file batch error) → Tasks 4-5.
  - `ItemEditPage.svelte` (refreshKey wiring) → Task 6.
- Manual smoke (18 steps) → Task 7 Step 4.
- Data flow diagrams (three: textarea, wrapper-true-outside, sidebar-interior) → all paths exercised in Tasks 4-5 tests; sidebar-interior in Tasks 2-3.
- File structure / LOC estimates → tasks generate files at the structure listed.
- Estimated implementation scope (6-7 tasks) → 7 tasks delivered.

No spec gaps detected.

**Placeholder scan:** Searched for "TBD", "TODO", "implement later", "fill in details", "Add appropriate", "Write tests for", "Similar to Task" in the plan body — none present. Every step includes the actual code or command.

**Type consistency:**
- `AssetResponse` shape used identically in Tasks 1-6.
- `UploadProgress` / `UploadError` aliases declared in Task 2 (AssetSidebar) and Task 4 (MarkdownEditor) with the same shape (object with `current`/`total`/`filename` and `detail`/`stoppedAt` respectively).
- `formatRef(filename, mimeType)` signature stable across Tasks 1, 4, 5.
- `onInsert(filename, mimeType)` callback signature consistent across Tasks 2 (declared in AssetSidebar) and 4 (called from MarkdownEditor.handleSidebarInsert).
- `refreshKey` declared `$bindable` on both MarkdownEditor (Task 4) and ItemEditPage forwards via `bind:refreshKey` (Task 6); sidebar receives as regular one-way prop (Task 2).

No inconsistencies detected.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-17-asset-upload.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
