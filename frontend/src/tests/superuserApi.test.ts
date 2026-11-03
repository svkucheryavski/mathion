import { it, expect, vi, afterEach } from 'vitest';
import { ApiError, OFFLINE_MESSAGE } from '../lib/api';
import * as events from '../lib/events';
import {
  panelError, listUsers, assignAdmin, updateUser, deleteCourse, lookupAccount, adminNote,
  type AdminAssignResult,
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
