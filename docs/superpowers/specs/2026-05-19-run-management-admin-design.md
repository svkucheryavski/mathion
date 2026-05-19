# Run Management (Admin Surface) — Design

**Date:** 2026-05-19
**Status:** Brainstorm-validated and reviewer-corrected (three rounds); ready for implementation plan.
**Scope:** Mathion frontend — admin-only run management for a single course.

> **Revision notes**
>
> **R1 (post-round-1):** Version is auto-pinned at run creation (no version picker — backend does not accept `version_id` on `RunCreate`/`RunUpdate`); `RunStudentResponse` uses `user_email`/`user_full_name` (not `email`/`full_name`); add-student is pre-validated client-side against the loaded roster before POST (backend silently re-buckets duplicates, which we hide); list-runs ordering is `start_date ASC`; `api.delete` (not `api.del`); route params use the codebase's descriptive camelCase convention (`:courseSlug`/`:runId`); `lib/runs.ts` splits into four resource modules; `RunDetailPage` adopts a stale-guard pattern.
>
> **R2 (post-round-2):** Expanded the backend error matrix (group-delete "has submissions", run-PATCH 409s including mini-projects/submissions/disabled-version, bulk-move whole-call 400/409, publish on disabled version); pinned the stale-guard shape (single commit gate over `Promise.all`); added explicit `App.svelte` componentMap registration step; added `runId` string→int coercion with validity guard mirroring `ItemEditPage`; adopted `makeDirtyTracker` from `lib/dirty.svelte.ts` for inline edits (replaces the imperative pristine-capture pattern); switched `pendingGroupId` to `SvelteMap<number, number | null>` for reliable reactivity; pinned `(invited)` badge to a session-scoped `Set<userId>` (replaces wall-clock check); added concrete UX for the bulk-op retry dropdown, red-border lifecycle, chunk failure set composition, header checkbox tri-state, and roster prefilter pill; CourseCard restructure: mirror the mixed-admin pattern (card-as-div, title-as-`<a>`, action buttons in a row); task count split 9 → 12 (T5/T7/T8 each into a+b); enumerated ~10 specific previously-coarse test bullets. Fixed the `VersionResponse.published_at` rationale (it does exist; we deliberately use `created_at` because not all pinned versions are published).
>
> **R3 (post-round-3):** **F1=A — already-enrolled with empty `group` cell preserves the student's current group** via a client-side lookup (`existingRoster.find(...).group_id → groups.find(...).name`) and sends that name in the batch row; backend `enroll_user_in_run` unconditionally overwrites `group_id`, so omitting the field would silently unassign the student. Corrected `makeDirtyTracker` API usage to match the actual `lib/dirty.svelte.ts` shape: init with an object literal (NOT a getter), bind to `tracker.current.<field>` (NOT `tracker.current`), `reset(next)` requires a snapshot argument. Corrected toast-module references throughout: actual module is `stores/toasts.svelte.ts` with `pushToast(message: string, kind?: 'info' | 'error' | 'success')`; `lib/toasts.ts` does not exist. Added a `pendingGroupId` prune-on-students-refetch rule (drop entries whose key is no longer in `students[*].user_id` after any refetch). Clarified that the bulk-op Retry button re-enters the same chunked dispatcher (so retry of >200 cancelled rows re-chunks correctly); the wrapper's per-call `<=200` cap is preserved. Added try/catch + `loadError` placeholder to the stale-guard pseudo-code. Replaced the `pendingTab` `$effect`-write idiom with a direct `gotoTab(tab, prefilter?)` function (removes the `pendingTab` state entirely). Added disabled-version banner derivation (`versions.find(...)`) with mid-load and miss fallbacks. Tolerant focus-restore in `NewRunModal` when the trigger unmounts post-navigate. Pinned TZ to `America/New_York` for the DST roster-status test (matches the `2026-03-08` spring-forward date). Documented the conditional-spread JSON idiom for the optional `group` field in batch rows.

---

## 1. Goals and scope

Build the admin-facing UI for managing course **runs** (cohorts of students who use a specific course version over a date range). The backend (Phases 7a + 7d) is already shipped: runs, run-teachers, groups, run-students, and bulk roster operations.

This spec covers everything an admin needs to set up and operate a run end-to-end:

- Create / edit / delete runs (delete only when unpublished AND roster is empty AND no submissions).
- Configure run settings (title, dates, `groups_enabled`).
- Assign and remove teachers.
- Manage groups (when `groups_enabled`): create / rename / delete.
- Manage roster: add students individually, bulk-import from spreadsheet paste, edit group assignments inline, bulk-move and bulk-delete.
- Publish / unpublish a run, with a pre-validation readiness checklist.

**Out of scope (deferred to a follow-up spec):**
- Teacher-facing surface (read-only monitoring, dashboards, per-student progress).
- Run analytics, gradebook export, attendance.
- Per-group settings beyond name (e.g., schedule, location).
- Re-pinning a run to a different version (backend doesn't support it).
- Force-delete a run with roster intact (admin must clear roster first).
- Toggling `is_disabled` on groups via UI.

---

## 2. Routes and navigation

**Two routes added to `src/routes.ts`** plus **componentMap registration in `src/App.svelte`**:

| Path | Component | Auth | Access |
|---|---|---|---|
| `/courses/:courseSlug/runs` | `RunListPage.svelte` | yes | course admin only |
| `/courses/:courseSlug/runs/:runId` | `RunDetailPage.svelte` | yes | course admin only |

Both routes sit alongside the existing `/courses/:courseSlug/edit` admin surface. Route param names use the codebase's descriptive camelCase convention (matching `:courseSlug`, `:versionId`, `:itemId` in `routes.ts`); the router's param extractor (`router.svelte.ts:181`) spreads them as props (`<Comp {...matched.params} />`), so each component's `$props()` typing must use exactly these names.

**Param coercion.** Route params arrive as strings. `RunDetailPage` mirrors the `ItemEditPage` precedent (`ItemEditPage.svelte:20-24`):

```ts
let { courseSlug, runId }: { courseSlug: string; runId: string } = $props();
const rid = $derived(Number(runId));
// Use Number.isInteger(rid) && rid > 0 as the validity guard before fetching.
```

**componentMap registration.** Adding rows to `routes.ts` is not sufficient — `App.svelte:14-25` imports each page and registers it in a `componentMap` lookup. Both new pages must be added there (an implementation plan task explicitly covers this).

**Page-level access check.** On mount, each page calls `GET /api/courses/by-slug/{slug}`. The backend response semantics are:

- `200 OK` with `CourseResponse` (where `is_admin === true`) → proceed with `course.id`.
- `403 Forbidden` → user is not a course admin. Redirect to `/courses/:courseSlug` (the student-facing course view) via the router.
- `404 Not Found` → course doesn't exist. Render an inline error placeholder with a link to `/courses` (the course list).
- Any other error → render inline error placeholder.

(The backend `_is_admin_for` check in `courses.py:78` raises 403 rather than returning `is_admin: false`. The spec relies on the 403 specifically.)

No global session role exists — admin status is always per-course. All subsequent calls use the numeric `course.id` from this response.

**Entry point — `CourseCard.svelte` restructure.** The current admin-only branch wraps the entire card in an `<a>` element (lines 12-25). To add a "Runs" button alongside "Edit" without nesting anchors, the admin-only branch is restructured to **mirror the existing mixed admin-enrolled branch (lines 32-56)**:

- Card root: `<div class="card">` (not `<a>`).
- Title: an inline `<a href={editHref}>` (preserves middle-click-to-open-new-tab).
- Action row: sibling `<button>` elements — `Edit` (navigates to `/courses/:courseSlug/edit`) and `Runs` (navigates to `/courses/:courseSlug/runs`).
- The whole-card hover style (`.card-link:hover`) does NOT apply; this is a deliberate UX trade-off explicit in the existing mixed-admin branch comment ("so we don't falsely advertise the whole card as clickable").
- The "Runs" button is gated on `course.is_admin === true`; if false, the button is not rendered.

**Breadcrumbs.**
- `RunListPage`: `Courses › {course.title} › Runs`
- `RunDetailPage`: `Courses › {course.title} › Runs › {run.title}`

The breadcrumb segments link to the parent surfaces.

---

## 3. Pages, components, and conventions

### 3.1 File layout

```
frontend/src/pages/runs/
  RunListPage.svelte
  RunDetailPage.svelte

frontend/src/components/runs/
  NewRunModal.svelte
  RunOverviewTab.svelte
  RunTeachersTab.svelte
  RunGroupsTab.svelte
  RunRosterTab.svelte
  RosterImportModal.svelte

frontend/src/lib/
  runs.ts          # run CRUD + publish/unpublish
  runTeachers.ts   # run-teachers CRUD
  runGroups.ts     # groups CRUD + getCapacityClass helper
  runRoster.ts     # students CRUD + batch + bulk-move + bulk-delete
  runStatus.ts     # pure: derive 'draft' | 'upcoming' | 'active' | 'ended'
  csv.ts           # pure: paste-CSV parser (also handles already-enrolled detection)

frontend/src/tests/
  runs.test.ts
  runTeachers.test.ts
  runGroups.test.ts
  runRoster.test.ts
  runStatus.test.ts
  csv.test.ts
  RunListPage.svelte.test.ts
  NewRunModal.svelte.test.ts
  RunDetailPage.svelte.test.ts
  RunOverviewTab.svelte.test.ts
  RunTeachersTab.svelte.test.ts
  RunGroupsTab.svelte.test.ts
  RunRosterTab.svelte.test.ts
  RosterImportModal.svelte.test.ts
```

**Routes** live under `pages/runs/` (sibling to `pages/editor/`), not under a new `pages/admin/` subtree, to match the established convention.

**Types.** Backend-mirror types and shared discriminants (`RunResponse`, `GroupResponse`, `BulkRosterErrorCode`, etc.) are added to `lib/types.ts` — the existing home for shared type definitions consumed by both lib modules and UI components. Rationale: many of these types are referenced from multiple modules (`GroupResponse` is consumed by `runGroups.ts`, `runRoster.ts`, and three UI components; `BulkRosterErrorCode` by `runRoster.ts` and `RunRosterTab.svelte`). Helper-internal types that don't cross module boundaries (the CSV parser's `CsvRow`/`CsvParseResult`) live alongside their helpers.

