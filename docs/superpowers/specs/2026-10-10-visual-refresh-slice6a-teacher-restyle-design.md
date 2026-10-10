# Visual refresh — Slice 6a: the teacher screens, restyled (runs lists, run frame, six tabs)

**Status:** draft, rev 1. Written 2026-10-10 for the user's review.

**Branch:** `feat/visual-refresh-slice6-teacher`, cut from `feat/visual-refresh-slice5-authoring` at `65bcea2`. It stays local: no push, no merge.

**Authority:**
- The design handoff `docs/design/visual-refresh/` (`mathion-visual-spec.md`, `reference-screens.dc.html`) is the design authority. Its screens 10e, 2d, 9a, 10c, 10d, 10j and 10i are the 6a screens. Image copies: `.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/ref/*.png`.
- The user walked through every teacher screen on 2026-10-10 and approved all of them "as drawn". The walkthrough and every decision are in `.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/walkthrough.md`.
- A read-only gap analysis (fresh Opus, 2026-10-10) compared the drawings with the code. Its findings are summarised in the same file. Where this spec cites `file:line`, the line is from that analysis or from the code at `65bcea2`.
- Where this spec is silent, the handoff's §1–§4 hold, and earlier slices' conventions hold: tokens only, no emoji, no literal colours.

## Why

The teacher screens were never restyled. The user, on the runs list: "looks like it has no design at all". Slice 6 brings the 14 teacher screens to the design. It is split in three (user, 2026-10-10):
- **6a (this spec):** the restyle, plus the navigation fix.
- **6b:** the four modals move onto the shared `ui/Modal` (New run, Publish conflicts, Import roster, Mini-project editor).
- **6c:** the behaviour-heavy screens: the Overview tab, the Roster tab, and the side panel (grading and the progress breakdown).

## Decisions

The user's (2026-10-10):
- **D1 — Restyle plus named pain points** (option B). The drawings are the target; behaviour changes only where a decision below says so.
- **D2 — Split S6 into 6a / 6b / 6c** as above.
- **D3 — Runs belong to Teaching, for everyone.**
  - Every run page and runs list lives under `/teaching` and lights the "Teaching" pill.
  - The breadcrumb is Teaching / Course / Run.
  - Course admins get the Teaching pill too. Their Teaching list includes the runs of the courses they administer.
  - Old `/courses/:slug/runs…` links forward to the new addresses.
  - This needs one small backend change (§Backend change), which the user was told about.
- **D4 — No ✎ on run rows.** The run title opens the run; title and dates are edited on Overview. 🗑 stays.
- **D5 — Nothing that works today is dropped** (stated to the user; no objection). The drawings omit several working features: banners, empty states, Refresh, the "(Ungrouped)" filter, retry paths and others. Each is kept and restyled in the same visual language. §Keep lists them per screen.
- **D6 — Mini-projects are shown by their block's title.** The model has no mini-project title column. The drawn names ("Matrix explorer") are not real.
- **D7 — Teacher avatars are the drawn silhouette only.** There is no photo field.

