import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import VersionEditPage from '../pages/editor/VersionEditPage.svelte';
import { clearEditorVersion, loadAdminTree } from '../stores/currentEditorVersion.svelte';
import { navigate, currentRoute, matchRoute, __resetGuardsForTests } from '../lib/router.svelte';
import { routes } from '../routes';
import { toasts, clearToasts } from '../stores/toasts.svelte';
import type { AdminTree, AdminTreeBlock, AdminTreeItem, AdminTreeSequence, AdminTreeVersion } from '../lib/types';
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
  clearToasts();
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
  const plus = () => target.querySelector<HTMLButtonElement>('button[aria-label="New block"]')!;

  it('create-block starts collapsed; + opens it and focuses Title', async () => {
    await render();
    expect(target.querySelector('.cr-form')).toBeNull();
    expect(plus().title).toBe('New block');
    expect(plus().getAttribute('aria-expanded')).toBe('false');
    plus().click();
    await settle();
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

  it('a create failure after a confirmed discard toasts and leaves no stale error for the next open', async () => {
    clearToasts();
    let release!: () => void;
    serve((url, init) => (url === '/api/versions/1/blocks' && init?.method === 'POST'
      ? new Promise<void>((r) => { release = r; }).then(() => jres({ detail: 'Title already taken' }, 409))
      : undefined));
    await render();
    plus().click();
    await settle();
    const title = target.querySelector<HTMLInputElement>('.cr-form input')!;
    title.value = 'Intro';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    title.form!.requestSubmit();
    await settle();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await navigate('/courses/c/edit/v/1/blocks/10');
    await settle();
    expect(target.querySelector('.cr-form')).toBeNull();
    release();
    await settle();
    expect(toasts.list.map((t) => [t.message, t.kind])).toEqual([['Title already taken', 'error']]);
    plus().click();
    await settle();
    expect(target.querySelector<HTMLInputElement>('.cr-form input')!.value).toBe('');
    expect(target.querySelector('.cr-form .field-err')).toBeNull();
    expect(target.querySelector('.cr-form .form-err')).toBeNull();
  });

  it('empty: "No blocks yet" on a created version, "This version has no blocks." otherwise', async () => {
    tree.blocks = [];
    await render();
    expect(target.querySelector('section.blocks .empty-state .title')!.textContent).toBe('No blocks yet');
    unmount(component!);
    component = null;
    tree.version = mkVersion({ state: 'archived' });
    clearEditorVersion();
    await render();
    expect(target.querySelector('section.blocks .empty-state .title')!.textContent).toBe('This version has no blocks.');
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

// Router-driven props, as App.svelte supplies them: getters over the live
// route, so the page follows the accordions' own navigate() calls.
async function renderRouted() {
  const param = (k: string) => matchRoute(routes, currentRoute.path)?.params[k];
  component = mount(VersionEditPage, {
    target,
    props: {
      get courseSlug() { return param('courseSlug') ?? ''; },
      get versionId() { return param('versionId') ?? ''; },
      get blockId() { return param('blockId'); },
      get sequenceId() { return param('sequenceId'); },
      get itemId() { return param('itemId'); },
    },
  });
  await settle();
}

describe('VersionEditPage — a create-sequence draft and a confirmed collapse (D3)', () => {
  it('collapse with a confirmed prompt drops the draft; the next + opens an empty form without a prompt', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await navigate('/courses/c/edit/v/1/blocks/10', { force: true });
    await renderRouted();
    const plus = () => target.querySelector<HTMLButtonElement>('button[aria-label="New sequence in Block 10"]')!;
    const title = () => target.querySelector<HTMLInputElement>('input[aria-label="Sequence title"]');
    plus().click();
    await settle();
    title()!.value = 'Draft';
    title()!.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await navigate('/courses/c/edit/v/1'); // collapse the block: DirtyGuard prompts
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    plus().click(); // collapsed block: expands, then opens the form
    await settle();
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/10');
    expect(title()!.value).toBe('');
  });
});

describe('VersionEditPage — no spurious stale-id toast after a delete (T5b)', () => {
  const seq20: AdminTreeSequence = { id: 20, block_id: 10, title: 'Seq 20', slug: 's20', order: 1, items: [] };

  it('deleting the expanded block lands on the version with no "Block not found."', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    serve((url, init) => {
      if (url === '/api/blocks/10' && init?.method === 'DELETE') { tree.blocks = []; return jres({}); }
      return undefined;
    });
    await navigate('/courses/c/edit/v/1/blocks/10', { force: true });
    await renderRouted();
    target.querySelector<HTMLButtonElement>('button[aria-label="Delete block Block 10"]')!.click();
    await settle();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    expect(target.querySelector('#block-10-header')).toBeNull();
    expect(toasts.list.map((t) => t.message)).not.toContain('Block not found.');
  });

  it('deleting the expanded sequence lands on its block with no "Sequence not found."', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    tree.blocks = [mkBlock(10, { sequences: [seq20] })];
    serve((url, init) => {
      if (url === '/api/sequences/20' && init?.method === 'DELETE') { tree.blocks[0].sequences = []; return jres({}); }
      return undefined;
    });
    await navigate('/courses/c/edit/v/1/blocks/10/sequences/20', { force: true });
    await renderRouted();
    target.querySelector<HTMLButtonElement>('button[aria-label="Delete sequence Seq 20"]')!.click();
    await settle();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/10');
    expect(target.querySelector('#seq-20-header')).toBeNull();
    expect(toasts.list.map((t) => t.message)).not.toContain('Sequence not found.');
  });
});

// ---- Slice-5b T3b: the item modal hosted on the item route ----
function mkItem(id: number, over: Partial<AdminTreeItem> = {}): AdminTreeItem {
  return {
    id, sequence_id: 20, title: `Item ${id}`, slug: `i${id}`, order: id, type: 'static_page',
    content_md: `body ${id}`, content_html: '', video_url: null, script_url: null, questions_count: 0, ...over,
  };
}
const SEQ = '/courses/c/edit/v/1/blocks/10/sequences/20';
const ITEM = (id: number) => `${SEQ}/items/${id}`;
// jsdom fires popstate for history.back() on the SECOND macrotask after the
// call (probed: one setTimeout(0) is not enough), so wait two timer hops.
const tick0 = () => new Promise((r) => setTimeout(r, 0));
async function waitPop() { await tick0(); await tick0(); await settle(); await settle(); }
const modal = () => document.querySelector<HTMLElement>('section.modal-panel');
const xBtn = () => modal()!.querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
const trashBtn = () => modal()!.querySelector<HTMLButtonElement>('button[aria-label="Delete item"]')!;
const pencil = (id: number) => document.getElementById(`item-${id}-open`) as HTMLButtonElement | null;
const titleField = () => modal()!.querySelector<HTMLInputElement>('input[aria-label="Title"]')!;
const msgs = () => toasts.list.map((t) => t.message);
function typeInto(el: HTMLInputElement, v: string) {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
const esc = (init: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init }));
// A DELETE /api/items/{id} held until release(); release() also drops the item from the served tree.
function holdDelete(id: number) {
  let release!: () => void;
  serve((url, init) => {
    if (url === `/api/items/${id}` && init?.method === 'DELETE') {
      return new Promise<Response>((r) => {
        release = () => {
          const s = tree.blocks[0].sequences[0];
          s.items = s.items.filter((x) => x.id !== id);
          void jres({}).then(r);
        };
      });
    }
    return undefined;
  });
  return () => release();
}

