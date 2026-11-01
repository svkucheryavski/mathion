import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunRosterTab from '../components/runs/RunRosterTab.svelte';
import type { GroupResponse, RunStudentResponse } from '../lib/types';
import { toasts } from '../stores/toasts.svelte';

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
      isAdmin: true,
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

  it('a rejected TypeError on the row group select reverts and shows a toast (Polish 3)', async () => {
    toasts.list.length = 0;
    fetchSpy.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const { target, cmp } = mountTab();
    await settle();
    const sel = target.querySelector('tbody select') as HTMLSelectElement;
    sel.value = '100';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(sel.value).toBe('__unassigned');
    expect(toasts.list.map((t) => t.message)).toContain('Could not reach server. Check your connection.');
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

// F8 (C7 point 3): the row group select and the add row lose focus under the user.
describe('RunRosterTab focus after an action (F8)', () => {
  it('the row group select keeps focus after the request settles', async () => {
    let resolvePatch: (r: Response) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { resolvePatch = r; }));
    const { target, cmp } = mountTab();
    await settle();
    const sel = target.querySelector('tbody select') as HTMLSelectElement;
    sel.focus();
    sel.value = '99';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(sel.disabled).toBe(true);
    // jsdom keeps focus on a control that turns disabled; a browser drops it.
    const stand = document.createElement('button');
    target.append(stand);
    stand.focus();
    stand.remove();
    expect(document.activeElement).toBe(document.body);
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
    expect(document.activeElement).toBe(sel);
    unmount(cmp);
  });

  it('a draft flip with focus on an empty-roster link repairs focus to the search (review r2)', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const props = $state({
      runId: 10, runIsPublished: true, isAdmin: true, courseSlug: 'test',
      onNavigateToTab: vi.fn(),
      students: [] as RunStudentResponse[],
      groups: defaultGroups(), groupsEnabled: true,
      rosterPrefilter: null, onPrefilterClear: vi.fn(),
      onRefetchRosterData: vi.fn().mockResolvedValue({ students: [], groups: [] }),
      onRefetchGroupsOnly: vi.fn().mockResolvedValue(undefined),
      onOpenImport: vi.fn(),
    });
    const cmp = mount(RunRosterTab, { target, props });
    await settle();
    const link = target.querySelector<HTMLButtonElement>('button[data-action="open-add-link"]')!;
    link.focus();
    props.runIsPublished = false;
    flushSync();
    expect(link.disabled).toBe(true);
    const stand = document.createElement('button');
    target.append(stand); stand.focus(); stand.remove();
    await settle();
    expect(document.activeElement).toBe(target.querySelector('input.ro-search'));
    unmount(cmp);
  });

  it('the row group select gets focus back as soon as its PATCH lands, before the groups refetch (review r2)', async () => {
    let resolvePatch: (r: Response) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { resolvePatch = r; }));
    const onRefetchGroupsOnly = vi.fn(() => new Promise<void>(() => {}));
    const { target, cmp } = mountTab({ onRefetchGroupsOnly });
    await settle();
    const sel = target.querySelector('tbody select') as HTMLSelectElement;
    sel.focus();
    sel.value = '99';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const stand = document.createElement('button');
    target.append(stand); stand.focus(); stand.remove();
    resolvePatch({
      ok: true, status: 200,
      json: () => Promise.resolve({
        id: 1, run_id: 10, user_id: 1, user_email: 'a@x.com',
        user_full_name: 'Alice', group_id: 99, created_at: '2026-01-01T00:00:00Z',
      }),
      headers: new Headers(),
    } as unknown as Response);
    await settle();
    expect(onRefetchGroupsOnly).toHaveBeenCalled();
    expect(document.activeElement).toBe(sel);
    unmount(cmp);
  });

  it('a second change of the same select during the groups refetch keeps focus on the select (review r3)', async () => {
    const patches: ((r: Response) => void)[] = [];
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { patches.push(r); }));
    let releaseRefetch: () => void = () => {};
    const onRefetchGroupsOnly = vi.fn(() => new Promise<void>((r) => { releaseRefetch = r; }));
    const { target, cmp } = mountTab({ onRefetchGroupsOnly });
    await settle();
    const sel = target.querySelector('tbody select') as HTMLSelectElement;
    const drop = () => {
      const stand = document.createElement('button');
      target.append(stand); stand.focus(); stand.remove();
    };
    const ok = (gid: number) => ({
      ok: true, status: 200,
      json: () => Promise.resolve({
        id: 1, run_id: 10, user_id: 1, user_email: 'a@x.com',
        user_full_name: 'Alice', group_id: gid, created_at: '2026-01-01T00:00:00Z',
      }),
      headers: new Headers(),
    } as unknown as Response);
    sel.focus();
    sel.value = '99';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    drop();
    patches[0](ok(99));
    await settle();
    expect(document.activeElement).toBe(sel);
    // The first request's groups refetch is still running; the user corrects the choice.
    sel.value = '100';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(sel.disabled).toBe(true);
    drop();
    releaseRefetch();
    await settle();
    patches[1](ok(100));
    await settle();
    expect(document.activeElement).toBe(sel);
    unmount(cmp);
  });

  it('a draft flip with focus on the + toggle repairs focus to the search (review r1)', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const props = $state({
      runId: 10, runIsPublished: true, isAdmin: true, courseSlug: 'test',
      onNavigateToTab: vi.fn(),
      students: [fakeStudent({ user_id: 1, group_id: null })],
      groups: defaultGroups(), groupsEnabled: true,
      rosterPrefilter: null, onPrefilterClear: vi.fn(),
      onRefetchRosterData: vi.fn().mockResolvedValue({ students: [], groups: [] }),
      onRefetchGroupsOnly: vi.fn().mockResolvedValue(undefined),
      onOpenImport: vi.fn(),
    });
    const cmp = mount(RunRosterTab, { target, props });
    await settle();
    const toggle = target.querySelector<HTMLButtonElement>('button[data-action="toggle-add-student"]')!;
    toggle.focus();
    props.runIsPublished = false;
    flushSync();
    expect(toggle.disabled).toBe(true);
    // jsdom keeps focus on a control that turns disabled; a browser drops it.
    const stand = document.createElement('button');
    target.append(stand); stand.focus(); stand.remove();
    await settle();
    expect(document.activeElement).toBe(target.querySelector('input.ro-search'));
    unmount(cmp);
  });

  it('a draft flip that unmounts the open add row moves focus to the + toggle, else the search', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const props = $state({
      runId: 10, runIsPublished: true, isAdmin: true, courseSlug: 'test',
      onNavigateToTab: vi.fn(),
      students: [fakeStudent({ user_id: 1, group_id: null })],
      groups: defaultGroups(), groupsEnabled: true,
      rosterPrefilter: null, onPrefilterClear: vi.fn(),
      onRefetchRosterData: vi.fn().mockResolvedValue({ students: [], groups: [] }),
      onRefetchGroupsOnly: vi.fn().mockResolvedValue(undefined),
      onOpenImport: vi.fn(),
    });
    const cmp = mount(RunRosterTab, { target, props });
    await settle();
    target.querySelector<HTMLButtonElement>('button[data-action="toggle-add-student"]')!.click();
    await settle();
    const email = target.querySelector<HTMLInputElement>('input.ro-email')!;
    email.focus();
    expect(document.activeElement).toBe(email);
    props.runIsPublished = false;
    flushSync();
    expect(target.querySelector('input.ro-email')).toBeNull();
    await settle();
    // The toggle is draft-gated (natively disabled), so the chain goes on to the search.
    expect(target.querySelector<HTMLButtonElement>('button[data-action="toggle-add-student"]')!.disabled).toBe(true);
    expect(document.activeElement).toBe(target.querySelector('input.ro-search'));
    unmount(cmp);
  });
});
