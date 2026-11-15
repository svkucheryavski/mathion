import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunGroupsTab from '../components/runs/RunGroupsTab.svelte';
import type { Course } from '../lib/types';
import { toasts, clearToasts } from '../stores/toasts.svelte';

const baseCourse: Course = { id: 1, slug: 'c', name: 'C', description: '', is_admin: true };

const fetchSpy = vi.fn();

beforeEach(() => {
  clearToasts();
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

const group = (id: number, name: string, student_count = 0) => ({ id, run_id: 10, name, student_count, is_disabled: false });
const byAction = (t: HTMLElement, a: string) => Array.from(t.querySelectorAll(`button[data-action="${a}"]`)) as HTMLButtonElement[];
function type(input: HTMLInputElement, v: string) {
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
function key(el: Element, k: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  flushSync();
}

describe('RunGroupsTab', () => {
  it('renders disabled placeholder when groupsEnabled=false', async () => {
    const { target, cmp } = mountTab({ groupsEnabled: false });
    await settle();
    expect(target.textContent).toContain('Groups are disabled');
    unmount(cmp);
  });

  it('the + toggle opens the add row with focus in the field; aria-expanded; Esc returns focus to the toggle', async () => {
    const { target, cmp } = mountTab({});
    await settle();
    const toggle = byAction(target, 'toggle-add-group')[0]!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('title')).toBe('Add group');
    expect(toggle.getAttribute('data-glyph')).toBe('plus');
    toggle.click();
    flushSync();
    const input = target.querySelector('input[aria-label="New group name"]') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('title')).toBe('Close');
    expect(toggle.getAttribute('data-glyph')).toBe('close');
    key(input, 'Escape');
    await settle();
    expect(target.querySelector('input[aria-label="New group name"]')).toBeNull();
    expect(document.activeElement).toBe(byAction(target, 'toggle-add-group')[0]);
    unmount(cmp);
  });

  it('adds a group via POST; the field comes back empty and focused for the next name', async () => {
    fetchSpy.mockImplementation(() => jres(group(1, 'Alpha')));
    const refetch = vi.fn().mockResolvedValue(undefined);
    const { target, cmp } = mountTab({ onRefetchGroups: refetch });
    await settle();
    byAction(target, 'toggle-add-group')[0]!.click();
    flushSync();
    const input = target.querySelector('input[aria-label="New group name"]') as HTMLInputElement;
    type(input, ' Alpha ');
    key(input, 'Enter');
    await settle();
    expect(JSON.parse(fetchSpy.mock.calls[0]![1].body as string)).toEqual({ name: 'Alpha' });
    expect(refetch).toHaveBeenCalled();
    const again = target.querySelector('input[aria-label="New group name"]') as HTMLInputElement;
    expect(again.value).toBe('');
    expect(document.activeElement).toBe(again);
    unmount(cmp);
  });

  it('addGroup: a failed refetch after create clears the field and toasts Created (refresh failed — reload to see latest)', async () => {
    fetchSpy.mockImplementation(() => jres({ id: 5, name: 'Alpha' }, 201));
    const refetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { target, cmp } = mountTab({ onRefetchGroups: refetch });
    await settle();
    byAction(target, 'toggle-add-group')[0]!.click();
    flushSync();
    const input = target.querySelector('input[aria-label="New group name"]') as HTMLInputElement;
    type(input, 'Alpha');
    key(input, 'Enter');
    await settle();
    expect(refetch).toHaveBeenCalled();
    const again = target.querySelector('input[aria-label="New group name"]') as HTMLInputElement;
    expect(again.value).toBe('');
    expect(target.querySelector('.in-err')).toBeNull();
    expect(toasts.list.map((t) => [t.message, t.kind])).toContainEqual(['Created (refresh failed — reload to see latest)', 'info']);
    unmount(cmp);
  });

  it('409 on add shows the text under the field; the field stays open', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'dup' }, 409));
    const { target, cmp } = mountTab({});
    await settle();
    byAction(target, 'toggle-add-group')[0]!.click();
    flushSync();
    const input = target.querySelector('input[aria-label="New group name"]') as HTMLInputElement;
    type(input, 'Alpha');
    key(input, 'Enter');
    await settle();
    expect(target.querySelector('.in-err')?.textContent).toBe('A group with that name already exists in this run.');
    expect(target.querySelector('input[aria-label="New group name"]')).not.toBeNull();
    unmount(cmp);
  });

  it('🗑 is disabled with its reason when the group has students; rows are named', async () => {
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha'), group(2, 'Beta', 3)] });
    await settle();
    const [a, b] = byAction(target, 'delete-group');
    expect(a!.disabled).toBe(false);
    expect(a!.getAttribute('aria-label')).toBe('Delete group Alpha');
    expect(a!.getAttribute('title')).toBe('Delete');
    expect(b!.disabled).toBe(true);
    expect(b!.getAttribute('title')).toBe('Move students out before deleting.');
    expect(byAction(target, 'rename-group')[0]!.getAttribute('aria-label')).toBe('Rename Alpha');
    unmount(cmp);
  });

  it('capacity badge: class per getCapacityClass, mono n/10, title spelled out', async () => {
    const { target, cmp } = mountTab({ groups: [group(1, 'A'), group(2, 'B', 7), group(3, 'C', 8), group(4, 'D', 10)] });
    await settle();
    const caps = Array.from(target.querySelectorAll('.cap')) as HTMLElement[];
    expect(caps.map((c) => c.className.match(/cap-(empty|ok|warn|full)/)?.[1])).toEqual(['empty', 'ok', 'warn', 'full']);
    expect(caps.map((c) => c.textContent?.trim())).toEqual(['empty', '7/10', '8/10', '10/10']);
    expect(caps[1]!.getAttribute('title')).toBe('7 of 10 students');
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
    await settle();
    expect(target.querySelector('.inline-confirm[role="group"]')?.getAttribute('aria-label')).toBe('Delete Alpha?');
    (
      target.querySelector('button[data-action="confirm-delete-group"]') as HTMLButtonElement
    ).click();
    await settle();
    expect(refetchBoth).toHaveBeenCalled();
    unmount(cmp);
  });

  it('rename: ✎ opens the field with the name; Enter PATCHes; focus returns to ✎', async () => {
    fetchSpy.mockImplementation((_url: string, init: RequestInit) => {
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body as string)).toEqual({ name: 'AlphaRenamed' });
      return jres(group(1, 'AlphaRenamed'));
    });
    const refetch = vi.fn().mockResolvedValue(undefined);
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha')], onRefetchGroups: refetch });
    await settle();
    byAction(target, 'rename-group')[0]!.click();
    flushSync();
    const input = target.querySelector('input[aria-label="Group name"]') as HTMLInputElement;
    expect(input.value).toBe('Alpha');
    expect(document.activeElement).toBe(input);
    expect(input.parentElement!.querySelector('button[data-glyph="check"]')?.getAttribute('aria-label')).toBe('Save Alpha');
    // the capacity badge keeps its place between the field and ×
    expect(input.parentElement!.querySelector('.cap')).not.toBeNull();
    expect(byAction(target, 'delete-group')).toHaveLength(0);
    type(input, 'AlphaRenamed');
    key(input, 'Enter');
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalled();
    expect(target.querySelector('input[aria-label="Group name"]')).toBeNull();
    expect(document.activeElement).toBe(byAction(target, 'rename-group')[0]);
    unmount(cmp);
  });

  it('rename: Esc cancels without a request; unchanged closes without a request; nothing saves on blur', async () => {
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha')] });
    await settle();
    byAction(target, 'rename-group')[0]!.click();
    flushSync();
    let input = target.querySelector('input[aria-label="Group name"]') as HTMLInputElement;
    type(input, 'Other');
    input.dispatchEvent(new Event('blur'));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
    key(input, 'Escape');
    await settle();
    expect(target.querySelector('input[aria-label="Group name"]')).toBeNull();
    byAction(target, 'rename-group')[0]!.click();
    flushSync();
    input = target.querySelector('input[aria-label="Group name"]') as HTMLInputElement;
    key(input, 'Enter');
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(target.querySelector('input[aria-label="Group name"]')).toBeNull();
    unmount(cmp);
  });

  it('rename: a failure keeps the field open with the error', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Name taken' }, 409));
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha')] });
    await settle();
    byAction(target, 'rename-group')[0]!.click();
    flushSync();
    const input = target.querySelector('input[aria-label="Group name"]') as HTMLInputElement;
    type(input, 'Beta');
    key(input, 'Enter');
    await settle();
    expect(target.querySelector('input[aria-label="Group name"]')).not.toBeNull();
    expect(target.querySelector('.in-err')?.textContent).toBe('Name taken');
    unmount(cmp);
  });

  it('one editor at a time: opening the add row closes an open rename, and the reverse', async () => {
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha'), group(2, 'Beta')] });
    await settle();
    byAction(target, 'rename-group')[0]!.click();
    flushSync();
    byAction(target, 'toggle-add-group')[0]!.click();
    flushSync();
    expect(target.querySelector('input[aria-label="Group name"]')).toBeNull();
    expect(target.querySelector('input[aria-label="New group name"]')).not.toBeNull();
    byAction(target, 'rename-group')[1]!.click();
    flushSync();
    expect(target.querySelector('input[aria-label="New group name"]')).toBeNull();
    expect((target.querySelector('input[aria-label="Group name"]') as HTMLInputElement).value).toBe('Beta');
    unmount(cmp);
  });

  it('🗑 → confirm takes focus; Cancel returns focus to the 🗑', async () => {
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha')] });
    await settle();
    byAction(target, 'delete-group')[0]!.click();
    await settle();
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
    (document.activeElement as HTMLButtonElement).click();
    await settle();
    expect(document.activeElement).toBe(byAction(target, 'delete-group')[0]);
    unmount(cmp);
  });

  it('deleting the last group moves focus to the + toggle (Review Focus 3)', async () => {
    fetchSpy.mockImplementation(() => jres(null, 204));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: any = $state({
      runId: 10, groups: [group(1, 'Alpha')], groupsEnabled: true,
      onRefetchGroups: async () => { props.groups = []; },
      onRefetchGroupsAndStudents: vi.fn().mockResolvedValue(undefined),
      course: baseCourse, runIsPublished: false,
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunGroupsTab, { target, props });
    await settle();
    byAction(target, 'delete-group')[0]!.click();
    await settle();
    byAction(target, 'confirm-delete-group')[0]!.click();
    await settle();
    await settle();
    expect(target.textContent).toContain('No groups yet.');
    expect(document.activeElement).toBe(byAction(target, 'toggle-add-group')[0]);
    unmount(cmp);
  });

  it('a 409 "has students" delete moves focus to the row\'s ✎ once its 🗑 turns disabled', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Group has students; reassign or remove first' }, 409));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: any = $state({
      runId: 10, groups: [group(1, 'Alpha')], groupsEnabled: true,
      onRefetchGroups: vi.fn().mockResolvedValue(undefined),
      onRefetchGroupsAndStudents: async () => { props.groups = [group(1, 'Alpha', 2)]; },
      course: baseCourse, runIsPublished: false,
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunGroupsTab, { target, props });
    await settle();
    byAction(target, 'delete-group')[0]!.click();
    await settle();
    byAction(target, 'confirm-delete-group')[0]!.click();
    await settle();
    await settle();
    expect(byAction(target, 'delete-group')[0]!.disabled).toBe(true);
    expect(document.activeElement).toBe(byAction(target, 'rename-group')[0]);
    unmount(cmp);
  });

  it('h2 "Groups" with a mono count', async () => {
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha'), group(2, 'Beta')] });
    await settle();
    const h2 = target.querySelector('h2') as HTMLElement;
    expect(h2.textContent?.replace(/\s+/g, ' ').trim()).toBe('Groups 2');
    expect(h2.getAttribute('tabindex')).toBe('-1');
    unmount(cmp);
  });
});

