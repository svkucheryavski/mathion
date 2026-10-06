import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import BlockAccordion from '../components/editor/BlockAccordion.svelte';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../lib/dirtyRegistry.svelte';
import { currentEditorVersion } from '../stores/currentEditorVersion.svelte';
import { navigate, currentRoute, matchRoute, registerNavigationGuard, __resetGuardsForTests } from '../lib/router.svelte';
import { routes } from '../routes';
import { toasts, clearToasts } from '../stores/toasts.svelte';
import type { AdminTree, AdminTreeBlock, AdminTreeSequence, AdminTreeVersion } from '../lib/types';

// Real router + store; fetch stubbed. Route-derived props are getters over
// currentRoute, as App.svelte supplies them, so `expanded` follows navigate().
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

function mkVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return {
    id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '',
    max_quiz_attempts: 1, label: '', created_at: '2026-01-01T00:00:00Z', published_at: null,
    archived_at: null, content_updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}
function mkBlock(over: Partial<AdminTreeBlock> = {}): AdminTreeBlock {
  return { id: 3, version_id: 1, title: 'Vectors', slug: 'vectors', order: 1, info: '', info_html: '', sequences: [], ...over };
}

// The admin-tree GET serves `served`; each fetch records the route path at that
// moment, so a test can assert navigate-before-reload ordering.
let served: AdminTree;
let treeFetchPaths: string[];
function serve(extra: (url: string, init?: RequestInit) => Promise<Response> | undefined = () => undefined) {
  fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
    const custom = extra(String(url), init);
    if (custom) return custom;
    if (String(url).endsWith('/admin-tree')) {
      treeFetchPaths.push(currentRoute.path);
      return jres(structuredClone(served));
    }
    return jres({});
  });
}
function deferredDelete(path: string) {
  const d = { release: () => {} };
  serve((url, init) => (url === path && init?.method === 'DELETE'
    ? new Promise<void>((r) => { d.release = r; }).then(() => jres({}))
    : undefined));
  return d;
}
function mkSeq(id: number, over: Partial<AdminTreeSequence> = {}): AdminTreeSequence {
  return { id, block_id: 3, title: `S ${id}`, slug: `s${id}`, order: id, items: [], ...over };
}

let target: HTMLDivElement;
let registry: DirtyRegistry;
let cleanup: (() => void) | null = null;

beforeEach(async () => {
  __resetGuardsForTests();
  await navigate('/courses/c/edit/v/1', { force: true });
  fetchSpy.mockReset();
  treeFetchPaths = [];
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  currentEditorVersion.value = { course: { id: 1, name: 'C', slug: 'c' }, version: mkVersion(), blocks: [mkBlock()] };
  served = { course: { id: 1, name: 'C', slug: 'c' }, version: mkVersion(), blocks: [] };
  serve();
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  cleanup?.(); cleanup = null;
  target.remove();
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  currentEditorVersion.value = null;
  __resetGuardsForTests();
  vi.restoreAllMocks();
});

// A function call does not narrow `cleanup`, unlike an inline reset.
function teardown() { cleanup?.(); cleanup = null; }

const param = (k: string) => matchRoute(routes, currentRoute.path)?.params[k] ?? null;

function mountBlock(block: AdminTreeBlock = mkBlock(), over: { index?: number; blockCount?: number } = {}) {
  registry = createDirtyRegistry();
  const cmp = mount(BlockAccordion, {
    target,
    context: new Map([[DIRTY_REGISTRY_KEY, registry]]),
    props: {
      courseSlug: 'c', vid: 1, block, index: over.index ?? 1, blockCount: over.blockCount ?? 2,
      get routeBid() { return param('blockId'); },
      get routeSid() { return param('sequenceId'); },
      onMoveUp: vi.fn(), onMoveDown: vi.fn(),
    },
  });
  cleanup = () => unmount(cmp);
  flushSync();
}

