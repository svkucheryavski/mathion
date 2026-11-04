import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SuperuserUsers from '../pages/superuser/SuperuserUsers.svelte';
import type { PanelUser, PanelUserList } from '../lib/superuser';

async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
function jsonResponse(status: number, body: unknown) {
  return status === 204 ? new Response(null, { status })
    : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const HOUR = 3_600_000;
function u(over: Partial<PanelUser>): PanelUser {
  return {
    id: 1, email: 'x@uni.dk', full_name: null, is_superuser: false, is_disabled: false,
    created_at: '2026-11-01T10:00:00Z', last_seen_at: null, admin_of: [], teacher_runs: [], student_runs: [],
    has_data: true, ...over,
  };
}
const SU = u({ id: 1, email: 'svk@uni.dk', full_name: 'Sergey Kucheryavskiy', is_superuser: true });
const ANNA = u({ id: 9, email: 'aho@uni.dk', full_name: 'Anna Holm', admin_of: [{ id: 1, name: 'Statistics 101' }],
  teacher_runs: [{ id: 3, title: 'Autumn 2026', course_name: 'Statistics 101' }, { id: 4, title: 'Spring 2026', course_name: 'Statistics 101' }] });
const OLE = u({ id: 7, email: 'old@uni.dk', full_name: 'Ole Dahl', is_disabled: true, teacher_runs: [{ id: 5, title: 'Autumn 2025', course_name: 'Algebra' }] });
const NEW = u({ id: 12, email: 'new.colleague@uni.dk', has_data: false });
const COUNTS = { all: 42, admins: 3, teachers: 6, students: 33, disabled: 1 };
function page(users: PanelUser[] = [SU, ANNA, OLE, NEW], total = users.length): PanelUserList {
  return { users, total, counts: COUNTS };
}

type Reply = [number, unknown];
type Handler = (body: unknown, params: URLSearchParams) => Reply | Promise<Reply>;
let routes: Record<string, Handler>;
let calls: string[];
let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
let onAuth: ReturnType<typeof vi.fn>;

beforeEach(() => {
  calls = [];
  routes = { 'GET /users': () => [200, page()] };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const full = new URL(String(url), 'http://x');
    const path = full.pathname.replace('/api/superuser/T', '');
    const key = `${init?.method ?? 'GET'} ${path}`;
    calls.push(`${key}${full.search}`);
    const h = routes[key];
    if (!h) return jsonResponse(500, { detail: `no route ${key}` });
    const [status, body] = await h(init?.body ? JSON.parse(String(init.body)) : undefined, full.searchParams);
    return jsonResponse(status, body);
  }));
});
afterEach(() => {
  if (cmp) unmount(cmp); cmp = null; target?.remove();
  document.documentElement.style.overflow = '';
  vi.useRealTimers(); vi.restoreAllMocks();
});

async function render() {
  target = document.createElement('div');
  document.body.appendChild(target);
  onAuth = vi.fn();
  cmp = mount(SuperuserUsers, { target, props: { token: 'T', onAuth } });
  await settle();
}
const rows = () => [...target.querySelectorAll<HTMLTableRowElement>('tbody tr.u-row')];
const row = (email: string) => rows().find((r) => r.querySelector('.u-email')?.textContent?.trim() === email)!;
const act = (r: HTMLElement, action: string) => r.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
const actions = (r: HTMLElement) => [...r.querySelectorAll<HTMLButtonElement>('td:last-child button')].map((b) => b.dataset.action);
const panel = () => document.querySelector<HTMLElement>('section.modal-panel');
const footButton = (label: string) => [...panel()!.querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === label)!;
const field = (label: string) => [...panel()!.querySelectorAll<HTMLInputElement>('input')].find((i) => i.labels?.[0]?.textContent?.trim() === label)!;
const note = () => target.querySelector<HTMLElement>('.note-strip');
const gets = () => calls.filter((c) => c.startsWith('GET /users')).length;
const search = () => target.querySelector<HTMLInputElement>('input[type="search"]')!;
const pill = (label: string) => [...target.querySelectorAll<HTMLButtonElement>('[role="group"] button')].find((b) => b.textContent!.trim().startsWith(label))!;
const countLine = () => target.querySelector('.u-count')?.textContent?.trim();
function type(el: HTMLInputElement, v: string) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }

