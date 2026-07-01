import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAssetSource } from '../lib/assets';
import { ApiError } from '../lib/api';
import * as events from '../lib/events';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; vi.restoreAllMocks(); });

function tres(text: string, status = 200) {
  return Promise.resolve({ ok: status < 400, status, statusText: 'x', text: () => Promise.resolve(text) } as unknown as Response);
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
