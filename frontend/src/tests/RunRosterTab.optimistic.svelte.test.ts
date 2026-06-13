import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunRosterTab from '../components/runs/RunRosterTab.svelte';
import type { GroupResponse, RunStudentResponse } from '../lib/types';

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

const fakeStudent = (over: Partial<RunStudentResponse> = {}): RunStudentResponse => ({
  id: over.user_id ?? 1,
  run_id: 10,
  user_id: 1,
  user_email: 'a@x.com',
  user_full_name: 'Alice',
  group_id: null,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
} as RunStudentResponse);

const fakeGroup = (over: Partial<GroupResponse> = {}): GroupResponse => ({
  id: 99,
  run_id: 10,
  name: 'Alpha',
  student_count: 0,
  is_disabled: false,
  ...over,
} as GroupResponse);

function defaultGroups(): GroupResponse[] {
  return [
    fakeGroup({ id: 99, name: 'Alpha', student_count: 0 }),
    fakeGroup({ id: 100, name: 'Beta', student_count: 5 }),
  ];
}

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
      students: [fakeStudent({ user_id: 1, group_id: null })],
      groups: defaultGroups(),
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

describe('RunRosterTab optimistic inline group edit', () => {
  it('PATCHes group change and disables select during in-flight', async () => {
    let resolvePatch: (r: Response) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { resolvePatch = r; }));
    const onRefetchGroupsOnly = vi.fn().mockResolvedValue(undefined);
    const { target, cmp } = mountTab({ onRefetchGroupsOnly });
    await settle();
    const sel = target.querySelector('tbody select') as HTMLSelectElement;
    sel.value = '99';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(sel.disabled).toBe(true);
    resolvePatch({
      ok: true, status: 200,
      json: () => Promise.resolve({
        id: 1, run_id: 10, user_id: 1, user_email: 'a@x.com',
        user_full_name: 'Alice', group_id: 99, created_at: '2026-01-01T00:00:00Z',
      }),
      headers: new Headers(),
    } as unknown as Response);
    await settle();
    expect(sel.disabled).toBe(false);
    expect(onRefetchGroupsOnly).toHaveBeenCalled();
    unmount(cmp);
  });

  it('reverts on 409 capacity_reached with toast', async () => {
    fetchSpy.mockImplementation(() =>
      jres({ detail: 'Target group is full (10 students).', error_code: 'capacity_reached' }, 409),
    );
    const { target, cmp } = mountTab();
    await settle();
    const sel = target.querySelector('tbody select') as HTMLSelectElement;
    sel.value = '100';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    // Select value reverted (pendingGroupId.delete unlocks → back to student.group_id = null = '__unassigned')
    expect(sel.value).toBe('__unassigned');
    expect(sel.disabled).toBe(false);
    unmount(cmp);
  });

  it('optimistic unassign renders __unassigned (.has() guard, not ??)', async () => {
    let resolvePatch: (r: Response) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { resolvePatch = r; }));
    const { target, cmp } = mountTab({
      students: [fakeStudent({ user_id: 1, group_id: 99 })],
    });
    await settle();
    const sel = target.querySelector('tbody select') as HTMLSelectElement;
    expect(sel.value).toBe('99');
    sel.value = '__unassigned';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    // Optimistic: pendingGroupId.set(1, null) → rendered value should be '__unassigned' immediately
    expect(sel.value).toBe('__unassigned');
    resolvePatch({
      ok: true, status: 200,
      json: () => Promise.resolve({
        id: 1, run_id: 10, user_id: 1, user_email: 'a@x.com',
        user_full_name: 'Alice', group_id: null, created_at: '2026-01-01T00:00:00Z',
      }),
      headers: new Headers(),
    } as unknown as Response);
    await settle();
    unmount(cmp);
  });

  it('prunePendingGroups removes entry when user_id no longer in students', async () => {
    // Deferred PATCH keeps the pending entry alive so we can observe pruning.
    fetchSpy.mockImplementation(() => new Promise<Response>(() => {}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      runId: 10,
      students: [fakeStudent({ user_id: 1, group_id: 99 })] as RunStudentResponse[],
      groups: defaultGroups(),
      groupsEnabled: true,
      rosterPrefilter: null,
      onPrefilterClear: vi.fn(),
      onRefetchRosterData: vi.fn().mockResolvedValue({ students: [], groups: [] }),
      onRefetchGroupsOnly: vi.fn().mockResolvedValue(undefined),
      onOpenImport: vi.fn(),
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunRosterTab, { target, props: propsRef });
    await settle();

    // Trigger optimistic edit U=1 → 100. PATCH stays in-flight.
    let sel = target.querySelector('tbody select') as HTMLSelectElement;
    sel.value = '100';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(sel.value).toBe('100');
    expect(sel.disabled).toBe(true);

    // Simulate bulk-delete: parent replaces students with empty array.
    propsRef.students = [];
    await settle();
    // Row is gone.
    expect(target.querySelectorAll('tbody tr[data-row="student"]').length).toBe(0);

    // Simulate a fresh refetch where U=1 reappears with original group_id=99.
    // If the prune $effect did NOT run, the entry pendingGroupId(1)=100 would still
    // override and the select would render 100. After pruning, it should render 99.
    propsRef.students = [fakeStudent({ user_id: 1, group_id: 99 })];
    await settle();
    sel = target.querySelector('tbody select') as HTMLSelectElement;
    expect(sel.value).toBe('99');
    expect(sel.disabled).toBe(false);

    unmount(cmp);
  });

  it('prunePendingGroups preserves entry when user_id still in students', async () => {
    fetchSpy.mockImplementation(() => new Promise<Response>(() => {}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      runId: 10,
      students: [
        fakeStudent({ user_id: 1, user_email: 'a@x.com', group_id: null }),
        fakeStudent({ id: 2, user_id: 2, user_email: 'b@x.com', group_id: 100 }),
      ] as RunStudentResponse[],
      groups: defaultGroups(),
      groupsEnabled: true,
      rosterPrefilter: null,
      onPrefilterClear: vi.fn(),
      onRefetchRosterData: vi.fn().mockResolvedValue({ students: [], groups: [] }),
      onRefetchGroupsOnly: vi.fn().mockResolvedValue(undefined),
      onOpenImport: vi.fn(),
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunRosterTab, { target, props: propsRef });
    await settle();

    // Optimistic edit U=1: null → 99. PATCH never resolves.
    const selects = () => target.querySelectorAll('tbody select') as NodeListOf<HTMLSelectElement>;
    let sel1 = selects()[0];
    sel1.value = '99';
    sel1.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(sel1.value).toBe('99');
    expect(sel1.disabled).toBe(true);

    // Simulate a refetch where U=1 is still present but U=2's group_id changed.
    // Pending entry for U=1 should survive; row should still show optimistic 99.
    propsRef.students = [
      fakeStudent({ user_id: 1, user_email: 'a@x.com', group_id: null }),
      fakeStudent({ id: 2, user_id: 2, user_email: 'b@x.com', group_id: 99 }),
    ];
    await settle();
    sel1 = selects()[0];
    expect(sel1.value).toBe('99');
    expect(sel1.disabled).toBe(true);

    unmount(cmp);
  });
});
