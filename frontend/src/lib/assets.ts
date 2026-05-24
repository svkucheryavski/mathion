// Asset upload + media library helpers.
//
// `uploadAsset` uses raw `fetch` rather than `api.post` because `api.post`
// hardcodes Content-Type: application/json and JSON.stringify(body). Both
// would silently corrupt a multipart upload — the multipart boundary must
// come from the browser-set Content-Type, and the body must be FormData.
//
// On 401 this helper mirrors api.ts:request and calls emitUnauthorized
// with all three location parts (pathname + search + hash) — without this,
// an expired session mid-upload surfaces as a confusing inline error
// rather than a redirect to login.
//
// `listAssets` and `deleteAsset` delegate to api.get / api.delete since
// they don't carry multipart concerns.

import { api, ApiError } from './api';
import { emitUnauthorized } from './events';

export type AssetResponse = {
  id: number;
  version_id: number;
  filename: string;
  file_size: number;
  mime_type: string;
  uploaded_at: string;
  uploaded_by: number | null;
  is_referenced: boolean;
};

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif']);

export async function uploadAsset(
  versionId: number,
  file: File,
  signal?: AbortSignal,
): Promise<AssetResponse> {
  const formData = new FormData();
  formData.append('file', file);

  let res: Response;
  try {
    res = await fetch(`/api/versions/${versionId}/assets`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'mathion' },
      body: formData,
      signal,
    });
  } catch (e: unknown) {
    // Preserve AbortError so modal-cancel paths stay silent (jsdom's
    // DOMException doesn't extend Error — duck-check `.name`). Matches
    // lib/runAssets.ts wire pattern so both surfaces handle cancel
    // identically.
    if (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError') throw e;
    // Network failure (DNS, offline, CORS). Surface a uniform ApiError so
    // the UI maps it through the same channel as server errors.
    throw new ApiError(0, 'Could not reach server. Check your connection.');
  }

  if (res.status === 401) {
    emitUnauthorized(location.pathname + location.search + location.hash);
    throw new ApiError(401, 'Not authenticated');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? res.statusText, body.error_code);
  }
  return res.json() as Promise<AssetResponse>;
}

export function listAssets(versionId: number): Promise<AssetResponse[]> {
  return api.get<AssetResponse[]>(`/api/versions/${versionId}/assets`);
}

export function deleteAsset(assetId: number): Promise<void> {
  return api.delete(`/api/assets/${assetId}`);
}

export function formatRef(filename: string, mimeType: string): string {
  if (IMAGE_MIME_TYPES.has(mimeType)) {
    const stem = filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename;
    return `\n![${stem}](${filename})\n`;
  }
  return `\n[${filename}](${filename})\n`;
}
