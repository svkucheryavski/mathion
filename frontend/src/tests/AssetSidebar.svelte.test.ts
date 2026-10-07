import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import AssetSidebar from '../components/editor/AssetSidebar.svelte';
import type { AssetResponse } from '../lib/assets';
import type { AssetContext, AssetItem } from '../lib/assetContext';

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

// T5a refactor: sidebar takes an AssetContext + injected onUploadFile, not a
// versionId. Each test gets a fresh stub; per-describe blocks mutate
// stubCtx.list/remove via `.mockResolvedValue(...)`.
function makeStubAssetContext(): AssetContext {
  return {
    kind: 'course',
    list: vi.fn<AssetContext['list']>().mockResolvedValue([]),
    upload: vi.fn<AssetContext['upload']>(),
    remove: vi.fn<AssetContext['remove']>().mockResolvedValue(undefined),
    imgSrc: (item: AssetItem) => `/assets/42/${item.filename}`,
    renderPreview: vi.fn<AssetContext['renderPreview']>().mockResolvedValue({ html: '<p>x</p>' }),
  };
}

let stubCtx: AssetContext;
let cleanup: (() => void) | null = null;

beforeEach(() => {
  stubCtx = makeStubAssetContext();
});

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
    assetContext: stubCtx,
    onInsert: vi.fn(),
    onUploadFile: vi.fn<(file: File, batch?: { current: number; total: number }) => Promise<AssetItem | null>>(),
    refreshKey: 0,
    cursorReady: false,
    uploading: false,
    uploadProgress: null,
    uploadError: null,
    ...overrides,
  };
  const cmp = mount(AssetSidebar, { target, props });
  cleanup = () => unmount(cmp);
  return { cmp, target, props };
}

