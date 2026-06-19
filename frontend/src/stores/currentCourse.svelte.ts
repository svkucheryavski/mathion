import { api } from '../lib/api';
import { ApiError } from '../lib/api';
import { fetchListSwallow403 } from '../lib/studentMiniProjects';
import type {
  BlockContent,
  ItemStateEntry,
  StudentMiniProjectListItem,
  VersionContent,
  VersionState,
} from '../lib/types';

type CourseSnapshot = {
  slug: string;
  versionId: number;
  course: { id: number; slug: string; name: string };
  version: VersionContent['version'];
  blocks: BlockContent[];
  state: VersionState;
  // Populated by loadCourse from fetchListSwallow403. The detail page's F6
  // guard checks `item` presence before mutating, so an empty map (e.g.,
  // 403-swallow case) is safe.
  miniProjectsByBlockId: Record<string, StudentMiniProjectListItem>;
};

export const currentCourse = $state<{ value: CourseSnapshot | null }>({ value: null });

type InflightSlot = {
  slug: string;
  promise: Promise<void>;
  controller: AbortController;
};

let inflight: InflightSlot | null = null;

/**
 * Single-flight + abortable course load.
 *
 * - If an in-flight load for the same slug exists, reuse its promise.
 * - If an in-flight load for a different slug exists, abort it and start a
 *   new one (the new load assigns inflight before awaiting).
 * - Stale-write guard: when a load resolves, compare its captured
 *   `startedSlug` against `inflight?.slug` — if they no longer match, discard
 *   the result silently and do NOT touch `currentCourse.value` (a newer load
 *   is already in flight). Comparing against `currentCourse.value?.slug`
 *   would be wrong: the store may be `null` mid-load.
 */
export function loadCourse(slug: string): Promise<void> {
  if (inflight?.slug === slug) return inflight.promise;
  if (inflight !== null) inflight.controller.abort();

  const startedSlug = slug;
  const controller = new AbortController();
  const promise = (async () => {
    try {
      const my = await api.get<{ course_slug: string; course_id: number; version_id: number; is_active: boolean }>(
        `/api/courses/${encodeURIComponent(startedSlug)}/my-version`,
        { signal: controller.signal },
      );
      const [content, state, miniProjectsByBlockId] = await Promise.all([
        api.get<VersionContent>(`/api/versions/${my.version_id}/content`, { signal: controller.signal }),
        api.get<VersionState>(`/api/versions/${my.version_id}/state`, { signal: controller.signal }),
        fetchListSwallow403(startedSlug, controller.signal),
      ]);
      // Stale-write guard.
      if (inflight?.slug !== startedSlug) return;
      currentCourse.value = {
        slug: startedSlug,
        versionId: my.version_id,
        course: { id: my.course_id, slug: content.course.slug, name: content.course.name },
        version: content.version,
        blocks: content.blocks,
        state,
        miniProjectsByBlockId,
      };
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (e instanceof ApiError) throw e;
      throw e;
    } finally {
      if (inflight?.slug === startedSlug) inflight = null;
    }
  })();

  inflight = { slug: startedSlug, promise, controller };
  return promise;
}

export function clearCourse(): void {
  if (inflight !== null) {
    inflight.controller.abort();
    inflight = null;
  }
  currentCourse.value = null;
}

export function markItemCovered(itemId: number): void {
  if (currentCourse.value === null) return;
  const entry = currentCourse.value.state.items[String(itemId)];
  if (entry === undefined) return;
  entry.is_covered = true; // deep mutation: $state proxies make this reactive
}

export function recordItemVisit(itemId: number): void {
  if (currentCourse.value === null) return;
  const entry: ItemStateEntry | undefined = currentCourse.value.state.items[String(itemId)];
  if (entry !== undefined) {
    entry.last_visited_at = new Date().toISOString();
  } else {
    // First visit — populate the slot so resume-here heuristic sees it.
    currentCourse.value.state.items[String(itemId)] = {
      is_covered: false,
      time_spent_seconds: 0,
      last_visited_at: new Date().toISOString(),
      last_answers: null,
      attempt_count: 0,
      score_correct: null,
      score_total: null,
    };
  }
}

// Test seam — bypass loadCourse so unit tests can set fixture state directly.
export function __test__setSlots(snap: CourseSnapshot | null): void {
  currentCourse.value = snap;
}
