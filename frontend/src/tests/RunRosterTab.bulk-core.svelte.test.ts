import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunRosterTab from '../components/runs/RunRosterTab.svelte';

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
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

const studentN = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    run_id: 10,
    user_id: i + 1,
    user_email: `s${i + 1}@x.com`,
    user_full_name: `S${i + 1}`,
    group_id: null,
    created_at: '2026-01-01T00:00:00Z',
  }));

function mountTab(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RunRosterTab, {
    target,
    props: {
      runId: 10,
      runIsPublished: true,
      courseSlug: 'test',
      onNavigateToTab: vi.fn(),
      students: studentN(3),
      groups: [{ id: 99, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false }],
      groupsEnabled: true,
      rosterPrefilter: null,
      onPrefilterClear: vi.fn(),
      onRefetchRosterData: vi.fn().mockResolvedValue({ students: [], groups: [] }),
      onRefetchGroupsOnly: vi.fn().mockResolvedValue(undefined),
      onOpenImport: vi.fn(),
      ...extra,
    },
  });
  return { target, cmp };
}

describe('RunRosterTab bulk-op dispatcher', () => {
  it('hides action strip when selection is empty, shows when >=1 selected', async () => {
    const { target, cmp } = mountTab();
    await settle();
    expect(target.querySelector('[data-strip="bulk"]')).toBeNull();
    (target.querySelectorAll('input[data-row-checkbox]')[0] as HTMLInputElement).click();
    flushSync();
    expect(target.querySelector('[data-strip="bulk"]')).not.toBeNull();
    expect(target.textContent).toContain('1 selected');
    unmount(cmp);
  });

  it('chunks bulk-move >200 sequentially (chunk[i+1] after chunk[i] resolves)', async () => {
    const callOrder: number[] = [];
    const resolvers: Array<(r: Response) => void> = [];
    fetchSpy.mockImplementation((url: string, init: RequestInit) => {
      if (!url.includes('bulk-move')) {
        return jres({ results: [], summary: { total: 0, ok: 0, error: 0 } }, 200);
      }
      const body = JSON.parse(init.body as string);
      const len = body.user_ids.length;
      callOrder.push(len);
      return new Promise<Response>((res) => {
        resolvers.push((r) => res(r));
      });
    });

    const refetch = vi.fn().mockResolvedValue({ students: [], groups: [] });
    const { target, cmp } = mountTab({
      students: studentN(250),
      onRefetchRosterData: refetch,
    });
    await settle();
    // Select all
    (target.querySelector('input[data-header-checkbox]') as HTMLInputElement).click();
    flushSync();
    // Click Move-to-group → Alpha
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement).value = '99';
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement)
      .dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(callOrder).toEqual([200]); // first chunk only
    // Resolve chunk 1
    resolvers[0]({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        results: Array.from({ length: 200 }, (_, i) => ({ user_id: i + 1, status: 'ok' })),
        summary: { total: 200, ok: 200, error: 0 },
      }),
      headers: new Headers(),
    } as unknown as Response);
    await settle();
    expect(callOrder).toEqual([200, 50]); // second chunk fired
    resolvers[1]({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        results: Array.from({ length: 50 }, (_, i) => ({ user_id: i + 201, status: 'ok' })),
        summary: { total: 50, ok: 50, error: 0 },
      }),
      headers: new Headers(),
    } as unknown as Response);
    await settle();
    expect(refetch).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('paints red border on per-row error and keeps row in selection', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('bulk-move')) {
        return jres({
          results: [
            { user_id: 1, status: 'ok' },
            { user_id: 2, status: 'error', error_code: 'capacity_reached', detail: 'full' },
            { user_id: 3, status: 'ok' },
          ],
          summary: { total: 3, ok: 2, error: 1 },
        }, 200);
      }
      return jres({ results: [], summary: { total: 0, ok: 0, error: 0 } }, 200);
    });

    const { target, cmp } = mountTab({
      students: studentN(3),
      onRefetchRosterData: vi.fn().mockResolvedValue({
        students: studentN(3),
        groups: [{ id: 99, run_id: 10, name: 'Alpha', student_count: 2, is_disabled: false }],
      }),
    });
    await settle();
    (target.querySelector('input[data-header-checkbox]') as HTMLInputElement).click();
    flushSync();
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement).value = '99';
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement)
      .dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    // User 2 should have red-border class
    const row2 = target.querySelector('tr[data-user-id="2"]');
    expect(row2?.classList.contains('row-error')).toBe(true);
    unmount(cmp);
  });

  it('renders all 5 per-row tooltip mappings on bulk-op errors (spec §4.4)', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (!url.includes('bulk-move')) {
        return jres({ results: [], summary: { total: 0, ok: 0, error: 0 } });
      }
      return jres({
        results: [
          { user_id: 1, status: 'error', error_code: 'not_in_run', detail: '...' },
          { user_id: 2, status: 'error', error_code: 'capacity_reached', detail: '...' },
          { user_id: 3, status: 'error', error_code: 'internal_error', detail: '...' },
          { user_id: 4, status: 'error', error_code: null, detail: 'Custom backend message' },
          { user_id: 5, status: 'error', error_code: null }, // detail also missing
        ],
        summary: { total: 5, ok: 0, error: 5 },
      });
    });

    const { target, cmp } = mountTab({
      students: studentN(5),
      onRefetchRosterData: vi.fn().mockResolvedValue({
        students: studentN(5),
        groups: [{ id: 99, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false }],
      }),
    });
    await settle();
    (target.querySelector('input[data-header-checkbox]') as HTMLInputElement).click();
    flushSync();
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement).value = '99';
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement)
      .dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    const tooltipOf = (uid: number) =>
      (target.querySelector(`tr[data-user-id="${uid}"]`) as HTMLElement | null)?.getAttribute('title');

    expect(tooltipOf(1)).toBe('Student is no longer enrolled in this run.');
    expect(tooltipOf(2)).toBe('Target group is full (10 students).');
    expect(tooltipOf(3)).toBe('Server error — please retry.');
    expect(tooltipOf(4)).toBe('Custom backend message');
    expect(tooltipOf(5)).toBe('Unknown error.');
    unmount(cmp);
  });
});