describe('RunGroupsTab — disabled placeholder 3-branch (groupsEnabled=false)', () => {
  it('!runIsPublished: "Enable in Overview" copy (role-independent)', async () => {
    const { target, cmp } = mountTab({
      groupsEnabled: false,
      runIsPublished: false,
      course: { is_admin: false },
      onGotoOverview: vi.fn(),
    });
    await settle();
    expect(target.textContent).toContain('Enable in Overview › Settings to manage groups.');
    expect(target.textContent).not.toContain('Unpublish');
    expect(target.textContent).not.toContain('Ask a course admin');
    const link = target.querySelector('button[data-action="goto-overview"]') as HTMLButtonElement;
    expect(link.textContent).toBe('Overview');
    unmount(cmp);
  });

  it('runIsPublished + admin: "Unpublish in Overview before enabling groups."', async () => {
    const { target, cmp } = mountTab({
      groupsEnabled: false,
      runIsPublished: true,
      course: { is_admin: true },
      onGotoOverview: vi.fn(),
    });
    await settle();
    expect(target.textContent).toContain('Unpublish in Overview before enabling groups.');
    expect(target.textContent).not.toContain('Ask a course admin');
    const link = target.querySelector('button[data-action="goto-overview"]') as HTMLButtonElement;
    expect(link.textContent).toBe('Overview');
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
    expect(target.querySelector('button[data-action="goto-overview"]')).toBeNull();
    unmount(cmp);
  });

  it('the card has the "Groups disabled for this run" strip; the Overview link calls onGotoOverview', async () => {
    const onGotoOverview = vi.fn();
    const { target, cmp } = mountTab({ groupsEnabled: false, runIsPublished: false, onGotoOverview });
    await settle();
    expect(target.querySelector('.go-head')?.textContent?.trim()).toBe('Groups disabled for this run');
    (target.querySelector('button[data-action="goto-overview"]') as HTMLButtonElement).click();
    expect(onGotoOverview).toHaveBeenCalledTimes(1);
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
    expect(byAction(target, 'toggle-add-group')).toHaveLength(1);
    expect(target.querySelector('.g-name')?.textContent).toBe('Alpha');
    expect(byAction(target, 'rename-group')).toHaveLength(1);
    expect(byAction(target, 'delete-group')).toHaveLength(1);
    unmount(cmp);
  });
});

