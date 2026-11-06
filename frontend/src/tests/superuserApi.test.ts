import { it, expect, vi, afterEach } from 'vitest';
import { ApiError, OFFLINE_MESSAGE } from '../lib/api';
import * as events from '../lib/events';
import {
  panelError, listUsers, assignAdmin, updateUser, deleteCourse, lookupAccount, adminNote,
  countLine, roleChips, disableWarning, getSettings, saveEmail, saveLimits, saveSignIn, testEmail,
  getBranding, saveSiteName, saveImage, checkTheme, saveTheme,
  type AdminAssignResult, type PanelUser, type PanelUserList, type PanelUserRole,
} from '../lib/superuser';

afterEach(() => vi.restoreAllMocks());

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

it('hands the guard 401 and 404 to onAuth and returns null', () => {
  const onAuth = vi.fn();
  expect(panelError(new ApiError(401, 'Not authenticated'), onAuth)).toBeNull();
  expect(onAuth).toHaveBeenLastCalledWith('signin');
  expect(panelError(new ApiError(404, 'Not Found'), onAuth)).toBeNull();
  expect(onAuth).toHaveBeenLastCalledWith('expired');
});

it("shows a 409's server sentence as it is (D25)", () => {
  const onAuth = vi.fn();
  expect(panelError(new ApiError(409, 'This course was deleted'), onAuth)).toBe('This course was deleted');
  expect(onAuth).not.toHaveBeenCalled();
});

it("shows a 422's first sentence without pydantic's prefix (T3 ruling)", () => {
  const err = new ApiError(422, [
    { loc: ['body', 'slug'], msg: 'Value error, An address uses only lowercase letters, digits and single hyphens', type: 'value_error' },
    { loc: ['body', 'name'], msg: 'Value error, Enter a course name', type: 'value_error' },
  ]);
  expect(panelError(err, vi.fn())).toBe('An address uses only lowercase letters, digits and single hyphens');
  // A model-level check has no prefix to strip in some versions; the sentence still shows.
  expect(panelError(new ApiError(422, [{ loc: ['body'], msg: 'Send a name or an email', type: 'value_error' }]), vi.fn()))
    .toBe('Send a name or an email');
});

it('says the server could not be reached for a fetch TypeError', () => {
  expect(panelError(new TypeError('Failed to fetch'), vi.fn())).toBe(OFFLINE_MESSAGE);
});

it('calls the panel routes with the token and never the app-wide 401 redirect', async () => {
  const unauth = vi.spyOn(events, 'emitUnauthorized');
  const f = vi.fn(async (..._a: Parameters<typeof fetch>) => jsonResponse(200, { users: [], total: 0, counts: {} }));
  vi.stubGlobal('fetch', f);
  await listUsers('T', 'a_b %', 'students');
  expect(String(f.mock.calls[0][0])).toBe('/api/superuser/T/users?q=a_b+%25&role=students');

  f.mockImplementation(async () => jsonResponse(200, {}));
  await assignAdmin('T', 7, 'a@x');
  expect(String(f.mock.calls[1][0])).toBe('/api/superuser/T/courses/7/admin');
  expect(f.mock.calls[1][1]?.method).toBe('PUT');
  expect(f.mock.calls[1][1]?.body).toBe(JSON.stringify({ email: 'a@x' }));

  await updateUser('T', 3, { full_name: null });
  expect(f.mock.calls[2][1]?.method).toBe('PATCH');
  expect(f.mock.calls[2][1]?.body).toBe(JSON.stringify({ full_name: null }));

  await lookupAccount('T', 'a@x');
  expect(String(f.mock.calls[3][0])).toBe('/api/superuser/T/accounts/lookup');
  expect(f.mock.calls[3][1]?.method).toBe('POST');

  f.mockImplementation(async () => new Response(null, { status: 401 }));
  await expect(deleteCourse('T', 7)).rejects.toMatchObject({ status: 401 });
  expect(unauth).not.toHaveBeenCalled();
});

// --- adminNote (D5a; Review Focus 4) ---


