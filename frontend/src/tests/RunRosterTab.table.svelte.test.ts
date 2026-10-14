import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunRosterTab from '../components/runs/RunRosterTab.svelte';
import { toasts } from '../stores/toasts.svelte';
import type { GroupResponse, RunStudentResponse } from '../lib/types';

// Slice 6c Task 4 (10b): the bulk strip and its confirm, the result banner,
// the table, marked rows and the row confirm. R38, R44, §Focus › Roster,
// Review Focus 4.
const fetchSpy = vi.fn();
let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
// What the next roster refetch returns; null keeps the students as they are.
let server: RunStudentResponse[] | null = null;

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
  toasts.list.length = 0;
  server = null;
});
afterEach(() => {
  if (cmp) { unmount(cmp); cmp = null; }
  vi.useRealTimers();
});

function resp(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response;
}
const jres = (body: unknown, status = 200) => Promise.resolve(resp(body, status));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}
async function settleAll() {
  for (let i = 0; i < 4; i++) await settle();
}

const student = (id: number, over: Partial<RunStudentResponse> = {}): RunStudentResponse => ({
  id,
  run_id: 10,
  user_id: id,
  user_email: `s${id}@x.com`,
  user_full_name: `S${id}`,
  group_id: null,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
} as RunStudentResponse);

const group = (id: number, name: string, over: Partial<GroupResponse> = {}): GroupResponse => ({
  id,
  run_id: 10,
  name,
  student_count: 0,
  is_disabled: false,
  ...over,
} as GroupResponse);

const ALPHA = group(99, 'Alpha', { student_count: 7 });
const BETA_OFF = group(100, 'Beta', { student_count: 3, is_disabled: true });

// One result row per id: `ok` succeed, `failed` = [id, error_code, detail].
function result(ok: number[], failed: Array<[number, string | null, string | null]> = []) {
  return {
    results: [
      ...ok.map((user_id) => ({ user_id, status: 'ok' })),
      ...failed.map(([user_id, error_code, detail]) => ({ user_id, status: 'error', error_code, detail })),
    ],
    summary: { total: ok.length + failed.length, ok: ok.length, error: failed.length },
  };
}
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function open(over: Record<string, unknown> = {}) {
  const props = $state({
    runId: 10,
    runIsPublished: true,
    isAdmin: true,
    courseSlug: 'test',
    onNavigateToTab: vi.fn(),
    students: [student(1), student(2), student(3)] as RunStudentResponse[],
    groups: [ALPHA, BETA_OFF] as GroupResponse[],
    groupsEnabled: true,
    rosterPrefilter: null as 'unassigned' | null,
    onPrefilterClear: vi.fn(),
    onRefetchRosterData: vi.fn(async () => {
      if (server) props.students = server;
      return { students: props.students, groups: props.groups };
    }),
    onRefetchGroupsOnly: vi.fn().mockResolvedValue(undefined),
    onOpenImport: vi.fn(),
    ...over,
  });
  target = document.createElement('div');
  document.body.appendChild(target);
  cmp = mount(RunRosterTab, { target, props });
  flushSync();
  return props;
}

const act = <T extends HTMLElement = HTMLButtonElement>(action: string) =>
  target.querySelector(`[data-action="${action}"]`) as T | null;
const row = (id: number) => target.querySelector(`tr[data-user-id="${id}"]`) as HTMLTableRowElement | null;
const trash = (id: number) => row(id)!.querySelector('button[data-action="delete-student"]') as HTMLButtonElement;
const strip = () => target.querySelector('[data-strip="bulk"]') as HTMLElement | null;
const bulkTrash = () => act('bulk-delete')!;
const banner = () => target.querySelector('.ro-banner') as HTMLElement | null;
const bannerText = () => text(target.querySelector('.ro-banner-text'));
const search = () => target.querySelector('input[name="roster-search"]') as HTMLInputElement;
const labelFor = (el: Element) => target.querySelector(`label[for="${el.id}"]`)?.textContent ?? null;
const options = (sel: HTMLSelectElement) => Array.from(sel.options).map((o) => o.textContent);
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const bulkCalls = (kind: 'bulk-move' | 'bulk-delete') =>
  fetchSpy.mock.calls.filter(([u]) => String(u).endsWith(`/students/${kind}`));

