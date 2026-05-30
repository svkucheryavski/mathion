import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunGroupsTab from '../components/runs/RunGroupsTab.svelte';
import type { Course } from '../lib/types';

const baseCourse: Course = { id: 1, slug: 'c', name: 'C', description: '', is_admin: true };

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

function mountTab(props: Record<string, unknown>) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const courseOverride = (props.course as Partial<Course> | undefined) ?? {};
  const course: Course = { ...baseCourse, ...courseOverride };
  const { course: _c, ...rest } = props;
  void _c;
  const cmp = mount(RunGroupsTab, {
    target,
    props: {
      runId: 10,
      groups: [],
      groupsEnabled: true,
      onRefetchGroups: vi.fn().mockResolvedValue(undefined),
      onRefetchGroupsAndStudents: vi.fn().mockResolvedValue(undefined),
      course,
      runIsPublished: false,
      ...rest,
    },
  });
  return { target, cmp };
}

describe('RunGroupsTab', () => {
  it('renders disabled placeholder when groupsEnabled=false', async () => {
    const { target, cmp } = mountTab({ groupsEnabled: false });
    await settle();
    expect(target.textContent).toContain('Groups are disabled');
    unmount(cmp);
  });

  it('adds a group via POST', async () => {
    fetchSpy.mockImplementation(() =>
      jres({ id: 1, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false }),
    );
    const refetch = vi.fn().mockResolvedValue(undefined);
    const { target, cmp } = mountTab({ onRefetchGroups: refetch });
    await settle();
    const input = target.querySelector('input[name="name"]') as HTMLInputElement;
    input.value = 'Alpha';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await settle();
    expect(refetch).toHaveBeenCalled();
    unmount(cmp);
  });

  it('disables Delete on group with students; allows on empty', async () => {
    const { target, cmp } = mountTab({
      groups: [
        { id: 1, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false },
        { id: 2, run_id: 10, name: 'Beta', student_count: 3, is_disabled: false },
      ],
    });
    await settle();
    const buttons = target.querySelectorAll(
      'button[data-action="delete-group"]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
    unmount(cmp);
  });

  it('409 with "has students" triggers groups+students refetch', async () => {
    fetchSpy.mockImplementation(() =>
      jres({ detail: 'Group has students; reassign or remove first' }, 409),
    );
    const refetchBoth = vi.fn().mockResolvedValue(undefined);
    const { target, cmp } = mountTab({
      groups: [{ id: 1, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false }],
      onRefetchGroupsAndStudents: refetchBoth,
    });
    await settle();
    (target.querySelector('button[data-action="delete-group"]') as HTMLButtonElement).click();
    flushSync();
    (
      target.querySelector('button[data-action="confirm-delete-group"]') as HTMLButtonElement
    ).click();
    await settle();
    expect(refetchBoth).toHaveBeenCalled();
    unmount(cmp);
  });

  it('blur commits rename (PATCHes new name, calls refetch)', async () => {
    fetchSpy.mockImplementation((_url: string, init: RequestInit) => {
      expect(init.method).toBe('PATCH');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ name: 'AlphaRenamed' });
      return jres({
        id: 1,
        run_id: 10,
        name: 'AlphaRenamed',
        student_count: 0,
        is_disabled: false,
      });
    });
    const refetch = vi.fn().mockResolvedValue(undefined);
    const { target, cmp } = mountTab({
      groups: [{ id: 1, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false }],
      onRefetchGroups: refetch,
    });
    await settle();
    const input = target.querySelector('input[name="rename-1"]') as HTMLInputElement;
    input.focus();
    input.value = 'AlphaRenamed';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalled();
    unmount(cmp);
  });

  it('Escape reverts rename to original name without PATCH', async () => {
    const { target, cmp } = mountTab({
      groups: [{ id: 1, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false }],
    });
    await settle();
    const input = target.querySelector('input[name="rename-1"]') as HTMLInputElement;
    input.focus();
    input.value = 'AlphaRenamed';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(input.value).toBe('Alpha');
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount(cmp);
  });
});

describe('RunGroupsTab — disabled placeholder 3-branch (groupsEnabled=false)', () => {
  it('!runIsPublished: "Enable in Overview" copy (role-independent)', async () => {
    const { target, cmp } = mountTab({
      groupsEnabled: false,
      runIsPublished: false,
      course: { is_admin: false },
    });
    await settle();
    expect(target.textContent).toContain('Enable in Overview → Settings to manage groups.');
    expect(target.textContent).not.toContain('Unpublish');
    expect(target.textContent).not.toContain('Ask a course admin');
    unmount(cmp);
  });

  it('runIsPublished + admin: "Unpublish in Overview before enabling groups."', async () => {
    const { target, cmp } = mountTab({
      groupsEnabled: false,
      runIsPublished: true,
      course: { is_admin: true },
    });
    await settle();
    expect(target.textContent).toContain('Unpublish in Overview before enabling groups.');
    expect(target.textContent).not.toContain('Ask a course admin');
    unmount(cmp);
  });

  it('runIsPublished + teacher: "Ask a course admin to unpublish the run and enable groups."', async () => {
    const { target, cmp } = mountTab({
      groupsEnabled: false,
      runIsPublished: true,
      course: { is_admin: false },
    });
    await settle();
    expect(target.textContent).toContain('Ask a course admin to unpublish the run and enable groups.');
    expect(target.textContent).not.toContain('Unpublish in Overview');
    unmount(cmp);
  });
});

describe('RunGroupsTab — groupsEnabled=true CRUD is teacher-allowed', () => {
  it('group CRUD section renders for teacher (course.is_admin=false)', async () => {
    const { target, cmp } = mountTab({
      groupsEnabled: true,
      runIsPublished: true,
      course: { is_admin: false },
      groups: [{ id: 1, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false }],
    });
    await settle();
    // Add-group form
    expect(target.querySelector('input[name="name"]')).not.toBeNull();
    // Existing group rendered + Delete + rename input (group name is the
    // input's value, not visible text — same as the admin-view rename test).
    const renameInput = target.querySelector('input[name="rename-1"]') as HTMLInputElement | null;
    expect(renameInput).not.toBeNull();
    expect(renameInput!.value).toBe('Alpha');
    expect(target.querySelector('button[data-action="delete-group"]')).not.toBeNull();
    unmount(cmp);
  });
});