function result(over: Partial<AdminAssignResult> = {}, admin: Partial<AdminAssignResult['admin']> = {}): AdminAssignResult {
  return {
    course: { id: 1, name: 'Statistics 101', slug: 'stat', admin: null, version_count: 1, run_count: 0, student_count: 0 },
    admin: { id: 9, email: 'aho@uni.dk', full_name: 'Anna Holm', is_disabled: false, ...admin },
    admin_email: 'queued',
    pin_minutes: 10,
    sign_in_url: 'https://m.example/courses/stat/edit',
    ...over,
  };
}

it('queued: the result sentence, then the email is on its way', () => {
  expect(adminNote(result(), 'assign')).toBe(
    'Anna Holm is now the admin of Statistics 101. An email with a sign-in link is on its way to aho@uni.dk.');
  expect(adminNote(result(), 'create')).toBe(
    'Statistics 101 is created; Anna Holm is its admin. An email with a sign-in link is on its way to aho@uni.dk.');
});

it('email off: tell them yourself, with the sign-in address, the pin command and the PIN lifetime', () => {
  expect(adminNote(result({ admin_email: 'email_off' }), 'assign')).toBe(
    "Anna Holm is now the admin of Statistics 101. Email isn't set up on this server, so tell them yourself. "
    + 'They sign in at https://m.example/courses/stat/edit with a PIN: run mathion pin aho@uni.dk on the server '
    + '(the PIN lasts 10 minutes).');
  expect(adminNote(result({ admin_email: 'email_off', pin_minutes: 1 }), 'create')).toContain('(the PIN lasts 1 minute).');
});

it('disabled: no email sent, enable them on the Users page', () => {
  expect(adminNote(result({ admin_email: 'disabled' }, { is_disabled: true }), 'create')).toBe(
    'Statistics 101 is created; Anna Holm is its admin. No email sent: this account is disabled. '
    + 'Enable it on the Users page so they can sign in.');
});

it('unchanged: only that nothing changed, with no result sentence', () => {
  expect(adminNote(result({ admin_email: 'unchanged' }), 'assign')).toBe('They are already the admin; nothing changed.');
});

it('the result sentence falls back to the email for an admin with no name', () => {
  expect(adminNote(result({}, { full_name: null }), 'assign')).toBe(
    'aho@uni.dk is now the admin of Statistics 101. An email with a sign-in link is on its way to aho@uni.dk.');
});

// --- Users page copy (D14, D15, D18) ---

function user(over: Partial<PanelUser> = {}): PanelUser {
  return {
    id: 1, email: 'aho@uni.dk', full_name: 'Anna Holm', is_superuser: false, is_disabled: false,
    created_at: '2026-11-01T10:00:00Z', last_seen_at: null, admin_of: [], teacher_runs: [], student_runs: [],
    has_data: false, ...over,
  };
}
function list(shown: number, total: number): PanelUserList {
  return {
    users: Array.from({ length: shown }, (_, i) => user({ id: i + 1 })), total,
    counts: { all: total, admins: 0, teachers: 0, students: 0, disabled: 0 },
  };
}
const line = (shown: number, total: number, role: PanelUserRole, searching: boolean) => countLine(list(shown, total), role, searching);

it.each([
  [20, 42, 'all', false, 'Showing the 20 newest of 42 accounts. Search to find others.'],
  [20, 33, 'students', false, 'Showing the 20 newest of 33 students. Search to find others.'],
  [12, 12, 'all', false, '12 accounts'],
  [1, 1, 'all', false, '1 account'],
  [1, 1, 'disabled', false, '1 disabled account'],
  [3, 3, 'admins', false, '3 admins'],
  [1, 1, 'teachers', false, '1 teacher'],
  [0, 0, 'disabled', false, 'No disabled accounts'],
  [0, 0, 'admins', false, 'No admins'],
  [0, 0, 'all', false, 'No accounts'],
  [20, 57, 'all', true, '20 of 57 match. Keep typing to narrow.'],
  [5, 5, 'all', true, '5 match'],
  [1, 1, 'teachers', true, '1 match'],
  [0, 0, 'students', true, 'No students match'],
  [0, 0, 'all', true, 'No accounts match'],
  [0, 0, 'disabled', true, 'No disabled accounts match'],
] as const)('countLine(%i shown of %i, %s, searching %s) → %s (D15)', (shown, total, role, searching, text) => {
  expect(line(shown, total, role, searching)).toBe(text);
});

