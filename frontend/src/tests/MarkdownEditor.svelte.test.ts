import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import MarkdownEditor from '../components/editor/MarkdownEditor.svelte';
import * as assetsModule from '../lib/assets';
import type { AssetResponse } from '../lib/assets';
import { ApiError } from '../lib/api';

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
    const clickBtn = row.querySelector<HTMLElement>('.row-click')!;
    clickBtn.click();
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
    const clickBtn = row.querySelector<HTMLElement>('.row-click')!;
    clickBtn.click();
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
    const clickBtn = row.querySelector<HTMLElement>('.row-click')!;
    clickBtn.click();
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
    const { target, propsRef } = mountEditor({ value: 'abc', refreshKey: 0 });
    await Promise.resolve(); flushSync();
    const ta = target.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.focus();
    ta.setSelectionRange(1, 1);
    ta.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    flushSync();
    const stopSpy = vi.fn();
    const preventSpy = vi.fn();
    const file = new File(['x'], 'dropped.png', { type: 'image/png' });
    const ev = makeDropEvent([file], ta, { stopSpy, preventSpy });
    ta.dispatchEvent(ev);
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

  it('textarea drop does not bubble to .edit-content (stopPropagation is effective)', async () => {
    vi.spyOn(assetsModule, 'uploadAsset').mockResolvedValue(
      mkAsset({ filename: 'bubble.png', mime_type: 'image/png' }),
    );
    const { target } = mountEditor({ value: 'x' });
    await Promise.resolve(); flushSync();
    const wrapper = target.querySelector<HTMLElement>('.edit-content')!;
    const ta = target.querySelector<HTMLTextAreaElement>('textarea')!;
    const wrapperDropListener = vi.fn();
    wrapper.addEventListener('drop', wrapperDropListener);
    const file = new File(['x'], 'bubble.png', { type: 'image/png' });
    // Real Event with native stopPropagation (not a spy).
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
    ta.dispatchEvent(ev);
    expect(wrapperDropListener).not.toHaveBeenCalled();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    wrapper.removeEventListener('drop', wrapperDropListener);
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
    expect(propsRef.value).toBe('abc');
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
    const ev2 = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev2, 'dataTransfer', { value: { files: [f2] } });
    const ev2Prevent = vi.fn();
    const ev2Stop = vi.fn();
    ev2.preventDefault = ev2Prevent;
    ev2.stopPropagation = ev2Stop;
    ta.dispatchEvent(ev2);
    flushSync();
    expect(ev2Prevent).toHaveBeenCalled();
    expect(ev2Stop).toHaveBeenCalled();
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
    const err = target.querySelector('[data-testid="upload-error"]');
    expect(err?.textContent).toContain('Upload stopped at file 3 of 4');
    expect(err?.textContent).toContain('File size 999 exceeds max 100');
  });
});

describe('MarkdownEditor — 409 duplicate upload rename hint', () => {
  it('409 from uploadAsset in textarea drop surfaces the rename hint appended to the server detail', async () => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
    vi.spyOn(assetsModule, 'uploadAsset').mockRejectedValueOnce(
      new ApiError(409, "Asset 'foo.png' already exists in this version"),
    );
    const { target } = mountEditor({ value: 'abc' });
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const ta = target.querySelector<HTMLTextAreaElement>('textarea')!;
    const file = new File(['x'], 'foo.png', { type: 'image/png' });
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
    ev.preventDefault = vi.fn(); ev.stopPropagation = vi.fn();
    ta.dispatchEvent(ev);
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const err = target.querySelector('[data-testid="upload-error"]');
    expect(err?.textContent).toContain("Asset 'foo.png' already exists in this version");
    expect(err?.textContent).toContain('Rename the file on disk and re-upload.');
  });

  it('non-409 errors do NOT append the rename hint', async () => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
    vi.spyOn(assetsModule, 'uploadAsset').mockRejectedValueOnce(
      new ApiError(400, 'Extension not allowed'),
    );
    const { target } = mountEditor({ value: 'abc' });
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const ta = target.querySelector<HTMLTextAreaElement>('textarea')!;
    const file = new File(['x'], 'bad.exe', { type: 'application/octet-stream' });
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
    ev.preventDefault = vi.fn(); ev.stopPropagation = vi.fn();
    ta.dispatchEvent(ev);
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const err = target.querySelector('[data-testid="upload-error"]');
    expect(err?.textContent).toContain('Extension not allowed');
    expect(err?.textContent).not.toContain('Rename the file on disk and re-upload.');
  });
});

describe('MarkdownEditor — sidebar drop suppression', () => {
  it('drop on sidebar drop-zone does NOT bubble to .edit-content wrapper handler', async () => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
    vi.spyOn(assetsModule, 'uploadAsset').mockResolvedValue(
      mkAsset({ filename: 'side.png', mime_type: 'image/png' }),
    );
    const { target } = mountEditor({ value: 'x' });
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const wrapper = target.querySelector<HTMLElement>('.edit-content')!;
    const dropZone = target.querySelector<HTMLElement>('[data-testid="drop-zone"]')!;
    const wrapperDropListener = vi.fn();
    wrapper.addEventListener('drop', wrapperDropListener);
    const file = new File(['x'], 'side.png', { type: 'image/png' });
    // Real Event with native stopPropagation (no override).
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
    dropZone.dispatchEvent(ev);
    expect(wrapperDropListener).not.toHaveBeenCalled();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    wrapper.removeEventListener('drop', wrapperDropListener);
  });
});

