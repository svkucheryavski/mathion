import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SequenceAccordion from '../components/editor/SequenceAccordion.svelte';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../lib/dirtyRegistry.svelte';
import { currentEditorVersion } from '../stores/currentEditorVersion.svelte';
import { navigate, currentRoute, __resetGuardsForTests } from '../lib/router.svelte';
import { toasts, clearToasts } from '../stores/toasts.svelte';
import type { AdminTree, AdminTreeBlock, AdminTreeItem, AdminTreeSequence, AdminTreeVersion } from '../lib/types';

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
const item: AdminTreeItem = {
  id: 9, sequence_id: 2, title: 'Page', slug: 'page', order: 1, type: 'static_page',
  content_md: '', content_html: '', video_url: null, script_url: null, questions_count: 0,
};
function mkSeq(over: Partial<AdminTreeSequence> = {}): AdminTreeSequence {
  return { id: 2, block_id: 3, title: 'Seq', slug: 'seq', order: 1, items: [], ...over };
}
function mkTree(seq: AdminTreeSequence, version = mkVersion()): AdminTree {
  const block: AdminTreeBlock = { id: 3, version_id: 1, title: 'Block', slug: 'block', order: 1, info: '', info_html: '', sequences: [seq] };
  return { course: { id: 1, name: 'C', slug: 'c' }, version, blocks: [block] };
}

// The tree the admin-tree GET serves; the path the route had when it was fetched.
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

let cleanup: (() => void) | null = null;
beforeEach(async () => {
  __resetGuardsForTests();
  await navigate('/courses/c/edit/v/1/blocks/3/sequences/2', { force: true });
  treeFetchPaths = [];
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  served = mkTree(mkSeq());
  serve();
});
afterEach(() => {
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  currentEditorVersion.value = null;
  __resetGuardsForTests();
  vi.restoreAllMocks();
});