// Polish 3 §Behaviour "Offline failures say so".
describe('RunGroupsTab — offline failures', () => {
  it('a rejected TypeError on group delete shows a toast', async () => {
    toasts.list.length = 0;
    fetchSpy.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha')] });
    await settle();
    (target.querySelector('button[data-action="delete-group"]') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('button[data-action="confirm-delete-group"]') as HTMLButtonElement).click();
    await settle();
    expect(toasts.list.map((t) => t.message)).toContain('Could not reach server. Check your connection.');
    unmount(cmp);
  });
});

// Whole-branch review fix pass.
describe('RunGroupsTab — delete and rename (whole-branch review)', () => {
  const trash = (root: HTMLElement, name: string) =>
    root.querySelector(`button[aria-label="Delete group ${name}"]`) as HTMLButtonElement;

  it('the delete confirm shows busy; Cancel and the other trash buttons wait', async () => {
    let finish: (r: Response) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { finish = r; }));
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha'), group(2, 'Beta')] });
    await settle();
    trash(target, 'Alpha').click();
    await settle();
    byAction(target, 'confirm-delete-group')[0]!.click();
    await settle();
    expect(byAction(target, 'confirm-delete-group')[0]!.getAttribute('aria-busy')).toBe('true');
    (target.querySelector('.inline-confirm .cancel') as HTMLButtonElement).click();
    await settle();
    expect(byAction(target, 'confirm-delete-group')).toHaveLength(1);
    expect(trash(target, 'Beta').getAttribute('aria-disabled')).toBe('true');
    expect(trash(target, 'Beta').getAttribute('title')).toBe('Wait for the current change to finish');
    trash(target, 'Beta').click();
    await settle();
    expect(target.querySelector('button[aria-label="Delete group Alpha"]')).toBeNull();
    finish({ ok: false, status: 500, json: () => Promise.resolve({ detail: 'Boom' }), headers: new Headers({ 'content-type': 'application/json' }) } as unknown as Response);
    await settle();
    expect(document.activeElement).toBe(trash(target, 'Alpha'));
    expect(trash(target, 'Beta').hasAttribute('aria-disabled')).toBe(false);
    unmount(cmp);
  });

  it('a delete whose refetch fails toasts Deleted (refresh failed — reload to see latest) and moves focus on', async () => {
    fetchSpy.mockImplementation(() => jres(null, 204));
    const refetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha'), group(2, 'Beta')], onRefetchGroups: refetch });
    await settle();
    trash(target, 'Alpha').click();
    await settle();
    byAction(target, 'confirm-delete-group')[0]!.click();
    await settle();
    const msgs = toasts.list.map((t) => [t.message, t.kind]);
    expect(msgs).toContainEqual(['Deleted (refresh failed — reload to see latest)', 'info']);
    expect(msgs.map((m) => m[0])).not.toContain('Could not reach server. Check your connection.');
    expect(document.activeElement).toBe(trash(target, 'Beta'));
    unmount(cmp);
  });

  it('a rename whose refetch fails closes the field and toasts Saved (refresh failed — reload to see latest)', async () => {
    fetchSpy.mockImplementation(() => jres(group(1, 'Gamma')));
    const refetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha')], onRefetchGroups: refetch });
    await settle();
    byAction(target, 'rename-group')[0]!.click();
    flushSync();
    const input = target.querySelector('input[aria-label="Group name"]') as HTMLInputElement;
    type(input, 'Gamma');
    key(input, 'Enter');
    await settle();
    expect(target.querySelector('input[aria-label="Group name"]')).toBeNull();
    expect(toasts.list.map((t) => [t.message, t.kind])).toContainEqual(['Saved (refresh failed — reload to see latest)', 'info']);
    expect(document.activeElement).toBe(byAction(target, 'rename-group')[0]);
    unmount(cmp);
  });
});

