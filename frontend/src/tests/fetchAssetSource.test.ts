import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAssetSource } from '../lib/assets';
import { ApiError, OFFLINE_MESSAGE, REQUEST_ERROR_MESSAGE, SERVER_ERROR_MESSAGE } from '../lib/api';
import * as events from '../lib/events';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; vi.restoreAllMocks(); });

function tres(text: string, status = 200, statusText = 'x') {
  return Promise.resolve({ ok: status < 400, status, statusText, text: () => Promise.resolve(text) } as unknown as Response);
}

it('returns the response body text on success', async () => {
  fetchSpy.mockImplementation(() => tres("console.log(1)"));
  await expect(fetchAssetSource(5, 'app.js')).resolves.toBe("console.log(1)");
  const [url, init] = fetchSpy.mock.calls[0];
  expect(String(url)).toBe('/assets/5/app.js');
  expect((init as RequestInit).credentials).toBe('include');
});

it('emits unauthorized and throws ApiError(401) on 401', async () => {
  const emit = vi.spyOn(events, 'emitUnauthorized').mockImplementation(() => {});
  fetchSpy.mockImplementation(() => tres('', 401));
  await expect(fetchAssetSource(5, 'app.js')).rejects.toBeInstanceOf(ApiError);
  expect(emit).toHaveBeenCalledOnce();
});

it('throws ApiError on other non-2xx', async () => {
  fetchSpy.mockImplementation(() => tres('', 404));
  await expect(fetchAssetSource(5, 'app.js')).rejects.toMatchObject({ status: 404 });
});

it('rethrows AbortError untouched', async () => {
  fetchSpy.mockImplementation(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  await expect(fetchAssetSource(5, 'app.js')).rejects.toMatchObject({ name: 'AbortError' });
});

it('a lost connection throws ApiError(0) with the offline sentence', async () => {
  fetchSpy.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
  await expect(fetchAssetSource(5, 'app.js')).rejects.toMatchObject({ status: 0, detail: OFFLINE_MESSAGE });
});

it.each([
  [403, 'Forbidden', REQUEST_ERROR_MESSAGE],
  [502, 'Bad Gateway', SERVER_ERROR_MESSAGE],
])('a %i says a sentence, not the status text', async (status, statusText, sentence) => {
  fetchSpy.mockImplementation(() => tres('<html>no</html>', status, statusText));
  await expect(fetchAssetSource(5, 'app.js')).rejects.toMatchObject({ status, detail: sentence });
});
