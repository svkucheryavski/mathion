// Module-scoped reactive state for the Versions page (course + version list)
// with a stale-response guard, mirroring `currentEditorVersion.svelte.ts`.
//
// Why this is its own module: VersionsPage's prop `courseSlug` is updated in
// place by App.svelte rather than remounting on `/courses/a/edit → /courses/b/edit`.
// A naive `load()` that pins the slug at function start still races: a slow
// 'a' can land AFTER a fast 'b' and clobber 'b' state with 'a' results. The
// guard increments a generation counter on every load and on reset; only the
// load whose generation still equals the current generation is allowed to
// write its result.

import { api, ApiError } from './api';
import type { Course, Version } from './types';

export const versionsPageState = $state<{
  course: Course | null;
  versions: Version[];
  loading: boolean;
  error: { status: number; message: string } | null;
}>({ course: null, versions: [], loading: false, error: null });

let loadGen = 0;

export async function loadVersionsPage(slug: string): Promise<void> {
  const myGen = ++loadGen;
  versionsPageState.loading = true;
  versionsPageState.error = null;
  try {
    const fetched = await api.get<Course>(`/api/courses/by-slug/${encodeURIComponent(slug)}`);
    if (myGen !== loadGen) return;
    const list = await api.get<Version[]>(`/api/courses/${fetched.id}/versions`);
    if (myGen !== loadGen) return;
    versionsPageState.course = fetched;
    versionsPageState.versions = list;
  } catch (e) {
    // Only surface the error if this load is still the current one. A stale
    // failure for slug 'a' must NOT overwrite a successful 'b' state.
    if (myGen !== loadGen) return;
    versionsPageState.error = e instanceof ApiError
      ? { status: e.status, message: e.displayMessage }
      : { status: 500, message: 'Could not load.' };
  } finally {
    // Only the current generation is allowed to flip loading=false. A stale
    // generation's finally clobbering loading would let a follow-up load's
    // loading=true be reset before its own success arrives.
    if (myGen === loadGen) versionsPageState.loading = false;
  }
}

export function resetVersionsPageState(): void {
  loadGen++;
  versionsPageState.course = null;
  versionsPageState.versions = [];
  versionsPageState.loading = false;
  versionsPageState.error = null;
}
