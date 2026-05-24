import { api, ApiError } from './api';
import { listAssets, uploadAsset, deleteAsset } from './assets';
import { emitUnauthorized } from './events';

export type AssetItem = {
  id: number;
  filename: string;
  mime_type: string;
  file_size: number;
  is_referenced: boolean;
};

export type AssetContext = {
  kind: 'course' | 'run';
  list(): Promise<AssetItem[]>;
  upload(file: File, signal?: AbortSignal): Promise<AssetItem>;
  remove(assetId: number): Promise<void>;
  imgSrc(item: AssetItem): string;
  renderPreview(content_md: string): Promise<{ html: string }>;
};

export function courseAssetContext(versionId: number): AssetContext {
  return {
    kind: 'course',
    list: () => listAssets(versionId),
    upload: (file, signal) => uploadAsset(versionId, file, signal),
    remove: (id) => deleteAsset(id),
    imgSrc: (item) => `/assets/${versionId}/${item.filename}`,
    renderPreview: (content_md) =>
      api.post<{ html: string }>(`/api/versions/${versionId}/render`, { content_md }),
  };
}

export function runAssetContext(runId: number): AssetContext {
  return {
    kind: 'run',
    list: () => api.get(`/api/runs/${runId}/assets`),
    upload: async (file, signal) => {
      const fd = new FormData();
      fd.append('file', file);
      // Mirror lib/assets.ts:uploadAsset wire pattern exactly:
      //   credentials: 'include', 'X-Requested-With': 'mathion' for CSRF,
      //   network failure -> ApiError(0), 401 -> emitUnauthorized + ApiError(401),
      //   non-ok -> ApiError(status, detail, error_code). User-cancelled uploads
      //   (AbortError) propagate as-is so callers can distinguish cancel from
      //   server-unreachable.
      let r: Response;
      try {
        r = await fetch(`/api/runs/${runId}/assets`, {
          method: 'POST',
          body: fd,
          signal,
          credentials: 'include',
          headers: { 'X-Requested-With': 'mathion' },
        });
      } catch (e: unknown) {
        // AbortError covers DOMException('Aborted', 'AbortError') (browser) AND
        // any Error-derived AbortError. jsdom's DOMException doesn't extend
        // Error, so check .name directly without an `instanceof Error` guard.
        if (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError') throw e;
        throw new ApiError(0, 'Could not reach server. Check your connection.');
      }
      if (r.status === 401) {
        emitUnauthorized(location.pathname + location.search + location.hash);
        throw new ApiError(401, 'Not authenticated');
      }
      if (!r.ok) {
        const payload = await r.json().catch(() => ({ detail: 'Upload failed' }));
        throw new ApiError(r.status, payload.detail ?? 'Upload failed', payload.error_code);
      }
      return r.json();
    },
    remove: (id) => api.delete(`/api/runs/${runId}/assets/${id}`),
    imgSrc: (item) => `/api/runs/${runId}/assets/${item.filename}`,
    renderPreview: (content_md) =>
      api.post<{ html: string }>(`/api/runs/${runId}/render`, { content_md }),
  };
}
