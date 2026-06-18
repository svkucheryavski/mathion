// Student-facing mini-projects wire module.
//
// Owns the four endpoints behind the student MP slice:
//
//   - fetchListSwallow403  → course-view block-link cache (loadCourse fan-out)
//   - fetchDetail          → detail page initial + visibilitychange refetch
//   - submit               → detail page submit-section POST
//   - rewriteExternalLinks → DOM post-processor for assignment_html (F8)
//
// REASON_LABELS is the single source of truth for the copy shown when the
// backend returns `can_submit: false` with a `can_submit_reason_if_not`
// literal. Keys MUST stay in sync with the union in
// `StudentMiniProjectDetail.can_submit_reason_if_not` (see ./types.ts).

import { api, ApiError } from './api';
import { emitUnauthorized } from './events';
import type { StudentMiniProjectListItem, StudentMiniProjectDetail, LatestStatus } from './types';

// Re-export so consumers (StatusPill.svelte and neighbors) can import the
// type alongside LATEST_STATUS_META from a single module.
export type { LatestStatus };

export const REASON_LABELS = {
  mp_not_visible: 'This mini-project is no longer available.',
  pending_group_assignment: "Your teacher will assign you to a group soon. You'll be able to submit then.",
  group_disabled: 'Your group is disabled. Contact your teacher.',
  already_accepted: 'Your project has been accepted — no further submission needed.',
  awaiting_evaluation: 'Your previous submission is awaiting evaluation.',
  hard_deadline_passed: 'The submission deadline has passed.',
  resubmission_deadline_passed: 'The resubmission deadline has passed.',
} as const;

export type CanSubmitReason = keyof typeof REASON_LABELS;

// LATEST_STATUS_META — single source of truth for pill label + CSS class +
// leading non-color glyph token (spec §5 + C14 colorblind signal). Consumed
// by StatusPill.svelte (D1) and any other UI that surfaces latest_status
// (e.g. D2 MiniProjectLink). Keep keys in sync with the LatestStatus union.
export const LATEST_STATUS_META = {
  pending_group_assignment: { label: 'Pending group', cls: 'pill-neutral', token: '…' },
  not_submitted: { label: 'Not yet submitted', cls: 'pill-neutral', token: '·' },
  awaiting_evaluation: { label: 'Awaiting evaluation', cls: 'pill-info', token: '~' },
  rejected: { label: 'Rejected', cls: 'pill-danger', token: '×' },
  major_revision: { label: 'Needs revision (major)', cls: 'pill-warning', token: '!' },
  minor_revision: { label: 'Needs revision (minor)', cls: 'pill-warning', token: '!' },
  accepted: { label: 'Accepted', cls: 'pill-success', token: '✓' },
} as const satisfies Record<LatestStatus, { label: string; cls: string; token: string }>;

// Fetches the course-level MP list. 403 means "you're enrolled but no active
// published run yet" and is the ONLY status this swallow swallows — see §7
// + F16: 401 triggers auth-bounce via api.ts, 5xx surfaces as a page-level
// error in CourseView, AbortError propagates so loadCourse's outer
// try/catch (stores/currentCourse.svelte.ts:63) can filter it.
//
// Returns a `Record<string, StudentMiniProjectListItem>` keyed by
// `String(block_id)` — the consumer (`miniProjectsByBlockId` in
// CourseSnapshot) looks up MPs by block_id (NOT mp_id) since each block in
// the rendered course view knows its own block.id, not the MP id.
export async function fetchListSwallow403(
  slug: string,
  signal?: AbortSignal,
): Promise<Record<string, StudentMiniProjectListItem>> {
  try {
    const list = await api.get<StudentMiniProjectListItem[]>(
      `/api/courses/${encodeURIComponent(slug)}/mini-projects`,
      { signal },
    );
    const map: Record<string, StudentMiniProjectListItem> = {};
    for (const item of list) map[String(item.block_id)] = item;
    return map;
  } catch (e: unknown) {
    if (e instanceof ApiError && e.status === 403) return {};
    throw e;
  }
}

// Fetches the detail payload for a single mini-project. NO swallow: 401
// (auth-bounce via api.ts), 403 (run unpublished mid-session), 404 (block
// removed / IDOR), 5xx, and network errors ALL propagate so the detail page
// can render the appropriate full-page banner per §6 step 7.
export function fetchDetail(
  courseSlug: string,
  blockSlug: string,
): Promise<StudentMiniProjectDetail> {
  return api.get<StudentMiniProjectDetail>(
    `/api/courses/${encodeURIComponent(courseSlug)}/blocks/${encodeURIComponent(blockSlug)}/mini-project`,
  );
}

// POST the picked PDF as the next submission for this MP.
//
// Mirrors the non-2xx + 401 branches of lib/evaluations.ts:createEvaluation
// — raw fetch (FormData body), manual 401 emit + ApiError construction, all
// non-2xx surface as ApiError so the detail page state machine can branch on
// 409 (state changed) vs other 4xx vs 5xx. Network errors (TypeError from
// raw fetch, DOMException AbortError) propagate naturally per spec F17 —
// the caller's catch distinguishes ApiError vs the rest.
export async function submit(mpId: number, file: File): Promise<void> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch(`/api/mini-projects/${mpId}/submissions`, {
    method: 'POST',
    body: fd,
    credentials: 'include',
    headers: { 'X-Requested-With': 'mathion' },
  });
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
    const detail = (parsedBody as { detail?: string } | undefined)?.detail ?? 'Submission failed';
    const errorCode = (parsedBody as { error_code?: string } | undefined)?.error_code;
    throw new ApiError(r.status, detail, errorCode, parsedBody);
  }
}

// Defense-in-depth pass over assignment_html after Svelte commits {@html}.
// `nh3.clean` already permits teacher-authored <a href="https://..."> tags;
// this walker adds `target="_blank" rel="noopener noreferrer"` to anything
// that looks external so a click can't accidentally hijack the session
// cookie and so external links open in a new tab. Same-origin asset URLs
// (`/api/runs/...`), `mailto:`, and `tel:` are untouched — teachers remain
// the authoring trust boundary (F8/L1/M7). Svelte's `$effect` is the
// change trigger; no MutationObserver here.
export function rewriteExternalLinks(container: HTMLElement): void {
  const anchors = container.querySelectorAll('a');
  for (const a of anchors) {
    const href = a.getAttribute('href');
    if (href === null) continue;
    if (
      href.startsWith('http://') ||
      href.startsWith('https://') ||
      href.startsWith('//')
    ) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  }
}