describe('AssetSidebar — list render', () => {
  beforeEach(() => {
    (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([
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

  it('renders [data-testid="loading-indicator"] before listAssets resolves', async () => {
    // Use a deferred promise to keep listAssets pending. The component's
    // onMount fires listAssets; the loading state is true until the promise
    // resolves.
    let resolveList: (assets: AssetResponse[]) => void = () => {};
    const pending = new Promise<AssetResponse[]>((r) => { resolveList = r; });
    (stubCtx.list as ReturnType<typeof vi.fn>).mockReturnValueOnce(pending);
    const { target } = mountSidebar();
    flushSync();
    expect(target.querySelector('[data-testid="loading-indicator"]')).toBeTruthy();
    // Resolve the mock so afterEach cleanup doesn't hang on an unresolved fetch
    resolveList([]);
    await Promise.resolve(); flushSync();
    await Promise.resolve(); flushSync();
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
    (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
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
    (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      mkAsset({ id: 1, filename: 'a.png', mime_type: 'image/png' }),
    ]);
  });

  it('clicking a row calls onInsert with server filename and mime_type', async () => {
    const onInsert = vi.fn();
    const { target } = mountSidebar({ onInsert });
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const row = target.querySelector<HTMLElement>('[data-testid="asset-row-1"]')!;
    const clickBtn = row.querySelector<HTMLElement>('.row-click')!;
    clickBtn.click();
    // Sidebar now emits a formatted ref snippet (formatRef applies the
    // image-vs-link template + leading/trailing newlines).
    expect(onInsert).toHaveBeenCalledWith('\n![a](a.png)\n');
  });
});

describe('AssetSidebar — empty list', () => {
  it('renders the no-assets prompt when listAssets returns []', async () => {
    (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync();
    await Promise.resolve(); flushSync();
    expect(target.textContent).toContain('No assets yet');
  });
});

describe('AssetSidebar — refreshKey triggers re-fetch', () => {
  it('changing refreshKey re-invokes listAssets', async () => {
    const spy = (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const target = document.createElement('div');
    document.body.appendChild(target);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      assetContext: stubCtx,
      onInsert: vi.fn(),
      onUploadFile: vi.fn(),
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

  it('changing assetContext refetches against the new context (covers same-page version swap)', async () => {
    // Codex T5a finding: the item editor derives its asset context from `vid`.
    // If the router swaps `versionId` without remounting (same-page navigation
    // between two items of different versions), the sidebar must refetch
    // against the new context — otherwise it shows the old version's assets.
    const ctxA = makeStubAssetContext();
    const ctxB = makeStubAssetContext();
    (ctxA.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      mkAsset({ id: 1, filename: 'a-only.png' }),
    ]);
    (ctxB.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      mkAsset({ id: 2, filename: 'b-only.png' }),
    ]);
    const target = document.createElement('div');
    document.body.appendChild(target);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      assetContext: ctxA,
      onInsert: vi.fn(),
      onUploadFile: vi.fn(),
      refreshKey: 0,
      cursorReady: false,
      uploading: false,
      uploadProgress: null,
      uploadError: null,
    });
    const cmp = mount(AssetSidebar, { target, props: propsRef });
    cleanup = () => unmount(cmp);
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    expect((ctxA.list as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(target.querySelector('[data-testid="asset-row-1"]')).toBeTruthy();
    propsRef.assetContext = ctxB;
    flushSync();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    expect((ctxB.list as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(target.querySelector('[data-testid="asset-row-2"]')).toBeTruthy();
    expect(target.querySelector('[data-testid="asset-row-1"]')).toBeNull();
  });
});

describe('AssetSidebar — uploadProgress + uploadError rendering', () => {
  beforeEach(() => {
    (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
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
      assetContext: stubCtx,
      onInsert: vi.fn(),
      onUploadFile: vi.fn(),
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
    const dismiss = target.querySelector<HTMLElement>('[data-testid="upload-error-dismiss"] button')!;
    dismiss.click();
    flushSync();
    expect(propsRef.uploadError).toBe(null);
  });
});

describe('AssetSidebar — drop on sidebar', () => {
  beforeEach(() => {
    (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('drop on the drop zone calls stopPropagation synchronously and invokes onUploadFile', async () => {
    const onUploadFile = vi.fn().mockResolvedValue(mkAsset({ filename: 'dropped.png' }));
    const { target } = mountSidebar({ onUploadFile });
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
    expect(onUploadFile).toHaveBeenCalledWith(expect.any(File), { current: 1, total: 1 });
  });

  it('drop on the root <aside> outside the drop zone also uploads (root-level handler)', async () => {
    const onUploadFile = vi.fn().mockResolvedValue(mkAsset({ filename: 'rooted.png' }));
    const { target } = mountSidebar({ onUploadFile });
    await Promise.resolve(); flushSync();
    const aside = target.querySelector<HTMLElement>('aside[data-testid="asset-sidebar"]')!;
    const stopSpy = vi.fn();
    const preventSpy = vi.fn();
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [new File(['x'], 'rooted.png', { type: 'image/png' })] },
    });
    dropEvent.stopPropagation = stopSpy;
    dropEvent.preventDefault = preventSpy;
    aside.dispatchEvent(dropEvent);
    expect(preventSpy).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
    await Promise.resolve(); flushSync();
    await Promise.resolve(); flushSync();
    expect(onUploadFile).toHaveBeenCalledWith(expect.any(File), { current: 1, total: 1 });
  });
});

describe('AssetSidebar — file picker', () => {
  it('selecting a file via the picker invokes onUploadFile', async () => {
    (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const onUploadFile = vi.fn().mockResolvedValue(mkAsset({ filename: 'picked.png' }));
    const { target } = mountSidebar({ onUploadFile });
    await Promise.resolve(); flushSync();
    const input = target.querySelector<HTMLInputElement>('[data-testid="file-picker"]')!;
    const file = new File(['x'], 'picked.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve(); flushSync();
    await Promise.resolve(); flushSync();
    expect(onUploadFile).toHaveBeenCalledWith(file, { current: 1, total: 1 });
  });
});

describe('AssetSidebar — delete UI', () => {
  beforeEach(() => {
    (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      mkAsset({ id: 1, filename: 'a.png', is_referenced: false }),
      mkAsset({ id: 2, filename: 'b.pdf', is_referenced: true }),
    ]);
  });

  it('a referenced row shows `used` and a disabled trash with the in-use reason (R2)', async () => {
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const t1 = target.querySelector<HTMLButtonElement>('[data-testid="asset-row-1"] [data-testid="delete-trash"] button')!;
    const t2 = target.querySelector<HTMLButtonElement>('[data-testid="asset-row-2"] [data-testid="delete-trash"] button')!;
    expect(t1.disabled).toBe(false);
    expect(t1.title).toBe('Remove asset');
    expect(t2.disabled).toBe(true);
    expect(t2.title).toBe('Remove asset — still referenced in this version');
    expect(target.querySelector('[data-testid="asset-row-2"] [data-testid="used-badge"]')!.textContent).toBe('used');
  });

  it('trash → confirm → deleteAsset called and list refreshes', async () => {
    const deleteSpy = (stubCtx.remove as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (stubCtx.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        mkAsset({ id: 1, filename: 'a.png', is_referenced: false }),
        mkAsset({ id: 2, filename: 'b.pdf', is_referenced: true }),
      ])
      .mockResolvedValueOnce([mkAsset({ id: 2, filename: 'b.pdf', is_referenced: true })]);
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const trash = target.querySelector<HTMLElement>('[data-testid="delete-trash"] button')!;
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
    (stubCtx.remove as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(404, 'Asset not found'));
    (stubCtx.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        mkAsset({ id: 1, filename: 'a.png', is_referenced: false }),
        mkAsset({ id: 2, filename: 'b.pdf', is_referenced: true }),
      ])
      .mockResolvedValueOnce([mkAsset({ id: 2, filename: 'b.pdf', is_referenced: true })]);
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const trash = target.querySelector<HTMLElement>('[data-testid="delete-trash"] button')!;
    trash.click();
    flushSync();
    const confirm = target.querySelector<HTMLElement>('[data-testid="delete-confirm"]')!;
    confirm.click();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const err = target.querySelector('[data-testid="delete-error"]');
    expect(err?.textContent).toContain('Asset not found');
    expect(target.querySelector('[data-testid="asset-row-1"]')).toBeNull();
  });

  it('confirm button is disabled while delete is in flight (re-entrancy guard)', async () => {
    let resolveDelete!: () => void;
    (stubCtx.remove as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<void>((resolve) => { resolveDelete = () => resolve(); })
    );
    (stubCtx.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        mkAsset({ id: 1, filename: 'a.png', is_referenced: false }),
      ])
      .mockResolvedValueOnce([]);
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const trash = target.querySelector<HTMLElement>('[data-testid="delete-trash"] button')!;
    trash.click();
    flushSync();
    const confirm = target.querySelector<HTMLButtonElement>('[data-testid="delete-confirm"]')!;
    confirm.click();
    flushSync();
    expect(confirm.disabled).toBe(true);
    resolveDelete();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
  });

  it('cross-row delete race: row1 completion does not clear row2 confirm pair', async () => {
    // Two deferred delete promises so we control ordering precisely.
    let resolveDelete1!: () => void;
    let resolveDelete2!: () => void;
    const deleteMock = (stubCtx.remove as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveDelete1 = () => r(); }))
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveDelete2 = () => r(); }));

    (stubCtx.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        mkAsset({ id: 1, filename: 'a.png', is_referenced: false }),
        mkAsset({ id: 2, filename: 'b.png', is_referenced: false }),
      ])
      // After row1 delete resolves, list still has row2.
      .mockResolvedValueOnce([mkAsset({ id: 2, filename: 'b.png', is_referenced: false })])
      // After row2 delete resolves, list is empty.
      .mockResolvedValueOnce([]);

    const { target } = mountSidebar();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();

    // Start delete on row 1.
    const trash1 = target.querySelector<HTMLElement>('[data-testid="asset-row-1"] [data-testid="delete-trash"] button')!;
    trash1.click();
    flushSync();
    const confirm1 = target.querySelector<HTMLButtonElement>('[data-testid="asset-row-1"] [data-testid="delete-confirm"]')!;
    confirm1.click();
    flushSync();

    // While row 1 is in flight, move focus to row 2: click its trash.
    const trash2 = target.querySelector<HTMLElement>('[data-testid="asset-row-2"] [data-testid="delete-trash"] button')!;
    trash2.click();
    flushSync();

    // Row 2's confirm pair should now be visible.
    const confirm2 = target.querySelector<HTMLButtonElement>('[data-testid="asset-row-2"] [data-testid="delete-confirm"]')!;
    expect(confirm2).toBeTruthy();
    expect(confirm2.disabled).toBe(false);

    // Confirm row 2 (now both deletes are in flight).
    confirm2.click();
    flushSync();
    expect(confirm2.disabled).toBe(true);

    // Row 1 resolves first. Its finally must NOT clear row 2's UI.
    resolveDelete1();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();

    // Row 2's confirm pair must still be present and STILL DISABLED (row 2 delete still in flight).
    const confirm2After = target.querySelector<HTMLButtonElement>('[data-testid="asset-row-2"] [data-testid="delete-confirm"]')!;
    expect(confirm2After).toBeTruthy();
    expect(confirm2After.disabled).toBe(true);

    // Now resolve row 2 to clean up.
    resolveDelete2();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();

    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(deleteMock).toHaveBeenNthCalledWith(1, 1);
    expect(deleteMock).toHaveBeenNthCalledWith(2, 2);
  });
});

// 409 rename-hint coverage moved to MarkdownEditor.svelte.test.ts (the new
// uploadOne helper now owns the rename-hint append). Sidebar receives the
// error string via $bindable uploadError; its rendering of that state is
// already covered by the "renders Upload stopped at file N of M" tests above.

describe('AssetSidebar — long filename truncation', () => {
  it('does not truncate filenames at or below the cap', async () => {
    (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      mkAsset({ id: 1, filename: 'short.pdf' }),
    ]);
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const name = target.querySelector('[data-testid="asset-row-1"] .name')!;
    expect(name.textContent).toBe('short.pdf');
    expect(name.getAttribute('title')).toBe('short.pdf');
  });

  it('truncates long filenames with middle ellipsis and preserves the extension', async () => {
    const full = 'Presentation 2 (corrected version of the lecture slides).pdf';
    (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      mkAsset({ id: 1, filename: full }),
    ]);
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const name = target.querySelector('[data-testid="asset-row-1"] .name')!;
    // MAX=24, stem='Presentation 2 (corrected version of the lecture slides)',
    // ext='.pdf' (4). reserve=8. prefixLen=16.
    // result = stem.slice(0,16) + '...' + stem.slice(-1) + '.pdf'
    //        = 'Presentation 2 (' + '...' + ')' + '.pdf'
    //        = 'Presentation 2 (...).pdf'  (24 chars)
    expect(name.textContent).toBe('Presentation 2 (...).pdf');
    expect(name.getAttribute('title')).toBe(full);
  });

  it('falls back to end truncation for filenames without an extension', async () => {
    const full = 'this-is-a-name-without-any-extension';  // 36 chars, no dot
    (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      mkAsset({ id: 1, filename: full }),
    ]);
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const name = target.querySelector('[data-testid="asset-row-1"] .name')!;
    // MAX=24, no dot → filename.slice(0, 21) + '...'.
    expect(name.textContent).toBe('this-is-a-name-withou...');
    expect(name.getAttribute('title')).toBe(full);
  });
});

