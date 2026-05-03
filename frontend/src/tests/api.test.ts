import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ApiError, api } from '../lib/api';
import * as events from '../lib/events';

describe('lib/api', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: ReturnType<typeof vi.spyOn<any, any>>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/courses/foo'),
      writable: true,
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('attaches X-Requested-With on every request', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await api.get('/api/foo');
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('X-Requested-With')).toBe('mathion');
  });

  it('X-Requested-With cannot be overridden by callers (set-last)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await api.get('/api/foo', { headers: { 'X-Requested-With': 'attacker' } });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('X-Requested-With')).toBe('mathion');
  });

  it('preserves caller Content-Type for JSON posts', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await api.post('/api/foo', { a: 1 });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('throws ApiError with status + detail on non-ok', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Boom' }), { status: 500, headers: { 'content-type': 'application/json' } }),
    );
    await expect(api.get('/api/foo')).rejects.toMatchObject({
      status: 500,
      detail: 'Boom',
    });
  });

  it('emits unauthorized + throws on 401', async () => {
    const emitSpy = vi.spyOn(events, 'emitUnauthorized');
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(api.get('/api/foo')).rejects.toBeInstanceOf(ApiError);
    expect(emitSpy).toHaveBeenCalledWith('/courses/foo');
  });

  it('skipAuthRedirect=true does not emit on 401', async () => {
    const emitSpy = vi.spyOn(events, 'emitUnauthorized');
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(api.get('/api/foo', { skipAuthRedirect: true })).rejects.toMatchObject({ status: 401 });
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('returns parsed JSON on 200', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ x: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const out = await api.get<{ x: number }>('/api/foo');
    expect(out).toEqual({ x: 1 });
  });

  it('returns undefined on 204', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const out = await api.delete('/api/foo');
    expect(out).toBeUndefined();
  });

  it('ApiError.displayMessage handles string and array detail', () => {
    const e1 = new ApiError(400, 'oops');
    expect(e1.displayMessage).toBe('oops');
    const e2 = new ApiError(422, [{ loc: ['body', 'email'], msg: 'bad', type: 'value_error' }]);
    expect(e2.displayMessage).toBe('Please correct the highlighted fields.');
  });

  it('ApiError.validationErrors returns array on 422, null otherwise', () => {
    const e1 = new ApiError(400, 'oops');
    expect(e1.validationErrors()).toBeNull();
    const errs = [{ loc: ['body', 'email'] as (string | number)[], msg: 'bad', type: 'value_error' }];
    const e2 = new ApiError(422, errs);
    expect(e2.validationErrors()).toEqual(errs);
  });

  it('captures error_code from response body', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Nope', error_code: 'capacity_reached' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(api.get('/api/foo')).rejects.toMatchObject({
      status: 409,
      errorCode: 'capacity_reached',
    });
  });
});
