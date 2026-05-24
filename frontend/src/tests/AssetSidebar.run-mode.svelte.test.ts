import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import AssetSidebar from '../components/editor/AssetSidebar.svelte';
import { runAssetContext } from '../lib/assetContext';
import type { AssetItem } from '../lib/assetContext';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;

// Module-level helper used by every drop-related `it(...)` body below.
// Must be defined BEFORE any `describe`/`it` so the bodies see it at parse time.
// jsdom doesn't ship DataTransfer/DragEvent constructors, so we build a minimal
// shape via Object.defineProperty — matching the project's existing pattern
// (verified at AssetSidebar.svelte.test.ts:289-292).
function makeDropEvent(files: File[]): DragEvent {
  const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
  Object.defineProperty(ev, 'dataTransfer', { value: { files } });
  return ev;
}

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

let cleanup: (() => void) | null = null;

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

describe('AssetSidebar with runAssetContext', () => {
  it('list hits /api/runs/{rid}/assets', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(AssetSidebar, {
      target,
      props: {
        assetContext: runAssetContext(42),
        onInsert: vi.fn(),
        onUploadFile: vi.fn<(file: File, batch?: { current: number; total: number }) => Promise<AssetItem | null>>(),
      },
    });
    cleanup = () => unmount(cmp);
    await settle();
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/42/assets'),
      expect.any(Object),
    );
  });

  it('imgSrc renders /api/runs/{rid}/assets/{file}', async () => {
    fetchSpy.mockImplementation(() =>
      jres([{ id: 1, filename: 'd.png', mime_type: 'image/png', file_size: 1, is_referenced: false }]),
    );
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(AssetSidebar, {
      target,
      props: {
        assetContext: runAssetContext(42),
        onInsert: vi.fn(),
        onUploadFile: vi.fn<(file: File, batch?: { current: number; total: number }) => Promise<AssetItem | null>>(),
      },
    });
    cleanup = () => unmount(cmp);
    await settle();
    const img = target.querySelector('img[src*="/api/runs/42/assets/d.png"]');
    expect(img).toBeTruthy();
  });

  it('section label says "Run assets"', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(AssetSidebar, {
      target,
      props: {
        assetContext: runAssetContext(42),
        onInsert: vi.fn(),
        onUploadFile: vi.fn<(file: File, batch?: { current: number; total: number }) => Promise<AssetItem | null>>(),
      },
    });
    cleanup = () => unmount(cmp);
    await settle();
    expect(target.textContent).toContain('Run assets');
  });

  it('sidebar drop loop breaks on first null onUploadFile result (uploadOne abort/error contract)', async () => {
    // Real uploadOne catches AbortError/errors internally and returns null
    // (verified MarkdownEditor.svelte:122-123 + the abort-branch test in
    // MarkdownEditor.run-mode.svelte.test.ts). This sidebar-isolated test only
    // verifies the break-on-null semantics in `AssetSidebar.handleDrop`. It
    // does NOT exercise the AbortController propagation itself — that lives
    // in MarkdownEditor's run-mode tests.
    const abortableUpload = vi.fn<(file: File, batch?: { current: number; total: number }) => Promise<null>>()
      .mockResolvedValue(null);
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(AssetSidebar, {
      target,
      props: {
        assetContext: runAssetContext(42),
        onInsert: vi.fn(),
        onUploadFile: abortableUpload,
      },
    });
    cleanup = () => unmount(cmp);
    await settle();
    const dropZone = target.querySelector('[data-testid="drop-zone"]') as HTMLElement;
    // Drop 2 files; with null return on first, the loop must break and not
    // call the upload a second time.
    dropZone.dispatchEvent(makeDropEvent([
      new File(['x'], 'x.png', { type: 'image/png' }),
      new File(['y'], 'y.png', { type: 'image/png' }),
    ]));
    await settle();
    expect(abortableUpload).toHaveBeenCalledTimes(1);
  });

  it('stop-on-any-invalid pre-pass: one bad file in 3-drop sets uploadError and skips ALL uploads', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const onUploadFile = vi.fn<(file: File, batch?: { current: number; total: number }) => Promise<AssetItem | null>>();
    const target = document.createElement('div');
    document.body.appendChild(target);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      assetContext: runAssetContext(42),
      onInsert: vi.fn(),
      onUploadFile,
      uploadError: null,
    });
    const cmp = mount(AssetSidebar, { target, props: propsRef });
    cleanup = () => unmount(cmp);
    await settle();
    const dropZone = target.querySelector('[data-testid="drop-zone"]') as HTMLElement;
    dropZone.dispatchEvent(
      makeDropEvent([
        new File(['ok'], 'a.png', { type: 'image/png' }),
        new File(['bad'], 'evil.exe', { type: 'application/octet-stream' }),
      ]),
    );
    await settle();
    expect(onUploadFile).not.toHaveBeenCalled();
    expect(propsRef.uploadError?.detail).toContain('extension not allowed');
  });

  it('multi-file sidebar drop: 3 valid files → onUploadFile called 3 times with batch counters, fetchAssets refetches 3 times after initial mount', async () => {
    fetchSpy.mockImplementation(() =>
      jres([{ id: 1, filename: 'a.png', mime_type: 'image/png', file_size: 1, is_referenced: false }]),
    );
    const onUploadFile = vi.fn<(file: File, batch?: { current: number; total: number }) => Promise<AssetItem | null>>()
      .mockResolvedValue({ id: 1, filename: 'a.png', mime_type: 'image/png', file_size: 1, is_referenced: false });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(AssetSidebar, {
      target,
      props: {
        assetContext: runAssetContext(42),
        onInsert: vi.fn(),
        onUploadFile,
      },
    });
    cleanup = () => unmount(cmp);
    await settle();
    fetchSpy.mockClear(); // reset after initial-mount fetch
    const dropZone = target.querySelector('[data-testid="drop-zone"]') as HTMLElement;
    const files = ['a.png', 'b.png', 'c.png'].map((n) => new File(['x'], n, { type: 'image/png' }));
    dropZone.dispatchEvent(makeDropEvent(files));
    await settle();
    expect(onUploadFile).toHaveBeenCalledTimes(3);
    expect(onUploadFile.mock.calls[0][1]).toEqual({ current: 1, total: 3 });
    expect(onUploadFile.mock.calls[1][1]).toEqual({ current: 2, total: 3 });
    expect(onUploadFile.mock.calls[2][1]).toEqual({ current: 3, total: 3 });
    // 3 GET refetches (one per success), filtered to /assets endpoint.
    const listCalls = fetchSpy.mock.calls.filter(
      (c) => String(c[0]).includes('/api/runs/42/assets') && (c[1] as RequestInit | undefined)?.method !== 'POST',
    );
    expect(listCalls.length).toBe(3);
  });
});

