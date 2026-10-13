import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunDetailPage from '../pages/runs/RunDetailPage.svelte';
import { session } from '../stores/session.svelte';
import { currentRoute, registerNavigationGuard, __resetGuardsForTests } from '../lib/router.svelte';

// R1/R10: the open tab lives in ?tab=, every switch goes through setTab and the
// registered unsaved-changes guards. Review Focus 1 is the cancelled-guard case.
const fetchSpy = vi.fn();
function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

const course = { id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true };
const runFx = (id = 10) => ({
  id, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
  is_published: true, groups_enabled: true,
});
const version = { id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false };
const block = { id: 1, version_id: 99, title: 'Vectors', slug: 'vectors', order: 0, info: '', info_html: '' };
const mp = {
  id: 5, run_id: 10, block_id: 1, title: 'Vectors project', assignment_md: 'See ![fig](fig.png)',
  assignment_html: '', soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
  is_published: false, first_submitted_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};
const asset = {
  id: 1, run_id: 10, filename: 'fig.png', file_size: 10, mime_type: 'image/png',
  uploaded_at: '2026-01-01T00:00:00Z', uploaded_by: 1, uploaded_by_email: 'a@x', is_referenced: true,
};
const teacher = { id: 1, run_id: 10, user_id: 1, user_email: 't@x', user_full_name: 'T', created_at: '2026-01-01' };
const unassigned = { id: 1, run_id: 10, user_id: 7, user_email: 's@x', user_full_name: 'S', group_id: null, created_at: '2026-01-01' };

function mockRun() {
  fetchSpy.mockImplementation((url: string) => {
    if (url.includes('/courses/by-slug/')) return jres(course);
    const m = url.match(/\/api\/runs\/(\d+)$/);
    if (m) return jres(runFx(Number(m[1])));
    if (url.includes('/versions/99/blocks')) return jres([block]);
    if (url.match(/\/api\/runs\/\d+\/mini-projects$/)) return jres([mp]);
    if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([asset]);
    if (url.includes('/versions')) return jres([version]);
    if (url.includes('/teachers')) return jres([teacher]);
    // R34: with zero groups the unassigned row offers Groups; one group keeps the Roster jump.
    if (url.includes('/groups')) return jres([{ id: 1, run_id: 10, name: 'Group A', is_disabled: false, student_count: 0 }]);
    if (url.includes('/students')) return jres([unassigned]);
    return jres([]);
  });
}
const runLoads = () => fetchSpy.mock.calls.filter(([u]) => /\/api\/runs\/\d+$/.test(u as string)).length;
const versionLoads = () => fetchSpy.mock.calls.filter(([u]) => /\/versions$/.test(u as string)).length;

function at(url: string) {
  history.replaceState(null, '', url);
  currentRoute.path = location.pathname;
  currentRoute.search = location.search;
  currentRoute.hash = location.hash;
}
let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
function open(props: { courseSlug: string; runId: string } = { courseSlug: 'algebra', runId: '10' }) {
  target = document.createElement('div');
  document.body.appendChild(target);
  cmp = mount(RunDetailPage, { target, props });
}
const tab = (key: string) => target.querySelector(`#run-tab-${key}`) as HTMLButtonElement;
const selected = () => target.querySelector('[role="tab"][aria-selected="true"]')?.id;
const address = () => location.pathname + location.search + location.hash;

beforeEach(() => {
  __resetGuardsForTests();
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  session.user = {
    id: 1, email: 't@x', full_name: 'T', is_superuser: false, is_disabled: false, photo_url: null,
    has_course_admin: true, has_run_teacher: true,
  };
  mockRun();
});
afterEach(() => {
  if (cmp) { unmount(cmp); cmp = null; }
  target?.remove();
  __resetGuardsForTests();
});

