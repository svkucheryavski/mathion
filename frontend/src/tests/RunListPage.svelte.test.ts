import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunListPage from '../pages/runs/RunListPage.svelte';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  globalThis.fetch = fetchSpy as typeof globalThis.fetch;
  document.body.innerHTML = '';
  // Hash router default
  location.hash = '#/courses/algebra/runs';
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

  it('renders rows in backend order with status badge and version label', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return ok({ id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true });
      if (url.endsWith('/runs')) return ok([
        { id: 10, course_id: 1, version_id: 99, title: 'Spring 2026', start_date: '2026-06-01', end_date: '2026-06-30', is_published: false, groups_enabled: false },
        { id: 11, course_id: 1, version_id: 99, title: 'Fall 2026', start_date: '2026-09-01', end_date: '2026-12-15', is_published: true, groups_enabled: true },
      ]);
      if (url.includes('/versions')) return ok([
        { id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false },
      ]);
      return Promise.reject(new Error('unexpected ' + url));
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunListPage, { target, props: { courseSlug: 'algebra' } });
    await settle();

    const rows = target.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Spring 2026');
    expect(rows[1].textContent).toContain('Fall 2026');
    // Status badges
    expect(target.textContent).toMatch(/Draft/);
    // Version label format
    expect(target.textContent).toContain('v1 (2026-01-01)');
    // Delete only on the unpublished row
    const deleteButtons = target.querySelectorAll('button[data-action="delete-run"]');
    expect(deleteButtons.length).toBe(1);
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
});
