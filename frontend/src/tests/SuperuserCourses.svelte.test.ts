import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SuperuserCourses from '../pages/superuser/SuperuserCourses.svelte';
import type { PanelAdmin, PanelCourse, AdminAssignResult } from '../lib/superuser';
import { SetupStore } from '../lib/setupStore.svelte';
import type { PanelSetup } from '../lib/setup';
import { session } from '../stores/session.svelte';

async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
function jsonResponse(status: number, body: unknown) {
  return status === 204 ? new Response(null, { status })
    : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const ANNA: PanelAdmin = { id: 9, email: 'aho@uni.dk', full_name: 'Anna Holm', is_disabled: false };
const OFF: PanelAdmin = { id: 8, email: 'off@x', full_name: null, is_disabled: true };
function courses(): PanelCourse[] {
  return [
    { id: 1, name: 'Statistics 101', slug: 'stat', admin: ANNA, version_count: 2, run_count: 2, student_count: 37 },
    { id: 2, name: 'Chemometrics', slug: 'chem', admin: null, version_count: 1, run_count: 0, student_count: 0 },
    { id: 3, name: 'Algebra', slug: 'alg', admin: OFF, version_count: 1, run_count: 1, student_count: 1 },
  ];
}
function assigned(course: PanelCourse, admin_email: AdminAssignResult['admin_email'], admin = ANNA): AdminAssignResult {
  return { course, admin, admin_email, pin_minutes: 10, sign_in_url: `http://m.test/courses/${course.slug}/edit` };
}

type Handler = (body: unknown) => [number, unknown] | Promise<[number, unknown]>;
let routes: Record<string, Handler>;
let calls: string[];
let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
let onAuth: ReturnType<typeof vi.fn>;
let setup: SetupStore | null = null;

beforeEach(() => {
  setupState = null;
  calls = [];
  routes = { 'GET /courses': () => [200, courses()] };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url).replace('/api/superuser/T', '')}`;
    calls.push(key);
    const h = routes[key];
    if (!h) return jsonResponse(500, { detail: `no route ${key}` });
    const [status, body] = await h(init?.body ? JSON.parse(String(init.body)) : undefined);
    return jsonResponse(status, body);
  }));
});
afterEach(() => {
  if (cmp) unmount(cmp); cmp = null; target?.remove();
  setup?.dispose(); setup = null;
  session.user = null;
  document.documentElement.style.overflow = '';
  vi.useRealTimers(); vi.restoreAllMocks();
});

let setupState: PanelSetup | null = null;
async function render() {
  target = document.createElement('div');
  document.body.appendChild(target);
  onAuth = vi.fn();
  setup = new SetupStore('T', onAuth);
  if (setupState) setup.state = setupState;
  cmp = mount(SuperuserCourses, { target, props: { token: 'T', onAuth, setup } });
  await settle();
}
const rows = () => [...target.querySelectorAll<HTMLTableRowElement>('tbody tr.c-row')];
const row = (name: string) => rows().find((r) => r.querySelector('.c-name')?.textContent?.trim() === name)!;
const act = (r: HTMLElement, action: string) => r.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
const panel = () => document.querySelector<HTMLElement>('section.modal-panel');
const footButton = (label: string) => [...panel()!.querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === label)!;
const note = () => target.querySelector<HTMLElement>('.note-strip');
const gets = () => calls.filter((c) => c === 'GET /courses').length;
function type(el: HTMLInputElement, v: string) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }
const panelInput = (label?: string) => {
  const all = [...panel()!.querySelectorAll<HTMLInputElement>('input')];
  return label ? all.find((i) => i.labels?.[0]?.textContent?.trim() === label)! : all[0];
};

it('has the Courses heading with New course beside it', async () => {
  await render();
  const head = target.querySelector('.panel-head')!;
  expect(head.querySelector('h1')?.textContent).toBe('Courses');
  expect([...head.querySelectorAll('button')].map((b) => b.textContent!.trim())).toEqual(['New course']);
});

it('lists the courses as the API sends them; names are plain text, never links (D7)', async () => {
  await render();
  expect(rows().map((r) => r.querySelector('.c-name')?.textContent?.trim())).toEqual(['Statistics 101', 'Chemometrics', 'Algebra']);
  expect(target.querySelectorAll('table a')).toHaveLength(0);
  const stat = row('Statistics 101');
  expect(stat.querySelector('.c-slug')?.textContent?.trim()).toBe('stat');
  expect(stat.querySelector('.c-admin-name')?.textContent?.trim()).toBe('Anna Holm');
  expect(stat.querySelector('.c-admin-email')?.textContent?.trim()).toBe('aho@uni.dk');
  expect([...stat.querySelectorAll('td.num')].map((t) => t.textContent?.trim())).toEqual(['2', '2']);
  expect(row('Chemometrics').querySelector('.c-none')?.textContent?.trim()).toBe('No admin');
  const alg = row('Algebra');
  expect(alg.querySelector('.c-admin-name')?.textContent?.trim()).toBe('off@x');
  expect(alg.querySelector('.c-admin-email')).toBeNull();
  expect(alg.querySelector('.chip-disabled')?.textContent?.trim()).toBe('disabled');
  expect(target.querySelectorAll('thead th')).toHaveLength(6);
});

it('says so when there are no courses yet', async () => {
  routes['GET /courses'] = () => [200, []];
  await render();
  expect(target.textContent).toContain('No courses yet.');
  expect(target.querySelector('table')).toBeNull();
});

it.each([
  ['queued', 'Statistics 101 is created; Anna Holm is its admin. An email with a link to the course is on its way to aho@uni.dk.'],
  ['email_off', "Statistics 101 is created; Anna Holm is its admin. Email isn't set up on this server, so tell them yourself. They sign in at http://m.test/courses/stat/edit with a PIN: run mathion pin aho@uni.dk on the server (the PIN lasts 10 minutes)."],
  ['disabled', 'Statistics 101 is created; Anna Holm is its admin. No email sent: this account is disabled. Enable it on the Users page so they can sign in.'],
  ['unchanged', 'They are already the admin; nothing changed.'],
] as const)('New course: a 201 closes the dialog, reloads the list and shows the %s note (D5a)', async (outcome, text) => {
  let sent: unknown;
  routes['POST /courses'] = (b) => { sent = b; return [201, assigned(courses()[0], outcome)]; };
  routes['POST /accounts/lookup'] = () => [200, { status: 'existing', full_name: 'Anna Holm' }];
  await render();
  target.querySelector<HTMLButtonElement>('.panel-head button')!.click(); await settle();
  type(panelInput('Course name'), 'Statistics 101');
  type(panelInput("Admin's email"), 'aho@uni.dk');
  footButton('Create').click(); await settle();
  expect(sent).toEqual({ name: 'Statistics 101', slug: 'statistics-101', admin_email: 'aho@uni.dk' });
  expect(panel()).toBeNull();
  expect(gets()).toBe(2);
  expect(note()?.getAttribute('role')).toBe('status');
  expect(note()?.textContent?.trim()).toBe(text);
});

it('the email-off note shows the command as code', async () => {
  routes['POST /courses'] = () => [201, assigned(courses()[0], 'email_off')];
  routes['POST /accounts/lookup'] = () => [200, { status: 'existing', full_name: 'Anna Holm' }];
  await render();
  target.querySelector<HTMLButtonElement>('.panel-head button')!.click(); await settle();
  type(panelInput('Course name'), 'Statistics 101');
  type(panelInput("Admin's email"), 'aho@uni.dk');
  footButton('Create').click(); await settle();
  expect(note()?.querySelector('code')?.textContent).toBe('mathion pin aho@uni.dk');
});

it('cells are plain text; a row has only Edit and the trash, in its last cell (D24)', async () => {
  await render();
  for (const r of rows()) {
    const cells = [...r.querySelectorAll('td')];
    expect(cells.slice(0, -1).every((td) => td.querySelector('button') === null)).toBe(true);
    expect([...cells.at(-1)!.querySelectorAll('button')].map((b) => b.dataset.action)).toEqual(['edit', 'delete']);
  }
  expect(act(row('Statistics 101'), 'edit').getAttribute('aria-label')).toBe('Edit Statistics 101');
});

it('opening and cancelling a dialog keeps the note; a successful edit replaces it (D5a)', async () => {
  routes['POST /courses'] = () => [201, assigned(courses()[0], 'email_off')];
  routes['POST /accounts/lookup'] = () => [200, { status: 'existing', full_name: 'Anna Holm' }];
  routes['PATCH /courses/1'] = () => [200, { ...courses()[0], name: 'Statistics 102' }];
  await render();
  target.querySelector<HTMLButtonElement>('.panel-head button')!.click(); await settle();
  type(panelInput('Course name'), 'Statistics 101');
  type(panelInput("Admin's email"), 'aho@uni.dk');
  footButton('Create').click(); await settle();
  expect(note()?.querySelector('code')?.textContent).toBe('mathion pin aho@uni.dk');
  act(row('Statistics 101'), 'edit').click(); await settle();
  footButton('Cancel').click(); await settle();
  act(row('Chemometrics'), 'delete').click(); await settle();
  footButton('Cancel').click(); await settle();
  expect(note()?.querySelector('code')?.textContent).toBe('mathion pin aho@uni.dk');
  act(row('Statistics 101'), 'edit').click(); await settle();
  type(panelInput('Course name'), 'Statistics 102');
  footButton('Save').click(); await settle();
  expect(note()).toBeNull();
});

it('Edit opens one dialog; saving a new name sends it, closes and reloads with no note', async () => {
  let sent: unknown;
  routes['PATCH /courses/1'] = (b) => { sent = b; return [200, { ...courses()[0], name: 'Statistics 102' }]; };
  await render();
  act(row('Statistics 101'), 'edit').click(); await settle();
  expect(document.getElementById(panel()!.getAttribute('aria-labelledby')!)?.textContent).toBe('Edit course');
  type(panelInput('Course name'), 'Statistics 102');
  footButton('Save').click(); await settle();
  expect(sent).toEqual({ name: 'Statistics 102' });
  expect(panel()).toBeNull();
  expect(gets()).toBe(2);
  expect(note()).toBeNull();
});

it('a 409 keeps the dialog open with the server sentence and reloads the list behind it (D25)', async () => {
  routes['PATCH /courses/1'] = () => [409, { detail: 'This address is already used by another course' }];
  await render();
  act(row('Statistics 101'), 'edit').click(); await settle();
  type(panelInput('Address'), 'chem');
  footButton('Save').click(); await settle();
  expect(panel()!.querySelector('[role="alert"]')?.textContent?.trim()).toBe('This address is already used by another course');
  expect(panelInput('Address').value).toBe('chem');
  expect(gets()).toBe(2);
});

it('a new email assigns the admin and the result note follows (D5a, D9)', async () => {
  let sent: unknown;
  routes['POST /accounts/lookup'] = () => [200, { status: 'new', full_name: null }];
  routes['PUT /courses/2/admin'] = (b) => { sent = b; return [200, assigned(courses()[1], 'queued', { ...ANNA, email: 'new@x', full_name: null })]; };
  await render();
  act(row('Chemometrics'), 'edit').click(); await settle();
  expect(panelInput("Admin's email").value).toBe('');
  type(panelInput("Admin's email"), 'new@x');
  footButton('Save').click(); await settle();
  expect(sent).toEqual({ email: 'new@x' });
  expect(panel()).toBeNull();
  expect(gets()).toBe(2);
  expect(note()?.textContent?.trim()).toBe('new@x is now the admin of Chemometrics. An email with a link to the course is on its way to new@x.');
});

it('the same admin retyped in another case is no change: Save stays off and nothing is sent (rev 11)', async () => {
  routes['POST /accounts/lookup'] = () => [200, { status: 'existing', full_name: 'Anna Holm' }];
  await render();
  act(row('Statistics 101'), 'edit').click(); await settle();
  type(panelInput("Admin's email"), 'AHO@uni.dk');
  expect(footButton('Save').getAttribute('aria-disabled')).toBe('true');
  expect(panel()!.textContent).not.toContain('will no longer be the admin');
  footButton('Save').click(); await settle();
  expect(calls.some((c) => c.startsWith('PUT '))).toBe(false);
});

it('typing another admin says who stops being the admin (rev 11)', async () => {
  routes['POST /accounts/lookup'] = () => [200, { status: 'new', full_name: null }];
  await render();
  act(row('Statistics 101'), 'edit').click(); await settle();
  expect(panel()!.textContent).not.toContain('will no longer be the admin');
  type(panelInput("Admin's email"), 'bo@school.dk');
  expect(panel()!.textContent).toContain('Anna Holm will no longer be the admin.');
  type(panelInput("Admin's email"), '');
  expect(panel()!.textContent).not.toContain('will no longer be the admin');
});

it("an admin with no name is named by email in that line (rev 11)", async () => {
  routes['POST /accounts/lookup'] = () => [200, { status: 'new', full_name: null }];
  await render();
  act(row('Algebra'), 'edit').click(); await settle();
  type(panelInput("Admin's email"), 'bo@school.dk');
  expect(panel()!.textContent).toContain('off@x will no longer be the admin.');
});

it('the no-admin line uses the name being typed (rev 11)', async () => {
  await render();
  act(row('Statistics 101'), 'edit').click(); await settle();
  type(panelInput('Course name'), 'Statistics 102');
  type(panelInput("Admin's email"), '');
  expect(panel()!.textContent).toContain('Statistics 102 will have no admin.');
});

it('clearing the email removes the admin and reloads (D9)', async () => {
  routes['DELETE /courses/1/admin'] = () => [204, null];
  await render();
  act(row('Statistics 101'), 'edit').click(); await settle();
  type(panelInput("Admin's email"), '');
  expect(panel()!.textContent).toContain('Statistics 101 will have no admin.');
  footButton('Save').click(); await settle();
  expect(calls).toContain('DELETE /courses/1/admin');
  expect(panel()).toBeNull();
  expect(gets()).toBe(2);
});

it('a refused removal keeps the dialog with the sentence and reloads the list', async () => {
  routes['DELETE /courses/1/admin'] = () => [409, { detail: 'This course was deleted' }];
  await render();
  act(row('Statistics 101'), 'edit').click(); await settle();
  type(panelInput("Admin's email"), '');
  footButton('Save').click(); await settle();
  expect(panel()!.querySelector('[role="alert"]')?.textContent?.trim()).toBe('This course was deleted');
  expect(gets()).toBe(2);
});

it('name and admin in one Save: the PATCH goes first, then the PUT, then one note', async () => {
  routes['POST /accounts/lookup'] = () => [200, { status: 'existing', full_name: 'Anna Holm' }];
  routes['PATCH /courses/2'] = () => [200, { ...courses()[1], name: 'Chemo' }];
  routes['PUT /courses/2/admin'] = () => [200, assigned({ ...courses()[1], name: 'Chemo' }, 'queued')];
  await render();
  act(row('Chemometrics'), 'edit').click(); await settle();
  type(panelInput('Course name'), 'Chemo');
  type(panelInput("Admin's email"), 'aho@uni.dk');
  footButton('Save').click(); await settle(); await settle();
  // No state in this test, so the note reads it first (Set up D8).
  expect(calls.filter((c) => c !== 'GET /courses' && c !== 'POST /accounts/lookup')).toEqual(['PATCH /courses/2', 'PUT /courses/2/admin', 'GET /setup']);
  expect(note()?.textContent?.trim()).toBe('Anna Holm is now the admin of Chemo. An email with a link to the course is on its way to aho@uni.dk.');
});

it("with runs the trash is blocked and says why, and opens nothing (D12)", async () => {
  await render();
  const trash = act(row('Statistics 101'), 'delete');
  expect(trash.getAttribute('aria-disabled')).toBe('true');
  expect(trash.getAttribute('title')).toBe("2 runs: can't be deleted");
  expect(act(row('Algebra'), 'delete').getAttribute('title')).toBe("1 run: can't be deleted");
  trash.click(); await settle();
  expect(panel()).toBeNull();
});

it('without runs the trash opens the delete dialog; deleting closes it and reloads', async () => {
  routes['GET /courses/2/delete-impact'] = () => [200, { progress_students: 0 }];
  routes['DELETE /courses/2'] = () => [204, null];
  await render();
  const trash = act(row('Chemometrics'), 'delete');
  expect(trash.getAttribute('aria-disabled')).toBeNull();
  expect(trash.getAttribute('title')).toBe('Delete');
  trash.click(); await settle();
  type(panelInput(), 'Chemometrics');
  footButton('Delete course').click(); await settle();
  expect(calls).toContain('DELETE /courses/2');
  expect(panel()).toBeNull();
  expect(gets()).toBe(2);
});

it('a 404 on any call hands the expired link to the shell', async () => {
  routes['GET /courses'] = () => [404, { detail: 'Not Found' }];
  await render();
  expect(onAuth).toHaveBeenCalledWith('expired');
});

it('a load error that is not the guard shows the error with a retry', async () => {
  routes['GET /courses'] = () => [500, { detail: 'Internal Server Error' }];
  await render();
  expect(target.textContent).toContain('Could not load courses.');
  routes['GET /courses'] = () => [200, courses()];
  [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Try again')!.click(); await settle();
  expect(rows()).toHaveLength(3);
});

it('the next note replaces the last one as a fresh element, so it is announced', async () => {
  routes['POST /accounts/lookup'] = () => [200, { status: 'existing', full_name: 'Anna Holm' }];
  routes['PUT /courses/1/admin'] = () => [200, assigned(courses()[0], 'unchanged')];
  await render();
  async function sameAdmin(email: string) {
    act(row('Statistics 101'), 'edit').click(); await settle();
    type(panelInput("Admin's email"), email);
    footButton('Save').click(); await settle();
  }
  // Two different addresses, so each is a change (a case-only retype isn't, rev 11).
  await sameAdmin('bo@uni.dk');
  const first = note();
  await sameAdmin('cy@uni.dk');
  expect(note()).not.toBe(first);
  expect(target.querySelectorAll('.note-strip')).toHaveLength(1);
  note()!.querySelector<HTMLButtonElement>('button[data-glyph="close"]')!.click(); await settle();
  expect(note()).toBeNull();
});

// --- Set up D8: the note when the admin is you, and Email's reason ---

function stateWithEmail(done: boolean): PanelSetup {
  return {
    wizard_on: false, step: 1,
    steps: [0, 1, 2, 3].map((i) => ({ passed: true, done: i > 0 || done, reason: i === 0 && !done ? 'Not tested yet: send a test email.' : null })),
    course: null, course_without_admin: null, email_set_up: true, pin_minutes: 10, defaults_in_use: false,
  };
}
function signIn(email: string) {
  session.user = {
    id: 1, email, full_name: 'Sam Admin', is_superuser: true, is_disabled: false,
    photo_url: null, has_course_admin: false, has_run_teacher: false,
  };
}
async function createVia(outcome: AdminAssignResult['admin_email'], admin = ANNA) {
  routes['POST /courses'] = () => [201, assigned(courses()[0], outcome, admin)];
  routes['POST /accounts/lookup'] = () => [200, { status: admin.is_disabled ? 'disabled' : 'existing', full_name: admin.full_name }];
  await render();
  target.querySelector<HTMLButtonElement>('.panel-head button')!.click(); await settle();
  type(panelInput('Course name'), 'Statistics 101');
  type(panelInput("Admin's email"), 'aho@uni.dk');
  footButton('Create').click(); await settle();
}

it('New course with yourself as admin: "you are its admin", no command (compared lower-cased)', async () => {
  signIn('AHO@uni.dk');
  await createVia('email_off');
  expect(note()?.textContent?.trim()).toBe(
    "Statistics 101 is created; you are its admin. You'll find it on the Courses page of the main site.");
  expect(note()?.querySelector('code')).toBeNull();
});

it("a queued note adds Email's reason while the Email step isn't done", async () => {
  setupState = stateWithEmail(false);
  await createVia('queued');
  expect(note()?.textContent?.trim()).toBe(
    'Statistics 101 is created; Anna Holm is its admin. An email with a link to the course is on its way to aho@uni.dk. '
    + 'Not tested yet: send a test email.');
});

it('the Edit dialog assigning yourself: "You are now the admin", no command', async () => {
  signIn('AHO@uni.dk');
  routes['POST /accounts/lookup'] = () => [200, { status: 'existing', full_name: 'Anna Holm' }];
  routes['PUT /courses/2/admin'] = () => [200, assigned(courses()[1], 'email_off')];
  await render();
  act(row('Chemometrics'), 'edit').click(); await settle();
  type(panelInput("Admin's email"), 'aho@uni.dk');
  footButton('Save').click(); await settle();
  expect(note()?.textContent?.trim()).toBe(
    "You are now the admin of Chemometrics. You'll find it on the Courses page of the main site.");
  expect(note()?.querySelector('code')).toBeNull();
});

it("with no state yet, the note reads it first and adds Email's reason (Set up D8)", async () => {
  routes['GET /setup'] = () => [200, stateWithEmail(false)];
  await createVia('queued');
  expect(calls.filter((c) => c === 'GET /setup')).toHaveLength(1);
  expect(note()?.textContent?.trim()).toBe(
    'Statistics 101 is created; Anna Holm is its admin. An email with a link to the course is on its way to aho@uni.dk. '
    + 'Not tested yet: send a test email.');
});

it('a note still waiting on that read never lands over a later action', async () => {
  routes['GET /setup'] = () => [200, stateWithEmail(false)];
  routes['PATCH /courses/2'] = () => [200, { ...courses()[1], name: 'Chemo' }];
  const routed = globalThis.fetch;
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/setup')) await held;
    return routed(url, init);
  }));
  await createVia('queued');
  expect(note()).toBeNull();                       // waiting on the state read
  act(row('Chemometrics'), 'edit').click(); await settle();
  type(panelInput('Course name'), 'Chemo');
  footButton('Save').click(); await settle();     // a rename clears the note
  release(); await settle(); await settle();
  expect(note()).toBeNull();
});

it('with no state and a failed read, the note still shows, without a reason', async () => {
  routes['GET /setup'] = () => [500, { detail: 'Boom.' }];
  await createVia('queued');
  expect(note()?.textContent?.trim()).toBe(
    'Statistics 101 is created; Anna Holm is its admin. An email with a link to the course is on its way to aho@uni.dk.');
});

it('no reason once the Email step is done', async () => {
  setupState = stateWithEmail(true);
  await createVia('queued');
  expect(note()?.textContent?.trim()).toBe(
    'Statistics 101 is created; Anna Holm is its admin. An email with a link to the course is on its way to aho@uni.dk.');
  expect(calls).not.toContain('GET /setup');
});

it.each([['email_off', ANNA], ['disabled', { ...ANNA, is_disabled: true }]] as const)(
  'with no state, the %s note has no place for the reason: it shows at once, with no read', async (outcome, admin) => {
    await createVia(outcome, admin);
    expect(note()).not.toBeNull();
    expect(calls).not.toContain('GET /setup');
  });

it('with no state, a queued note naming yourself shows at once, with no read', async () => {
  signIn('AHO@uni.dk');
  await createVia('queued');
  expect(note()?.textContent?.trim()).toBe(
    "Statistics 101 is created; you are its admin. You'll find it on the Courses page of the main site.");
  expect(calls).not.toContain('GET /setup');
});

it('closing the last note does not cancel a newer one still waiting on the read', async () => {
  routes['GET /setup'] = () => [200, stateWithEmail(false)];
  routes['PUT /courses/2/admin'] = () => [200, assigned(courses()[1], 'queued')];
  const routed = globalThis.fetch;
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/setup')) await held;
    return routed(url, init);
  }));
  await createVia('email_off');                    // shows at once: no reason to wait for
  expect(note()).not.toBeNull();
  act(row('Chemometrics'), 'edit').click(); await settle();
  type(panelInput("Admin's email"), 'aho@uni.dk');
  footButton('Save').click(); await settle();     // queued: waits on the read
  note()!.querySelector<HTMLButtonElement>('button[data-glyph="close"]')!.click(); await settle();
  expect(note()).toBeNull();
  release(); await settle(); await settle();
  expect(note()?.textContent?.trim()).toBe(
    'Anna Holm is now the admin of Chemometrics. An email with a link to the course is on its way to aho@uni.dk. '
    + 'Not tested yet: send a test email.');
});

it('quiet reloads keep only the newest reply (rev 11)', async () => {
  await render();
  let releaseOld!: () => void;
  const old = courses();
  routes['GET /courses'] = () => new Promise((r) => { releaseOld = () => r([200, old]); });
  routes['PATCH /courses/1'] = () => [200, { ...courses()[0], name: 'Statistics 102' }];
  act(row('Statistics 101'), 'edit').click(); await settle();
  type(panelInput('Course name'), 'Statistics 102');
  footButton('Save').click(); await settle();
  const fresh = courses(); fresh[0] = { ...fresh[0], name: 'Statistics 102' };
  routes['GET /courses'] = () => [200, fresh];
  routes['PATCH /courses/2'] = () => [200, { ...courses()[1], name: 'Chemo' }];
  act(row('Chemometrics'), 'edit').click(); await settle();
  type(panelInput('Course name'), 'Chemo');
  footButton('Save').click(); await settle();
  expect(row('Statistics 102')).toBeTruthy();
  releaseOld(); await settle();
  expect(row('Statistics 102')).toBeTruthy();
  expect(row('Statistics 101')).toBeUndefined();
});

it('a first load that fails after a newer reload came back keeps the newer list (rev 11)', async () => {
  let failFirst!: () => void;
  routes['GET /courses'] = () => new Promise((r) => { failFirst = () => r([500, { detail: 'Server error' }]); });
  routes['POST /courses'] = () => [201, assigned(courses()[0], 'email_off')];
  routes['POST /accounts/lookup'] = () => [200, { status: 'existing', full_name: 'Anna Holm' }];
  await render();
  routes['GET /courses'] = () => [200, courses()];
  target.querySelector<HTMLButtonElement>('.panel-head button')!.click(); await settle();
  type(panelInput('Course name'), 'Statistics 101');
  type(panelInput("Admin's email"), 'aho@uni.dk');
  footButton('Create').click(); await settle();
  expect(row('Statistics 101')).toBeTruthy();
  failFirst(); await settle();
  expect(row('Statistics 101')).toBeTruthy();
  expect(target.textContent).not.toContain('Could not load');
});

it('a failed quiet reload with no list on screen yet shows the error, not "No courses yet" (D25, rev 13)', async () => {
  let first!: () => void;
  const list = courses();
  routes['GET /courses'] = () => new Promise((r) => { first = () => r([200, list]); });
  routes['POST /courses'] = () => [201, assigned(courses()[0], 'email_off')];
  routes['POST /accounts/lookup'] = () => [200, { status: 'existing', full_name: 'Anna Holm' }];
  await render();
  routes['GET /courses'] = () => [500, { detail: 'Internal Server Error' }];
  target.querySelector<HTMLButtonElement>('.panel-head button')!.click(); await settle();
  type(panelInput('Course name'), 'Statistics 101');
  type(panelInput("Admin's email"), 'aho@uni.dk');
  footButton('Create').click(); await settle();
  first(); await settle();   // the older first load answers late; it is dropped
  expect(target.textContent).toContain('Could not load courses.');
  expect(target.textContent).not.toContain('No courses yet');
});

it('a failed quiet reload after Edit keeps the table on screen, even a one-row one (D25, rev 13)', async () => {
  routes['GET /courses'] = () => [200, [courses()[0]]];
  routes['PATCH /courses/1'] = () => [200, { ...courses()[0], name: 'Statistics 102' }];
  await render();
  routes['GET /courses'] = () => [500, { detail: 'Internal Server Error' }];
  act(row('Statistics 101'), 'edit').click(); await settle();
  type(panelInput('Course name'), 'Statistics 102');
  footButton('Save').click(); await settle();
  expect(rows()).toHaveLength(1);
  expect(target.textContent).not.toContain('Could not load');
});

it('a deleted course leaves the table even when the reload after it fails (D25, rev 13)', async () => {
  routes['GET /courses/2/delete-impact'] = () => [200, { progress_students: 0 }];
  routes['DELETE /courses/2'] = () => [204, null];
  await render();
  routes['GET /courses'] = () => [500, { detail: 'Internal Server Error' }];
  act(row('Chemometrics'), 'delete').click(); await settle();
  type(panelInput(), 'Chemometrics');
  footButton('Delete course').click(); await settle();
  expect(row('Chemometrics')).toBeUndefined();
  expect(rows()).toHaveLength(2);
  expect(target.textContent).not.toContain('Could not load');
});

it('a failed delete keeps the course in the table (D25, rev 13)', async () => {
  routes['GET /courses/2/delete-impact'] = () => [200, { progress_students: 0 }];
  routes['DELETE /courses/2'] = () => [500, { detail: 'Internal Server Error' }];
  await render();
  act(row('Chemometrics'), 'delete').click(); await settle();
  type(panelInput(), 'Chemometrics');
  footButton('Delete course').click(); await settle();
  expect(panel()).not.toBeNull();
  footButton('Cancel').click(); await settle();
  expect(row('Chemometrics')).toBeTruthy();
  expect(rows()).toHaveLength(3);
});

it('deleting the last course, then a failed reload, shows the error (D25, rev 13)', async () => {
  routes['GET /courses'] = () => [200, [courses()[1]]];
  routes['GET /courses/2/delete-impact'] = () => [200, { progress_students: 0 }];
  routes['DELETE /courses/2'] = () => [204, null];
  await render();
  routes['GET /courses'] = () => [500, { detail: 'Internal Server Error' }];
  act(row('Chemometrics'), 'delete').click(); await settle();
  type(panelInput(), 'Chemometrics');
  footButton('Delete course').click(); await settle();
  expect(target.querySelector('table')).toBeNull();
  expect(target.textContent).toContain('Could not load courses.');
});

it('a failed quiet reload after the first course on an empty list shows the error, not "No courses yet" (D25, rev 13)', async () => {
  routes['GET /courses'] = () => [200, []];
  routes['POST /courses'] = () => [201, assigned(courses()[0], 'email_off')];
  routes['POST /accounts/lookup'] = () => [200, { status: 'existing', full_name: 'Anna Holm' }];
  await render();
  expect(target.textContent).toContain('No courses yet.');
  routes['GET /courses'] = () => [500, { detail: 'Internal Server Error' }];
  target.querySelector<HTMLButtonElement>('.panel-head button')!.click(); await settle();
  type(panelInput('Course name'), 'Statistics 101');
  type(panelInput("Admin's email"), 'aho@uni.dk');
  footButton('Create').click(); await settle();
  expect(target.textContent).toContain('Could not load courses.');
  expect(target.textContent).not.toContain('No courses yet');
});

it('big counts are grouped in the table and in the trash tooltip (rev 11)', async () => {
  const list = courses(); list[0] = { ...list[0], version_count: 1200, run_count: 4213 };
  routes['GET /courses'] = () => [200, list];
  await render();
  const stat = row('Statistics 101');
  expect([...stat.querySelectorAll('td.num')].map((t) => t.textContent?.trim())).toEqual(['1,200', '4,213']);
  expect(act(stat, 'delete').getAttribute('title')).toBe("4,213 runs: can't be deleted");
});

it('a 409 from the delete-impact lookup reloads the list behind the dialog (rev 11)', async () => {
  routes['GET /courses/2/delete-impact'] = () => [409, { detail: 'This course was deleted' }];
  await render();
  act(row('Chemometrics'), 'delete').click(); await settle();
  expect(panel()!.textContent).toContain('This course was deleted');
  expect(gets()).toBe(2);
});