it('has the Users heading with New account beside it', async () => {
  await render();
  const head = target.querySelector('.panel-head')!;
  expect(head.querySelector('h1')?.textContent).toBe('Users');
  expect([...head.querySelectorAll('button')].map((b) => b.textContent!.trim())).toEqual(['New account']);
});

it('loads the 20 newest of all accounts, with no search', async () => {
  await render();
  expect(calls[0]).toBe('GET /users?q=&role=all');
});

it('rows show name, email, the role chips and last active (D14, D22)', async () => {
  routes['GET /users'] = () => [200, page([{ ...ANNA, last_seen_at: new Date(Date.now() - 2 * HOUR).toISOString() }, NEW])];
  await render();
  const anna = row('aho@uni.dk');
  expect(anna.querySelector('.u-name')?.textContent?.trim()).toBe('Anna Holm');
  // D14 rev 8: short chips; the list is the hover and, hidden, the screen reader's.
  const chips = [...anna.querySelectorAll<HTMLElement>('.chip')];
  expect(chips.map((c) => c.querySelector('.chip-text')?.textContent?.trim())).toEqual(['Admin (1)', 'Teacher (2)']);
  expect(chips.map((c) => c.title)).toEqual(['- Statistics 101', '- Statistics 101 · Autumn 2026\n- Statistics 101 · Spring 2026']);
  expect(chips[1].querySelector('.vh')?.textContent).toBe(': Statistics 101 · Autumn 2026, Statistics 101 · Spring 2026');
  expect(anna.classList.contains('u-disabled')).toBe(false);
  expect(anna.querySelector('.u-last')?.textContent?.trim()).toBe('2 hours ago');
  const fresh = row('new.colleague@uni.dk');
  expect(fresh.querySelector('.u-name')?.textContent?.trim()).toBe('(no name yet)');
  expect(fresh.querySelector('.u-roles')?.textContent?.trim()).toBe('—');
  expect(fresh.querySelector('.chip')).toBeNull();
  expect(fresh.querySelector('.u-last')?.textContent?.trim()).toBe('never');
  expect([...target.querySelectorAll('thead th')].map((t) => t.textContent?.trim())).toEqual(['Name', 'Email', 'Roles', 'Last active', 'Actions']);
});

it('an admin of two courses with the same name lists both on hover (course names are not unique)', async () => {
  const twin = u({ id: 30, email: 'twin@uni.dk', full_name: 'Twin', admin_of: [{ id: 4, name: 'Algebra' }, { id: 5, name: 'Algebra' }] });
  routes['GET /users'] = () => [200, page([twin])];
  await render();
  expect(row('twin@uni.dk').querySelector<HTMLElement>('.chip')?.title).toBe('- Algebra\n- Algebra');
});

it('a disabled account\'s row is greyed and says Disabled to a screen reader, with no Disabled chip (D14 rev 8)', async () => {
  await render();
  const ole = row('old@uni.dk');
  expect(ole.classList.contains('u-disabled')).toBe(true);
  expect(ole.querySelector('.u-name .vh')?.textContent).toBe(' (disabled)');
  expect(ole.querySelector('.u-name')?.textContent?.trim()).toBe('Ole Dahl (disabled)');
  expect([...ole.querySelectorAll('.chip')].map((c) => c.querySelector('.chip-text')?.textContent?.trim())).toEqual(['Teacher (1)']);
  expect(row('aho@uni.dk').querySelector('.u-name .vh')).toBeNull();
  // The Superuser chip has no list.
  expect(row('svk@uni.dk').querySelector<HTMLElement>('.chip')?.hasAttribute('title')).toBe(false);
});

it('the pills show the totals; a pill fetches at once and is pressed (D15a)', async () => {
  await render();
  expect(pill('All').textContent?.replace(/\s+/g, ' ').trim()).toBe('All (42)');
  expect(pill('Students').textContent?.replace(/\s+/g, ' ').trim()).toBe('Students (33)');
  pill('Students').click(); await settle();
  expect(calls.at(-1)).toBe('GET /users?q=&role=students');
  expect(pill('Students').getAttribute('aria-pressed')).toBe('true');
  expect(pill('All').getAttribute('aria-pressed')).toBe('false');
});

it('typing fires one search after a 250 ms pause, with the pill (D15a)', async () => {
  vi.useFakeTimers();
  await render();
  pill('Teachers').click(); await settle();
  const before = gets();
  type(search(), 'a'); type(search(), 'an'); type(search(), ' ann ');
  await vi.advanceTimersByTimeAsync(200); await settle();
  expect(gets()).toBe(before);
  await vi.advanceTimersByTimeAsync(60); await settle();
  expect(gets()).toBe(before + 1);
  expect(calls.at(-1)).toBe('GET /users?q=ann&role=teachers');
});