const ref = (id: number, name: string) => ({ id, name });
const run = (id: number, title: string, course_name: string) => ({ id, title, course_name });
const runs = (n: number) => Array.from({ length: n }, (_, i) => run(i + 1, `Run ${i + 1}`, 'Stat'));
it.each([
  ['a superuser', user({ is_superuser: true }), [{ kind: 'su', text: 'Superuser', items: [], tip: '' }]],
  ['the admin of one course', user({ admin_of: [ref(1, 'Statistics 101')] }), [{ kind: 'ad', text: 'Admin (1)', items: ['Statistics 101'], tip: '- Statistics 101' }]],
  ['the admin of three courses', user({ admin_of: [ref(1, 'A'), ref(2, 'B'), ref(3, 'C')] }), [{ kind: 'ad', text: 'Admin (3)', items: ['A', 'B', 'C'], tip: '- A\n- B\n- C' }]],
  ['a teacher of two runs', user({ teacher_runs: [run(1, 'Autumn 2026', 'Statistics 101'), run(2, 'Autumn 2026', 'Algebra')] }),
    [{ kind: 'role', text: 'Teacher (2)', items: ['Statistics 101 · Autumn 2026', 'Algebra · Autumn 2026'],
      tip: '- Statistics 101 · Autumn 2026\n- Algebra · Autumn 2026' }]],
  ['a student of one run', user({ student_runs: [run(3, 'Spring', 'Stat')] }), [{ kind: 'role', text: 'Student (1)', items: ['Stat · Spring'], tip: '- Stat · Spring' }]],
  ['disabled has no chip (D14 rev 8: the row is greyed)', user({ is_disabled: true }), []],
  ['in D14 order', user({ is_disabled: true, student_runs: runs(1), teacher_runs: runs(2), admin_of: [ref(1, 'Stat')], is_superuser: true }),
    ['Superuser', 'Admin (1)', 'Teacher (2)', 'Student (1)']],
  ['with no role', user(), []],
] as const)('roleChips: %s (D14 rev 8, tip rev 9)', (_label, u, chips) => {
  const got = roleChips(u);
  if (chips.length && typeof chips[0] === 'string') expect(got.map((c) => c.text)).toEqual(chips);
  else expect(got).toEqual(chips);
});

// D14 rev 9: the tooltip is capped; the hidden list (items) is not.
const tipLines = (u: PanelUser) => roleChips(u)[0].tip.split('\n');
it('roleChips tip: ten runs are all listed, with no "more" line (D14 rev 9)', () => {
  const lines = tipLines(user({ teacher_runs: runs(10) }));
  expect(lines).toHaveLength(10);
  expect(lines[9]).toBe('- Stat · Run 10');
});
it('roleChips tip: past ten, the last line says how many more, with no bullet (D14 rev 9)', () => {
  const u = user({ student_runs: runs(12) });
  const lines = tipLines(u);
  expect(lines).toHaveLength(11);
  expect(lines[0]).toBe('- Stat · Run 1');
  expect(lines[9]).toBe('- Stat · Run 10');
  expect(lines[10]).toBe('… and 2 more');
  expect(roleChips(u)[0].items).toHaveLength(12);
});
it('roleChips tip: a course name is cut at 24 and a run title at 20, apart (D14 rev 9)', () => {
  const u = user({ teacher_runs: [
    run(1, 'Summer school 2026 (evening group)', 'Introduction to Probability and Mathematical Statistics'),
    run(2, 'abcdefghijklmnopqrst', 'abcdefghijklmnopqrstuvwx'),
  ] });
  expect(tipLines(u)).toEqual(['- Introduction to Probabi… · Summer school 2026…', '- abcdefghijklmnopqrstuvwx · abcdefghijklmnopqrst']);
  expect(roleChips(u)[0].items[0]).toBe('Introduction to Probability and Mathematical Statistics · Summer school 2026 (evening group)');
});
it("roleChips tip: an admin's course name is cut at 30 (D14 rev 9)", () => {
  const u = user({ admin_of: [ref(1, 'Introduction to Probability and Mathematical Statistics'), ref(2, 'abcdefghijklmnopqrstuvwxyz1234')] });
  expect(tipLines(u)).toEqual(['- Introduction to Probability a…', '- abcdefghijklmnopqrstuvwxyz1234']);
});
it('roleChips tip: cutting counts characters, never splitting one in two (D14 rev 9)', () => {
  const tip = tipLines(user({ admin_of: [ref(1, '𝔸'.repeat(31))] }))[0];
  expect(tip).toBe(`- ${'𝔸'.repeat(29)}…`);
});