// Direct mount: the required `stillOnVid` is a stub the test controls.
function mountAccordion(seq: AdminTreeSequence = mkSeq(), version = mkVersion()) {
  const tree = mkTree(seq, version);
  currentEditorVersion.value = tree;
  const target = document.createElement('div');
  document.body.appendChild(target);
  const stillOnVid = vi.fn((_: number) => true);
  const props = $state({
    courseSlug: 'c', vid: 1, block: tree.blocks[0], seq, index: 1, sequenceCount: 1,
    routeBid: '3' as string | null, routeSid: '2' as string | null, stillOnVid, onMoveUp: vi.fn(), onMoveDown: vi.fn(),
  });
  const cmp = mount(SequenceAccordion, { target, props, context: new Map([[DIRTY_REGISTRY_KEY, createDirtyRegistry()]]) });
  cleanup = () => unmount(cmp);
  flushSync();
  return { target, stillOnVid, props };
}
const plus = (t: HTMLElement) => t.querySelector<HTMLButtonElement>('button[aria-label="New item in Seq"]')!;
const trash = (t: HTMLElement) => t.querySelector<HTMLButtonElement>('button[aria-label="Delete sequence Seq"]')!;
const createBtn = (t: HTMLElement) =>
  [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Create') as HTMLButtonElement;
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

const titleInput = (t: HTMLElement) => t.querySelector<HTMLInputElement>('input[aria-label="Sequence title"]');
async function renameTo(t: HTMLElement, v: string) {
  t.querySelector<HTMLButtonElement>('button[aria-label="Edit the sequence title"]')!.click();
  await settle();
  type(titleInput(t)!, v);
  titleInput(t)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await settle();
}
const headerGlyphs = (t: HTMLElement) =>
  [...t.querySelectorAll('.seq-card > .acc-row .actions button')].map((b) => b.getAttribute('data-glyph'));

describe('SequenceAccordion — header (Slice-5c T2)', () => {
  it('the header is an <h4> toggle with the title only (no S{index} badge, no slug)', () => {
    const { target } = mountAccordion();
    const toggle = target.querySelector<HTMLButtonElement>('#seq-2-header')!;
    expect(toggle.parentElement!.tagName).toBe('H4');
    expect(toggle.textContent!.trim()).toBe('Seq');
    expect(target.querySelector('.code, .slug')).toBeNull();
  });

  it('open: ✎ ↑ ↓ trash ⌄; boundary arrows disabled with "already first/last"', () => {
    const { target } = mountAccordion();
    expect(headerGlyphs(target)).toEqual(['pencil', 'up', 'down', 'trash', 'chevron']);
    const up = target.querySelector<HTMLButtonElement>('[aria-label="Move sequence up: Seq"]')!;
    const down = target.querySelector<HTMLButtonElement>('[aria-label="Move sequence down: Seq"]')!;
    expect(up.disabled).toBe(true);
    expect(up.title).toBe('Move up — already first');
    expect(down.disabled).toBe(true);
    expect(down.title).toBe('Move down — already last');
  });

  it('published: ✎ only; archived and disabled: nothing but the chevron', () => {
    let { target } = mountAccordion(mkSeq(), mkVersion({ state: 'published' }));
    expect(headerGlyphs(target)).toEqual(['pencil', 'chevron']);
    cleanup?.();
    ({ target } = mountAccordion(mkSeq(), mkVersion({ state: 'archived' })));
    expect(headerGlyphs(target)).toEqual(['chevron']);
    cleanup?.();
    ({ target } = mountAccordion(mkSeq(), mkVersion({ is_disabled: true })));
    expect(headerGlyphs(target)).toEqual(['chevron']);
  });

  it('collapsed with no sequence open: ↑ ↓ and the chevron (a row at the focus)', () => {
    const { target, props } = mountAccordion();
    props.routeSid = null; flushSync();
    expect(headerGlyphs(target)).toEqual(['up', 'down', 'chevron-right']);
  });

  it('a sibling sequence open: this one is a title-only row', () => {
    const { target, props } = mountAccordion();
    props.block = { ...props.block, sequences: [...props.block.sequences, mkSeq({ id: 5, title: 'Other', slug: 'other' })] };
    props.routeSid = '5'; flushSync();
    expect(headerGlyphs(target)).toEqual([]);
  });

  it('a stale sequence id (no such sequence) keeps the row at the focus level', () => {
    const { target, props } = mountAccordion();
    props.routeSid = '77'; flushSync();
    expect(headerGlyphs(target)).toEqual(['up', 'down', 'chevron-right']);
  });

  it('✎ renames with a {title} PATCH to the sequence, then reloads', async () => {
    const { target } = mountAccordion();
    await renameTo(target, 'Renamed');
    const patch = fetchSpy.mock.calls.find(([u, i]) => String(u) === '/api/sequences/2' && (i as RequestInit)?.method === 'PATCH')!;
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ title: 'Renamed' });
    expect(treeFetchPaths.length).toBe(1);
    expect(titleInput(target)).toBeNull();
  });

  it('a late rename after a version change does not reload', async () => {
    let release!: () => void;
    serve((url, init) => (url === '/api/sequences/2' && init?.method === 'PATCH'
      ? new Promise<void>((r) => { release = r; }).then(() => jres({}))
      : undefined));
    const { target, stillOnVid } = mountAccordion();
    await renameTo(target, 'Renamed');
    stillOnVid.mockReturnValue(false);
    release();
    await settle();
    expect(treeFetchPaths).toEqual([]);
  });

  it('the body has no title field row, no Items heading and no delete footer', () => {
    const { target } = mountAccordion();
    expect(target.querySelector('.inline-field')).toBeNull();
    expect(target.querySelector('h5')).toBeNull();
    expect(target.querySelector('.del-footer')).toBeNull();
  });
});

