import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunDetailPage from '../pages/runs/RunDetailPage.svelte';
import { currentRoute } from '../lib/router.svelte';

vi.mock('../stores/toasts.svelte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stores/toasts.svelte')>();
  return { ...actual, pushToast: vi.fn() };
});

import { pushToast } from '../stores/toasts.svelte';

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  vi.mocked(pushToast).mockClear();
  document.body.innerHTML = '';
  location.hash = '#/courses/algebra/runs/10';
  history.replaceState(null, '', '/teaching/algebra/runs/10');
  currentRoute.path = location.pathname;
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
    expect(target.querySelector('button[data-action="confirm-unpublish"]')?.textContent).toBe('Unpublish');
    expect(target.textContent).toContain('Students lose access immediately; their progress is kept.');
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
    // 'draft-now' (R33): focus lands on Publish run, never on <body>.
    expect(document.activeElement).toBe(pubBtn);
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
  it('teacher (is_admin=false) sees the chip and the meta line but NOT publish/unpublish buttons', async () => {
    const { target, cmp } = setup({
      course: { is_admin: false },
      teachers: [{ user_id: 1, user_email: 't@x.com' }],
    });
    await settle();
    expect(target.querySelector('.run-chip')).not.toBeNull();
    expect(target.querySelector('p.run-meta')).not.toBeNull();
    expect(buttonByText(target, /^Publish run$/)).toBeNull();
    expect(buttonByText(target, /^Unpublish$/)).toBeNull();
    expect(target.querySelector('.ov-foot-note')?.textContent?.trim()).toBe('A course admin publishes this run.');
    unmount(cmp);
  });

  it('admin (is_admin=true) sees publish or unpublish button + the chip and the meta line', async () => {
    const { target, cmp } = setup({ teachers: [{ user_id: 1, user_email: 't@x.com' }] });
    await settle();
    expect(target.querySelector('.run-chip')).not.toBeNull();
    expect(target.querySelector('p.run-meta')).not.toBeNull();
    const pub = buttonByText(target, /^Publish run$/);
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

describe('readiness sizes check — API-parity (oversized-only gate)', () => {
  it('groups_enabled + 0 groups → sizes state ok (rolling-enrollment: publish then build)', async () => {
    const { target, cmp } = setup({
      run: { groups_enabled: true },
      teachers: [{ user_id: 1, user_email: 't@x.com' }],
      groups: [],
    });
    await settle();
    // Publish button must be enabled — zero groups is not a violation.
    const btn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
    unmount(cmp);
  });

  it('groups_enabled + 1 empty group (count 0) → sizes state ok', async () => {
    const { target, cmp } = setup({
      run: { groups_enabled: true },
      teachers: [{ user_id: 1, user_email: 't@x.com' }],
      groups: [{ id: 1, run_id: 10, name: 'Alpha', student_count: 0 }],
    });
    await settle();
    // An empty group is allowed — only oversized groups block publishing.
    const btn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
    unmount(cmp);
  });

  it('groups_enabled + 1 group with 11 students → sizes violated, Publish disabled', async () => {
    const { target, cmp } = setup({
      run: { groups_enabled: true },
      teachers: [{ user_id: 1, user_email: 't@x.com' }],
      groups: [{ id: 1, run_id: 10, name: 'Alpha', student_count: 11 }],
    });
    await settle();
    const btn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('Alpha (11)');
    unmount(cmp);
  });
});

describe('breadcrumb: Teaching / Course / Run for everyone (spec §The breadcrumb)', () => {
  for (const isAdmin of [false, true]) {
    it(`${isAdmin ? 'admin' : 'teacher'}: Teaching / Algebra / Spring, no /courses link`, async () => {
      const { target, cmp } = setup({ course: { is_admin: isAdmin } });
      await settle();
      const nav = target.querySelector('nav[aria-label="Breadcrumb"]') as HTMLElement;
      expect(Array.from(nav.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['/teaching', '/teaching/algebra']);
      expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Spring');
      expect(linkByText(target, 'Courses')).toBeNull();
      unmount(cmp);
    });
  }
});

// Helpers shared by the PublishConflictsModal-wiring tests (E3).
// `setupWithPublishStub` adds a POST /api/runs/{id}/publish handler that the
// base `setup()` helper does not route; without it the publish click would hit
// the catch-all `Promise.reject(new Error('unexpected ...'))` branch.
function setupWithPublishStub(publishBody: unknown, publishStatus: number, runId = 10) {
  fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes('/courses/by-slug/')) return jres({
      id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true,
    });
    if (url.match(new RegExp(`/api/runs/${runId}$`))) return jres({
      id: runId, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
      is_published: false, groups_enabled: false,
    });
    if (url.match(new RegExp(`/api/runs/${runId}/publish$`)) && init?.method === 'POST') {
      return jres(publishBody, publishStatus);
    }
    if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
    if (url.includes('/mini-projects')) return jres([]);
    if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
    if (url.includes('/versions')) return jres([{
      id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false,
    }]);
    if (url.includes('/teachers')) return jres([{ user_id: 1, user_email: 't@x.com' }]);
    if (url.includes('/groups')) return jres([]);
    if (url.includes('/students')) return jres([]);
    return Promise.reject(new Error('unexpected ' + url));
  });
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: String(runId) } });
  return { target, cmp };
}

