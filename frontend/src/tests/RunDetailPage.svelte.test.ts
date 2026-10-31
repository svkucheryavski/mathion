import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunDetailPage from '../pages/runs/RunDetailPage.svelte';
import { session } from '../stores/session.svelte';
import { currentRoute, __resetGuardsForTests } from '../lib/router.svelte';
import { expectRoutesInApp } from './support/routeClickProbe';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
  __resetGuardsForTests();
  history.replaceState(null, '', '/teaching/algebra/runs/10');
  currentRoute.path = '/teaching/algebra/runs/10';
  currentRoute.search = '';
  currentRoute.hash = '';
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

const courseFixture = { id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true };
const runFixture = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
  is_published: false, groups_enabled: false, ...overrides,
});
const versionFixture = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false, ...overrides,
});

function mockHappyPath() {
  fetchSpy.mockImplementation((url: string) => {
    if (url.includes('/courses/by-slug/')) return jres(courseFixture);
    // Match any positive integer runId so the reset-on-runId-change test
    // works when it remounts with a different runId (e.g., 11).
    const m = url.match(/\/api\/runs\/(\d+)$/);
    if (m) return jres(runFixture({ id: Number(m[1]) }));
    if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
    if (url.includes('/mini-projects')) return jres([]);
    if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
    if (url.includes('/versions')) return jres([versionFixture()]);
    if (url.includes('/teachers')) return jres([]);
    if (url.includes('/groups')) return jres([]);
    if (url.includes('/students')) return jres([]);
    return Promise.reject(new Error('unexpected ' + url));
  });
}

