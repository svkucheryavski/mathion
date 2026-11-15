import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunRosterTab from '../components/runs/RunRosterTab.svelte';
import type { GroupResponse, RunStudentResponse } from '../lib/types';
import { toasts, clearToasts } from '../stores/toasts.svelte';

// VR backlog round, Task 9: the Roster items from polish3 §4/§WBR and slice6c §3/§4.

const BUSY = 'Wait for the current change to finish';
const OFFLINE = 'Could not reach server. Check your connection.';

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
  clearToasts();
});

function jres(body: unknown, status = 200): Response {
  return {
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response;
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

const stu = (id: number, over: Partial<RunStudentResponse> = {}): RunStudentResponse => ({
  id, run_id: 10, user_id: id, user_email: `s${id}@x.com`, user_full_name: null,
  group_id: null, created_at: '2026-01-01T00:00:00Z', ...over,
} as RunStudentResponse);

const groups = (): GroupResponse[] => [
  { id: 99, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false } as GroupResponse,
  { id: 100, run_id: 10, name: 'Beta', student_count: 0, is_disabled: false } as GroupResponse,
];

function mountTab(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = $state({
    runId: 10,
    runIsPublished: true,
    isAdmin: true,
    courseSlug: 'test',
    onNavigateToTab: vi.fn(),
    students: [stu(1), stu(2)],
    groups: groups(),
    groupsEnabled: true,
    rosterPrefilter: null,
    onPrefilterClear: vi.fn(),
    onRefetchRosterData: vi.fn().mockResolvedValue({ students: [], groups: [] }),
    onRefetchGroupsOnly: vi.fn().mockResolvedValue(undefined),
    onOpenImport: vi.fn(),
    ...extra,
  });
  const cmp = mount(RunRosterTab, { target, props });
  flushSync();
  return { target, cmp, props };
}

const q = <T extends Element>(root: ParentNode, sel: string) => root.querySelector(sel) as T;
const row = (root: ParentNode, id: number) => q<HTMLTableRowElement>(root, `tr[data-user-id="${id}"]`);
const rowSelect = (root: ParentNode, id: number) => q<HTMLSelectElement>(row(root, id), 'select');
const rowTrash = (root: ParentNode, id: number) => q<HTMLButtonElement>(row(root, id), '[data-action="delete-student"]');
const toastTexts = () => toasts.list.map((t) => t.message);

// jsdom keeps focus on a disabled control; a browser drops it to <body>.
function dropFocus(root: HTMLElement) {
  const stand = document.createElement('button');
  root.append(stand); stand.focus(); stand.remove();
}

function patchOk(id: number, gid: number | null): Response {
  return jres({ ...stu(id), group_id: gid });
}

function change(sel: HTMLSelectElement, value: string) {
  sel.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

async function openAddAndType(root: HTMLElement, email: string) {
  const toggle = q<HTMLButtonElement>(root, '[data-action="toggle-add-student"]');
  if (toggle.getAttribute('aria-expanded') !== 'true') { toggle.click(); await settle(); }
  const input = q<HTMLInputElement>(root, 'input[name="new-email"]');
  input.value = email;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  return input;
}

describe('RunRosterTab — row group selects (polish3 §4)', () => {
  it('two quick group selects: focus repairs to the last changed', async () => {
    const pending: ((r: Response) => void)[] = [];
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { pending.push(r); }));
    const { target, cmp } = mountTab();
    const selA = rowSelect(target, 1);
    const selB = rowSelect(target, 2);
    selA.focus(); change(selA, '99'); dropFocus(target);
    selB.focus(); change(selB, '100'); dropFocus(target);
    // A settles first while B is still in flight: B is the control last used.
    pending[0](patchOk(1, 99));
    await settle();
    expect(document.activeElement).not.toBe(selA);
    pending[1](patchOk(2, 100));
    await settle();
    expect(document.activeElement).toBe(selB);
    unmount(cmp);
  });

  it('a failed groups refetch does not free a newer change', async () => {
    const pending: ((r: Response) => void)[] = [];
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { pending.push(r); }));
    let failRefetch: (e: unknown) => void = () => {};
    const onRefetchGroupsOnly = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((_, rej) => { failRefetch = rej; }))
      .mockResolvedValue(undefined);
    const { target, cmp } = mountTab({ onRefetchGroupsOnly });
    const sel = rowSelect(target, 2);
    change(sel, '99');
    pending[0](patchOk(2, 99));
    await settle();
    // The first change's groups refetch still runs; the teacher changes the row again.
    change(sel, '100');
    expect(sel.disabled).toBe(true);
    failRefetch(new TypeError('Failed to fetch'));
    await settle();
    expect(sel.disabled).toBe(true);
    expect(toastTexts()).toContain('Saved (refresh failed — reload to see latest)');
    expect(toastTexts()).not.toContain(OFFLINE);
    pending[1](patchOk(2, 100));
    await settle();
    expect(sel.disabled).toBe(false);
    unmount(cmp);
  });
});