describe('RunGroupsTab — delete (fix-pass review)', () => {
  const trash = (root: HTMLElement, name: string) =>
    root.querySelector(`button[aria-label="Delete group ${name}"]`) as HTMLButtonElement;
  const conflict = (detail: string) =>
    ({ ok: false, status: 409, json: () => Promise.resolve({ detail }), headers: new Headers({ 'content-type': 'application/json' }) } as unknown as Response);

  it('the other trash buttons wait through the refetch after a 409', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(conflict('Group has students')));
    let done: () => void = () => {};
    const both = vi.fn(() => new Promise<void>((r) => { done = r; }));
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha'), group(2, 'Beta')], onRefetchGroupsAndStudents: both });
    await settle();
    trash(target, 'Alpha').click();
    await settle();
    byAction(target, 'confirm-delete-group')[0]!.click();
    await settle();
    expect(both).toHaveBeenCalled();
    expect(trash(target, 'Beta').getAttribute('aria-disabled')).toBe('true');
    done();
    await settle();
    expect(trash(target, 'Beta').hasAttribute('aria-disabled')).toBe(false);
    expect(document.activeElement).toBe(trash(target, 'Alpha'));
    unmount(cmp);
  });

  it('a 409 whose refetch fails still puts focus back on the row', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(conflict('Group has students')));
    const both = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha'), group(2, 'Beta')], onRefetchGroupsAndStudents: both });
    await settle();
    trash(target, 'Alpha').click();
    await settle();
    byAction(target, 'confirm-delete-group')[0]!.click();
    await settle();
    expect(both).toHaveBeenCalled();
    expect(document.activeElement).toBe(trash(target, 'Alpha'));
    unmount(cmp);
  });

  it('the confirm stays busy while the refetch after a delete runs', async () => {
    fetchSpy.mockImplementation(() => jres(null, 204));
    let done: () => void = () => {};
    const refetch = vi.fn(() => new Promise<void>((r) => { done = r; }));
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha'), group(2, 'Beta')], onRefetchGroups: refetch });
    await settle();
    trash(target, 'Alpha').click();
    await settle();
    byAction(target, 'confirm-delete-group')[0]!.click();
    await settle();
    expect(refetch).toHaveBeenCalled();
    expect(byAction(target, 'confirm-delete-group')[0]?.getAttribute('aria-busy')).toBe('true');
    done();
    await settle();
    expect(byAction(target, 'confirm-delete-group')).toHaveLength(0);
    unmount(cmp);
  });

  it('a slow delete does not pull focus from a rename field opened meanwhile', async () => {
    let finish: (r: Response) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { finish = r; }));
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha'), group(2, 'Beta')] });
    await settle();
    trash(target, 'Alpha').click();
    await settle();
    byAction(target, 'confirm-delete-group')[0]!.click();
    await settle();
    expect(byAction(target, 'rename-group')).toHaveLength(1); // Beta's; Alpha shows its confirm
    byAction(target, 'rename-group')[0]!.click();
    await settle();
    const input = target.querySelector('input[aria-label="Group name"]') as HTMLInputElement;
    input.focus();
    finish({ ok: true, status: 204, json: () => Promise.resolve(null), headers: new Headers() } as unknown as Response);
    await settle();
    expect(document.activeElement).toBe(input);
    unmount(cmp);
  });
});