it('a slower, older reply that arrives after a newer one is ignored (D15a)', async () => {
  vi.useFakeTimers();
  let releaseOld: () => void = () => {};
  routes['GET /users'] = (_b, p) => {
    if (p.get('q') === 'a') return new Promise((res) => { releaseOld = () => res([200, page([OLE], 1)]); });
    if (p.get('q') === 'an') return [200, page([ANNA], 1)];
    return [200, page()];
  };
  await render();
  type(search(), 'a');
  await vi.advanceTimersByTimeAsync(260); await settle();
  type(search(), 'an');
  await vi.advanceTimersByTimeAsync(260); await settle();
  releaseOld(); await settle();
  expect(rows().map((r) => r.querySelector('.u-email')?.textContent?.trim())).toEqual(['aho@uni.dk']);
});

it('the line under the table follows the list as fetched (D15)', async () => {
  vi.useFakeTimers();
  const twenty = Array.from({ length: 20 }, (_, i) => u({ id: 100 + i, email: `s${i}@uni.dk` }));
  routes['GET /users'] = (_b, p) => [200, p.get('q') ? page(twenty.slice(0, 5), 5) : page(twenty, 42)];
  await render();
  expect(countLine()).toBe('Showing the 20 newest of 42 accounts. Search to find others.');
  type(search(), 's1');
  expect(countLine()).toBe('Showing the 20 newest of 42 accounts. Search to find others.');
  await vi.advanceTimersByTimeAsync(260); await settle();
  expect(countLine()).toBe('5 match');
});

it('an empty pill shows no table, only its line', async () => {
  routes['GET /users'] = (_b, p) => [200, p.get('role') === 'disabled' ? page([], 0) : page()];
  await render();
  pill('Disabled').click(); await settle();
  expect(target.querySelector('table')).toBeNull();
  expect(countLine()).toBe('No disabled accounts');
});

it('row actions: a superuser has only Edit; Disable or Enable by state; the trash only without data (D20, D21)', async () => {
  await render();
  expect(actions(row('svk@uni.dk'))).toEqual(['edit']);
  expect(actions(row('aho@uni.dk'))).toEqual(['edit', 'disable']);
  expect(actions(row('old@uni.dk'))).toEqual(['edit', 'enable']);
  expect(actions(row('new.colleague@uni.dk'))).toEqual(['edit', 'disable', 'delete']);
  expect(act(row('aho@uni.dk'), 'disable')?.getAttribute('aria-label')).toBe('Disable Anna Holm');
  expect(rows().every((r) => [...r.querySelectorAll('td')].slice(0, -1).every((td) => td.querySelector('button') === null))).toBe(true);
});

it('Disable asks in a strip under the row with what the person loses; confirming disables and reloads (D18)', async () => {
  routes['POST /users/9/disable'] = () => [200, { ...ANNA, is_disabled: true }];
  await render();
  act(row('aho@uni.dk'), 'disable')!.click(); await settle();
  const strip = row('aho@uni.dk').nextElementSibling as HTMLElement;
  expect(strip.classList.contains('u-confirm')).toBe(true);
  expect(strip.querySelector('td')?.getAttribute('colspan')).toBe('5');
  expect(strip.textContent).toContain("Disable Anna Holm? Anna Holm is the admin of Statistics 101 and teaches 2 runs. They'll be signed out and can't sign in until enabled; tell them yourself.");
  expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
  strip.querySelector<HTMLButtonElement>('[data-action="confirm-disable"]')!.click(); await settle();
  expect(calls).toContain('POST /users/9/disable');
  expect(target.querySelector('.u-confirm')).toBeNull();
  expect(gets()).toBe(2);
});

