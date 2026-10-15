import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import BlockAccordion from '../components/editor/BlockAccordion.svelte';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../lib/dirtyRegistry.svelte';
import { currentEditorVersion } from '../stores/currentEditorVersion.svelte';
import { navigate, currentRoute, matchRoute, __resetGuardsForTests } from '../lib/router.svelte';
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

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
// Open the header's inline title (5c D8) and leave a changed draft in it.
const titleInput = () => target.querySelector<HTMLInputElement>('input[aria-label="Block title"]');
async function dirtyBlockTitle() {
  target.querySelector<HTMLButtonElement>('button[aria-label="Edit the block title"]')!.click();
  await settle();
  type(titleInput()!, 'Changed');
}
const enter = (el: HTMLElement) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

// Slice-5c T3: the inline "+ Add sequence" line and the title row it opens.
const addLine = () => [...target.querySelectorAll<HTMLButtonElement>('button.add-line')].find((b) => b.textContent!.includes('Add sequence'));
const addInput = () => target.querySelector<HTMLInputElement>('input[aria-label="New sequence title"]');

describe('BlockAccordion — header (T5a)', () => {
  it('arrows always render: boundary titles on an editable version', () => {
    mountBlock(mkBlock(), { index: 1, blockCount: 1 });
    const up = target.querySelector<HTMLButtonElement>('[aria-label="Move block up: Vectors"]')!;
    const down = target.querySelector<HTMLButtonElement>('[aria-label="Move block down: Vectors"]')!;
    expect(up.disabled).toBe(true);
    expect(up.title).toBe('Move up — already first');
    expect(down.disabled).toBe(true);
    expect(down.title).toBe('Move down — already last');
  });

  it('the old in-body "+ New sequence" button is gone', async () => {
    await navigate('/courses/c/edit/v/1/blocks/3', { force: true });
    mountBlock();
    await settle();
    expect([...target.querySelectorAll('button')].some((b) => b.textContent?.includes('New sequence'))).toBe(false);
    expect(target.querySelector('#block-3-panel h3')).toBeNull();
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
  async function expand() {
    await navigate('/courses/c/edit/v/1/blocks/3', { force: true });
    await settle();
  }
  // Polish 1 #5: the tree's question, under the header.
  const treeBtn = (k: 'confirm' | 'cancel') => target.querySelector<HTMLButtonElement>(`.tree-ask .inline-confirm button.${k}`)!;
  const warning = () => target.querySelector('.block-card > .tree-ask .warning')!.textContent!.trim();

  it('collapse resets the create-sequence form', async () => {
    await expand();
    mountBlock();
    await settle();
    addLine()!.click();
    await settle();
    type(addInput()!, 'Draft');
    await navigate('/courses/c/edit/v/1', { force: true });
    await settle();
    await expand();
    expect(addInput()).toBeNull();
    expect(addLine()).toBeDefined();
  });

  it('a confirmed navigation discards a typed create-sequence title (createTracker.discard)', async () => {
    await expand();
    mountBlock();
    await settle();
    addLine()!.click();
    await settle();
    type(addInput()!, 'Draft');
    expect(registry.isAnyDirty()).toBe(true);
    registry.discardAll();
    flushSync();
    expect(addInput()).toBeNull();
    expect(registry.isAnyDirty()).toBe(false);
  });

  it('#5: the question sits under the header, its suffix live; Delete navigates to the version (replace) BEFORE the reload', async () => {
    const replaceSpy = vi.spyOn(history, 'replaceState');
    await expand();
    mountBlock();
    await settle();
    trash().click();
    flushSync();
    expect(warning()).toBe('Delete block "Vectors"? This cannot be undone.');
    expect(target.querySelector('.block-card > .tree-ask .inline-confirm')!.classList.contains('end')).toBe(true);   // D42
    expect(treeBtn('confirm').textContent!.trim()).toBe('Delete');
    expect(treeBtn('confirm').classList.contains('danger')).toBe(true);
    expect(document.activeElement).toBe(treeBtn('cancel'));
    // Some other draft on the page appears while it asks: the suffix follows (a getter).
    registry.register({ isDirty: true, discard: () => {} });
    flushSync();
    expect(warning()).toBe('Delete block "Vectors"? This cannot be undone. Unsaved edits may be lost.');
    treeBtn('confirm').click();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/courses/c/edit/v/1');
    expect(treeFetchPaths).toEqual(['/courses/c/edit/v/1']);
  });

  it('#5: Cancel sends nothing and focuses the trash; the route moving on withdraws the question (R49)', async () => {
    await expand();
    mountBlock();
    await settle();
    trash().click();
    flushSync();
    treeBtn('cancel').click();
    await settle();
    expect(target.querySelector('.tree-ask')).toBeNull();
    expect(document.activeElement).toBe(trash());
    trash().click();
    flushSync();
    await navigate('/courses/c/edit/v/1/blocks/3?tab=x', { force: true });   // the route moves on
    await settle();
    expect(target.querySelector('.tree-ask')).toBeNull();
    expect(fetchSpy.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
  });

  it('#5: Cancel with the trash disabled meanwhile lands on the block header, never <body> (whole-branch review)', async () => {
    await expand();
    mountBlock();
    await settle();
    trash().click();
    flushSync();
    trash().disabled = true;
    treeBtn('cancel').click();
    await settle();
    expect(target.querySelector('.tree-ask')).toBeNull();
    expect(document.activeElement?.id).toBe('block-3-header');
  });

  it('delete success while another block is expanded: reload only, no navigate', async () => {
    const del = deferredDelete('/api/blocks/3');
    await expand();
    mountBlock();
    await settle();
    trash().click();
    await settle();
    treeBtn('confirm').click();
    await settle();
    await navigate('/courses/c/edit/v/1/blocks/4', { force: true });
    await settle();
    del.release();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/4');
    expect(treeFetchPaths).toEqual(['/courses/c/edit/v/1/blocks/4']);
  });

  it('a sequence delete still reloads after the parent block collapsed (stillOnVid prop)', async () => {
    const del = deferredDelete('/api/sequences/7');
    await navigate('/courses/c/edit/v/1/blocks/3/sequences/7', { force: true });
    mountBlock(mkBlock({ sequences: [mkSeq(7)] }));
    await settle();
    target.querySelector<HTMLButtonElement>('button[aria-label="Delete sequence S 7"]')!.click();
    await settle();
    treeBtn('confirm').click();
    await settle();
    await navigate('/courses/c/edit/v/1', { force: true });
    await settle();
    expect(target.querySelector('#seq-7-header')).toBeNull();
    del.release();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    expect(treeFetchPaths).toEqual(['/courses/c/edit/v/1']);
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
    enter(titleInput()!);
    await settle();
    teardown();
    release();
    await settle();
    expect(treeFetchPaths).toEqual([]);
  });

  it('a late delete after an unmount neither navigates nor reloads', async () => {
    const del = deferredDelete('/api/blocks/3');
    await expand();
    mountBlock();
    await settle();
    trash().click();
    await settle();
    treeBtn('confirm').click();
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
    addLine()!.click();
    await settle();
    type(addInput()!, 'Dup');
    addInput()!.form!.requestSubmit();
    await settle();
    await navigate('/courses/c/edit/v/1', { force: true });
    await settle();
    release();
    await settle();
    expect(toasts.list.map((t) => [t.message, t.kind])).toEqual([['Title already taken', 'error']]);
    await expand();
    addLine()!.click();
    await settle();
    expect(addInput()!.value).toBe('');
    expect(target.querySelector('#block-3-panel .add-err')).toBeNull();
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

describe('BlockAccordion — "+ Add sequence" (Slice-5c T3)', () => {
  async function expand() {
    await navigate('/courses/c/edit/v/1/blocks/3', { force: true });
    await settle();
  }
  const submitBtn = () => target.querySelector<HTMLButtonElement>('button[aria-label="Create sequence"]');

  it('shown only on the open-focus block of an editable version', async () => {
    mountBlock(mkBlock({ sequences: [mkSeq(5)] }));
    expect(addLine()).toBeUndefined();                  // collapsed
    await expand();
    expect(addLine()).toBeDefined();
    await navigate('/courses/c/edit/v/1/blocks/3/sequences/5', { force: true });
    await settle();
    expect(addLine()).toBeUndefined();                  // a sequence holds the focus
  });

  it('the line sits after the sequences list (new sequences land at the end)', async () => {
    await expand();
    mountBlock(mkBlock({ sequences: [mkSeq(5), mkSeq(6)] }));
    await settle();
    const list = target.querySelector('#block-3-panel .seqs-list')!;
    expect(list.compareDocumentPosition(addLine()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.contains(addLine()!)).toBe(false);
  });

  it('the line opens a focused title row; submit creates {title} and reloads', async () => {
    await expand();
    mountBlock();
    await settle();
    addLine()!.click(); await settle();
    expect(document.activeElement).toBe(addInput());
    expect(addLine()).toBeUndefined();
    type(addInput()!, 'Span');
    const treeCalls = treeFetchPaths.length;
    addInput()!.form!.requestSubmit(); await settle();
    const post = fetchSpy.mock.calls.find(([u, i]) => String(u) === '/api/blocks/3/sequences' && i?.method === 'POST')!;
    expect(JSON.parse(String(post[1].body))).toEqual({ title: 'Span' });
    expect(treeFetchPaths.length).toBe(treeCalls + 1);
    expect(addInput()).toBeNull();
  });

  it('after a create, focus returns to the line for the next one', async () => {
    await expand();
    mountBlock();
    await settle();
    addLine()!.click(); await settle();
    type(addInput()!, 'Span');
    addInput()!.form!.requestSubmit(); await settle();
    expect(document.activeElement).toBe(addLine());
  });

  it('✓ is a submit button, disabled until a title is typed', async () => {
    await expand();
    mountBlock();
    await settle();
    addLine()!.click(); await settle();
    expect(submitBtn()!.type).toBe('submit');
    expect(submitBtn()!.disabled).toBe(true);
    type(addInput()!, 'Span');
    expect(submitBtn()!.disabled).toBe(false);
    submitBtn()!.click(); await settle();
    expect(fetchSpy.mock.calls.some(([u, i]) => String(u) === '/api/blocks/3/sequences' && i?.method === 'POST')).toBe(true);
  });

  it('Esc closes the row without a request and returns focus to the line', async () => {
    await expand();
    mountBlock();
    await settle();
    addLine()!.click(); await settle();
    type(addInput()!, 'x');
    const calls = fetchSpy.mock.calls.length;
    addInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle();
    expect(addInput()).toBeNull();
    expect(fetchSpy.mock.calls.length).toBe(calls);
    expect(document.activeElement).toBe(addLine());
  });

  it('✕ closes the row and returns focus to the line', async () => {
    await expand();
    mountBlock();
    await settle();
    addLine()!.click(); await settle();
    target.querySelector<HTMLButtonElement>('button[aria-label="Cancel new sequence"]')!.click(); await settle();
    expect(addInput()).toBeNull();
    expect(document.activeElement).toBe(addLine());
  });

  it('a typed title is guard-dirty; a confirmed discard closes the row', async () => {
    await expand();
    mountBlock();
    await settle();
    addLine()!.click(); await settle();
    expect(registry.isAnyDirty()).toBe(false);
    type(addInput()!, 'x');
    expect(registry.isAnyDirty()).toBe(true);
    registry.discardAll(); flushSync();
    expect(addInput()).toBeNull();
  });

  it('a server error shows under the row', async () => {
    serve((u, i) => (u === '/api/blocks/3/sequences' && i?.method === 'POST' ? jres({ detail: [{ loc: ['body', 'title'], msg: 'Too long' }] }, 422) : undefined));
    await expand();
    mountBlock();
    await settle();
    addLine()!.click(); await settle();
    type(addInput()!, 'x');
    addInput()!.form!.requestSubmit(); await settle();
    const err = target.querySelector('.add-err')!;
    expect(err.textContent).toContain('Too long');
    expect(addInput()!.getAttribute('aria-invalid')).toBe('true');
    expect(addInput()!.getAttribute('aria-describedby')).toBe(err.id);
    expect(err.id).toBe('block-3-add-err');
  });
});

describe('BlockAccordion — focus shading (Slice-5c T1)', () => {
  const card = () => target.querySelector('.block-card')!;
  it('collapsed with no block open: a row at the focus level, no shade', () => {
    mountBlock();
    expect(card().classList.contains('focus')).toBe(false);
    expect(card().classList.contains('parent')).toBe(false);
    // 5c T5 (user): a focus-level row is white on the shaded page.
    expect(card().classList.contains('at-focus')).toBe(true);
  });
  it('open with no sequence open: the focus', async () => {
    mountBlock();
    await navigate('/courses/c/edit/v/1/blocks/3'); await settle();
    expect(card().classList.contains('focus')).toBe(true);
    expect(card().classList.contains('parent')).toBe(false);
    expect(card().classList.contains('at-focus')).toBe(false);
  });
  it('open with one of its sequences open: the parent shade, not the focus', async () => {
    mountBlock(mkBlock({ sequences: [mkSeq(5)] }));
    await navigate('/courses/c/edit/v/1/blocks/3/sequences/5'); await settle();
    expect(card().classList.contains('parent')).toBe(true);
    expect(card().classList.contains('focus')).toBe(false);
  });
  it('a collapsed parent loses the shade (sequence closed → the block is the focus again)', async () => {
    mountBlock(mkBlock({ sequences: [mkSeq(5)] }));
    await navigate('/courses/c/edit/v/1/blocks/3/sequences/5'); await settle();
    await navigate('/courses/c/edit/v/1/blocks/3'); await settle();
    expect(card().classList.contains('focus')).toBe(true);
    expect(card().classList.contains('parent')).toBe(false);
  });
  it('another block open: no shade on this one', async () => {
    mountBlock();
    await navigate('/courses/c/edit/v/1/blocks/99'); await settle();
    expect(card().classList.contains('focus')).toBe(false);
    expect(card().classList.contains('parent')).toBe(false);
  });
});

describe('BlockAccordion — header (Slice-5c T2)', () => {
  const pencil = () => target.querySelector<HTMLButtonElement>('button[aria-label="Edit the block title"]');
  const up = () => target.querySelector<HTMLButtonElement>('button[aria-label="Move block up: Vectors"]');
  const trash = () => target.querySelector<HTMLButtonElement>('button[aria-label="Delete block Vectors"]');
  async function expand() { await navigate('/courses/c/edit/v/1/blocks/3', { force: true }); await settle(); }

  // User, 2026-10-08: the block is numbered "2. Vectors" (its position), still no B2 badge.
  it('the header is "{index}. title": no B{index} badge, no slug', () => {
    mountBlock(mkBlock(), { index: 2, blockCount: 3 });
    const toggle = target.querySelector<HTMLButtonElement>('#block-3-header')!;
    expect(toggle.parentElement!.tagName).toBe('H3');
    expect(toggle.querySelector('.num')!.textContent).toBe('2.');
    expect(toggle.querySelector('.title')!.textContent).toBe('Vectors');
    expect(toggle.textContent).not.toContain('B2');
    expect(target.querySelector('.code, .slug')).toBeNull();
  });

  it('collapsed at the version focus: ↑ ↓, no ✎, no trash, no +', () => {
    mountBlock(mkBlock(), { index: 2, blockCount: 3 });
    expect(up()).not.toBeNull();
    expect(pencil()).toBeNull();
    expect(trash()).toBeNull();
    expect(addLine()).toBeUndefined();
  });

  it('open block: ✎ renames with a {title} PATCH, then reloads', async () => {
    await expand();
    mountBlock();
    await settle();
    await dirtyBlockTitle();
    enter(titleInput()!);
    await settle();
    const patch = fetchSpy.mock.calls.find(([u, i]) => String(u) === '/api/blocks/3' && (i as RequestInit)?.method === 'PATCH')!;
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ title: 'Changed' });
    expect(treeFetchPaths.length).toBe(1);
    expect(titleInput()).toBeNull();
  });

  it('a failed rename keeps the field open with the server message', async () => {
    serve((url, init) => (url === '/api/blocks/3' && init?.method === 'PATCH' ? jres({ detail: 'Title already taken' }, 409) : undefined));
    await expand();
    mountBlock();
    await settle();
    await dirtyBlockTitle();
    enter(titleInput()!);
    await settle();
    expect(titleInput()!.value).toBe('Changed');
    expect(target.querySelector('.acc-row .err')!.textContent).toBe('Title already taken');
    expect(treeFetchPaths).toEqual([]);
  });

  it('the body has no Title/Info field rows and no delete footer', async () => {
    await expand();
    mountBlock();
    await settle();
    // The old rows were InlineField inputs (deleted in T5); no field may come back.
    expect(target.querySelector('#block-3-panel input, #block-3-panel textarea')).toBeNull();
    expect(target.querySelector('.del-footer')).toBeNull();
  });

  it('the header trash: enabled on an empty block; "Cancel the new sequence first" while the form is open', async () => {
    await expand();
    mountBlock();
    await settle();
    expect(trash()!.disabled).toBe(false);
    expect(trash()!.title).toBe('Delete this block');
    addLine()!.click();
    await settle();
    expect(trash()!.disabled).toBe(true);
    expect(trash()!.title).toBe('Cancel the new sequence first');
  });

  it('the header trash: disabled "Remove its sequences first" while sequences remain', async () => {
    await expand();
    mountBlock(mkBlock({ sequences: [mkSeq(5)] }));
    await settle();
    expect(trash()!.disabled).toBe(true);
    expect(trash()!.title).toBe('Remove its sequences first');
  });

  it('published: ✎ only — no arrows, no trash, no +', async () => {
    currentEditorVersion.value!.version = mkVersion({ state: 'published' });
    await expand();
    mountBlock();
    await settle();
    expect(pencil()).not.toBeNull();
    expect(pencil()!.disabled).toBe(false);
    expect(up()).toBeNull();
    expect(trash()).toBeNull();
    expect(addLine()).toBeUndefined();
  });

  it('archived and disabled: no ✎, no arrows, no trash', async () => {
    for (const v of [mkVersion({ state: 'archived' }), mkVersion({ is_disabled: true })]) {
      currentEditorVersion.value!.version = v;
      await expand();
      mountBlock();
      await settle();
      expect(pencil()).toBeNull();
      expect(up()).toBeNull();
      expect(trash()).toBeNull();
      teardown();
    }
  });

  it('another block open: this one is a title-only row', async () => {
    currentEditorVersion.value!.blocks = [mkBlock(), mkBlock({ id: 99, title: 'Matrices', slug: 'matrices' })];
    mountBlock();
    await navigate('/courses/c/edit/v/1/blocks/99'); await settle();
    expect(up()).toBeNull();
    expect(target.querySelectorAll('.acc-row .actions button').length).toBe(0);
  });

  it('a stale block id (no such block) keeps the rows at the focus level (no flicker of controls)', async () => {
    mountBlock();
    await navigate('/courses/c/edit/v/1/blocks/999'); await settle();
    expect(up()).not.toBeNull();
  });

  it('a sequence open: the block header shows the title and the chevron only', async () => {
    mountBlock(mkBlock({ sequences: [mkSeq(5)] }));
    await navigate('/courses/c/edit/v/1/blocks/3/sequences/5'); await settle();
    const glyphs = [...target.querySelectorAll('.block-card > .acc-row .actions button')]
      .map((b) => b.getAttribute('data-glyph'));
    expect(glyphs).toEqual(['chevron']);
  });

  it('a rename open when a sequence opens closes (the block left the focus)', async () => {
    mountBlock(mkBlock({ sequences: [mkSeq(5)] }));
    await expand();
    target.querySelector<HTMLButtonElement>('button[aria-label="Edit the block title"]')!.click();
    await settle();
    expect(titleInput()).not.toBeNull();
    await navigate('/courses/c/edit/v/1/blocks/3/sequences/5', { force: true }); await settle();
    expect(titleInput()).toBeNull();
  });
});
