import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunDetailPage from '../pages/runs/RunDetailPage.svelte';

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

function dialogEl(): Element | null {
  return document.querySelector('[role="dialog"][aria-label="Cannot publish run"]');
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
});
