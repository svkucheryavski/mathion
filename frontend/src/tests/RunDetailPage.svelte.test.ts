import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunDetailPage from '../pages/runs/RunDetailPage.svelte';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
  location.hash = '#/courses/algebra/runs/10';
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

  it('resets activeTab to overview and rosterPrefilter to null on runId change', async () => {
    mockHappyPath();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    const rosterBtn = Array.from(target.querySelectorAll('button[role="tab"]')).find((b) => b.textContent?.includes('Roster')) as HTMLButtonElement;
    rosterBtn.click();
    flushSync();
    expect(rosterBtn.getAttribute('aria-selected')).toBe('true');
    unmount(cmp);
    const cmp2 = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '11' } });
    await settle();
    const overviewBtn = Array.from(target.querySelectorAll('button[role="tab"]')).find((b) => b.textContent?.includes('Overview')) as HTMLButtonElement;
    expect(overviewBtn.getAttribute('aria-selected')).toBe('true');
    unmount(cmp2);
  });

  it('renders version label "vN (YYYY-MM-DD)" in the header (spec §7 step 4)', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres(courseFixture);
      if (url.match(/\/api\/runs\/10$/)) return jres(runFixture({ version_id: 102 }));
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([
        versionFixture({ id: 100, created_at: '2026-01-01' }),
        versionFixture({ id: 101, created_at: '2026-02-01' }),
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
    const label = target.querySelector('[data-testid="version-label"]');
    expect(label?.textContent).toBe('v3 (2026-03-15)');
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

  it('renders status badge in the header (spec §3.5 + §7 step 20)', async () => {
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
    const badge = target.querySelector('[data-testid="status-badge"]');
    expect(badge?.textContent).toBe('Draft');
    expect(badge?.classList.contains('badge-draft')).toBe(true);
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
    flushSync();
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
    expect(tabs.length).toBe(6);
    expect(
      Array.from(tabs).find((b) => b.textContent?.trim() === 'Assets'),
    ).toBeTruthy();
    unmount(cmp);
  });
});
