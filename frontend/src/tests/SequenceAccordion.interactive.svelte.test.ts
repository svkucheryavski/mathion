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

it('shows the required App URL field when interactive_app is selected', () => {
  const target = mountAccordion();
  openCreateAsApp(target);
  const input = target.querySelector('input[type="url"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  expect(input.required).toBe(true);
});

it('disables Create and issues no POST while the App URL is empty/invalid', async () => {
  const target = mountAccordion();
  openCreateAsApp(target);
  const title = target.querySelector('input[placeholder="Title"]') as HTMLInputElement;
  title.value = 'My app'; title.dispatchEvent(new Event('input')); flushSync();
  expect(createBtn(target).disabled).toBe(true);   // empty URL → safeAppUrl('') === null
  createBtn(target).click();
  await settle();
  expect(fetchSpy).not.toHaveBeenCalled();

  // Non-empty but invalid (rejected by safeAppUrl via safeIframeUrl — a distinct
  // path from the empty-string guard) must ALSO disable Create and block the POST.
  const url = target.querySelector('input[type="url"]') as HTMLInputElement;
  url.value = 'javascript:alert(1)'; url.dispatchEvent(new Event('input')); flushSync();
  expect(createBtn(target).disabled).toBe(true);   // safeAppUrl('javascript:…') === null
  createBtn(target).click();
  await settle();
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('POSTs script_url when title + a valid URL are present', async () => {
  fetchSpy.mockImplementation(() => jres({ id: 99 }));
  const target = mountAccordion();
  openCreateAsApp(target);
  const title = target.querySelector('input[placeholder="Title"]') as HTMLInputElement;
  title.value = 'My app'; title.dispatchEvent(new Event('input')); flushSync();
  const url = target.querySelector('input[type="url"]') as HTMLInputElement;
  url.value = 'https://example.com/app'; url.dispatchEvent(new Event('input')); flushSync();
  createBtn(target).click();
  await settle();
  const post = fetchSpy.mock.calls.find(
    (c) => String(c[0]).includes('/api/sequences/2/items') && (c[1] as RequestInit)?.method === 'POST',
  )!;
  expect(post).toBeTruthy();
  const body = JSON.parse((post[1] as RequestInit).body as string);
  expect(body).toMatchObject({ type: 'interactive_app', title: 'My app', script_url: 'https://example.com/app' });
});

it('maps a backend 422 on script_url to an inline field error', async () => {
  fetchSpy.mockImplementation(() => jres(
    { detail: [{ loc: ['body', 'script_url'], msg: 'must be http(s)', type: 'value_error' }] }, 422,
  ));
  const target = mountAccordion();
  openCreateAsApp(target);
  const title = target.querySelector('input[placeholder="Title"]') as HTMLInputElement;
  title.value = 'My app'; title.dispatchEvent(new Event('input')); flushSync();
  const url = target.querySelector('input[type="url"]') as HTMLInputElement;
  url.value = 'https://example.com/app'; url.dispatchEvent(new Event('input')); flushSync();
  createBtn(target).click();
  await settle();
  // The 422 on script_url must map to the INLINE field error (<small class="field-err">),
  // not the global form error (<p class="form-err">). Pin that distinction: a regression
  // dropping script_url from the `known` list would route the message to .form-err and
  // this assertion pair would catch it.
  expect(target.querySelector('.field-err')?.textContent).toContain('must be http(s)');
  expect(target.querySelector('.form-err')).toBeNull();
});