function check(id: number) {
  (row(id)!.querySelector('input[data-row-checkbox]') as HTMLInputElement).click();
  flushSync();
}
function checkAll() {
  (target.querySelector('input[data-header-checkbox]') as HTMLInputElement).click();
  flushSync();
}
function pick(sel: HTMLSelectElement, value: string) {
  sel.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('RunRosterTab — the bulk strip', () => {
  it('"N selected", the hidden-labelled move select with "Name · n/10", 🗑 "Remove selected" and Clear selection', () => {
    open();
    check(1);
    check(2);
    expect(strip()!.classList.contains('ro-strip')).toBe(true);
    expect(text(target.querySelector('.ro-count'))).toBe('2 selected');
    const sel = act<HTMLSelectElement>('bulk-move-select')!;
    expect(labelFor(sel)).toBe('Move selected to a group');
    expect(options(sel)).toEqual(['Move to group…', 'Unassign', 'Alpha · 7/10']);
    expect(sel.value).toBe('');
    expect(bulkTrash().getAttribute('data-glyph')).toBe('trash');
    expect(bulkTrash().getAttribute('aria-label')).toBe('Remove selected');
    expect(bulkTrash().getAttribute('title')).toBe('Remove selected');
    expect(bulkTrash().hasAttribute('aria-disabled')).toBe(false);
    expect(text(act('clear-selection'))).toBe('Clear selection');
  });

  it('" (M visible)" while the search hides some students', () => {
    open();
    check(1);
    check(2);
    search().value = 's1';
    search().dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(text(target.querySelector('.ro-count'))).toBe('2 selected (1 visible)');
  });

  it('selected rows carry the tint class', () => {
    open();
    check(2);
    expect(row(2)!.classList.contains('ro-selected')).toBe(true);
    expect(row(1)!.classList.contains('ro-selected')).toBe(false);
  });

  it('groups off: no move select', () => {
    open({ groupsEnabled: false });
    check(1);
    expect(act('bulk-move-select')).toBeNull();
    expect(bulkTrash()).not.toBeNull();
  });

  it('Clear selection empties the selection and focuses the search field', async () => {
    open();
    check(1);
    act('clear-selection')!.click();
    await settle();
    expect(strip()).toBeNull();
    expect(document.activeElement).toBe(search());
  });

  it('the bulk confirm replaces the strip\'s right part, focuses Cancel, says plural or singular; Cancel → 🗑', async () => {
    open();
    check(1);
    check(2);
    bulkTrash().click();
    await settle();
    const warning = strip()!.querySelector('[role="group"] .warning');
    expect(text(warning)).toBe('Remove 2 students from this run?');
    expect(text(act('confirm-bulk-delete'))).toBe('Remove');
    expect(act('bulk-move-select')).toBeNull();
    expect(act('clear-selection')).toBeNull();
    const cancel = strip()!.querySelector('button.cancel') as HTMLButtonElement;
    expect(document.activeElement).toBe(cancel);
    cancel.click();
    await settle();
    expect(act('confirm-bulk-delete')).toBeNull();
    expect(document.activeElement).toBe(bulkTrash());

    check(2);
    bulkTrash().click();
    await settle();
    expect(text(strip()!.querySelector('[role="group"] .warning'))).toBe('Remove 1 student from this run?');
  });

  it('an emptied selection does not bring the confirm back with the next selection', async () => {
    open();
    check(1);
    bulkTrash().click();
    await settle();
    check(1);
    expect(strip()).toBeNull();
    check(2);
    expect(act('confirm-bulk-delete')).toBeNull();
    expect(bulkTrash()).not.toBeNull();
  });

  it('Remove sends one bulk delete of the selected ids; the banner says "Removed"; focus → Dismiss', async () => {
    fetchSpy.mockImplementation((url: string) => (url.endsWith('/bulk-delete') ? jres(result([1, 2])) : jres([])));
    open();
    server = [student(3)];
    check(1);
    check(2);
    bulkTrash().click();
    await settle();
    act('confirm-bulk-delete')!.click();
    await settleAll();
    expect(bulkCalls('bulk-delete')).toHaveLength(1);
    expect(JSON.parse((bulkCalls('bulk-delete')[0][1] as RequestInit).body as string)).toEqual({ user_ids: [1, 2] });
    expect(bannerText()).toBe('Removed 2 of 2 — 0 failed.');
    expect(banner()!.classList.contains('ro-banner-ok')).toBe(true);
    expect(strip()).toBeNull();
    expect(row(1)).toBeNull();
    expect(document.activeElement).toBe(act('dismiss-banner'));
  });
});

describe('RunRosterTab — R44: busy bulk controls keep focus and ignore input', () => {
  it('during a bulk op the move select sends nothing and resets; 🗑 is aria-disabled with its title and does nothing', async () => {
    const pending = deferred<Response>();
    fetchSpy.mockImplementation((url: string) => (url.endsWith('/bulk-move') ? pending.promise : jres([])));
    open();
    check(1);
    check(2);
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settle();
    expect(bulkCalls('bulk-move')).toHaveLength(1);
    expect(act<HTMLSelectElement>('bulk-move-select')!.value).toBe('');
    expect(bannerText()).toBe('Moving 2…');
    expect(banner()!.classList.contains('ro-banner-info')).toBe(true);
    // In flight the banner has no actions, so no retry can be sent either.
    expect(banner()!.querySelector('button, select')).toBeNull();

    const sel = act<HTMLSelectElement>('bulk-move-select')!;
    expect(sel.disabled).toBe(false);
    pick(sel, '__unassigned');
    await settle();
    expect(sel.value).toBe('');
    expect(bulkCalls('bulk-move')).toHaveLength(1);

    const t = bulkTrash();
    expect(t.disabled).toBe(false);
    expect(t.getAttribute('aria-disabled')).toBe('true');
    expect(t.getAttribute('title')).toBe('Wait for the current change to finish');
    t.click();
    await settle();
    expect(act('confirm-bulk-delete')).toBeNull();

    pending.resolve(resp(result([1, 2])));
    await settleAll();
    expect(bannerText()).toBe('Moved 2 of 2 — 0 failed.');
    expect(bulkCalls('bulk-move')).toHaveLength(1);
  });

  it('Review Focus 4: 236 students → "Moving 236…"; a select change between the chunks sends nothing; then 200 + 36', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const sizes: number[] = [];
    fetchSpy.mockImplementation((url: string, init: RequestInit) => {
      if (!url.endsWith('/bulk-move')) return jres([]);
      sizes.push(JSON.parse(init.body as string).user_ids.length);
      return sizes.length === 1 ? first.promise : second.promise;
    });
    open({ students: range(1, 236).map((id) => student(id)) });
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settle();
    expect(bannerText()).toBe('Moving 236…');
    expect(sizes).toEqual([200]);
    pick(act<HTMLSelectElement>('bulk-move-select')!, '__unassigned');
    await settle();
    expect(sizes).toEqual([200]);

    first.resolve(resp(result(range(1, 200))));
    await settle();
    expect(sizes).toEqual([200, 36]);
    expect(bannerText()).toBe('Moving 236…');
    pick(act<HTMLSelectElement>('bulk-move-select')!, '__unassigned');
    await settle();
    expect(sizes).toEqual([200, 36]);
    expect(act<HTMLSelectElement>('bulk-move-select')!.value).toBe('');

    second.resolve(resp(result(range(201, 236))));
    await settleAll();
    expect(bannerText()).toBe('Moved 236 of 236 — 0 failed.');
  });
});