describe('SequenceAccordion — body (T5b)', () => {
  it('the + opens the form and focuses the checked type radio', async () => {
    const { target } = mountAccordion();
    expect(plus(target).title).toBe('New item');
    plus(target).click();
    await settle();
    const checked = target.querySelector<HTMLInputElement>('form input[type="radio"]:checked')!;
    expect(checked.value).toBe('static_page');
    expect(document.activeElement).toBe(checked);
    expect(plus(target).dataset.glyph).toBe('close');
    expect(plus(target).title).toBe('Cancel new item');
    expect(plus(target).getAttribute('aria-label')).toBe('New item in Seq');
    expect(plus(target).getAttribute('aria-expanded')).toBe('true');
  });

  it('the create form keeps its type-specific fields', async () => {
    const { target } = mountAccordion();
    plus(target).click();
    await settle();
    expect(target.querySelector('form textarea[placeholder="Content (markdown)"]')).not.toBeNull();
    target.querySelector<HTMLInputElement>('input[value="video"]')!.click(); flushSync();
    expect(target.querySelector('form input[type="url"]')).not.toBeNull();
    expect(target.querySelector('form textarea')).toBeNull();
    target.querySelector<HTMLInputElement>('input[value="quiz"]')!.click(); flushSync();
    expect(target.querySelector('form input[type="url"]')).toBeNull();
    expect(target.querySelector('form textarea')).toBeNull();
  });

  it('creates an interactive_app with only title + type — no script_url, no URL field', async () => {
    serve((url) => (url.endsWith('/api/sequences/2/items') ? jres({ id: 99 }) : undefined));
    const { target } = mountAccordion();
    plus(target).click();
    await settle();
    target.querySelector<HTMLInputElement>('input[value="interactive_app"]')!.click(); flushSync();
    expect(target.querySelector('input[type="url"]')).toBeNull();
    type(target.querySelector<HTMLInputElement>('input[placeholder="Title"]')!, 'My app');
    createBtn(target).click();
    await settle();
    const post = fetchSpy.mock.calls.find(
      (c) => String(c[0]).includes('/api/sequences/2/items') && (c[1] as RequestInit)?.method === 'POST',
    )!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ title: 'My app', type: 'interactive_app' });
  });

  it('collapse resets the create form', async () => {
    const { target, props } = mountAccordion();
    plus(target).click();
    await settle();
    type(target.querySelector<HTMLInputElement>('input[placeholder="Title"]')!, 'Draft');
    props.routeSid = null;
    flushSync();
    props.routeSid = '2';
    flushSync();
    expect(target.querySelector('form')).toBeNull();
    expect(plus(target).getAttribute('aria-expanded')).toBe('false');
  });

  it('a late create-item success after a version change neither reloads nor navigates', async () => {
    let release!: () => void;
    serve((url, init) => (url === '/api/sequences/2/items' && init?.method === 'POST'
      ? new Promise<void>((r) => { release = r; }).then(() => jres({ id: 99 }))
      : undefined));
    const { target, stillOnVid } = mountAccordion();
    plus(target).click();
    await settle();
    type(target.querySelector<HTMLInputElement>('input[placeholder="Title"]')!, 'New page');
    createBtn(target).click();
    await settle();
    stillOnVid.mockReturnValue(false);
    release();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3/sequences/2');
    expect(treeFetchPaths).toEqual([]);
  });

  it('a create failure after a collapse toasts and leaves no stale error for the next open', async () => {
    clearToasts();
    let release!: () => void;
    serve((url, init) => (url === '/api/sequences/2/items' && init?.method === 'POST'
      ? new Promise<void>((r) => { release = r; }).then(() => jres({ detail: 'Title already taken' }, 409))
      : undefined));
    const { target, props } = mountAccordion();
    plus(target).click();
    await settle();
    type(target.querySelector<HTMLInputElement>('input[placeholder="Title"]')!, 'Dup');
    createBtn(target).click();
    await settle();
    props.routeSid = null;
    flushSync();
    release();
    await settle();
    expect(toasts.list.map((t) => [t.message, t.kind])).toEqual([['Title already taken', 'error']]);
    props.routeSid = '2';
    flushSync();
    plus(target).click();
    await settle();
    expect(target.querySelector<HTMLInputElement>('input[placeholder="Title"]')!.value).toBe('');
    expect(target.querySelector('.field-err')).toBeNull();
    expect(target.querySelector('.form-err')).toBeNull();
  });

  it('empty items: "No items yet." when editable, "No items." otherwise', () => {
    let { target } = mountAccordion();
    expect(target.querySelector('.empty')!.textContent).toBe('No items yet.');
    cleanup?.();
    ({ target } = mountAccordion(mkSeq(), mkVersion({ state: 'published' })));
    expect(target.querySelector('.empty')!.textContent).toBe('No items.');
  });
});

