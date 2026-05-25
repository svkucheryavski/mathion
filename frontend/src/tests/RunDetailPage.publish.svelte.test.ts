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

function setup(opts: { teachers?: unknown[]; groups?: unknown[]; students?: unknown[]; run?: Record<string, unknown> } = {}) {
  fetchSpy.mockImplementation((url: string) => {
    if (url.includes('/courses/by-slug/')) return jres({ id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true });
    if (url.match(/\/api\/runs\/10$/)) return jres({
      id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
      is_published: false, groups_enabled: false, ...(opts.run ?? {}),
    });
    if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
    if (url.includes('/mini-projects')) return jres([]);
    if (url.includes('/versions')) return jres([{ id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false }]);
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
