# Run Management (Admin Surface) — Design

**Date:** 2026-05-19
**Status:** Brainstorm-validated and reviewer-corrected; ready for implementation plan.
**Scope:** Mathion frontend — admin-only run management for a single course.

> **Revision note (2026-05-19, post-review):** This document was revised after a four-reviewer parallel audit. Key corrections from the first draft: version is auto-pinned at run creation (no version picker — backend does not accept `version_id` on `RunCreate`/`RunUpdate`); `RunStudentResponse` uses `user_email`/`user_full_name` (not `email`/`full_name`); add-student is pre-validated client-side against the loaded roster before POST (backend silently re-buckets duplicates, which we hide); list-runs ordering is `start_date ASC`; `api.delete` (not `api.del`); route params use the codebase's descriptive camelCase convention (`:courseSlug`/`:runId`); `lib/runs.ts` splits into four resource modules; `RunDetailPage` adopts the same stale-guard pattern as `currentEditorVersion.svelte.ts`. Full UX, error, testing, and decomposition revisions follow.

---

## 1. Goals and scope

Build the admin-facing UI for managing course **runs** (cohorts of students who use a specific course version over a date range). The backend (Phases 7a + 7d) is already shipped: runs, run-teachers, groups, run-students, and bulk roster operations.

This spec covers everything an admin needs to set up and operate a run end-to-end:

- Create / edit / delete runs (delete only when unpublished AND roster is empty).
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

---

## 2. Routes and navigation

Two new routes added to `src/routes.ts`:

| Path | Component | Auth | Access |
|---|---|---|---|
| `/courses/:courseSlug/runs` | `RunListPage.svelte` | yes | course admin only |
| `/courses/:courseSlug/runs/:runId` | `RunDetailPage.svelte` | yes | course admin only |

Both routes sit alongside the existing `/courses/:courseSlug/edit` admin surface and follow the same gating pattern. **Route param names use the existing descriptive camelCase convention** (matching `:courseSlug`, `:versionId`, `:itemId` in `routes.ts`); the router's param extractor (`router.svelte.ts:181`) spreads them as props (`<Comp {...matched.params} />`), so the component's `$props()` typing must use exactly these names.

**Page-level access check.** On mount, each page calls `GET /api/courses/by-slug/{slug}`. The backend response semantics are:

- `200 OK` with `CourseResponse` (where `is_admin === true`) → proceed with `course.id`.
- `403 Forbidden` → user is not a course admin. Redirect to `/courses/:courseSlug` (the student-facing course view) via the router.
- `404 Not Found` → course doesn't exist. Render an inline error placeholder with a link to `/courses` (the course list).
- Any other error → render inline error placeholder.

(The backend `_is_admin_for` check in `courses.py:78` raises 403 rather than returning `is_admin: false`. The spec relies on the 403 specifically.)

No global session role exists — admin status is always per-course. All subsequent calls use the numeric `course.id` from this response.

**Entry point.** `CourseCard.svelte` renders an additional "Runs" button alongside the existing "Edit" button, visible only when `course.is_admin === true`. The card's admin-only branch (currently wrapping the entire card in an `<a>` element) must be restructured to a `<div>` with sibling buttons to avoid nested anchors. The mixed admin-enrolled branch already uses this shape; align the admin-only branch with it.

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
  runGroups.ts     # groups CRUD
  runRoster.ts     # students CRUD + batch + bulk-move + bulk-delete
  runStatus.ts     # pure: derive 'draft' | 'upcoming' | 'active' | 'ended'
  csv.ts           # pure: tiny CSV/TSV parser