describe('RunRosterTab — the result banner', () => {
  it('success: green, focus on Dismiss, closes itself after 5 s and hands focus to the search field', async () => {
    vi.useFakeTimers();
    fetchSpy.mockImplementation((url: string) => (url.endsWith('/bulk-move') ? jres(result([1, 2, 3])) : jres([])));
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settleAll();
    expect(banner()!.getAttribute('role')).toBe('status');
    expect(banner()!.classList.contains('ro-banner-ok')).toBe(true);
    expect(bannerText()).toBe('Moved 3 of 3 — 0 failed.');
    expect(document.activeElement).toBe(act('dismiss-banner'));
    vi.advanceTimersByTime(5100);
    await settle();
    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(search());
  });

  it('success with focus elsewhere: the auto-close leaves focus alone', async () => {
    vi.useFakeTimers();
    fetchSpy.mockImplementation((url: string) => (url.endsWith('/bulk-move') ? jres(result([1, 2, 3])) : jres([])));
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settleAll();
    const box = row(1)!.querySelector('input[data-row-checkbox]') as HTMLInputElement;
    box.focus();
    vi.advanceTimersByTime(5100);
    await settle();
    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(box);
  });

  it('partial move: gold, the hover hint, the hidden-labelled retry select; focus on the strip\'s 🗑; the retry sends the failed ids', async () => {
    let phase = 1;
    fetchSpy.mockImplementation((url: string) => {
      if (!url.endsWith('/bulk-move')) return jres([]);
      return jres(phase++ === 1 ? result([1, 3], [[2, 'capacity_reached', 'full']]) : result([2]));
    });
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settleAll();
    expect(banner()!.classList.contains('ro-banner-warn')).toBe(true);
    expect(bannerText()).toBe('Moved 2 of 3 — 1 failed. Hover a marked row for the reason.');
    const retry = act<HTMLSelectElement>('retry-move-select')!;
    expect(retry.classList.contains('ro-retry')).toBe(true);
    expect(options(retry)).toEqual(['Retry 1 → group…', 'Unassign', 'Alpha · 7/10']);
    expect(labelFor(retry)).toBe('Move the 1 failed student to a group');
    expect(text(target.querySelector('.ro-count'))).toBe('1 selected');
    expect(document.activeElement).toBe(bulkTrash());

    pick(retry, '99');
    await settleAll();
    expect(bulkCalls('bulk-move')).toHaveLength(2);
    expect(JSON.parse((bulkCalls('bulk-move')[1][1] as RequestInit).body as string)).toEqual({ user_ids: [2], group_id: 99 });
    expect(bannerText()).toBe('Moved 1 of 1 — 0 failed.');
  });

  it('a marked row: the rule class on its first cell, its reason as the row title, and a hidden "Failed: …"', async () => {
    fetchSpy.mockImplementation((url: string) =>
      url.endsWith('/bulk-move') ? jres(result([1, 3], [[2, 'capacity_reached', 'full']])) : jres([]));
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settleAll();
    const r2 = row(2)!;
    expect(r2.classList.contains('row-error')).toBe(true);
    expect(r2.querySelector('td')!.classList.contains('ro-mark')).toBe(true);
    expect(r2.getAttribute('title')).toBe('Target group is full (10 students).');
    expect(text(r2.querySelector('.ro-email-cell .vh'))).toBe('Failed: Target group is full (10 students).');
    expect(row(1)!.querySelector('td')!.classList.contains('ro-mark')).toBe(false);
    expect(row(1)!.hasAttribute('title')).toBe(false);
    expect(row(1)!.querySelector('.ro-email-cell .vh')).toBeNull();
  });

  it('partial remove: "Removed …" and "Retry removing N"', async () => {
    fetchSpy.mockImplementation((url: string) =>
      url.endsWith('/bulk-delete') ? jres(result([1], [[2, 'not_in_run', null]])) : jres([]));
    open();
    check(1);
    check(2);
    bulkTrash().click();
    await settle();
    act('confirm-bulk-delete')!.click();
    await settleAll();
    expect(bannerText()).toBe('Removed 1 of 2 — 1 failed. Hover a marked row for the reason.');
    expect(text(act('retry-delete'))).toBe('Retry removing 1');
    expect(act('retry-delete')!.classList.contains('ro-retry')).toBe(true);
    expect(document.activeElement).toBe(bulkTrash());
  });

  it('cancelled move without marked rows: no hover hint; "Move the N not processed…" with its hidden label', async () => {
    fetchSpy.mockImplementation((url: string) => (url.endsWith('/bulk-move') ? jres({ detail: 'Server error' }, 500) : jres([])));
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settleAll();
    expect(banner()!.classList.contains('ro-banner-warn')).toBe(true);
    expect(bannerText()).toBe('Moved 0 of 3 — 0 failed, 3 cancelled (connection issue).');
    const rc = act<HTMLSelectElement>('retry-cancelled')!;
    expect(rc.tagName).toBe('SELECT');
    expect(options(rc)).toEqual(['Move the 3 not processed…', 'Unassign', 'Alpha · 7/10']);
    expect(labelFor(rc)).toBe('Move the 3 not processed students to a group');
  });

  it('cancelled remove: "Retry the N not processed"', async () => {
    fetchSpy.mockImplementation((url: string) => (url.endsWith('/bulk-delete') ? jres({ detail: 'Server error' }, 500) : jres([])));
    open();
    check(1);
    check(2);
    bulkTrash().click();
    await settle();
    act('confirm-bulk-delete')!.click();
    await settleAll();
    expect(text(act('retry-cancelled'))).toBe('Retry the 2 not processed');
  });

  it('Dismiss closes the banner and focuses the search field', async () => {
    fetchSpy.mockImplementation((url: string) =>
      url.endsWith('/bulk-move') ? jres(result([1, 3], [[2, 'capacity_reached', 'full']])) : jres([]));
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settleAll();
    act('dismiss-banner')!.click();
    await settle();
    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(search());
  });

  it('a settled op leaves focus where the teacher moved it', async () => {
    const pending = deferred<Response>();
    fetchSpy.mockImplementation((url: string) => (url.endsWith('/bulk-move') ? pending.promise : jres([])));
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settle();
    search().focus();
    pending.resolve(resp(result([1, 3], [[2, 'capacity_reached', 'full']])));
    await settleAll();
    expect(bannerText()).toMatch(/^Moved 2 of 3/);
    expect(document.activeElement).toBe(search());
  });
});