function mockCascade(opts: {
  blocksReject?: boolean;
  mpsReject?: boolean;
  noPinned?: boolean;
}) {
  return (url: string) => {
    if (url.includes('/api/courses/by-slug/')) return jres({ id: 1, slug: 'c', name: 'C', description: '', is_admin: true });
    if (url.match(/\/api\/runs\/10$/))
      return jres({
        id: 10, course_id: 1,
        version_id: opts.noPinned ? 999 : 7,
        title: 'R', start_date: '2026-01-01', end_date: '2026-12-31',
        is_published: true, groups_enabled: true,
      });
    if (url.includes('/api/courses/1/versions'))
      return jres([{ id: 7, course_id: 1, info_md: '', is_published: true, is_disabled: false, created_at: '2026-01-01', published_at: '2026-01-02' }]);
    if (url.includes('/api/runs/10/teachers')) return jres([]);
    if (url.includes('/api/runs/10/groups')) return jres([]);
    if (url.includes('/api/runs/10/students')) return jres([]);
    if (url.includes('/api/versions/7/blocks')) {
      if (opts.blocksReject) return jres({ detail: 'blocks 5xx' }, 503);
      return jres([{ id: 1, version_id: 7, title: 'B', slug: 'b', order: 0, info: '', info_html: '' }]);
    }
    if (url.includes('/api/runs/10/mini-projects')) {
      if (opts.mpsReject) return jres({ detail: 'mps 5xx' }, 503);
      return jres([]);
    }
    if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
    return jres([]);
  };
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

describe('RunDetailPage shell', () => {
  it('shows loading placeholder until all 6 fetches resolve', async () => {
    mockHappyPath();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    expect(target.textContent).toContain('Loading');
    await settle();
    expect(target.textContent).toContain('Overview');
    unmount(cmp);
  });

  it('renders error placeholder on invalid runId (non-integer)', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: 'abc' } });
    await settle();
    expect(target.textContent).toContain('Invalid run');
    unmount(cmp);
  });

  it('shows disabled-version banner when pinned version is disabled', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres(courseFixture);
      if (url.match(/\/api\/runs\/10$/)) return jres(runFixture());
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([versionFixture({ is_disabled: true })]);
      if (url.includes('/teachers')) return jres([]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    expect(target.textContent).toContain('course version is disabled');
    expect(target.querySelectorAll('.run-banner-warn')).toHaveLength(1);
    unmount(cmp);
  });

  it('renders loadError when by-slug returns 404', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres({ detail: 'Not found' }, 404);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    expect(target.textContent).toMatch(/(not found|Failed to load)/i);
    unmount(cmp);
  });

  it('the meta line names the pinned version by id, not rank (R3)', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres(courseFixture);
      if (url.match(/\/api\/runs\/10$/)) return jres(runFixture({ version_id: 102 }));
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([
        versionFixture({ id: 100, created_at: '2026-01-01' }),
        versionFixture({ id: 102, created_at: '2026-03-15' }),
      ]);
      if (url.includes('/teachers')) return jres([]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    expect(target.querySelector('p.run-meta')?.textContent?.trim()).toBe('0 students · v. 102');
    // Spec §The run frame / 10a–10j: the meta line sits on the title row.
    expect(target.querySelector('.run-title-row p.run-meta')).not.toBeNull();
    unmount(cmp);
  });

  it('the meta line: singulars, and "· N groups" only with groups on', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres(courseFixture);
      if (url.match(/\/api\/runs\/10$/)) return jres(runFixture({ groups_enabled: true }));
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([versionFixture()]);
      if (url.includes('/teachers')) return jres([]);
      if (url.includes('/groups')) return jres([{ id: 3, run_id: 10, name: 'A', is_disabled: false, student_count: 1 }]);
      if (url.includes('/students')) return jres([{ id: 1, run_id: 10, user_id: 7, user_email: 's@x', user_full_name: 'S', group_id: 3, created_at: '2026-01-01' }]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    expect(target.querySelector('p.run-meta')?.textContent?.trim()).toBe('1 student · 1 group · v. 99');
    unmount(cmp);
  });

  it('renders 5th "Mini-projects" tab; switching to it shows RunMiniProjectsTab', async () => {
    fetchSpy.mockImplementation(mockCascade({}));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'c', runId: '10' } });
    await settle();
    await settle();
    const mpTabBtn = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes('Mini-projects')) as HTMLButtonElement;
    expect(mpTabBtn).toBeTruthy();
    mpTabBtn.click();
    await settle();
    expect(target.textContent).toContain('No mini-projects yet');
    unmount(cmp);
  });

  it('pinnedAvailable=false when versions list does not contain run.version_id', async () => {
    fetchSpy.mockImplementation(mockCascade({ noPinned: true }));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'c', runId: '10' } });
    await settle();
    await settle();
    const mpTabBtn = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes('Mini-projects')) as HTMLButtonElement;
    mpTabBtn.click();
    await settle();
    expect(target.textContent).toContain('Cannot load — pinned version not found');
    unmount(cmp);
  });

  it('listBlocks fails → whole page renders loadError (all-or-nothing load invariant)', async () => {
    fetchSpy.mockImplementation(mockCascade({ blocksReject: true }));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'c', runId: '10' } });
    await settle();
    await settle();
    expect(target.textContent).toMatch(/blocks 5xx/);
    expect(Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes('Mini-projects'))).toBeUndefined();
    unmount(cmp);
  });

  it('listMiniProjects fails → whole page renders loadError', async () => {
    fetchSpy.mockImplementation(mockCascade({ mpsReject: true }));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'c', runId: '10' } });
    await settle();
    await settle();
    expect(target.textContent).toMatch(/mps 5xx/);
    expect(Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes('Mini-projects'))).toBeUndefined();
    unmount(cmp);
  });

  it('the title row: h1 run title and the run status chip', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres(courseFixture);
      if (url.match(/\/api\/runs\/10$/)) return jres(runFixture({ is_published: false }));
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([versionFixture()]);
      if (url.includes('/teachers')) return jres([]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    const chip = target.querySelector('.run-title-row .run-chip') as HTMLElement;
    expect(chip.textContent?.trim()).toBe('draft');
    expect(chip.getAttribute('data-status')).toBe('draft');
    expect(target.querySelector('h1')?.textContent?.trim()).toBe('Spring');
    unmount(cmp);
  });
  it('deleting a run from Overview force-deletes it and lands on /teaching/:slug (6a D3, D24)', async () => {
    mockHappyPath();
    const inner = fetchSpy.getMockImplementation()!;
    const deletes: string[] = [];
    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') { deletes.push(url); return jres(null, 204); }
      return inner(url, init);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    (target.querySelector('button[data-action="delete-run"]') as HTMLButtonElement).click();
    flushSync();
    (target.querySelector('input[data-role="danger-ack"]') as HTMLInputElement).click();
    flushSync();
    (target.querySelector('button[data-action="force-delete"]') as HTMLButtonElement).click();
    await settle();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain('/api/runs/10?force=true');
    expect(location.pathname).toBe('/teaching/algebra');
    unmount(cmp);
  });

  it('errors use the page ErrorState with a link back to Teaching', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres({ detail: 'Course not found' }, 404);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    const card = target.querySelector('.error-state.page') as HTMLElement;
    expect(card.querySelector('h1')?.textContent).toBe('Course not found');
    expect(card.querySelector('a')?.getAttribute('href')).toBe('/teaching');
    // C6: a plain click routes in-app, a ⌘-click is left to the browser.
    history.replaceState(null, '', '/teaching/algebra/runs/10');
    Object.assign(currentRoute, { path: '/teaching/algebra/runs/10', search: '', hash: '' });
    await expectRoutesInApp(card.querySelector('a')!, '/teaching');
    unmount(cmp);
  });

  it('"Invalid run." uses the page ErrorState too', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: 'abc' } });
    await settle();
    expect(target.querySelector('.error-state.page h1')?.textContent).toBe('Invalid run.');
    unmount(cmp);
  });
});

