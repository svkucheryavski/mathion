import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  listRunAssets,
  uploadRunAsset,
  replaceRunAsset,
  deleteRunAsset,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_EXTENSIONS,
} from '../lib/runAssets';
import * as events from '../lib/events';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

describe('runAssets wrappers', () => {
  it('listRunAssets GETs /api/runs/{rid}/assets', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    await listRunAssets(10);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/10/assets'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('uploadRunAsset POSTs FormData with field "file" and full wire-pattern parity to uploadAsset', async () => {
    // Locks the "mirrors lib/assets.ts:uploadAsset" contract by asserting the
    // parity-critical wire bits: multipart body, threaded signal,
    // credentials: 'include' (cross-port dev cookie), X-Requested-With CSRF
    // header, and no manual Content-Type (the browser must set the multipart
    // boundary). A regression that drops any of these slips past URL+method
    // checks otherwise.
    fetchSpy.mockImplementation((_url, init) => {
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
      expect((init.body as FormData).get('file')).toBeInstanceOf(File);
      expect(init.signal).toBeDefined();
      expect(init.credentials).toBe('include');
      const headers = new Headers(init.headers as HeadersInit | undefined);
      expect(headers.get('X-Requested-With')).toBe('mathion');
      expect(headers.has('Content-Type')).toBe(false);
      return jres({
        id: 1,
        filename: 'x.png',
        mime_type: 'image/png',
        file_size: 1,
        is_referenced: false,
      });
    });
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const c = new AbortController();
    await uploadRunAsset(10, file, c.signal);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/10/assets'),
      expect.any(Object),
    );
  });

  it('uploadRunAsset propagates AbortError when signal fires', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.reject(new DOMException('Aborted', 'AbortError')),
    );
    const c = new AbortController();
    c.abort();
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    await expect(uploadRunAsset(10, file, c.signal)).rejects.toThrowError(/abort/i);
  });

  it('uploadRunAsset wraps network failure in ApiError(0, ...) mirroring assets.ts:46', async () => {
    fetchSpy.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const { ApiError } = await import('../lib/api');
    const err = await uploadRunAsset(10, file).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0 });
  });

  it('uploadRunAsset on 401 calls emitUnauthorized before throwing ApiError(401)', async () => {
    const emitSpy = vi.spyOn(events, 'emitUnauthorized').mockImplementation(() => {});
    fetchSpy.mockImplementation(() => jres({ detail: 'Not authenticated' }, 401));
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const { ApiError } = await import('../lib/api');
    await expect(uploadRunAsset(10, file)).rejects.toBeInstanceOf(ApiError);
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy.mock.calls[0][0]).toBe(
      location.pathname + location.search + location.hash,
    );
    emitSpy.mockRestore();
  });

  it('uploadRunAsset throws ApiError with error_code on 409', async () => {
    fetchSpy.mockImplementation(() =>
      jres({ detail: 'Asset already exists', error_code: 'asset_exists' }, 409),
    );
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const { ApiError } = await import('../lib/api');
    const err = await uploadRunAsset(10, file).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).status).toBe(409);
    expect((err as InstanceType<typeof ApiError>).errorCode).toBe('asset_exists');
  });

  it('deleteRunAsset DELETEs /api/runs/{rid}/assets/{assetId}', async () => {
    fetchSpy.mockImplementation(() => jres('', 204));
    await deleteRunAsset(10, 99);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/10/assets/99'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('replaceRunAsset PUTs FormData with full wire-pattern parity to uploadRunAsset', async () => {
    // Mirrors uploadRunAsset's 6 wire properties (method, URL, FormData body,
    // credentials, X-Requested-With, no manual Content-Type), with PUT
    // + asset_id in the URL. The incoming file's name is irrelevant — the
    // backend preserves the existing asset's filename.
    fetchSpy.mockImplementation((url, init) => {
      expect(url).toContain('/api/runs/10/assets/42');
      expect(init.method).toBe('PUT');
      expect(init.body).toBeInstanceOf(FormData);
      expect((init.body as FormData).get('file')).toBeInstanceOf(File);
      expect(init.signal).toBeDefined();
      expect(init.credentials).toBe('include');
      const headers = new Headers(init.headers as HeadersInit | undefined);
      expect(headers.get('X-Requested-With')).toBe('mathion');
      expect(headers.has('Content-Type')).toBe(false);
      return jres({
        id: 42,
        run_id: 10,
        filename: 'doc.pdf',
        file_size: 11,
        mime_type: 'application/pdf',
        uploaded_at: '2026-05-25T12:00:00Z',
        uploaded_by: 7,
        uploaded_by_email: 'admin@example.com',
        is_referenced: false,
      });
    });
    const file = new File(['new content'], 'ignored.pdf', { type: 'application/pdf' });
    const c = new AbortController();
    const result = await replaceRunAsset(10, 42, file, c.signal);
    expect(result.id).toBe(42);
    expect(result.uploaded_by_email).toBe('admin@example.com');
  });

  it('replaceRunAsset propagates AbortError when signal fires', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.reject(new DOMException('Aborted', 'AbortError')),
    );
    const c = new AbortController();
    c.abort();
    const file = new File(['x'], 'x.pdf', { type: 'application/pdf' });
    await expect(replaceRunAsset(10, 42, file, c.signal)).rejects.toThrowError(/abort/i);
  });

  it('replaceRunAsset wraps network failure in ApiError(0, ...)', async () => {
    fetchSpy.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const file = new File(['x'], 'x.pdf', { type: 'application/pdf' });
    const { ApiError } = await import('../lib/api');
    const err = await replaceRunAsset(10, 42, file).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0 });
  });

  it('replaceRunAsset on 401 calls emitUnauthorized before throwing ApiError(401)', async () => {
    const emitSpy = vi.spyOn(events, 'emitUnauthorized').mockImplementation(() => {});
    fetchSpy.mockImplementation(() => jres({ detail: 'Not authenticated' }, 401));
    const file = new File(['x'], 'x.pdf', { type: 'application/pdf' });
    const { ApiError } = await import('../lib/api');
    await expect(replaceRunAsset(10, 42, file)).rejects.toBeInstanceOf(ApiError);
    expect(emitSpy).toHaveBeenCalledTimes(1);
    emitSpy.mockRestore();
  });

  it('replaceRunAsset surfaces error_code on 422 extension mismatch', async () => {
    fetchSpy.mockImplementation(() =>
      jres({ detail: 'Extension must match', error_code: 'extension_mismatch' }, 422),
    );
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const { ApiError } = await import('../lib/api');
    const err = await replaceRunAsset(10, 42, file).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).status).toBe(422);
    expect((err as InstanceType<typeof ApiError>).errorCode).toBe('extension_mismatch');
  });

  describe('deleteRunAsset force/signal extension', () => {
    it('omits ?force=true when no options', async () => {
      fetchSpy.mockImplementation(() => jres('', 204));
      await deleteRunAsset(10, 42);
      expect(fetchSpy.mock.calls[0][0]).toContain('/api/runs/10/assets/42');
      expect(fetchSpy.mock.calls[0][0]).not.toContain('force=true');
    });

    it('omits ?force=true when { force: false }', async () => {
      fetchSpy.mockImplementation(() => jres('', 204));
      await deleteRunAsset(10, 42, { force: false });
      expect(fetchSpy.mock.calls[0][0]).not.toContain('force=true');
    });

    it('omits ?force=true when { force: undefined }', async () => {
      fetchSpy.mockImplementation(() => jres('', 204));
      await deleteRunAsset(10, 42, { force: undefined });
      expect(fetchSpy.mock.calls[0][0]).not.toContain('force=true');
    });

    it('appends ?force=true when { force: true }', async () => {
      fetchSpy.mockImplementation(() => jres('', 204));
      await deleteRunAsset(10, 42, { force: true });
      expect(fetchSpy.mock.calls[0][0]).toContain('/api/runs/10/assets/42?force=true');
    });

    it('threads signal into fetch options', async () => {
      const ctrl = new AbortController();
      fetchSpy.mockImplementation(() => jres('', 204));
      await deleteRunAsset(10, 42, { signal: ctrl.signal });
      expect(fetchSpy.mock.calls[0][1].signal).toBe(ctrl.signal);
    });
  });
});

describe('pre-validation constants', () => {
  it('MAX_FILE_SIZE_BYTES is 20 MB (matches backend config.py default)', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(20 * 1024 * 1024);
  });

  it('ALLOWED_EXTENSIONS mirrors backend assets.py exactly (no leading dots)', () => {
    expect(ALLOWED_EXTENSIONS).toEqual(
      new Set([
        'png', 'jpg', 'jpeg', 'gif', 'pdf',
        'csv', 'xls', 'xlsx', 'ppt', 'pptx',
        'r', 'py', 'm', 'js',
      ]),
    );
  });
});