// R26: the dialog is named by its <h2>, not by an aria-label.
function dialogEl(): Element | null {
  return Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => {
    const id = d.getAttribute('aria-labelledby');
    return !!id && /can't be added$/.test(document.getElementById(id)?.textContent?.trim() ?? '');
  }) ?? null;
}

describe('PublishConflictsModal wiring (E3)', () => {
  it('Test 1: 409 student_already_active_in_course with conflicts opens the modal (no toast)', async () => {
    const { target, cmp } = setupWithPublishStub({
      detail: 'Cannot publish: 2 students already active',
      error_code: 'student_already_active_in_course',
      conflicts: [
        { user_id: 1, email: 'a@example.com', run_id: 7, run_title: 'Old Run A' },
        { user_id: 2, email: 'b@example.com', run_id: 7, run_title: 'Old Run A' },
      ],
    }, 409);
    await settle();
    const btn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement | null;
    if (!btn) throw new Error('Publish button not found');
    expect(btn.disabled).toBe(false);
    btn.click();
    await settle();
    expect(dialogEl()).not.toBeNull();
    expect(vi.mocked(pushToast)).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('Test 2: 409 with empty conflicts array → toast, no modal', async () => {
    const { target, cmp } = setupWithPublishStub({
      detail: 'Cannot publish: students already active',
      error_code: 'student_already_active_in_course',
      conflicts: [],
    }, 409);
    await settle();
    const btn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement | null;
    if (!btn) throw new Error('Publish button not found');
    btn.click();
    await settle();
    expect(dialogEl()).toBeNull();
    expect(vi.mocked(pushToast)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pushToast)).toHaveBeenCalledWith(
      'Cannot publish: students already active',
      'error',
    );
    unmount(cmp);
  });

  it('Test 3: 409 with missing conflicts field → toast, no modal', async () => {
    const { target, cmp } = setupWithPublishStub({
      detail: 'Cannot publish: students already active',
      error_code: 'student_already_active_in_course',
    }, 409);
    await settle();
    const btn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement | null;
    if (!btn) throw new Error('Publish button not found');
    btn.click();
    await settle();
    expect(dialogEl()).toBeNull();
    expect(vi.mocked(pushToast)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pushToast)).toHaveBeenCalledWith(
      'Cannot publish: students already active',
      'error',
    );
    unmount(cmp);
  });

  it('Test 4: 409 with different error_code (capacity_reached) → toast, no modal', async () => {
    const { target, cmp } = setupWithPublishStub({
      detail: 'Capacity reached',
      error_code: 'capacity_reached',
    }, 409);
    await settle();
    const btn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement | null;
    if (!btn) throw new Error('Publish button not found');
    btn.click();
    await settle();
    expect(dialogEl()).toBeNull();
    expect(vi.mocked(pushToast)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pushToast)).toHaveBeenCalledWith('Capacity reached', 'error');
    unmount(cmp);
  });

  it('Test 5: Close hides modal; re-publish surfaces fresh conflicts', async () => {
    // First fetch impl: 409 with conflict for a@example.com.
    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/courses/by-slug/')) return jres({
        id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true,
      });
      if (url.match(/\/api\/runs\/10$/)) return jres({
        id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
        is_published: false, groups_enabled: false,
      });
      if (url.match(/\/api\/runs\/10\/publish$/) && init?.method === 'POST') {
        return jres({
          detail: 'Cannot publish: 1 student already active',
          error_code: 'student_already_active_in_course',
          conflicts: [{ user_id: 1, email: 'a@example.com', run_id: 7, run_title: 'Old Run A' }],
        }, 409);
      }
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([{
        id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false,
      }]);
      if (url.includes('/teachers')) return jres([{ user_id: 1, user_email: 't@x.com' }]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    const btn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement | null;
    if (!btn) throw new Error('Publish button not found');
    btn.click();
    await settle();
    const modal1 = dialogEl();
    expect(modal1).not.toBeNull();
    if (!modal1) throw new Error('modal not mounted');
    expect(modal1.textContent ?? '').toContain('a@example.com');

    // Click the Close button inside the modal footer.
    const closeBtn = Array.from(modal1.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Close',
    ) as HTMLButtonElement | undefined;
    if (!closeBtn) throw new Error('Close button not found');
    closeBtn.click();
    await settle();
    expect(dialogEl()).toBeNull();

    // Second fetch impl: 409 with a DIFFERENT conflict (z@example.com).
    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/courses/by-slug/')) return jres({
        id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true,
      });
      if (url.match(/\/api\/runs\/10$/)) return jres({
        id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
        is_published: false, groups_enabled: false,
      });
      if (url.match(/\/api\/runs\/10\/publish$/) && init?.method === 'POST') {
        return jres({
          detail: 'Cannot publish: 1 student already active',
          error_code: 'student_already_active_in_course',
          conflicts: [{ user_id: 99, email: 'z@example.com', run_id: 8, run_title: 'Old Run B' }],
        }, 409);
      }
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([{
        id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false,
      }]);
      if (url.includes('/teachers')) return jres([{ user_id: 1, user_email: 't@x.com' }]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });

    const btn2 = target.querySelector('button[data-action="publish"]') as HTMLButtonElement | null;
    if (!btn2) throw new Error('Publish button not found on re-publish');
    btn2.click();
    await settle();
    const modal2 = dialogEl();
    expect(modal2).not.toBeNull();
    if (!modal2) throw new Error('modal not re-mounted');
    const txt = modal2.textContent ?? '';
    expect(txt).toContain('z@example.com');
    expect(txt).not.toContain('a@example.com');
    unmount(cmp);
  });

  it('Test 6: runId change closes an open modal', async () => {
    // Single fetch impl widened to handle BOTH runId 10 and runId 11.
    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/courses/by-slug/')) return jres({
        id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true,
      });
      const runMatch = url.match(/\/api\/runs\/(\d+)$/);
      if (runMatch) {
        const rid = Number(runMatch[1]);
        return jres({
          id: rid, course_id: 1, version_id: 99, title: `Run ${rid}`, start_date: '2026-06-01', end_date: '2026-06-30',
          is_published: false, groups_enabled: false,
        });
      }
      if (url.match(/\/api\/runs\/10\/publish$/) && init?.method === 'POST') {
        return jres({
          detail: 'Cannot publish: 1 student already active',
          error_code: 'student_already_active_in_course',
          conflicts: [{ user_id: 1, email: 'a@example.com', run_id: 7, run_title: 'Old Run A' }],
        }, 409);
      }
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([{
        id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false,
      }]);
      if (url.includes('/teachers')) return jres([{ user_id: 1, user_email: 't@x.com' }]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });

    const props = $state({ courseSlug: 'algebra', runId: '10' });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props });
    await settle();
    const btn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement | null;
    if (!btn) throw new Error('Publish button not found');
    btn.click();
    await settle();
    expect(dialogEl()).not.toBeNull();

    // Change runId — the per-run reset $effect should close the modal.
    props.runId = '11';
    flushSync();
    await settle();
    expect(dialogEl()).toBeNull();
    unmount(cmp);
  });
  it("a field save that lands after a runId change does not overwrite the new run (final review)", async () => {
    let releaseSave!: (r: Response) => void;
    const heldSave = new Promise<Response>((r) => { releaseSave = r; });
    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/courses/by-slug/')) return jres({
        id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true,
      });
      const runMatch = url.match(/\/api\/runs\/(\d+)$/);
      if (runMatch && init?.method === 'PATCH') return heldSave;
      if (runMatch) {
        const rid = Number(runMatch[1]);
        return jres({
          id: rid, course_id: 1, version_id: 99, title: `Run ${rid}`, start_date: '2026-06-01', end_date: '2026-06-30',
          is_published: false, groups_enabled: false,
        });
      }
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([{
        id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false,
      }]);
      if (url.includes('/teachers')) return jres([{ user_id: 1, user_email: 't@x.com' }]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });

    const props = $state({ courseSlug: 'algebra', runId: '10' });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props });
    await settle();
    (target.querySelector('button[data-action="edit-title"]') as HTMLButtonElement).click();
    flushSync();
    const input = target.querySelector('input.in-input') as HTMLInputElement;
    input.value = 'Late title';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    flushSync();
    await settle();

    props.runId = '11';
    flushSync();
    await settle();
    expect(target.querySelector('h1')?.textContent).toBe('Run 11');

    releaseSave(await jres({
      id: 10, course_id: 1, version_id: 99, title: 'Late title', start_date: '2026-06-01', end_date: '2026-06-30',
      is_published: false, groups_enabled: false,
    }));
    await settle();
    expect(target.querySelector('h1')?.textContent).toBe('Run 11');
    unmount(cmp);
  });
  it("a field save on the same run still updates the page header (final review)", async () => {
    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/courses/by-slug/')) return jres({
        id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true,
      });
      if (url.match(/\/api\/runs\/10$/)) return jres({
        id: 10, course_id: 1, version_id: 99, start_date: '2026-06-01', end_date: '2026-06-30',
        is_published: false, groups_enabled: false,
        title: init?.method === 'PATCH' ? 'Summer' : 'Spring',
      });
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([{
        id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false,
      }]);
      if (url.includes('/teachers')) return jres([{ user_id: 1, user_email: 't@x.com' }]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    expect(target.querySelector('h1')?.textContent).toBe('Spring');
    (target.querySelector('button[data-action="edit-title"]') as HTMLButtonElement).click();
    flushSync();
    const input = target.querySelector('input.in-input') as HTMLInputElement;
    input.value = 'Summer';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    flushSync();
    await settle();
    expect(target.querySelector('h1')?.textContent).toBe('Summer');
    unmount(cmp);
  });
  it('closing the conflicts modal returns focus to Publish (spec §Publish conflicts › Focus)', async () => {
    const { target, cmp } = setupWithPublishStub({
      detail: 'Cannot publish: 1 student already active',
      error_code: 'student_already_active_in_course',
      conflicts: [{ user_id: 1, email: 'a@example.com', run_id: 7, run_title: 'Old Run A' }],
    }, 409);
    await settle();
    const btn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    btn.focus();
    btn.click();
    await settle();
    const close = dialogEl()!.querySelector<HTMLButtonElement>('button[data-action="close"]')!;
    expect(document.activeElement).toBe(close);
    close.click();
    await settle();
    expect(dialogEl()).toBeNull();
    expect(document.activeElement).toBe(target.querySelector('button[data-action="publish"]'));
    unmount(cmp);
  });
});

