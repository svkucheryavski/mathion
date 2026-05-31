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

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

// Test helpers — mirror the canonical pattern in AppHeader.svelte.test.ts and
// TeacherRunListPage.svelte.test.ts. We intentionally do NOT use
// @testing-library/svelte (forbidden by project conventions).
function buttonByText(target: HTMLElement, text: string | RegExp): HTMLButtonElement | null {
  const buttons = Array.from(target.querySelectorAll('button')) as HTMLButtonElement[];
  return buttons.find((b) => {
    const t = (b.textContent ?? '').trim();
    return typeof text === 'string' ? t === text : text.test(t);
  }) ?? null;
}

function linkByText(target: HTMLElement, text: string): HTMLAnchorElement | null {
  const anchors = Array.from(target.querySelectorAll('a')) as HTMLAnchorElement[];
  return anchors.find((a) => (a.textContent ?? '').trim() === text) ?? null;
}

function pageTextContains(target: HTMLElement, text: string | RegExp): boolean {
  const full = target.textContent ?? '';
  return typeof text === 'string' ? full.includes(text) : text.test(full);
}

function setup(opts: {
  teachers?: unknown[];
  groups?: unknown[];
  students?: unknown[];
  run?: Record<string, unknown>;
  course?: Record<string, unknown>;
  version?: Record<string, unknown>;
} = {}) {
  fetchSpy.mockImplementation((url: string) => {
    if (url.includes('/courses/by-slug/')) return jres({
      id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true,
      ...(opts.course ?? {}),
    });
    if (url.match(/\/api\/runs\/10$/)) return jres({
      id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
      is_published: false, groups_enabled: false, ...(opts.run ?? {}),
    });
    if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
    if (url.includes('/mini-projects')) return jres([]);
    if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
    if (url.includes('/versions')) return jres([{
      id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false,
      ...(opts.version ?? {}),
    }]);
    if (url.includes('/teachers')) return jres(opts.teachers ?? []);
    if (url.includes('/groups')) return jres(opts.groups ?? []);
    if (url.includes('/students')) return jres(opts.students ?? []);
    return Promise.reject(new Error('unexpected ' + url));
  });
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
  return { target, cmp };
}

describe('Publish bar', () => {
  it('disables Publish when no teachers and shows first-violation tooltip', async () => {
    const { target, cmp } = setup({ teachers: [] });
    await settle();
    const btn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('teacher');
    unmount(cmp);
  });

  it('enables Publish when all readiness checks pass', async () => {
    const { target, cmp } = setup({ teachers: [{ user_id: 1, user_email: 't@x.com' }] });
    await settle();
    const btn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
    unmount(cmp);
  });

  it('renders Unpublish + confirmation for published runs', async () => {
    const { target, cmp } = setup({ run: { is_published: true }, teachers: [{ user_id: 1, user_email: 't@x.com' }] });
    await settle();
    const btn = target.querySelector('button[data-action="unpublish"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    flushSync();
    expect(target.textContent).toContain('Confirm Unpublish');
    expect(target.textContent).toContain('lose access');
    unmount(cmp);
  });

  it('refetches run on 409 unpublish race so the UI flips back to Publish', async () => {
    let runGetCount = 0;
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres({ id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true });
      if (url.match(/\/api\/runs\/10$/)) {
        runGetCount++;
        return jres({
          id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
          is_published: runGetCount === 1, groups_enabled: false,
        });
      }
      if (url.includes('/unpublish')) return jres({ detail: 'Run is not published' }, 409);
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([{ id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false }]);
      if (url.includes('/teachers')) return jres([{ user_id: 1, user_email: 't@x.com' }]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    const unpubBtn = target.querySelector('button[data-action="unpublish"]') as HTMLButtonElement;
    expect(unpubBtn).not.toBeNull();
    unpubBtn.click();
    flushSync();
    const confirmBtn = target.querySelector('button.confirm') as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();
    confirmBtn.click();
    await settle();
    const pubBtn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    expect(pubBtn).not.toBeNull();
    expect(runGetCount).toBe(2);
    unmount(cmp);
  });

  it('disables Publish when version is disabled', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres({ id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true });
      if (url.match(/\/api\/runs\/10$/)) return jres({ id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30', is_published: false, groups_enabled: false });
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([{ id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: true }]);
      if (url.includes('/teachers')) return jres([{ user_id: 1, user_email: 't@x.com' }]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    const btn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('disabled');
    unmount(cmp);
  });
});

describe('publish-bar split for course.is_admin', () => {
  it('teacher (is_admin=false) sees status badge and version label but NOT publish/unpublish buttons', async () => {
    const { target, cmp } = setup({
      course: { is_admin: false },
      teachers: [{ user_id: 1, user_email: 't@x.com' }],
    });
    await settle();
    expect(target.querySelector('[data-testid="status-badge"]')).not.toBeNull();
    expect(target.querySelector('[data-testid="version-label"]')).not.toBeNull();
    expect(buttonByText(target, /^Publish$/)).toBeNull();
    expect(buttonByText(target, /^Unpublish$/)).toBeNull();
    unmount(cmp);
  });

  it('admin (is_admin=true) sees publish or unpublish button + badge + label', async () => {
    const { target, cmp } = setup({ teachers: [{ user_id: 1, user_email: 't@x.com' }] });
    await settle();
    expect(target.querySelector('[data-testid="status-badge"]')).not.toBeNull();
    expect(target.querySelector('[data-testid="version-label"]')).not.toBeNull();
    const pub = buttonByText(target, /^Publish$/);
    const unpub = buttonByText(target, /^Unpublish$/);
    expect(pub !== null || unpub !== null).toBe(true);
    unmount(cmp);
  });
});

describe('disabled-version banner copy', () => {
  it('teacher sees teacher-aware copy', async () => {
    const { target, cmp } = setup({
      course: { is_admin: false },
      version: { is_disabled: true },
      teachers: [{ user_id: 1, user_email: 't@x.com' }],
    });
    await settle();
    expect(pageTextContains(target, /Some editing actions are locked until a course admin re-enables it/)).toBe(true);
    expect(pageTextContains(target, /Re-enable it under Course Editor/)).toBe(false);
    unmount(cmp);
  });

  it('admin sees admin-facing copy', async () => {
    const { target, cmp } = setup({
      version: { is_disabled: true },
      teachers: [{ user_id: 1, user_email: 't@x.com' }],
    });
    await settle();
    expect(pageTextContains(target, /Re-enable it under Course Editor before publishing/)).toBe(true);
    expect(pageTextContains(target, /Some editing actions are locked until a course admin re-enables it/)).toBe(false);
    unmount(cmp);
  });
});

describe('breadcrumb fix for teachers', () => {
  it('teacher sees Teaching root, no /courses link', async () => {
    const { target, cmp } = setup({ course: { is_admin: false } });
    await settle();
    const teachingLink = linkByText(target, 'Teaching');
    expect(teachingLink).not.toBeNull();
    expect(teachingLink!.getAttribute('href')).toBe('/teaching');
    expect(linkByText(target, 'Courses')).toBeNull();
    unmount(cmp);
  });

  it('admin sees the original Courses › ... › Runs breadcrumb', async () => {
    const { target, cmp } = setup({});
    await settle();
    const coursesLink = linkByText(target, 'Courses');
    expect(coursesLink).not.toBeNull();
    expect(coursesLink!.getAttribute('href')).toBe('/courses');
    unmount(cmp);
  });
});