describe('AssetSidebar — Slice-5b restyle', () => {
  beforeEach(() => {
    (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([mkAsset({ id: 1, filename: 'a.png' })]);
  });
  const settleList = async () => { await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync(); };

  it('the cursor hint is the D11 hint paragraph', async () => {
    const { target } = mountSidebar({ cursorReady: false });
    await settleList();
    const hint = target.querySelector('[data-testid="cursor-banner"]')!;
    expect(hint.tagName).toBe('P');
    expect(hint.classList.contains('hint')).toBe(true);
  });

  it('opening the inline confirm focuses Cancel; Escape cancels it, is default-prevented and refocuses the trash', async () => {
    const { target } = mountSidebar();
    await settleList();
    target.querySelector<HTMLButtonElement>('[data-testid="delete-trash"] button')!.click();
    await Promise.resolve(); flushSync(); await Promise.resolve();
    const cancel = target.querySelector<HTMLButtonElement>('[data-testid="delete-cancel"]')!;
    expect(document.activeElement).toBe(cancel);
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    cancel.dispatchEvent(ev);
    await Promise.resolve(); flushSync(); await Promise.resolve();
    expect(ev.defaultPrevented).toBe(true);
    expect(target.querySelector('[data-testid="delete-confirm"]')).toBeNull();
    expect(document.activeElement).toBe(target.querySelector('[data-testid="delete-trash"] button'));
  });

  it('renders no emoji or text glyph controls', async () => {
    const { target } = mountSidebar({ uploadError: { detail: 'Boom' } });
    await settleList();
    expect(target.textContent).not.toMatch(/[\u{1F5D1}×]/u);
    expect(target.querySelector('[data-testid="delete-trash"] button svg')).not.toBeNull();
    expect(target.querySelector('[data-testid="upload-error-dismiss"] button svg')).not.toBeNull();
  });
});

// ---- Slice-5b T2 review (lane-2 I2): closing the confirm through Confirm
// never drops focus to <body>.
describe('AssetSidebar — focus after a confirmed delete (R7)', () => {
  const settleAll = async () => {
    for (let i = 0; i < 4; i++) { await Promise.resolve(); flushSync(); }
  };
  const confirmRow = async (target: HTMLElement, id: number) => {
    target.querySelector<HTMLButtonElement>(`[data-testid="asset-row-${id}"] [data-testid="delete-trash"] button`)!.click();
    await settleAll();
    target.querySelector<HTMLButtonElement>('[data-testid="delete-confirm"]')!.click();
    await settleAll();
  };

  it('a failed delete gives focus back to the same row\'s trash', async () => {
    (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([mkAsset({ id: 1, filename: 'a.png' })]);
    (stubCtx.remove as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const { target } = mountSidebar();
    await settleAll();
    await confirmRow(target, 1);
    expect(target.querySelector('[data-testid="delete-error"]')).not.toBeNull();
    expect(document.activeElement).toBe(
      target.querySelector('[data-testid="asset-row-1"] [data-testid="delete-trash"] button'));
  });

  it('a successful delete moves focus to the next row\'s trash', async () => {
    (stubCtx.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([mkAsset({ id: 1, filename: 'a.png' }), mkAsset({ id: 2, filename: 'b.png' })])
      .mockResolvedValue([mkAsset({ id: 2, filename: 'b.png' })]);
    const { target } = mountSidebar();
    await settleAll();
    await confirmRow(target, 1);
    expect(document.activeElement).toBe(
      target.querySelector('[data-testid="asset-row-2"] [data-testid="delete-trash"] button'));
  });

  it('deleting the last asset moves focus to the drop zone', async () => {
    (stubCtx.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([mkAsset({ id: 1, filename: 'a.png' })])
      .mockResolvedValue([]);
    const { target } = mountSidebar();
    await settleAll();
    await confirmRow(target, 1);
    expect(document.activeElement).toBe(target.querySelector('[data-testid="drop-zone"]'));
  });
});
