import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunListPage from '../pages/runs/RunListPage.svelte';
import * as routerModule from '../lib/router.svelte';
import { expectRoutesInApp } from './support/routeClickProbe';
import { currentRoute, __resetGuardsForTests } from '../lib/router.svelte';
import { session } from '../stores/session.svelte';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  globalThis.fetch = fetchSpy as typeof globalThis.fetch;
  document.body.innerHTML = '';
  __resetGuardsForTests();
  history.replaceState(null, '', '/teaching/algebra');
  currentRoute.path = '/teaching/algebra';
  currentRoute.search = '';
  currentRoute.hash = '';
});

function ok(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() {
  // Three sequential api.get calls (course → runs + versions in parallel) pass
  // through api.ts's async request() function: each hop adds ~3–4 microtask
  // ticks. onMount also adds one deferred queueMicrotask tick at the front,
  // so 12 iterations reliably drains the full chain in jsdom/Vitest.
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

const adminCourse = { id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true };
const draftRun = { id: 10, course_id: 1, version_id: 99, title: 'Spring 2026', start_date: '2026-06-01', end_date: '2026-06-30', is_published: false, groups_enabled: false };
const pubRun = { id: 11, course_id: 1, version_id: 98, title: 'Fall 2026', start_date: '2026-09-01', end_date: '2026-12-15', is_published: true, groups_enabled: true };
const v99 = { id: 99, course_id: 1, label: 'Autumn', created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false };
const v98 = { id: 98, course_id: 1, label: '', created_at: '2025-01-01', published_at: '2025-01-02', is_disabled: false };

function adminFetch(runs: unknown[], versions: unknown[] = [v99, v98], extra?: (url: string, init?: RequestInit) => Promise<Response> | null) {
  fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
    const hit = extra?.(url, init);
    if (hit) return hit;
    if (url.includes('/courses/by-slug/')) return ok(adminCourse);
    if (url.endsWith('/runs')) return ok(runs);
    if (url.includes('/versions')) return ok(versions);
    return Promise.reject(new Error('unexpected ' + url));
  });
}
function err(status: number, detail: string) {
  return Promise.resolve({
    ok: false, status,
    json: () => Promise.resolve({ detail }),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}
function open() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RunListPage, { target, props: { courseSlug: 'algebra' } });
  return { target, cmp };
}
const trash = (t: HTMLElement) => Array.from(t.querySelectorAll('button[data-action="delete-run"]')) as HTMLButtonElement[];

