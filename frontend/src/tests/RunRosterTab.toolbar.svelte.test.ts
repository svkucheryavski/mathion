import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunRosterTab from '../components/runs/RunRosterTab.svelte';
import type { GroupResponse, RunStudentResponse } from '../lib/types';

// Slice 6c Task 3 (10b): the draft banner, the toolbar, the add row behind +
// (D25), the empty state and the no-match lines. §Focus › Roster.
const fetchSpy = vi.fn();
let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
});
afterEach(() => {
  if (cmp) { unmount(cmp); cmp = null; }
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

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
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

function open(props: Record<string, unknown> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  cmp = mount(RunRosterTab, {
    target,
    props: {
      runId: 10,
      runIsPublished: true,
      isAdmin: true,
      courseSlug: 'test',
      onNavigateToTab: vi.fn(),
      students: [student(1)],
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
  flushSync();
}

const act = (action: string) => target.querySelector(`button[data-action="${action}"]`) as HTMLButtonElement | null;
const toggle = () => act('toggle-add-student')!;
const email = () => target.querySelector('input[name="new-email"]') as HTMLInputElement | null;
const search = () => target.querySelector('input[name="roster-search"]') as HTMLInputElement;
const labelFor = (el: Element) => target.querySelector(`label[for="${el.id}"]`)?.textContent ?? null;
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function type(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('RunRosterTab — the add toggle and the add row (D25)', () => {
  it('+ opens the row under the toolbar with focus on the e-mail field; the toggle turns into × and closes it', async () => {
    open();
    expect(email()).toBeNull();
    expect(target.querySelector('form.add-row')).toBeNull();
    expect(toggle().getAttribute('data-glyph')).toBe('plus');
    expect(toggle().getAttribute('aria-label')).toBe('Add student');
    expect(toggle().getAttribute('title')).toBe('Add student');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');

    toggle().click();
    await settle();
    const field = email()!;
    expect(document.activeElement).toBe(field);
    const form = field.closest('form')!;
    expect(form.classList.contains('ro-add')).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-controls')).toBe(form.id);
    expect(toggle().getAttribute('data-glyph')).toBe('close');
    expect(toggle().getAttribute('aria-label')).toBe('Close add row');
    expect(toggle().getAttribute('title')).toBe('Close add row');
    // The row sits under the toolbar, before the table.
    expect(form.compareDocumentPosition(target.querySelector('table')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    toggle().click();
    await settle();
    expect(email()).toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle());
  });

  it('Esc in the row and Cancel close it; focus returns to the toggle', async () => {
    open();
    toggle().click();
    await settle();
    email()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(email()).toBeNull();
    expect(document.activeElement).toBe(toggle());

    toggle().click();
    await settle();
    expect(text(act('cancel-add-student'))).toBe('Cancel');
    act('cancel-add-student')!.click();
    await settle();
    expect(email()).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it('the row: hidden labels, the e-mail field, "Unassigned" and the enabled groups as "Name · n/10" (R38, R40)', async () => {
    open({
      groupsEnabled: true,
      groups: [group(1, 'Alpha', { student_count: 7 }), group(2, 'Beta', { is_disabled: true })],
    });
    toggle().click();
    await settle();
    const field = email()!;
    expect(labelFor(field)).toBe('Student email');
    expect(field.type).toBe('email');
    expect(field.maxLength).toBe(254);
    expect(field.placeholder).toBe('student@example.com');
    const sel = target.querySelector('form.ro-add select') as HTMLSelectElement;
    expect(labelFor(sel)).toBe('Group');
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(['Unassigned', 'Alpha · 7/10']);
    expect(sel.value).toBe('__unassigned');
  });

  it('groups off: the row has no group select', async () => {
    open({ groupsEnabled: false });
    toggle().click();
    await settle();
    expect(target.querySelector('form.ro-add select')).toBeNull();
  });

  it('Add is disabled with "Enter an email address" while the field is empty', async () => {
    open();
    toggle().click();
    await settle();
    const add = act('add-student')!;
    expect(add.disabled).toBe(true);
    expect(add.getAttribute('title')).toBe('Enter an email address');
    type(email()!, '   ');
    expect(add.disabled).toBe(true);
    type(email()!, 'x@y.z');
    expect(add.disabled).toBe(false);
    expect(add.getAttribute('title')).toBeNull();
  });

  it('a successful add empties the field, resets the group, keeps the row open, refetches and refocuses the e-mail field', async () => {
    fetchSpy.mockImplementation(() => jres(student(9, { user_email: 'new@x.com', group_id: 1 }), 201));
    const refetch = vi.fn().mockResolvedValue({ students: [], groups: [] });
    open({ groupsEnabled: true, groups: [group(1, 'Alpha')], onRefetchRosterData: refetch });
    toggle().click();
    await settle();
    type(email()!, ' new@x.com ');
    const sel = target.querySelector('form.ro-add select') as HTMLSelectElement;
    sel.value = '1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    act('add-student')!.click();
    await settle();
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/runs/10/students');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'new@x.com', group_id: 1 });
    expect(refetch).toHaveBeenCalledTimes(1);
    const field = email()!;
    expect(field.value).toBe('');
    expect((target.querySelector('form.ro-add select') as HTMLSelectElement).value).toBe('__unassigned');
    expect(document.activeElement).toBe(field);
    expect(target.querySelector('p.ro-err')).toBeNull();
  });

  it('a second submit during the add or its refetch sends nothing; Add is busy, not disabled; the field is read-only (R44)', async () => {
    let answer!: (r: Response) => void;
    fetchSpy.mockImplementation(() => new Promise<Response>((res) => { answer = res; }));
    let refetched!: (v: { students: RunStudentResponse[]; groups: GroupResponse[] }) => void;
    const refetch = vi.fn(() => new Promise<{ students: RunStudentResponse[]; groups: GroupResponse[] }>((res) => { refetched = res; }));
    open({ onRefetchRosterData: refetch });
    toggle().click();
    await settle();
    type(email()!, 'new@x.com');
    const add = act('add-student')!;
    const form = email()!.form!;
    add.click();
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(add.disabled).toBe(false);
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.getAttribute('aria-busy')).toBe('true');
    expect(add.getAttribute('title')).toBe('Wait for the current change to finish');
    expect(email()!.readOnly).toBe(true);
    // A second click, and Enter in the field (implicit submission).
    add.click();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    answer(resp(student(9), 201));
    await settle();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(email()!.readOnly).toBe(true);
    type(email()!, 'other@x.com');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Esc does not close the row mid-add.
    email()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(email()).not.toBeNull();

    refetched({ students: [], groups: [] });
    await settle();
    expect(email()!.readOnly).toBe(false);
    expect(add.getAttribute('aria-busy')).toBeNull();
    expect(add.getAttribute('aria-disabled')).toBeNull();
  });

  it('the duplicate check and a server error show under the row; the field is invalid and described by the error', async () => {
    open({ students: [student(1, { user_email: 'a@x.com' })] });
    toggle().click();
    await settle();
    const field = email()!;
    type(field, 'A@X.COM');
    act('add-student')!.click();
    await settle();
    const dup = target.querySelector('form.ro-add + p.ro-err[role="alert"]')!;
    expect(dup.textContent).toBe('A@X.COM is already enrolled. Edit their group in the table.');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe(dup.id);

    fetchSpy.mockImplementation(() => jres({ detail: 'Group capacity reached' }, 409));
    type(field, 'b@x.com');
    act('add-student')!.click();
    await settle();
    await settle();
    expect(text(target.querySelector('p.ro-err'))).toBe('Group capacity reached');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);

    // Closing the row clears the error; the typed e-mail stays for next time.
    toggle().click();
    await settle();
    expect(target.querySelector('p.ro-err')).toBeNull();
    toggle().click();
    await settle();
    expect(email()!.value).toBe('b@x.com');
    expect(email()!.getAttribute('aria-invalid')).toBeNull();
  });
});

describe('RunRosterTab — the draft banner and the draft-disabled add controls', () => {
  it('admin: the info banner with "Publish on Overview"; the toggle, Import roster and both empty links are disabled, titled and described by it', () => {
    const onNavigateToTab = vi.fn();
    open({ runIsPublished: false, isAdmin: true, students: [], onNavigateToTab });
    const hint = target.querySelector('#roster-draft-publish-hint')!;
    expect(hint.classList.contains('ro-info')).toBe(true);
    expect(hint.getAttribute('role')).toBe('status');
    expect(text(hint)).toBe(
      'Publish this run before adding students. You can still move or remove students already on the roster. Publish on Overview',
    );
    for (const b of [toggle(), act('open-import')!, act('open-import-link')!, act('open-add-link')!]) {
      expect(b.disabled).toBe(true);
      expect(b.getAttribute('title')).toBe('Publish this run before adding students');
      expect(b.getAttribute('aria-describedby')).toBe('roster-draft-publish-hint');
    }
    expect(toggle().getAttribute('aria-label')).toBe('Add student');
    act('nav-overview-publish-roster')!.click();
    expect(onNavigateToTab).toHaveBeenCalledWith('overview');
  });

  it('teacher: the teacher text without a link, and the teacher title', () => {
    open({ runIsPublished: false, isAdmin: false, students: [] });
    const hint = target.querySelector('#roster-draft-publish-hint')!;
    expect(text(hint)).toBe(
      'This run is not published yet. A course admin publishes it; then students can be added. You can still move or remove students already on the roster.',
    );
    expect(act('nav-overview-publish-roster')).toBeNull();
    for (const b of [toggle(), act('open-import')!, act('open-import-link')!, act('open-add-link')!]) {
      expect(b.disabled).toBe(true);
      expect(b.getAttribute('title')).toBe('A course admin must publish this run first');
    }
  });

  it('published: no banner, and nothing points at it', () => {
    open({ runIsPublished: true });
    expect(target.querySelector('#roster-draft-publish-hint')).toBeNull();
    expect(toggle().hasAttribute('aria-describedby')).toBe(false);
    expect(act('open-import')!.hasAttribute('aria-describedby')).toBe(false);
    expect(act('open-import')!.hasAttribute('title')).toBe(false);
  });
});

describe('RunRosterTab — the toolbar', () => {
  it('the search field has its hidden label and placeholder; the chip reads "Unassigned (N)"; × clears the filter and focuses the search', async () => {
    const onPrefilterClear = vi.fn();
    open({
      rosterPrefilter: 'unassigned',
      onPrefilterClear,
      students: [student(1), student(2, { group_id: 9 }), student(3)],
    });
    expect(labelFor(search())).toBe('Search students');
    expect(search().placeholder).toBe('Search name or email…');
    expect(text(target.querySelector('.ro-chip'))).toBe('Unassigned (2)');
    const x = act('clear-prefilter')!;
    expect(x.getAttribute('aria-label')).toBe('Clear filter');
    expect(x.getAttribute('title')).toBe('Clear filter');
    expect(x.textContent!.trim()).toBe('');
    x.click();
    await settle();
    expect(onPrefilterClear).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(search());
  });

  it('no chip without the filter', () => {
    open();
    expect(target.querySelector('.ro-chip')).toBeNull();
    expect(act('clear-prefilter')).toBeNull();
  });

  it('Import roster is a secondary button that opens the import', () => {
    const onOpenImport = vi.fn();
    open({ onOpenImport });
    const b = act('open-import')!;
    expect(b.textContent!.trim()).toBe('Import roster');
    expect(b.getAttribute('data-variant')).toBe('secondary');
    b.click();
    expect(onOpenImport).toHaveBeenCalledTimes(1);
  });
});

describe('RunRosterTab — the empty roster and the no-match lines', () => {
  it('"No students yet." with Import roster (focus moves to the toolbar button without scrolling) and Add student', async () => {
    const onOpenImport = vi.fn();
    open({ students: [], onOpenImport });
    expect(text(target.querySelector('.empty-state .title'))).toBe('No students yet.');
    expect(target.querySelector('table')).toBeNull();
    const link = act('open-import-link')!;
    expect(link.textContent!.trim()).toBe('Import roster');
    const toolbarImport = act('open-import')!;
    const focusSpy = vi.spyOn(toolbarImport, 'focus');
    link.click();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(onOpenImport).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(toolbarImport);
    focusSpy.mockRestore();

    expect(act('open-add-link')!.textContent!.trim()).toBe('Add student');
    act('open-add-link')!.click();
    await settle();
    expect(document.activeElement).toBe(email());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('"No students match …. Clear search." clears the search and focuses it', async () => {
    open({ students: [student(1)] });
    type(search(), 'zzz');
    expect(target.querySelector('table')).toBeNull();
    expect(text(target.querySelector('.ro-nomatch'))).toBe("No students match 'zzz'. Clear search.");
    act('clear-search-link')!.click();
    await settle();
    expect(search().value).toBe('');
    expect(document.activeElement).toBe(search());
    expect(target.querySelectorAll('tr[data-row="student"]').length).toBe(1);
  });

  it('"No students are unassigned. Clear filter." clears the filter and focuses the search', async () => {
    const onPrefilterClear = vi.fn();
    open({ rosterPrefilter: 'unassigned', onPrefilterClear, students: [student(1, { group_id: 9 })] });
    expect(text(target.querySelector('.ro-nomatch'))).toBe('No students are unassigned. Clear filter.');
    act('clear-prefilter-link')!.click();
    await settle();
    expect(onPrefilterClear).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(search());
  });
});