describe('RunDetailPage — Assets tab integration', () => {
  it('renders 6th "Assets" tab; clicking switches to RunAssetsTab empty state', async () => {
    mockHappyPath();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    const assetsBtn = Array.from(target.querySelectorAll('button[role="tab"]'))
      .find((b) => b.textContent?.trim() === 'Assets') as HTMLButtonElement;
    expect(assetsBtn).toBeTruthy();
    assetsBtn.click();
    await settle();
    expect(assetsBtn.getAttribute('aria-selected')).toBe('true');
    expect(target.textContent).toMatch(/No assets yet/i);
    unmount(cmp);
  });

  it('listRunAssets failure → whole page renders loadError (all-or-nothing)', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres(courseFixture);
      if (url.match(/\/api\/runs\/10$/)) return jres(runFixture());
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres({ detail: 'assets 5xx' }, 503);
      if (url.includes('/versions')) return jres([versionFixture()]);
      if (url.includes('/teachers')) return jres([]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    expect(target.textContent).toMatch(/assets 5xx/);
    expect(
      Array.from(target.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Assets',
      ),
    ).toBeUndefined();
    unmount(cmp);
  });

  it('assets === null loading guard prevents tab-bar flash', async () => {
    let resolveAssets: ((v: Response) => void) | null = null;
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres(courseFixture);
      if (url.match(/\/api\/runs\/10$/)) return jres(runFixture());
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) {
        return new Promise<Response>((r) => { resolveAssets = r; });
      }
      if (url.includes('/versions')) return jres([versionFixture()]);
      if (url.includes('/teachers')) return jres([]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    // Mid-load: spinner up, no tab buttons yet
    expect(target.textContent).toContain('Loading');
    expect(target.querySelectorAll('button[role="tab"]').length).toBe(0);

    resolveAssets!({
      ok: true, status: 200,
      json: () => Promise.resolve([]),
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Response);
    await settle();
    const tabs = target.querySelectorAll('button[role="tab"]');
    // 6 original + 2 new dashboard tabs (Progress, Submission)
    expect(tabs.length).toBe(8);
    expect(
      Array.from(tabs).find((b) => b.textContent?.trim() === 'Assets'),
    ).toBeTruthy();
    unmount(cmp);
  });
});

describe('RunDetailPage — isThisRunTeacher derivation', () => {
  beforeEach(() => {
    session.user = null;
    session.loading = false;
  });

  it('TD1: derives canWrite=true on RunSubmissionTab when session.user.id is in teachers list', async () => {
    session.user = {
      id: 5, email: 'teach@x', full_name: 'T', is_superuser: false, is_disabled: false,
      photo_url: null, has_course_admin: false, has_run_teacher: true,
    };
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres({ ...courseFixture, is_admin: false });
      if (url.match(/\/api\/runs\/10$/)) return jres(runFixture());
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      // /dashboard/mini-projects MUST come before /mini-projects so the dashboard
      // endpoint returns a { run, mini_projects } shape (lib/dashboards.ts:123-161)
      // not the bare array expected by lib/miniProjects.ts:5 listMiniProjects.
      if (url.includes('/dashboard/mini-projects')) return jres({ run: { id: 10, title: 'R', groups_enabled: true }, mini_projects: [] });
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([versionFixture()]);
      if (url.includes('/teachers')) return jres([{ id: 1, run_id: 10, user_id: 5, user_email: 'teach@x', user_full_name: 'T', created_at: '2026-01-01' }]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    const submTab = Array.from(target.querySelectorAll('button[role="tab"]'))
      .find((b) => b.textContent?.trim() === 'Submissions') as HTMLButtonElement;
    submTab.click();
    flushSync();
    await settle();
    const tabContainer = target.querySelector('[data-test="run-submission-tab"]') as HTMLElement;
    expect(tabContainer?.getAttribute('data-can-write')).toBe('true');
    unmount(cmp);
  });

  it('TD1-neg: canWrite=false when teachers list does not contain session.user.id (and is_admin=false)', async () => {
    session.user = {
      id: 5, email: 'student@x', full_name: 'S', is_superuser: false, is_disabled: false,
      photo_url: null, has_course_admin: false, has_run_teacher: false,
    };
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres({ ...courseFixture, is_admin: false });
      if (url.match(/\/api\/runs\/10$/)) return jres(runFixture());
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      // /dashboard/mini-projects MUST come before /mini-projects so the dashboard
      // endpoint returns a { run, mini_projects } shape (lib/dashboards.ts:123-161)
      // not the bare array expected by lib/miniProjects.ts:5 listMiniProjects.
      if (url.includes('/dashboard/mini-projects')) return jres({ run: { id: 10, title: 'R', groups_enabled: true }, mini_projects: [] });
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([versionFixture()]);
      if (url.includes('/teachers')) return jres([{ id: 1, run_id: 10, user_id: 99, user_email: 'other@x', user_full_name: 'Other', created_at: '2026-01-01' }]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    const submTab = Array.from(target.querySelectorAll('button[role="tab"]'))
      .find((b) => b.textContent?.trim() === 'Submissions') as HTMLButtonElement;
    submTab.click();
    flushSync();
    await settle();
    const tabContainer = target.querySelector('[data-test="run-submission-tab"]') as HTMLElement;
    expect(tabContainer?.getAttribute('data-can-write')).toBe('false');
    unmount(cmp);
  });
});