(Note: this is a slight departure from `lib/assets.ts`'s pattern of declaring `AssetResponse` inline; the run-management types are higher-fanout, which warrants the central location.)

### 3.2 Loading conventions and stale-guard

Every list rendered in this feature follows the same three-state convention:

- **Loading:** show a muted `"Loading…"` placeholder until the underlying `$state<Resource[] | null>` transitions from `null` to an array. Buttons that trigger fetches show a disabled state with a small spinner glyph (or `…` suffix) during in-flight mutations.
- **Empty:** when the array is `[]`, show a one-line empty-state message specific to the list (see each tab).
- **Loaded:** render normally.

**Stale-guard shape — single commit gate.** `RunDetailPage` performs six fetches; concurrent navigation must not let a stale set of results overwrite a fresh one. The chosen pattern (precedent: `versionsPageLoader.svelte.ts:24-48`):

```ts
// Component-scoped state inside RunDetailPage.
let course = $state<CourseResponse | null>(null);
let run = $state<RunResponse | null>(null);
let versions = $state<VersionResponse[] | null>(null);
let teachers = $state<RunTeacherResponse[] | null>(null);
let groups = $state<GroupResponse[] | null>(null);
let students = $state<RunStudentResponse[] | null>(null);
let loadError = $state<ApiError | null>(null);

let loadToken = 0;

async function loadAll(slug: string, rid: number) {
  const myToken = ++loadToken;
  try {
    // First: gate on by-slug (admin gate, course resolution).
    const c = await api.get<CourseResponse>(`/api/courses/by-slug/${slug}`);
    if (myToken !== loadToken) return;  // stale; discard.
    // Then: parallel fetch of the 5 nested resources.
    const [r, vs, ts, gs, ss] = await Promise.all([
      getRun(rid),
      listVersions(c.id),
      listRunTeachers(rid),
      listGroups(rid),
      listRunStudents(rid),
    ]);
    if (myToken !== loadToken) return;  // stale; discard the whole batch.
    // Single commit step — all six slices assigned together.
    course = c; run = r; versions = vs; teachers = ts; groups = gs; students = ss;
    loadError = null;
  } catch (e) {
    if (myToken !== loadToken) return;  // stale failure; ignore.
    // Surface a single error placeholder for the whole page. Specific status
    // handling (403 redirect on by-slug, 404 → "Run not found") is applied
    // before assigning loadError — see access-check rules in §3.3/§3.5.
    loadError = e as ApiError;
  }
}
```

- **Component-scoped, not module-scoped.** The state lifecycle ties to `RunDetailPage`'s mount; nothing persists across navigation away.
- **Single commit gate.** All six slices are assigned in one statement after the `Promise.all` resolves, gated by the token check. This avoids the more complex per-slice guard that the simpler precedent (`currentEditorVersion.svelte.ts`) uses for a single resource.
- **Re-fetch on `runId` change.** An `$effect(() => { void rid; void slug; loadAll(slug, rid); })` re-triggers the load if route params change while the component instance is preserved (App.svelte may reuse the same instance across `/runs/1 → /runs/2`).
- **Tab state reset on `runId` change.** A separate `$effect(() => { void rid; activeTab = 'overview'; rosterPrefilter = null; })` resets transient UI state when navigating between runs.

**Mutations re-fetch only the affected slices.** Each mutation handler awaits its API call, then re-fetches the affected slice(s) (e.g., `bulkMoveRunStudents` → refetch both `students` and `groups`). Refetches do not bump `loadToken`; they're scoped to a single slice and write to that `$state` directly.

### 3.3 `RunListPage.svelte`

**Path:** `/courses/:courseSlug/runs`

**On mount:**
- First: `GET /api/courses/by-slug/{slug}` — admin gate + `course.id`. On 403, redirect; on 404, inline error.
- Then in parallel (using `course.id`):
  - `GET /api/courses/{course.id}/runs` — runs list.
  - `GET /api/courses/{course.id}/versions` — for resolving the Version column's display label.

**Header bar:**
- Left: breadcrumb (`Courses › {course.title} › Runs`).
- Right: `New run` button → opens `NewRunModal`.

**Table (rendered in backend order — `start_date` ASC, matching `runs.py:65-67`):**

| Column | Source / behaviour |
|---|---|
| Title | `run.title`; click navigates to `/courses/:courseSlug/runs/:runId`. |
| Status | Badge from `runStatus(run)`: `Draft` / `Upcoming` / `Active` / `Ended`. |
| Version | Resolved label from the `{id → label}` map. Label = `v{idx+1} ({created_at YYYY-MM-DD})` where `idx` is the position in the versions array sorted by `created_at`. We use `created_at` (not `published_at`) because `RunResponse.version_id` may point to a draft version (uncommon but possible if backend pinned it before publish). Note: `VersionResponse.published_at` does exist (`schemas.py:57`); we choose `created_at` for stable labels regardless of publish state. |
| Start | `run.start_date`, formatted as `YYYY-MM-DD`. |
| End | `run.end_date`, formatted as `YYYY-MM-DD`. |
| Actions | `Open` (link), `Delete` (only when `!is_published`; inline confirm; see §6 for 409 handling). |

**Frontend does NOT re-sort.** The backend's ordering is the source of truth; tests pass fixtures in the backend's expected order.

**Empty state:** centered message "No runs yet" + a CTA "Create the first run" that opens `NewRunModal`.

**No counts column.** `RunResponse` does not include teacher/student counts; the Overview tab is where counts are visible.

**No filters or sort controls in v1.**

### 3.4 `NewRunModal.svelte`

Opened from `RunListPage`. Centered overlay with opaque backdrop. Closes via Escape, backdrop click, or X button.

**Focus management:** on open, store the previously-focused element; autofocus the Title input; trap Tab inside the modal (last → first on Tab, first → last on Shift-Tab); on close (any path), restore focus to the stored element if it is still in the DOM (`previousFocus?.isConnected`). On the success-then-navigate path the trigger (the `New run` button on `RunListPage`) unmounts as the route changes — the restore call no-ops in that case (browser defaults focus to `document.body`). Tests assert the restore is *attempted* with the stored element AND that an unmounted trigger does not throw.

**Fields:**

| Field | Type | Validation |
|---|---|---|
| Title | text, autofocus, max 200 | non-empty after trim |
| Start date | `<input type="date">` | required |
| End date | `<input type="date">` | required; `end >= start` |
| Groups enabled | checkbox, default off | none; helper text: "Enable to organize students into groups. Locked once the run is published." |

**Version handling.** Backend auto-pins newest published course version at creation (`runs.py:42` calls `get_newest_published_version`). The modal does NOT include a version picker; instead, a read-only `Version` row displays `"Will use {versionLabel}"` (resolved from the versions list). If no published version exists, the `New run` button on `RunListPage` is disabled with a tooltip: `"Publish a course version before creating a run."` Same disabled state shown inside the modal as a banner if it's opened anyway.

**Submit:** `POST /api/courses/{course.id}/runs` with `{title, start_date, end_date, groups_enabled}`. No `version_id`.

- On success: close modal, navigate to `/courses/:courseSlug/runs/:newRunId`.
- On client validation failure: inline error under the offending field; no API call.
- On API error: banner at top of modal body with `e.displayMessage`. 401 handled globally.

### 3.5 `RunDetailPage.svelte`

**Path:** `/courses/:courseSlug/runs/:runId`

**Mount and re-load.** See §3.2 for the stale-guard pattern and `runId` coercion. The first fetch is `GET /api/courses/by-slug/{slug}` (admin gate + breadcrumb title); after success, five parallel fetches gated by a single token, then a single commit step.

If the `Promise.all` fails (e.g., 404 on `/api/runs/{rid}` because the run was deleted in another tab), render a single error placeholder for the whole page; do not render the tab UI with partial data.

**Header bar (sticky):**
- Left: breadcrumb.
- Right: status badge + `Publish` / `Unpublish` button.
  - When `!is_published`: button reads `Publish`. Disabled when any readiness violation exists, with tooltip listing the first violation. Click triggers `POST /api/runs/{runId}/publish`. After success, re-fetch `run`.
  - When `is_published`: button reads `Unpublish`, always enabled. Click triggers inline confirm pair (`Confirm Unpublish` / `Cancel`) with warning: "Students will lose access immediately. Their progress data is preserved." After success, re-fetch `run`.

**Disabled-version banner.** Derived from `versions` + `run.version_id`:

```ts
const pinned = $derived(versions?.find(v => v.id === run?.version_id));
const showDisabledBanner = $derived(pinned?.is_disabled === true);
```

If `showDisabledBanner === true`, render a persistent yellow banner above the tabs: `"This run's course version is disabled. Re-enable it under Course Editor before publishing."` The Publish button is disabled with the same banner content as its tooltip (covers the backend's 409 "Cannot publish run on a disabled course version" by pre-empting it).

**Fallbacks.** While `versions === null` or `run === null` (mid-load), `pinned` is `undefined` and no banner renders — by §3.2's single-commit gate, both are non-null by the time the tabs render anyway. If `pinned === undefined` after commit (unexpected — would mean `run.version_id` doesn't appear in the course's versions list), fail safe to no banner (the backend's 409 on Publish still surfaces).

**Tabs (component-local state, no URL change):** `Overview | Teachers | Groups | Roster`.

- `let activeTab = $state<'overview' | 'teachers' | 'groups' | 'roster'>('overview')`.
- Tab state is NOT persisted in URL.
- Switching tabs does not re-fetch; the parent already has everything.
- Tab state is reset to `'overview'` on `runId` change (see §3.2).

**Cross-tab navigation handoff.** `RunDetailPage` holds one signal and one navigation helper (no `$effect`-write idiom — direct setter avoids the read-then-write reactive loop concern):

```ts
let rosterPrefilter: 'unassigned' | null = $state(null);

function gotoTab(tab: ActiveTab, prefilter?: 'unassigned' | null): void {
  if (prefilter !== undefined) rosterPrefilter = prefilter;
  activeTab = tab;
}
```

- The Overview-tab "N unassigned" hint button calls `gotoTab('roster', 'unassigned')` directly. The single-tick atomicity is structural (one synchronous function call sets both); no separate `pendingTab` state required.
- `rosterPrefilter` is cleared by `RunRosterTab` itself when the user types in the search box or clicks the prefilter pill's `×` (see §4.4) — assigning back to the parent's `$state` via a callback prop `onPrefilterClear={() => rosterPrefilter = null}`.

---

## 4. Tab content

### 4.1 `RunOverviewTab.svelte`

Three stacked sections:

**(a) Run summary card** — inline-editable fields using `makeDirtyTracker` from `lib/dirty.svelte.ts` (precedent: `ItemEditPage.svelte:117,185,266`).

**Tracker API contract.** `makeDirtyTracker<T extends Record<string, Allowed>>(initial: T)` takes an **object literal** snapshot (NOT a getter / function). The returned tracker exposes `tracker.current: T` (a `$state` proxy — bind into individual properties: `tracker.current.title`, NOT `tracker.current`), `tracker.isDirty: boolean`, and `tracker.reset(next: T): void` (REQUIRES an explicit snapshot argument). One tracker bundles all three inline-editable fields:

```ts
import type { DirtyTracker } from '../lib/dirty.svelte.ts';
import { makeDirtyTracker } from '../lib/dirty.svelte.ts';
import { pushToast } from '../stores/toasts.svelte.ts';

type RunForm = { title: string; start_date: string; end_date: string };

// `run` is the parent's $bindable RunResponse | null. Init the tracker once,
// the first time `run` becomes non-null after the stale-guard commit:
let tracker = $state<DirtyTracker<RunForm> | null>(null);
$effect(() => {
  if (run && tracker === null) {
    tracker = makeDirtyTracker<RunForm>({
      title: run.title,
      start_date: run.start_date,
      end_date: run.end_date,
    });
  }
});

// Template (per editable field):
// <input bind:value={tracker.current.title}
//        onblur={() => commitField('title')}
//        onkeydown={(e) => onFieldKey(e, 'title')} />

async function commitField(field: keyof RunForm) {
  if (!tracker || !run) return;
  const inFlightValue = tracker.current[field];
  const pristineValue = run[field];
  if (inFlightValue === pristineValue) return;   // not dirty for this field
  try {
    const updated = await updateRun(rid, { [field]: inFlightValue });
    run = updated;
    tracker.reset({
      title: updated.title,
      start_date: updated.start_date,
      end_date: updated.end_date,
    });
  } catch (e: any) {
    // Cross-field revert rule: revert this field to pristine ONLY if the user
    // has not since typed a new value into it. Compare current with the
    // in-flight snapshot.
    if (tracker.current[field] === inFlightValue) {
      tracker.current[field] = pristineValue;
    }
    pushToast(`Could not update ${field}: ${e.displayMessage}`, 'error');
  }
}

function onFieldKey(e: KeyboardEvent, field: keyof RunForm) {
  const el = e.currentTarget as HTMLInputElement;
  if (e.key === 'Enter') {
    el.blur();   // commits via onblur — exactly one PATCH (tracker already not-dirty after success)
  } else if (e.key === 'Escape' && tracker && run) {
    tracker.current[field] = run[field];   // revert this field
    el.blur();
  }
}
```

**Cross-field concurrency rule.** PATCHes are fire-and-forget per field; inputs are not disabled during in-flight PATCH. If the user starts editing another field before the previous PATCH resolves, both are independent. The cross-field revert rule above (compare `tracker.current[field]` with the captured `inFlightValue` before reverting) ensures we don't trample a value the user has typed in the meantime.

**Date input jsdom note.** Tests for date inline-edit must set `.value` as a string (not `valueAsDate`); jsdom's `valueAsDate` is partially broken. (Documented in §7 helper patterns.)

Read-only display fields in this section:
- Version label.
- Groups-enabled badge (`Groups: enabled` / `Groups: disabled`).
- `Created` timestamp (`YYYY-MM-DD HH:mm`).

**(b) Settings panel.**
- Groups-enabled checkbox — PATCH on change. Disabled when `is_published`, with tooltip: "Locked once the run is published. Unpublish to change." Disabled with a different tooltip on a run that has mini-projects (backend will 409): rare; covered by §6 fallthrough.
- **No version picker** (auto-pinned at creation per §3.4).
- Helper text under groups-enabled: "Disabling groups hides group assignments but does not delete them."

**(c) Publish readiness checklist.**

Three rows, each rendering `✓` (green), `✗` (red), or `—` (gray). Computed via `$derived` over already-loaded `teachers`, `groups`, `students`, `run`. The readiness check is purely structural — it does NOT depend on `now`. (Status display in the header uses `runStatus(now)`, but the Publish button's enabled state does not.)

| Check | Rule |
|---|---|
| At least one teacher | `✓` if `teachers.length >= 1`, else `✗`. |
| All students assigned to a group | If `!run.groups_enabled`, render `—`. Otherwise `✓` if every `student.group_id !== null`, else `✗` with hint button "N students unassigned" — clicking invokes `gotoTab('roster', 'unassigned')` on the parent. |
| All groups have 1–10 students | If `!run.groups_enabled`, render `—`. **If `groups.length === 0` AND `groups_enabled`, render `✗` with hint "No groups defined".** Otherwise `✓` if every `group.student_count >= 1 && <= 10`, else `✗` with a per-group breakdown. |

**Third-row advisory note.** Backend's publish endpoint enforces only `>10`, not `<1` (see `runs.py:201-209`). Frontend surfaces `<1` as advisory because empty groups indicate incomplete setup. If backend disagrees, the 409 handler (§6) takes over.

**(d) Danger zone.**
- `Delete run` button — visible only when `!is_published`. Inline confirm pair (`Confirm Delete` / `Cancel`).
- Click: `DELETE /api/runs/{runId}`.
  - 204 success → navigate back to `/courses/:courseSlug/runs`.
  - **409 "Run has students" → toast: "Clear roster before deleting." No force-delete UI in v1.**
  - **409 "Run has submissions" → toast: backend message verbatim.**
  - Other errors → toast with `e.displayMessage`.

### 4.2 `RunTeachersTab.svelte`

**Top form:**
- `email` input (max 254, autofocus) + `Add teacher` button.
- Submit: `POST /api/runs/{runId}/teachers` with `{email}`. Backend auto-creates the user if not found.
- After success: prepend the new row. If the response's `user_full_name === null`, add the new `user_id` to a component-local `justInvited = new SvelteSet<number>()`. Rows with `user_id` in `justInvited` show a small `(invited)` badge beside the email.
- 409 (already assigned) → inline error: "Teacher already assigned to this run."
- Other errors → inline error with `e.displayMessage`.

**`(invited)` badge lifecycle.** Session-scoped: `justInvited` is local component state, populated only by add-actions in the current session. The badge persists until navigation away from the page (or refresh); it does NOT use a wall-clock check. This avoids the surprise of a row showing the badge on every reload for 5 seconds.

**List:**
- Each row: `{user_full_name || '—'} ({user_email})` + optional `(invited)` badge + trash icon.
- Trash click: morphs to inline confirm pair (`Confirm Remove` / `Cancel`). Confirm → `DELETE /api/runs/{runId}/teachers/{user_id}`.
- Empty state: "No teachers assigned yet. Add one above."

### 4.3 `RunGroupsTab.svelte`

**When `run.groups_enabled === false`:** placeholder card "Groups are disabled for this run. Enable in Overview → Settings to manage groups." No interactive controls.

**When `groups_enabled === true`:**

**Top form:**
- `name` input (max 80) + `Add group` button.
- Submit: `POST /api/runs/{runId}/groups` with `{name: name.trim()}`.
- Validation: non-empty after trim.
- 409 (name conflict) → inline error: "A group with that name already exists in this run."

**List (ordered by name ASC, matching backend `groups.py:44`):**
- Each row: name (inline-rename via `makeDirtyTracker` — same pattern as Title in §4.1), capacity badge `{student_count}/10` styled via `getCapacityClass(count)` (see §5.4 — pure helper in `lib/runGroups.ts`, tested in `tests/runGroups.test.ts`), trash icon.
- Capacity classes:
  - `0` → CSS class `empty` (badge text: `"empty"`, italic gray).
  - `1–7` → CSS class `ok` (badge text: `"{n}/10"`, gray).
  - `8–9` → CSS class `warn` (amber).
  - `10` → CSS class `full` (red).
- Trash disabled (tooltip "Move students out before deleting.") when `student_count > 0`. On click for empty groups: inline confirm pair → `DELETE /api/groups/{group_id}`.
- 409 "Group has students; reassign or remove first" (race) → toast verbatim + refetch `groups` AND `students`.
- **409 "Group has submissions; disable instead" → toast verbatim** + refetch `groups`. (This 409 can fire even on `student_count === 0` groups that have historical submissions.)
- `GroupResponse.is_disabled` is read-only in v1. A disabled group's existing students keep their `group_id`; the dropdown in the Roster tab shows the disabled group as a passthrough option with `(disabled)` badge but does NOT offer it for new assignment.

### 4.4 `RunRosterTab.svelte`

The heaviest UI. Manages individual + bulk student operations.

**Top bar:**
- Left: search input (client-side filter by email substring or full name substring, case-insensitive, trimmed). Placeholder: `"Search by name or email…"`.
- **Prefilter pill** (only when `rosterPrefilter !== null`): rendered between the search input and the Import button: `Showing: Unassigned (N) [×]`. Clicking the `×` clears `rosterPrefilter` (parent state). Typing in the search input ALSO clears the prefilter (and the pill disappears).
- Right: `Import roster` button → opens `RosterImportModal`.

**Filtered list (`$derived`).** Combines `rosterPrefilter` (if set) and the search query. When `rosterPrefilter === 'unassigned'`, only rows with `group_id === null` are visible; the search box additionally narrows by substring.

**Selection state.** `let selected = new SvelteSet<number>()` (from `svelte/reactivity`). Holds `user_id` values.

**Selection action strip** (visible only when `selected.size > 0`, rendered above the table):
- `[N selected{ (M visible)?}]  Move to group [▼]  Delete selected  [X clear]`
  - `N` = `selected.size` (all selected, including those hidden by current filter).
  - `(M visible)` appears as a tooltip/hint when M < N due to filter.
- `Move to group` dropdown lists `Unassign` + each non-disabled group with `(n/10)` capacity. Selecting an option triggers `POST /api/runs/{runId}/students/bulk-move` with `{user_ids: Array.from(selected), group_id: null | id}`.
- `Delete selected`: morphs to inline confirm ("Confirm Delete — {N} students will be removed.") Confirm → `POST /api/runs/{runId}/students/bulk-delete`.

**Header checkbox tri-state.** Three render states based on the filtered-visible row set (size = M):
- **Unchecked**: zero of the filtered-visible rows are in `selected`.
- **Indeterminate** (DOM `indeterminate=true`): 1 to M−1 of the filtered-visible rows are in `selected`.
- **Checked**: all M filtered-visible rows are in `selected`.
- Clicking the header checkbox cycles `unchecked` ↔ `checked` (toggles only the M visible rows). Indeterminate state cycles to `checked` on click. Indeterminate state cannot be set by user click (only as a derived state).

**Bulk-op execution and chunking** (`POST /api/runs/{rid}/students/bulk-move` and `.../bulk-delete`):

1. **Pre-execution.** Clear red borders on all rows currently in `selected` (red borders are a pure function of "errors from THIS op" — see Red-border lifecycle below).
2. **Chunking.** If `selected.size > 200`, split into ⌈N/200⌉ chunks of ≤200 user_ids. Fire **sequentially**: chunk[i+1] starts only after chunk[i] resolves.
3. **Three result sets** built during execution:
   - `succeededIds`: per-row `status === 'ok'` results across all completed chunks.
   - `chunkErrorRowIds`: per-row `status === 'error'` results across all completed chunks (with their `error_code`).
   - `cancelledIds`: if any chunk throws (network or non-207 HTTP error like 400/409 whole-call), the remaining chunks are aborted. `cancelledIds` = user_ids in aborted chunks PLUS user_ids in the chunk that threw (since none of its rows have per-row results).
4. **Post-execution refetch.** Always refetch `students` AND `groups` before rendering the banner. After the new `students` assignment, call `prunePendingGroups()` (see "Optimistic inline group change" below). (Banner render and refetch happen concurrently from the user's perspective; the retry buttons operate on `user_id`s, which are stable across refetch.)
5. **Selection mutation.** After refetch:
   - Remove `succeededIds` from `selected` (they're done; no need to re-select).
   - Keep `chunkErrorRowIds` and `cancelledIds` in `selected` (they're the candidates for retry).
6. **Red borders.** Painted only on rows whose `user_id` is in `chunkErrorRowIds` (per-row errors). Cancelled rows (chunk-level) get no red border by default — they're flagged at the banner level instead. Borders are cleared at step 1 of any subsequent bulk op.

**Summary banner.** Above the table, dismissible only on full success (auto-dismiss 5s) or after an explicit user dismiss. Three rendered shapes:

- **Full success:** `"Moved 18 of 18 — 0 failed."` Auto-dismiss 5s.
- **Per-row partial failure** (chunk-level was fine; some rows errored): `"Moved 16 of 18 — 2 failed."` Banner stays until manual dismiss. Includes a context-aware Retry control:
  - For bulk-move with recoverable failures (`capacity_reached`): inline `<select>` labeled `Retry 2 → group [▼]` with the same group options as the action strip. Selecting an option **re-enters the same chunked dispatcher** for the still-`selected` user_ids (so retries are also chunked when needed). Banner is non-dismissible during in-flight retry.
  - For bulk-delete partial failure: `Retry 2 delete` button — also re-enters the chunked dispatcher.
  - For `not_in_run` failures: no retry; row is genuinely gone. The next refetch will remove it from the list.
- **Chunk-level cancellation:** `"Moved 200 of 450 — 50 failed, 200 cancelled (connection issue)."` Banner stays. Includes a `Retry cancelled` button that **re-enters the same chunked dispatcher** (the function that drove the original op — see "Bulk-op execution and chunking" above) with the union `cancelledIds ∪ chunkErrorRowIds` (recoverable failures from both groups). The dispatcher re-chunks by 200, so a retry of 250+ user_ids works correctly. The wrapper `bulkMoveRunStudents`/`bulkDeleteRunStudents` is called only with per-chunk slices ≤200 — its `<=200` validation (§5.5) is never tripped by retry.

**Bulk-move whole-call 400/409** (distinct from per-row 207). Backend `run_roster.py:234-239` returns 400 for "Group not in this run" and 409 for "Cannot move student into disabled group" as a single HTTP error (no `results` array). The chunking code's `catch` block treats this exactly like a chunk-level network failure: aborts remaining chunks, populates `cancelledIds`, shows the banner with `e.displayMessage` as the body and a `Retry cancelled → group [▼]` control (offering a different group, since the original target was bad).

**Table columns** (sticky header inside the tab's scroll area):

| Col | Width | Behaviour |
|---|---|---|
| `[ ]` | small | Per-row checkbox bound to `selected` (`SvelteSet`). Header checkbox per tri-state rules above. |
| Email | auto | `student.user_email`. |
| Full name | auto | `student.user_full_name || '—'`. |
| Group | auto | When `groups_enabled === true`: inline `<select>` (see optimistic update below). When `groups_enabled === false`: render `—`. |
| Actions | small | Trash icon → inline confirm pair → `DELETE /api/runs/{runId}/students/{user_id}`. Refetch `students` AND `groups` on success. |

**Optimistic inline group change.**

Uses `SvelteMap<number, number | null>` overlay (NOT `Record<…>` — `SvelteMap` ensures reliable reactivity on set/delete in Svelte 5):

```ts
const pendingGroupId = new SvelteMap<number, number | null>();
```

**`pendingGroupId` prune rule.** Whenever `students` is refetched (any refetch path: single-row delete, bulk-op completion, RosterImportModal Done, inline group change success), call `prunePendingGroups()` immediately after the new `students` array is assigned:

```ts
function prunePendingGroups(): void {
  const liveIds = new Set(students!.map(s => s.user_id));
  for (const uid of pendingGroupId.keys()) {
    if (!liveIds.has(uid)) pendingGroupId.delete(uid);
  }
}
```

Why: without pruning, entries for rows that vanished from the roster (deleted by another tab, removed via bulk-delete in this op) stay in the map forever and risk leaking into future renders if a row with the same `user_id` re-enters the roster.

- On select change for `user_id=U` to target `G` (`null` or `int`):
  - Disable the `<select>` for that row (same row in-flight protection).
  - `pendingGroupId.set(U, G)`.
  - Fire `PATCH /api/runs/{rid}/students/{U}` with `{group_id: G}`.
  - On success: `pendingGroupId.delete(U)`; update `student.group_id = G` from the response; refetch `groups` (so capacity badges update).
  - On 409 `capacity_reached`: `pendingGroupId.delete(U)`; toast "Group full — try another."
  - On 409 disabled group: `pendingGroupId.delete(U)`; toast.
  - On 400 / 5xx / other: `pendingGroupId.delete(U)`; toast with `e.displayMessage`.
  - On 401: handled globally by `emitUnauthorized`.
- Rendered `<select>` value: `pendingGroupId.get(U) ?? student.group_id ?? '__unassigned'`.
- Concurrent changes on DIFFERENT rows are allowed and independent. The user may observe a transient capacity change in another row's dropdown while their own PATCH is pending (acceptable; documented behavior).

**Persistent "add student" row at the bottom** (always rendered, outside the scroll area):
- Email input (max 254, trimmed) + Group `<select>` (or `—` if `groups_enabled` is off) + `Add` button.
- **Client-side duplicate check.** Before POST: if a student with the trimmed-lowercased email already exists in the loaded roster, show inline error: `"{email} is already enrolled. Edit their group in the table."` Do NOT POST.
- **Client-side roster-loaded check.** If `students === null` (still loading), the Add button is disabled.
- On submit (duplicate-check passes): `POST /api/runs/{runId}/students` with `{email, group_id}`. Send `group_id: null` (not omitted) for "Unassigned".
- On success: prepend the new row; clear email input; call `inputEl.focus()` (jsdom focus is partially broken — tests assert input value cleared, not focus state; see §7).
- On 400 "Group not in this run" → inline error.
- On 403 "Run version is disabled" → toast.
- On 409 capacity_reached → inline error: `"Target group is full (10 students)."`
- On 409 disabled group → inline error.
- Other errors → inline error.

**Empty / filtered-empty states.**
- Roster is `[]`: empty state "No students yet. Add one below or [Import roster from CSV]." (link version of the Import button).
- Roster non-empty, filter active, zero matches: "No students match '{query}'. [Clear search]" or "No students are unassigned. [Clear filter]" when prefilter active.

**207 per-row tooltip mapping:**

| `error_code` | Tooltip text |
|---|---|
| `not_in_run` | "Student is no longer enrolled in this run." |
| `capacity_reached` | "Target group is full (10 students)." |
| `internal_error` | "Server error — please retry." |
| `null` AND `detail` present | `result.detail` verbatim. |
| `null` AND `detail` missing | "Unknown error." |

**Pagination.** None in v1.

### 4.5 `RosterImportModal.svelte`

Two-stage modal: **Paste & preview**, then **Result**.

**Focus management.** Same pattern as `NewRunModal` (§3.4): autofocus first interactive (textarea), trap Tab, restore focus on close.

**Modal lifecycle.**
- Opens with empty textarea (stage 1).
- Escape:
  - Stage 1: same as Cancel (close, no side effects).
  - Stage 2: same as Done (close + parent refresh). Documented deliberately: stage 2 has no "Cancel" semantics — the operation is already committed; Escape is treated as Done.
- Backdrop click / X button: same as Escape per current stage.

**Stage 1 — Paste & preview:**

- Heading: "Import roster from CSV".
- Helper text: "Paste rows from Excel or Google Sheets. Columns: `name` (optional), `email` (required), `group` (optional — group is auto-created if it does not exist). Tab or comma separated."
- Large `<textarea>` (~10 rows tall).
- Live-parse on input, debounced 200ms via `setTimeout` + cancellation of previous timer on each keystroke. Rapid keystrokes within 200ms cancel prior parse; only the final parse runs.
- Preview table below the textarea (max ~10 rows visible, scrollable):
  - Columns: `#`, `Name`, `Email`, `Group`, `Status`.
  - Status per row: `✓` (valid), `✗` with reason (`Missing email`, `Invalid email format`, `Duplicate in paste (will skip)`).
- Counts footer:
  - `"24 rows — 21 valid, 3 will skip (2 invalid, 1 duplicate-in-paste)"`.
  - `"Will auto-create groups: Group C, Group D"` if applicable.
  - `"Already-enrolled emails will be re-bucketed: alice@x.com, bob@x.com{, +N more}"` — list first 5, then `, +N more`.
- Buttons: `Cancel`, `Import N valid rows` (disabled when 0 valid).

**Already-enrolled wire shape (F1: A — preserve current group).** Backend's `enroll_user_in_run` (`helpers.py:155-207`) unconditionally OVERWRITES `rs.group_id` on re-enroll — both `group: null` and an omitted `group` field resolve to `gid = None` (see `run_roster.py:140-150`). Pydantic treats absent and `null` identically. To avoid silently unassigning already-enrolled students whose paste row has an empty `group` cell, the client computes the wire payload per-row:

```ts
function buildBatchRow(parsed: CsvRow, existingRoster: RunStudentResponse[], groups: GroupResponse[]): RunStudentBatchRow {
  // Start with the parsed cell. If non-empty, use it as-is — backend re-buckets
  // (or auto-creates the group if missing).
  let groupName: string | null = parsed.parsed.group;
  if (!groupName && parsed.alreadyEnrolled) {
    // Empty cell + already enrolled → preserve current group, if any.
    const existing = existingRoster.find(
      r => r.user_email.toLowerCase() === parsed.parsed.email,
    );
    if (existing && existing.group_id !== null) {
      const g = groups.find(g => g.id === existing.group_id);
      if (g) groupName = g.name;   // resolve id → current name (handles renames)
    }
    // If existing.group_id is null OR the group isn't in groups[] (race), fall
    // through and omit `group` — backend will leave the student unassigned
    // (same as before).
  }
  // Conditional spread: omit `group` when null (Pydantic equates absent/null;
  // omitting keeps the payload minimal and signals "no group" unambiguously).
  return {
    email: parsed.parsed.email,
    ...(parsed.parsed.name ? { name: parsed.parsed.name } : {}),
    ...(groupName ? { group: groupName } : {}),
  };
}
```

This is computed at submit time (Stage 1 → Stage 2 transition), not in the preview. The preview shows the parsed cell verbatim; the lookup happens only for rows actually submitted. If the resolved group has since become disabled (race with `is_disabled` toggle in another tab), the backend's per-row 409 surfaces in Stage 2 — the teacher can resolve it manually.

**Test (in `RosterImportModal.svelte.test.ts`):** paste includes one already-enrolled email with empty group cell whose existing `group_id` resolves to "Group A"; assert the submitted batch row has `group: "Group A"`. Second case: paste includes one already-enrolled email with `group_id === null`; assert the submitted batch row OMITS `group` (no key in JSON).

**Stage 2 — Result:**

- After `POST /api/runs/{runId}/students/batch` returns, replace the preview table with a results table:
  - Same columns plus a `Result` column with `added` (green) / `error` (red, with `detail` as tooltip).
  - `RunStudentBatchResultRow` has no `error_code`; display `detail` text verbatim.
- Footer: `"22 added, 0 failed."` or `"19 added, 3 failed."`.
- Buttons:
  - `Done` — closes modal, parent refetches `students` AND `groups`.
  - `Copy failed rows` — visible only when failures > 0. Try `navigator.clipboard.writeText(rows)`; on rejection (Safari permission), reveal an inline `<textarea readonly>` with the failed rows for manual selection.

**No file picker.**

---

## 5. Lib modules

All HTTP helpers use `lib/api.ts`: `api.get`, `api.post`, `api.patch`, `api.delete` (NOT `api.del`). Requests inherit `credentials: 'include'` and the `X-Requested-With: mathion` header. 401 → `emitUnauthorized(...)` happens inside `lib/api.ts:39-41`; component code does not repeat this.

**Toasts.** All toast call sites import `pushToast` from `stores/toasts.svelte.ts` (the actual toast module — `lib/toasts.ts` does not exist). Signature: `pushToast(message: string, kind?: 'info' | 'error' | 'success')`. Default kind is `'info'`. Toasts auto-dismiss after 5 seconds (handled inside the store). Component code uses `pushToast(...)` directly; no wrapper module.

### 5.1 Backend-mirror types (added to `lib/types.ts`)

```ts
export type RunResponse = {
  id: number;
  version_id: number;
  title: string;
  start_date: string;     // YYYY-MM-DD
  end_date: string;       // YYYY-MM-DD
  groups_enabled: boolean;
  is_published: boolean;
  created_at: string;     // ISO timestamp
};

export type RunCreateRequest = {
  title: string;
  start_date: string;
  end_date: string;
  groups_enabled: boolean;
  // NOTE: no version_id — backend auto-picks newest published version.
};

export type RunUpdateRequest = {
  title?: string;
  start_date?: string;
  end_date?: string;
  groups_enabled?: boolean;
  // NOTE: no version_id — backend RunUpdate schema does not accept it.
};

export type RunTeacherResponse = {
  id: number;
  run_id: number;
  user_id: number;
  user_email: string;
  user_full_name: string | null;
  created_at: string;
};

export type GroupResponse = {
  id: number;
  run_id: number;
  name: string;
  is_disabled: boolean;
  student_count: number;
};

export type RunStudentResponse = {
  id: number;
  run_id: number;
  user_id: number;
  user_email: string;        // NOT 'email'
  user_full_name: string | null;  // NOT 'full_name'
  group_id: number | null;
  created_at: string;
};

export type RunStudentBatchRow = {
  name?: string;
  email: string;
  group?: string;
};

export type RunStudentBatchResultRow = {
  email: string;
  status: 'added' | 'error';
  group_id?: number;
  detail?: string;
  // NOTE: no error_code on the batch endpoint.
};

export type BulkRosterErrorCode =
  | 'not_in_run'
  | 'capacity_reached'
  | 'internal_error';

export type BulkOpSummary = { total: number; ok: number; error: number };

export type BulkMoveResultRow = {
  user_id: number;
  status: 'ok' | 'error';
  group_id?: number | null;
  detail?: string;
  error_code?: BulkRosterErrorCode | null;
};

export type BulkDeleteResultRow = {
  user_id: number;
  status: 'ok' | 'error';
  detail?: string;
  error_code?: BulkRosterErrorCode | null;
};

export type BulkMoveResponse = {
  results: BulkMoveResultRow[];
  summary: BulkOpSummary;
};

export type BulkDeleteResponse = {
  results: BulkDeleteResultRow[];
  summary: BulkOpSummary;
};
```

### 5.2 `lib/runs.ts` (new) — run CRUD + publish

```ts
export function listRuns(courseId: number): Promise<RunResponse[]>;
export function createRun(courseId: number, body: RunCreateRequest): Promise<RunResponse>;
export function getRun(runId: number): Promise<RunResponse>;
export function updateRun(runId: number, body: RunUpdateRequest): Promise<RunResponse>;
export function deleteRun(runId: number): Promise<void>;
export function publishRun(runId: number): Promise<RunResponse>;
export function unpublishRun(runId: number): Promise<RunResponse>;
```

### 5.3 `lib/runTeachers.ts` (new)

```ts
export function listRunTeachers(runId: number): Promise<RunTeacherResponse[]>;
export function addRunTeacher(runId: number, email: string): Promise<RunTeacherResponse>;
export function removeRunTeacher(runId: number, userId: number): Promise<void>;
```

### 5.4 `lib/runGroups.ts` (new) — groups + capacity helper

```ts
export function listGroups(runId: number): Promise<GroupResponse[]>;
export function createGroup(runId: number, name: string): Promise<GroupResponse>;
export function updateGroup(groupId: number, body: { name?: string; is_disabled?: boolean }): Promise<GroupResponse>;
export function deleteGroup(groupId: number): Promise<void>;

// Pure helper for capacity badge styling.
export type CapacityClass = 'empty' | 'ok' | 'warn' | 'full';
export function getCapacityClass(count: number): CapacityClass;
```

`getCapacityClass`:
- `count <= 0` → `'empty'`
- `count >= 1 && count <= 7` → `'ok'`
- `count === 8 || count === 9` → `'warn'`
- `count >= 10` → `'full'`

### 5.5 `lib/runRoster.ts` (new) — students CRUD + batch + bulk

```ts
export function listRunStudents(runId: number): Promise<RunStudentResponse[]>;
export function addRunStudent(runId: number, email: string, groupId: number | null): Promise<RunStudentResponse>;
export function updateRunStudent(runId: number, userId: number, groupId: number | null): Promise<RunStudentResponse>;
export function removeRunStudent(runId: number, userId: number): Promise<void>;
export function batchAddRunStudents(
  runId: number,
  rows: RunStudentBatchRow[],
): Promise<{ results: RunStudentBatchResultRow[] }>;
export function bulkMoveRunStudents(
  runId: number,
  userIds: number[],
  groupId: number | null,
): Promise<BulkMoveResponse>;
export function bulkDeleteRunStudents(
  runId: number,
  userIds: number[],
): Promise<BulkDeleteResponse>;
```

**Pre-request validation:**
- `bulkMoveRunStudents` and `bulkDeleteRunStudents` enforce `userIds.length >= 1 && <= 200` and unique values. Violations throw a synchronous `ApiError(0, '...')` so callers fail fast.
- The `<= 200` cap matches the backend's per-call `RunStudentBulkMoveRequest.user_ids` limit. **Callers must chunk by 200 themselves** — `RunRosterTab`'s bulk-op dispatcher (§4.4) does this. The Retry control re-enters that same dispatcher, so retries of >200 rows also re-chunk correctly; the wrapper's cap is never tripped by retry.

### 5.6 `lib/runStatus.ts` (new)

```ts
export type RunStatus = 'draft' | 'upcoming' | 'active' | 'ended';

export function runStatus(
  run: { is_published: boolean; start_date: string; end_date: string },
  now: Date = new Date(),
): RunStatus;
```

Logic (local time):
- `!run.is_published` → `draft`.
- Else `now < startOfDay(start_date)` → `upcoming`.
- Else `now > endOfDay(end_date)` → `ended`.
- Else → `active`.

**Timezone behavior.** Dates evaluated in user's local timezone. Two admins in different timezones may see different statuses near boundaries (documented non-goal §8).

`now` is parameter-injectable for testing.

### 5.7 `lib/csv.ts` (new)

```ts
export type CsvRow = {
  rowIndex: number;
  raw: string[];
  parsed: { name: string | null; email: string; group: string | null };
  valid: boolean;
  errors: string[];
  alreadyEnrolled: boolean;   // true if email matches an existing roster entry
};

export type CsvParseResult =
  | {
      ok: true;
      delimiter: ',' | '\t';
      hasHeader: boolean;
      rows: CsvRow[];
      validCount: number;
      invalidCount: number;
      duplicateInPasteCount: number;
      alreadyEnrolledEmails: string[];   // sorted, unique, lowercased
      willCreateGroups: string[];        // sorted, unique
    }
  | { ok: false; error: string };

export function parseCsv(
  text: string,
  existingGroupNames: string[],
  existingRosterEmails: string[],
): CsvParseResult;
```

**Normalization rules (in order):**
1. Strip leading BOM (`﻿`).
2. Normalize line endings: `\r\n` and `\r` → `\n`.
3. Split on `\n`.
4. Trim each line; drop empty lines.
5. Delimiter detection from first non-empty line: count `\t` vs `,`; tie → `\t` wins.
6. Split each line by delimiter; trim each cell.
7. Header detection: case-insensitive match for `email`/`e-mail`/`mail` in any cell of the first split line.
   - With header: map cells by header name.
   - Without header positional: if first cell of first row matches `/^\S+@\S+\.\S+$/` → `[email, group?]`; else → `[name, email, group?]`.
8. Validation per row:
   - `email` required; must match `/^\S+@\S+\.\S+$/`; normalized to lowercase.
   - `name`, `group` may be empty → `null`.
9. In-paste duplicate detection: rows whose email already appeared earlier are marked `valid = false` with error `"Duplicate in paste (will skip)"`. First occurrence stays valid.
10. Already-enrolled detection: for each remaining valid row whose email is in `existingRosterEmails` (lowercased), set `row.alreadyEnrolled = true` and add to `alreadyEnrolledEmails`. The row stays `valid` (it WILL be submitted).
11. `willCreateGroups`: sorted unique group names from valid rows whose name is not in `existingGroupNames` (case-sensitive, whitespace-trimmed).

**Error cases:** empty input → `{ok: false, error: 'Paste is empty.'}`. No email column → `{ok: false, error: 'No email column found.'}`.

No quoted-field support in v1.

---

## 6. Error handling

All HTTP errors propagate as `ApiError`. Component handling:

| Status / shape | Default handling |
|---|---|
| 401 | Handled in `lib/api.ts` via `emitUnauthorized`. Components do nothing extra. |
| 403 (on by-slug page mount) | Redirect to `/courses/:courseSlug`. |
| 403 (other endpoints) | Toast: "You don't have permission to do that." Then `location.reload()`. |
| 404 (on by-slug at page mount) | Render inline "Course not found" with link to `/courses`. |
| 404 (on `getRun`) | Render inline "Run not found" placeholder. |
| 404 (on roster `DELETE`) | Treat as success; refetch the affected list. |
| 404 (other) | Toast with `e.displayMessage`. |
| 409 on `publishRun` | Parse `e.displayMessage`, render banner under Publish button. Covers all backend 409s on publish (readiness violations, disabled version, already-published race). |
| 409 on `deleteRun` | Toast with `e.displayMessage` (covers "Run has students", "Run has submissions", "Unpublish run before deleting"). |
| 409 on `addRunTeacher` | Inline error on the teachers form. |
| 409 on `createGroup` (name conflict) | Inline error on the groups form. |
| 409 on `deleteGroup` "Group has students" | Toast verbatim + refetch groups AND students. |
| **409 on `deleteGroup` "Group has submissions"** | **Toast verbatim ("Group has past submissions; disable instead.") + refetch groups.** |
| **409 on `updateRun` (any)** | **Toast with `e.displayMessage` (covers "Cannot disable groups; mini-projects exist", "Cannot shorten run while submissions exist", "Cannot extend end_date on a run pinned to a disabled course version", "Cannot change groups_enabled on published run").** Inline-edit reverts the failing field to pristine per §4.1's cross-field rule (compare `tracker.current[field]` with the captured `inFlightValue`; revert only if the user hasn't since typed). |
| **422 on `updateRun` (end_date < start_date)** | **Toast with backend message. Frontend should also pre-check before PATCH where possible (NewRunModal validates; inline date edit relies on backend.)** |
| 409 on `addRunStudent` (capacity / disabled group) | Inline error on the add-student row. |
| 400 on `addRunStudent` or `updateRunStudent` ("Group not in this run") | Inline error on the row's affected control. |
| 403 on `addRunStudent` ("Run version is disabled") | Toast. |
| 207-style per-row on bulk ops | Per §4.4: summary banner + per-row red border + `error_code` tooltip (incl. `null+detail-missing` → "Unknown error"); then refetch. |
| **Non-207 4xx/5xx on bulk-move** | **Treat as chunk-level failure (per §4.4 chunking section): abort remaining chunks; show banner with `e.displayMessage` and `Retry cancelled → group [▼]` (or `Retry delete`) button.** |
| 5xx (other) | Generic toast: "Server error — please retry." |

**Note on add-student duplicates.** Backend's `POST /api/runs/{runId}/students` does NOT return 409 on re-enrolling — it silently overwrites `group_id`. Frontend pre-checks the loaded roster before POST (§4.4) and shows an inline error directing the admin to the inline Group dropdown.

---

## 7. Testing

Vitest + jsdom. Components with runes use `.svelte.test.ts`. Tests use `mount` / `unmount` / `flushSync` patterns from the existing precedent (see `tests/AssetSidebar.svelte.test.ts`).

**Helper patterns established for this feature** (set up in T1/T3 and reused):

- **Toast assertions.** Components call `pushToast(message, kind?)` from `stores/toasts.svelte.ts`. Tests use `vi.spyOn(toastsModule, 'pushToast')` (importing the module and spying on the named export) to assert call args. Reset the spy between tests; avoid leaking auto-dismiss timers across tests by using `vi.useFakeTimers()` where banner timing is asserted.
- **DST test timezone pin.** `tests/runStatus.test.ts` pins `process.env.TZ = 'America/New_York'` in a `beforeAll`/`afterAll` (capture original, restore) so the spring-forward DST boundary check around `2026-03-08` is deterministic regardless of CI runner timezone. (The runStatus helper uses local-time semantics by design; pinning TZ is the only way to make the DST test reproducible.)
- **Router navigation stub.** For tests asserting redirects (admin gate, 403 by-slug), `vi.spyOn(router, 'navigate')` from `lib/router.svelte.ts`. The existing `tests/assets.test.ts` `Object.defineProperty(window, 'location', …)` pattern is for *reading* the current URL (emitUnauthorized payload), NOT for spying on navigation — use the router spy instead.
- **`vi.useFakeTimers()`** — debounced CSV live-parse (200ms), banner auto-dismiss (5s), session-scoped `(invited)` badge timing if relevant.
- **Clipboard stub:**
  ```ts
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
  // Rejection branch test uses .mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'))
  ```
- **`<select>` change event:** `select.value = newValue; select.dispatchEvent(new Event('change'));` (matches `AssetSidebar.test.ts:277`).
- **`flushSync` settling ritual:** after `mount`, run `await Promise.resolve(); flushSync()` twice to settle reactive state (matches `AssetSidebar.svelte.test.ts:55-58`).
- **Date `<input>` jsdom workaround:** for tests of inline date editing, set `dateInput.value = '2026-06-01'` directly (string); do NOT use `valueAsDate` (broken in jsdom).
- **Refetch assertion helper:** several bulk-op tests assert `listRunStudents` AND `listGroups` both refetched. Use a small `expectBothRefetched(studentsSpy, groupsSpy, sinceCallNum)` helper to avoid 7+ duplicated assertions.

### Test files

| File | Coverage (enumerated) |
|---|---|
| `tests/runs.test.ts` | Each helper: success request shape; 401 → `emitUnauthorized` invoked then `ApiError` thrown; other errors propagate as `ApiError`. Type tests for `RunCreateRequest` not including `version_id`. |
| `tests/runTeachers.test.ts` | Each helper: success request shape; 401; 409 on add. |
| `tests/runGroups.test.ts` | Each helper: success; 401; 409 on add (conflict); 409 on delete (not empty); 409 on delete (submissions). **`getCapacityClass` boundary tests: 0 → 'empty'; 7 → 'ok'; 8 → 'warn'; 9 → 'warn'; 10 → 'full'; 11 → 'full' (above-cap robustness).** Negative or NaN inputs return `'empty'` defensively. |
| `tests/runRoster.test.ts` | Each helper: success; 401. Bulk client-side validation: rejects 0 user_ids, >200, duplicates. Add-student sends `group_id: null` (not omitted) for Unassigned. |
| `tests/runStatus.test.ts` | All four states: `is_published=false` → draft. Cross-published boundaries (with `now` injection): today === startOfDay(start_date) → active; today === endOfDay(end_date) → active; today === endOfDay(end_date) + 1ms → ended; today === startOfDay(start_date) - 1ms → upcoming; same-day start/end inside the date → active. **DST boundary check** (e.g., `start_date='2026-03-08'`, `now='2026-03-08T02:30 local'` → active, even across the spring-forward jump). |
| `tests/csv.test.ts` | Empty input → error. No-email-column → error. Delimiter detection: `,` only / `\t` only / **tie → tab wins**. Header detection: `email` / `Email` / `EMAIL` / `e-mail` / `mail` (5 variants × case). Positional fallback: first-cell-is-email → 2-col mapping; first-cell-is-name → 3-col mapping. **BOM strip**; **CRLF normalize**; **BOM + CRLF combined** (Excel-export shape). Trim cells; blank-line skip; first-line-blank-second-line-data. Invalid email flagged. In-paste duplicate: first valid, second invalid with "Duplicate in paste". Already-enrolled detection sorted/unique. **willCreateGroups case-sensitivity**: `"Group A"` vs existing `"Group A"` → not in set; `"group A"` vs existing `"Group A"` → IS in set (case-sensitive). Whitespace-trim before comparison. |
| `tests/RunListPage.svelte.test.ts` | Empty state + CTA renders. Sort order from backend (3 runs in pre-sorted order render in DOM in that order — frontend does NOT re-sort). Status badge uses injected `now`. Version label resolution. Delete-only-when-draft. **403 from by-slug → router.navigate spy called with `/courses/:courseSlug`.** 404 from by-slug → inline error. New-run button disabled when versions list is empty (with tooltip). |
| `tests/NewRunModal.svelte.test.ts` | Required-field validation (title empty, start empty, end empty, end < start — four separate tests). Submit payload omits `version_id`. Navigation on success. API error → inline banner. Escape closes; backdrop closes; focus restored to opener on close. |
| `tests/RunDetailPage.svelte.test.ts` | Parallel fetch on mount: all 5 endpoints called within a single Promise.all. **`runId` coerced to number** (string param → integer used in fetches; non-integer param renders error placeholder). 403 from by-slug → redirect. 404 from `getRun` → inline error placeholder, tabs not rendered. **`loadError` placeholder renders** when the try/catch in `loadAll` catches (covers 404 on `getRun` and other transient failures). Tab switching does not refetch. **Stale-guard test #1:** slug changes mid-load; first load's results are discarded (token check). **Stale-guard test #2:** two-mounts-in-quick-succession only the second's results commit. **Stale-guard test #3:** a stale failure (token mismatch in `catch`) does NOT clobber a successful later load's state. Sticky publish bar: button enabled/disabled per readiness; tooltip shows first violation. Unpublish flow with inline confirm. **Disabled-version banner renders** when the pinned `VersionResponse.is_disabled === true`; Publish button disabled. **Disabled-version banner does NOT render** when `pinned === undefined` (miss) or while `versions === null` (mid-load). **Tab-state reset on `runId` change** (navigate within component instance: tab returns to 'overview', `rosterPrefilter` clears). **`gotoTab` wiring:** Overview hint click → `RunDetailPage.gotoTab('roster', 'unassigned')` → `activeTab === 'roster'` AND `rosterPrefilter === 'unassigned'` in a single tick (assert with one `flushSync` between click and read). `rosterPrefilter` persists until RunRosterTab calls `onPrefilterClear`. |
| `tests/RunOverviewTab.svelte.test.ts` | Tri-state checklist permutations (one test each): all-pass; zero teachers → row 1 ✗; one unassigned student (groups_enabled=true) → row 2 ✗ with hint button; one oversized group (11 students) → row 3 ✗; one zero-student group → row 3 ✗ per-group breakdown; `groups_enabled=false` → rows 2-3 `—`; `groups_enabled=true` AND `groups.length===0` → row 3 ✗ "No groups defined". **`tracker` initialization:** the first time `run` becomes non-null, `tracker` is constructed via `makeDirtyTracker<RunForm>({...})` (assert via spy on the import). **Inline-edit Title:** blur with change commits PATCH (asserts `bind:value={tracker.current.title}` round-trip via input value mutation + dispatching `input` event + blur); Enter blurs (commits via onblur — exactly one PATCH); Escape on changed title reverts `tracker.current.title` to `run.title`; PATCH error reverts `tracker.current[field]` to pristine when user hasn't since typed (cross-field rule), pushes a `pushToast(..., 'error')`; PATCH error does NOT revert if user has typed a new value between blur and error (assert by mutating input after blur but before promise resolves). **`tracker.reset()` is called with the updated snapshot** on success (assert call args). **Blur after Enter does NOT cause a second PATCH** (tracker no longer dirty for that field after reset). Same coverage for `start_date` and `end_date` (date input uses `.value = '2026-06-01'` per jsdom helper). Settings: groups_enabled toggle disabled when `is_published`. Danger zone: delete confirmed → DELETE called; 409 "students" → `pushToast`; 409 "submissions" → `pushToast`. |
| `tests/RunTeachersTab.svelte.test.ts` | Add flow (POST → prepend). Auto-created teacher with `user_full_name=null` shows `(invited)` badge; **`(invited)` persists across reactive updates** (e.g., another teacher added later — the original's badge stays). Remove flow with inline confirm. 409 on add → inline error. Empty state. |
| `tests/RunGroupsTab.svelte.test.ts` | `groups_enabled=false` → placeholder. Add → POST → prepend. Inline-rename with `makeDirtyTracker`: blur commits, Enter commits, Escape reverts. Capacity classes render correctly via `getCapacityClass` (assert DOM class names on the badge). Delete-empty → DELETE. Trash disabled when `student_count > 0`. 409 "Group has students" → toast + refetch (both refetched). 409 "Group has submissions" → toast + refetch groups. |
| `tests/RunRosterTab.svelte.test.ts` | Add inline (with `group_id: null`). Client-side duplicate check blocks POST and shows inline error. **Add-student row: email input cleared after success** (assert `inputEl.value === ''`). Search: email substring (case-insensitive); name substring (case-insensitive); empty search shows all rows. **Header checkbox tri-state:** 0 visible selected → unchecked; 1 of 3 selected → indeterminate (DOM attribute); 3 of 3 selected → checked; click on indeterminate → all visible selected (checked). **Header checkbox toggles only filtered rows** (rows outside the filter unaffected). Selection state survives search-filter changes. **Roster prefilter pill renders** when `rosterPrefilter !== null`; clicking `×` clears the prefilter; typing in search clears the prefilter. **Inline group change optimistic update:** select disabled during in-flight; success updates `student.group_id` + refetches `groups`; 409 capacity_reached deletes from `pendingGroupId` + toasts; 5xx deletes from `pendingGroupId` + toasts. **Inline group change uses `SvelteMap` (not Record)** — verify reactivity on `pendingGroupId.set` AND `pendingGroupId.delete` triggers `<select>` re-render. **`prunePendingGroups()` runs after every `students` refetch** — set `pendingGroupId.set(U, G)` for a userId U whose row is then removed (via bulk-delete that succeeds for U), refetch `students`, assert `pendingGroupId.has(U) === false`. Inverse: set for a userId still in the refetched roster → entry preserved. **Bulk-move chunking boundaries:** 200 → 1 request; 201 → 2 requests of sizes [200, 1]; 450 → 3 requests of sizes [200, 200, 50]; **sequential firing** (request #2's body not constructed until #1 resolves — use deferred promise + spy call-order). **207 aggregation across chunks:** results from chunks 1 and 2 combined into a single summary banner. **207 per-row mapping (one test each):** `not_in_run` → "Student is no longer enrolled in this run."; `capacity_reached` → "Target group is full (10 students)."; `internal_error` → "Server error — please retry."; null+detail-present → `detail` verbatim; **null+detail-missing → "Unknown error"**. **Red-border lifecycle:** errors painted only on rows from THIS bulk op; previous-op red borders cleared at start of next bulk op. **Selection auto-pruned after partial failure** (succeeded rows leave `selected`; cancelled and errored rows stay). **Banner Retry button:** clicking `Retry → group [▼]` and picking a target fires a new bulkMove on still-selected user_ids. **Chunk-level network failure:** chunk 1 ok, chunk 2 throws → abort chunk 3; banner shows `cancelled` count; `Retry cancelled` re-fires for `cancelledIds ∪ chunkErrorRowIds`. **Bulk-move whole-call 400/409:** behaves like chunk-level failure; banner renders `e.displayMessage`. **Banner auto-dismiss** after 5s on full success (fake timers). **Banner does NOT auto-dismiss** on partial failure (advance 10s, banner still in DOM). Bulk-delete: same shape (without group dropdown). Refetch `students` AND `groups` after every bulk op (use `expectBothRefetched`). |
| `tests/RosterImportModal.svelte.test.ts` | Paste → preview happy path with debounced live-parse (fake timers, advance 200ms). **Debounce cancellation:** rapid keystrokes within 200ms cancel prior parse — only the final parse fires (assert single parse call after the rapid sequence). Invalid rows flagged with reason. In-paste duplicates flagged. Already-enrolled emails listed in counts footer (with `, +N more` truncation when > 5). willCreateGroups displayed. **F1=A wire shape — already-enrolled, empty group cell, existing `group_id` resolves to "Group A"** → assert the submitted batch row has `group: "Group A"`. **F1=A wire shape — already-enrolled, empty cell, existing `group_id === null`** → assert the submitted batch row has no `group` key (use `Object.prototype.hasOwnProperty` assertion, not just `=== undefined`). **Brand-new email, empty group cell** → batch row has no `group` key. **Non-empty group cell on already-enrolled** is sent as-is (re-bucket). Submit calls batch endpoint with valid rows only. Stage 2 result rendering with mixed success/error. **Copy-failed-rows clipboard success** (clipboard mock asserted). **Copy-failed-rows fallback** (clipboard rejects with DOMException → textarea revealed). Escape in stage 1 closes (no refetch). Escape in stage 2 closes + parent refetch (both `listRunStudents` AND `listGroups` called); after the refetch, `prunePendingGroups()` runs (assert via spy on `pendingGroupId.delete`). Focus restoration on close (modal trigger is the `Import roster` button which remains mounted; restore is straightforward). |

### Manual smoke plan

Run via `run-debug.sh`. Pre-condition: course `calc-101` exists with at least one published version, test user is admin.

1. Open `/courses/calc-101/runs` as a non-admin → redirected to `/courses/calc-101`.
2. As admin, open `/courses/calc-101/runs` → empty state visible.
3. Open `/courses/no-such-course/runs` → inline "Course not found" with link back.
4. Create a run via `NewRunModal`: title, start, end (end >= start enforced), groups_enabled=on → navigates to detail page; verify version label.
5. On detail page, edit title inline: type, blur → persists on refresh. Type again, Escape → reverts. Press Enter on changed title → exactly one PATCH (no double-fire on blur after Enter).
6. Toggle `groups_enabled` off then on → Groups tab placeholder appears/disappears.
7. Add a teacher by email of a non-existing user → row shows `(invited)` badge; refresh page → badge still gone (session-scoped).
8. Add three groups → capacity badges all show "empty" italic gray.
9. Use `RosterImportModal`: paste 6 rows including:
   - 1 row with malformed email,
   - 1 row that duplicates the email of an earlier row in the paste,
   - 1 row referencing a brand-new group,
   - 1 row whose email is already enrolled (precondition: add one via prior step),
   - 1 already-enrolled row with empty group cell (should NOT change their group).
   - Verify preview flags invalid + duplicate; new group listed under `willCreateGroups`; already-enrolled emails listed (truncate to 5 + "+N more" if applicable).
   - Import → stage 2 shows correct results.
10. Try inline-adding a student with an already-enrolled email → inline error directing to Group dropdown.
11. Inline-edit one student's group to "Unassigned" → optimistic update visible immediately; on success, Overview readiness shows ✗ for "All students assigned".
12. Click the "N unassigned" hint on Overview → switches to Roster; the **Showing: Unassigned (1) [×]** pill is visible; only the unassigned row shows.
13. Type into search → pill clears; full roster filtered by query.
14. Select two students; bulk-move to a group at 9/10 capacity → first succeeds, second fails with `capacity_reached`. Verify summary banner with `Retry 1 → group [▼]` button; successful row's group updates; failed row has red border + tooltip; selection auto-pruned to the failed row.
15. Click `Retry → group [▼]`, pick a different group → succeeds; banner auto-dismisses after 5s.
16. Select one student, bulk-delete → row removed; summary banner; auto-dismiss.
17. With 250 students in roster, select all (via header checkbox), bulk-move → 2 chunks fire sequentially; banner shows combined counts.
18. Try to delete a non-empty group → trash disabled with tooltip. Move students out, then delete → group disappears.
19. With one teacher missing, one student unassigned, one empty group → all three readiness rows show ✗.
20. Add teacher, assign all students, populate groups → Publish button enables. Publish → status badge changes per dates.
21. Try to change title or groups_enabled on a published run → toggle disabled (tooltip); title inline-edit still works.
22. Unpublish via inline confirm → fields re-enabled.
23. Try to delete an unpublished run that still has students → toast "Clear roster before deleting." Clear roster, then delete → run disappears.
24. Cause a 401 (clear session cookie in DevTools and trigger any mutation) → global redirect to login.

---

## 8. Non-goals and explicit deferrals

- Teacher-facing pages, dashboards, analytics, gradebook, attendance (separate spec).
- Force-delete a run with roster intact (no `?force=true` UI in v1).
- Re-pinning a run to a different version after creation.
- Editing `is_disabled` on groups via UI.
- Cross-course run hub.
- Bulk teacher import.
- File-upload variant of roster import.
- Quoted-field CSV support.
- Pagination of the roster table.
- Per-student profile page.
- Tab state in URL / deep-linkable tabs.
- Cross-timezone status display agreement.
- Capacity threshold overrides.
- Force-revalidate after another admin's concurrent edit (no live updates).

---

## 9. Acceptance criteria

The implementation is complete when:

1. Both routes added to `src/routes.ts` with `:courseSlug`/`:runId` param names; **`App.svelte` componentMap registers both new pages**.
2. `CourseCard` admin-only branch mirrors the mixed-admin pattern (card-as-div, title-as-`<a>`, sibling action buttons); "Runs" button gated on `course.is_admin`.
3. All eight new Svelte components compile, render, and pass vitest tests.
4. All four new lib modules (`runs.ts`, `runTeachers.ts`, `runGroups.ts`, `runRoster.ts`) plus `runStatus.ts` and `csv.ts` exist with documented signatures and pass unit tests.
5. Backend-mirror types added to `lib/types.ts`.
6. svelte-check baseline preserved (0 errors; existing warning count unchanged — verified at execution time, not assumed).
7. The 24-step manual smoke plan passes end-to-end on a local backend running via `run-debug.sh`.
8. Backend unchanged: no migrations, no schema edits, no endpoint changes.
9. The **12-task** implementation plan completes with each task individually verified and reviewer-approved.

---

## 10. Task decomposition preview

The implementation plan (written next via `superpowers:writing-plans`) will use 12 tasks:

1. **`lib/runs.ts` + types in `lib/types.ts`** — backend-mirror type block; 7 run-CRUD helpers; tests. Verify backend response shapes match.
2. **`lib/runTeachers.ts`, `lib/runGroups.ts` (incl. `getCapacityClass`), `lib/runRoster.ts`** — three resource modules + their tests. Establishes the bulk-op client-side validation pattern.
3. **`lib/runStatus.ts` + `lib/csv.ts` + tests** — pure functions. Establishes fake-timer + clipboard-mock patterns reusable by later tasks.
4. **`RunListPage` + `NewRunModal` + `routes.ts` + `App.svelte` componentMap + `CourseCard` "Runs" button** — page-level routing, admin gate (with 403 redirect), list table, modal, navigation entry point. Tests include version-empty disabled state and by-slug 403 redirect.
5a. **`RunDetailPage` shell** — stale-guard with single commit gate + `loadError` placeholder, `runId` coercion, parallel fetch, tabs scaffold, sticky publish bar with disabled-version banner derivation, cross-tab handoff via `gotoTab(tab, prefilter?)` (no `$effect`-write idiom), `rosterPrefilter` state with `onPrefilterClear` callback prop, tab-state reset on `runId` change.
5b. **`RunOverviewTab`** — `makeDirtyTracker`-based inline edits for title + dates; settings panel; tri-state readiness checklist with all permutations; danger zone with delete + 409 toasts.
6. **`RunTeachersTab` + `RunGroupsTab`** — both small CRUD tabs. Establishes the inline-rename and inline-confirm patterns. Includes `getCapacityClass` rendering and the 409 "Group has submissions" handler.
7a. **`RunRosterTab` core** — table layout, search filter, header tri-state checkbox with filter scoping, prefilter pill, persistent add-student row with duplicate pre-check + post-success input clear, single-row delete, empty / filtered-empty states.
7b. **`RunRosterTab` optimistic inline group edit** — `SvelteMap`-based `pendingGroupId` overlay, `prunePendingGroups()` helper called after every `students` refetch, per-row select disabled during in-flight, success / 409 / 5xx branches, refetch on success.
8a. **`RunRosterTab` bulk ops** — selection action strip, bulk-move + bulk-delete chunking with sequential firing, 207 per-row mapping (all 5 cases incl. null+detail-missing), red-border lifecycle (clear-at-start-paint-on-this-op), selection auto-prune, summary banner with retry control, chunk-level failure handling, bulk-move whole-call 400/409 as chunk-level failure.
8b. **`RosterImportModal`** — two-stage modal, debounced live-parse with cancellation, preview table with in-paste duplicate + already-enrolled detection, batch submit using `buildBatchRow` (F1=A: already-enrolled with empty group cell preserves current group via `existingRoster + groups` lookup; brand-new empty cell omits `group` via conditional spread), stage 2 results, clipboard copy with fallback.
9. **Final integration** — manual 24-step smoke walk-through, full vitest (verify count delta), svelte-check baseline check (compare warnings), branch cleanup, merge prep.
