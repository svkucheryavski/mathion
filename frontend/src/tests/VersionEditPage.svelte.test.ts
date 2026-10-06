import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import VersionEditPage from '../pages/editor/VersionEditPage.svelte';
import { clearEditorVersion } from '../stores/currentEditorVersion.svelte';
import { navigate, currentRoute, __resetGuardsForTests } from '../lib/router.svelte';
import type { AdminTree, AdminTreeBlock, AdminTreeVersion } from '../lib/types';

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