describe('RunListPage', () => {
  it('renders empty state with Create-the-first-run CTA when no runs', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return ok({ id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true });
      if (url.includes('/runs')) return ok([]);
      if (url.includes('/versions')) return ok([]);
      return Promise.reject(new Error('unexpected ' + url));
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunListPage, { target, props: { courseSlug: 'algebra' } });
    await settle();

    expect(target.textContent).toContain('No runs yet');
    expect(target.textContent).toContain('Create the first run');
    unmount(cmp);
  });

  it('admin: breadcrumb, h1 "Runs" with a count, rows in backend order, no ✎ and no Open (D4, R6)', async () => {
    adminFetch([draftRun, pubRun]);
    const { target, cmp } = open();
    await settle();
    const nav = target.querySelector('nav[aria-label="Breadcrumb"]') as HTMLElement;
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Algebra');
    expect(target.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Runs 2');
    expect(Array.from(target.querySelectorAll('thead th')).map((th) => th.textContent?.trim()))
      .toEqual(['Title', 'Status', 'Version', 'Start', 'End', '']);
    const rows = target.querySelectorAll('tbody tr');
    expect(rows[0]!.querySelector('a')?.getAttribute('href')).toBe('/teaching/algebra/runs/10');
    expect(rows[0]!.textContent).toContain('Spring 2026');
    expect(rows[1]!.textContent).toContain('Fall 2026');
    expect(target.querySelector('button[data-glyph="pencil"]')).toBeNull();
    expect(Array.from(target.querySelectorAll('a')).some((a) => a.textContent?.trim() === 'Open')).toBe(false);
    unmount(cmp);
  });

  it('Version column: "Label · v. N", or "v. N" alone for an empty label (R3)', async () => {
    adminFetch([draftRun, pubRun]);
    const { target, cmp } = open();
    await settle();
    const versionCells = Array.from(target.querySelectorAll('tbody tr')).map((tr) => tr.querySelectorAll('td')[2]!.textContent?.trim());
    expect(versionCells).toEqual(['Autumn · v. 99', 'v. 98']);
    expect(target.querySelector('tbody tr td:nth-child(3) .ver-id')?.textContent).toBe('v. 99');
    unmount(cmp);
  });

  it('🗑 on every row: enabled for a draft, disabled with its reason otherwise, named by the run', async () => {
    adminFetch([draftRun, pubRun]);
    const { target, cmp } = open();
    await settle();
    const [d, p] = trash(target);
    expect(d!.disabled).toBe(false);
    expect(d!.getAttribute('aria-label')).toBe('Delete run Spring 2026');
    expect(d!.getAttribute('title')).toBe('Delete');
    expect(p!.disabled).toBe(true);
    expect(p!.getAttribute('title')).toBe('Only a draft run can be deleted');
    expect(p!.getAttribute('aria-label')).toBe('Delete run Fall 2026');
    unmount(cmp);
  });

  it('🗑 → confirm takes focus on Cancel; Cancel returns focus to the 🗑', async () => {
    adminFetch([draftRun, pubRun]);
    const { target, cmp } = open();
    await settle();
    trash(target)[0]!.click();
    await settle();
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
    (document.activeElement as HTMLButtonElement).click();
    await settle();
    expect(document.activeElement).toBe(trash(target)[0]);
    unmount(cmp);
  });

  it('deleting the only draft run moves focus to + New run (Review Focus 3)', async () => {
    adminFetch([draftRun], [v99], (url, init) =>
      init?.method === 'DELETE' && url.endsWith('/api/runs/10')
        ? Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null), headers: new Headers() } as unknown as Response)
        : null);
    const { target, cmp } = open();
    await settle();
    trash(target)[0]!.click();
    await settle();
    expect(target.querySelector('.inline-confirm[role="group"]')?.getAttribute('aria-label')).toBe('Delete run Spring 2026?');
    (Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Delete') as HTMLButtonElement).click();
    await settle();
    await settle();
    expect(target.querySelector('tbody')).toBeNull();
    expect(document.activeElement).toBe(target.querySelector('button[data-action="new-run"]'));
    unmount(cmp);
  });

  it('a failed delete returns focus to the 🗑', async () => {
    adminFetch([draftRun, pubRun], [v99, v98], (_url, init) =>
      init?.method === 'DELETE' ? err(409, 'Clear roster first') : null);
    const { target, cmp } = open();
    await settle();
    trash(target)[0]!.click();
    await settle();
    (Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Delete') as HTMLButtonElement).click();
    await settle();
    await settle();
    expect(document.activeElement).toBe(trash(target)[0]);
    unmount(cmp);
  });

  it('+ New run is a 28px primary icon button titled "New run"', async () => {
    adminFetch([]);
    const { target, cmp } = open();
    await settle();
    const btn = target.querySelector('button[data-action="new-run"]') as HTMLButtonElement;
    expect(btn.getAttribute('data-glyph')).toBe('plus');
    expect(btn.classList.contains('primary')).toBe(true);
    expect(btn.classList.contains('md')).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('New run');
    expect(btn.getAttribute('title')).toBe('New run');
    unmount(cmp);
  });

  it('C6: the run title, the teacher row and the error page link route in-app; a ⌘-click is left to the browser', async () => {
    const at = (p: string) => {
      history.replaceState(null, '', p);
      Object.assign(routerModule.currentRoute, { path: p, search: '', hash: '' });
    };
    at('/teaching/algebra');
    adminFetch([draftRun, pubRun]);
    let { target, cmp } = open();
    await settle();
    await expectRoutesInApp(target.querySelector('tbody tr a')!, '/teaching/algebra/runs/10');
    unmount(cmp);

    at('/teaching/algebra');
    session.user = {
      id: 5, email: 't@x', full_name: 'T', is_superuser: false, is_disabled: false, photo_url: null,
      has_course_admin: false, has_run_teacher: true,
    };
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return ok({ ...adminCourse, is_admin: false });
      if (url.endsWith('/api/teaching/runs')) return ok([
        { run: { ...pubRun, created_at: '2026-01-01T00:00:00Z', updated_at: null }, course_id: 1, course_name: 'Algebra', course_slug: 'algebra', student_count: 7 },
      ]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    ({ target, cmp } = open());
    await settle();
    await expectRoutesInApp(target.querySelector('tbody tr a')!, `/teaching/algebra/runs/${pubRun.id}`);
    unmount(cmp);

    at('/teaching/algebra');
    fetchSpy.mockImplementation((url: string) =>
      url.includes('/courses/by-slug/') ? err(404, 'Not found') : Promise.reject(new Error('unexpected ' + url)));
    ({ target, cmp } = open());
    await settle();
    await expectRoutesInApp(target.querySelector('.error-state.page a')!, '/teaching');
    unmount(cmp);
  });

  it('teacher (not admin): a read-only list of their runs of this course; no + and no 🗑 (R5)', async () => {
    session.user = {
      id: 5, email: 't@x', full_name: 'T', is_superuser: false, is_disabled: false, photo_url: null,
      has_course_admin: false, has_run_teacher: true,
    };
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return ok({ ...adminCourse, is_admin: false });
      if (url.endsWith('/api/teaching/runs')) return ok([
        { run: { ...pubRun, created_at: '2026-01-01T00:00:00Z', updated_at: null }, course_id: 1, course_name: 'Algebra', course_slug: 'algebra', student_count: 7 },
        { run: { ...draftRun, id: 77, course_id: 2, title: 'Other course', created_at: '2026-01-01T00:00:00Z', updated_at: null }, course_id: 2, course_name: 'Geo', course_slug: 'geo', student_count: 1 },
      ]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const { target, cmp } = open();
    await settle();
    expect(Array.from(target.querySelectorAll('thead th')).map((th) => th.textContent?.trim()))
      .toEqual(['Title', 'Status', 'Students', 'Start', 'End']);
    const rows = target.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('Fall 2026');
    expect(rows[0]!.querySelectorAll('td')[2]!.textContent?.trim()).toBe('7');
    expect(target.querySelector('button[data-action="new-run"]')).toBeNull();
    expect(trash(target)).toHaveLength(0);
    unmount(cmp);
  });

  it('disables New-run button with tooltip when no published version exists', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return ok({ id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true });
      if (url.endsWith('/runs')) return ok([]);
      if (url.includes('/versions')) return ok([
        { id: 99, course_id: 1, created_at: '2026-01-01', published_at: null, is_disabled: false },
      ]);
      return Promise.reject(new Error('unexpected ' + url));
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunListPage, { target, props: { courseSlug: 'algebra' } });
    await settle();

    const btn = target.querySelector('button[data-action="new-run"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('Publish a course version');
    unmount(cmp);
  });

  it('403 → ErrorState "You don\'t have access to this course\'s runs." with a link to /teaching, no breadcrumb', async () => {
    fetchSpy.mockImplementation((url: string) =>
      url.includes('/courses/by-slug/') ? err(403, 'Access denied') : Promise.reject(new Error('unexpected ' + url)));
    const navigateSpy = vi.spyOn(routerModule, 'navigate');
    const { target, cmp } = open();
    await settle();
    expect(navigateSpy).not.toHaveBeenCalled();
    const card = target.querySelector('.error-state.page') as HTMLElement;
    expect(card.querySelector('h1')?.textContent).toBe("You don't have access to this course's runs.");
    expect(card.querySelector('a')?.getAttribute('href')).toBe('/teaching');
    expect(target.querySelector('nav[aria-label="Breadcrumb"]')).toBeNull();
    navigateSpy.mockRestore();
    unmount(cmp);
  });

  it('404 → ErrorState "Course not found." with a link to /teaching', async () => {
    fetchSpy.mockImplementation((url: string) =>
      url.includes('/courses/by-slug/') ? err(404, 'Not found') : Promise.reject(new Error('unexpected ' + url)));
    const { target, cmp } = open();
    await settle();
    const card = target.querySelector('.error-state.page') as HTMLElement;
    expect(card.querySelector('h1')?.textContent).toBe('Course not found.');
    expect(card.querySelector('a')?.getAttribute('href')).toBe('/teaching');
    unmount(cmp);
  });

  it('another load error → inline ErrorState with "Try again", which reloads', async () => {
    let calls = 0;
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return ++calls === 1 ? err(500, 'Boom') : ok(adminCourse);
      if (url.endsWith('/runs')) return ok([]);
      if (url.includes('/versions')) return ok([v99]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const { target, cmp } = open();
    await settle();
    const retry = Array.from(target.querySelectorAll('.error-state.inline button')).find((b) => b.textContent?.trim() === 'Try again') as HTMLButtonElement;
    retry.click();
    await settle();
    expect(target.textContent).toContain('Create the first run');
    unmount(cmp);
  });
});
