import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SequenceAccordion from '../components/editor/SequenceAccordion.svelte';
import { DIRTY_REGISTRY_KEY } from '../lib/dirtyRegistry.svelte';
import { currentEditorVersion } from '../stores/currentEditorVersion.svelte';
import type { AdminTreeBlock, AdminTreeSequence, AdminTreeVersion } from '../lib/types';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

const version: AdminTreeVersion = {
  id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '',
  max_quiz_attempts: 1, created_at: '2026-01-01T00:00:00Z', published_at: null,
  archived_at: null, content_updated_at: '2026-01-01T00:00:00Z',
};
const seq: AdminTreeSequence = { id: 2, block_id: 3, title: 'Seq', slug: 'seq', order: 1, items: [] };
const block: AdminTreeBlock = {
  id: 3, version_id: 1, title: 'Block', slug: 'block', order: 1, info: '', info_html: '',
  sequences: [seq],
};

let cleanup: (() => void) | null = null;
beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  currentEditorVersion.value = {
    course: { id: 1, name: 'C', slug: 'c' }, version, blocks: [block],
  };
});
afterEach(() => {
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  currentEditorVersion.value = null;
});

function mountAccordion() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const ctx = new Map<symbol, unknown>([[
    DIRTY_REGISTRY_KEY,
    { register: vi.fn(), unregister: vi.fn(), isAnyDirty: () => false },
  ]]);
  const props = $state({
    courseSlug: 'c', vid: 1, block, seq, index: 1, sequenceCount: 1,
    routeBid: '3', routeSid: '2', onMoveUp: vi.fn(), onMoveDown: vi.fn(),
  });
  const cmp = mount(SequenceAccordion, { target, props, context: ctx });
  cleanup = () => unmount(cmp);
  flushSync();
  return target;
}
function openCreateAsApp(target: HTMLElement) {
  // Click "+ New item", then select the interactive_app radio.
  const newBtn = [...target.querySelectorAll('button')].find((b) => b.textContent?.includes('New item'))!;
  newBtn.click(); flushSync();
  const radio = target.querySelector('input[value="interactive_app"]') as HTMLInputElement;
  radio.click(); flushSync();
}
const createBtn = (t: HTMLElement) =>
  [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Create') as HTMLButtonElement;

it('creates an interactive_app with only title + type — no script_url, no URL field', async () => {
  fetchSpy.mockImplementation(() => jres({ id: 99 }));
  const target = mountAccordion();
  openCreateAsApp(target);
  expect(target.querySelector('input[type="url"]')).toBeNull();   // App-URL field removed
  const title = target.querySelector('input[placeholder="Title"]') as HTMLInputElement;
  title.value = 'My app'; title.dispatchEvent(new Event('input')); flushSync();
  createBtn(target).click();
  await settle();
  const post = fetchSpy.mock.calls.find(
    (c) => String(c[0]).includes('/api/sequences/2/items') && (c[1] as RequestInit)?.method === 'POST',
  )!;
  expect(post).toBeTruthy();
  const body = JSON.parse((post[1] as RequestInit).body as string);
  expect(body).toEqual({ title: 'My app', type: 'interactive_app' });   // no script_url key at all
});

it('the type picker still offers interactive_app', () => {
  const target = mountAccordion();
  const newBtn = [...target.querySelectorAll('button')].find((b) => b.textContent?.includes('New item'))!;
  newBtn.click(); flushSync();
  expect(target.querySelector('input[value="interactive_app"]')).not.toBeNull();
});
