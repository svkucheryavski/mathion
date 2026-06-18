import { api, ApiError } from './api';
import { emitUnauthorized } from './events';
import type { RunAssetResponse } from './types';

// MUST stay in sync with backend Settings.max_file_size (config.py:9), default 20 MB.
// Backend value is env-overridable via MATHION_MAX_FILE_SIZE; a deploy bumping the
// backend constant must hand-update this. Accepted drift for slice A; a
// /api/config/limits endpoint is the principled fix (Phase 9).
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

// MUST stay in sync with backend ALLOWED_EXTENSIONS (backend/mathion/assets.py:4-9).
// Backend stores extensions WITHOUT leading dot; mirrored verbatim:
export const ALLOWED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'pdf',
  'csv', 'xls', 'xlsx', 'ppt', 'pptx',
  'r', 'py', 'm', 'js',
]);

export function listRunAssets(runId: number): Promise<RunAssetResponse[]> {
  return api.get(`/api/runs/${runId}/assets`);
}

// Wire-layer mirror of lib/assets.ts:uploadAsset — credentials: 'include' (cross-port
// dev cookie), X-Requested-With CSRF header, network failure -> ApiError(0), 401 ->
// emitUnauthorized + ApiError(401), non-ok -> ApiError(status, detail, error_code).
// User-cancelled uploads (AbortError) propagate as-is so callers can distinguish
// cancel from server-unreachable.
export async function uploadRunAsset(
  runId: number,
  file: File,
  signal?: AbortSignal,
): Promise<RunAssetResponse> {
  const fd = new FormData();
  fd.append('file', file);
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
    // jsdom's DOMException doesn't extend Error, so duck-type on .name.
    if (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError') throw e;
    throw new ApiError(0, 'Could not reach server. Check your connection.');
  }
  if (r.status === 401) {
    emitUnauthorized(location.pathname + location.search + location.hash);
    throw new ApiError(401, 'Not authenticated');
  }
  if (!r.ok) {
    let parsedBody: unknown = undefined;
    try {
      parsedBody = await r.json();
    } catch {
      // Non-JSON response (HTML error page, truncated payload) — body stays
      // undefined. Mirrors lib/api.ts non-2xx handling.
    }
    const detail = (parsedBody as { detail?: string } | undefined)?.detail ?? 'Upload failed';
    const errorCode = (parsedBody as { error_code?: string } | undefined)?.error_code;
    throw new ApiError(r.status, detail, errorCode, parsedBody);
  }
  return r.json();
}

// Mirrors uploadRunAsset's wire pattern exactly (PUT + asset_id in URL):
// credentials: 'include', X-Requested-With CSRF, no manual Content-Type (browser
// sets multipart boundary), AbortError pass-through, network -> ApiError(0),
// 401 -> emitUnauthorized + ApiError(401), non-ok -> ApiError(status, detail,
// error_code). The incoming file's name is irrelevant — backend preserves the
// existing asset's filename.
export async function replaceRunAsset(
  runId: number,
  assetId: number,
  file: File,
  signal?: AbortSignal,
): Promise<RunAssetResponse> {
  const fd = new FormData();
  fd.append('file', file);
  let r: Response;
  try {
    r = await fetch(`/api/runs/${runId}/assets/${assetId}`, {
      method: 'PUT',
      body: fd,
      signal,
      credentials: 'include',
      headers: { 'X-Requested-With': 'mathion' },
    });
  } catch (e: unknown) {
    if (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError') throw e;
    throw new ApiError(0, 'Could not reach server. Check your connection.');
  }
  if (r.status === 401) {
    emitUnauthorized(location.pathname + location.search + location.hash);
    throw new ApiError(401, 'Not authenticated');
  }
  if (!r.ok) {
    let parsedBody: unknown = undefined;
    try {
      parsedBody = await r.json();
    } catch {
      // Non-JSON response (HTML error page, truncated payload) — body stays
      // undefined. Mirrors lib/api.ts non-2xx handling.
    }
    const detail = (parsedBody as { detail?: string } | undefined)?.detail ?? 'Replace failed';
    const errorCode = (parsedBody as { error_code?: string } | undefined)?.error_code;
    throw new ApiError(r.status, detail, errorCode, parsedBody);
  }
  return r.json();
}

export function deleteRunAsset(
  runId: number,
  assetId: number,
  options?: { force?: boolean; signal?: AbortSignal },
): Promise<void> {
  const query = options?.force === true ? '?force=true' : '';
  return api.delete(`/api/runs/${runId}/assets/${assetId}${query}`, {
    signal: options?.signal,
  });
}
