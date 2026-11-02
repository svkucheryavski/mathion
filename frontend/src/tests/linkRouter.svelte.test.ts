import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import MiniProjectLink from '../components/course/MiniProjectLink.svelte';
import CourseDeadlines from '../components/course/CourseDeadlines.svelte';
import type { StudentMiniProjectListItem } from '../lib/types';

// navigate is wrapped, not replaced: the handler's moves are real, and the
// tests can count them. The real one is kept for a test that extends it.
const kept = vi.hoisted(() => ({ navigate: null as null | typeof import('../lib/router.svelte').navigate }));
vi.mock('../lib/router.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/router.svelte')>();
  kept.navigate = real.navigate;
  return { ...real, navigate: vi.fn(real.navigate) };
});

import { installLinkRouter } from '../lib/linkRouter';
import {
  navigate,
  currentRoute,
  registerNavigationGuard,
  __resetGuardsForTests,
} from '../lib/router.svelte';

let teardown: () => void;
let left: boolean[];
// Runs after the document listener (bubble order). It records what the
// handler left to the browser and stops jsdom's own navigation attempt.
function recordDefault(e: Event): void {
  left.push(!e.defaultPrevented);
  e.preventDefault();
}

function go(path: string): void {
  history.replaceState(null, '', path);
  currentRoute.path = location.pathname;
  currentRoute.search = location.search;
  currentRoute.hash = location.hash;
}

function link(href: string, attrs: Record<string, string> = {}): HTMLAnchorElement {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  a.textContent = 'x';
  document.body.append(a);
  return a;
}

function click(el: Element, init: MouseEventInit = {}): MouseEvent {
  const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  el.dispatchEvent(e);
  return e;
}

