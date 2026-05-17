import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ApiError } from '../lib/api';
import * as events from '../lib/events';
import { uploadAsset, listAssets, deleteAsset, formatRef, type AssetResponse } from '../lib/assets';

const ASSET_RESPONSE: AssetResponse = {
  id: 7,
  version_id: 42,
  filename: 'histogram.png',
  file_size: 1024,
  mime_type: 'image/png',
  uploaded_at: '2026-05-17T12:00:00Z',
  uploaded_by: 3,
  is_referenced: false,
};

describe('lib/assets', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: ReturnType<typeof vi.spyOn<any, any>>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/courses/foo/edit#item=87'),
      writable: true,
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe('uploadAsset', () => {
    it('happy path returns the parsed AssetResponse', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(ASSET_RESPONSE), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const file = new File(['x'.repeat(1024)], 'Histogram.PNG', { type: 'image/png' });
      const result = await uploadAsset(42, file);
      expect(result).toEqual(ASSET_RESPONSE);
    });

    it('request shape: POST, FormData with file, no Content-Type, credentials, X-Requested-With', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(ASSET_RESPONSE), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const file = new File(['x'], 'foo.png', { type: 'image/png' });
      await uploadAsset(42, file);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/versions/42/assets');
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      const headers = new Headers(init.headers as HeadersInit);
      expect(headers.get('X-Requested-With')).toBe('mathion');
      expect(headers.get('Content-Type')).toBe(null);
      expect(init.body).toBeInstanceOf(FormData);
      const fd = init.body as FormData;
      const sent = fd.get('file');
      expect(sent).toBeInstanceOf(File);
      expect((sent as File).name).toBe('foo.png');
    });

    it('propagates ApiError with status + detail on 400 (extension)', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'File extension not allowed: foo.exe' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const file = new File(['x'], 'foo.exe', { type: 'application/x-msdownload' });
      await expect(uploadAsset(42, file)).rejects.toMatchObject({
        status: 400,
        detail: 'File extension not allowed: foo.exe',
      });
    });

    it('propagates ApiError on 409 (already exists)', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Asset 'foo.png' already exists in this version" }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const file = new File(['x'], 'foo.png', { type: 'image/png' });
      await expect(uploadAsset(42, file)).rejects.toMatchObject({
        status: 409,
        detail: "Asset 'foo.png' already exists in this version",
      });
    });

    it('propagates ApiError on 403 disabled, 500 disk-write, 400 size, 400 total, 400 no-filename', async () => {
      const cases = [
        { status: 403, detail: 'Version is disabled' },
        { status: 500, detail: 'Failed to write asset to disk' },
        { status: 400, detail: 'File size 10485761 exceeds max 10485760' },
        { status: 400, detail: 'Total version asset size would exceed limit (104857600 bytes)' },
        { status: 400, detail: 'No filename provided' },
      ];
      for (const c of cases) {
        fetchSpy.mockResolvedValueOnce(
          new Response(JSON.stringify({ detail: c.detail }), {
            status: c.status,
            headers: { 'content-type': 'application/json' },
          }),
        );
        const file = new File(['x'], 'foo.png', { type: 'image/png' });
        await expect(uploadAsset(42, file)).rejects.toMatchObject({
          status: c.status,
          detail: c.detail,
        });
      }
    });

    it('wraps network failure in ApiError with status 0', async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const file = new File(['x'], 'foo.png', { type: 'image/png' });
      const err = await uploadAsset(42, file).catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ status: 0 });
    });

    it('on 401 calls emitUnauthorized(pathname + search + hash) before throwing', async () => {
      const emitSpy = vi.spyOn(events, 'emitUnauthorized').mockImplementation(() => {});
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Not authenticated' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const file = new File(['x'], 'foo.png', { type: 'image/png' });
      await expect(uploadAsset(42, file)).rejects.toBeInstanceOf(ApiError);
      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy).toHaveBeenCalledWith('/courses/foo/edit#item=87');
    });
  });

  describe('listAssets', () => {
    it('returns the server-sorted array unchanged', async () => {
      const list = [ASSET_RESPONSE, { ...ASSET_RESPONSE, id: 8, filename: 'zebra.pdf', mime_type: 'application/pdf' }];
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(list), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const result = await listAssets(42);
      expect(result).toEqual(list);
      expect(fetchSpy.mock.calls[0][0]).toBe('/api/versions/42/assets');
    });
  });

  describe('deleteAsset', () => {
    it('resolves on 204', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await expect(deleteAsset(7)).resolves.toBeUndefined();
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/assets/7');
      expect(init.method).toBe('DELETE');
    });

    it('propagates ApiError on 404 (race: someone else deleted)', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Asset not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      );
      await expect(deleteAsset(7)).rejects.toMatchObject({ status: 404, detail: 'Asset not found' });
    });
  });

  describe('formatRef', () => {
    it('image mime types return ![stem](filename) with surrounding newlines', () => {
      expect(formatRef('histogram.png', 'image/png')).toBe('\n![histogram](histogram.png)\n');
      expect(formatRef('shot.jpeg', 'image/jpeg')).toBe('\n![shot](shot.jpeg)\n');
      expect(formatRef('anim.gif', 'image/gif')).toBe('\n![anim](anim.gif)\n');
    });

    it('image stem strips ONLY the last extension', () => {
      // single dot
      expect(formatRef('histogram.png', 'image/png')).toBe('\n![histogram](histogram.png)\n');
      // multi-dot: strip ONLY the last dot-segment
      expect(formatRef('my.photo.png', 'image/png')).toBe('\n![my.photo](my.photo.png)\n');
      // no dot at all: stem equals full filename
      expect(formatRef('nodot', 'image/png')).toBe('\n![nodot](nodot)\n');
    });

    it('non-image mime types return [filename](filename) with surrounding newlines', () => {
      expect(formatRef('worksheet.pdf', 'application/pdf')).toBe('\n[worksheet.pdf](worksheet.pdf)\n');
      expect(formatRef('data.csv', 'text/csv')).toBe('\n[data.csv](data.csv)\n');
      expect(formatRef('script.py', 'text/plain')).toBe('\n[script.py](script.py)\n');
    });
  });
});
