import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import BlockAccordion from '../components/editor/BlockAccordion.svelte';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../lib/dirtyRegistry.svelte';
import { currentEditorVersion } from '../stores/currentEditorVersion.svelte';
import { navigate, currentRoute, matchRoute, registerNavigationGuard, __resetGuardsForTests } from '../lib/router.svelte';
import { routes } from '../routes';
import type { AdminTreeBlock, AdminTreeVersion } from '../lib/types';

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

let target: HTMLDivElement;
let registry: DirtyRegistry;
let cleanup: (() => void) | null = null;

beforeEach(async () => {
  __resetGuardsForTests();
  await navigate('/courses/c/edit/v/1', { force: true });
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(() => jres({}));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  currentEditorVersion.value = { course: { id: 1, name: 'C', slug: 'c' }, version: mkVersion(), blocks: [mkBlock()] };
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

// Dirty the block's own title draft (the pre-T5b Save/Discard panel input).
function dirtyBlockTitle() {
  const input = target.querySelector<HTMLInputElement>('#block-3-panel .meta input')!;
  input.value = 'Changed';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
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
    dirtyBlockTitle();
    expect(registry.isAnyDirty()).toBe(true);
    target.querySelector<HTMLButtonElement>('[aria-label="Move sequence down: S one"]')!.click();
    await settle();
    expect(fetchSpy.mock.calls.some(([u]) => String(u) === '/api/blocks/3/sequences/reorder')).toBe(true);
  });
});
