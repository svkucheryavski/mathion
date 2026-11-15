import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ApiError, REQUEST_ERROR_MESSAGE, SERVER_ERROR_MESSAGE, api, loadFailureText } from '../lib/api';
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

  describe('ApiError.body', () => {
    it('exposes parsed JSON body on non-2xx', () => {
      const err = new ApiError(409, 'X', 'err_x', { conflicts: [{ run_id: 1 }] });
      expect(err.body).toEqual({ conflicts: [{ run_id: 1 }] });
    });

    it('exposes body = undefined when constructed without body', () => {
      const err = new ApiError(0, 'network');
      expect(err.body).toBeUndefined();
    });

    it('api.post() throws ApiError with body populated from response JSON', async () => {
      const conflictPayload = {
        detail: 'Conflict',
        error_code: 'capacity_reached',
        conflicts: [{ run_id: 1 }, { run_id: 2 }],
      };
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(conflictPayload), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
      );
      let thrown: unknown;
      try {
        await api.post('/api/foo', { a: 1 });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(ApiError);
      expect((thrown as ApiError).body).toEqual(conflictPayload);
      expect((thrown as ApiError).status).toBe(409);
      expect((thrown as ApiError).errorCode).toBe('capacity_reached');
    });

    it('api.post() throws ApiError with body=undefined when response is not JSON', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('<html>500</html>', {
          status: 500,
          headers: { 'content-type': 'text/html' },
        }),
      );
      let thrown: unknown;
      try {
        await api.post('/api/foo', { a: 1 });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(ApiError);
      expect((thrown as ApiError).body).toBeUndefined();
      expect((thrown as ApiError).status).toBe(500);
    });
  });

  describe("an error's detail with no sentence of its own", () => {
    // A 5xx with no sentence of its own (a crash's plain-text page, a proxy's
    // empty 502) says a plain sentence, never the raw status text.
    it.each([
      [500, 'Internal Server Error', 'Internal Server Error'],
      [502, 'Bad Gateway', ''],
      [503, '', '<html>503</html>'],
      [504, '', ''],
    ])('a %i with no sentence of its own says the server sentence', async (status, statusText, text) => {
      fetchSpy.mockResolvedValueOnce(new Response(text, { status, statusText, headers: { 'content-type': 'text/plain' } }));
      const err = await api.get('/api/foo').catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ status, detail: SERVER_ERROR_MESSAGE });
      expect((err as ApiError).displayMessage).toBe('Something went wrong on the server. Try again.');
    });

    // An empty or null detail is no sentence either.
    it.each([
      ['no detail', { error: 'x' }],
      ['a null detail', { detail: null }],
      ['an empty detail', { detail: '' }],
    ])('a 5xx JSON answer with %s says the server sentence too', async (_what, body) => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(body), {
        status: 500, statusText: 'Internal Server Error', headers: { 'content-type': 'application/json' },
      }));
      const err = await api.get('/api/foo').catch((e) => e);
      expect(err).toMatchObject({ status: 500, detail: SERVER_ERROR_MESSAGE });
    });

    it("a 5xx with the server's own sentence keeps it", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Email is not set up.' }), {
        status: 503, statusText: 'Service Unavailable', headers: { 'content-type': 'application/json' },
      }));
      const err = await api.get('/api/foo').catch((e) => e);
      expect(err).toMatchObject({ status: 503, detail: 'Email is not set up.' });
    });

    it.each([
      [413, 'Payload Too Large'],
      [429, 'Too Many Requests'],
      [431, 'Request Header Fields Too Large'],
    ])('a %i with no sentence of its own still carries the status text', async (status, statusText) => {
      fetchSpy.mockResolvedValueOnce(new Response('<html>error</html>', {
        status, statusText, headers: { 'content-type': 'text/html' },
      }));
      const err = await api.get('/api/foo').catch((e) => e);
      expect(err).toMatchObject({ status, detail: statusText });
    });

    // Over HTTP/2 there is no status text: never a blank line.
    it.each([
      ['no body', ''],
      ['an empty detail', JSON.stringify({ detail: '' })],
    ])('a 4xx with no status text and %s says the general sentence', async (_what, text) => {
      fetchSpy.mockResolvedValueOnce(new Response(text, { status: 403, statusText: '', headers: { 'content-type': 'application/json' } }));
      const err = await api.get('/api/foo').catch((e) => e);
      expect(err).toMatchObject({ status: 403, detail: REQUEST_ERROR_MESSAGE });
      expect((err as ApiError).displayMessage).toBe('Something went wrong. Try again.');
    });

    it("a 422's list of field errors still comes through", async () => {
      const detail = [{ loc: ['body', 'name'], msg: 'Field required', type: 'missing' }];
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ detail }), {
        status: 422, headers: { 'content-type': 'application/json' },
      }));
      const err = await api.post('/api/foo', {}).catch((e) => e);
      expect((err as ApiError).validationErrors()).toEqual(detail);
    });
  });
});

describe('loadFailureText', () => {
  it('the server\'s sentence, the network sentence, else the server-error one', () => {
    expect(loadFailureText(new ApiError(404, 'Run not found.'))).toBe('Run not found.');
    expect(loadFailureText(new TypeError('Failed to fetch'))).toBe('Check your connection and try again.');
    expect(loadFailureText(new SyntaxError('Unexpected token <'))).toBe(SERVER_ERROR_MESSAGE);
  });
});