// A response the test releases by hand.
function held() {
  let release!: (r: Response) => void;
  const p = new Promise<Response>((r) => { release = r; });
  return { p, release };
}
function resp(body: unknown, status = 200): Response {
  return {
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response;
}
const runBase = {
  id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
  is_published: false, groups_enabled: false,
};
type Route = (url: string, init?: RequestInit) => Promise<Response> | null;

// The page's loads (one teacher by default, so Publish run is enabled), with
// `extra` asked first: a write the test answers or holds.
function mountWith(extra: Route, opts: {
  run?: Record<string, unknown>;
  course?: Record<string, unknown>;
  version?: Record<string, unknown>;
  teachers?: unknown[];
  groups?: unknown[];
  students?: unknown[];
} = {}) {
  fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
    const hit = extra(url, init);
    if (hit) return hit;
    if (url.includes('/courses/by-slug/')) return jres({
      id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true, ...(opts.course ?? {}),
    });
    const m = url.match(/\/api\/runs\/(\d+)$/);
    if (m && init?.method === 'GET') return jres({ ...runBase, ...(opts.run ?? {}), id: Number(m[1]) });
    if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
    if (url.includes('/mini-projects')) return jres([]);
    if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
    if (url.includes('/versions')) return jres([{
      id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false, label: 'Spring 2026',
      ...(opts.version ?? {}),
    }]);
    if (url.includes('/teachers')) return jres(opts.teachers ?? [{ user_id: 1, user_email: 't@x.com' }]);
    if (url.includes('/groups')) return jres(opts.groups ?? []);
    if (url.includes('/students')) return jres(opts.students ?? []);
    return Promise.reject(new Error('unexpected ' + url));
  });
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props = $state({ courseSlug: 'algebra', runId: '10' });
  const cmp = mount(RunDetailPage, { target, props });
  return { target, cmp, props };
}