/** Let the handler's awaited navigate() and the scroll after it run. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  __resetGuardsForTests();
  go('/courses');
  left = [];
  window.addEventListener('click', recordDefault);
  vi.mocked(navigate).mockClear();
  // jsdom does not implement scrollTo; the scroll tests read this spy.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  teardown = installLinkRouter();
});

afterEach(() => {
  teardown();
  window.removeEventListener('click', recordDefault);
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('the app-wide link handler (C6)', () => {
  it('a content link to a Mathion page routes, defaultPrevented, no reload', async () => {
    const a = link('/courses/algebra/seq/5');
    const e = click(a);
    expect(e.defaultPrevented).toBe(true);
    await settle();
    expect(navigate).toHaveBeenCalledWith('/courses/algebra/seq/5');
    expect(currentRoute.path).toBe('/courses/algebra/seq/5');
  });

  it('routes a click on a child of the link and an Enter-activated click', async () => {
    const a = link('/teaching');
    const strong = document.createElement('strong');
    a.append(strong);
    expect(click(strong).defaultPrevented).toBe(true);
    await settle();
    expect(currentRoute.path).toBe('/teaching');

    const b = link(`${location.origin}/courses/algebra`);
    expect(click(b, { detail: 0 }).defaultPrevented).toBe(true);
    await settle();
    expect(currentRoute.path).toBe('/courses/algebra');
  });

  it('an /assets/ link, an /api/ link, a download link, a new-window target, another site, mailto:, javascript: and an SVG link are left alone', async () => {
    click(link('/assets/abc/notes.pdf'));
    click(link('/api/runs/8/assets/3'));
    click(link('/courses/algebra', { download: '' }));
    click(link('/courses/algebra', { target: '_blank' }));
    click(link('https://example.org/courses/algebra'));
    click(link('/courses/algebra', { target: '_top' }));
    click(link('mailto:t@x.test'));
    click(link('javascript:void(0)'));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const svgA = document.createElementNS('http://www.w3.org/2000/svg', 'a');
    svgA.setAttribute('href', '/courses/algebra');
    svg.append(svgA);
    document.body.append(svg);
    click(svgA);
    await settle();
    expect(left).toEqual([true, true, true, true, true, true, true, true, true]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a modifier click is left alone', async () => {
    const a = link('/courses/algebra');
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      click(a, init);
    }
    await settle();
    expect(left).toEqual([true, true, true, true, true]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a link already defaultPrevented by its own handler is left alone', async () => {
    const a = link('/courses/algebra');
    a.addEventListener('click', (e) => e.preventDefault());
    click(a);
    await settle();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a same-page #anchor is left alone, an empty # too; a same-path link without a fragment routes', async () => {
    go('/courses/algebra/seq/5#item=7');
    click(link('#intro'));
    click(link('/courses/algebra/seq/5#intro'));
    // A "back to top" link: its fragment is empty, so URL.hash is ''. Routed,
    // it would drop the player's #item= and do nothing a reader expects.
    click(link('#'));
    click(link('/courses/algebra/seq/5#'));
    await settle();
    expect(left).toEqual([true, true, true, true]);
    expect(navigate).not.toHaveBeenCalled();

    expect(click(link('/courses/algebra/seq/5')).defaultPrevented).toBe(true);
    await settle();
    expect(navigate).toHaveBeenCalledWith('/courses/algebra/seq/5');
    expect(currentRoute.hash).toBe('');
  });

  it('a link to / routes; a same-origin /version link is left alone', async () => {
    click(link('/version'));
    await settle();
    expect(left).toEqual([true]);
    expect(navigate).not.toHaveBeenCalled();

    expect(click(link('/')).defaultPrevented).toBe(true);
    await settle();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('a malformed % path is left to the browser', async () => {
    click(link('/courses/%E0%A4%A'));
    await settle();
    expect(left).toEqual([true]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a link to the current address neither reloads nor scrolls', async () => {
    const scroll = vi.mocked(window.scrollTo);
    expect(click(link('/courses')).defaultPrevented).toBe(true);
    await settle();
    expect(currentRoute.path).toBe('/courses');
    expect(scroll).not.toHaveBeenCalled();
  });

  it('after a real move the window scrolls to the top; after a DirtyGuard Cancel it does not', async () => {
    const scroll = vi.mocked(window.scrollTo);
    click(link('/teaching'));
    await settle();
    expect(scroll).toHaveBeenCalledWith(0, 0);

    scroll.mockClear();
    const dispose = registerNavigationGuard(() => false);
    click(link('/courses/algebra'));
    await settle();
    expect(navigate).toHaveBeenLastCalledWith('/courses/algebra');
    expect(currentRoute.path).toBe('/teaching');
    expect(scroll).not.toHaveBeenCalled();
    dispose();
  });

  it('a click overtaken by a newer move does not scroll', async () => {
    const scroll = vi.mocked(window.scrollTo);
    let answer!: (ok: boolean) => void;
    const dispose = registerNavigationGuard(() => new Promise<boolean>((r) => { answer = r; }));
    click(link('/teaching'));
    await settle();
    // Another move lands while the guard still asks (a tab switch, say).
    await navigate('/courses/algebra', { force: true });
    answer(true);
    await settle();
    expect(currentRoute.path).toBe('/courses/algebra');
    expect(scroll).not.toHaveBeenCalled();
    dispose();
  });

  it('a move scrolls even when the new page rewrites its own address at once', async () => {
    // The player adds #item= as it mounts, before the click's navigate() returns
    // to the handler; RunsRedirect replaces the whole path.
    const scroll = vi.mocked(window.scrollTo);
    const real = kept.navigate!;
    vi.mocked(navigate).mockImplementationOnce(async (path, opts) => {
      const moved = await real(path, opts);
      await real(`${path}#item=1001`, { replace: true });
      return moved;
    });
    click(link('/courses/algebra/seq/100'));
    await settle();
    expect(currentRoute.hash).toBe('#item=1001');
    expect(scroll).toHaveBeenCalledWith(0, 0);
  });

  it('a path starting with // is left to the browser', async () => {
    click(link('/.//courses/algebra'));
    await settle();
    expect(left).toEqual([true]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('the mini-project row and a Coming deadlines link route', async () => {
    const item: StudentMiniProjectListItem = {
      mp_id: 1, block_id: 7, block_slug: 'intro', block_order: 0, block_title: 'Introduction',
      deadline: '2026-11-20T12:00:00Z', deadline_kind: 'due', deadline_open: true, latest_status: 'not_submitted',
    };
    const target = document.createElement('div');
    document.body.append(target);
    const row = mount(MiniProjectLink, { target, props: { courseSlug: 'algebra', item } });
    const card = mount(CourseDeadlines, {
      target,
      props: {
        courseSlug: 'algebra',
        lines: [{ item, kind: 'due', at: item.deadline!, urgency: null }],
        blockN: () => 1,
      },
    });
    flushSync();
    const [mp, dl] = Array.from(target.querySelectorAll('a'));

    expect(click(mp).defaultPrevented).toBe(true);
    await settle();
    expect(currentRoute.path).toBe('/courses/algebra/blocks/intro/mini-project');

    go('/courses/algebra');
    expect(click(dl).defaultPrevented).toBe(true);
    await settle();
    expect(currentRoute.path).toBe('/courses/algebra/blocks/intro/mini-project');
    unmount(card);
    unmount(row);
  });

  it('install is idempotent across two App mounts', async () => {
    const second = installLinkRouter();
    click(link('/teaching'));
    await settle();
    expect(navigate).toHaveBeenCalledTimes(1);
    second();
    // One install is still live: links keep routing.
    click(link('/courses/algebra'));
    await settle();
    expect(navigate).toHaveBeenCalledTimes(2);
  });
});