describe('VersionEditPage — the item modal (Slice-5b T3b)', () => {
  beforeEach(() => {
    tree.blocks = [mkBlock(10, { sequences: [{ id: 20, block_id: 10, title: 'Seq 20', slug: 's20', order: 1, items: [mkItem(30), mkItem(31)] }] })];
  });
  async function openFromPage(id = 30) {
    await navigate(SEQ, { force: true });
    await renderRouted();
    pencil(id)!.focus();
    pencil(id)!.click();
    await settle();
  }

  it('Open, then ×: the modal closes, the sequence stays open, focus is back on the pencil', async () => {
    await openFromPage();
    expect(currentRoute.path).toBe(ITEM(30));
    expect(modal()!.querySelector('h2.item-name')!.textContent).toBe('Item 30');
    expect(modal()!.querySelector('.item-ctx')!.textContent).toBe('static page · S1 · item 1 of 2');
    xBtn().click();
    await waitPop();
    expect(currentRoute.path).toBe(SEQ);
    expect(modal()).toBeNull();
    expect(document.activeElement).toBe(pencil(30));
  });

  it('restore beats fallback: focus returns to what had it when the item opened', async () => {
    await navigate(SEQ, { force: true });
    await renderRouted();
    const header = target.querySelector<HTMLElement>('#seq-20-header')!;
    header.focus();
    await navigate(ITEM(30));
    await settle();
    expect(modal()).not.toBeNull();
    xBtn().click();
    await waitPop();
    expect(document.activeElement).toBe(header);
  });

  it('in-page open: ×, × and Escape call history.back() once and stop on the sequence', async () => {
    await openFromPage();
    const back = vi.spyOn(history, 'back');
    xBtn().click();
    xBtn().click();
    esc();
    expect(back).toHaveBeenCalledTimes(1);
    await waitPop();
    expect(currentRoute.path).toBe(SEQ);
  });

  it('Escape closes; an auto-repeat Escape does not', async () => {
    await openFromPage();
    const back = vi.spyOn(history, 'back');
    esc({ repeat: true });
    expect(back).not.toHaveBeenCalled();
    esc();
    expect(back).toHaveBeenCalledTimes(1);
    await waitPop();
    expect(modal()).toBeNull();
  });

  it('a prompt cancelled on × re-arms it; the next confirmed × closes', async () => {
    await openFromPage();
    typeInto(titleField(), 'Draft');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const back = vi.spyOn(history, 'back');
    xBtn().click();
    await waitPop();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(currentRoute.path).toBe(ITEM(30));
    expect(titleField().value).toBe('Draft');
    confirmSpy.mockReturnValue(true);
    xBtn().click();
    await waitPop();
    expect(back).toHaveBeenCalledTimes(2);
    expect(currentRoute.path).toBe(SEQ);
    expect(modal()).toBeNull();
  });

  it('deep link, then ×: the address is replaced with the sequence; history.back() is never used', async () => {
    await navigate(ITEM(30), { force: true });
    await renderRouted();
    const back = vi.spyOn(history, 'back');
    const replace = vi.spyOn(history, 'replaceState');
    xBtn().click();
    await settle();
    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(null, '', SEQ);
    expect(currentRoute.path).toBe(SEQ);
    expect(modal()).toBeNull();
  });

  it('deep link with a draft: × prompts, cancel keeps the draft and re-arms; Escape prompts again', async () => {
    await navigate(ITEM(30), { force: true });
    await renderRouted();
    typeInto(titleField(), 'Draft');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    xBtn().click();
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(currentRoute.path).toBe(ITEM(30));
    expect(titleField().value).toBe('Draft');
    esc();
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(titleField().value).toBe('Draft');
  });

  it('browser Back and the course link prompt while the modal has a draft; cancel keeps it', async () => {
    await openFromPage();
    typeInto(titleField(), 'Draft');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    history.back();
    await waitPop();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(modal()).not.toBeNull();
    target.querySelector<HTMLAnchorElement>('h1 a')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(currentRoute.path).toBe(ITEM(30));
    expect(titleField().value).toBe('Draft');
  });

  it('a stale item address toasts "Item not found." and replaces the address with the sequence', async () => {
    await navigate(ITEM(999), { force: true });
    await renderRouted();
    await settle();
    expect(msgs()).toContain('Item not found.');
    expect(currentRoute.path).toBe(SEQ);
    expect(modal()).toBeNull();
  });

  it('delete: one confirm, frozen in flight, one replace+force close after which the reload lands, then toast and header focus', async () => {
    const release = holdDelete(30);
    let modalAtReload: boolean | null = null;
    const inner = fetchSpy.getMockImplementation()!;
    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/admin-tree') && modalAtReload === false) modalAtReload = modal() !== null;
      return inner(url, init);
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openFromPage();
    const back = vi.spyOn(history, 'back');
    const replace = vi.spyOn(history, 'replaceState');
    trashBtn().click();
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith('Delete item "Item 30"? This cannot be undone.');
    expect(modal()!.querySelector('div.modal-body')!.hasAttribute('inert')).toBe(true);
    xBtn().click();
    esc();
    await settle();
    expect(back).not.toHaveBeenCalled();
    expect(currentRoute.path).toBe(ITEM(30));
    modalAtReload = false;           // arm: record the modal's presence at the next tree GET
    release();
    await settle();
    await settle();
    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(null, '', SEQ);
    expect(currentRoute.path).toBe(SEQ);
    expect(modal()).toBeNull();
    expect(modalAtReload).toBe(false);   // the reload ran after the modal unmounted
    expect(pencil(30)).toBeNull();
    expect(msgs()).toContain('Item deleted');
    expect(msgs()).not.toContain('Item not found.');
    expect(document.activeElement).toBe(target.querySelector('#seq-20-header'));
  });

  it('a failed DELETE keeps the modal open and unfrozen, with focus on the trash', async () => {
    serve((url, init) => (url === '/api/items/30' && init?.method === 'DELETE' ? jres({ detail: 'Nope' }, 409) : undefined));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openFromPage();
    trashBtn().click();
    await settle();
    await settle();
    expect(msgs()).toContain('Nope');
    expect(currentRoute.path).toBe(ITEM(30));
    expect(modal()!.querySelector('div.modal-body')!.hasAttribute('inert')).toBe(false);
    expect(xBtn().disabled).toBe(false);
    expect(document.activeElement).toBe(trashBtn());
  });

  it('browser Back during the DELETE, then another item: not frozen, × works, and the late success never navigates', async () => {
    const release = holdDelete(30);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openFromPage(30);
    trashBtn().click();
    await settle();
    history.back();
    await waitPop();
    expect(currentRoute.path).toBe(SEQ);
    pencil(31)!.focus();
    pencil(31)!.click();
    await settle();
    expect(modal()!.querySelector('h2.item-name')!.textContent).toBe('Item 31');
    expect(modal()!.querySelector('div.modal-body')!.hasAttribute('inert')).toBe(false);
    expect(xBtn().disabled).toBe(false);
    const back = vi.spyOn(history, 'back');
    release();
    await settle();
    await settle();
    expect(currentRoute.path).toBe(ITEM(31));
    expect(back).not.toHaveBeenCalled();
    xBtn().click();
    await waitPop();
    expect(back).toHaveBeenCalledTimes(1);
    expect(currentRoute.path).toBe(SEQ);
  });

  it('the page behind cannot take focus while the modal is open', async () => {
    await openFromPage();
    target.querySelector<HTMLElement>('#seq-20-header')!.focus();
    expect(modal()!.contains(document.activeElement)).toBe(true);
  });

  it('after creating an item the modal opens on it; closing lands focus on its Open pencil', async () => {
    serve((url, init) => {
      if (url === '/api/sequences/20/items' && init?.method === 'POST') {
        tree.blocks[0].sequences[0].items.push(mkItem(99, { title: 'Fresh' }));
        return jres({ id: 99 });
      }
      return undefined;
    });
    await navigate(SEQ, { force: true });
    await renderRouted();
    target.querySelector<HTMLButtonElement>('button[aria-label="New item in Seq 20"]')!.click();
    await settle();
    const t = target.querySelector<HTMLInputElement>('input[aria-label="Item title"]')!;
    typeInto(t, 'Fresh');
    const create = [...t.form!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === 'Create')!;
    create.focus();
    t.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle();
    expect(currentRoute.path).toBe(ITEM(99));
    expect(modal()!.querySelector('h2.item-name')!.textContent).toBe('Fresh');
    xBtn().click();
    await waitPop();
    expect(currentRoute.path).toBe(SEQ);
    expect(document.activeElement).toBe(pencil(99));
  });

  it("after a deep-link close, focus lands on the closed item's Open pencil", async () => {
    await navigate(ITEM(31), { force: true });
    await renderRouted();
    xBtn().click();
    await settle();
    await settle();
    expect(currentRoute.path).toBe(SEQ);
    expect(document.activeElement).toBe(pencil(31));
  });

  it('a tree reload with focus on body does not move focus', async () => {
    await navigate(SEQ, { force: true });
    await renderRouted();
    (document.activeElement as HTMLElement | null)?.blur();
    target.querySelector<HTMLButtonElement>('button[aria-label="Move item down: Item 30"]')!.click();
    await settle();
    await settle();
    expect(document.activeElement).toBe(document.body);
  });

  it('the item is deleted elsewhere while its modal is open: the reload closes it with "Item not found.", no error', async () => {
    await openFromPage();
    const errors: unknown[] = [];
    const onErr = (e: ErrorEvent) => { errors.push(e.error ?? e.message); };
    window.addEventListener('error', onErr);
    tree.blocks[0].sequences[0].items = [mkItem(31)];
    await loadAdminTree(1, { force: true });
    await settle();
    await settle();
    window.removeEventListener('error', onErr);
    expect(errors).toEqual([]);
    expect(msgs()).toContain('Item not found.');
    expect(currentRoute.path).toBe(SEQ);
    expect(modal()).toBeNull();
  });
});

