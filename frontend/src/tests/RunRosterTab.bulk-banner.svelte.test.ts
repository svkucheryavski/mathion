import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunRosterTab from '../components/runs/RunRosterTab.svelte';

const fetchSpy = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
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
      students: studentN(3),
      groups: [{ id: 99, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false }],
      groupsEnabled: true,
      rosterPrefilter: null,
      onPrefilterClear: vi.fn(),
      onRefetchRosterData: vi.fn().mockResolvedValue({
        students: studentN(3),
        groups: [{ id: 99, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false }],
      }),
      onRefetchGroupsOnly: vi.fn().mockResolvedValue(undefined),
      onOpenImport: vi.fn(),
      ...extra,
    },
  });
  return { target, cmp };
}

describe('RunRosterTab bulk-op banner + retry', () => {
  it('full success: shows banner and auto-dismisses after 5s', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('bulk-move')) {
        return jres({
          results: [
            { user_id: 1, status: 'ok' },
            { user_id: 2, status: 'ok' },
            { user_id: 3, status: 'ok' },
          ],
          summary: { total: 3, ok: 3, error: 0 },
        });
      }
      return jres({ results: [], summary: { total: 0, ok: 0, error: 0 } });
    });
    const { target, cmp } = mountTab();
    await settle();
    (target.querySelector('input[data-header-checkbox]') as HTMLInputElement).click();
    flushSync();
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement).value = '99';
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement)
      .dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(target.textContent).toContain('Moved 3 of 3');
    vi.advanceTimersByTime(5100);
    flushSync();
    expect(target.textContent).not.toContain('Moved 3 of 3');
    unmount(cmp);
  });

  it('per-row partial: Retry → group dropdown re-fires move on still-selected rows', async () => {
    let phase: 1 | 2 = 1;
    fetchSpy.mockImplementation((url: string, init: RequestInit) => {
      if (!url.includes('bulk-move')) return jres({ results: [], summary: { total: 0, ok: 0, error: 0 } });
      if (phase === 1) {
        phase = 2;
        return jres({
          results: [
            { user_id: 1, status: 'ok' },
            { user_id: 2, status: 'error', error_code: 'capacity_reached', detail: 'full' },
            { user_id: 3, status: 'ok' },
          ],
          summary: { total: 3, ok: 2, error: 1 },
        });
      } else {
        const body = JSON.parse(init.body as string);
        expect(body.user_ids).toEqual([2]);
        return jres({ results: [{ user_id: 2, status: 'ok' }], summary: { total: 1, ok: 1, error: 0 } });
      }
    });
    const { target, cmp } = mountTab();
    await settle();
    (target.querySelector('input[data-header-checkbox]') as HTMLInputElement).click();
    flushSync();
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement).value = '99';
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement)
      .dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(target.textContent).toMatch(/Moved 2 of 3.*1 failed/);
    (target.querySelector('[data-action="retry-move-select"]') as HTMLSelectElement).value = '99';
    (target.querySelector('[data-action="retry-move-select"]') as HTMLSelectElement)
      .dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    unmount(cmp);
  });

  it('chunk-level cancelled: shows banner with Retry-cancelled button', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Server error' }, 500));
    const { target, cmp } = mountTab();
    await settle();
    (target.querySelector('input[data-header-checkbox]') as HTMLInputElement).click();
    flushSync();
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement).value = '99';
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement)
      .dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(target.querySelector('[data-action="retry-cancelled"]')).not.toBeNull();
    unmount(cmp);
  });

  it('partial banner does NOT auto-dismiss (advance 10s, still visible)', async () => {
    fetchSpy.mockImplementation(() => jres({
      results: [
        { user_id: 1, status: 'ok' },
        { user_id: 2, status: 'error', error_code: 'capacity_reached', detail: 'full' },
        { user_id: 3, status: 'ok' },
      ],
      summary: { total: 3, ok: 2, error: 1 },
    }));
    const { target, cmp } = mountTab();
    await settle();
    (target.querySelector('input[data-header-checkbox]') as HTMLInputElement).click();
    flushSync();
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement).value = '99';
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement)
      .dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(target.textContent).toMatch(/Moved 2 of 3.*1 failed/);
    vi.advanceTimersByTime(10000);
    flushSync();
    expect(target.textContent).toMatch(/Moved 2 of 3.*1 failed/);
    unmount(cmp);
  });
});
