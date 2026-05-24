import { describe, it, expect, beforeEach, vi } from 'vitest';
import { courseAssetContext, runAssetContext } from '../lib/assetContext';
import type { AssetItem } from '../lib/assetContext';

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

describe('courseAssetContext', () => {
  const ctx = courseAssetContext(7);

  it('kind is "course"', () => expect(ctx.kind).toBe('course'));

  it('list() GETs /api/versions/{vid}/assets', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    await ctx.list();
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/versions/7/assets'),
      expect.any(Object),
    );
  });

  it('renderPreview POSTs /api/versions/{vid}/render', async () => {
    fetchSpy.mockImplementation(() => jres({ html: '<p>x</p>' }));
    await ctx.renderPreview('hi');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/versions/7/render'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('imgSrc returns /assets/{vid}/{filename} (no /api prefix)', () => {
    const item: AssetItem = {
      id: 1,
      filename: 'pic.png',
      mime_type: 'image/png',
      file_size: 100,
      is_referenced: false,
    };
    expect(ctx.imgSrc(item)).toBe('/assets/7/pic.png');
  });
});

describe('runAssetContext', () => {
  const ctx = runAssetContext(42);

  it('kind is "run"', () => expect(ctx.kind).toBe('run'));

  it('list() GETs /api/runs/{rid}/assets', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    await ctx.list();
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/42/assets'),
      expect.any(Object),
    );
  });

  it('renderPreview POSTs /api/runs/{rid}/render', async () => {
    fetchSpy.mockImplementation(() => jres({ html: '<p>x</p>' }));
    await ctx.renderPreview('hi');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/42/render'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('imgSrc returns /api/runs/{rid}/assets/{filename} (WITH /api prefix)', () => {
    const item: AssetItem = {
      id: 1,
      filename: 'd.png',
      mime_type: 'image/png',
      file_size: 100,
      is_referenced: false,
    };
    expect(ctx.imgSrc(item)).toBe('/api/runs/42/assets/d.png');
  });

  it('upload threads AbortSignal AND propagates abort as AbortError rejection', async () => {
    let capturedSignal: AbortSignal | undefined;
    fetchSpy.mockImplementation((_url, init) => {
      capturedSignal = init?.signal;
      return new Promise((_resolve, reject) => {
        if (capturedSignal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        capturedSignal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
        // Don't resolve unless aborted in this test — we're testing abort path.
      });
    });
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const controller = new AbortController();
    const uploadPromise = ctx.upload(file, controller.signal);
    expect(capturedSignal).toBe(controller.signal);
    controller.abort();
    await expect(uploadPromise).rejects.toThrowError(/abort/i);
  });

  it('upload throws ApiError on 409 (NOT plain Error) so downstream instanceof checks work', async () => {
    fetchSpy.mockImplementation(() =>
      jres({ detail: 'Asset already exists', error_code: 'asset_exists' }, 409),
    );
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const { ApiError } = await import('../lib/api');
    try {
      await ctx.upload(file);
      expect.fail('Expected upload() to reject');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as InstanceType<typeof ApiError>).status).toBe(409);
      expect((e as InstanceType<typeof ApiError>).errorCode).toBe('asset_exists');
    }
  });
});
