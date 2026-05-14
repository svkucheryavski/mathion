// Module-scoped reactive store for the version currently open in the admin
// editor. Holds the full AdminTree (course + version + blocks/sequences/items)
// fetched from `/api/versions/{vid}/admin-tree`. Pages subscribe via
// `currentEditorVersion.value` (reactive $state property), call `loadAdminTree`
// on mount, and `clearEditorVersion` on unmount.
//
// Single-flight: concurrent calls for the same versionId share one in-flight
// promise. `force: true` bypasses this for post-mutation refetches.
//
// Stale-guard: a `token` counter increments on every load and on clear; only
// the request whose token still equals the current token writes its result.
// This keeps a slow response for an older versionId from clobbering a newer
// one, and lets `clearEditorVersion` invalidate any in-flight request.
//
// Outcome contract (D-C1): `loadAdminTree` resolves to one of three explicit
// outcomes so callers can distinguish "discarded — your refetch was
// invalidated by a newer navigation/clear" from "error — the GET actually
// failed". Without this, a page that calls save() → refetch → unmount races
// onDestroy(clearEditorVersion()) and would otherwise mistake the discarded
// refetch for a refetch failure (value === null after clear) and toast the
// misleading "refresh failed — reload to see latest" message.

import { api, ApiError } from '../lib/api';
import type { AdminTree } from '../lib/types';

export type LoadResult = 'ok' | 'error' | 'discarded';

export const currentEditorVersion = $state<{
  value: AdminTree | null;
  loading: boolean;
  error: string | null;
}>({ value: null, loading: false, error: null });

let inflight: { versionId: number; token: number; promise: Promise<LoadResult> } | null = null;
let token = 0;

export async function loadAdminTree(
  versionId: number,
  opts: { force?: boolean } = {},
): Promise<LoadResult> {
  if (!opts.force && inflight && inflight.versionId === versionId) {
    return inflight.promise;
  }
  const myToken = ++token;
  currentEditorVersion.loading = true;
  currentEditorVersion.error = null;

  const promise: Promise<LoadResult> = (async () => {
    try {
      const tree = await api.get<AdminTree>(`/api/versions/${versionId}/admin-tree`);
      if (myToken !== token) return 'discarded';
      currentEditorVersion.value = tree;
      return 'ok';
    } catch (e) {
      if (myToken !== token) return 'discarded';
      currentEditorVersion.error =
        e instanceof ApiError ? e.displayMessage : 'Could not load version.';
      return 'error';
    } finally {
      if (myToken === token) {
        currentEditorVersion.loading = false;
        if (inflight && inflight.token === myToken) inflight = null;
      }
    }
  })();

  inflight = { versionId, token: myToken, promise };
  return promise;
}

export function clearEditorVersion(): void {
  token++;
  inflight = null;
  currentEditorVersion.value = null;
  currentEditorVersion.error = null;
  currentEditorVersion.loading = false;
}
