import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunOverviewTab from '../components/runs/RunOverviewTab.svelte';
import type { RunResponse } from '../lib/types';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
});

const makeRun = (over: Partial<RunResponse> = {}): RunResponse => ({
  id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
  is_published: false, groups_enabled: false, ...over,
} as RunResponse);

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

type Extra = {
  run?: Partial<RunResponse>;
  readiness?: { checks: Array<{ id: string; label: string; state: 'ok' | 'violated' | 'na'; hint?: string }>; firstViolation: string | null };
};

function mountTab(extra: Extra = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const setRun = vi.fn();
  const onNavigateTab = vi.fn();
  const onDeleteRun = vi.fn();
  const cmp = mount(RunOverviewTab, {
    target,
    props: {
      run: makeRun(extra.run ?? {}),
      setRun,
      teachers: [],
      groups: [],
      students: [],
      readiness: extra.readiness ?? { checks: [], firstViolation: null },
      onNavigateTab,
      onDeleteRun,
    },
  });
  return { target, cmp, setRun, onNavigateTab, onDeleteRun };
}

describe('RunOverviewTab checklist + settings + danger zone', () => {
  it('renders three checklist rows from readiness.checks', async () => {
    const { target, cmp } = mountTab({
      readiness: {
        checks: [
          { id: 'teacher', label: 'At least one teacher', state: 'ok' },
          { id: 'assigned', label: 'All students assigned to a group', state: 'na' },
          { id: 'sizes', label: 'All groups have 1–10 students', state: 'na' },
        ],
        firstViolation: null,
      },
    });
    await settle();
    expect(target.textContent).toContain('At least one teacher');
    expect(target.textContent).toContain('All groups have 1–10 students');
    unmount(cmp);
  });

  it('clicks unassigned hint and invokes onNavigateTab(roster, unassigned)', async () => {
    const { target, cmp, onNavigateTab } = mountTab({
      run: { groups_enabled: true },
      readiness: {
        checks: [
          { id: 'teacher', label: 'At least one teacher', state: 'ok' },
          { id: 'assigned', label: 'All students assigned to a group', state: 'violated', hint: '3 students unassigned.' },
          { id: 'sizes', label: 'All groups have 1–10 students', state: 'ok' },
        ],
        firstViolation: '3 students unassigned.',
      },
    });
    await settle();
    const hint = target.querySelector('button[data-action="goto-unassigned"]') as HTMLButtonElement;
    expect(hint).toBeTruthy();
    hint.click();
    flushSync();
    expect(onNavigateTab).toHaveBeenCalledWith('roster', 'unassigned');
    unmount(cmp);
  });

  it('PATCHes groups_enabled when checkbox toggled', async () => {
    fetchSpy.mockImplementation((_url: string, init: RequestInit) => {
      expect(init.method).toBe('PATCH');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ groups_enabled: true });
      return jres(makeRun({ groups_enabled: true }));
    });
    const { target, cmp, setRun } = mountTab({});
    await settle();
    const cb = target.querySelector('input[name="groups_enabled"]') as HTMLInputElement;
    cb.click();
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(setRun).toHaveBeenCalled();
    unmount(cmp);
  });

  it('disables groups_enabled checkbox with tooltip when published', async () => {
    const { target, cmp } = mountTab({
      run: { is_published: true },
    });
    await settle();
    const cb = target.querySelector('input[name="groups_enabled"]') as HTMLInputElement;
    expect(cb.disabled).toBe(true);
    const label = cb.closest('label')!;
    expect(label.getAttribute('title')).toContain('Locked once');
    unmount(cmp);
  });

  it('hides Delete-run when published, shows InlineConfirm flow when draft', async () => {
    const { target, cmp, onDeleteRun } = mountTab({});
    await settle();
    const del = target.querySelector('button[data-action="delete-run"]') as HTMLButtonElement;
    expect(del).toBeTruthy();
    del.click();
    flushSync();
    expect(target.textContent).toContain('Confirm Delete');
    (target.querySelector('button[data-action="confirm-delete"]') as HTMLButtonElement).click();
    expect(onDeleteRun).toHaveBeenCalled();
    unmount(cmp);

    const pub = mountTab({
      run: { is_published: true },
    });
    await settle();
    expect(pub.target.querySelector('button[data-action="delete-run"]')).toBeNull();
    unmount(pub.cmp);
  });
});
