import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InteractiveAppEditor from '../components/items/InteractiveAppEditor.svelte';
import type { AdminTreeItem } from '../lib/types';
import * as assetsModule from '../lib/assets';
import * as apiModule from '../lib/api';
import * as editorStore from '../stores/currentEditorVersion.svelte';
import * as toasts from '../stores/toasts.svelte';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
function tres(text: string, status = 200) {
  return Promise.resolve({ ok: status < 400, status, statusText: 'x', text: () => Promise.resolve(text) } as unknown as Response);
}
// Includes ONE macrotask tick: Task 6's upload path reads the file via
// FileReader, and jsdom fires FileReader.onload on a MACROTASK (verified), so a
// microtask-only drain would never settle the upload. Harmless for the
// fetch-only render tests. Drain microtasks → macrotask → microtasks → flush.
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r));
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

// Poll until the test's expected outcome is observable. jsdom fires
// FileReader.onload on nested macrotasks (setImmediate) that a fixed-tick
// settle() can't reliably drain, so instead of guessing a tick count we drain
// microtasks + a macrotask each iteration until `cond` holds (bounded). This
// lives entirely in the test layer — production code stays FileReader-only.
async function waitUntil(cond: () => boolean, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    flushSync();
    if (cond()) return;
    await new Promise((r) => setTimeout(r)); // drain a macrotask (FileReader onload)
    await Promise.resolve();
  }
  flushSync();
}

const item = (over: Partial<AdminTreeItem> = {}): AdminTreeItem => ({
  id: 7, sequence_id: 2, title: 'App', slug: 'app', order: 1, type: 'interactive_app',
  content_md: null, content_html: null, video_url: null, script_url: 'app.js', questions_count: 0, ...over,
});

let cleanup: (() => void) | null = null;
beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(() => tres("getElementById('app-root')"));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => {
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  vi.restoreAllMocks();
});

function mountEditor(props: { item: AdminTreeItem; versionId: number; editable: boolean }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const sprops = $state(props);
  const cmp = mount(InteractiveAppEditor, { target, props: sprops });
  cleanup = () => unmount(cmp);
  flushSync();
  return target;
}

it('previews the stored app by fetching + inlining the source', async () => {
  const target = mountEditor({ item: item(), versionId: 1, editable: true });
  await settle();
  const f = target.querySelector('iframe');
  expect(f).not.toBeNull();
  expect(f?.getAttribute('srcdoc')).toContain("getElementById('app-root')");
});

it('shows the editable empty state when no app is attached', async () => {
  const target = mountEditor({ item: item({ script_url: null }), versionId: 1, editable: true });
  await settle();
  expect(target.querySelector('iframe')).toBeNull();
  expect(target.textContent).toContain('No app uploaded yet.');
});

it('shows the readonly empty state ("No app.") when not editable and unset', async () => {
  const target = mountEditor({ item: item({ script_url: null }), versionId: 1, editable: false });
  await settle();
  expect(target.textContent).toContain('No app.');
});

it('shows "couldn\'t be loaded" on a preview fetch failure', async () => {
  fetchSpy.mockImplementation(() => tres('', 404));
  const target = mountEditor({ item: item(), versionId: 1, editable: false });
  await settle();
  expect(target.querySelector('iframe')).toBeNull();
  expect(target.textContent).toContain("couldn't be loaded");
});

it('never renders a stored script_url as a link (readonly)', async () => {
  fetchSpy.mockImplementation(() => tres('', 404));
  const target = mountEditor({ item: item({ script_url: 'app.js' }), versionId: 1, editable: false });
  await settle();
  expect(target.querySelectorAll('a').length).toBe(0);
});

