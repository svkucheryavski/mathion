import { api, ApiError } from './api';
import { listAssets, uploadAsset, deleteAsset } from './assets';

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
      //   credentials: 'include' (Vite dev runs on a different port than the
      //   backend so cookies need 'include'), 'X-Requested-With': 'mathion'
      //   for CSRF, and ApiError on non-ok so downstream `e instanceof ApiError`
      //   checks in AssetSidebar/MarkdownEditor work.
      const r = await fetch(`/api/runs/${runId}/assets`, {
        method: 'POST',
        body: fd,
        signal,
        credentials: 'include',
        headers: { 'X-Requested-With': 'mathion' },
      });
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
