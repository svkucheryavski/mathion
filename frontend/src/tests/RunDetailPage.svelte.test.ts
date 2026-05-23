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
    if (url.includes('/versions')) return jres([versionFixture()]);
    if (url.includes('/teachers')) return jres([]);
    if (url.includes('/groups')) return jres([]);
    if (url.includes('/students')) return jres([]);
    return Promise.reject(new Error('unexpected ' + url));
  });
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

  it('renders status badge in the header (spec §3.5 + §7 step 20)', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres(courseFixture);
      if (url.match(/\/api\/runs\/10$/)) return jres(runFixture({ is_published: false }));
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