describe('RunRosterTab — a marked row fixed by hand (Safari pass, user 2026-10-13)', () => {
  const rowSelect = (id: number) => row(id)!.querySelector('select') as HTMLSelectElement;
  const marked = (id: number) => row(id)!.classList.contains('row-error');
  // Students 2 and 3 fail the first bulk move; later moves and every row PATCH succeed.
  function twoFail() {
    let phase = 1;
    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/bulk-move')) {
        return jres(phase++ === 1 ? result([1], [[2, 'internal_error', null], [3, 'internal_error', null]]) : result([3]));
      }
      if (init?.method === 'PATCH') {
        const id = Number(url.split('/').pop());
        return jres(student(id, JSON.parse(init.body as string)));
      }
      if (init?.method === 'DELETE') return Promise.resolve(resp(null, 204));
      return jres([]);
    });
  }

  it("the row's own group change clears its mark, reason and hidden text; it stays selected", async () => {
    twoFail();
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settleAll();
    expect(marked(2)).toBe(true);
    pick(rowSelect(2), '99');
    await settleAll();
    expect(marked(2)).toBe(false);
    expect(row(2)!.querySelector('td')!.classList.contains('ro-mark')).toBe(false);
    expect(row(2)!.hasAttribute('title')).toBe(false);
    expect(row(2)!.querySelector('.ro-email-cell .vh')).toBeNull();
    expect((row(2)!.querySelector('input[data-row-checkbox]') as HTMLInputElement).checked).toBe(true);
    expect(marked(3)).toBe(true);
  });

  it('the retry leaves out a row fixed by hand: "Retry 1 → group…" sends only the other id', async () => {
    twoFail();
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settleAll();
    expect(options(act<HTMLSelectElement>('retry-move-select')!)[0]).toBe('Retry 2 → group…');
    pick(rowSelect(2), '99');
    await settleAll();
    const retry = act<HTMLSelectElement>('retry-move-select')!;
    expect(options(retry)[0]).toBe('Retry 1 → group…');
    expect(labelFor(retry)).toBe('Move the 1 failed student to a group');
    pick(retry, '99');
    await settleAll();
    expect(JSON.parse((bulkCalls('bulk-move')[1][1] as RequestInit).body as string)).toEqual({ user_ids: [3], group_id: 99 });
  });

  it('with every failed row fixed by hand the banner closes', async () => {
    twoFail();
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settleAll();
    pick(rowSelect(2), '99');
    await settleAll();
    expect(banner()).not.toBeNull();
    trash(3).click();
    await settle();
    (target.querySelector('button.confirm') as HTMLButtonElement).click();
    server = [student(1, { group_id: 99 }), student(2, { group_id: 99 })];
    await settleAll();
    expect(banner()).toBeNull();
    // The removed student leaves the selection: no ghost id for the next bulk op.
    expect(text(target.querySelector('.ro-count'))).toBe('1 selected');
  });

  it('a row fixed by hand while a bulk op runs keeps the op\'s verdict: marked and counted in the retry', async () => {
    const pending = deferred<Response>();
    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/bulk-move')) return pending.promise;
      if (init?.method === 'PATCH') {
        const id = Number(url.split('/').pop());
        return jres(student(id, JSON.parse(init.body as string)));
      }
      return jres([]);
    });
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settle();
    pick(rowSelect(2), '99');
    await settleAll();
    pending.resolve(resp(result([1, 3], [[2, 'internal_error', null]])));
    await settleAll();
    expect(marked(2)).toBe(true);
    expect(options(act<HTMLSelectElement>('retry-move-select')!)[0]).toBe('Retry 1 → group…');
  });

  it('Dismiss clears every mark; the selection stays', async () => {
    twoFail();
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settleAll();
    act('dismiss-banner')!.click();
    await settle();
    expect(marked(2)).toBe(false);
    expect(marked(3)).toBe(false);
    expect(row(3)!.hasAttribute('title')).toBe(false);
    expect(text(target.querySelector('.ro-count'))).toBe('2 selected');
  });
});

