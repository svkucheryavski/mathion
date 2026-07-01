import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InteractiveAppEditor from '../components/items/InteractiveAppEditor.svelte';
import type { AdminTreeItem } from '../lib/types';

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