const SIGNED_OUT = "They'll be signed out and can't sign in until enabled; tell them yourself.";
it('disableWarning: the spec example, admin and teacher (D18)', () => {
  expect(disableWarning(user({ admin_of: [ref(1, 'Statistics 101')], teacher_runs: runs(2) })))
    .toBe(`Disable Anna Holm? Anna Holm is the admin of Statistics 101 and teaches 2 runs. ${SIGNED_OUT}`);
});
it('disableWarning: admin only, of two and of more than two courses', () => {
  expect(disableWarning(user({ admin_of: [ref(1, 'A'), ref(2, 'B')] }))).toBe(`Disable Anna Holm? Anna Holm is the admin of A and B. ${SIGNED_OUT}`);
  expect(disableWarning(user({ admin_of: [ref(1, 'A'), ref(2, 'B'), ref(3, 'C')] }))).toBe(`Disable Anna Holm? Anna Holm is the admin of 3 courses. ${SIGNED_OUT}`);
});
it('disableWarning: teacher only, singular for one run', () => {
  expect(disableWarning(user({ teacher_runs: runs(1) }))).toBe(`Disable Anna Holm? Anna Holm teaches 1 run. ${SIGNED_OUT}`);
});
it('disableWarning: no role has no middle sentence, and a nameless account is named by email', () => {
  expect(disableWarning(user({ student_runs: runs(4) }))).toBe(`Disable Anna Holm? ${SIGNED_OUT}`);
  expect(disableWarning(user({ full_name: null, teacher_runs: runs(1) }))).toBe(`Disable aho@uni.dk? aho@uni.dk teaches 1 run. ${SIGNED_OUT}`);
});

it('the Settings calls: one GET, a PATCH per card, a POST for the test, all on the token', async () => {
  const unauth = vi.spyOn(events, 'emitUnauthorized');
  const f = vi.fn(async (..._a: Parameters<typeof fetch>) => jsonResponse(200, {}));
  vi.stubGlobal('fetch', f);
  await getSettings('T');
  expect(String(f.mock.calls[0][0])).toBe('/api/superuser/T/settings');
  expect(f.mock.calls[0][1]?.method ?? 'GET').toBe('GET');

  // D7c: an off save sends the switch alone.
  await saveEmail('T', { on: false });
  expect(String(f.mock.calls[1][0])).toBe('/api/superuser/T/settings/email');
  expect(f.mock.calls[1][1]?.method).toBe('PATCH');
  expect(f.mock.calls[1][1]?.body).toBe(JSON.stringify({ on: false }));

  await saveLimits('T', { max_file_mb: 50, max_total_mb: 500 });
  expect(String(f.mock.calls[2][0])).toBe('/api/superuser/T/settings/limits');
  expect(f.mock.calls[2][1]?.method).toBe('PATCH');

  await saveSignIn('T', { pin_minutes: 10, pin_requests_per_hour: 3, pin_failures_per_hour: 5, longest_sign_in_days: 7 });
  expect(String(f.mock.calls[3][0])).toBe('/api/superuser/T/settings/sign-in');
  expect(f.mock.calls[3][1]?.method).toBe('PATCH');

  f.mockImplementation(async () => jsonResponse(200, { ok: true, message: 'Sent to su@x.dk: check your inbox.' }));
  const body = { host: 'smtp.x.dk', port: 587, encryption: 'starttls' as const, skip_cert_check: false, username: '', from_address: 'a@x.dk' };
  expect(await testEmail('T', body)).toEqual({ ok: true, message: 'Sent to su@x.dk: check your inbox.' });
  expect(String(f.mock.calls[4][0])).toBe('/api/superuser/T/settings/email/test');
  expect(f.mock.calls[4][1]?.method).toBe('POST');
  expect(f.mock.calls[4][1]?.body).toBe(JSON.stringify(body));

  f.mockImplementation(async () => jsonResponse(401, { detail: 'Not authenticated' }));
  await expect(getSettings('T')).rejects.toBeInstanceOf(ApiError);
  expect(unauth).not.toHaveBeenCalled();
});