const field = (label: string) =>
  [...target.querySelectorAll<HTMLElement>('#block-3-panel .inline-field')].find((f) => f.querySelector('.label')?.textContent === label)!;
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
// Open the block-title InlineField and leave a changed draft in it.
async function dirtyBlockTitle() {
  field('Block title').querySelector<HTMLButtonElement>('button[aria-label="Edit the block title"]')!.click();
  await settle();
  type(field('Block title').querySelector('input')!, 'Changed');
}

const plus = () => target.querySelector<HTMLButtonElement>('button[aria-label="New sequence in Vectors"]')!;
const createTitle = () => target.querySelector<HTMLInputElement>('input[placeholder="Title"]');

describe('BlockAccordion — header (T5a)', () => {
  it('the header is an <h3> toggle with the B{index} badge and the slug', () => {
    mountBlock(mkBlock(), { index: 2, blockCount: 3 });
    const toggle = target.querySelector<HTMLButtonElement>('#block-3-header')!;
    expect(toggle.parentElement!.tagName).toBe('H3');
    expect(toggle.querySelector('.code')!.textContent).toBe('B2');
    expect(toggle.querySelector('.slug')!.textContent).toBe('/vectors');
  });

  it('arrows always render: boundary titles on an editable version', () => {
    mountBlock(mkBlock(), { index: 1, blockCount: 1 });
    const up = target.querySelector<HTMLButtonElement>('[aria-label="Move block up: Vectors"]')!;
    const down = target.querySelector<HTMLButtonElement>('[aria-label="Move block down: Vectors"]')!;
    expect(up.disabled).toBe(true);
    expect(up.title).toBe('Move up — already first');
    expect(down.disabled).toBe(true);
    expect(down.title).toBe('Move down — already last');
  });

  it('a published version keeps the arrows and the + with the structure reason', () => {
    currentEditorVersion.value!.version = mkVersion({ state: 'published' });
    mountBlock(mkBlock(), { index: 2, blockCount: 3 });
    const reason = 'Only a created version can change its structure';
    const up = target.querySelector<HTMLButtonElement>('[aria-label="Move block up: Vectors"]')!;
    expect(up.disabled).toBe(true);
    expect(up.title).toBe(reason);
    expect(plus().disabled).toBe(true);
    expect(plus().title).toBe(reason);
  });

  it('the old in-body "+ New sequence" button is gone', async () => {
    await navigate('/courses/c/edit/v/1/blocks/3', { force: true });
    mountBlock();
    await settle();
    expect([...target.querySelectorAll('button')].some((b) => b.textContent?.includes('New sequence'))).toBe(false);
    expect(target.querySelector('#block-3-panel h3')).toBeNull();
  });

  it('+ on an expanded block toggles the create form and focuses Title', async () => {
    await navigate('/courses/c/edit/v/1/blocks/3', { force: true });
    mountBlock();
    await settle();
    expect(plus().title).toBe('New sequence');
    expect(plus().getAttribute('aria-expanded')).toBe('false');
    plus().click();
    await settle();
    expect(document.activeElement).toBe(createTitle());
    expect(plus().dataset.glyph).toBe('close');
    expect(plus().title).toBe('Cancel new sequence');
    expect(plus().getAttribute('aria-expanded')).toBe('true');
    plus().click();
    await settle();
    expect(createTitle()).toBeNull();
  });

  it('+ on a collapsed block expands it, then opens the form with Title focused', async () => {
    mountBlock();
    expect(createTitle()).toBeNull();
    plus().click();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3');
    expect(document.activeElement).toBe(createTitle());
    expect(plus().getAttribute('aria-expanded')).toBe('true');
  });

  it('+ on a collapsed block with a cancelled guard prompt changes nothing', async () => {
    registerNavigationGuard(() => false);
    mountBlock();
    plus().click();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    expect(createTitle()).toBeNull();
    expect(plus().getAttribute('aria-expanded')).toBe('false');
    // Nothing latent either: expanding later must not reveal a pre-opened form.
    __resetGuardsForTests();
    target.querySelector<HTMLButtonElement>('#block-3-header')!.click();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3');
    expect(createTitle()).toBeNull();
  });

  it('a reorder is not blocked by an open draft (D3)', async () => {
    await navigate('/courses/c/edit/v/1/blocks/3', { force: true });
    mountBlock(mkBlock({ sequences: [
      { id: 7, block_id: 3, title: 'S one', slug: 's1', order: 1, items: [] },
      { id: 8, block_id: 3, title: 'S two', slug: 's2', order: 2, items: [] },
    ] }));
    await settle();
    await dirtyBlockTitle();
    expect(registry.isAnyDirty()).toBe(true);
    target.querySelector<HTMLButtonElement>('[aria-label="Move sequence down: S one"]')!.click();
    await settle();
    expect(fetchSpy.mock.calls.some(([u]) => String(u) === '/api/blocks/3/sequences/reorder')).toBe(true);
  });
});