describe('MarkdownEditor — shared uploadProgress visible in sidebar', () => {
  it('uploadProgress written by textarea drop renders in AssetSidebar progress row', async () => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
    let resolveFirst: (a: AssetResponse) => void = () => {};
    const firstPending = new Promise<AssetResponse>((r) => { resolveFirst = r; });
    vi.spyOn(assetsModule, 'uploadAsset')
      .mockReturnValueOnce(firstPending)
      .mockResolvedValueOnce(mkAsset({ filename: 'progress2.png' }));
    const { target } = mountEditor({ value: 'abc' });
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const ta = target.querySelector<HTMLTextAreaElement>('textarea')!;
    const files = [
      new File(['x'], 'progress.png', { type: 'image/png' }),
      new File(['y'], 'progress2.png', { type: 'image/png' }),
    ];
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { files } });
    ev.preventDefault = vi.fn(); ev.stopPropagation = vi.fn();
    ta.dispatchEvent(ev);
    // Drain the synchronous part of runMarkdownEditorUpload, but the await
    // on uploadAsset for the first file is still pending.
    await Promise.resolve(); flushSync();
    // Sidebar should now render the in-flight progress row with current=1, total=2.
    const progress = target.querySelector('[data-testid="upload-progress"]');
    expect(progress).toBeTruthy();
    expect(progress?.textContent).toContain('progress.png');
    expect(progress?.textContent).toContain('1');  // current
    expect(progress?.textContent).toContain('2');  // total
    // Cleanup: resolve first upload and drain.
    resolveFirst(mkAsset({ filename: 'progress.png' }));
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
  });
});

describe('MarkdownEditor — Edit→Preview mid-upload race', () => {
  it('switching to Preview while upload is in flight does not crash; refreshKey still bumps on success', async () => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
    let resolveUpload: (a: AssetResponse) => void = () => {};
    const pending = new Promise<AssetResponse>((r) => { resolveUpload = r; });
    vi.spyOn(assetsModule, 'uploadAsset').mockReturnValueOnce(pending);
    const { target, propsRef } = mountEditor({ value: 'abc', refreshKey: 0 });
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const ta = target.querySelector<HTMLTextAreaElement>('textarea')!;
    const file = new File(['x'], 'race.png', { type: 'image/png' });
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
    ev.preventDefault = vi.fn(); ev.stopPropagation = vi.fn();
    ta.dispatchEvent(ev);
    await Promise.resolve(); flushSync();
    // Switch to Preview while the upload is pending. This unmounts the
    // textarea (and the sidebar) — textareaEl becomes null. The next
    // resolve must not crash on insertAtCursor.
    const previewBtn = Array.from(target.querySelectorAll<HTMLElement>('button')).find(
      (b) => b.textContent === 'Preview',
    )!;
    previewBtn.click();
    flushSync();
    // Resolve the upload. Inside onEachSuccess, insertAtCursor is called
    // with textareaEl null — the guard returns silently, refreshKey++ still
    // executes on the line after onEachSuccess.
    resolveUpload(mkAsset({ filename: 'race.png' }));
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    // Should not have crashed (we got here), and refreshKey was bumped.
    expect(propsRef.refreshKey).toBe(1);
  });
});

describe('MarkdownEditor — window-level file-drop navigation guard', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
  });

  it('window-level file drop has preventDefault called while editor is mounted', async () => {
    mountEditor();
    await Promise.resolve(); flushSync();
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: [] } });
    const preventSpy = vi.fn();
    ev.preventDefault = preventSpy;
    window.dispatchEvent(ev);
    expect(preventSpy).toHaveBeenCalled();
  });

  it('window-level dragover with files has preventDefault called while editor is mounted', async () => {
    mountEditor();
    await Promise.resolve(); flushSync();
    const ev = new Event('dragover', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: [] } });
    const preventSpy = vi.fn();
    ev.preventDefault = preventSpy;
    window.dispatchEvent(ev);
    expect(preventSpy).toHaveBeenCalled();
  });

  it('non-file drags pass through (no preventDefault) — guard does not block URL or text drags', async () => {
    mountEditor();
    await Promise.resolve(); flushSync();
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['text/uri-list'], files: [] } });
    const preventSpy = vi.fn();
    ev.preventDefault = preventSpy;
    window.dispatchEvent(ev);
    expect(preventSpy).not.toHaveBeenCalled();
  });

  it('guard is removed when editor unmounts (no leak across pages)', async () => {
    const { cmp } = mountEditor();
    await Promise.resolve(); flushSync();
    unmount(cmp);
    cleanup = null; // prevent afterEach from unmounting again
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: [] } });
    const preventSpy = vi.fn();
    ev.preventDefault = preventSpy;
    window.dispatchEvent(ev);
    expect(preventSpy).not.toHaveBeenCalled();
  });
});