// --- Branding (D2, D5, D10, D14) ---

/** A FormData part's bytes, read the way the dialog reads a file. */
function partBytes(part: Blob): Promise<number[]> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve([...new Uint8Array(r.result as ArrayBuffer)]);
    r.readAsArrayBuffer(part);
  });
}

it('Branding: the read and the name save are JSON calls with the token', async () => {
  const unauth = vi.spyOn(events, 'emitUnauthorized');
  const f = vi.fn(async (..._a: Parameters<typeof fetch>) => jsonResponse(200, {}));
  vi.stubGlobal('fetch', f);
  await getBranding('T');
  expect(String(f.mock.calls[0][0])).toBe('/api/superuser/T/branding');
  await saveSiteName('T', { name: 'Riverside' });
  expect(String(f.mock.calls[1][0])).toBe('/api/superuser/T/branding/name');
  expect(f.mock.calls[1][1]?.method).toBe('PUT');
  expect(f.mock.calls[1][1]?.body).toBe(JSON.stringify({ name: 'Riverside' }));
  await saveSiteName('T', { reset: true });
  expect(f.mock.calls[2][1]?.body).toBe(JSON.stringify({ reset: true }));

  f.mockImplementation(async () => jsonResponse(401, { detail: 'Not authenticated' }));
  await expect(getBranding('T')).rejects.toMatchObject({ status: 401 });
  expect(unauth).not.toHaveBeenCalled();
});

it('Branding: an image save posts the same bytes as a multipart file, with the CSRF header', async () => {
  const unauth = vi.spyOn(events, 'emitUnauthorized');
  const f = vi.fn(async (..._a: Parameters<typeof fetch>) => jsonResponse(200, {}));
  vi.stubGlobal('fetch', f);
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 8, 9]);
  await saveImage('T', 'logo', bytes, 'school.png');
  const [url, init] = f.mock.calls[0];
  expect(String(url)).toBe('/api/superuser/T/branding/logo');
  expect(init?.method).toBe('POST');
  expect(new Headers(init?.headers).get('X-Requested-With')).toBe('mathion');
  // The browser sets the multipart boundary itself.
  expect(new Headers(init?.headers).get('Content-Type')).toBeNull();
  const fd = init?.body as FormData;
  expect([...fd.keys()]).toEqual(['file']);
  const file = fd.get('file') as File;
  expect(file.name).toBe('school.png');
  expect(file.type).toBe('image/png');
  expect(await partBytes(file)).toEqual([...bytes]);

  await saveImage('T', 'icon', 'reset');
  const [url2, init2] = f.mock.calls[1];
  expect(String(url2)).toBe('/api/superuser/T/branding/icon');
  const fd2 = init2?.body as FormData;
  expect([...fd2.entries()]).toEqual([['reset', 'true']]);

  f.mockImplementation(async () => new Response('<html>413</html>', { status: 413, headers: { 'content-type': 'text/html' } }));
  await expect(saveImage('T', 'logo', bytes, 'a.png')).rejects.toMatchObject({ status: 413, body: undefined });
  f.mockImplementation(async () => jsonResponse(401, { detail: 'Not authenticated' }));
  await expect(saveImage('T', 'logo', 'reset')).rejects.toMatchObject({ status: 401 });
  expect(unauth).not.toHaveBeenCalled();
});

it('Branding: the theme check and the theme save post the bytes as a .css file', async () => {
  const f = vi.fn(async (..._a: Parameters<typeof fetch>) => jsonResponse(200, {}));
  vi.stubGlobal('fetch', f);
  const css = new TextEncoder().encode(':root { --bg: #fff; }');
  await checkTheme('T', css, 'aau.css');
  expect(String(f.mock.calls[0][0])).toBe('/api/superuser/T/branding/theme/check');
  const part = (f.mock.calls[0][1]?.body as FormData).get('file') as File;
  expect(part.name).toBe('aau.css');
  expect(part.type).toBe('text/css');
  expect(await partBytes(part)).toEqual([...css]);

  await saveTheme('T', css, 'aau.css');
  expect(String(f.mock.calls[1][0])).toBe('/api/superuser/T/branding/theme');
  await saveTheme('T', 'reset');
  expect([...(f.mock.calls[2][1]?.body as FormData).entries()]).toEqual([['reset', 'true']]);
});