// ---- Slice-5c T1: focus by depth ----
describe('VersionEditPage — focus by depth (Slice-5c T1)', () => {
  const seq20: AdminTreeSequence = { id: 20, block_id: 10, title: 'Seq 20', slug: 's20', order: 1, items: [] };
  const canvas = () => target.querySelector('.canvas')!;
  const depthOf = () => ['d0', 'd1', 'd2'].filter((c) => canvas().classList.contains(c));

  it('depth classes follow navigation: d0 → d1 → d2 → d1 → d0 (Back included)', async () => {
    tree.blocks = [mkBlock(10, { sequences: [seq20] })];
    await renderRouted();
    expect(depthOf()).toEqual(['d0']);
    await navigate('/courses/c/edit/v/1/blocks/10'); await settle();
    expect(depthOf()).toEqual(['d1']);
    await navigate('/courses/c/edit/v/1/blocks/10/sequences/20'); await settle();
    expect(depthOf()).toEqual(['d2']);
    history.back(); await waitPop();
    expect(depthOf()).toEqual(['d1']);
    history.back(); await waitPop();
    expect(depthOf()).toEqual(['d0']);
    history.forward(); await waitPop();
    expect(depthOf()).toEqual(['d1']);
  });

  it('exactly one container is the focus at every depth', async () => {
    tree.blocks = [mkBlock(10, { sequences: [seq20] }), mkBlock(11)];
    await navigate('/courses/c/edit/v/1/blocks/10/sequences/20', { force: true });
    await renderRouted();
    expect(target.querySelectorAll('.focus').length).toBe(1);
    expect(target.querySelector('.seq-card.focus')).not.toBeNull();
    expect(target.querySelectorAll('.block-card.parent').length).toBe(1);
    await navigate('/courses/c/edit/v/1/blocks/10'); await settle();
    expect(target.querySelectorAll('.focus').length).toBe(1);
    expect(target.querySelector('.block-card.focus')).not.toBeNull();
    expect(target.querySelector('.block-card.parent')).toBeNull();
    await navigate('/courses/c/edit/v/1'); await settle();
    expect(target.querySelectorAll('.focus, .parent').length).toBe(0);
  });

  it('an h2 named Blocks (visually hidden) labels section.blocks, so block h3s keep their parent level', async () => {
    await render();
    const sec = target.querySelector<HTMLElement>('section.blocks')!;
    const h2 = document.getElementById(sec.getAttribute('aria-labelledby')!)!;
    expect(h2.tagName).toBe('H2');
    expect(h2.textContent).toBe('Blocks');
    expect(h2.classList.contains('sr-only')).toBe(true);
    expect(sec.firstElementChild).toBe(h2);
  });

  it('a stale sequence id falls back to its block: d1, the block is the one focus', async () => {
    tree.blocks = [mkBlock(10, { sequences: [seq20] })];
    await navigate('/courses/c/edit/v/1/blocks/10/sequences/999', { force: true });
    await renderRouted();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/10');
    expect(depthOf()).toEqual(['d1']);
    expect(target.querySelectorAll('.focus').length).toBe(1);
    expect(target.querySelector('.block-card.focus')).not.toBeNull();
  });

  it('the Blocks card head and its fold are gone', async () => {
    await render();
    expect(target.querySelector('.blocks-card')).toBeNull();
    expect(target.querySelector('button[aria-label="Collapse blocks"]')).toBeNull();
    expect(target.querySelector('section.blocks .blocks-list')).not.toBeNull();
  });

  it('a stale block id falls back and the canvas returns to d0', async () => {
    await navigate('/courses/c/edit/v/1/blocks/999', { force: true });
    await renderRouted();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    expect(depthOf()).toEqual(['d0']);
  });
});