describe('RunRosterTab — add row (polish3 §WBR, slice6c §3)', () => {
  it('an offline add leaves the e-mail field unmarked', async () => {
    fetchSpy.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const { target, cmp } = mountTab();
    const input = await openAddAndType(target, 'new@x.com');
    q<HTMLButtonElement>(target, '[data-action="add-student"]').click();
    await settle();
    expect(q(target, 'p.error[role="alert"]')?.textContent).toBe(OFFLINE);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    unmount(cmp);
  });

  it('an add refused for the address marks the field; one refused for the group does not', async () => {
    const { target, cmp } = mountTab();
    const input = await openAddAndType(target, 'new@x.com');
    fetchSpy.mockImplementationOnce(() => Promise.resolve(jres({
      detail: 'new@x.com is already active in run "Other" of the same course.',
      error_code: 'student_already_active_in_course', conflicts: [],
    }, 409)));
    q<HTMLButtonElement>(target, '[data-action="add-student"]').click();
    await settle();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fetchSpy.mockImplementationOnce(() => Promise.resolve(jres({ detail: 'Group capacity reached' }, 409)));
    await openAddAndType(target, 'new2@x.com');
    q<HTMLButtonElement>(target, '[data-action="add-student"]').click();
    await settle();
    expect(q(target, 'p.error[role="alert"]')?.textContent).toBe('Group capacity reached');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    // The client-side duplicate check is about the address too.
    await openAddAndType(target, 's1@x.com');
    q<HTMLButtonElement>(target, '[data-action="add-student"]').click();
    await settle();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    unmount(cmp);
  });

  it('close requests during an add give the wait reason', async () => {
    let finish: (r: Response) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { finish = r; }));
    const { target, cmp } = mountTab();
    await openAddAndType(target, 'new@x.com');
    q<HTMLButtonElement>(target, '[data-action="add-student"]').click();
    await settle();
    const toggle = q<HTMLButtonElement>(target, '[data-action="toggle-add-student"]');
    const cancel = q<HTMLButtonElement>(target, '[data-action="cancel-add-student"]');
    for (const b of [toggle, cancel]) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.getAttribute('title')).toBe(BUSY);
    }
    cancel.click();
    await settle();
    expect(q(target, 'input[name="new-email"]')).not.toBeNull();
    finish(jres(stu(3), 201));
    await settle();
    expect(toggle.hasAttribute('aria-disabled')).toBe(false);
    expect(toggle.getAttribute('title')).toBe('Close add row');
    expect(q<HTMLButtonElement>(target, '[data-action="cancel-add-student"]').hasAttribute('aria-disabled')).toBe(false);
    unmount(cmp);
  });

  it('an add whose refetch fails toasts Added (refresh failed — reload to see latest)', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(jres(stu(3), 201)));
    const onRefetchRosterData = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { target, cmp } = mountTab({ onRefetchRosterData });
    const input = await openAddAndType(target, 'new@x.com');
    q<HTMLButtonElement>(target, '[data-action="add-student"]').click();
    await settle();
    expect(toastTexts()).toContain('Added (refresh failed — reload to see latest)');
    expect(q(target, 'p.error[role="alert"]')).toBeNull();
    expect(input.value).toBe('');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    unmount(cmp);
  });
});