describe('AssetSidebar error surfaces — asset delete 409 (spec line 526)', () => {
  it('asset delete 409: surfaces backend message in sidebar error slot', async () => {
    // Mount sidebar with one asset; click delete; mock DELETE to return 409 with
    // {detail: "Asset 'X' is referenced by N mini-project(s). Use ?force=true to delete."}.
    // is_referenced is false (client thinks it's deletable) — server returns 409 modeling
    // the race where the asset becomes referenced server-side between page load and click.
    const target = document.createElement('div');
    document.body.appendChild(target);
    // Codex round-1 catch: previous version mock-matched any /assets/1, so a
    // regression to course-delete /api/assets/1 would still pass. Require the
    // exact run-mode URL.
    let deleteUrl: string | null = null;
    fetchSpy.mockImplementation((url, init) => {
      const u = String(url);
      if ((init as RequestInit | undefined)?.method === 'DELETE') {
        deleteUrl = u;
        if (u === '/api/runs/42/assets/1') {
          return jres(
            { detail: "Asset 'pic.png' is referenced by 2 mini-project(s). Use ?force=true to delete." },
            409,
          );
        }
        return jres({ detail: 'wrong url' }, 404);
      }
      return jres([{ id: 1, filename: 'pic.png', mime_type: 'image/png', file_size: 100, is_referenced: false }]);
    });
    const cmp = mount(AssetSidebar, {
      target,
      props: {
        assetContext: runAssetContext(42),
        onInsert: vi.fn(),
        onUploadFile: vi.fn<(file: File, batch?: { current: number; total: number }) => Promise<AssetItem | null>>(),
      },
    });
    cleanup = () => unmount(cmp);
    await settle();
    const row1 = target.querySelector('[data-testid="asset-row-1"]') as HTMLElement;
    (row1.querySelector('[data-testid="delete-trash"]') as HTMLButtonElement).click();
    await settle();
    (row1.querySelector('[data-testid="delete-confirm"]') as HTMLButtonElement).click();
    await settle();
    expect(deleteUrl).toBe('/api/runs/42/assets/1');
    expect(target.textContent).toContain('referenced by 2 mini-project');
  });
});