```

Routes live under `pages/runs/` (sibling to the existing `pages/editor/`), not under a new `pages/admin/` subtree, to match the established convention. Backend-mirror types (`RunResponse`, `GroupResponse`, etc.) are added to `lib/types.ts` (the existing home for all shared backend mirrors). Helper-internal types (e.g., `BulkRosterErrorCode`, the CSV parser's `CsvRow`) live alongside their helpers.

### 3.2 Loading conventions

Every list rendered in this feature follows the same three-state convention:

- **Loading:** show a muted `"Loading…"` placeholder until the underlying `$state<Resource[] | null>` transitions from `null` to an array. Buttons that trigger fetches show a disabled state with a small spinner glyph (or `…` suffix) during in-flight mutations.
- **Empty:** when the array is `[]`, show a one-line empty-state message specific to the list (see each tab).
- **Loaded:** render normally.

`RunDetailPage` follows the precedent of `currentEditorVersion.svelte.ts:34-69` and `versionsPageLoader.svelte.ts:22-48`:

- Module-scoped (or component-scoped) reactive store holds the six fetched slices.
- A single-flight stale-guard token (incremented each time loading begins) gates the `await` results — if the token changed before the await resolved, discard the result.
- This prevents a stale-data race when the admin navigates `/courses/A/runs/1 → /courses/B/runs/2` and the second page mounts before the first's fetches resolve.

Concretely: each tab's data slice (`teachers`, `groups`, `students`) is held by `RunDetailPage` in `$state<T[] | null>(null)`. The publish-readiness `$derived` returns `null` (treated as "loading" by the Overview tab) until all slices have transitioned from `null`. Tabs that don't need a slice pass it through unchanged.

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

**Table (sorted by `start_date` ASC, matching the backend's `runs.py:65-67`):**

| Column | Source / behaviour |
|---|---|
| Title | `run.title`; click navigates to `/courses/:courseSlug/runs/:runId`. |
| Status | Badge from `runStatus(run)`: `Draft` / `Upcoming` / `Active` / `Ended`. |
| Version | Resolved label from the `{id → label}` map (e.g., `v3 (2026-05-10)` — label = `v{n} ({created_at YYYY-MM-DD})` since `VersionResponse` has no `published_at`; the version may or may not be published, but `RunResponse.version_id` is always set at creation). |
| Start | `run.start_date`, formatted as `YYYY-MM-DD`. |
| End | `run.end_date`, formatted as `YYYY-MM-DD`. |
| Actions | `Open` (link), `Delete` (only when `!is_published`; inline confirm; see §6 for 409 handling). |

**Empty state:** centered message "No runs yet" + a CTA "Create the first run" that opens `NewRunModal`.

**No counts column.** `RunResponse` does not include teacher/student counts; the Overview tab on the detail page is where counts are visible. Keeping the list lean avoids N+1 fetches.

**No filters or sort controls in v1.** Default ordering (start date ascending) is sufficient.

### 3.4 `NewRunModal.svelte`

Opened from `RunListPage`. Implemented as a centered overlay with an opaque backdrop. Closes via Escape, backdrop click, or the X button.

**Fields:**

| Field | Type | Validation |
|---|---|---|
| Title | text, autofocus, max 200 | non-empty after trim |
| Start date | `<input type="date">` | required |
| End date | `<input type="date">` | required; `end >= start` |
| Groups enabled | checkbox, default off | none; helper text: "Enable to organize students into groups. Locked once the run is published." |

**Version handling.** The backend auto-pins the newest published course version at creation time (`runs.py:42` calls `get_newest_published_version`). The modal does NOT include a version picker. Instead, render a read-only `Version` row: `"Will use {versionLabel}"` resolved from the versions list. If no published version exists, the `New run` button on `RunListPage` is disabled with a tooltip: `"Publish a course version before creating a run."` Same disabled state shown inside the modal as a banner if it's opened anyway (defensive).

**Submit:** `POST /api/courses/{course.id}/runs` with `{title, start_date, end_date, groups_enabled}`. No `version_id` field is sent.

- On success: close modal, navigate to `/courses/:courseSlug/runs/:newRunId`.
- On client-side validation failure: inline error under the offending field; no API call.
- On API error: banner at top of modal body with `e.displayMessage`. 401 handled by global `emitUnauthorized` inside `lib/api.ts`.

### 3.5 `RunDetailPage.svelte`

**Path:** `/courses/:courseSlug/runs/:runId`

**On mount:**
- First: `GET /api/courses/by-slug/{slug}` — admin gate + breadcrumb title.
- Then in parallel (gated by a stale-guard token; see §3.2):
  - `GET /api/runs/{runId}` — the run itself.
  - `GET /api/courses/{course.id}/versions` — for the Version label resolver.
  - `GET /api/runs/{runId}/teachers`
  - `GET /api/runs/{runId}/groups`
  - `GET /api/runs/{runId}/students`

If any of the parallel fetches fails (e.g., 404 on `/api/runs/{runId}` if the run was deleted in another tab), render a single error placeholder for the whole page; do not render the tab UI with partial data.

**Header bar (sticky):**
- Left: breadcrumb.
- Right: status badge + `Publish` / `Unpublish` button.
  - When `!is_published`: button reads `Publish`. Disabled when any readiness violation exists, with a tooltip listing the first violation. Click triggers `POST /api/runs/{runId}/publish`. After success, re-fetch `run`.
  - When `is_published`: button reads `Unpublish`, always enabled. Click triggers an inline confirm pair (`Confirm Unpublish` / `Cancel`) with a one-line warning: "Students will lose access immediately. Their progress data is preserved." After success, re-fetch `run`.

**Tabs (component-local state, no URL change):** `Overview | Teachers | Groups | Roster`.

- Tab state in `$state<'overview' | 'teachers' | 'groups' | 'roster'>('overview')`.
- Tab state is NOT persisted in URL. Browser back/forward leaves the run detail page entirely (not just a tab); documented as an explicit non-goal under §8.
- Switching tabs does not re-fetch; the parent already has everything.

**Cross-tab navigation.** `RunDetailPage` holds two extra small pieces of state used to coordinate Overview-tab → Roster-tab handoff:

- `let pendingTab: 'roster' | null = $state(null)` — when a readiness checklist row in Overview is clicked, it sets `pendingTab = 'roster'`; `RunDetailPage` reacts and sets the active tab.
- `let rosterPrefilter: 'unassigned' | null = $state(null)` — when set, `RunRosterTab` honors this on mount/prop change to show only unassigned students. Cleared on user-initiated filter change inside the Roster tab.

---

## 4. Tab content

### 4.1 `RunOverviewTab.svelte`

Three stacked sections:

**(a) Run summary card.**
- Title (inline-editable: click to focus → blur or Enter commits → PATCH `/api/runs/{runId}` with `{title}`; Escape reverts and cancels; on PATCH error, revert and show toast). The pattern is novel in this codebase; mechanics:
  - On focus: capture the current `run.title` into a `pristine` local.
  - On blur OR Enter: if value === pristine, no PATCH. Otherwise PATCH; on success update `run.title` from response; on error revert input value to `pristine` and toast.
  - On Escape: revert input value to `pristine` and blur without PATCH.
- Start and end dates (inline-editable date inputs, same mechanics as title; PATCH on blur with the changed field).
- Version label (read-only — see §3.4 for why it's not editable).
- Groups-enabled badge (`Groups: enabled` / `Groups: disabled`).
- `Created` timestamp (read-only, absolute date format `YYYY-MM-DD HH:mm`).

**(b) Settings panel.**
- Groups-enabled checkbox — PATCH on change. Disabled when `is_published`, with a tooltip: "Locked once the run is published. Unpublish to change."
- **No version picker** (auto-pinned at creation per §3.4).
- **Note about toggling `groups_enabled`:** When admin turns the toggle off on a draft run with existing assigned students, the backend keeps `group_id` values on each `RunStudent` row but the UI hides the Group column. Toggling back on restores visibility. The Settings panel surfaces this with helper text under the checkbox: "Disabling groups hides group assignments but does not delete them."

**(c) Publish readiness checklist.**

Three rows, each rendering `✓` (green pass), `✗` (red fail), or `—` (gray n/a). Computed via `$derived` from already-loaded `teachers`, `groups`, `students`, `run`.

| Check | Rule |
|---|---|
| At least one teacher | `✓` if `teachers.length >= 1`, else `✗`. |
| All students assigned to a group | If `!run.groups_enabled`, render `—`. Otherwise `✓` if every `student.group_id !== null`, else `✗` with hint "N students unassigned" (where N counts the unassigned). The hint is a button: click sets `pendingTab='roster'; rosterPrefilter='unassigned'` (see §3.5). |
| All groups have 1–10 students | If `!run.groups_enabled`, render `—`. **If `groups.length === 0` AND `run.groups_enabled`, render `✗` with hint "No groups defined".** Otherwise `✓` if every `group.student_count >= 1 && <= 10`, else `✗` with a per-group breakdown. |

**The third row is a client-side advisory only.** The backend's publish endpoint enforces only `>10`, not `<1` (see `runs.py:201-209`). The frontend surfaces the `<1` check as a UX courtesy because empty groups indicate incomplete setup, but if the user somehow publishes anyway, the backend will allow it. (The third row's failure may block the Publish button client-side, but if the backend disagrees, the 409 handler in §6 takes over.)

**(d) Danger zone.**
- `Delete run` button — visible only when `!is_published`. Inline confirm pair (`Confirm Delete` / `Cancel`).
- Click: `DELETE /api/runs/{runId}`.
  - 204 success → navigate back to `/courses/:courseSlug/runs`.
  - **409 "Run has students" → toast: "Clear roster before deleting." No force-delete UI in v1.**
  - **409 "Run has submissions" → toast with the backend message verbatim.**
  - Other errors → toast with `e.displayMessage`.

### 4.2 `RunTeachersTab.svelte`

**Top form:**
- `email` input (max 254) + `Add teacher` button.
- Submit: `POST /api/runs/{runId}/teachers` with `{email}`. Backend auto-creates the user if not found.
- After success: prepend the new row to the list. If `created_at` of the new row is within the last 5 seconds AND `user_full_name === null`, show a small `(invited)` badge next to the email to signal that the user was newly created.
- 409 (already assigned) → inline error: "Teacher already assigned to this run."
- Other errors → inline error with `e.displayMessage`.

**List:**
- Each row shows `{user_full_name || '—'} ({user_email})` plus a trash icon. (Field names match `RunTeacherResponse`: `user_email`, `user_full_name`.)
- Trash click: morphs to inline confirm pair (`Confirm Remove` / `Cancel`). Confirm → `DELETE /api/runs/{runId}/teachers/{user_id}`.
- Empty state: "No teachers assigned yet. Add one above."

### 4.3 `RunGroupsTab.svelte`

**When `run.groups_enabled === false`:** placeholder card with text "Groups are disabled for this run. Enable in Overview → Settings to manage groups." No interactive controls.

**When `groups_enabled === true`:**

**Top form:**
- `name` input (max 80) + `Add group` button.
- Submit: `POST /api/runs/{runId}/groups` with `{name}`.
- Validation: non-empty after trim; whitespace-trimmed before submission.
- 409 (name conflict) → inline error: "A group with that name already exists in this run."

**List:**
- Each row: name (inline-rename with the same Title pattern from §4.1(a); `PATCH /api/groups/{group_id}` with `{name}`), capacity badge `{student_count}/10`, trash icon.
  - Capacity badge color:
    - `0/10`: italic gray with text "empty" — distinguishes from healthy ≤7.
    - `1/10`–`7/10`: gray.
    - `8/10`–`9/10`: amber.
    - `10/10`: red.
  - Color thresholds are encoded in a small helper `getCapacityClass(count: number): string` returning a CSS class name; tests assert on the class, not the rendered color.
- Trash icon disabled (with tooltip "Move students out before deleting.") when `student_count > 0`. On click for empty groups: inline confirm pair → `DELETE /api/groups/{group_id}`.
- 409 from backend (race: someone added a student during confirm) → toast: "Group not empty — move students out first." Then refetch `groups` AND `students` (group `student_count` and roster Group dropdown both depend on this data).
- `GroupResponse.is_disabled` is read-only in v1. No UI affordance to toggle it; if a group is disabled (set by some other path), it appears in the list normally but the Roster tab's Group dropdown skips disabled groups when offering options (a disabled group is still shown in a row that already references it, with a `(disabled)` badge).

### 4.4 `RunRosterTab.svelte`

The heaviest UI. Manages individual + bulk student operations.

**Top bar:**
- Left: search input (client-side filter by email substring or full name substring, case-insensitive, trimmed). Placeholder: `"Search by name or email…"`. The filter operates on `RunRosterTab`'s `$derived` filtered list.
- Right: `Import roster` button → opens `RosterImportModal`.

**Selection state.** Uses `SvelteSet<number>` (from `svelte/reactivity`) to ensure reactivity on mutation. Selection holds `user_id` values.

**Selection action strip** (visible only when `selected.size > 0`, rendered above the table):
- `[N selected]  Move to group [▼]  Delete selected  [X clear]`
- `Move to group` dropdown lists `Unassign` + each (non-disabled) group with `(n/10)` capacity. Selecting an option triggers `POST /api/runs/{runId}/students/bulk-move` with `{user_ids: Array.from(selected), group_id: null | id}`.
  - **Chunking rule.** If `selected.size > 200`, split into N chunks of ≤200 user_ids. Fire sequentially. Aggregate per-row results across chunks before rendering the summary banner.
    - **Chunk-level network failure handling:** if any chunk throws (5xx, network), abort remaining chunks and show a summary banner: `"Moved {ok}/{total} — {failed} failed, {cancelled} cancelled (connection issue)."` with a `Retry cancelled` button that re-submits the cancelled chunks.
- `Delete selected`: morphs to inline confirm ("Confirm Delete — {N} students will be removed.") Confirm → `POST /api/runs/{runId}/students/bulk-delete`. Same chunking rule.
- After a bulk op completes (or all chunks settle), show a dismissible **summary banner** above the table:
  - Format: `"Moved 18 of 20 — 2 failed."` / `"Deleted 5 of 5."`
  - Auto-dismiss after 5s on full success; manual dismiss only on partial failure.
  - **Selection management after partial failure.** Auto-prune the `selected` set to the failed user_ids only (successful rows are removed from selection). This makes the "Retry to a different group" pattern frictionless.
  - Summary banner has a context-aware secondary button when failures are recoverable (`capacity_reached`):
    - For partial bulk-move: `Retry {N} → group [▼]` — dropdown to pick another group; re-fires `bulk-move` with the still-selected (failed) user_ids.
    - For partial bulk-delete: `Retry {N} delete` — re-fires `bulk-delete`.
    - For `not_in_run` failures: no retry button (the student is genuinely gone).
- After any bulk op (success or failure), **refetch `students` AND `groups`** before clearing the in-flight state. (Group `student_count` badges depend on the post-mutation roster.)

**Table columns** (sticky header inside the tab's scroll area):

| Col | Width | Behaviour |
|---|---|---|
| `[ ]` | small | Per-row checkbox bound to `selected` (`SvelteSet`). Header checkbox toggles only the currently-filtered rows. |
| Email | auto | `student.user_email`. |
| Full name | auto | `student.user_full_name || '—'`. |
| Group | auto | When `run.groups_enabled === true`: inline `<select>` with `Unassigned` + each non-disabled group + a passthrough option for the student's current group if it's disabled (shown as `{name} (disabled)`). Change fires `PATCH /api/runs/{runId}/students/{user_id}` with `{group_id}`. **Optimistic update mechanics:** see below. When `groups_enabled === false`: render `—`. |
| Actions | small | Trash icon → inline confirm pair → `DELETE /api/runs/{runId}/students/{user_id}`. Refetch `students` AND `groups` on success. |

**Optimistic inline group change.**
- Frontend uses an overlay map: `let pendingGroupId = $state<Record<number, number | null | undefined>>({})`. Source of truth remains `student.group_id` on the student object.
- On select change for `user_id=U` to target `G` (`null` or `int`):
  - Disable the `<select>` for that row.
  - Set `pendingGroupId[U] = G`.
  - Fire `PATCH`.
  - On success: clear `pendingGroupId[U]`; update `student.group_id = G` from the response; refetch `groups` (so capacity badges update).
  - On 409 `capacity_reached`: clear `pendingGroupId[U]`; toast "Group full — try another."
  - On 409 disabled group: clear `pendingGroupId[U]`; toast.
  - On 400 / 5xx / other: clear `pendingGroupId[U]`; toast with `e.displayMessage`.
  - On 401: handled globally by `emitUnauthorized`.
- The rendered `<select>` value is `pendingGroupId[U] ?? student.group_id ?? '__unassigned'`. The select stays disabled during in-flight PATCH; concurrent change attempts on the same row are blocked at the input level.

**Persistent "add student" row at the bottom** (always rendered, outside the scroll area):
- Email input (max 254, trimmed) + Group `<select>` (or `—` if `groups_enabled` is off) + `Add` button.
- **Client-side duplicate check.** Before POST: if a student with the trimmed-lowercased email already exists in the loaded roster, show inline error: `"{email} is already enrolled. Edit their group in the table."` Do NOT POST. (Backend would silently re-bucket — see §6.)
- **Client-side empty roster check.** If `students === null` (still loading), the Add button is disabled.
- On submit (after duplicate check passes): `POST /api/runs/{runId}/students` with `{email, group_id?}`. Send `group_id: null` (not omitted) for "Unassigned" so the wire shape matches the dropdown intent.
- On success: prepend the new row; clear and autofocus the email input. Refetch `groups` (to update the auto-created group's capacity if a new group was implied — though the single POST endpoint doesn't accept group-by-name, so this only matters when the backend's group lookup picked an existing group).
- On 400 "Group not in this run" → inline error.
- On 403 "Run version is disabled" → toast.
- On 409 capacity_reached → inline error: `"Target group is full (10 students)."`
- On 409 disabled group → inline error.
- Other errors → inline error.

**Empty / filtered-empty states.**
- Roster is `[]`: empty state "No students yet. Add one below or [Import roster from CSV]." (link version of the Import button).
- Roster non-empty but filtered to zero: empty-search row "No students match '{query}'. [Clear search]"

**207 multi-status rendering (bulk ops).**

After a bulk op returns, walk `response.results`:
- Successful rows: update local state from `result.group_id` (bulk-move) or remove from list (bulk-delete).
- Failed rows: paint a red left-border on the row, attach a `title` tooltip mapped from `error_code`:

| `error_code` | Tooltip text |
|---|---|
| `not_in_run` | "Student is no longer enrolled in this run." |
| `capacity_reached` | "Target group is full (10 students)." |
| `internal_error` | "Server error — please retry." |
| `null` (uncategorized) | Use `result.detail` verbatim, or "Unknown error" if `detail` is missing. |

Red borders persist until the next bulk op or until the row is manually unselected.

**Pagination.** None in v1. Bulk ops cap at 200; class sizes are typically well under that. Client-side search is sufficient for navigation.

### 4.5 `RosterImportModal.svelte`

Two-stage modal: **Paste & preview**, then **Result**.

**Modal lifecycle.**
- Opens with empty textarea (stage 1).
- Escape:
  - In stage 1: same as Cancel (close, no side effects).
  - In stage 2: same as Done (close + parent refresh).
- Backdrop click: same as Escape per current stage.
- X button: same as Escape per current stage.

**Stage 1 — Paste & preview:**

- Heading: "Import roster from CSV".
- Helper text: "Paste rows from Excel or Google Sheets. Columns: `name` (optional), `email` (required), `group` (optional — group is auto-created if it does not exist). Tab or comma separated."
- Large `<textarea>` (autofocus, ~10 rows tall).
- Live-parse on input (debounced 200ms) using `lib/csv.ts`. See §5.3 for the parser's normalization rules.
- Preview table below the textarea (max ~10 rows visible, scrollable):
  - Columns: `#` (row number), `Name`, `Email`, `Group`, `Status`.
  - Status per row: `✓` (valid), `✗` with reason (`Missing email`, `Invalid email format`, `Duplicate in paste (will skip)`, `Already enrolled`).