describe('RunRosterTab — the table', () => {
  it('columns, header box and accessible names', () => {
    open();
    expect(target.querySelector('.ro-table-wrap > table.ro-table')).not.toBeNull();
    expect(Array.from(target.querySelectorAll('thead th')).map((th) => text(th))).toEqual(['', 'Email', 'Full name', 'Group', 'Actions']);
    expect(target.querySelector('thead th .vh')!.textContent).toBe('Actions');
    expect(target.querySelector('input[data-header-checkbox]')!.getAttribute('aria-label')).toBe('Select all visible students');
    expect(row(1)!.querySelector('input[data-row-checkbox]')!.getAttribute('aria-label')).toBe('Select s1@x.com');
    const sel = row(1)!.querySelector('select') as HTMLSelectElement;
    expect(sel.getAttribute('aria-label')).toBe('Group for s1@x.com');
    expect(trash(1).getAttribute('aria-label')).toBe('Remove s1@x.com');
    expect(trash(1).getAttribute('title')).toBe('Remove from run');
    expect(trash(1).getAttribute('data-glyph')).toBe('trash');
    expect(row(1)!.getAttribute('data-row')).toBe('student');
  });

  it('the row select reads "Name · n/10", adding " · disabled" for a disabled group (R38)', () => {
    open();
    expect(options(row(1)!.querySelector('select') as HTMLSelectElement)).toEqual([
      'Unassigned', 'Alpha · 7/10', 'Beta · 3/10 · disabled',
    ]);
  });

  it('groups off: no Group column', () => {
    open({ groupsEnabled: false });
    expect(Array.from(target.querySelectorAll('thead th')).map((th) => text(th))).toEqual(['', 'Email', 'Full name', 'Actions']);
    expect(row(1)!.querySelector('select')).toBeNull();
  });

  it('an empty full name shows a muted dash; the e-mail cell can wrap', () => {
    open({ students: [student(1, { user_full_name: null })] });
    expect(text(row(1)!.querySelector('.ro-none'))).toBe('—');
    expect(row(1)!.querySelector('td.ro-email-cell')!.textContent).toBe('s1@x.com');
  });

  it('no table while nothing matches', () => {
    open();
    search().value = 'zzz';
    search().dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(target.querySelector('table')).toBeNull();
  });
});