describe('BlockAccordion — body (T5b)', () => {
  const trash = () => target.querySelector<HTMLButtonElement>('button[aria-label="Delete block Vectors"]')!;
  const delText = () => target.querySelector('#block-3-panel > .del-footer .del-text')!.textContent;
  async function expand() {
    await navigate('/courses/c/edit/v/1/blocks/3', { force: true });
    await settle();
  }

  it('title and info are inline fields; a title commit PATCHes {title} only, then reloads', async () => {
    await expand();
    mountBlock();
    await settle();
    const labels = [...target.querySelectorAll('#block-3-panel .inline-field .label')].map((l) => l.textContent);
    expect(labels).toEqual(['Block title', 'Info (markdown)']);
    await dirtyBlockTitle();
    field('Block title').querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    const patch = fetchSpy.mock.calls.find(([u, i]) => String(u) === '/api/blocks/3' && (i as RequestInit)?.method === 'PATCH')!;
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ title: 'Changed' });
    expect(treeFetchPaths.length).toBe(1);
  });

  it('a published version keeps the text fields editable (textReason)', async () => {
    currentEditorVersion.value!.version = mkVersion({ state: 'published' });
    await expand();
    mountBlock();
    await settle();
    expect(field('Block title').querySelector<HTMLButtonElement>('button[aria-label="Edit the block title"]')!.disabled).toBe(false);
  });

  it('collapse resets the create-sequence form', async () => {
    await expand();
    mountBlock();
    await settle();
    plus().click();
    await settle();
    type(createTitle()!, 'Draft');
    await navigate('/courses/c/edit/v/1', { force: true });
    await settle();
    await expand();
    expect(createTitle()).toBeNull();
    expect(plus().getAttribute('aria-expanded')).toBe('false');
  });

  it('a confirmed navigation discards a typed create-sequence title (createTracker.discard)', async () => {
    await expand();
    mountBlock();
    await settle();
    plus().click();
    await settle();
    type(createTitle()!, 'Draft');
    expect(registry.isAnyDirty()).toBe(true);
    registry.discardAll();
    flushSync();
    expect(createTitle()).toBeNull();
    expect(registry.isAnyDirty()).toBe(false);
  });

  it('delete footer precedence: reason → sequences → open form → enabled', async () => {
    await expand();
    mountBlock();
    await settle();
    expect(trash().disabled).toBe(false);
    expect(trash().title).toBe('Delete this block');
    expect(delText()).toBe('Delete this block');
    plus().click();
    await settle();
    expect(trash().disabled).toBe(true);
    expect(delText()).toBe('Delete this block — cancel the new sequence first');
    teardown();
    mountBlock(mkBlock({ sequences: [mkSeq(7)] }));
    await settle();
    expect(trash().disabled).toBe(true);
    expect(delText()).toBe('Delete this block — remove its sequences first');
    teardown();
    currentEditorVersion.value!.version = mkVersion({ is_disabled: true });
    mountBlock(mkBlock({ sequences: [mkSeq(7)] }));
    await settle();
    expect(trash().title).toBe('Delete this block — enable the version first');
    expect(delText()).toBe('Delete this block — enable the version first');
  });

  it('delete success: navigates to the version (replace, no prompt) BEFORE the reload', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const replaceSpy = vi.spyOn(history, 'replaceState');
    await expand();
    mountBlock();
    await settle();
    await dirtyBlockTitle();
    trash().click();
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith('Delete block "Vectors"? This cannot be undone. Unsaved edits may be lost.');
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/courses/c/edit/v/1');
    expect(treeFetchPaths).toEqual(['/courses/c/edit/v/1']);
  });

  it('delete success while another block is expanded: reload only, no navigate', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const del = deferredDelete('/api/blocks/3');
    await expand();
    mountBlock();
    await settle();
    trash().click();
    await settle();
    await navigate('/courses/c/edit/v/1/blocks/4', { force: true });
    await settle();
    del.release();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/4');
    expect(treeFetchPaths).toEqual(['/courses/c/edit/v/1/blocks/4']);
  });

  it('a sequence delete still reloads after the parent block collapsed (stillOnVid prop)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const del = deferredDelete('/api/sequences/7');
    await navigate('/courses/c/edit/v/1/blocks/3/sequences/7', { force: true });
    mountBlock(mkBlock({ sequences: [mkSeq(7)] }));
    await settle();
    target.querySelector<HTMLButtonElement>('button[aria-label="Delete sequence S 7"]')!.click();
    await settle();
    await navigate('/courses/c/edit/v/1', { force: true });
    await settle();
    expect(target.querySelector('#seq-7-header')).toBeNull();
    del.release();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    expect(treeFetchPaths).toEqual(['/courses/c/edit/v/1']);
  });

  it('an info commit PATCHes {info} only', async () => {
    await expand();
    mountBlock();
    await settle();
    field('Info (markdown)').querySelector<HTMLButtonElement>('button[aria-label="Edit the block info"]')!.click();
    await settle();
    const ta = field('Info (markdown)').querySelector('textarea')!;
    type(ta, 'New info');
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    await settle();
    const patch = fetchSpy.mock.calls.find(([u, i]) => String(u) === '/api/blocks/3' && (i as RequestInit)?.method === 'PATCH')!;
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ info: 'New info' });
  });

  it('a late title commit after an unmount does not reload', async () => {
    let release!: () => void;
    serve((url, init) => (url === '/api/blocks/3' && init?.method === 'PATCH'
      ? new Promise<void>((r) => { release = r; }).then(() => jres({}))
      : undefined));
    await expand();
    mountBlock();
    await settle();
    await dirtyBlockTitle();
    field('Block title').querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    teardown();
    release();
    await settle();
    expect(treeFetchPaths).toEqual([]);
  });

  it('a late delete after an unmount neither navigates nor reloads', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const del = deferredDelete('/api/blocks/3');
    await expand();
    mountBlock();
    await settle();
    trash().click();
    await settle();
    teardown();
    del.release();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3');
    expect(treeFetchPaths).toEqual([]);
  });

  it('a create failure after the form closed toasts and leaves no stale error for the next open', async () => {
    clearToasts();
    let release!: () => void;
    serve((url, init) => (url === '/api/blocks/3/sequences' && init?.method === 'POST'
      ? new Promise<void>((r) => { release = r; }).then(() => jres({ detail: 'Title already taken' }, 409))
      : undefined));
    await expand();
    mountBlock();
    await settle();
    plus().click();
    await settle();
    type(createTitle()!, 'Dup');
    createTitle()!.form!.requestSubmit();
    await settle();
    await navigate('/courses/c/edit/v/1', { force: true });
    await settle();
    release();
    await settle();
    expect(toasts.list.map((t) => [t.message, t.kind])).toEqual([['Title already taken', 'error']]);
    await expand();
    plus().click();
    await settle();
    expect(createTitle()!.value).toBe('');
    expect(target.querySelector('#block-3-panel .field-err')).toBeNull();
    expect(target.querySelector('#block-3-panel .form-err')).toBeNull();
  });

  it('empty sequences: "No sequences yet." when editable, "No sequences." otherwise', async () => {
    await expand();
    mountBlock();
    await settle();
    expect(target.querySelector('#block-3-panel > .empty')!.textContent).toBe('No sequences yet.');
    teardown();
    currentEditorVersion.value!.version = mkVersion({ state: 'archived' });
    mountBlock();
    await settle();
    expect(target.querySelector('#block-3-panel > .empty')!.textContent).toBe('No sequences.');
  });
});