- Counts footer:
  - `"24 rows — 21 valid, 3 will skip (2 invalid, 1 duplicate-in-paste)"`.
  - `"Will auto-create groups: Group C, Group D"` if any rows reference group names not already present in the parent tab's `groups` list (case-sensitive after whitespace-trim — see §5.3).
  - `"Already-enrolled emails will be re-bucketed: alice@x.com, bob@x.com"` if any pasted email matches an existing roster row. (These rows are sent to the backend, which will silently move them to the new group; the preview surfaces this explicitly so the admin understands the side effect.)
- Buttons (right-aligned): `Cancel`, `Import N valid rows` (disabled when 0 valid; only valid rows are sent).

**Stage 2 — Result:**

- After `POST /api/runs/{runId}/students/batch` returns, replace the preview table with a results table:
  - Same columns plus a `Result` column with `added` (green) / `error` (red, with `detail` as tooltip).
  - `RunStudentBatchResultRow` (`schemas.py:476-481`) has NO `error_code` — only `email`, `status`, `group_id`, `detail`. Display the `detail` text verbatim for error rows.
- Footer: `"22 added, 0 failed."` or `"19 added, 3 failed."`.
- Buttons:
  - `Done` — closes modal, parent refetches `students` AND `groups` (auto-created groups need to appear).
  - `Copy failed rows` — visible only when failures > 0. Tries `navigator.clipboard.writeText` (wrapped in try/catch); on failure (e.g., Safari permission denied), reveals an inline `<textarea readonly>` with the failed rows for manual selection.