describe('RunRosterTab — the row confirm', () => {
  it('opens a one-line row under its row with focus on Cancel; Cancel → its 🗑', async () => {
    open();
    trash(2).click();
    await settle();
    const confirmRow = row(2)!.nextElementSibling as HTMLTableRowElement;
    expect(confirmRow.classList.contains('ro-confirm-row')).toBe(true);
    expect(confirmRow.querySelector('td')!.getAttribute('colspan')).toBe('5');
    expect(text(confirmRow.querySelector('.warning'))).toBe('Remove s2@x.com from this run?');
    expect(confirmRow.querySelector('.inline-confirm')?.classList.contains('end')).toBe(true);   // under the 🗑 (D42)
    expect(text(act('confirm-delete-student'))).toBe('Remove');
    const cancel = confirmRow.querySelector('button.cancel') as HTMLButtonElement;
    expect(document.activeElement).toBe(cancel);
    cancel.click();
    await settle();
    expect(target.querySelector('.ro-confirm-row')).toBeNull();
    expect(document.activeElement).toBe(trash(2));
  });

  it('Remove → the next row\'s 🗑, else the previous row\'s, else the add toggle', async () => {
    fetchSpy.mockImplementation((_url: string, init?: RequestInit) => (init?.method === 'DELETE' ? jres(null, 204) : jres([])));
    open();
    server = [student(1), student(3)];
    trash(2).click();
    await settle();
    act('confirm-delete-student')!.click();
    await settleAll();
    expect(row(2)).toBeNull();
    expect(document.activeElement).toBe(trash(3));

    server = [student(1)];
    trash(3).click();
    await settle();
    act('confirm-delete-student')!.click();
    await settleAll();
    expect(document.activeElement).toBe(trash(1));

    server = [];
    trash(1).click();
    await settle();
    act('confirm-delete-student')!.click();
    await settleAll();
    expect(document.activeElement).toBe(act('toggle-add-student'));
    expect(fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toHaveLength(3);
  });

  it('on a draft (the toggle disabled) the last Remove → the search field', async () => {
    fetchSpy.mockImplementation((_url: string, init?: RequestInit) => (init?.method === 'DELETE' ? jres(null, 204) : jres([])));
    open({ runIsPublished: false, students: [student(1)] });
    server = [];
    trash(1).click();
    await settle();
    act('confirm-delete-student')!.click();
    await settleAll();
    expect(document.activeElement).toBe(search());
  });

  it('two clicks on Remove send one DELETE; a failed Remove toasts, closes the confirm and focuses its 🗑', async () => {
    const pending = deferred<Response>();
    fetchSpy.mockImplementation((_url: string, init?: RequestInit) => (init?.method === 'DELETE' ? pending.promise : jres([])));
    open();
    trash(2).click();
    await settle();
    act('confirm-delete-student')!.click();
    act('confirm-delete-student')!.click();
    await settle();
    expect(fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toHaveLength(1);
    pending.resolve(resp({ detail: 'Student has submissions' }, 409));
    await settleAll();
    expect(target.querySelector('.ro-confirm-row')).toBeNull();
    expect(row(2)).not.toBeNull();
    expect(toasts.list.map((t) => t.message)).toContain('Student has submissions');
    expect(document.activeElement).toBe(trash(2));
  });
});
