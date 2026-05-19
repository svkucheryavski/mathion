# Run Management (Admin Surface) — Design

**Date:** 2026-05-19
**Scope:** Mathion frontend — admin-only run management for a single course.
**Status:** Brainstorm-validated; ready for implementation plan.

---

## 1. Goals and scope

Build the admin-facing UI for managing course **runs** (cohorts of students who use a specific course version over a date range). The backend (Phases 7a + 7d) is already shipped: runs, run-teachers, groups, run-students, and bulk roster operations.

This spec covers everything an admin needs to set up and operate a run end-to-end:

- Create / edit / delete runs (when unpublished).
- Configure run settings (title, dates, course version, `groups_enabled`).
- Assign and remove teachers.
- Manage groups (when `groups_enabled`): create / rename / delete.
- Manage roster: add students individually, bulk-import from spreadsheet paste, edit group assignments inline, bulk-move and bulk-delete.
- Publish / unpublish a run, with a pre-validation readiness checklist.

**Out of scope (deferred to a follow-up spec):**
- Teacher-facing surface (read-only monitoring, dashboards, per-student progress).
- Run analytics, gradebook export, attendance.
- Per-group settings beyond name (e.g., schedule, location).

---

## 2. Routes and navigation

Two new routes added to `src/routes.ts`:

| Path | Component | Auth | Access |
|---|---|---|---|
| `/courses/:slug/runs` | `RunListPage.svelte` | yes | course admin only |
| `/courses/:slug/runs/:rid` | `RunDetailPage.svelte` | yes | course admin only |

Both routes sit alongside the existing `/courses/:slug/edit` admin surface and follow the same gating pattern.

**Page-level access check.** On mount, each page calls `GET /api/courses/by-slug/{slug}` (which returns `is_admin: bool` along with `id`). If `is_admin === false`, redirect to `/courses/:slug` (the student-facing course view). No global session role exists — admin status is always per-course. All subsequent calls use the numeric `course.id` from this response.

**Entry point.** `CourseCard.svelte` renders an additional "Runs" button alongside the existing "Edit" button, visible only when `course.is_admin === true`.

**Breadcrumbs.**
- `RunListPage`: `Courses › {course.title} › Runs`
- `RunDetailPage`: `Courses › {course.title} › Runs › {run.title}`

The breadcrumb segments link to the parent surfaces.

---

## 3. Pages and components

### File layout

```
frontend/src/pages/admin/runs/
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
  runs.ts
  runStatus.ts
  csv.ts
```

### 3.1 `RunListPage.svelte`

**Path:** `/courses/:slug/runs`

**On mount:**
- First: `GET /api/courses/by-slug/{slug}` — gate on `is_admin`; obtain `course.id`.
- Then in parallel (using `course.id`):
  - `GET /api/courses/{course.id}/runs` — list of runs.
  - `GET /api/courses/{course.id}/versions` — for building a `{version_id → label}` map for the table's Version column.

**Header bar:**
- Left: breadcrumb (`Courses › {course.title} › Runs`).
- Right: `New run` button → opens `NewRunModal`.

**Table (sorted by `created_at` desc):**

| Column | Source / behaviour |
|---|---|
| Title | `run.title`; click navigates to `/courses/:slug/runs/:rid`. |
| Status | Badge from `runStatus(run)`: `Draft` / `Upcoming` / `Active` / `Ended`. |
| Version | Resolved label from the `{id → label}` map; e.g., `v3 (published 2026-05-10)`. |
| Start | `run.start_date`, formatted as `YYYY-MM-DD`. |
| End | `run.end_date`, formatted as `YYYY-MM-DD`. |
| Actions | `Open` (link), `Delete` (only when `!is_published`; inline confirm). |

**Empty state:** centered message "No runs yet" + a CTA "Create the first run" that opens `NewRunModal`.

**No counts column.** `RunResponse` does not include teacher/student counts; the Overview tab on the detail page is where counts are visible. Keeping the list lean avoids N+1 fetches.

**No filters / sort controls in v1.** Default newest-first is sufficient. Status filter is a low-risk follow-up if usage grows.

### 3.2 `NewRunModal.svelte`