Decisions taken at the controller's discretion (technical; the user defers these):
- **D8 — The open tab lives in the address** (`?tab=…`), so a reload keeps the tab. Switching tabs replaces the history entry; it does not push one. Back leaves the run page, and coming back restores the tab.
- **D9 — Tab order and names as drawn:** Overview, Progress, Submissions, Roster, Groups, Mini-projects, Assets, Teachers. "Submission" becomes "Submissions".
- **D10 — Delete is a trash glyph everywhere.** The drawings use a red × for delete in 10i and 10j. 6a uses the same trash as 10e, 10c, 10d and the 5c editor.
- **D11 — Disabled-with-reason vs hidden on teacher screens.**
  - Follows the handoff §4: an action blocked for *this row* or *right now* renders disabled, with the reason in `title`. Examples: the 🗑 of a group with students, ✎ on a locked mini-project, the 🗑 of a published run, the force delete of someone without the right.
  - A *whole surface* that a role cannot change is rendered read-only, without the controls (as drawn in 10d's teacher view). Examples: Teachers for non-admins; + and 🗑 on runs lists for non-admins.
  - This differs from 5c's D13 (hide what the version forbids). D13 governs the authoring constructor, not these screens.

## Scope

**In 6a:**
- `pages/teaching/TeacherRunListPage.svelte` — the Teaching list (`/teaching`), restyled like 10e. It has no drawing of its own.
- `pages/runs/RunListPage.svelte` — one course's runs (10e).
- `pages/runs/RunDetailPage.svelte` — the run frame: breadcrumb, title row, meta line, the existing publish bar, the version-disabled banner, the tab strip, tab-in-address.
- Tabs: `RunProgressTab` (2d), `RunSubmissionTab` (9a), `RunGroupsTab` (10c), `RunTeachersTab` (10d), `RunMiniProjectsTab` (10j), `RunAssetsTab` (10i).
- Routes, redirects, the header pill (`components/chrome/AppHeader.svelte`), and every in-app link to a run page.
- Shared pieces (§Shared pieces).
- One backend change (§Backend change).

**Not in 6a** (they render inside the new frame unchanged until their slice):
- **6b:** `NewRunModal`, `PublishConflictsModal`, `RosterImportModal`, `MiniProjectModal`.
- **6c:**
  - `RunOverviewTab` (incl. moving Publish into the readiness card, run force delete, per-field editing);
  - `RunRosterTab`;
  - `DashboardSidePanel` and `SubmissionThreadEntry`.

  Until then, the publish bar stays in the run frame's title row (§The run frame).
- Never in Slice 6: mini-project titles; profile photos; changing the 10-student group cap; making the feedback file optional (the user kept it required, 2026-10-10).

## Navigation and addresses (D3, D8, D9)

### Routes

| Address | Component | Notes |
|---|---|---|
| `/teaching` | `TeacherRunListPage` | all runs you teach or administer |
| `/teaching/:courseSlug` | `RunListPage` | one course's runs |
| `/teaching/:courseSlug/runs/:runId` | `RunDetailPage` | the run; `?tab=` selects the tab |
| `/courses/:courseSlug/runs` | redirect | → `/teaching/:courseSlug`, replacing the history entry |
| `/courses/:courseSlug/runs/:runId` | redirect | → `/teaching/:courseSlug/runs/:runId`, replacing the entry, keeping any `?tab=` |

- A redirect runs before any page fetch. It is one small component (or a router rule) used by both old routes. It is not a duplicate page.
- Every in-app link to a run list or a run page uses the new addresses:
  - `CourseCard.svelte:9` (the course card's "Runs" link);
  - `RunListPage` rows;
  - `TeacherRunListPage` rows;
  - the run breadcrumb;
  - any link inside the `runs/*` components that builds `/courses/…/runs/…`. The plan enumerates them with a grep; the gate asserts none remain (§Gate).

### The header pill (`AppHeader.svelte:10-38`)

- "Teaching" renders when `has_run_teacher || has_course_admin`. Today it needs `has_run_teacher`.
- "Teaching" is active on `/teaching` and everything under it (unchanged rule; the run pages now live there).
- "Authoring" is active on `/courses…` (unchanged). Run pages no longer match it.
- `defaultLandingPath` is unchanged: admins still land on `/courses`.

### The breadcrumb

- **On a run page:** Teaching › Course name › Run title. "Teaching" links to `/teaching`; the course name links to `/teaching/:courseSlug`; the run title is plain text.
- **On `/teaching/:courseSlug`:** Teaching › Course name.
- Separators are the existing breadcrumb style (`--faint` "/", as drawn).
- Today's admin breadcrumb (Courses › Course › Runs › Run, `RunDetailPage.svelte:325-330`) goes away. The Authoring side still reaches runs through the course card's Runs link, now pointing to `/teaching/:courseSlug`.

### The tab in the address (D8)

- Tab keys: `overview`, `progress`, `submissions`, `roster`, `groups`, `mini-projects`, `assets`, `teachers`.
- No `?tab` → Overview, and the address is not rewritten. An unknown `?tab` → Overview, with the address rewritten (replace) to drop the bad value.
- Clicking a tab, or an in-page jump such as Overview's "open Roster" (`gotoTab`, `RunDetailPage.svelte:95`), navigates with `{ replace: true }` to the same path with the new `?tab`.
- **Changing only `?tab` must not reload the run.** No `loadAll`, no loading placeholder, and the roster prefilter that `gotoTab` sets survives the switch. A test pins this (§Testing).
- Changing the run (a different `:runId`) still resets everything as today, including the tab (to the address's `?tab` or Overview).

## The run frame (`RunDetailPage`)

As drawn in 10a–10j (all share it):
- **Breadcrumb** (§The breadcrumb).
- **Title row:**
  - the run title as the page `<h1>`;
  - the run status chip (§Run status chip);
  - a mono `--muted` meta line: "42 students · 8 groups · v5". "· N groups" is shown only when groups are enabled. "vN" is the pinned version's id, in the "v. N" style 5c uses.
  - The counts come from data the page already loads (`students`, `groups`, `run.version_id`); there are no new fetches.
- **Publish bar:** today's Publish / Unpublish / InlineConfirm, unchanged in behaviour (`RunDetailPage.svelte:340-366`). It is restyled with `Button` and sits at the right end of the title row. 6c moves Publish into Overview's readiness card.
- **The version-disabled banner** (`:371-379`) stays, under the title row, restyled as a warning banner (`--status-needs-revision-bg`, 3px `--gold` left rule, per handoff §4 Precondition banners). Both texts (admin / teacher) stay.
- **Tab strip:**
  - `role="tablist"`, D9 order and names, the drawn underline style: the active tab gets `--text` and a 2px `--primary` underline; inactive tabs `--muted`.
  - Arrow-key movement between tabs is not added (it is not there today). Each tab is a button reachable with Tab.
- **Loading and errors:** the existing "Invalid run.", load error and `LoadingPlaceholder` are kept. Errors use `ErrorState` (as the 5c/5d pages do), with a link back to `/teaching`.

### Run status chip

One small shared chip for run status, used on the run frame and both runs lists:

| Status (key) | Label | Tokens |
|---|---|---|
| `active` | active | `--status-awaiting-eval-bg / -fg` |
| `upcoming` | upcoming | `--primary-soft` / `--primary` |
| `ended` | finished | `--state-archived-bg / -fg` |
| `draft` | draft | `--state-created-bg / -fg` |

The key `ended` stays internally (`lib/runStatus.ts`). Only the label changes, there and on the Teaching list's filter pills ("Finished").

## The runs lists

### `/teaching` (`TeacherRunListPage`)

- Page `<h1>` "Teaching". The existing status filter pills (Active / Upcoming / Finished / Draft / All; default Active) are restyled as the 10i filter pills, with counts.
- The table is styled like 10e. Columns:
  - Title — links to the run;
  - Course — links to `/teaching/:courseSlug`;
  - Status chip;
  - Students (mono);
  - Start / End (mono, "01 Sep 2026").
- No row actions.
- Sorting is today's per-status ordering (unchanged).
- The loading, error and empty states are kept. Empty: "No runs yet." (today's copy, if any; otherwise this text).

### `/teaching/:courseSlug` (`RunListPage`)

**Course admins** (the course's `is_admin`) see 10e:
- Breadcrumb Teaching › Course.
- `<h1>` "Runs", with a mono `--muted` count.
- **+ New run:** a 28px primary icon button that opens `NewRunModal` (unchanged until 6b). When no version is published, it is disabled with the existing reason.
- Columns:
  - Title (links to the run);
  - Status chip;
  - Version: "Label · vN", with "vN" mono `--muted`. `Version.label` exists, `lib/types.ts:227`. Today the page renders `vN (date)` (`:27`).
  - Start, End.
  - 🗑 per row (D4: no ✎).
- 🗑 per row: enabled only for a draft run. Otherwise it is disabled, titled "Only a draft run can be deleted". Today it is hidden (`:123`).
- Clicking an enabled 🗑 opens the existing inline confirm, restyled. Its behaviour, errors and the 409 text are unchanged.
- The empty state "Create the first run" (`:95-105`) is kept.
- The footnote line under the table in 10e is a design note, not UI. It is not rendered.

**Teachers who are not admins of the course:**
- Today they are sent away (`RunListPage.svelte:39-41`). In 6a they see a read-only list instead (D11): the runs of this course they teach, from `listTeachingRuns()` filtered by `course_slug`.
- Columns: Title, Status, Students, Start, End. No Version column (the teacher payload has no version label), no + and no 🗑.
- If there are none: "You don't teach a run of this course." and a link to `/teaching`.
- A user who is neither admin nor teacher: the course lookup or the teaching list gives them nothing. They get the same empty message; no data leaks, because both endpoints already authorise.

## The six tabs

Common to all six:
- A section header row: title + mono `--muted` count, and the section's primary action at the right (+ / + Upload).
- Tables use the handoff §4 table style: header `--surface-2`, 12px/600 `--text-3`, 1px `--border-soft` row separators, 28px controls in rows.
- Icon buttons are 24px in rows, 28px for page-level actions.

### Progress (2d, `RunProgressTab`)

- **Toolbar:**
  - Coverage / Quiz as a two-button segmented control (today two buttons/radios; same state);
  - the group `<select>` (keeps "(Ungrouped)" and "(disabled)" suffixes, `:305-309`);
  - search;
  - then, at the right, the heat legend (§Heatmap), ↻ Refresh as an icon button (`refresh` glyph, title "Refresh"; today a text button, `:315`), and "Download CSV" as a secondary button.
- **Table (handoff §4 Tables):**
  - Student and Group columns sticky (already sticky; restyle only).
  - A block row above the sequence headers: "B1 · VECTORS", mono 10.5px uppercase `--muted`, spanning that block's sequences.
  - Sequence headers "S1 Vectors": `S{sequence_order}` + title, from `block_order` / `sequence_order` already in the payload (`lib/dashboards.ts:47-55`).
  - Cell values mono 11.5px.
  - Sort arrows on Student / Group / sequences stay (today's sort).
- **Heatmap:**
  - Five steps replace the `hsl(120 * ratio)` sweep (`:208-219`). Cell background:

    | Ratio | Background |
    |---|---|
    | no data ("—") | none |
    | 0 | `--surface-muted` |
    | > 0 and ≤ 0.25 | `--heat-1` |
    | ≤ 0.5 | `--heat-2` |
    | ≤ 0.75 | `--heat-3` |
    | > 0.75 | `--heat-4` |

  - Text is always `--heat-fg`.
  - The legend: "0%", five swatches in that order (surface-muted, heat-1…4), "100%". It has an accessible name "Coverage scale" (or "Score scale" in Quiz mode).
- **Disabled rows:** the student name in italic `--muted`, with a small "disabled" chip, as drawn. Today `.disabled-row` uses `opacity: 0.55` with hex fallbacks; that is replaced by tokens (a carried polish-debt item, closed here).
- **Cell click** opens the existing side panel, unchanged (6c restyles it).
- **Keep (D5):** the version-disabled banner (`:287-289`, restyled as a precondition banner); the loading / error / empty states.

### Submissions (9a, `RunSubmissionTab`)

- **Toolbar:** the group filter at the left; ↻ Refresh and ⤓ CSV as icon buttons at the right (`refresh` and `download` glyphs, titles "Refresh" and "Download CSV").
- **Grid:** groups down, mini-projects across.
  - Column header line 1: the block title (D6), e.g. "Matrices and transformations".
  - Line 2, mono `--muted`: "B2 · 3 awaiting · 1 revision", or "B4 · no submissions". It is built from `block_order` and the column's counts. Today the line starts with "N groups" (`:134-140`); the counts and their rules are unchanged.
- **Cells:** a status badge per cell (`StatusBadge`, lowercase labels: "accepted", "needs revision", "awaiting eval", "not submitted", "rejected"). "—" when the group is outside the mini-project's scope.
- A disabled group shows its name in `--muted` with a "disabled" chip.
- **Badge click** opens the existing side panel, unchanged (6c).
- Sorting by Group stays.
- **Keep (D5):** the groups-disabled and no-mini-projects empty states (`:214-218`); loading and error states.
- The footnote under the drawing is a design note, not UI.

### Groups (10c, `RunGroupsTab`)

- **Header:** "Groups" + count, and a + icon button (primary, 28px) titled "Add group".
- **+ reveals an add row** at the top of the list, with the name field focused, ✓ and ×. This is the 5a "collapsed form" pattern.
  - Enter or ✓ adds; Esc or × closes the row and returns focus to +.
  - The existing 409 text ("A group with that name already exists in this run.") shows under the field.
  - On success the row clears and stays open for the next name.
- **Each group row:**
  - the name;
  - the capacity badge (§Capacity badge);
  - ✎ (24px, "Rename group");
  - 🗑 (24px, "Delete group").
- **✎ swaps the name for an inline field** (§Inline name field), with Enter / ✓ to save and Esc / × to cancel. Failures show under the field and keep the field open. Today a failure resets the name and shows a toast.
  - Today the name is an always-visible input saved on blur (`:126-139`). That goes away: no more saving on blur.
- **🗑:**
  - Disabled with "Move students out before deleting." when the group has students (today's rule and text).
  - When enabled, it opens the existing inline confirm, restyled. The backend's "disable instead" error text is shown as today.
- **Groups disabled:** the list is replaced by a card. Its header strip reads "GROUPS DISABLED FOR THIS RUN" (mono uppercase `--muted` on `--surface-2`), with the body text. The three role/publish-dependent texts (`:104-111`) are all kept; the drawing shows one of them.
- **Keep:** the empty list text "No groups yet.".

**Capacity badge:** "empty" / "n/10", colours from `getCapacityClass` (`lib/runGroups.ts:24-29`, thresholds unchanged):

| Class | Tokens |
|---|---|
| empty | `--status-not-submitted-*` |
| ok | `--status-accepted-*` |
| warn | `--status-needs-revision-*` |
| full | `--status-rejected-*` |

The `n/10` text is mono.

### Teachers (10d, `RunTeachersTab`)

- **Header:** "Teachers" + count.
  - For course admins: the email field ("teacher@example.com" placeholder) and a + icon button ("Add teacher").
  - Enter in the field adds. Errors (e.g. "already assigned") show under the field, as today.
- **Rows** (newest first, unchanged):
  - the avatar (§Avatar);
  - the name, or "—" plus an "invited" chip when `full_name` is null;
  - the mono email under the name;
  - for admins, 🗑 at the right.
- **🗑** removes with today's flow (its confirm and errors unchanged, restyled).
- **Non-admins** see the same list without the field, + and 🗑 (D11, as drawn).
- **Keep:** the empty state.

### Mini-projects (10j, `RunMiniProjectsTab`)

- **Header:** "Mini-projects", then mono `--muted` "3 of 4 blocks" (mini-projects / blocks in the version).
  - "+" (primary, 28px, "New mini-project") opens `MiniProjectModal` (unchanged until 6b).
  - It is disabled, with today's reason as its `title`, in exactly the cases where today's New button is disabled (every block already has one, groups are off, and so on; the plan lists them from the code).
- **Table:**
  - Block: "Block 1 — Vectors and vector spaces" (D6).
  - Deadlines: mono, "soft 07 Aug  hard 14 Aug  resub 21 Aug"; absent deadlines omitted.
  - State chip: draft / published / locked.
  - Actions: ✎ and 🗑.
- **On a locked row:**
  - ✎ renders disabled, titled "Has submissions — editing is off".
  - For non-admins, 🗑 renders disabled, titled "Only a course admin can delete a mini-project with submissions".
  - Today both are hidden (`:233-251`; D11).
- **Force delete** uses the shared danger panel (§Danger panel). Today's consequence text, the "I understand" box and the admin-only rule are unchanged.
- **Keep (D5),** restyled as precondition banners (handoff §4):
  - "Mini-projects require groups" (info: `--surface-2`, 3px `--primary` rule, link "Enable on Overview" → the Overview tab via the address);
  - the version-disabled banner;
  - the run-not-published banner;
  - the delete-error banner (`:180-205`).
- The footnote under the drawing is a design note, not UI.

### Assets (10i, `RunAssetsTab`)

- **Toolbar:**
  - the filter pills All / Orphan / Referenced with counts (exist; restyle);
  - "+ Upload" as a primary button at the right.
- **Bulk strip:** when rows are selected, a `--surface-2` strip reads "N selected" with "Delete N selected" at the right (exists; restyle).
- **Table:**
  - a checkbox column;
  - Filename (link/download as today);
  - Size, Uploaded (mono);
  - Uploaded by (mono email, or "—");
  - Uses, a clickable chip: green "N uses" when > 0, grey "0 uses". It opens the "used by" sub-panel (exists).
  - Actions: ↻ Replace (`refresh` glyph, "Replace file") and 🗑 Delete (D10).
  - Sortable columns keep today's sort.
- **The "used by" sub-panel** renders under the table as drawn: "rubric.pdf — used by", the list, and "Edit" links (exists; restyle).
- **Deleting a referenced asset** uses the shared danger panel. The admin-only force rule and its disabled reason (`:661-662`, `:808-809`) are unchanged.
- **Keep (D5):** the drop zone, upload progress, the replacement-extension rule and its error, and the single banner slot.

## Shared pieces

All new pieces use tokens only and carry their own tests.

- **`ui/IconButton.svelte`:** add the glyphs `refresh` (circular arrow) and `download` (arrow into tray) to the `Glyph` union (`:9-11`), in the existing glyph style.
- **`ui/Avatar.svelte` (new), the Avatar:**
  - a `--avatar` circle, `--avatar-bg` fill, 1px `--border-strong` ring;
  - the inline silhouette SVG exactly as documented in `base.css:55-68`, filled `--avatar-fig`;
  - `aria-hidden="true"`, because the row's text names the person;
  - no `src` prop (D7).
- **`ui/DangerConfirm.svelte` (new), the danger panel (handoff §4 Confirm-then-act):**
  - An in-place panel: `--status-rejected-bg`, 3px `--danger` left rule.
  - Inside: the consequence text (a prop), an "I understand" checkbox, a Force delete button and Cancel.
  - Force delete stays in the unarmed tint (`--danger-off-bg / -border / -text`) and does nothing until the box is ticked. It then turns `--danger` with white text.
  - A `disabledReason` prop renders Force delete disabled with that `title`, for users without the right.
  - Props: `message`, `confirmLabel = 'Force delete'`, `busy`, `disabledReason`, `onConfirm`, `onCancel`.
  - Focus moves to the checkbox when the panel opens. Esc or Cancel calls `onCancel`.
  - `RunMiniProjectsTab` and `RunAssetsTab` replace their own panels with it; 6c's run force delete will reuse it.
  - The behaviour of both existing panels (what is sent, what errors say) does not change.
- **`ui/InlineName.svelte` (new), the Inline name field:**
  - An input with ✓ and × icon buttons, and an error line under it (`role="alert"`).
  - Enter / ✓ calls `onSave(value)`, which returns a promise. Esc / × calls `onCancel`.
  - While saving, the input is read-only and ✓ shows busy. On a rejected promise the field stays open with the error.
  - Used for the group add row and the group rename. 6c reuses it for Overview's fields.
  - It is not the 5d quiz `InlineInput`, which is bound to the quiz edit slot (`editor/quiz/InlineInput.svelte`).
- **`runs/RunStatusChip.svelte` (new):** the §Run status chip.
- **Filter pills and segmented control:** styled locally in their tabs (two uses each). They are not new shared components.

## Backend change (D3)

`GET /api/teaching/runs` (`backend/mathion/api/teaching.py:14-50`) today returns runs where the user has a `RunTeacher` row. It will return the runs where the user has a `RunTeacher` row **or** is a `CourseAdmin` of the run's course.

- **Each run appears once.** Select runs `WHERE Run.id IN (teacher runs) OR course_id IN (admin courses)`, then count students. A union of joins would double-count `RunStudent`.
- **No superuser bypass**, as today. The docstring is updated to say "teach or administer".
- **Response shape unchanged** (`TeachingRunRow`), and the order stays `Run.id ASC`.
- **Tests** (`backend/tests/…teaching…`):
  - an admin who teaches nothing sees the course's runs, with correct student counts;
  - an admin who also teaches one of them sees it once;
  - a user who is neither sees none;
  - a teacher of one course and admin of another sees both sets;
  - a superuser with neither row sees none.

There are no other backend changes in 6a.

## Focus and keyboard

- After a tab switch, focus stays on the clicked tab button. The tab strip does not re-render on `?tab` changes (it is the same component).
- **Groups:**
  - Closing the add row returns focus to +.
  - After a rename saves or is cancelled, focus returns to that row's ✎.
  - After a group is deleted, focus moves to the next row's ✎, else the previous row's, else +.
- **The danger panel:** Cancel returns focus to the 🗑 that opened it. After a successful force delete, focus follows the tab's existing post-delete rule, or + if it has none.
- **Teachers:** after an add, focus stays in the email field (cleared). After a remove, it moves to the next row's 🗑, else the field, else the list heading.
- Focus never drops to `<body>` after an action in these tabs.

## Code changes

- **Routes and links:**
  - `src/routes.ts`: the two `/teaching/...` routes and the two redirects.
  - `App.svelte`: the route→component map.
  - `CourseCard.svelte`.
  - Every `/courses/…/runs…` builder in `pages/runs/*`, `pages/teaching/*` and `components/runs/*`.
- **Header:** `components/chrome/AppHeader.svelte` (the pill condition).
- **Pages:** `pages/runs/RunDetailPage.svelte`, `pages/runs/RunListPage.svelte`, `pages/teaching/TeacherRunListPage.svelte`.
- **Tabs:** `components/runs/{RunProgressTab,RunSubmissionTab,RunGroupsTab,RunTeachersTab,RunMiniProjectsTab,RunAssetsTab}.svelte`.
- **New:** `components/ui/{Avatar,DangerConfirm,InlineName}.svelte`, `components/runs/RunStatusChip.svelte`.
- **Changed:** `components/ui/IconButton.svelte` (two glyphs), `lib/runStatus.ts` (a label map; the key is unchanged).
- **Backend:** `backend/mathion/api/teaching.py` + its tests.
- **Gate:** `frontend/scripts/visual-refresh-gate.sh` (§Gate).
- **Docs:** `docs/backlog/slice6a-teacher-restyle-debt.md` (deferred minors, task by task).

## Process

As in 5c/5d (memory: per-task loop):
1. TDD per step.
2. vitest (exit 0, no "Errors" / "Unhandled" line).
3. svelte-check with 0 errors.
4. The gate.
5. Screenshots of the real screens in an overlay → the user's OK.
6. Opus + Fable review lanes on the uncommitted diff until clean.
7. Commit with exact paths.
8. Wait for the user's "go".

Rules for the work:
- Screenshots use the dev data (run 8) plus network mocks. No real writes to shared data except where the user agrees.
- The final whole-branch review and a Safari pass (one step at a time) close 6a.

## Testing

Component tests use `mount` / `unmount` / `flushSync` (not testing-library). New and changed tests, at least:

- **Routes / redirects:**
  - `/courses/s/runs` → `/teaching/s` (replace);
  - `/courses/s/runs/8?tab=groups` → `/teaching/s/runs/8?tab=groups`;
  - the course card's Runs link points to `/teaching/s`.
- **Header:** the Teaching pill shows for an admin who teaches nothing, and is active on `/teaching/s/runs/8`. Authoring is not active there.
- **Tab in address:**
  - `?tab=progress` opens Progress;
  - an unknown tab → Overview, with the address rewritten;
  - clicking a tab rewrites the address with replace;
  - **switching tabs does not refetch the run** (spy on `getRun` / `loadAll`; no `LoadingPlaceholder`);
  - Overview's "open Roster" lands on Roster with the Unassigned prefilter, and the address says `?tab=roster`.
- **Breadcrumb:** Teaching › Course › Run with the right hrefs, for an admin and for a teacher.
- **RunListPage:**
  - the admin view has no ✎;
  - 🗑 is disabled with its reason on non-draft runs;
  - the Version column shows "Label · vN";
  - the empty state is kept;
  - the teacher read-only view shows only their runs of that course, with no + or 🗑;
  - the neither-role message.
- **TeacherRunListPage:** the Course column links to `/teaching/:slug`; "Finished" pill label; status chips.
- **RunStatusChip:** each key's label and token class.
- **Progress:**
  - the heat steps at 0, 0.25, 0.26, 0.5, 0.75, 0.76 and 1 → the expected token;
  - "—" has no fill;
  - the legend and its name per mode;
  - the "B1 · TITLE" and "S1" headers;
  - Refresh is an icon button and still refetches;
  - "(Ungrouped)" is kept.
- **Submissions:** the column header is the block title plus "B2 · …" counts; lowercase badges; "—" out of scope; the empty states are kept.
- **Groups:**
  - + opens the add row with focus in the field, Esc returns focus to +;
  - the 409 text is shown under the field;
  - ✎ rename with Enter saves, Esc cancels, and a failure keeps the field open with the error;
  - no save on blur;
  - 🗑 is disabled with its reason when the group has students;
  - the capacity token per class;
  - the three disabled-state texts;
  - focus after a delete.
- **Teachers:** avatar present and `aria-hidden`; the "invited" chip when `full_name` is null; the read-only view for non-admins; focus after add/remove.
- **Mini-projects:**
  - the "3 of 4 blocks" count;
  - locked rows show disabled ✎ (and disabled 🗑 for non-admins) with reasons;
  - the danger panel is used for force delete, and the request is unchanged;
  - all four banners are kept.
- **Assets:** the danger panel for a referenced asset; replace and delete icon buttons; the kept drop zone and progress.
- **DangerConfirm:**
  - unarmed until ticked (no `onConfirm` call on click);
  - armed calls `onConfirm`;
  - `disabledReason` disables it with the title;
  - focus to the checkbox on open;
  - Esc → `onCancel`.
- **InlineName:**
  - Enter / ✓ / Esc / ×;
  - read-only while saving;
  - the error stays and the field stays open on rejection.
- **Avatar:** the SVG with no `<img>`.
- **Backend:** the five teaching-runs tests in §Backend change.

## Gate

The gate gains a 6a section at the end of `scripts/visual-refresh-gate.sh`; the plan sets the exact rows and `EXPECTED_CHECKS`. It covers:
- `colour_scan 6a-teacher` and `emoji_scan` over every 6a-touched component (list `FILES_6A`).
- `RunProgressTab` contains no `hsl(`, and the five heat tokens are referenced.
- No `/courses/[^'"]*/runs` link builder remains under `src/` outside `routes.ts` and the redirect.
- The `.disabled-row { opacity` rule is gone.
- The token pins for the new shared pieces (`Avatar`, `DangerConfirm`, `RunStatusChip`), in the same style as the 5c/5d pins.

## Out of scope

- Everything listed under "Not in 6a" (6b, 6c).
- Arrow-key navigation in the tab strip.
- A total column or summary row on Progress (the user said "ok" to it as drawn).
- Changes to any backend rule other than §Backend change.

## Carried to the 6a browser pass

- The run frame and the tabs at a normal laptop width and at about 1000px. The Progress table scrolls sideways inside its card, never the page.
- Sticky Student/Group columns in Safari while scrolling sideways.
- The redirects from old bookmarks.