**No file picker.** Pasting is the only input.

---

## 5. Lib modules

All HTTP helpers use the existing `lib/api.ts` plumbing: `api.get`, `api.post`, `api.patch`, `api.delete` (NOT `api.del` — there is no such export). All requests inherit `credentials: 'include'` and the `X-Requested-With: mathion` header. 401 → `emitUnauthorized(...)` already happens inside `lib/api.ts:39-41` before throwing `ApiError`; component code does NOT need to repeat this.

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
  group_id?: number | null;       // present on success; populated with target (or null for unassign)
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

### 5.4 `lib/runGroups.ts` (new)

```ts
export function listGroups(runId: number): Promise<GroupResponse[]>;
export function createGroup(runId: number, name: string): Promise<GroupResponse>;
export function updateGroup(groupId: number, body: { name?: string; is_disabled?: boolean }): Promise<GroupResponse>;
export function deleteGroup(groupId: number): Promise<void>;
```

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

**Pre-request validation in `lib/runRoster.ts`:**
- `bulkMoveRunStudents` and `bulkDeleteRunStudents` enforce `userIds.length >= 1 && <= 200` and unique values. Violations throw a synchronous `ApiError(0, '...')` so callers fail fast and don't make a bad request. (The frontend's chunking guarantees ≤200, but the lib helper enforces it defensively.)

