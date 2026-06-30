import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import ItemEditPage from '../pages/editor/ItemEditPage.svelte';
import { currentEditorVersion } from '../stores/currentEditorVersion.svelte';
import * as assetsModule from '../lib/assets';
import type { AdminTreeBlock, AdminTreeItem, AdminTreeSequence, AdminTreeVersion } from '../lib/types';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); await tick(); }

function makeVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return {
    id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '',
    max_quiz_attempts: 1, created_at: '2026-01-01T00:00:00Z', published_at: null,
    archived_at: null, content_updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}
const appItem: AdminTreeItem = {
  id: 7, sequence_id: 2, title: 'App', slug: 'app', order: 1, type: 'interactive_app',
  content_md: null, content_html: null, video_url: null,
  script_url: 'https://example.com/app', questions_count: 0,
};
function buildTree(version: AdminTreeVersion, item: AdminTreeItem = appItem) {
  const seq: AdminTreeSequence = { id: 2, block_id: 3, title: 'Seq', slug: 'seq', order: 1, items: [item] };
  const block: AdminTreeBlock = {
    id: 3, version_id: version.id, title: 'Block', slug: 'block', order: 1, info: '', info_html: '',
    sequences: [seq],
  };
  return { course: { id: 1, name: 'C', slug: 'c' }, version, blocks: [block] };
}
function seedTree(version: AdminTreeVersion, item: AdminTreeItem = appItem) {
  currentEditorVersion.value = buildTree(version, item);
}

let cleanup: (() => void) | null = null;
beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(() => jres({}));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
});
afterEach(() => {
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  currentEditorVersion.value = null;
  vi.restoreAllMocks();
  vi.useRealTimers();   // defensive: the debounce test enables fake timers
});

async function mountPage() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props = $state({
    courseSlug: 'c', versionId: '1', blockId: '3', sequenceId: '2', itemId: '7',
  });
  const cmp = mount(ItemEditPage, { target, props });
  cleanup = () => unmount(cmp);
  await settle();
  return target;
}
const saveBtn = (t: HTMLElement) =>
  [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save') as HTMLButtonElement;
const urlInput = (t: HTMLElement) => t.querySelector('input[type="url"]') as HTMLInputElement;

it('renders an editable App URL form on a created version', async () => {
  seedTree(makeVersion());
  const target = await mountPage();
  expect(urlInput(target)).not.toBeNull();
});

it('disables Save when the URL is invalid and enables it when valid', async () => {
  seedTree(makeVersion());
  const target = await mountPage();
  const u = urlInput(target);
  u.value = ''; u.dispatchEvent(new Event('input')); flushSync();
  expect(saveBtn(target).disabled).toBe(true);            // safeAppUrl('') === null
  u.value = 'https://example.com/changed'; u.dispatchEvent(new Event('input')); flushSync();
  expect(saveBtn(target).disabled).toBe(false);
});

it('PATCHes script_url on save', async () => {
  seedTree(makeVersion());
  const target = await mountPage();
  const u = urlInput(target);
  u.value = 'https://example.com/changed'; u.dispatchEvent(new Event('input')); flushSync();
  // save() PATCHes, then force-refetches the admin tree. Route the GET to a
  // VALID AdminTree (containing the saved item) so the post-save re-render
  // doesn't deref `tree.version.id` on the `{}` default mock and crash settle()
  // before the assertion. The PATCH itself can return the default {}.
  fetchSpy.mockImplementation((input: RequestInfo | URL) =>
    String(input).includes('/admin-tree')
      ? jres(buildTree(makeVersion(), { ...appItem, script_url: 'https://example.com/changed' }))
      : jres({}),
  );
  saveBtn(target).click();
  await settle();
  const patch = fetchSpy.mock.calls.find(
    (c) => String(c[0]).includes('/api/items/7') && (c[1] as RequestInit)?.method === 'PATCH',
  )!;
  expect(patch).toBeTruthy();
  expect(JSON.parse((patch[1] as RequestInit).body as string)).toMatchObject({ script_url: 'https://example.com/changed' });
});

it('allows editing on a published version', async () => {
  seedTree(makeVersion({ state: 'published', published_at: '2026-02-01T00:00:00Z' }));
  const target = await mountPage();
  expect(urlInput(target)).not.toBeNull();
});

it('renders a read-only preview (not a blank box) on a disabled version', async () => {
  seedTree(makeVersion({ is_disabled: true }));
  const target = await mountPage();
  expect(urlInput(target)).toBeNull();                    // no edit form
  expect(target.querySelector('iframe')).not.toBeNull();  // read-only InteractiveFrame
});

it('shows a live preview iframe after a valid URL is typed (debounced 500ms)', async () => {
  // Covers the debounced scriptPreviewUrl $effect (a distinct code path from the
  // non-debounced readonly preview). Fake timers control the 500ms setTimeout;
  // enabled BEFORE mount so the mount-time debounce is fully controlled (afterEach
  // restores real timers). settle()'s microtask drain is unaffected by fake timers.
  vi.useFakeTimers();
  seedTree(makeVersion());
  const target = await mountPage();
  const u = urlInput(target);
  u.value = 'https://example.com/changed'; u.dispatchEvent(new Event('input')); flushSync();
  vi.advanceTimersByTime(500); flushSync();
  // jsdom page protocol is http:, so the https:// URL survives the mixed-content guard.
  expect(target.querySelector('iframe')?.getAttribute('src')).toBe('https://example.com/changed');
});

it('renders a rejected stored URL as inert text (no iframe, no link) in the read-only preview', async () => {
  // Security divergence guard: on a disabled/archived version a stored URL that
  // safeAppUrl rejects (e.g. javascript:) must render as PLAIN <code> text — never
  // an <a href> or an iframe src — so bad/malicious stored data can't become a live
  // link or be framed. This is the one spot the readonly arm deliberately does NOT
  // mirror the video path (which renders item.video_url as a link).
  seedTree(makeVersion({ is_disabled: true }), { ...appItem, script_url: 'javascript:alert(1)' });
  const target = await mountPage();
  expect(urlInput(target)).toBeNull();                       // read-only, no edit form
  expect(target.querySelector('iframe')).toBeNull();         // rejected → not framed
  const hrefs = [...target.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
  expect(hrefs.some((h) => h.includes('javascript:'))).toBe(false);   // rejected → never a live link
  const code = [...target.querySelectorAll('code')].find((c) => c.textContent === 'javascript:alert(1)');
  expect(code).toBeTruthy();                                 // shown as inert <code> text
});
