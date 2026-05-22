import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunRosterTab from '../components/runs/RunRosterTab.svelte';
import type { RunStudentResponse } from '../lib/types';

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

function mountTab(props: Record<string, unknown>) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RunRosterTab, {
    target,
    props: {
      runId: 10,
      students: [],
      groups: [],
      groupsEnabled: false,
      rosterPrefilter: null,
      onPrefilterClear: vi.fn(),
      onRefetchRosterData: vi.fn().mockResolvedValue({ students: [], groups: [] }),
      onRefetchGroupsOnly: vi.fn().mockResolvedValue(undefined),
      onOpenImport: vi.fn(),
      ...props,
    },
  });
  return { target, cmp };
}

describe('RunRosterTab core', () => {
  it('renders empty state with CTA when no students', async () => {
    const { target, cmp } = mountTab({});
    await settle();
    expect(target.textContent).toContain('No students yet');
    unmount(cmp);
  });

  it('client-side dup check blocks POST and shows inline error', async () => {
    const { target, cmp } = mountTab({
      students: [fakeStudent({ user_id: 1, user_email: 'a@x.com' })],
    });
    await settle();
    const emailInput = target.querySelector('input[name="new-email"]') as HTMLInputElement;
    emailInput.value = 'A@X.COM';
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    (target.querySelector('button[data-action="add-student"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('already enrolled');
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('search narrows filtered rows', async () => {
    const { target, cmp } = mountTab({
      students: [
        fakeStudent({ user_id: 1, user_email: 'a@x.com', user_full_name: 'Alice' }),
        fakeStudent({ user_id: 2, user_email: 'b@y.com', user_full_name: 'Bob' }),
      ],
    });
    await settle();
    const search = target.querySelector('input[name="roster-search"]') as HTMLInputElement;
    search.value = 'alice';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(target.querySelectorAll('tbody tr[data-row="student"]').length).toBe(1);
    expect(target.textContent).toContain('Alice');
    expect(target.textContent).not.toContain('Bob');
    unmount(cmp);
  });

  it('prefilter unassigned shows only unassigned rows, clears via typing OR ×', async () => {
    const onPrefilterClear = vi.fn();
    const { target, cmp } = mountTab({
      rosterPrefilter: 'unassigned',
      onPrefilterClear,
      students: [
        fakeStudent({ user_id: 1, group_id: null, user_full_name: 'Alice' }),
        fakeStudent({ user_id: 2, group_id: 99, user_full_name: 'Bob' }),
      ],
    });
    await settle();
    expect(target.querySelectorAll('tbody tr[data-row="student"]').length).toBe(1);
    const search = target.querySelector('input[name="roster-search"]') as HTMLInputElement;
    search.value = 'ali';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(onPrefilterClear).toHaveBeenCalledTimes(1);
    (target.querySelector('button[data-action="clear-prefilter"]') as HTMLButtonElement).click();
    flushSync();
    expect(onPrefilterClear).toHaveBeenCalledTimes(2);
    unmount(cmp);
  });

  it('header checkbox indeterminate when partial selection visible', async () => {
    const { target, cmp } = mountTab({
      students: [
        fakeStudent({ user_id: 1 }),
        fakeStudent({ user_id: 2 }),
      ],
    });
    await settle();
    const rowCheckboxes = target.querySelectorAll('input[data-row-checkbox]') as NodeListOf<HTMLInputElement>;
    rowCheckboxes[0].click();
    flushSync();
    const header = target.querySelector('input[data-header-checkbox]') as HTMLInputElement;
    expect(header.indeterminate).toBe(true);
    rowCheckboxes[1].click();
    flushSync();
    expect(header.indeterminate).toBe(false);
    expect(header.checked).toBe(true);
    unmount(cmp);
  });

  it('single-row delete via InlineConfirm calls refetch', async () => {
    fetchSpy.mockImplementation(() => jres('', 204));
    const refetch = vi.fn().mockResolvedValue({ students: [], groups: [] });
    const { target, cmp } = mountTab({
      students: [fakeStudent({ user_id: 1 })],
      onRefetchRosterData: refetch,
    });
    await settle();
    (target.querySelector('button[data-action="delete-student"]') as HTMLButtonElement).click();
    flushSync();
    (target.querySelector('button[data-action="confirm-delete-student"]') as HTMLButtonElement).click();
    await settle();
    expect(refetch).toHaveBeenCalled();
    unmount(cmp);
  });

  it('persistent add-student row stays in DOM across filter changes', async () => {
    const { target, cmp } = mountTab({
      students: [
        fakeStudent({ user_id: 1, user_email: 'a@x.com', user_full_name: 'Alice', group_id: null }),
        fakeStudent({ user_id: 2, user_email: 'b@x.com', user_full_name: 'Bob', group_id: 99 }),
      ],
      rosterPrefilter: 'unassigned',
    });
    await settle();
    // Prefilter active: only Alice visible. Add row must still exist.
    expect(target.querySelector('input[name="new-email"]')).not.toBeNull();
    // Type a search that filters out everyone.
    const search = target.querySelector('input[name="roster-search"]') as HTMLInputElement;
    search.value = 'zzz-no-match';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(target.querySelector('input[name="new-email"]')).not.toBeNull();
    unmount(cmp);
  });
});