describe('RunRosterTab — row removes and the strip (slice6c §4)', () => {
  it('a stale pendingDelete is cleared when the student leaves the roster', async () => {
    const { target, cmp, props } = mountTab();
    rowTrash(target, 1).click();
    await settle();
    expect(q(target, 'tr.ro-confirm-row')).not.toBeNull();
    props.students = [stu(2)];
    await settle();
    props.students = [stu(1), stu(2)];
    await settle();
    expect(q(target, 'tr.ro-confirm-row')).toBeNull();
    unmount(cmp);
  });

  it("Cancel during a slow Remove keeps focus on that row's 🗑", async () => {
    let finish: (r: Response) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { finish = r; }));
    const { target, cmp } = mountTab();
    rowTrash(target, 1).click();
    await settle();
    q<HTMLButtonElement>(target, '[data-action="confirm-delete-student"]').click();
    await settle();
    // The confirm shows busy while the DELETE runs: Cancel waits.
    const confirm = q<HTMLButtonElement>(target, '[data-action="confirm-delete-student"]');
    const cancel = q<HTMLButtonElement>(target, 'tr.ro-confirm-row .cancel');
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(cancel.getAttribute('aria-disabled')).toBe('true');
    cancel.focus();
    cancel.click();
    await settle();
    expect(q(target, 'tr.ro-confirm-row')).not.toBeNull();
    finish(jres({ detail: 'Server exploded' }, 500));
    await settle();
    expect(q(target, 'tr.ro-confirm-row')).toBeNull();
    expect(document.activeElement).toBe(rowTrash(target, 1));
    unmount(cmp);
  });

  it("other rows' 🗑 give the wait reason while a remove runs", async () => {
    let finish: (r: Response) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { finish = r; }));
    const { target, cmp } = mountTab();
    rowTrash(target, 1).click();
    await settle();
    q<HTMLButtonElement>(target, '[data-action="confirm-delete-student"]').click();
    await settle();
    const other = rowTrash(target, 2);
    expect(other.getAttribute('aria-disabled')).toBe('true');
    expect(other.getAttribute('title')).toBe(BUSY);
    other.click();
    await settle();
    expect(target.querySelectorAll('tr.ro-confirm-row').length).toBe(1);
    finish(jres({ detail: 'Nope' }, 500));
    await settle();
    expect(rowTrash(target, 2).hasAttribute('aria-disabled')).toBe(false);
    expect(rowTrash(target, 2).getAttribute('title')).toBe('Remove from run');
    unmount(cmp);
  });

  it('the strip drops a selected student a refresh removed', async () => {
    const { target, cmp, props } = mountTab();
    const box = q<HTMLInputElement>(row(target, 1), 'input[data-row-checkbox]');
    box.click();
    flushSync();
    expect(q(target, '[data-strip="bulk"]')?.textContent).toContain('1 selected');
    props.students = [stu(2)];
    await settle();
    expect(q(target, '[data-strip="bulk"]')).toBeNull();
    // They come back unselected.
    props.students = [stu(1), stu(2)];
    await settle();
    expect(q(target, '[data-strip="bulk"]')).toBeNull();
    unmount(cmp);
  });
});

describe('RunRosterTab — a bulk op blocks the row actions and Add (call 17)', () => {
  it('row 🗑, group selects and Add are disabled during a bulk op, and work again after it rejects', async () => {
    let fail: (e: unknown) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((_, rej) => { fail = rej; }));
    const { target, cmp } = mountTab();
    await openAddAndType(target, 'new@x.com');
    q<HTMLInputElement>(row(target, 1), 'input[data-row-checkbox]').click();
    flushSync();
    change(q<HTMLSelectElement>(target, '[data-action="bulk-move-select"]'), '99');
    await settle();
    const add = q<HTMLButtonElement>(target, '[data-action="add-student"]');
    for (const id of [1, 2]) {
      expect(rowTrash(target, id).getAttribute('aria-disabled')).toBe('true');
      expect(rowTrash(target, id).getAttribute('title')).toBe(BUSY);
      expect(rowSelect(target, id).disabled).toBe(true);
      expect(rowSelect(target, id).getAttribute('title')).toBe(BUSY);
    }
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.getAttribute('title')).toBe(BUSY);
    // Blocked controls do nothing.
    rowTrash(target, 2).click();
    add.click();
    await settle();
    expect(q(target, 'tr.ro-confirm-row')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fail(new TypeError('Failed to fetch'));
    await settle();
    for (const id of [1, 2]) {
      expect(rowTrash(target, id).hasAttribute('aria-disabled')).toBe(false);
      expect(rowSelect(target, id).disabled).toBe(false);
      expect(rowSelect(target, id).hasAttribute('title')).toBe(false);
    }
    expect(add.hasAttribute('aria-disabled')).toBe(false);
    rowTrash(target, 2).click();
    await settle();
    expect(q(target, 'tr.ro-confirm-row')).not.toBeNull();
    unmount(cmp);
  });
});

