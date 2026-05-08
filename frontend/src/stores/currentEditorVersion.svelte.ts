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

import { api, ApiError } from '../lib/api';
import type { AdminTree } from '../lib/types';

export const currentEditorVersion = $state<{
  value: AdminTree | null;
  loading: boolean;
  error: string | null;
}>({ value: null, loading: false, error: null });

let inflight: { versionId: number; token: number; promise: Promise<void> } | null = null;
let token = 0;

export async function loadAdminTree(
  versionId: number,
  opts: { force?: boolean } = {},
): Promise<void> {
  if (!opts.force && inflight && inflight.versionId === versionId) {
    return inflight.promise;
  }
  const myToken = ++token;
  currentEditorVersion.loading = true;
  currentEditorVersion.error = null;

  const promise: Promise<void> = (async () => {
    try {
      const tree = await api.get<AdminTree>(`/api/versions/${versionId}/admin-tree`);
      if (myToken !== token) return;
      currentEditorVersion.value = tree;
    } catch (e) {
      if (myToken !== token) return;
      currentEditorVersion.error =
        e instanceof ApiError ? e.displayMessage : 'Could not load version.';
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