const q = (t: HTMLElement, action: string) => t.querySelector(`button[data-action="${action}"]`) as HTMLButtonElement | null;
const isPost = (url: string, init: RequestInit | undefined, tail: string) => url.endsWith(tail) && init?.method === 'POST';

describe('Publish and Unpublish live in the Overview (R33, R44)', () => {
  it('the title row has no publish bar', async () => {
    const { target, cmp } = mountWith(() => null);
    await settle();
    expect(target.querySelector('.run-title-row button')).toBeNull();
    expect(target.querySelector('.publish-bar')).toBeNull();
    expect(q(target, 'publish')?.textContent?.trim()).toBe('Publish run');
    unmount(cmp);
  });

  it('two clicks while the request runs send one POST; the busy button is aria-disabled, keeps focus, then Unpublish has it', async () => {
    const hold = held();
    let posts = 0;
    const { target, cmp } = mountWith((url, init) => {
      if (isPost(url, init, '/publish')) { posts++; return hold.p; }
      return null;
    });
    await settle();
    const btn = q(target, 'publish')!;
    btn.focus();
    btn.click();
    btn.click();
    await settle();
    expect(posts).toBe(1);
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.textContent?.trim()).toBe('Publishing…');
    expect(document.activeElement).toBe(btn);
    hold.release(resp({ ...runBase, is_published: true }));
    await settle();
    expect(document.activeElement).toBe(q(target, 'unpublish'));
    unmount(cmp);
  });

  it('a 409 that is not a conflicts response refetches; a run found published counts as published', async () => {
    let published = false;
    const { target, cmp } = mountWith((url, init) => {
      if (isPost(url, init, '/publish')) { published = true; return jres({ detail: 'Run already published' }, 409); }
      if (/\/api\/runs\/10$/.test(url) && init?.method === 'GET' && published) return jres({ ...runBase, is_published: true });
      return null;
    });
    await settle();
    q(target, 'publish')!.focus();
    q(target, 'publish')!.click();
    await settle();
    await settle();
    expect(vi.mocked(pushToast)).toHaveBeenCalledWith('Run already published', 'error');
    expect(document.activeElement).toBe(q(target, 'unpublish'));
    unmount(cmp);
  });

  it("a second click on the confirm's Unpublish sends one POST; then Publish run has focus", async () => {
    const hold = held();
    let posts = 0;
    const { target, cmp } = mountWith((url, init) => {
      if (isPost(url, init, '/unpublish')) { posts++; return hold.p; }
      return null;
    }, { run: { is_published: true } });
    await settle();
    q(target, 'unpublish')!.click();
    flushSync();
    const confirm = q(target, 'confirm-unpublish')!;
    confirm.click();
    confirm.click();
    await settle();
    expect(posts).toBe(1);
    hold.release(resp({ ...runBase, is_published: false }));
    await settle();
    expect(document.activeElement).toBe(q(target, 'publish'));
    unmount(cmp);
  });

  it('a run change (loadAll) frees a stuck publish: Publish run sends again on the new run', async () => {
    const hold = held();
    const posts: string[] = [];
    const { target, cmp, props } = mountWith((url, init) => {
      if (isPost(url, init, '/publish')) {
        posts.push(url);
        return posts.length === 1 ? hold.p : jres({ ...runBase, id: 11, is_published: true });
      }
      return null;
    });
    await settle();
    q(target, 'publish')!.click();
    await settle();
    props.runId = '11';
    flushSync();
    await settle();
    const again = q(target, 'publish')!;
    expect(again.getAttribute('aria-disabled')).toBeNull();
    again.click();
    await settle();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toContain('/api/runs/11/publish');
    unmount(cmp);
  });

  it('a remount of the Overview while publishing keeps the pencils and the switch locked (R32)', async () => {
    const hold = held();
    const { target, cmp } = mountWith((url, init) => (isPost(url, init, '/publish') ? hold.p : null));
    await settle();
    q(target, 'publish')!.click();
    await settle();
    (target.querySelector('#run-tab-teachers') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('#run-tab-overview') as HTMLButtonElement).click();
    await settle();
    expect(q(target, 'edit-title')!.disabled).toBe(true);
    expect(target.querySelector('button[role="switch"]')!.getAttribute('aria-disabled')).toBe('true');
    hold.release(resp({ ...runBase, is_published: true }));
    await settle();
    expect(q(target, 'edit-title')!.disabled).toBe(false);
    unmount(cmp);
  });

  // Polish 3 §Behaviour "Offline failures say so".
  it('a rejected TypeError on Publish run shows a toast', async () => {
    const { target, cmp } = mountWith((url, init) => (isPost(url, init, '/publish') ? Promise.reject(new TypeError('Failed to fetch')) : null));
    await settle();
    q(target, 'publish')!.click();
    await settle();
    expect(vi.mocked(pushToast)).toHaveBeenCalledWith('Could not reach server. Check your connection.', 'error');
    unmount(cmp);
  });

  it('a rejected TypeError on Unpublish shows a toast', async () => {
    const { target, cmp } = mountWith((url, init) => (isPost(url, init, '/unpublish') ? Promise.reject(new TypeError('Failed to fetch')) : null), { run: { is_published: true } });
    await settle();
    q(target, 'unpublish')!.click();
    flushSync();
    q(target, 'confirm-unpublish')!.click();
    await settle();
    expect(vi.mocked(pushToast)).toHaveBeenCalledWith('Could not reach server. Check your connection.', 'error');
    unmount(cmp);
  });
});

