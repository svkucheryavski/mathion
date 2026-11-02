import { api } from '../lib/api';
import { ApiError } from '../lib/api';
import { fetchListSwallow403 } from '../lib/studentMiniProjects';
import type {
  BlockContent,
  ItemStateEntry,
  QuizSubmitResponse,
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
  // D80: the names of the teachers of the student's run (the course page's
  // Teachers card). Reference only: any failed load leaves [] (no card) and
  // never fails the course load.
  teachers: string[];
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
      const [content, state, miniProjectsByBlockId, teachers] = await Promise.all([
        api.get<VersionContent>(`/api/versions/${my.version_id}/content`, { signal: controller.signal }),
        api.get<VersionState>(`/api/versions/${my.version_id}/state`, { signal: controller.signal }),
        fetchListSwallow403(startedSlug, controller.signal),
        api.get<{ full_name: string }[]>(`/api/courses/${encodeURIComponent(startedSlug)}/my-teachers`, { signal: controller.signal })
          .then((rows) => rows.map((r) => r.full_name), () => [] as string[]),
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
        teachers,
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

// C13: a submit's attempt is written into the store, so a remounted quiz
// shows the right attempts left, or loads the reveal once they are used up.
// D89: the answers sent go in too, so it can show that result again, as the
// backend's own `last_answers` does after a reload.
// A page load straight onto a never-visited quiz records the visit before the
// course is loaded, so the entry may be missing: create it, as a visit does.
export function recordQuizAttempt(
  res: QuizSubmitResponse,
  answers: Record<string, number[] | string>,
): void {
  if (currentCourse.value === null) return;
  const items = currentCourse.value.state.items;
  const key = String(res.item_id);
  items[key] ??= {
    is_covered: true,
    time_spent: 0,
    last_visited_at: new Date().toISOString(),
    attempt_count: 0,
    max_attempts: res.max_attempts,
    last_score: null,
    last_answers: null,
  };
  // Read it back: the assignment evaluates to the literal, not the proxy.
  const entry = items[key]!;
  entry.attempt_count = res.attempt_count;
  entry.max_attempts = res.max_attempts;
  entry.last_score = { correct: res.score_correct, total: res.score_total };
  entry.last_answers = answers;
  entry.is_covered = true;
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
      time_spent: 0,
      last_visited_at: new Date().toISOString(),
      attempt_count: 0,
      max_attempts: currentCourse.value.version.max_quiz_attempts,
      last_score: null,
      last_answers: null,
    };
  }
}

// Test seam — bypass loadCourse so unit tests can set fixture state directly.
export function __test__setSlots(snap: CourseSnapshot | null): void {
  currentCourse.value = snap;
}
