import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import ItemEditPage from '../pages/editor/ItemEditPage.svelte';
import { currentEditorVersion } from '../stores/currentEditorVersion.svelte';
import * as assetsModule from '../lib/assets';
import type { AdminTreeBlock, AdminTreeItem, AdminTreeSequence, AdminTreeVersion } from '../lib/types';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
function jres(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body), headers: new Headers({ 'content-type': 'application/json' }) } as unknown as Response);
}
function tres(text: string, status = 200) {
  return Promise.resolve({ ok: status < 400, status, statusText: 'x', text: () => Promise.resolve(text) } as unknown as Response);
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); await tick(); }

function makeVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return { id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '', max_quiz_attempts: 1, created_at: '2026-01-01T00:00:00Z', published_at: null, archived_at: null, content_updated_at: '2026-01-01T00:00:00Z', ...over };
}
const appItem: AdminTreeItem = { id: 7, sequence_id: 2, title: 'App', slug: 'app', order: 1, type: 'interactive_app', content_md: null, content_html: null, video_url: null, script_url: 'app.js', questions_count: 0 };
function buildTree(version: AdminTreeVersion, item: AdminTreeItem = appItem) {
  const seq: AdminTreeSequence = { id: 2, block_id: 3, title: 'Seq', slug: 'seq', order: 1, items: [item] };
  const block: AdminTreeBlock = { id: 3, version_id: version.id, title: 'Block', slug: 'block', order: 1, info: '', info_html: '', sequences: [seq] };
  return { course: { id: 1, name: 'C', slug: 'c' }, version, blocks: [block] };
}
function seedTree(version: AdminTreeVersion, item: AdminTreeItem = appItem) {
  currentEditorVersion.value = buildTree(version, item);
}

let cleanup: (() => void) | null = null;
beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation((input: RequestInfo | URL) => (String(input).includes('/assets/') ? tres("getElementById('app-root')") : jres({})));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
});
afterEach(() => {
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  currentEditorVersion.value = null;
  vi.restoreAllMocks();
});

async function mountPage() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props = $state({ courseSlug: 'c', versionId: '1', blockId: '3', sequenceId: '2', itemId: '7' });
  const cmp = mount(ItemEditPage, { target, props });
  cleanup = () => unmount(cmp);
  await settle();
  return target;
}
const urlInput = (t: HTMLElement) => t.querySelector('input[type="url"]') as HTMLInputElement | null;

it('delegates interactive_app to the upload editor (no URL form) on a created version', async () => {
  seedTree(makeVersion());
  const target = await mountPage();
  expect(urlInput(target)).toBeNull();                    // URL editing is gone
  expect(target.querySelector('iframe')).not.toBeNull();  // fetched-source preview
  expect(target.querySelector('iframe')?.getAttribute('srcdoc')).toContain("getElementById('app-root')");
});

it('delegates on a disabled version (readonly), never a URL form; preview is gated (403)', async () => {
  seedTree(makeVersion({ is_disabled: true }));
  // A disabled version's assets are 403 for EVERYONE (serve_asset gate,
  // backend/mathion/api/assets.py:139-140) — admins included, before any
  // enrollment/role check. So the readonly editor shows the error state, not a
  // preview iframe, exactly like every other asset-backed preview on a disabled
  // version. Model that (403), don't stub success.
  fetchSpy.mockImplementation((input: RequestInfo | URL) =>
    (String(input).includes('/assets/') ? tres('Version is disabled', 403) : jres({})));
  const target = await mountPage();
  expect(urlInput(target)).toBeNull();                       // delegates — no URL form
  expect(target.querySelector('iframe')).toBeNull();         // no preview: the asset fetch is gated
  expect(target.textContent).toContain("couldn't be loaded");
});

it('shows the empty upload state when no app is attached', async () => {
  seedTree(makeVersion(), { ...appItem, script_url: null });
  const target = await mountPage();
  expect(target.textContent).toContain('No app uploaded yet.');
});