describe('SequenceAccordion — header trash (Slice-5c T2, D6)', () => {
  it('enabled on an empty sequence: titled "Delete this sequence"', () => {
    const { target } = mountAccordion();
    expect(trash(target).disabled).toBe(false);
    expect(trash(target).title).toBe('Delete this sequence');
  });

  it('items remain → disabled, "Remove its items first"', () => {
    const { target } = mountAccordion(mkSeq({ items: [item] }));
    expect(trash(target).disabled).toBe(true);
    expect(trash(target).title).toBe('Remove its items first');
  });

  it('published → no trash at all', () => {
    const { target } = mountAccordion(mkSeq({ items: [item] }), mkVersion({ state: 'published' }));
    expect(target.querySelector('button[aria-label="Delete sequence Seq"]')).toBeNull();
  });

  it('an open create form → disabled, "Cancel the new item first"', async () => {
    const { target } = mountAccordion();
    plus(target).click();
    await settle();
    expect(trash(target).disabled).toBe(true);
    expect(trash(target).title).toBe('Cancel the new item first');
  });

  it('success: navigates to the block (replace, no prompt) BEFORE the reload', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const replaceSpy = vi.spyOn(history, 'replaceState');
    const { target } = mountAccordion();
    trash(target).click();
    await settle();
    expect(confirmSpy).toHaveBeenCalledWith('Delete sequence "Seq"? This cannot be undone.');
    expect(fetchSpy.mock.calls.some(([u, i]) => String(u) === '/api/sequences/2' && (i as RequestInit).method === 'DELETE')).toBe(true);
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3');
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/courses/c/edit/v/1/blocks/3');
    expect(treeFetchPaths).toEqual(['/courses/c/edit/v/1/blocks/3']);
  });

  it('delete success while a sibling sequence is expanded: reload only, no navigate', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let release!: () => void;
    serve((url, init) => (url === '/api/sequences/2' && init?.method === 'DELETE'
      ? new Promise<void>((r) => { release = r; }).then(() => jres({}))
      : undefined));
    const { target, props } = mountAccordion();
    trash(target).click();
    await settle();
    props.routeSid = '5';
    flushSync();
    release();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3/sequences/2');
    expect(treeFetchPaths.length).toBe(1);
  });

  it('a late delete after a version change neither navigates nor reloads', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let release!: () => void;
    serve((url, init) => (url === '/api/sequences/2' && init?.method === 'DELETE'
      ? new Promise<void>((r) => { release = r; }).then(() => jres({}))
      : undefined));
    const { target, stillOnVid } = mountAccordion();
    trash(target).click();
    await settle();
    stillOnVid.mockReturnValue(false);
    release();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3/sequences/2');
    expect(treeFetchPaths).toEqual([]);
  });
});

describe('SequenceAccordion — item rows (T6)', () => {
  it('passes the structure reason to item rows (published: delete disabled, open enabled)', () => {
    const { target } = mountAccordion(mkSeq({ items: [item] }), mkVersion({ state: 'published' }));
    const del = target.querySelector<HTMLButtonElement>('button[aria-label="Delete Page"]')!;
    expect(del.disabled).toBe(true);
    expect(del.title).toBe('Only a created version can change its structure');
    expect(target.querySelector<HTMLButtonElement>('button[aria-label="Open Page"]')!.disabled).toBe(false);
  });

  const two = () => mkSeq({ items: [item, { ...item, id: 10, title: 'Two', slug: 'two', order: 2 }] });

  it('boundary arrows at the call site: first up / last down disabled with "already first/last"', () => {
    const { target } = mountAccordion(two());
    const btn = (l: string) => target.querySelector<HTMLButtonElement>(`button[aria-label="${l}"]`)!;
    expect([btn('Move item up: Page').disabled, btn('Move item up: Page').title]).toEqual([true, 'Move up — already first']);
    expect([btn('Move item down: Two').disabled, btn('Move item down: Two').title]).toEqual([true, 'Move down — already last']);
    expect(btn('Move item down: Page').disabled).toBe(false);
    expect(btn('Move item up: Two').disabled).toBe(false);
  });

  it('↑ on the second item POSTs the swapped order', async () => {
    const { target } = mountAccordion(two());
    target.querySelector<HTMLButtonElement>('button[aria-label="Move item up: Two"]')!.click();
    await settle();
    const post = fetchSpy.mock.calls.find(([u, i]) => String(u) === '/api/sequences/2/items/reorder' && (i as RequestInit)?.method === 'POST')!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ order: [{ id: 10, order: 1 }, { id: 9, order: 2 }] });
  });

  it('Open navigates to the item editor', async () => {
    const { target } = mountAccordion(mkSeq({ items: [item] }));
    target.querySelector<HTMLButtonElement>('button[aria-label="Open Page"]')!.click();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3/sequences/2/items/9');
  });

  it('an item delete never carries the unsaved suffix (D3)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { target } = mountAccordion(mkSeq({ items: [item] }));
    target.querySelector<HTMLButtonElement>('button[aria-label="Edit the sequence title"]')!.click();
    await settle();
    type(titleInput(target)!, 'Dirty');
    target.querySelector<HTMLButtonElement>('button[aria-label="Delete Page"]')!.click();
    expect(confirmSpy).toHaveBeenCalledWith('Delete "Page"? This cannot be undone.');
  });
});

describe('SequenceAccordion — focus shading (Slice-5c T1)', () => {
  it('the open sequence is the focus; collapsed, it has no shade', () => {
    const { target, props } = mountAccordion();
    expect(target.querySelector('.seq-card')!.classList.contains('focus')).toBe(true);
    props.routeSid = null; flushSync();
    expect(target.querySelector('.seq-card')!.classList.contains('focus')).toBe(false);
    props.routeSid = '77'; flushSync();
    expect(target.querySelector('.seq-card')!.classList.contains('focus')).toBe(false);
  });
});
