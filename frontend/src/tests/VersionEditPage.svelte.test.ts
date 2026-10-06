import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import VersionEditPage from '../pages/editor/VersionEditPage.svelte';
import { clearEditorVersion } from '../stores/currentEditorVersion.svelte';
import { navigate, currentRoute, __resetGuardsForTests } from '../lib/router.svelte';
import type { AdminTree, AdminTreeBlock, AdminTreeVersion } from '../lib/types';
import type { DirtyRegistry } from '../lib/dirtyRegistry.svelte';

// Capture the page's real registry so a test can register a dirty tracker
// without depending on which body (old panel / InlineField) a block renders.
const hoisted = vi.hoisted(() => ({ registry: null as DirtyRegistry | null }));
vi.mock('../lib/dirtyRegistry.svelte', async (importOriginal) => {
  const m = await importOriginal<typeof import('../lib/dirtyRegistry.svelte')>();
  return { ...m, createDirtyRegistry: () => (hoisted.registry = m.createDirtyRegistry()) };
});

// Real router + real store; only fetch is stubbed (SequenceAccordion.interactive idiom).
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
// jsdom has no scrollIntoView; the page's focus $effect calls it on route expansion.
Element.prototype.scrollIntoView = () => {};

function mkVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return {
    id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '',
    max_quiz_attempts: 3, label: 'Autumn 2026 revision', created_at: '2026-01-01T00:00:00Z',
    published_at: null, archived_at: null, content_updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}
function mkBlock(id: number, over: Partial<AdminTreeBlock> = {}): AdminTreeBlock {
  return { id, version_id: 1, title: `Block ${id}`, slug: `b${id}`, order: id, info: '', info_html: '', sequences: [], ...over };
}

let tree: AdminTree;
let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

// The admin-tree GET serves `tree` as it stands at call time, so a test can
// mutate `tree` before a refresh to model the server's new state.
function serve(extra: (url: string, init?: RequestInit) => Promise<Response> | undefined = () => undefined) {
  fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
    const custom = extra(String(url), init);
    if (custom) return custom;
    if (String(url).endsWith('/admin-tree')) return jres(structuredClone(tree));
    return jres({});
  });
}

beforeEach(async () => {
  __resetGuardsForTests();
  await navigate('/courses/c/edit/v/1', { force: true });
  tree = { course: { id: 1, name: 'Applied Linear Algebra', slug: 'c' }, version: mkVersion(), blocks: [mkBlock(10)] };
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  serve();
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (target.parentNode) target.parentNode.removeChild(target);
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  clearEditorVersion();
  __resetGuardsForTests();
  vi.restoreAllMocks();
});

async function render(props: Record<string, string> = { courseSlug: 'c', versionId: '1' }) {
  component = mount(VersionEditPage, { target, props: props as { courseSlug: string; versionId: string } });
  await settle();
}

describe('VersionEditPage — heading (3b, §5.2)', () => {
  it('leads with the course link, then " · label", the mono id and the badges', async () => {
    await render();
    const h1 = target.querySelector('h1')!;
    expect(h1.textContent).toBe('Applied Linear Algebra · Autumn 2026 revision');
    const a = h1.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('/courses/c/edit');
    expect(a.title).toBe('Back to versions');
    const vid = target.querySelector('.editor-heading .vid')!;
    expect(vid.textContent).toBe('v1');
    expect(vid.classList.contains('mono')).toBe(true);
    expect(target.querySelector('.editor-heading .vbadge')!.textContent).toBe('created');
  });

  it('without a label the h1 is the course link only', async () => {
    tree.version = mkVersion({ label: '' });
    await render();
    expect(target.querySelector('h1')!.textContent).toBe('Applied Linear Algebra');
  });

  it('a plain click on the course link routes in-app', async () => {
    await render();
    const a = target.querySelector<HTMLAnchorElement>('h1 a')!;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    a.dispatchEvent(ev);
    await settle();
    expect(ev.defaultPrevented).toBe(true);
    expect(currentRoute.path).toBe('/courses/c/edit');
  });

  it('a Cmd/Ctrl-click on the course link is not intercepted', async () => {
    await render();
    let prevented: boolean | null = null;
    // Runs after the app's delegated handler; it records, then blocks jsdom's own navigation.
    const probe = (e: Event) => { prevented = e.defaultPrevented; e.preventDefault(); };
    window.addEventListener('click', probe);
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      target.querySelector('h1 a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...mod }));
      await settle();
      expect(prevented).toBe(false);
      expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    }
    window.removeEventListener('click', probe);
  });

  it('a disabled version shows the information banner', async () => {
    tree.version = mkVersion({ is_disabled: true });
    await render();
    expect(target.querySelector('.banner')!.textContent).toBe('This version is disabled — editing is not allowed. Enable it first.');
  });
});