### 5.6 `lib/runStatus.ts` (new)

```ts
export type RunStatus = 'draft' | 'upcoming' | 'active' | 'ended';

export function runStatus(
  run: { is_published: boolean; start_date: string; end_date: string },
  now: Date = new Date(),
): RunStatus;
```

**Logic** (using local time, matching the backend's date-only semantics):
- `!run.is_published` → `draft`.
- Else if `now < startOfDay(start_date)` → `upcoming`.
- Else if `now > endOfDay(end_date)` → `ended`.
- Else → `active`.

**Timezone behavior.** Dates are evaluated in the user's local timezone. Two admins in different timezones may see different statuses near boundaries (e.g., a UTC+12 user sees "Ended" when a UTC-5 user still sees "Active"). The backend's `date` type is timezone-naive, so this is acceptable for v1; documented as an explicit non-goal under §8.

`now` is parameter-injectable for testing — pass a fixture `Date` to make tests deterministic.

### 5.7 `lib/csv.ts` (new)

```ts
export type CsvRow = {
  rowIndex: number;        // 0-based, excluding header
  raw: string[];
  parsed: { name: string | null; email: string; group: string | null };
  valid: boolean;
  errors: string[];        // human-readable
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

**Normalization rules (applied in this order):**
1. Strip a leading BOM (`﻿`).
2. Normalize line endings: `\r\n` and `\r` → `\n`.
3. Split on `\n`.
4. Trim each line; drop empty lines.
5. **Delimiter detection** from the first non-empty line:
   - Count `\t` vs `,` occurrences.
   - If counts are equal, tab wins (the deliberate tie-breaker).
6. Split each line by delimiter. **Trim each cell** (remove surrounding whitespace).
7. **Header detection:** if any cell in the first split-line matches (case-insensitive) `email`, `e-mail`, or `mail`, treat the first line as a header.
   - With header: map cells to `name`/`email`/`group` by header name.
   - Without header: positional fallback — if the first cell of the first row looks like an email (matches `/^\S+@\S+\.\S+$/`), use `[email, group?]`; otherwise use `[name, email, group?]`.
8. Per-row validation:
   - `email` required, must match the permissive regex `/^\S+@\S+\.\S+$/`. Normalize to lowercase.
   - `name` and `group` may be empty → `null`.
9. **In-paste duplicate detection.** After parsing, walk `rows`. For each row whose email is already seen in an earlier row of this paste, mark `valid = false` with error `"Duplicate in paste (will skip)"`. The first occurrence stays valid.
10. **Already-enrolled detection.** For each remaining valid row whose email matches one in `existingRosterEmails` (lowercased), mark the row valid but include the email in `alreadyEnrolledEmails`. These rows are still sent to the backend (which silently re-buckets), but the preview surfaces the intent.
11. `willCreateGroups`: sorted unique group names from valid rows that are not in `existingGroupNames` (after whitespace-trim and case-sensitive match — the backend's group lookup is case-sensitive).

**No quoted-field support in v1.** Spreadsheet rosters rarely contain quoted commas; if smoke surfaces a need, we add minimal CSV quoting in a follow-up.

**Error case:** if the input is empty after trimming, return `{ ok: false, error: 'Paste is empty.' }`. If no row has a detectable email column, return `{ ok: false, error: 'No email column found.' }`.

---

## 6. Error handling

All HTTP errors propagate as `ApiError` (existing class in `lib/api.ts`). Component handling:

| Status / shape | Default handling |
|---|---|
| 401 | Handled inside `lib/api.ts` via `emitUnauthorized`. Components do nothing extra. |
| 403 (on by-slug page mount) | Redirect to `/courses/:courseSlug`. |
| 403 (on other endpoints) | Toast: "You don't have permission to do that." Then `location.reload()`. |
| 404 (on by-slug at page mount) | Render inline "Course not found" placeholder with a link to `/courses`. |
| 404 (on `getRun` at detail page mount) | Render inline "Run not found" placeholder. |
| 404 (on roster `DELETE`) | Treat as success (the row is gone either way); refetch the affected list. |
| 404 (other) | Toast with `e.displayMessage`. |
| 409 on `publishRun` | Parse `e.displayMessage`, render in a banner under the Publish button. The readiness checklist already shows the violations; banner is for the rare case where backend disagrees with the frontend's view. |
| 409 on `deleteRun` | Toast: matches the backend's `displayMessage` — "Run has students; clear roster before deleting" or "Run has submissions; cannot delete". |
| 409 on `addRunTeacher` | Inline error on the teachers form. |
| 409 on `createGroup` (name conflict) | Inline error on the groups form. |
| 409 on `deleteGroup` (not empty, race) | Toast + refetch groups AND students. |
| 409 on `addRunStudent` (capacity / disabled group) | Inline error on the add-student row. |
| 400 on `addRunStudent` or `updateRunStudent` ("Group not in this run") | Inline error / toast. |
| 403 on `addRunStudent` ("Run version is disabled") | Toast. |
| 207-style on bulk ops | Per §4.4: summary banner + per-row red border + `error_code` tooltip, then refetch. |
| 5xx | Generic toast: "Server error — please retry." |

**Note on add-student duplicates.** The backend's `POST /api/runs/{runId}/students` does NOT return 409 on re-enrolling an existing email — it silently overwrites the student's `group_id`. The frontend's add-student row pre-checks the loaded roster before POST (see §4.4) and shows an inline error directing the admin to use the inline Group dropdown instead.

---

## 7. Testing

Vitest + jsdom. Components with runes use `.svelte.test.ts`. Tests use `mount` / `unmount` / `flushSync` patterns from the existing precedent (see `tests/AssetSidebar.svelte.test.ts`).

**Helper patterns established for this feature** (the implementation plan should set these up in T1/T2 and reference from subsequent tasks):
- **`vi.useFakeTimers()` block** — used for the debounced CSV live-parse (200ms) and the bulk-op banner auto-dismiss (5s).
- **Clipboard stub** — `Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });` Also tests the rejection branch (Safari permission denied) → falls back to revealed textarea.
- **Navigation stub** — for tests asserting redirects, spy on the router's navigation function (mirroring the existing precedent's `Object.defineProperty(window, 'location', …)` from `tests/assets.test.ts`).
- **`<select>` change event** — `select.value = newValue; select.dispatchEvent(new Event('change'));` (same as `AssetSidebar.test.ts`).

### Test files

| File | Coverage (enumerated) |
|---|---|
| `tests/runs.test.ts` | Each helper: success request shape, 401 → `emitUnauthorized`, other errors propagate as `ApiError`. Type tests for `RunCreateRequest` not including `version_id`. |
| `tests/runTeachers.test.ts` | Each helper: success, 401, 409 on add. |
| `tests/runGroups.test.ts` | Each helper: success, 401, 409 on add (conflict), 409 on delete (not empty). |
| `tests/runRoster.test.ts` | Each helper: success; 401; bulk-move/-delete client-side validation (rejects 0 user_ids, >200, duplicates); add-student sends `group_id: null` explicitly for Unassigned. |
| `tests/runStatus.test.ts` | All four states across boundary dates: `is_published=false` → draft (regardless of dates); today < start → upcoming; today === start → active; today === end → active; today > end → ended; same-day start/end. `now` injection works. |
| `tests/csv.test.ts` | Empty input error; no-email-column error; delimiter detection (`,` only, `\t` only, **tie → tab wins**); header detection (with `email`, `e-mail`, `mail`; case-insensitive); positional fallback both branches (first-cell-email → 2-col mapping; first-cell-not-email → 3-col mapping); BOM strip; CRLF normalization; trim cells; blank-line skip; invalid email flagged; **in-paste duplicate detection** (first occurrence valid, second marked invalid); **already-enrolled detection** (returns sorted unique emails); **willCreateGroups** (sorted unique, case-sensitive, whitespace-trimmed comparison). |
| `tests/RunListPage.svelte.test.ts` | Empty state + CTA renders; sort order is `start_date` ASC (3 runs with reversed dates assert DOM order); status badge uses injected `now`; version label resolution from the versions map; delete-only-when-draft; **403 from by-slug → redirect**; 404 from by-slug → inline error; new-run button disabled when versions list is empty (with tooltip). |
| `tests/NewRunModal.svelte.test.ts` | Required-field validation (title empty, start empty, end empty, end < start — four separate tests); **submit payload has no `version_id`**; navigation on success; API error → inline banner; Escape closes; backdrop click closes. |
| `tests/RunDetailPage.svelte.test.ts` | Parallel fetch on mount (asserts all 5 endpoints called); 403 from by-slug → redirect; 404 from `getRun` → inline error placeholder; tab switching does not refetch; **stale-guard**: when slug changes mid-load, the first load's results are discarded; sticky publish bar: button enabled/disabled per readiness; tooltip shows the first violation; unpublish flow with inline confirm; pendingTab/rosterPrefilter wiring from Overview → Roster. |
| `tests/RunOverviewTab.svelte.test.ts` | **Tri-state checklist permutations** (one test each): all-pass; zero teachers → row 1 ✗; one unassigned student → row 2 ✗ with "1 unassigned" hint; one oversized group (11 students) → row 3 ✗; one zero-student group → row 3 ✗ with "No groups defined" or per-group ✗ as appropriate; `groups_enabled=false` → rows 2-3 `—`; `groups_enabled=true` AND `groups.length===0` → row 3 ✗ "No groups defined". Inline-edit title: blur commits PATCH; Enter commits; Escape reverts; PATCH error reverts. Settings: groups_enabled toggle disabled when `is_published`. Danger zone: delete confirmed → DELETE called; 409 "students" → toast; 409 "submissions" → toast. |
| `tests/RunTeachersTab.svelte.test.ts` | Add flow (POST → prepend); auto-created teacher (full_name=null AND fresh created_at) shows `(invited)` badge; remove flow with inline confirm; 409 on add → inline error; empty state. |
| `tests/RunGroupsTab.svelte.test.ts` | `groups_enabled=false` → placeholder; add → POST → prepend; **inline-rename**: blur commits PATCH, Enter commits, Escape reverts; **capacity class helper**: 0 → "empty", 1-7 → "ok", 8-9 → "warn", 10 → "full" (assert class names); delete-empty → DELETE; trash disabled when `student_count > 0`; 409 on delete (race) → toast + refetch (assert listGroups AND listRunStudents both called). |
| `tests/RunRosterTab.svelte.test.ts` | Add inline (with `group_id: null` for Unassigned); **client-side duplicate check** blocks POST and shows inline error; client-side search (email match, name match, case-insensitivity — three tests); **select-all toggles only filtered rows**; selection state survives search-filter changes; **inline group change optimistic update**: select disabled during in-flight; success updates `student.group_id` + refetches `groups`; **409 capacity_reached reverts pendingGroupId** and toasts; 5xx reverts + toasts; **bulk-move chunking**: 200 → 1 request; 201 → 2 requests of [200, 1]; 450 → 3 requests; assert **sequential** firing (request #2 doesn't start until #1 resolves); 207 aggregation across chunks; **chunk-level 5xx aborts remaining chunks** with "Retry cancelled" button; **207 per-row mapping**: one test per `error_code` (`not_in_run`, `capacity_reached`, `internal_error`, null/uncategorized using `detail` verbatim); **selection auto-pruned to failed rows** after partial failure; **Retry button on banner** for `capacity_reached` failures; **banner auto-dismiss** after 5s with fake timers on full success; manual dismiss on partial failure; refetch `students` AND `groups` after every bulk op. |
| `tests/RosterImportModal.svelte.test.ts` | Paste → preview happy path with debounced live-parse using fake timers (advance 200ms); invalid rows flagged with reason; in-paste duplicates flagged; already-enrolled emails listed in counts footer; willCreateGroups displayed; submit calls batch endpoint with valid rows only (deduped, no already-enrolled rejected — they go through and re-bucket); stage 2 result rendering with mixed success/error; **copy-failed-rows clipboard success** (clipboard mock asserted); **copy-failed-rows fallback** (clipboard rejects → textarea revealed). Escape in stage 1 closes; Escape in stage 2 closes + parent refetch (assert listRunStudents AND listGroups called). |

### Manual smoke plan

Run on the user's machine via `run-debug.sh`. Pre-condition: course `calc-101` exists with at least one published version, and the test user is an admin of that course.

1. Open `/courses/calc-101/runs` as a non-admin → redirected to `/courses/calc-101`.
2. As admin, open `/courses/calc-101/runs` → empty state visible.
3. Open a fake URL `/courses/no-such-course/runs` → inline "Course not found" with link back.
4. Create a run via `NewRunModal`: title, start, end (end >= start enforced), groups_enabled=on → navigates to detail page; verify version label shows the auto-pinned version under the title.
5. On detail page, edit title inline: type, blur → persisted on refresh. Type again, Escape → reverts.
6. Toggle `groups_enabled` off then on → Groups tab placeholder appears/disappears.
7. Add a teacher by email of a non-existing user → row shows `(invited)` badge briefly.
8. Add three groups → capacity badges all show "empty" with italic styling.
9. Use `RosterImportModal`: paste 6 rows including:
   - 1 row with a malformed email,
   - 1 row that duplicates the email of an earlier row in the paste,
   - 1 row referencing a brand-new group,
   - 1 row whose email is already enrolled (precondition: add an enrollment via a prior step).
   - Verify preview flags the invalid + duplicate rows, lists new group under `willCreateGroups`, lists already-enrolled email separately.
   - Import → stage 2 shows correct successes + the already-enrolled row's group changed.
10. Try to add a student with an already-enrolled email via the inline add row → inline error directing to use the Group dropdown.
11. Inline-edit one student's group to "Unassigned" → optimistic update visible immediately; on success, Overview readiness check now shows ✗ for "All students assigned".
12. Select two students; bulk-move to a group that's at 9/10 capacity → first one succeeds, second one fails with `capacity_reached`. Verify summary banner with retry button; successful row's group updates; failed row has red border + tooltip; selection auto-pruned to the failed row.
13. Click `Retry → group [▼]` on the banner; pick a different group → succeeds.
14. Select one student, bulk-delete → row removed; summary banner; auto-dismiss after 5s.
15. Try to delete a non-empty group → trash disabled with tooltip. Move students out, then delete → group disappears.
16. With one teacher missing, one student unassigned, and one empty group → all three readiness rows show ✗ with hints. Click "N students unassigned" → switches to Roster tab pre-filtered to unassigned.
17. Add teacher, assign all students, ensure groups all populated → Publish button enables. Publish → status badge changes to Upcoming/Active/Ended per dates.
18. Try to change title or groups_enabled on a published run → groups_enabled toggle disabled; title inline-edit still works (per backend: title is editable post-publish).
19. Unpublish via inline confirm → fields re-enabled.
20. Try to delete an unpublished run that still has students → toast "Clear roster before deleting." Clear roster, then delete → run disappears from list.
21. Cause a 401 (manually clear session cookie in DevTools and trigger any mutation) → global redirect to login.

---

## 8. Non-goals and explicit deferrals

- Teacher-facing pages, dashboards, analytics, gradebook, attendance (separate spec).
- Force-delete a run with roster intact (admin must clear roster first; no `?force=true` UI in v1).
- Re-pinning a run to a different version after creation (backend doesn't support it).
- Editing `is_disabled` on groups via UI (read-only in v1).
- Cross-course run hub (`/admin/runs`); admins work within one course at a time.
- Bulk teacher import.
- File-upload variant of roster import.
- Quoted-field CSV support.
- Pagination of the roster table.
- Per-student profile page.
- Tab state in URL / deep-linkable tabs (browser back leaves the run detail page entirely).
- Cross-timezone status display agreement (`runStatus` uses local time; admins in different zones may see different statuses near boundaries; date-only backend semantics make this acceptable for v1).
- Capacity threshold overrides (1–10 is hard-coded on the backend).
- Force-revalidate after another admin's concurrent edit (no live updates; admin must refresh).

---

## 9. Acceptance criteria

The implementation is complete when:

1. Both routes added to `src/routes.ts` with `:courseSlug`/`:runId` param names and admin-gated.
2. `CourseCard` renders the new "Runs" entry-point button for admins without producing nested anchors.
3. All eight new Svelte components compile, render, and pass vitest tests.
4. All four new lib modules (`runs.ts`, `runTeachers.ts`, `runGroups.ts`, `runRoster.ts`) plus `runStatus.ts` and `csv.ts` exist with the documented signatures and pass their unit tests.
5. Backend-mirror types added to `lib/types.ts`.
6. svelte-check baseline preserved (0 errors; existing warning count unchanged — verify at execution time, do not carry the number forward blindly).
7. The 21-step manual smoke plan passes end-to-end on a local backend running via `run-debug.sh`.
8. Backend unchanged: no migrations, no schema edits, no endpoint changes. The spec is purely frontend.
9. The 9-task implementation plan completes with each task individually verified and reviewer-approved.

---

## 10. Task decomposition preview

The implementation plan (written next via `superpowers:writing-plans`) will use 9 tasks:

1. **`lib/runs.ts` + types** — type mirrors in `lib/types.ts`; the 7 run-CRUD helpers; tests. Verify backend response shapes match.
2. **`lib/runTeachers.ts`, `lib/runGroups.ts`, `lib/runRoster.ts`** — three small modules + their tests. Establishes the bulk-op client-side validation pattern.
3. **`lib/runStatus.ts` + `lib/csv.ts` + tests** — pure functions. Establishes fake-timer + clipboard-mock patterns reusable by later tasks.
4. **`RunListPage` + `NewRunModal` + `routes.ts` wiring + `CourseCard` "Runs" button** — page-level routing, admin gate, list table, modal. Tests include the version-empty case and the by-slug 403 redirect.
5. **`RunDetailPage` shell + tabs scaffold + `RunOverviewTab`** — stale-guard pattern, parallel fetch, publish bar, readiness checklist with all tri-state permutations.
6. **`RunTeachersTab` + `RunGroupsTab`** — both small CRUD tabs. Establishes the inline-rename and inline-confirm patterns reused by Roster.
7. **`RunRosterTab` core** — table, search, select-all-filtered, single-row inline group edit (optimistic), single-row delete, persistent add-student row with duplicate pre-check.
8. **Roster bulk ops + `RosterImportModal`** — selection strip, bulk-move + bulk-delete chunking, 207 mapping with all error codes, summary banner with retry, the two-stage import modal. (Both depend on T7's table.)
9. **Final integration** — manual smoke walk-through, full vitest, svelte-check baseline check, branch cleanup, merge prep.
