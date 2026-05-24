import { api } from './api';
import { listAssets, uploadAsset, deleteAsset } from './assets';
import { listRunAssets, uploadRunAsset, deleteRunAsset } from './runAssets';

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
  // Delegates list/upload/remove to lib/runAssets.ts (the wire layer). The
  // upload wire path — network/401/AbortError handling — lives there so there
  // is exactly one upload implementation per run-asset endpoint.
  return {
    kind: 'run',
    list: () => listRunAssets(runId),
    upload: (file, signal) => uploadRunAsset(runId, file, signal),
    remove: (id) => deleteRunAsset(runId, id),
    imgSrc: (item) => `/api/runs/${runId}/assets/${item.filename}`,
    renderPreview: (content_md) =>
      api.post<{ html: string }>(`/api/runs/${runId}/render`, { content_md }),
  };
}