function chooseFile(target: HTMLElement, file: File) {
  const input = target.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  // MUST bubble: Svelte 5 event-delegates `onchange` (verified — a non-bubbling
  // `change` fires the handler 0 times; a bubbling one fires it once).
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

it('uploads a chosen file then PATCHes script_url and refreshes the tree', async () => {
  const upload = vi.spyOn(assetsModule, 'uploadAsset').mockResolvedValue({ id: 1, version_id: 1, filename: 'new.js', file_size: 3, mime_type: 'application/javascript', uploaded_at: '', uploaded_by: 1, is_referenced: false });
  const patch = vi.spyOn(apiModule.api, 'patch').mockResolvedValue({} as never);
  const load = vi.spyOn(editorStore, 'loadAdminTree').mockResolvedValue('ok' as never);
  vi.spyOn(toasts, 'pushToast').mockImplementation(() => {});
  const target = mountEditor({ item: item({ script_url: null }), versionId: 1, editable: true });
  await settle();
  chooseFile(target, new File(["getElementById('app-root')"], 'new.js', { type: 'application/javascript' }));
  await waitUntil(() => patch.mock.calls.length > 0 && load.mock.calls.length > 0);
  expect(upload).toHaveBeenCalledOnce();
  expect(patch).toHaveBeenCalledWith('/api/items/7', { script_url: 'new.js' });
  expect(load).toHaveBeenCalledWith(1, { force: true });
});

it('surfaces heuristic warnings for a module-ish / networky file (non-blocking)', async () => {
  const upload = vi.spyOn(assetsModule, 'uploadAsset').mockResolvedValue({ id: 1, version_id: 1, filename: 'm.js', file_size: 3, mime_type: 'application/javascript', uploaded_at: '', uploaded_by: 1, is_referenced: false });
  const patch = vi.spyOn(apiModule.api, 'patch').mockResolvedValue({} as never);
  const load = vi.spyOn(editorStore, 'loadAdminTree').mockResolvedValue('ok' as never);
  vi.spyOn(toasts, 'pushToast').mockImplementation(() => {});
  const target = mountEditor({ item: item({ script_url: null }), versionId: 1, editable: true });
  await settle();
  chooseFile(target, new File(["import x from 'y'; fetch('/z')"], 'm.js', { type: 'application/javascript' }));
  await waitUntil(() => load.mock.calls.length > 0);
  expect(target.textContent).toContain('ES module');
  expect(target.textContent).toContain('Network');
  expect(upload).toHaveBeenCalledOnce();
  expect(patch).toHaveBeenCalledWith('/api/items/7', { script_url: 'm.js' });
  expect(load).toHaveBeenCalledWith(1, { force: true });
});

it('rejects an empty file before uploading', async () => {
  const upload = vi.spyOn(assetsModule, 'uploadAsset');
  const target = mountEditor({ item: item({ script_url: null }), versionId: 1, editable: true });
  await settle();
  chooseFile(target, new File([''], 'empty.js', { type: 'application/javascript' }));
  await waitUntil(() => target.textContent!.includes('empty'));
  expect(upload).not.toHaveBeenCalled();
  expect(target.textContent).toContain('empty');
});

it('shows a clear message on a duplicate-filename 409', async () => {
  vi.spyOn(assetsModule, 'uploadAsset').mockRejectedValue(new apiModule.ApiError(409, 'dupe'));
  vi.spyOn(toasts, 'pushToast').mockImplementation(() => {});
  const target = mountEditor({ item: item({ script_url: null }), versionId: 1, editable: true });
  await settle();
  chooseFile(target, new File(["getElementById('app-root')"], 'dupe.js', { type: 'application/javascript' }));
  await waitUntil(() => target.textContent!.includes('already exists'));
  expect(target.textContent).toContain('already exists');
});

it('Remove PATCHes script_url:null and refreshes', async () => {
  const patch = vi.spyOn(apiModule.api, 'patch').mockResolvedValue({} as never);
  const load = vi.spyOn(editorStore, 'loadAdminTree').mockResolvedValue('ok' as never);
  vi.spyOn(toasts, 'pushToast').mockImplementation(() => {});
  const target = mountEditor({ item: item({ script_url: 'app.js' }), versionId: 1, editable: true });
  await settle();
  const remove = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Remove') as HTMLButtonElement;
  remove.click();
  await waitUntil(() => load.mock.calls.length > 0);
  expect(patch).toHaveBeenCalledWith('/api/items/7', { script_url: null });
  expect(load).toHaveBeenCalledWith(1, { force: true });
});

it('does not crash when item transiently becomes undefined (parent teardown window)', async () => {
  // Regression: ItemEditPage's `item` is a $derived(seq?.items.find(...)) that
  // flips through `undefined` during the create→navigate tree rebuild. The parent
  // stops rendering us, but Svelte 5 re-runs our already-mounted $effect once with
  // the changed prop BEFORE teardown — the effect must not deref a missing item.
  const target = document.createElement('div');
  document.body.appendChild(target);
  const sprops = $state<{ item: AdminTreeItem | undefined; versionId: number; editable: boolean }>(
    { item: item(), versionId: 1, editable: true },
  );
  const cmp = mount(InteractiveAppEditor, { target, props: sprops });
  cleanup = () => unmount(cmp);
  await settle();
  expect(() => { sprops.item = undefined; flushSync(); }).not.toThrow();
});

it('deletes the orphaned asset when linking (PATCH) fails after a successful upload', async () => {
  const upload = vi.spyOn(assetsModule, 'uploadAsset').mockResolvedValue({ id: 5, version_id: 1, filename: 'new.js', file_size: 3, mime_type: 'application/javascript', uploaded_at: '', uploaded_by: 1, is_referenced: false });
  vi.spyOn(apiModule.api, 'patch').mockRejectedValue(new apiModule.ApiError(500, 'boom'));
  const del = vi.spyOn(assetsModule, 'deleteAsset').mockResolvedValue(undefined as never);
  const load = vi.spyOn(editorStore, 'loadAdminTree').mockResolvedValue('ok' as never);
  vi.spyOn(toasts, 'pushToast').mockImplementation(() => {});
  const target = mountEditor({ item: item({ script_url: null }), versionId: 1, editable: true });
  await settle();
  chooseFile(target, new File(["getElementById('app-root')"], 'new.js', { type: 'application/javascript' }));
  await waitUntil(() => del.mock.calls.length > 0);
  expect(upload).toHaveBeenCalledOnce();
  expect(del).toHaveBeenCalledWith(5);       // orphan cleaned up
  expect(load).not.toHaveBeenCalled();        // link failed → no tree refresh
  expect(target.querySelector('.form-err')).not.toBeNull();  // error surfaced
});

it('does NOT delete the asset when the PATCH succeeded but the tree refresh failed', async () => {
  vi.spyOn(assetsModule, 'uploadAsset').mockResolvedValue({ id: 6, version_id: 1, filename: 'ok.js', file_size: 3, mime_type: 'application/javascript', uploaded_at: '', uploaded_by: 1, is_referenced: false });
  const patch = vi.spyOn(apiModule.api, 'patch').mockResolvedValue({} as never);
  const del = vi.spyOn(assetsModule, 'deleteAsset').mockResolvedValue(undefined as never);
  const load = vi.spyOn(editorStore, 'loadAdminTree').mockRejectedValue(new apiModule.ApiError(500, 'refresh down'));
  vi.spyOn(toasts, 'pushToast').mockImplementation(() => {});
  const target = mountEditor({ item: item({ script_url: null }), versionId: 1, editable: true });
  await settle();
  chooseFile(target, new File(["getElementById('app-root')"], 'ok.js', { type: 'application/javascript' }));
  await waitUntil(() => load.mock.calls.length > 0);
  expect(patch).toHaveBeenCalledWith('/api/items/7', { script_url: 'ok.js' });
  expect(del).not.toHaveBeenCalled();         // linked asset kept
});
