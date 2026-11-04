import { it, expect, vi, afterEach } from 'vitest';
import { ApiError, OFFLINE_MESSAGE } from '../lib/api';
import * as events from '../lib/events';
import {
  panelError, listUsers, assignAdmin, updateUser, deleteCourse, lookupAccount, adminNote,
  countLine, roleChips, disableWarning,
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
  ['a superuser', user({ is_superuser: true }), [{ kind: 'su', text: 'Superuser', items: [] }]],
  ['the admin of one course', user({ admin_of: [ref(1, 'Statistics 101')] }), [{ kind: 'ad', text: 'Admin (1)', items: ['Statistics 101'] }]],
  ['the admin of three courses', user({ admin_of: [ref(1, 'A'), ref(2, 'B'), ref(3, 'C')] }), [{ kind: 'ad', text: 'Admin (3)', items: ['A', 'B', 'C'] }]],
  ['a teacher of two runs', user({ teacher_runs: [run(1, 'Autumn 2026', 'Statistics 101'), run(2, 'Autumn 2026', 'Algebra')] }),
    [{ kind: 'role', text: 'Teacher (2)', items: ['Statistics 101 · Autumn 2026', 'Algebra · Autumn 2026'] }]],
  ['a student of one run', user({ student_runs: [run(3, 'Spring', 'Stat')] }), [{ kind: 'role', text: 'Student (1)', items: ['Stat · Spring'] }]],
  ['disabled has no chip (D14 rev 8: the row is greyed)', user({ is_disabled: true }), []],
  ['in D14 order', user({ is_disabled: true, student_runs: runs(1), teacher_runs: runs(2), admin_of: [ref(1, 'Stat')], is_superuser: true }),
    ['Superuser', 'Admin (1)', 'Teacher (2)', 'Student (1)']],
  ['with no role', user(), []],
] as const)('roleChips: %s (D14 rev 8)', (_label, u, chips) => {
  const got = roleChips(u);
  if (chips.length && typeof chips[0] === 'string') expect(got.map((c) => c.text)).toEqual(chips);
  else expect(got).toEqual(chips);
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