describe('VersionEditPage — page states (9d)', () => {
  it('an invalid id renders a page ErrorState with Back to versions', async () => {
    await render({ courseSlug: 'c', versionId: 'abc' });
    const es = target.querySelector('.error-state.page')!;
    expect(es.querySelector('h1')!.textContent).toBe('Bad URL');
    const back = [...es.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Back to versions')!;
    back.click();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit');
  });

  it('a load failure without a tree renders "Couldn\'t load"', async () => {
    serve((url) => (url.endsWith('/admin-tree') ? jres({ detail: 'Boom' }, 500) : undefined));
    await render();
    const es = target.querySelector('.error-state.page')!;
    expect(es.querySelector('h1')!.textContent).toBe("Couldn't load");
    expect(es.textContent).toContain('Boom');
  });

  it('shows a Skeleton until the tree arrives', async () => {
    let release!: () => void;
    serve((url) => (url.endsWith('/admin-tree') ? new Promise<void>((r) => { release = r; }).then(() => jres(structuredClone(tree))) : undefined));
    component = mount(VersionEditPage, { target, props: { courseSlug: 'c', versionId: '1' } });
    flushSync();
    expect(target.querySelector('.skeleton')).not.toBeNull();
    release();
    await settle();
    expect(target.querySelector('.skeleton')).toBeNull();
  });
});

describe('VersionEditPage — Version info card', () => {
  const field = (label: string) =>
    [...target.querySelectorAll<HTMLElement>('.meta-card .inline-field')].find((f) => f.querySelector('.label')?.textContent === label)!;

  it('renders three inline fields, editable on a created version', async () => {
    await render();
    const labels = [...target.querySelectorAll('.meta-card .inline-field .label')].map((l) => l.textContent);
    expect(labels).toEqual(['Label', 'Info (markdown)', 'Max quiz attempts']);
    expect(field('Label').querySelector<HTMLButtonElement>('button[data-glyph="pencil"]')!.disabled).toBe(false);
  });

  it('a published version still shows the fields, pencils disabled with the reason (D4)', async () => {
    tree.version = mkVersion({ state: 'published' });
    await render();
    const pencil = field('Label').querySelector<HTMLButtonElement>('button[data-glyph="pencil"]')!;
    expect(pencil.disabled).toBe(true);
    expect(pencil.title).toBe('Only a created version can change its info');
  });

  it('folding keeps an open dirty draft mounted (D3)', async () => {
    await render();
    field('Label').querySelector<HTMLButtonElement>('button[data-glyph="pencil"]')!.click();
    await settle();
    const input = field('Label').querySelector('input')!;
    input.value = 'Draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const fold = target.querySelector<HTMLButtonElement>('button[aria-label="Collapse version info"]')!;
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    fold.click();
    flushSync();
    const body = document.getElementById(fold.getAttribute('aria-controls')!)!;
    expect(body.hidden).toBe(true);
    expect(body.contains(input)).toBe(true);
    expect(input.value).toBe('Draft');
    expect(target.querySelector('button[aria-label="Expand version info"]')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('a confirmed navigation discards the open draft (onDiscard → discardAll)', async () => {
    await render();
    field('Label').querySelector<HTMLButtonElement>('button[data-glyph="pencil"]')!.click();
    await settle();
    const input = field('Label').querySelector('input')!;
    input.value = 'Draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await navigate('/courses/c/edit/v/1/blocks/10');
    await settle();
    expect(field('Label').querySelector('input')).toBeNull();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/10');
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // The draft really went: the next navigation does not prompt again (Review Focus 3).
    await navigate('/courses/c/edit/v/1');
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
  });
});

type PageProps = { courseSlug: string; versionId: string; blockId?: string; sequenceId?: string };

// Props as a $state object so a test can change the route block id in place,
// as App.svelte does when the router matches a new URL on the same page.
async function renderReactive(init: PageProps = { courseSlug: 'c', versionId: '1' }) {
  const props = $state<PageProps>(init);
  component = mount(VersionEditPage, { target, props });
  await settle();
  return props;
}

function openLabelDraft() {
  const row = [...target.querySelectorAll<HTMLElement>('.meta-card .inline-field')].find((f) => f.querySelector('.label')?.textContent === 'Label')!;
  row.querySelector<HTMLButtonElement>('button[data-glyph="pencil"]')!.click();
}
async function makeDirty() {
  openLabelDraft();
  await settle();
  const input = target.querySelector<HTMLInputElement>('.meta-card .inline-field input')!;
  input.value = 'Draft';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
const btnByText = (text: string) =>
  [...target.querySelectorAll<HTMLButtonElement>('.state-actions button')].find((b) => b.textContent?.trim() === text);
const posts = () => fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST').map(([u]) => String(u));

describe('VersionEditPage — Blocks card (T4)', () => {
  const fold = () => target.querySelector<HTMLButtonElement>('.blocks-card .card-head button[aria-controls]')!;
  const body = () => document.getElementById(fold().getAttribute('aria-controls')!)!;
  const plus = () => target.querySelector<HTMLButtonElement>('button[aria-label="New block"]')!;

  it('folds and unfolds; the body stays mounted', async () => {
    await render();
    expect(fold().getAttribute('aria-label')).toBe('Collapse blocks');
    expect(fold().title).toBe('Collapse');
    fold().click();
    flushSync();
    expect(body().hidden).toBe(true);
    expect(body().querySelector('.blocks-list')).not.toBeNull();
    expect(fold().getAttribute('aria-label')).toBe('Expand blocks');
    expect(fold().getAttribute('aria-expanded')).toBe('false');
    expect(fold().dataset.glyph).toBe('chevron-right');
  });

  it('a route expansion unfolds a folded card, and so does block A → block B', async () => {
    tree.blocks = [mkBlock(10), mkBlock(11)];
    const props = await renderReactive();
    fold().click();
    flushSync();
    expect(body().hidden).toBe(true);
    props.blockId = '10';
    await settle();
    expect(body().hidden).toBe(false);
    fold().click();
    flushSync();
    expect(body().hidden).toBe(true);
    props.blockId = '11';
    await settle();
    expect(body().hidden).toBe(false);
  });

  it('folding while a block is expanded stays folded', async () => {
    const props = await renderReactive({ courseSlug: 'c', versionId: '1', blockId: '10' });
    expect(props.blockId).toBe('10');
    fold().click();
    await settle();
    expect(body().hidden).toBe(true);
  });

  it('create-block starts collapsed; + opens it, unfolds the card and focuses Title', async () => {
    await render();
    expect(target.querySelector('.cr-form')).toBeNull();
    expect(plus().title).toBe('New block');
    expect(plus().getAttribute('aria-expanded')).toBe('false');
    fold().click();
    flushSync();
    plus().click();
    await settle();
    expect(body().hidden).toBe(false);
    const title = target.querySelector<HTMLInputElement>('.cr-form input')!;
    expect(document.activeElement).toBe(title);
    expect(plus().getAttribute('aria-label')).toBe('New block');
    expect(plus().title).toBe('Cancel new block');
    expect(plus().dataset.glyph).toBe('close');
    expect(plus().getAttribute('aria-expanded')).toBe('true');
    plus().click();
    await settle();
    expect(target.querySelector('.cr-form')).toBeNull();
  });

  it('+ is always rendered; on a published version it is disabled with the structure reason', async () => {
    tree.version = mkVersion({ state: 'published' });
    await render();
    expect(plus().disabled).toBe(true);
    expect(plus().title).toBe('Only a created version can change its structure');
  });

  it('+ is not blocked by an open draft (D3)', async () => {
    await render();
    await makeDirty();
    expect(plus().disabled).toBe(false);
  });

  it('a confirmed navigation discards a typed create-block title', async () => {
    await render();
    plus().click();
    await settle();
    const title = target.querySelector<HTMLInputElement>('.cr-form input')!;
    title.value = 'New block';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await navigate('/courses/c/edit/v/1/blocks/10');
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(target.querySelector('.cr-form')).toBeNull();
    await navigate('/courses/c/edit/v/1');
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('empty: "No blocks yet" on a created version, "This version has no blocks." otherwise', async () => {
    tree.blocks = [];
    await render();
    expect(target.querySelector('.blocks-card .empty-state .title')!.textContent).toBe('No blocks yet');
    unmount(component!);
    component = null;
    tree.version = mkVersion({ state: 'archived' });
    clearEditorVersion();
    await render();
    expect(target.querySelector('.blocks-card .empty-state .title')!.textContent).toBe('This version has no blocks.');
  });
});

describe('VersionEditPage — state bar (T4)', () => {
  const labels = () => [...target.querySelectorAll('.state-actions button')].map((b) => [b.textContent?.trim(), (b as HTMLElement).dataset.variant]);

  it('created: Publish (primary), Disable (ghost), Delete (danger)', async () => {
    await render();
    expect(labels()).toEqual([['Publish', 'primary'], ['Disable', 'ghost'], ['Delete', 'danger']]);
  });

  it('published: Archive + Revert (secondary), Disable (ghost)', async () => {
    tree.version = mkVersion({ state: 'published' });
    await render();
    expect(labels()).toEqual([['Archive', 'secondary'], ['Revert', 'secondary'], ['Disable', 'ghost']]);
  });

  it('disabled created: Enable (ghost) only', async () => {
    tree.version = mkVersion({ is_disabled: true });
    await render();
    expect(labels()).toEqual([['Enable', 'ghost']]);
  });

  it('a dirty field does not block Publish; the confirm warns', async () => {
    await render();
    await makeDirty();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    btnByText('Publish')!.click();
    await settle();
    expect(confirmSpy).toHaveBeenCalledWith('Publish version 1? Students will see it. Unsaved edits may be lost.');
    expect(posts()).toContain('/api/versions/1/publish');
  });

  it('a publish on the current version refreshes the page to the new state', async () => {
    await render();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    tree.version = mkVersion({ state: 'published' }); // the server's state after the POST
    btnByText('Publish')!.click();
    await settle();
    expect(target.querySelector('.editor-heading .vbadge')!.textContent).toBe('published');
    expect(btnByText('Archive')).toBeDefined();
  });

  it('archive and disable warn when dirty; revert and enable never do', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    tree.version = mkVersion({ state: 'published' });
    await render();
    hoisted.registry!.register({ isDirty: true });
    btnByText('Archive')!.click();
    btnByText('Disable')!.click();
    btnByText('Revert')!.click();
    expect(confirmSpy.mock.calls.map(([m]) => m)).toEqual([
      'Archive version 1? Unsaved edits may be lost.',
      'Disable version 1? Unsaved edits may be lost.',
      'Revert version 1 to created?',
    ]);
  });

  it('enable never carries the suffix', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    tree.version = mkVersion({ is_disabled: true });
    await render();
    hoisted.registry!.register({ isDirty: true }); // dirty, so a suffix would show
    btnByText('Enable')!.click();
    expect(confirmSpy).toHaveBeenCalledWith('Enable version 1?');
  });

  it('a clean page confirms without the suffix', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await render();
    btnByText('Publish')!.click();
    expect(confirmSpy).toHaveBeenCalledWith('Publish version 1? Students will see it.');
  });

  it('delete-version warns when dirty and navigates with force (one prompt only)', async () => {
    await render();
    await makeDirty();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    btnByText('Delete')!.click();
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith('Delete version v1? This cannot be undone. Unsaved edits may be lost.');
    expect(fetchSpy.mock.calls.some(([u, init]) => String(u) === '/api/versions/1' && (init as RequestInit).method === 'DELETE')).toBe(true);
    expect(currentRoute.path).toBe('/courses/c/edit');
  });

  it('delete-version replaces the history entry, so Back skips the deleted version', async () => {
    await render();
    const replaceSpy = vi.spyOn(history, 'replaceState');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    btnByText('Delete')!.click();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit');
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/courses/c/edit');
  });
});

describe('VersionEditPage — a late transition / delete after a version switch (Review Focus 4)', () => {
  function holdOn(match: (url: string, init?: RequestInit) => boolean) {
    let release!: () => void;
    const held = new Promise<Response>((r) => { release = () => r(jres({}) as unknown as Response); });
    serve((url, init) => {
      if (match(url, init)) return held.then(() => jres({}));
      if (url.endsWith('/versions/2/admin-tree')) {
        return jres({ ...structuredClone(tree), version: mkVersion({ id: 2, label: 'Second' }) });
      }
      return undefined;
    });
    return () => release();
  }

  it('a publish that lands after switching to v2 does not reload v1 over it', async () => {
    const release = holdOn((u) => u === '/api/versions/1/publish');
    const props = await renderReactive();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    btnByText('Publish')!.click();
    await settle();
    props.versionId = '2';
    await settle();
    expect(target.querySelector('.editor-heading .vid')!.textContent).toBe('v2');
    release();
    await settle();
    expect(target.querySelector('.skeleton')).toBeNull();
    expect(target.querySelector('.editor-heading .vid')!.textContent).toBe('v2');
    expect(fetchSpy.mock.calls.filter(([u]) => String(u) === '/api/versions/1/admin-tree')).toHaveLength(1);
  });

  it('a delete that lands after switching to v2 does not navigate away', async () => {
    const release = holdOn((u, init) => u === '/api/versions/1' && init?.method === 'DELETE');
    const props = await renderReactive();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    btnByText('Delete')!.click();
    await settle();
    props.versionId = '2';
    await settle();
    release();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    expect(target.querySelector('.editor-heading .vid')!.textContent).toBe('v2');
  });
});