Opened from `RunListPage`. Implemented as a centered overlay with an opaque backdrop. Closes via Escape, backdrop click, or the X button.

**Fields:**

| Field | Type | Validation |
|---|---|---|
| Title | text, autofocus, max 200 | non-empty after trim |
| Version | `<select>` populated from `GET /api/courses/{course.id}/versions` (passed in from `RunListPage`'s already-fetched list, all versions, latest first) | required |
| Start date | `<input type="date">` | required (backend requires both dates) |
| End date | `<input type="date">` | required; `end >= start` |
| Groups enabled | checkbox, default off | none; helper text: "Enable to organize students into groups. Locked once the run is published." |

**Submit:** `POST /api/courses/{course.id}/runs` with `{title, version_id, start_date, end_date, groups_enabled}`.

- On success: close modal, navigate to `/courses/:slug/runs/:newRunId`.
- On client-side validation failure: inline error under the offending field; no API call.
- On API error: banner at top of modal body with `e.displayMessage`. 401 handled by global `emitUnauthorized` in the API helper.

### 3.3 `RunDetailPage.svelte`

**Path:** `/courses/:slug/runs/:rid`

**On mount:**
- First: `GET /api/courses/by-slug/{slug}` — admin gate; obtain `course.id` and breadcrumb title.
- Then in parallel:
  - `GET /api/runs/{rid}` — the run itself.
  - `GET /api/courses/{course.id}/versions` — for the version label and Settings tab's version picker.
  - `GET /api/runs/{rid}/teachers` — Teachers tab + readiness checklist.
  - `GET /api/runs/{rid}/groups` — Groups tab + readiness checklist + Roster tab dropdowns.
  - `GET /api/runs/{rid}/students` — Roster tab + readiness checklist.

All six pieces of data live as `$state` in `RunDetailPage` and are passed as props (read-only or bindable as needed) to each tab. Mutations re-fetch only the affected slice.

**Header bar (sticky):**
- Left: breadcrumb.
- Right: status badge + `Publish` / `Unpublish` button.
  - When `is_published === false`: button reads `Publish`, disabled if any readiness violation, with a tooltip listing the first violation. Click triggers `POST /api/runs/:rid/publish`.
  - When `is_published === true`: button reads `Unpublish`, always enabled. Click triggers `POST /api/runs/:rid/unpublish` after inline confirmation ("Unpublish run? Students will lose access until republished.").

**Tabs (component-local state, no URL change):** `Overview | Teachers | Groups | Roster`.

- Tab state in `$state<'overview' | 'teachers' | 'groups' | 'roster'>('overview')`.
- Switching tabs does not re-fetch; the parent already has everything.
- The `Groups` tab is rendered but its content is replaced by a placeholder when `run.groups_enabled === false` (see §4.3).

---

## 4. Tab content

### 4.1 `RunOverviewTab.svelte`

Three stacked sections:

**(a) Run summary card.**
- Title (inline-editable on click → PATCH `/api/runs/:rid` with `{title}` on blur or Enter).
- Start and end dates (inline-editable date inputs → PATCH on blur).
- Version label (read-only here; editable in the Settings panel below).
- Groups-enabled badge (`Groups: enabled` / `Groups: disabled`).
- `Created` timestamp (read-only).

**(b) Settings panel.**
- Version `<select>` — same options as `NewRunModal`. Disabled when `is_published`, with a tooltip: "Locked once the run is published. Unpublish to change."
- Groups-enabled checkbox — same disabled rule.
- Both fields PATCH on change.

**(c) Publish readiness checklist** (a `derived` over teachers/groups/students):

| Check | Pass when | Tri-state? |
|---|---|---|
| At least one teacher | `teachers.length >= 1` | No |
| All students assigned to a group | every `student.group_id !== null` | Only checked if `groups_enabled === true`; otherwise renders `—`. |
| All groups have 1–10 students | every `group.student_count >= 1 && <= 10` | Only checked if `groups_enabled === true`; otherwise renders `—`. |

Each row renders `✓` (green), `✗` (red), or `—` (gray). Failing rows show a one-line hint (e.g., "3 students are unassigned" with a link that switches to the Roster tab and pre-filters to unassigned).

**(d) Danger zone.**
- `Delete run` button — visible only when `!is_published`. Inline confirm ("Click to confirm — this cannot be undone"). On success, navigate back to `/courses/:slug/runs`.

### 4.2 `RunTeachersTab.svelte`

**Top form:**
- `email` input + `Add teacher` button.
- Submit: `POST /api/runs/:rid/teachers` with `{email}`. Backend auto-creates the user if not found.
- After success: prepend the new row to the list and clear the form.
- 409 (already assigned) → inline error: "Teacher already assigned."

**List:**
- Each row shows `{full_name | '—'} ({email})` plus a trash icon.
- Trash click: morphs to "Click to confirm". Confirm → `DELETE /api/runs/:rid/teachers/:uid`.
- Empty state: "No teachers assigned yet. Add one above."

### 4.3 `RunGroupsTab.svelte`

**When `run.groups_enabled === false`:** placeholder card with text "Groups are disabled for this run. Enable in Overview → Settings to manage groups." No interactive controls.

**When `groups_enabled === true`:**

**Top form:**
- `name` input + `Add group` button.
- Submit: `POST /api/runs/:rid/groups` with `{name}`.
- Validation: non-empty after trim, max 80 chars.
- 409 (name conflict) → inline error: "A group with that name already exists in this run."

**List:**
- Each row: name (inline-rename on click — same UX pattern as run title), capacity badge `{student_count}/10` (gray ≤7, amber 8–9, red 10), trash icon.
- Trash icon disabled (with tooltip "Move students out before deleting.") when `student_count > 0`. On click for empty groups: inline confirm → `DELETE /api/groups/:gid`.
- 409 from backend (race: someone added a student during confirm) → toast: "Group not empty — move students out first." and refresh group list.

### 4.4 `RunRosterTab.svelte`

The heaviest UI. Manages individual + bulk student operations.

**Top bar:**
- Left: search input (client-side filter by email substring or full name substring, case-insensitive). Placeholder: "Search by name or email…"
- Right: `Import roster` button → opens `RosterImportModal`.

**Selection action strip** (visible only when `selected.size > 0`, rendered above the table):
- `[N selected]  Move to group [▼]  Delete selected  [X clear]`
- `Move to group` dropdown lists `Unassign` + each group with `(n/10)` capacity. Selecting an option triggers `POST /api/runs/:rid/students/bulk-move` with `{user_ids: Array.from(selected), group_id: null | id}`.
  - Chunking: if `selected.size > 200`, split into N requests of ≤200, fire sequentially, aggregate result.
- `Delete selected`: morphs to "Click to confirm — N students will be removed." Confirm → `POST /api/runs/:rid/students/bulk-delete`. Same chunking rule.
- After either bulk op completes (or all chunks settle), show a dismissible **summary banner** above the table:
  - Format: `"Moved 18 of 20 — 2 failed."` / `"Deleted 5 of 5."`
  - Banner is auto-dismissed after 5s on full success; manual dismiss on partial failure.

**Table columns** (sticky header inside the tab's scroll area):

| Col | Width | Behaviour |
|---|---|---|
| `[ ]` | small | Per-row checkbox. Header has select-all (toggles only the currently-filtered rows). |
| Email | auto | Static text. |
| Full name | auto | Static text or `—` if user record has no full_name. |
| Group | auto | When `run.groups_enabled === true`: inline `<select>` with `Unassigned` + each group. Change fires `PATCH /api/runs/:rid/students/:uid` with `{group_id}`. Optimistic update; revert on error with toast. When `groups_enabled === false`: render `—`. |
| Actions | small | Trash icon → inline confirm → `DELETE /api/runs/:rid/students/:uid`. |

**Persistent "add student" row at the bottom** (always rendered, below the data rows; outside the scroll area if needed):
- Email input (max 254) + Group `<select>` (or `—` if `groups_enabled` is off) + `Add` button.
- Submit: `POST /api/runs/:rid/students` with `{email, group_id?}`.
- Success: prepend the new row to the table; clear and autofocus the form for repeat-adds.
- 409 (already enrolled) / 404 (user not found — should not happen; backend auto-creates) → inline error below the form.

**207 multi-status rendering (bulk ops):**

After a bulk op returns, walk `response.results`:
- Successful rows: update local state from `result.group_id` (for bulk-move) or remove from list (bulk-delete).
- Failed rows: leave selected, paint a red left-border on the row, attach a `title` tooltip mapped from `error_code`:

| `error_code` | Tooltip text |
|---|---|
| `not_in_run` | "Student is no longer enrolled in this run." |
| `capacity_reached` | "Target group is full (10 students)." |
| `internal_error` | "Server error — please retry." |
| `null` (uncategorized) | Use `result.detail` verbatim. |

**Pagination.** None in v1. Bulk ops cap at 200; class sizes are typically well under that. Client-side search filter is sufficient for navigation.

### 4.5 `RosterImportModal.svelte`

Two-stage modal: **Paste & preview**, then **Result**.

**Stage 1 — Paste & preview:**

- Heading: "Import roster from CSV".
- Helper text: "Paste rows from Excel or Google Sheets. Columns: `name` (optional), `email` (required), `group` (optional — group is auto-created if it does not exist). Tab or comma separated."
- Large `<textarea>` (autofocus, ~10 rows tall).
- Live-parse on input (debounced 200ms) using `lib/csv.ts`:
  - Delimiter detection: count `\t` vs `,` in the first non-empty line; tab wins on tie.
  - Header detection: case-insensitive match for `email` / `e-mail` / `mail` in any cell of the first non-empty line; if matched, treat first line as header and use it for column mapping (`name`/`email`/`group`); otherwise use positional mapping `[name?, email, group?]`.
  - Skip blank lines.
- Preview table below the textarea (max ~10 rows visible, scrollable):
  - Columns: `#` (row number), `Name`, `Email`, `Group`, `Status`.
  - Status per row: `✓` (valid) or `✗` with reason (`Missing email`, `Invalid email format`).
  - Invalid rows are rendered with a red row-tint.
- Counts footer:
  - `"24 rows — 22 valid, 2 invalid"`.
  - `"Will auto-create groups: Group C, Group D"` if any rows reference group names not already present (computed against the parent tab's `groups` list).
- Buttons (right-aligned): `Cancel`, `Import 22 valid rows` (disabled when 0 valid; only valid rows are sent).

**Stage 2 — Result:**

- After `POST /api/runs/:rid/students/batch` returns, replace the preview table with a results table:
  - Same columns plus a `Status` column with `added` (green) / `error` (red).
  - Error rows show the server-provided `detail` text in a sub-cell or tooltip.
- Footer: `"22 added, 0 failed."` or `"19 added, 3 failed."`.
- Buttons:
  - `Done` — closes modal, parent re-fetches students and groups (auto-created groups need to appear).
  - `Copy failed rows` — visible only when failures > 0. Copies the failed rows' input text back to the clipboard as CSV (so the admin can edit and retry without retyping).

**Modal lifecycle:**
- Opens with empty textarea (stage 1).
- Cancel from stage 1: close immediately.
- Submit from stage 1: disable buttons, show loading state, transition to stage 2 on response.
- Done from stage 2: close + parent refresh.

**No file picker.** Pasting is the only input. Matches the spreadsheet-to-clipboard workflow that teachers actually use.

---

## 5. Frontend lib modules

### 5.1 `lib/runs.ts` (new)

Typed thin wrappers around `lib/api.ts`'s `get` / `post` / `patch` / `del`. One module for all run-management endpoints.

**Types** (mirroring backend schemas):

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

export type RunCreate = {
  title: string;
  version_id: number;
  start_date: string;
  end_date: string;
  groups_enabled: boolean;
};

export type RunUpdate = Partial<RunCreate>;

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
  user_id: number;
  email: string;
  full_name: string | null;
  group_id: number | null;
};

export type RunStudentBatchRow = {
  name?: string;
  email: string;
  group?: string;
};

export type RunStudentBatchResult = {
  email: string;
  status: 'added' | 'error';
  group_id?: number;
  detail?: string;
};

export type BulkRosterErrorCode =
  | 'not_in_run'
  | 'capacity_reached'
  | 'internal_error';

export type BulkOpResultRow = {
  user_id: number;
  status: 'ok' | 'error';
  group_id?: number;
  detail?: string;
  error_code?: BulkRosterErrorCode;
};

export type BulkOpResponse = {
  results: BulkOpResultRow[];
  summary: { total: number; ok: number; error: number };
};
```

**Functions** (one for each endpoint; signatures listed; implementations are thin wrappers):

```ts
export function listRuns(courseId: number): Promise<RunResponse[]>;
export function createRun(courseId: number, body: RunCreate): Promise<RunResponse>;
export function getRun(runId: number): Promise<RunResponse>;
export function updateRun(runId: number, body: RunUpdate): Promise<RunResponse>;
export function deleteRun(runId: number): Promise<void>;
export function publishRun(runId: number): Promise<RunResponse>;
export function unpublishRun(runId: number): Promise<RunResponse>;

export function listRunTeachers(runId: number): Promise<RunTeacherResponse[]>;
export function addRunTeacher(runId: number, email: string): Promise<RunTeacherResponse>;
export function removeRunTeacher(runId: number, userId: number): Promise<void>;

export function listGroups(runId: number): Promise<GroupResponse[]>;
export function createGroup(runId: number, name: string): Promise<GroupResponse>;
export function updateGroup(groupId: number, body: { name?: string; is_disabled?: boolean }): Promise<GroupResponse>;
export function deleteGroup(groupId: number): Promise<void>;

export function listRunStudents(runId: number): Promise<RunStudentResponse[]>;
export function addRunStudent(runId: number, email: string, groupId?: number | null): Promise<RunStudentResponse>;
export function updateRunStudent(runId: number, userId: number, groupId: number | null): Promise<RunStudentResponse>;
export function removeRunStudent(runId: number, userId: number): Promise<void>;
export function batchAddRunStudents(runId: number, rows: RunStudentBatchRow[]): Promise<{ results: RunStudentBatchResult[] }>;
export function bulkMoveRunStudents(runId: number, userIds: number[], groupId: number | null): Promise<BulkOpResponse>;
export function bulkDeleteRunStudents(runId: number, userIds: number[]): Promise<BulkOpResponse>;
```

All requests use the existing `lib/api.ts` plumbing: `credentials: 'include'`, `X-Requested-With: mathion` header, and 401 → `emitUnauthorized(location.pathname + location.search + location.hash)` before throwing `ApiError`. Errors propagate to callers as `ApiError` with `status` and `displayMessage`.

### 5.2 `lib/runStatus.ts` (new)

```ts
export type RunStatus = 'draft' | 'upcoming' | 'active' | 'ended';

export function runStatus(
  run: { is_published: boolean; start_date: string; end_date: string },
  now: Date = new Date(),
): RunStatus;
```

**Logic:**
- If `!run.is_published`: `draft`.
- Else if `now < startOfDay(start_date)`: `upcoming`.
- Else if `now > endOfDay(end_date)`: `ended`.
- Else: `active`.

`startOfDay` and `endOfDay` use local time (matching the backend's `date` semantics, which are date-only).

Pure function — directly unit-testable; no Svelte runes inside.

### 5.3 `lib/csv.ts` (new)

```ts
export type CsvRowInput = string[];

export type CsvRowParsed = {
  name: string | null;
  email: string;
  group: string | null;
};

export type CsvRow = {
  rowIndex: number;          // 0-based, excluding header
  raw: CsvRowInput;
  parsed: CsvRowParsed;
  valid: boolean;
  errors: string[];          // human-readable, e.g. "Missing email"
};

export type CsvParseResult = {
  delimiter: ',' | '\t';
  hasHeader: boolean;
  columnMap: { name: number | null; email: number; group: number | null };
  rows: CsvRow[];
  validCount: number;
  invalidCount: number;
  willCreateGroups: string[];   // unique, sorted; computed against existingGroupNames param
};

export function parseCsv(
  text: string,
  existingGroupNames: string[],
): CsvParseResult | { error: string };
```

**Behaviour:**
- Returns `{ error }` if the input is empty or has no detectable email column.
- Delimiter: detect `\t` vs `,` from the first non-empty line.
- Header detection: case-insensitive match for `email`/`e-mail`/`mail` in any cell.
- Column mapping:
  - With header: explicit `name` / `email` / `group` lookup by header name.
  - Without header: positional `[name?, email, group?]` — heuristic: if first cell looks like an email, treat as `[email, group?]`; otherwise treat as `[name, email, group?]`.
- Per-row validation:
  - `email` required, must match a permissive regex (`/^\S+@\S+\.\S+$/`).
  - `name`, `group` may be empty (rendered as `null`).
- `willCreateGroups`: sorted unique list of non-empty group names from valid rows that are not in `existingGroupNames`.

**No quoted-field handling in v1.** Spreadsheet rosters from teachers rarely contain quoted commas; if a smoke bug surfaces, we add minimal quoting support in a follow-up.

---

## 6. Error handling

All HTTP errors propagate as `ApiError` (existing class in `lib/api.ts`). Component handling pattern:

| Status | Default handling |
|---|---|
| 401 | Already handled inside `lib/api.ts` via `emitUnauthorized`. Components do nothing extra. |
| 403 | Toast: "You don't have permission to do that." Then `location.reload()` to refresh `is_admin` (covers role-revocation races). |
| 404 (on `:rid` page load) | Render an inline "Run not found" message with a back link. |
| 404 (on roster `DELETE`) | Treat as success (the row is gone either way); refresh the affected list. Same pattern as the asset-upload delete race. |
| 409 on `publish` | Parse `e.displayMessage`, render in a banner under the Publish button. Do not toast — the readiness checklist already shows the violations. |
| 409 on `addRunTeacher` | Inline error on the teachers form. |
| 409 on `createGroup` | Inline error on the groups form. |
| 409 on `deleteGroup` | Toast: "Group not empty — move students out first." Re-fetch groups. |
| 409 on `addRunStudent` | Inline error on the add-student row. |
| 207 (bulk ops) | Per §4.4 summary banner + per-row red border + `error_code` tooltip. |
| 5xx | Generic toast: "Server error — please retry." |

**Global plumbing.** `lib/api.ts` already calls `emitUnauthorized(location.pathname + location.search + location.hash)` before throwing on 401, and the existing app shell wires `onUnauthorized` to a router redirect. No changes needed.

---

## 7. Testing

Vitest + jsdom, matching the established Mathion test patterns. All tests use the `mount` / `unmount` / `flushSync` pattern; runes in tests require the `.svelte.test.ts` filename suffix.

| Test file | Coverage |
|---|---|
| `tests/runs.test.ts` | Each HTTP helper: request shape, response parsing, 401 triggers `emitUnauthorized`, 403/5xx propagate as `ApiError`. |
| `tests/runStatus.test.ts` | All four states across boundary dates (today=start, today=end, today=end+1, draft regardless of dates). |
| `tests/csv.test.ts` | Delimiter detection (`,` vs `\t`), header detection, positional fallback, blank-line skip, invalid emails flagged, `willCreateGroups` computation, empty-input error. |
| `tests/RunListPage.svelte.test.ts` | Renders rows; empty state + CTA; delete-only-when-draft; status badge; version label resolution from the versions map; non-admin redirect to `/courses/:slug`. |
| `tests/NewRunModal.svelte.test.ts` | Required-field validation, date-order check, submit calls `createRun` with normalized payload, navigation on success, error banner on API error. |
| `tests/RunDetailPage.svelte.test.ts` | Parallel fetch on mount; tab switching preserves data; breadcrumb; publish button enabled/disabled per readiness; unpublish workflow. |
| `tests/RunOverviewTab.svelte.test.ts` | Readiness checklist across all permutations: zero teachers; some unassigned students; one oversized group; `groups_enabled=false` renders `—` for grouping checks; inline-edit dispatches PATCH. |
| `tests/RunTeachersTab.svelte.test.ts` | Add flow (POST + list prepend), auto-created user reflected with email only, remove flow with inline confirm, empty state. |
| `tests/RunGroupsTab.svelte.test.ts` | `groups_enabled=false` placeholder; add / inline-rename / delete-empty; trash disabled when `student_count > 0`; 409 on delete (race) shows toast + refreshes. |
| `tests/RunRosterTab.svelte.test.ts` | Add inline; client-side search filter; inline group change PATCH with optimistic update + rollback on error; bulk-move including >200 split; bulk-delete; 207 partial failure rendering (red border + tooltip per error code); summary banner. |
| `tests/RosterImportModal.svelte.test.ts` | Paste → preview happy path; invalid rows flagged with reason; willCreateGroups listed; submit calls batch endpoint with valid rows only; stage 2 result rendering with mixed success/error; copy-failed-rows clipboard behavior. |

**Manual smoke plan** (post-implementation, run on the user's machine via `run-debug.sh`):

1. Open `/courses/:slug/runs` as a non-admin → redirected to `/courses/:slug`.
2. As admin, open `/courses/:slug/runs` → empty state visible.
3. Create a run via `NewRunModal` → navigates to detail page.
4. On detail page, edit title inline; refresh; title persisted.
5. Toggle `groups_enabled` off then on; Groups tab placeholder appears/disappears.
6. Add a teacher by email of a non-existing user; verify auto-created user shows up.
7. Add three groups; verify capacity badge `(0/10)` for each.
8. Use `RosterImportModal`: paste 5 rows from a spreadsheet, including one row with a malformed email and one row referencing a brand-new group; verify preview flags the invalid row and lists the new group under `willCreateGroups`; import; verify 4 added, new group created.
9. Inline-edit one student's group to "Unassigned"; verify Roster row updates and the Overview readiness check now shows `✗` for "All students assigned".
10. Select two students, bulk-move to a group that's already at capacity (force `capacity_reached`); verify red borders + tooltip on failed rows + summary banner with partial counts.
11. Select one student, bulk-delete; verify row removed and summary banner.
12. Try to delete a group with students → trash disabled with tooltip. Move students out, then delete → group disappears.
13. Try to publish run with no teacher → button disabled with tooltip. Add teacher, ensure all assigned, then publish → run state becomes `Upcoming` / `Active` / `Ended` per dates.
14. After publishing, try to change version → field disabled with "locked" tooltip. Unpublish → field re-enabled.
15. Delete an unpublished run → list page; row gone.

---

## 8. Open items and explicit non-goals

**Open items (resolved in plan-writing, not blocking):**
- Exact CSS approach for the modals and tabs — will follow existing component styling conventions in `src/components/`. No new design system.
- Whether to add a status filter chip strip to the run list — defer to a smoke-test outcome.
- Whether the version dropdown should sort by `version_number` desc or `created_at` desc — pick `version_number` desc unless the backend returns differently; verify when wiring.

**Non-goals (explicitly out of scope for this spec):**
- Teacher-facing pages of any kind. The teacher surface (read-only monitoring + Phase 7c dashboards) is a separate follow-up spec.
- Group capacity overrides above 10 or below 1.
- Per-student detail page or profile edit.
- File-upload variant of roster import; paste-only.
- Quoted-field CSV support; add later if smoke surfaces a need.
- Pagination of the roster table; class sizes typically fit under the 200 bulk cap.
- Run analytics, gradebook, attendance, schedule.
- Bulk teacher import (one-at-a-time form is sufficient).
- Cross-course run hub (`/admin/runs`); admins work within one course at a time.

---

## 9. Acceptance criteria

The implementation is complete when:

1. All routes added and gated by per-course `is_admin`.
2. CourseCard renders the new "Runs" entry-point button for admins.
3. All eight new components compile, render, and pass vitest tests.
4. `lib/runs.ts`, `lib/runStatus.ts`, `lib/csv.ts` exist with the documented signatures and pass their unit tests.
5. svelte-check baseline preserved (0 errors; existing 19 warnings unchanged).
6. The 15-step manual smoke plan passes end-to-end on a local backend running via `run-debug.sh`.
7. Backend unchanged: no migrations, no schema edits, no endpoint changes. The spec is purely frontend.
