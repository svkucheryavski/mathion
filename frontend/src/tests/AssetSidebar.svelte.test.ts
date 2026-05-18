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

  it('renders [data-testid="loading-indicator"] before listAssets resolves', async () => {
    // Use a deferred promise to keep listAssets pending. The component's
    // onMount fires listAssets; the loading state is true until the promise
    // resolves.
    let resolveList: (assets: AssetResponse[]) => void = () => {};
    const pending = new Promise<AssetResponse[]>((r) => { resolveList = r; });
    vi.spyOn(assetsModule, 'listAssets').mockReturnValueOnce(pending);
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
    const clickBtn = row.querySelector<HTMLElement>('.row-click')!;
    clickBtn.click();
    expect(onInsert).toHaveBeenCalledWith('a.png', 'image/png');
  });
});

describe('AssetSidebar — empty list', () => {
  it('renders the no-assets prompt when listAssets returns []', async () => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync();
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

  it('confirm button is disabled while delete is in flight (re-entrancy guard)', async () => {
    let resolveDelete!: () => void;
    vi.spyOn(assetsModule, 'deleteAsset').mockReturnValue(
      new Promise<void>((resolve) => { resolveDelete = () => resolve(); })
    );
    vi.mocked(assetsModule.listAssets)
      .mockResolvedValueOnce([
        mkAsset({ id: 1, filename: 'a.png', is_referenced: false }),
      ])
      .mockResolvedValueOnce([]);
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const trash = target.querySelector<HTMLElement>('[data-testid="delete-trash"]')!;
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
    const deleteMock = vi.spyOn(assetsModule, 'deleteAsset')
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveDelete1 = () => r(); }))
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveDelete2 = () => r(); }));

    vi.mocked(assetsModule.listAssets)
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
    const trash1 = target.querySelector<HTMLElement>('[data-testid="asset-row-1"] [data-testid="delete-trash"]')!;
    trash1.click();
    flushSync();
    const confirm1 = target.querySelector<HTMLButtonElement>('[data-testid="asset-row-1"] [data-testid="delete-confirm"]')!;
    confirm1.click();
    flushSync();

    // While row 1 is in flight, move focus to row 2: click its trash.
    const trash2 = target.querySelector<HTMLElement>('[data-testid="asset-row-2"] [data-testid="delete-trash"]')!;
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

describe('AssetSidebar — 409 duplicate upload rename hint', () => {
  it('409 from uploadAsset surfaces the rename hint appended to the server detail', async () => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
    const { ApiError } = await import('../lib/api');
    vi.spyOn(assetsModule, 'uploadAsset').mockRejectedValueOnce(
      new ApiError(409, "Asset 'foo.png' already exists in this version"),
    );
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const picker = target.querySelector<HTMLInputElement>('[data-testid="file-picker"]')!;
    const file = new File(['x'], 'foo.png', { type: 'image/png' });
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const err = target.querySelector('[data-testid="upload-error"]');
    expect(err?.textContent).toContain("Asset 'foo.png' already exists in this version");
    expect(err?.textContent).toContain('Rename the file on disk and re-upload.');
  });

  it('non-409 errors do NOT append the rename hint', async () => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
    const { ApiError } = await import('../lib/api');
    vi.spyOn(assetsModule, 'uploadAsset').mockRejectedValueOnce(
      new ApiError(400, 'Extension not allowed'),
    );
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const picker = target.querySelector<HTMLInputElement>('[data-testid="file-picker"]')!;
    const file = new File(['x'], 'bad.exe', { type: 'application/octet-stream' });
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const err = target.querySelector('[data-testid="upload-error"]');
    expect(err?.textContent).toContain('Extension not allowed');
    expect(err?.textContent).not.toContain('Rename the file on disk and re-upload.');
  });
});

describe('AssetSidebar — long filename truncation', () => {
  it('does not truncate filenames at or below the cap', async () => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([
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
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([
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
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([
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