describe('Publish readiness rows from the page (R34)', () => {
  const rows = (t: HTMLElement) => Array.from(t.querySelectorAll('li.ov-check')).map((li) => [
    li.getAttribute('data-check'), li.getAttribute('data-state'),
    li.querySelector('.ov-hint, .ov-hint-link')?.textContent?.trim() ?? '',
  ]);

  it('groups off: four rows, the two group rows not applicable', async () => {
    const { target, cmp } = mountWith(() => null);
    await settle();
    expect(rows(target)).toEqual([
      ['teacher', 'ok', ''], ['version', 'ok', ''],
      ['assigned', 'na', 'not applicable'], ['sizes', 'na', 'not applicable'],
    ]);
    unmount(cmp);
  });

  it('no teacher: "Add a teacher — open Teachers" opens Teachers with focus on its tab', async () => {
    const { target, cmp } = mountWith(() => null, { teachers: [] });
    await settle();
    expect(rows(target)[0]).toEqual(['teacher', 'violated', 'Add a teacher — open Teachers']);
    expect(q(target, 'publish')!.title).toBe('No teacher is assigned yet');
    q(target, 'goto-teachers')!.click();
    await settle();
    expect(document.activeElement).toBe(target.querySelector('#run-tab-teachers'));
    unmount(cmp);
  });

  it('a disabled version: row 2 violated with the role hint; Publish run disabled with "The course version is disabled"', async () => {
    const admin = mountWith(() => null, { version: { is_disabled: true } });
    await settle();
    expect(rows(admin.target)[1]).toEqual(['version', 'violated', 'Re-enable it in the course editor']);
    expect(q(admin.target, 'publish')!.disabled).toBe(true);
    expect(q(admin.target, 'publish')!.title).toBe('The course version is disabled');
    unmount(admin.cmp);
    const teacher = mountWith(() => null, { version: { is_disabled: true }, course: { is_admin: false } });
    await settle();
    expect(rows(teacher.target)[1]).toEqual(['version', 'violated', 'Ask a course admin to re-enable it']);
    unmount(teacher.cmp);
  });

  it('groups on, no students: row 3 ok and Publish run enabled', async () => {
    const { target, cmp } = mountWith(() => null, { run: { groups_enabled: true } });
    await settle();
    expect(rows(target)[2]).toEqual(['assigned', 'ok', '']);
    expect(q(target, 'publish')!.disabled).toBe(false);
    unmount(cmp);
  });

  it('groups on, no groups and an unassigned student: "No groups yet — open Groups"', async () => {
    const { target, cmp } = mountWith(() => null, {
      run: { groups_enabled: true },
      students: [{ user_id: 2, email: 'a@x.com', full_name: null, group_id: null }],
    });
    await settle();
    expect(rows(target)[2]).toEqual(['assigned', 'violated', 'No groups yet — open Groups']);
    expect(q(target, 'publish')!.title).toBe('1 student is still unassigned to a group');
    unmount(cmp);
  });

  it('groups on, 3 unassigned and an oversized group: two violations and the Roster jump', async () => {
    const { target, cmp } = mountWith(() => null, {
      run: { groups_enabled: true },
      groups: [{ id: 1, run_id: 10, name: 'Group A', student_count: 12 }],
      students: [1, 2, 3].map((n) => ({ user_id: n, email: `s${n}@x.com`, full_name: null, group_id: null })),
    });
    await settle();
    expect(rows(target).slice(2)).toEqual([
      ['assigned', 'violated', '3 unassigned — open Roster'],
      ['sizes', 'violated', 'Group A (12)'],
    ]);
    expect(target.querySelector('.ov-foot-note')?.textContent?.trim()).toBe('Fix the 2 outstanding checks to publish.');
    expect(q(target, 'publish')!.title).toBe('3 students are still unassigned to a group');
    unmount(cmp);
  });
});