describe('RunDetailPage — the tab in the address', () => {
  it('?tab=groups on first load opens Groups, not Overview', async () => {
    at('/teaching/algebra/runs/10?tab=groups');
    open();
    await settle();
    expect(selected()).toBe('run-tab-groups');
    const panel = target.querySelector('#run-panel') as HTMLElement;
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe('run-tab-groups');
  });

  it('an unknown tab opens Overview and rewrites the address once, keeping the rest', async () => {
    at('/teaching/algebra/runs/10?a=1&tab=nope#x');
    const before = history.length;
    open();
    await settle();
    expect(selected()).toBe('run-tab-overview');
    expect(address()).toBe('/teaching/algebra/runs/10?a=1#x');
    expect(history.length).toBe(before);
  });

  it('a missing ?tab is not rewritten', async () => {
    at('/teaching/algebra/runs/10?a=1');
    open();
    await settle();
    expect(address()).toBe('/teaching/algebra/runs/10?a=1');
  });

  it('a tab click replaces the address, keeps focus on the tab, and does not reload the run', async () => {
    at('/teaching/algebra/runs/10');
    const before = history.length;
    open();
    await settle();
    const runs = runLoads();
    const vers = versionLoads();
    tab('roster').focus();
    tab('roster').click();
    await settle();
    expect(address()).toBe('/teaching/algebra/runs/10?tab=roster');
    expect(history.length).toBe(before);
    expect(selected()).toBe('run-tab-roster');
    expect(document.activeElement).toBe(tab('roster'));
    tab('overview').click();
    await settle();
    expect(address()).toBe('/teaching/algebra/runs/10');
    expect(runLoads()).toBe(runs);
    expect(versionLoads()).toBe(vers);
    expect(target.textContent).not.toContain('Loading run…');
  });

  it('Overview "open Roster" lands on Roster with the Unassigned prefilter, ?tab=roster, focus on the Roster tab', async () => {
    at('/teaching/algebra/runs/10');
    open();
    await settle();
    (target.querySelector('button[data-action="goto-unassigned"]') as HTMLButtonElement).click();
    await settle();
    expect(selected()).toBe('run-tab-roster');
    expect(location.search).toBe('?tab=roster');
    expect(target.textContent).toContain('Showing: Unassigned');
    expect(document.activeElement).toBe(tab('roster'));
  });

  it('Assets "Edit" lands on Mini-projects and opens that mini-project; the tab has focus underneath', async () => {
    at('/teaching/algebra/runs/10?tab=assets');
    open();
    await settle();
    (target.querySelector('button[aria-controls="uses-1"]') as HTMLButtonElement).click();
    flushSync();
    const edit = Array.from(target.querySelectorAll('#uses-1 button')).find((b) => b.textContent?.trim() === 'Edit') as HTMLButtonElement;
    edit.click();
    await settle();
    await settle();
    expect(selected()).toBe('run-tab-mini-projects');
    expect(location.search).toBe('?tab=mini-projects');
    expect(document.querySelector('[role="dialog"][aria-labelledby="mp-modal-title"]')).not.toBeNull();
  });

  it('a cancelled guard keeps the tab, the address, no prefilter and no pending edit', async () => {
    at('/teaching/algebra/runs/10');
    open();
    await settle();
    const dispose = registerNavigationGuard(() => false);
    (target.querySelector('button[data-action="goto-unassigned"]') as HTMLButtonElement).click();
    await settle();
    expect(selected()).toBe('run-tab-overview');
    expect(address()).toBe('/teaching/algebra/runs/10');

    tab('assets').click();
    await settle();
    expect(selected()).toBe('run-tab-overview');
    dispose();

    // The guard is gone: Roster opens WITHOUT the dropped prefilter.
    tab('roster').click();
    await settle();
    expect(selected()).toBe('run-tab-roster');
    expect(target.textContent).not.toContain('Showing: Unassigned');

    // A cancelled Assets → Edit leaves no pending edit behind.
    tab('assets').click();
    await settle();
    (target.querySelector('button[aria-controls="uses-1"]') as HTMLButtonElement).click();
    flushSync();
    const again = registerNavigationGuard(() => false);
    (Array.from(target.querySelectorAll('#uses-1 button')).find((b) => b.textContent?.trim() === 'Edit') as HTMLButtonElement).click();
    await settle();
    expect(selected()).toBe('run-tab-assets');
    again();
    tab('mini-projects').click();
    await settle();
    expect(selected()).toBe('run-tab-mini-projects');
    expect(document.querySelector('[role="dialog"][aria-labelledby="mp-modal-title"]')).toBeNull();
  });

  it('an accepted guard switches', async () => {
    at('/teaching/algebra/runs/10');
    open();
    await settle();
    const guard = vi.fn(() => true);
    registerNavigationGuard(guard);
    tab('teachers').click();
    await settle();
    expect(guard).toHaveBeenCalledTimes(1);
    expect(selected()).toBe('run-tab-teachers');
    expect(location.search).toBe('?tab=teachers');
  });

  it('a different :runId resets the per-run state; the tab still comes from the address', async () => {
    at('/teaching/algebra/runs/10');
    const props = $state({ courseSlug: 'algebra', runId: '10' });
    open(props);
    await settle();
    (target.querySelector('button[data-action="goto-unassigned"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Showing: Unassigned');
    at('/teaching/algebra/runs/11?tab=roster');
    props.runId = '11';
    await settle();
    await settle();
    expect(selected()).toBe('run-tab-roster');
    expect(target.textContent).not.toContain('Showing: Unassigned');
  });
});