describe('RunGroupsTab — delete (fix-pass review r2)', () => {
  const trash = (root: HTMLElement, name: string) =>
    root.querySelector(`button[aria-label="Delete group ${name}"]`) as HTMLButtonElement;

  it('a slow delete that fails does not pull focus from where the user moved it', async () => {
    let finish: (r: Response) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { finish = r; }));
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha'), group(2, 'Beta')] });
    await settle();
    trash(target, 'Alpha').click();
    await settle();
    byAction(target, 'confirm-delete-group')[0]!.click();
    await settle();
    const elsewhere = document.body.appendChild(document.createElement('input'));
    elsewhere.focus();
    finish({ ok: false, status: 500, json: () => Promise.resolve({ detail: 'Boom' }), headers: new Headers({ 'content-type': 'application/json' }) } as unknown as Response);
    await settle();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
    unmount(cmp);
  });

  it('the row being deleted keeps its ✎ waiting when the confirm closes mid-delete', async () => {
    let finish: (r: Response) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { finish = r; }));
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha'), group(2, 'Beta')] });
    await settle();
    trash(target, 'Alpha').click();
    await settle();
    byAction(target, 'confirm-delete-group')[0]!.click();
    await settle();
    byAction(target, 'toggle-add-group')[0]!.click();
    await settle();
    const pencil = target.querySelector('button[aria-label="Rename Alpha"]') as HTMLButtonElement;
    expect(pencil.getAttribute('aria-disabled')).toBe('true');
    expect(pencil.getAttribute('title')).toBe('Wait for the current change to finish');
    pencil.click();
    await settle();
    expect(target.querySelector('input[aria-label="Group name"]')).toBeNull();
    finish({ ok: true, status: 204, json: () => Promise.resolve(null), headers: new Headers() } as unknown as Response);
    await settle();
    unmount(cmp);
  });
});
