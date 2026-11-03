import { it, expect, vi, afterEach } from 'vitest';
import { ApiError, OFFLINE_MESSAGE } from '../lib/api';
import * as events from '../lib/events';
import {
  panelError, listUsers, assignAdmin, updateUser, deleteCourse, lookupAccount,
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