it('Cancel closes the strip and returns focus to its button', async () => {
  await render();
  const btn = act(row('aho@uni.dk'), 'disable')!;
  btn.click(); await settle();
  const strip = target.querySelector<HTMLElement>('.u-confirm')!;
  [...strip.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancel')!.click(); await settle();
  expect(target.querySelector('.u-confirm')).toBeNull();
  expect(document.activeElement).toBe(act(row('aho@uni.dk'), 'disable'));
});

it('Enable asks in a strip too, then enables and reloads', async () => {
  routes['POST /users/7/enable'] = () => [200, { ...OLE, is_disabled: false }];
  await render();
  act(row('old@uni.dk'), 'enable')!.click(); await settle();
  const strip = target.querySelector<HTMLElement>('.u-confirm')!;
  expect(strip.textContent).toContain('Enable Ole Dahl? They can sign in again.');
  strip.querySelector<HTMLButtonElement>('[data-action="confirm-enable"]')!.click(); await settle();
  expect(calls).toContain('POST /users/7/enable');
  expect(gets()).toBe(2);
});

it('Delete asks in a strip, then deletes and reloads (D20)', async () => {
  routes['DELETE /users/12'] = () => [204, null];
  await render();
  act(row('new.colleague@uni.dk'), 'delete')!.click(); await settle();
  const strip = target.querySelector<HTMLElement>('.u-confirm')!;
  expect(strip.textContent).toContain("Delete new.colleague@uni.dk? This can't be undone.");
  strip.querySelector<HTMLButtonElement>('[data-action="confirm-delete"]')!.click(); await settle();
  expect(calls).toContain('DELETE /users/12');
  expect(target.querySelector('.u-confirm')).toBeNull();
  expect(gets()).toBe(2);
});

it("a 409 in a strip closes it, shows the server's sentence as an error note and reloads (D25)", async () => {
  routes['DELETE /users/12'] = () => [409, { detail: 'This account has data now and can only be disabled' }];
  await render();
  act(row('new.colleague@uni.dk'), 'delete')!.click(); await settle();
  target.querySelector<HTMLButtonElement>('[data-action="confirm-delete"]')!.click(); await settle();
  expect(target.querySelector('.u-confirm')).toBeNull();
  expect(note()?.getAttribute('role')).toBe('alert');
  expect(note()?.textContent?.trim()).toBe('This account has data now and can only be disabled');
  expect(gets()).toBe(2);
});

it('Edit opens one dialog; a saved change closes it and reloads (D19, D24)', async () => {
  let sent: unknown;
  routes['PATCH /users/9'] = (b) => { sent = b; return [200, { ...ANNA, email: 'anna@uni.dk' }]; };
  await render();
  act(row('aho@uni.dk'), 'edit')!.click(); await settle();
  expect(document.getElementById(panel()!.getAttribute('aria-labelledby')!)?.textContent).toBe('Edit account');
  type(field('Email'), 'anna@uni.dk');
  footButton('Save').click(); await settle();
  expect(sent).toEqual({ email: 'anna@uni.dk' });
  expect(panel()).toBeNull();
  expect(gets()).toBe(2);
});

it('a 409 on Edit keeps the dialog open and reloads the list behind it', async () => {
  routes['PATCH /users/9'] = () => [409, { detail: 'An account with this email already exists' }];
  await render();
  act(row('aho@uni.dk'), 'edit')!.click(); await settle();
  type(field('Email'), 'old@uni.dk');
  footButton('Save').click(); await settle();
  expect(panel()!.querySelector('[role="alert"]')?.textContent?.trim()).toBe('An account with this email already exists');
  expect(gets()).toBe(2);
});

it('New account creates, closes, reloads and says no email was sent, with the email as stored (D17)', async () => {
  let sent: unknown;
  routes['POST /users'] = (b) => { sent = b; return [201, NEW]; };
  await render();
  target.querySelector<HTMLButtonElement>('.panel-head button')!.click(); await settle();
  type(field('Email'), 'New.Colleague@uni.dk');
  footButton('Create').click(); await settle();
  expect(sent).toEqual({ email: 'New.Colleague@uni.dk', full_name: null });
  expect(panel()).toBeNull();
  expect(gets()).toBe(2);
  expect(note()?.getAttribute('role')).toBe('status');
  expect(note()?.textContent?.trim()).toBe('The account for new.colleague@uni.dk is created. No email was sent.');
});

it('a 404 hands the expired link to the shell', async () => {
  routes['GET /users'] = () => [404, { detail: 'Not Found' }];
  await render();
  expect(onAuth).toHaveBeenCalledWith('expired');
});

it('a load error that is not the guard shows the error with a retry', async () => {
  routes['GET /users'] = () => [500, { detail: 'Internal Server Error' }];
  await render();
  expect(target.textContent).toContain('Could not load accounts.');
  routes['GET /users'] = () => [200, page()];
  [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Try again')!.click(); await settle();
  expect(rows()).toHaveLength(4);
});