describe('RunRosterTab — review r1', () => {
  it('a Remove whose refetch fails toasts Removed (refresh failed — reload to see latest)', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(jres({}, 204)));
    const onRefetchRosterData = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { target, cmp } = mountTab({ onRefetchRosterData, students: [stu(1), stu(2), stu(3)] });
    rowTrash(target, 1).click();
    await settle();
    q<HTMLButtonElement>(target, '[data-action="confirm-delete-student"]').click();
    await settle();
    expect(toastTexts()).toContain('Removed (refresh failed — reload to see latest)');
    expect(toastTexts()).not.toContain(OFFLINE);
    // The stale row is still listed; focus skips it to the next student's 🗑 (review r2).
    expect(q(target, 'tr.ro-confirm-row')).toBeNull();
    expect(rowTrash(target, 2).hasAttribute('aria-disabled')).toBe(false);
    expect(document.activeElement).toBe(rowTrash(target, 2));
    unmount(cmp);
  });

  it('a failed bulk row whose student left the roster is neither selected nor offered for retry', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(jres({
      results: [
        { user_id: 1, status: 'ok' },
        { user_id: 2, status: 'error', error_code: 'not_in_run' },
      ],
      summary: { total: 2, ok: 1, error: 1 },
    })));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const holder: { props?: any } = {};
    const onRefetchRosterData = vi.fn(async () => {
      holder.props.students = [stu(1, { group_id: 99 })];
      return { students: holder.props.students, groups: groups() };
    });
    const { target, cmp, props } = mountTab({ onRefetchRosterData });
    holder.props = props;
    q<HTMLInputElement>(target, 'input[data-header-checkbox]').click();
    flushSync();
    change(q<HTMLSelectElement>(target, '[data-action="bulk-move-select"]'), '99');
    await settle();
    expect(q(target, '[data-strip="bulk"]')).toBeNull();
    expect(q(target, '[data-action="retry-move-select"]')).toBeNull();
    expect(q(target, '.ro-banner')?.textContent).not.toContain('Hover a marked row');
    expect(document.activeElement).toBe(q(target, '[data-action="dismiss-banner"]'));
    unmount(cmp);
  });

  it("an open row confirm's Remove waits during a bulk op", async () => {
    let fail: (e: unknown) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((_, rej) => { fail = rej; }));
    const { target, cmp } = mountTab();
    rowTrash(target, 2).click();
    await settle();
    q<HTMLInputElement>(row(target, 1), 'input[data-row-checkbox]').click();
    flushSync();
    change(q<HTMLSelectElement>(target, '[data-action="bulk-move-select"]'), '99');
    await settle();
    const remove = q<HTMLButtonElement>(target, '[data-action="confirm-delete-student"]');
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(remove.getAttribute('title')).toBe(BUSY);
    remove.click();
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fail(new TypeError('Failed to fetch'));
    await settle();
    expect(q(target, '[data-action="confirm-delete-student"]').hasAttribute('aria-disabled')).toBe(false);
    unmount(cmp);
  });

  it('the duplicate check puts focus in the field', async () => {
    const { target, cmp } = mountTab();
    const input = await openAddAndType(target, 's1@x.com');
    const add = q<HTMLButtonElement>(target, '[data-action="add-student"]');
    add.focus();
    add.click();
    await settle();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
    unmount(cmp);
  });
});

describe('RunRosterTab — review r3', () => {
  it('an empty-field Add stays natively disabled through a bulk op', async () => {
    let fail: (e: unknown) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((_, rej) => { fail = rej; }));
    const { target, cmp } = mountTab();
    await openAddAndType(target, '');
    const add = q<HTMLButtonElement>(target, '[data-action="add-student"]');
    expect(add.disabled).toBe(true);
    q<HTMLInputElement>(row(target, 1), 'input[data-row-checkbox]').click();
    flushSync();
    change(q<HTMLSelectElement>(target, '[data-action="bulk-move-select"]'), '99');
    await settle();
    expect(add.disabled).toBe(true);
    fail(new TypeError('Failed to fetch'));
    await settle();
    expect(add.disabled).toBe(true);
    unmount(cmp);
  });
});

describe('RunRosterTab — review r7', () => {
  it('closing the add row clears the red mark', async () => {
    const { target, cmp } = mountTab();
    await openAddAndType(target, 's1@x.com');
    q<HTMLButtonElement>(target, '[data-action="add-student"]').click();
    await settle();
    expect(q(target, 'input[name="new-email"]').getAttribute('aria-invalid')).toBe('true');
    const toggle = q<HTMLButtonElement>(target, '[data-action="toggle-add-student"]');
    toggle.click();
    await settle();
    toggle.click();
    await settle();
    expect(q(target, 'input[name="new-email"]').hasAttribute('aria-invalid')).toBe(false);
    unmount(cmp);
  });
});
