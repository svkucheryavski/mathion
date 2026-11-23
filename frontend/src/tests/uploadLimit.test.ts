import { it, expect, vi, afterEach } from 'vitest';
import {
  uploadLimit, loadUploadLimit, overUploadLimit, overLimitSentence, resetUploadLimit, setUploadLimit, tooLargeSentence,
} from '../lib/uploadLimit.svelte';
import { ApiError, REQUEST_ERROR_MESSAGE } from '../lib/api';

const MB = 1024 * 1024;
function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
afterEach(() => { resetUploadLimit(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('reads max_file_mb from /api/auth/config, once per page load (D11b)', async () => {
  const f = vi.fn(async () => jsonResponse(200, { send_pin_enabled: true, longest_sign_in_days: 30, max_file_mb: 50 }));
  vi.stubGlobal('fetch', f);
  expect(uploadLimit.mb).toBeNull();
  await Promise.all([loadUploadLimit(), loadUploadLimit()]);
  await loadUploadLimit();
  expect(uploadLimit.mb).toBe(50);
  expect(f).toHaveBeenCalledTimes(1);
  expect(String((f.mock.calls[0] as unknown[])[0])).toBe('/api/auth/config');
});

it('a failed fetch leaves the limit unknown (null), and does not throw', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { detail: 'boom' })));
  await expect(loadUploadLimit()).resolves.toBeUndefined();
  expect(uploadLimit.mb).toBeNull();
});

it('overUploadLimit: no check while the limit is unknown', () => {
  expect(overUploadLimit(10_000 * MB)).toBe(false);
});

it('overUploadLimit: with 50 MB saved, 30 MB and exactly 50 MB pass, 51 MB is over', () => {
  uploadLimit.mb = 50;
  expect(overUploadLimit(30 * MB)).toBe(false);
  expect(overUploadLimit(50 * MB)).toBe(false);
  expect(overUploadLimit(50 * MB + 1)).toBe(true);
  expect(overUploadLimit(51 * MB)).toBe(true);
});

it("a 413 with the server's sentence shows that sentence (D11a)", () => {
  const err = new ApiError(413, 'This file is over the 20 MB limit.', undefined, { detail: 'This file is over the 20 MB limit.' });
  expect(tooLargeSentence(err)).toBe('This file is over the 20 MB limit.');
});

it("a 413 with no sentence (a proxy's page) says the server's upload limit (D11a)", () => {
  expect(tooLargeSentence(new ApiError(413, REQUEST_ERROR_MESSAGE))).toBe("This file is over the server's upload limit.");
  expect(tooLargeSentence(Object.assign(new Error('too large'), { status: 413 }))).toBe("This file is over the server's upload limit.");
});

it('uses a given config answer instead of fetching again (Branding D13)', async () => {
  const f = vi.fn(async () => jsonResponse(200, {}));
  vi.stubGlobal('fetch', f);
  const config = Promise.resolve({
    send_pin_enabled: true, longest_sign_in_days: 30, max_file_mb: 33, max_total_mb: 500,
    branding: { name: 'Mathion', logo: null, icon: null, theme: null },
  });
  await loadUploadLimit(config);
  expect(uploadLimit.mb).toBe(33);
  expect(f).not.toHaveBeenCalled();
});

it('a given config answer that fails leaves the limit unknown', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, {})));
  await expect(loadUploadLimit(Promise.reject(new Error('down')))).resolves.toBeUndefined();
  expect(uploadLimit.mb).toBeNull();
});

// The user's call (2026-11-12): one sentence everywhere, the server's words.
it('overLimitSentence names the file when there is one', () => {
  uploadLimit.mb = 20;
  expect(overLimitSentence('a.png')).toBe('a.png is over the 20 MB limit.');
  expect(overLimitSentence()).toBe('This file is over the 20 MB limit.');
  // A pasted or dragged blob can have an empty name.
  expect(overLimitSentence('')).toBe('This file is over the 20 MB limit.');
});

// Settings Task 6 backlog: a limits save reaches this tab's screens at once.
it('setUploadLimit sets the limit, and a late startup answer does not undo it', async () => {
  let answer!: (r: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { answer = r; })));
  const loading = loadUploadLimit();
  setUploadLimit(75);
  expect(uploadLimit.mb).toBe(75);
  answer(jsonResponse(200, { send_pin_enabled: true, longest_sign_in_days: 30, max_file_mb: 20 }));
  await loading;
  expect(uploadLimit.mb).toBe(75);
});

it('setUploadLimit after a failed read makes the check work again', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
  await loadUploadLimit();
  expect(uploadLimit.mb).toBeNull();
  setUploadLimit(5);
  expect(overUploadLimit(6 * MB)).toBe(true);
});

it('resetUploadLimit forgets a set limit, so the next startup answer counts again', async () => {
  setUploadLimit(5);
  resetUploadLimit();
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { send_pin_enabled: true, longest_sign_in_days: 30, max_file_mb: 20 })));
  await loadUploadLimit();
  expect(uploadLimit.mb).toBe(20);
});