describe('Delete this run from the page (D24, D28, P24)', () => {
  async function arm(target: HTMLElement) {
    q(target, 'delete-run')!.click();
    flushSync();
    (target.querySelector('input[data-role="danger-ack"]') as HTMLInputElement).click();
    flushSync();
    return q(target, 'force-delete')!;
  }

  it('Force delete sends DELETE ?force=true and toasts "Run deleted."', async () => {
    const deletes: string[] = [];
    const { target, cmp } = mountWith((url, init) => {
      if (init?.method === 'DELETE') { deletes.push(url); return jres(null, 204); }
      return null;
    });
    await settle();
    (await arm(target)).click();
    await settle();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain('/api/runs/10?force=true');
    expect(vi.mocked(pushToast)).toHaveBeenCalledWith('Run deleted.', 'success');
    unmount(cmp);
  });

  it('a 409 refetches the run, closes the panel, toasts, and focuses the card heading', async () => {
    let published = false;
    const { target, cmp } = mountWith((url, init) => {
      if (init?.method === 'DELETE') { published = true; return jres({ detail: 'Unpublish run before deleting' }, 409); }
      if (/\/api\/runs\/10$/.test(url) && init?.method === 'GET' && published) return jres({ ...runBase, is_published: true });
      return null;
    });
    await settle();
    (await arm(target)).click();
    await settle();
    await settle();
    expect(target.querySelector('.danger-confirm')).toBeNull();
    expect(vi.mocked(pushToast)).toHaveBeenCalledWith('This run was published in the meantime. Unpublish it before deleting.', 'error');
    expect(q(target, 'delete-run')!.disabled).toBe(true);
    expect(q(target, 'delete-run')!.title).toBe('Unpublish the run before deleting it');
    expect((document.activeElement as HTMLElement).textContent).toBe('Delete this run');
    unmount(cmp);
  });

  it('another failure shows the error line, keeps the panel and refocuses its box (R45)', async () => {
    const { target, cmp } = mountWith((_url, init) => (init?.method === 'DELETE' ? jres({ detail: 'Database is busy' }, 503) : null));
    await settle();
    const force = await arm(target);
    force.focus();
    force.click();
    await settle();
    await settle();
    expect(target.querySelector('.ov-err')?.textContent).toBe('Database is busy');
    const box = target.querySelector('input[data-role="danger-ack"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(document.activeElement).toBe(box);
    unmount(cmp);
  });
});
