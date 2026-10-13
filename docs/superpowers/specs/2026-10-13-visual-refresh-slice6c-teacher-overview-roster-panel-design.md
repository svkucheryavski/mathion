# Visual refresh — Slice 6c: Overview, Roster and the side panel

**Status:** approved; rev 5 (2026-10-13: Settings moved to the left column at the user's Task 2 review).
- Rev 4 folds in the rev 3 re-check (Opus on the code, Fable; `spec-r3-*.md`): the zero-groups row no longer blocks a publish, focus after a failed save or a cancelled upload, the run-write lock across a remount and an open danger panel, and test flips.
- Rev 3 folds in round 2 (the same three reviewers; `spec-r2-*.md`): D28's backend test blast radius, the busy-control mechanics (R44), the run-write lock (R32), focus fixes, and copy.
- Rev 2 folds in round 1 of the spec review (fresh Opus on the code, fresh Opus on the design, Fable second opinion; notes in `.superpowers/sdd/2026-10-13-visual-refresh-slice6c-teacher-overview-roster-panel/spec-r1-*.md`) and the user's answers D28–D29.

**Branch:** `feat/visual-refresh-slice6-teacher`, after the 6b browser pass (`a542e51`). It stays local: no push, no merge.

**Authority:**
- The design handoff `docs/design/visual-refresh/` (`mathion-visual-spec.md`, `reference-screens.dc.html`) is the design authority. Its screens 10a (Overview, `reference-screens.dc.html:481-585`), 10b (Roster, `:586-670`) and 9b (Submission thread, `:1147-1250`) are the 6c screens. Image copies: `.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/ref/{10a,10b,9b}.png`.
- The user approved all three "as drawn" in the 2026-10-10 walkthrough (`.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/walkthrough.md`), with one change: the feedback file stays **required** unless the result is Accepted. The Progress-cell variant of the side panel has no drawing; it reuses the 9b drawer shell.
- Drawn sizes are taken from the drawing's HTML source. Where this spec departs from a drawn value it says why.
- The 6a spec (rev 5) and the 6b spec (rev 4) hold where this spec is silent: 6a D5 (nothing that works today is dropped), D6 (mini-projects are shown by their block's title), D8 ("v. N"), R13 (block numbers by position), §Focus (focus never drops to `<body>`; a row action's fallback chain), P10 (a tab jump focuses the new tab), the 6a chip and banner token table and one-line confirms; 6b D11, R16 (`Switch`), R19 (freeze during a request) and R20 (a busy button keeps focus). So do the handoff's §1–§4 and the earlier slices' rules: tokens only, no emoji, no literal colours, every disabled control names its reason in `title`.
- `file:line` references are to the code at `a542e51`.

## Why

6a restyled the run frame and six tabs; 6b moved the four modals onto `ui/Modal`. The Overview tab, the Roster tab and the grading / progress side panel are still the pre-refresh markup: plain inputs that save on blur, a publish bar in the title row, a delete button with no danger panel, an unstyled roster table with a form under it, and a side panel of `<p>Label: value</p>` lines with its own backdrop, Esc listener and focus trap. 6c draws them as 10a, 10b and 9b and closes the items routed from 6a and 6b.

## Decisions

The user's (2026-10-12/13), continuing the Slice-6 numbering:
- **D24 — "Delete this run" deletes for real.** As 10a says, the Overview delete sends `DELETE /api/runs/{id}?force=true` through the shared danger panel (`ui/DangerConfirm`). Course admins only; the run must be unpublished. Today the delete sends no `force` and fails with "Clear roster before deleting." when the run has students.
- **D25 — "+" opens an add row** under the Roster toolbar: e-mail, the group select (groups on), Add, Cancel. The form under the table goes.
- **D26 — The submission file card shows "Submission N" and "PDF · 2.4 MB".** Original file names are not stored (the server names files `block N - group G - submission S.pdf`, `backend/mathion/api/submission_files.py:28-36`) and the thread payload has no name.
- **D27 — The side panel is a `ui/Modal` with a right placement.** It gains Modal's stack, Esc, Tab containment, scroll lock and focus return; its own backdrop, `<svelte:window onkeydown>` and `FocusTrap` go.
- **D28 — The server refuses a forced delete of a published run.** `delete_run` (`backend/mathion/api/runs.py:117-176`) checks `is_published` only when `force` is off, so a stale Overview could force-delete a run that was published meanwhile. The check moves out of the `if not force:` branch to just after the advisory-lock loop (`:132-137`), so it runs for both paths: a published run always gets 409 "Unpublish run before deleting". This is 6c's only backend change. It is not atomic against a concurrent `publish_run` (which takes a different lock); that window is milliseconds and accepted.
  - `test_force_delete_published_run` (`backend/tests/test_runs.py:209-223`, whose seed run is published) flips to expect 409 and the run to remain.
  - The two force-path concurrency tests in `backend/tests/test_concurrency_mini_project.py` ("Force RED" `:589-635`, "Force GREEN" `:638-…`) force-delete a run that `seed_run_with_published_mp` published; they are re-staged to unpublish the run (unpublish only; the twins' helper also clears the roster, which these tests must keep) after B parks and before the force delete, as their non-force twins do (`:465`, `:559`).
  - A new test: a forced delete of a draft with students and submissions returns 204 and removes everything.
  - The comments at `runs.py:152` ("override all blocks") and `submission_files.py:15` are updated to say a published run is never deleted.
- **D29 — A click on the dimmed page does not close the drawer** (as 6b D11 for modals). × and Esc close it.
- The Overview, Roster, side-panel and Process sections were approved section by section on 2026-10-13 (rev 1); rev 2 adds the reviewers' details inside them.

Rulings taken at the controller's discretion (technical; the user defers these). Each states what it costs if wrong:
- **R30 — `ui/Modal` gains `placement: 'center' | 'right'`** (default `'center'`) and **`closeTitle?: string`** (the × `title` while `closeDisabled`; default unchanged). Right adds modifier classes, and the centre rules stay as they are, so gate (aa) keeps passing:
  - `.modal-backdrop.right { justify-content: flex-end; align-items: stretch; padding: 0 }`;
  - `.modal-panel.right { width: min(var(--modal-w), 100vw); height: 100dvh; max-height: none; border-radius: 0; border: 0; border-left: 1px solid var(--border-strong); box-shadow: -14px 0 40px rgba(20,24,35,.22) }` (the drawn edge, 9b; Modal's existing shadow colour); `maxHeight` is ignored.
  - esbuild emits that colour as `#14182338`; gate (aa) strips only the exact centre shadow before its hex scan (`visual-refresh-gate.sh:4084-4090`), so its allowance gains the exact string `box-shadow:-14px 0 40px #14182338`.
  - Every current caller keeps `'center'`. *Cost if wrong:* a separate drawer component later.
- **R31 — `ui/InlineName` gains `type: 'text' | 'date'`** (default `'text'`) and **`emptyTitle?: string`** (✓'s `title` while the value is empty; default "Save"). Everything else (Enter saves, Esc cancels, nothing saves on blur, an unchanged value cancels without a request, an empty value keeps Save disabled, a failed save stays open with its error, trimming) is reused. The Overview passes no `subject`. *Cost if wrong:* a second field component.
- **R32 — One Overview edit at a time, and no overlapping run writes.** While a field is open, the other ✎ are disabled ("Finish editing the {field} first", e.g. "the start date"). The Overview derives one `runWrite` flag: its own flag (a field save, the switch's request, the delete) OR the page's `publishing` / `unpublishing` (so a remount mid-publish is still locked). An open field editor is not a write: Publish run stays usable while a field is open, and a refetch under it does not reset the field (`InlineName` snapshots its value on mount). While it is set, every other write control on the Overview ignores input (✎ disabled with "Wait for the current change to save"; the switch `frozen`; Publish run, Unpublish and 🗑 `aria-disabled` with the same title, their handlers returning at once; an already-open `DangerConfirm` gets `disabledReason` "Wait for the current change to save"). This replaces today's cross-field bookkeeping (`RunOverviewTab.svelte:57-99`), which existed because three inputs were live at once, and removes the race of two PATCH responses landing out of order. *Cost if wrong:* an Esc or a short wait.
- **R33 — The Overview ↔ page contract.** Publish and Unpublish stay in `RunDetailPage` (they own the conflicts modal and the load token, `:280-347`). The Overview gets:
  - `pinned: Version | undefined`, `isAdmin: boolean`, `readiness` (with the per-row `reason`, R34), `publishing: boolean`;
  - `onPublish: () => Promise<'published' | 'conflicts' | 'failed'>`;
  - `onUnpublish: () => Promise<'unpublished' | 'draft-now' | 'failed'>` (`'draft-now'`: the 409 refetch found the run already unpublished);
  - `onDeleteRun: () => Promise<{ kind: 'deleted' } | { kind: 'published-now' } | { kind: 'failed'; message: string }>`; `'published-now'` is any 409 (with D28 the only 409 a forced delete returns).
  - `onPublish`'s outcomes: `'published'` when `run` now is published (the response, or a 409 whose refetch finds it published); `'conflicts'` when the conflicts modal opened; `'failed'` only while the run is still a draft, so Publish run is still on screen.
  - `unpublishConfirmOpen` moves into the Overview (only its footer uses it).
  - The page's `publishing` and `unpublishing` flags make `doPublish` / `doUnpublish` return `'failed'` at once while set (no second request). Each is cleared in `finally` only when the load token is still the one it started with; `loadAll` (which bumps the token on a run change, a course change and `reloadRun()`) resets both.
  - After an `await`, the Overview does `await tick()` and then `focusFirst(...)`, which skips elements that are gone (the tab may have changed).
- **R34 — The readiness rows are computed where they are today** (`RunDetailPage.svelte:229-270`). Each row gets a `reason` (a sentence, used for Publish's `title`) apart from its `hint` (shown in the row). `publishBlocked` = some row's `state === 'violated'`; `publishTitle` = the first violated row's `reason`. A new row, "Course version enabled", replaces the separate `showDisabledBanner` term of `publishBlocked`. Each row also carries its hint's link target (`hintTab`), so the Overview needs no extra data for it. The page-level disabled-version banner (6a R7) stays: it serves every tab.
- **R35 — The Submissions tab passes the block label.** `DashboardSidePanel` gains an optional `blockLabel?: string` ("B2"), computed by `RunSubmissionTab` with the same `blockPositions(blocks)` as its line 2 (`RunSubmissionTab.svelte:144-147`). No label when the block is not in `blocks` (R13).
- **R36 — What Discard does depends on what asked.** From the form's Cancel (a dirty edit): Discard ends the edit and the drawer stays open (today's `discardAndClose`, `DashboardSidePanel.svelte:383-397`). From × or Esc: Discard drops the edits and closes the drawer, in create and in edit mode.
- **R37 — The Result control is four native radios** (`name="evaluation-result"`) in a `<fieldset role="radiogroup">` with the legend "Result", styled as a segmented control. Arrow keys come from the platform. The legend reads "Result (required)" and the fieldset has `aria-required="true"`; "Result is required." shows under the control with an `id` in the fieldset's `aria-describedby`. A locked result disables the three non-accepted radios; the lock text is a **visible** muted line under the control (`id`, in the fieldset's `aria-describedby`) and each disabled radio's `title`. While a save runs the fieldset is `disabled`. Focus is normally on Save evaluation then; a save started by Enter on a radio loses focus to the disabled fieldset, and §Focus's failed-save and success rules put it back.
- **R38 — Roster group selects stay native.** A native `<option>` cannot mix fonts, so the count is not mono. All five roster group selects (row, add row, bulk move, retry move, retry cancelled) read "Group A · 7/10"; the row select adds " · disabled" for a disabled group.
- **R39 — The import modal renders in the loaded branch of the page**, after `.run-panel` (inside the `{:else}` that renders the tabs), still gated by `showImportModal`; it gets non-null `students` / `groups` there. The runId-change effect still closes it. A tab change no longer unmounts it. On close the page waits `tick()`; if focus is then on `<body>` (the opener is gone because another tab is active), it focuses the active tab button.
- **R40 — Native fields, not `ui/Input`.** The roster's search and e-mail fields are native `<input>`s with the 6a field style (as `RunTeachersTab`'s `.t-input`, `:88-94, 142-154`); `ui/Input` lacks `id`, `maxlength`, `aria-*`, `oninput` and an element ref.
- **R41 — `ui/IconButton` gains `href` and `download`** (it renders an `<a>` with the same look when `href` is set) **and `describedby`.** Downloads and the roster's draft-disabled + use them.
- **R44 — Busy and blocked controls keep focus.** `ui/Button` gains `aria-disabled` and sets `aria-busy` while `loading`; `ui/IconButton` gains `aria-disabled`. A control that must not act right now but may hold focus (a busy Publish run, Save evaluation while saving, the bulk 🗑 during a bulk op, Unpublish during a field save) uses `aria-disabled="true"` with a reason `title`, and its handler returns at once. A native `<select>` cannot be `aria-disabled`, so the bulk-move and retry selects keep their value handlers returning at once and resetting the value to `''` while `bulkInFlight` (today `bulkInFlight` is only a `disabled=` attribute, `RunRosterTab.svelte:437-512`; `bulkMoveSelected`, `bulkDeleteSelected`, the retries and the 🗑 click gain the early return).
- **R45 — `ui/DangerConfirm` refocuses its box after a request.** It disables its box and Force delete natively while `busy` (`DangerConfirm.svelte:35, 62-73`), which drops focus. In its `finally` it waits `tick()`; when still mounted and focus is on `<body>` or on its own disabled Force delete (jsdom and some browsers leave it there), it focuses the box. The run's delete is the caller that needs it; Mini-projects already refocuses its 🗑 (`RunMiniProjectsTab.svelte:204`) and Assets passes no `busy`, so neither changes.
- **R42 — `ui/Switch` gains `onchange?: (next: boolean) => void`**, called from `toggle()` after the flip; `bind:checked` stays. The Overview binds a local `groupsOn` that is reset from `run` on every `setRun`; a failure sets it back.
- **R43 — The evaluation form is a snippet inside `DashboardSidePanel`**, not a component: it reads and writes about a dozen pieces of panel state, so a component would be all props. One `{#snippet evaluationForm(mode)}` replaces the two near-copies (`:601-664`, `:670-735`). The read-only cards are shared with `SubmissionThreadEntry` through exported snippets in a new `SubmissionCards.svelte`.

## Scope

**In 6c:**
- `components/runs/RunOverviewTab.svelte` (10a).
- `components/runs/RunRosterTab.svelte` (10b).
- `components/runs/DashboardSidePanel.svelte` and `SubmissionThreadEntry.svelte` (9b); new `SubmissionCards.svelte` and `ProgressBreakdown.svelte`.
- `pages/runs/RunDetailPage.svelte`: the publish bar leaves the title row; R33, R34, R39; the delete.
- `components/ui/{Modal,InlineName,IconButton,Switch,Button,DangerConfirm}.svelte` (R30, R31, R41, R42, R44, R45).
- `components/runs/RunSubmissionTab.svelte` (R35) and `RunProgressTab.svelte` (only its panel call, if anything).
- `lib/runs.ts` (`deleteRun(runId, { force })`), `lib/datetime.ts` (one formatter, §Dates), `lib/dashboards.ts` (`RESULT_LABEL`, `ITEM_TYPE_NAME`).
- `backend/mathion/api/runs.py`, `backend/mathion/api/submission_files.py` (a comment), `backend/tests/test_runs.py` and `backend/tests/test_concurrency_mini_project.py` (D28).

**Carried in:**
- From 6b: the run-level Publish has no in-flight guard (R33); the import modal unmounts on a tab change (R39); a disabled Switch's reason must be visible text (§Settings); `openImportFromLink` should focus with `preventScroll: true` (`docs/backlog/slice6b-teacher-modals-debt.md:71`).
- From 6a: the Unpublish confirm and the Publish ↔ Unpublish swap drop focus to `<body>` (§Focus).

**Not in 6c:** the staff e-mail links (6a backlog); the runs-list 🗑 (stays a plain delete); the final Polish slice's items (browser `confirm()` in authoring, reduced motion).

## Copy changes

Old → new, so tests and reviewers know which texts change on purpose. Everything not listed keeps today's wording.

A confirm written "Question? Cancel / **Action**" in this spec names its two buttons; they render in `InlineConfirm`'s order (the action first, then Cancel), as every confirm in the app does.
- Readiness labels: "At least one teacher" → "At least one teacher assigned"; "All students assigned to a group" → "Every student assigned to a group"; "No oversized groups (≤10 students each)" → "No group over 10 students"; new row "Course version enabled".
- Readiness hints and Publish's title: §Publish readiness. Today's version tooltip "This run's course version is disabled. Re-enable it under Course Editor before publishing." stays only in the page banner.
- Settings: the help line "Disabling groups hides group assignments but does not delete them." → "Disabling hides assignments but does not delete them." (as drawn); the lock, today only a `title` ("Locked once the run is published. Unpublish to change." / "…Ask a course admin to unpublish before changing."), becomes a visible line as drawn: "Locked while the run is published — unpublish to change." (admin) / "Locked while the run is published — ask a course admin to unpublish." (teacher).
- Run frame / Overview: "Publish" → "Publish run"; "Danger zone" heading goes; the run fields' labels "Start" / "End" stay.
- Unpublish confirm: "Confirm Unpublish" with the warning → the one-line "Students lose access immediately; their progress is kept." Cancel / **Unpublish**.
- Delete: "Danger zone" / "Delete run" / "Confirm Delete" → the "Delete this run" card (§Delete this run). "Clear roster before deleting." goes (force never returns it).
- Roster banner (teachers): "Publish this run before adding students. You can still move or remove students already on the roster." → "This run is not published yet. A course admin publishes it; then students can be added. You can still move or remove students already on the roster."; the disabled title for teachers "A course admin must publish this run first" (admins: "Publish this run before adding students").
- Roster result banner: the in-flight line (today empty) → "Moving N…" / "Removing N…"; "Retry N delete" → "Retry removing N"; "Retry cancelled" → "Retry the N not processed"; "Retry cancelled → group…" → "Move the N not processed…".
- Roster: search placeholder "Search by name or email…" → "Search name or email…"; pill "Showing: Unassigned (N)" → chip "Unassigned (N)"; "Delete selected" → 🗑 "Remove selected"; "× clear" → "Clear selection"; bulk confirm → "Remove N students from this run?" / **Remove** ("Remove 1 student from this run?"); row "Delete" → 🗑 "Remove from run", confirm "Remove {email} from this run?" / **Remove**; banner verb "Deleted" → "Removed"; "Import roster from CSV" (empty link) → "Import roster"; group option "Group A (7/10)" → "Group A · 7/10".
- Panel frame: the dialog's `aria-label` ("Submission details" / "Item-level breakdown") → `labelledby` its title: the block title (submission) or the student's name, "Item details" while loading (progress); the old `<h3>` mini-project title → the `<h2>` block title; "✕ Close" → Modal's × ("Close"); the status badge text → `STATUS_SHORT_LABEL` ("awaiting eval").
- Panel submission lines "Number: N", "Submitted at: …", "Submitted by: …", "Late: Yes/No", "Resubmission: Yes/No", "File size: …", "Download submission" → the rows Submitted / By / Number, the "late" / "resubmission" chips, and the file card; "Evaluated at / Evaluated by" → one row "Evaluated" ("{by} · {when}").
- Panel: "Previous submissions" → "Earlier submissions"; "Loading previous submissions…" → "Loading earlier submissions…"; "Submission" / "Evaluation" headings → "Latest submission" / "Evaluation"; "Edit evaluation" → "Edit"; "Save" → "Save evaluation"; "Feedback text" → "Feedback"; "Feedback PDF" → "Feedback file"; the feedback and file labels say "(required)" whenever the result is not Accepted, including before a result is chosen (today "(optional)" until a non-accepted result is chosen); the lock text "Cannot change to a non-accepted result without a feedback file. Create a new evaluation instead." → "Without a feedback file the result can only be Accepted."; "Existing feedback file uploaded — replace not supported (Phase 9)" → "The feedback file cannot be replaced."; "Result: minor_revision" (raw) → the badge "Minor revision"; the Progress error's "— Refresh" → "— close this panel and refresh the table."

## Overview (10a, `RunOverviewTab`)

**Layout.** Two columns (`1fr 1fr`, gap 14px, `align-items: start`) under the tab strip:
- left, stacked (gap 14px): **Run details**, **Settings**;
- right, stacked (gap 14px): **Publish readiness**, **Delete this run** (course admins).
- The drawing puts Settings on the right; the user moved it left during Task 2 (2026-10-13) to balance the columns: what the run is on the left, publishing and deleting it on the right.
- Below 880px the columns stack (left cards first).
- Each card: `--surface`, 1px `--border`, the 6a card radius, padding 16px 18px; an `<h2>` title at 14px / 600 (as drawn).

### Run details

A grid `132px 1fr 54px` (label / value / action slot), one row per field, a 1px `--border-soft` line between rows. Labels `--muted`; values wrap (`overflow-wrap: anywhere`).
- **Title** — ✎ "Edit the title".
- **Start**, **End** — the date via `formatShortDate` ("01 Sep 2026"). ✎ "Edit the start date" / "Edit the end date".
- **Version** — `{label} · ` (when the label is not empty) then mono `--muted` "v. N" (D8), from `pinned`; "v. N" alone when the version is missing. Its ✎ is disabled with the title "The version is fixed when the run is created".

Editing (R31, R32):
- ✎ swaps the value for `InlineName` spanning the value and action columns, ✓ landing in the action slot (handoff §4). Labels "Title" / "Start date" / "End date"; `saveTitle` "Save title" / "Save start date" / "Save end date"; for the dates `emptyTitle` "Choose a date". Title keeps `maxlength 200`.
- Save sends `PATCH /api/runs/{id}` with that one field, then `setRun(updated)`; the row closes; focus returns to its ✎.
- Esc / Cancel closes without a request; focus returns to ✎.
- A failed save keeps the field open with the server's message under it (`InlineName`'s error line), e.g. "end_date must be on or after start_date". Today's error toasts for fields go.
- Teachers and admins edit, as today (`require_run_admin_or_teacher`, `runs.py:79`).

### Settings

- "Groups enabled": the shared `Switch` (R42) with its visible `<label for>`, and the help line "Disabling hides assignments but does not delete them." (as drawn) in its `aria-describedby`.
- **Published run:** the switch is disabled, and a visible muted line above the help gives the lock text (§Copy changes, by role; the drawing's order: lock first, then help). The line joins `aria-describedby`; the switch's `title` is the same text.
- **While the request runs:** the switch is `frozen` (6b R19). A failure sets it back and toasts "Could not update setting: …", as today (`RunOverviewTab.svelte:112-125`), including the 409 "Cannot disable groups; mini-projects exist".

### Publish readiness

Shown to everyone, on draft and published runs. Rows: an 18px status box (radius 4, as drawn; `aria-hidden`), a visually hidden "Done:" / "To do:" (none for not-applicable rows, whose visible hint says it), the label, and an optional hint; a 1px `--border-soft` line between rows.
- ✓ ok: `--status-accepted-bg` / `-fg`;
- × violated: `--status-needs-revision-bg` / `-fg`;
- – not applicable: `--surface-2` / `--muted`, hint "not applicable".

The rows (R34), in this order. 10a draws "Version published" and a "Groups enabled" row; the spec keeps the checks the server makes when publishing (`runs.py:180-266`): it refuses a disabled version (`:184-186`), not an unpublished one, and the group-size check is today's.
1. **At least one teacher assigned** — violated: hint "Add a teacher — open Teachers" (a link button to the Teachers tab, P10); reason "No teacher is assigned yet".
2. **Course version enabled** — violated: hint "Re-enable it in the course editor" (admin) / "Ask a course admin to re-enable it" (teacher); reason "The course version is disabled". Not applicable when the pinned version is missing from `versions`.
3. **Every student assigned to a group** — ✓ when no student is unassigned, including a run with no students or no groups (the server refuses only unassigned students, `runs.py:203-210`; `RunDetailPage.publish.svelte.test.ts:239-251` stays). Violated when some are unassigned: with no groups yet the hint is "No groups yet — open Groups" (a link button to Groups, P10); otherwise "N unassigned — open Roster" (today's `goto-unassigned` jump with the Unassigned filter, `RunOverviewTab.svelte:188-194`); reason "N students are still unassigned to a group" ("1 student is…"). Not applicable when groups are off.
4. **No group over 10 students** — violated: hint today's list "Group A (12), Group C (11)"; reason "Groups over 10 students: Group A (12), Group C (11)". Not applicable when groups are off.

The card's `<h2>` has `tabindex="-1"` (a focus fallback).

**Footer** (a 1px `--border` line above; a muted note at the left, the action at the right):
- **Draft, admin:** "Fix the outstanding check to publish." / "Fix the N outstanding checks to publish." with **Publish run** disabled (`title` = `publishTitle`); or "Ready to publish." with **Publish run** enabled (primary).
  - A click awaits `onPublish()`. While it runs the button is `loading` with "Publishing…", `aria-disabled="true"`, never natively disabled (R20), so it keeps focus and the conflicts modal's FocusTrap returns focus to it (`RunDetailPage.publish.svelte.test.ts:555-574`).
  - `'conflicts'` opens today's `PublishConflictsModal`. Other errors toast, as today. A 409 that is not a conflicts response (already published elsewhere, or a readiness check the stale page missed) also refetches the run, the versions, the teachers, the groups and the students, as Unpublish's 409 refetches the run (`:336-342`); if the run turns out published the outcome is `'published'`.
- **Published, admin:** "Published — students have access." with **Unpublish** (secondary). Unpublish (ignored while `unpublishing`) replaces the footer with the one-line confirm "Students lose access immediately; their progress is kept." Cancel / **Unpublish** (danger text), `InlineConfirm row takeFocus`; `confirmDataAction="confirm-unpublish"`.
- **Teacher (not admin):** the rows, and the note "A course admin publishes this run." (draft) or "Published — students have access." (published), with no button.

The title row loses its publish bar (`RunDetailPage.svelte:368-383`) and the `.publish-bar` style.

### Delete this run (D24, D28)

Shown to course admins on every run. Teachers do not see it.
- The card: `<h2 tabindex="-1">` "Delete this run", the muted line "Only while unpublished. Roster, groups and submissions go with it." (as drawn), and a 28px 🗑 `IconButton` in `--danger` at the right ("Delete this run", `aria-expanded` while the panel shows, `data-action="delete-run"`).
- **Published run:** 🗑 is disabled with the title "Unpublish the run before deleting it".
- **Draft:** 🗑 opens `DangerConfirm` full width under the card's row, with the message "This deletes the run with its roster, groups, teacher assignments, mini-projects, assets, submissions and evaluations, and every uploaded file. It cannot be undone." Student item progress is per student, not per run, and stays (not mentioned in the message). Force delete awaits `onDeleteRun()` with `busy` set, so Esc / Cancel cannot close the panel mid-request.
  - `'deleted'`: the toast "Run deleted." (as the runs list) and navigation to `/teaching/{slug}`, as today.
  - `'published-now'` (the D28 409 "Unpublish run before deleting"): the page refetches the run (`setRun`); the panel closes; the toast "This run was published in the meantime. Unpublish it before deleting."; focus → 🗑 (now disabled, so `focusFirst([🗑, the card's <h2>])`).
  - `'failed'`: the result's `message` as an error line in the card under the panel (the 6a error banner, `role="alert"`); the panel stays open and re-arms (`DangerConfirm` un-ticks and refocuses its box, R45).
- Cancel closes the panel; focus → 🗑.
- Today's `onDeleteRun` special case "Clear roster before deleting." (`RunDetailPage.svelte:310-313`) goes.

## Roster (10b, `RunRosterTab`)

Top to bottom: the draft banner, the toolbar, the add row, the bulk strip, the result banner, the table (or the empty state / the no-match line). `RunRosterTab` gains `isAdmin`.

**Draft banner.** Today's text, as the 6a **info** precondition banner (`--surface-2`, 3px `--primary` left rule). Admins: "Publish this run before adding students. You can still move or remove students already on the roster." + "Publish on Overview" (`nav-overview-publish-roster`). Teachers: "This run is not published yet. A course admin publishes it; then students can be added. You can still move or remove students already on the roster.", no link.

**Toolbar** (one row, wraps below 760px):
- left: the search field (native, R40; 230px as drawn; visually hidden label "Search students"; placeholder "Search name or email…"; `name="roster-search"`; typing clears the Unassigned filter, as today) and, when the filter is on, the chip **Unassigned (N) ×** (`--surface-2`, a pill; × is "Clear filter", `data-action="clear-prefilter"`);
- right: **Import roster** (secondary `Button`, `data-action="open-import"`) and the add toggle (primary `IconButton`, `data-action="toggle-add-student"`).
- On a draft run both are disabled, with the title "Publish this run before adding students" (admin) / "A course admin must publish this run first" (teacher) and `aria-describedby` the banner.

**Add row (D25).** The toggle shows + "Add student" when closed and × "Close add row" when open (`aria-expanded`, `aria-controls` the row), as 6a Groups and handoff §4 Collapsed forms. The row (`--surface-2`, the 6a add-row look):
- the e-mail field (native, `type="email"`, `maxlength 254`, `name="new-email"`, visually hidden label "Student email", placeholder "student@example.com"), the group select (groups on; enabled groups; "Unassigned" first; visually hidden label "Group"), **Add** (primary, `data-action="add-student"`) and **Cancel**;
- focus goes to the e-mail field; Enter submits; Add is disabled with the title "Enter an email address" while the field is empty;
- while the add and its refetch run, Add is `loading` (not disabled, R20) and the field is `readonly`;
- success: the field empties, the group resets to Unassigned, focus returns to the e-mail field; the row stays open;
- today's duplicate check ("{email} is already enrolled. Edit their group in the table.") and server errors show under the row (`role="alert"`, the 6a error line); the field gets `aria-invalid` and `aria-describedby` the error;
- Esc in the row, Cancel, or the toggle closes it; focus → the toggle.

**Empty roster:** the 6a `EmptyState` "No students yet." with two link buttons, "Import roster" (`data-action="open-import-link"`, 6b's `openImportFromLink`, now with `preventScroll: true`) and "Add student" (opens the add row). Both disabled on a draft run.

**Bulk strip** (`data-strip="bulk"`, when anything is selected; `--primary-soft` background, 1px `--border`, radius, as drawn):
- "N selected" (600), plus " (M visible)" while the search or filter hides some;
- "Move to group…" select (groups on; visually hidden label "Move selected to a group"; `data-action="bulk-move-select"`), today's reset-after-change;
- 🗑 "Remove selected" (`data-action="bulk-delete"`), which turns the strip's right part into "Remove N students from this run?" Cancel / **Remove** (`InlineConfirm row takeFocus`, `confirmDataAction="confirm-bulk-delete"`);
- "Clear selection" (text button, `data-action="clear-selection"`) at the right.
- While a bulk op runs, 🗑 is `aria-disabled` with the title "Wait for the current change to finish", and the select's handler returns and resets (R44).
- Selected rows get a `--primary-soft` tint (as drawn).

**Result banner** (today's `bulkOpResult`, `RunRosterTab.svelte:85-118`), `role="status"`:
- in flight: "Moving N…" / "Removing N…" on the 6a info tint (`--surface-2`, 3px `--primary` rule), no actions;
- success: `--status-accepted-bg` with a 3px `--success` rule; "Moved 36 of 36 — 0 failed."; closes itself after 5 s, as today;
- partial / cancelled: `--status-needs-revision-bg` with a 3px `--gold` rule (the 6a warning banner); today's text, plus " Hover a marked row for the reason." only when some row is marked (`chunkErrorRowIds.length > 0`);
- at the right: today's retry controls as text-styled controls (`retry-move-select` "Retry N → group…", visually hidden label "Move the N failed students to a group"; `retry-delete` "Retry removing N"; `retry-cancelled` "Move the N not processed…" / "Retry the N not processed"), then "Dismiss" (`dismiss-banner`). The retries follow R44.

**Table** (6a table look: `--surface`, header `--surface-2`, 1px `--border-soft` row lines; inside a wrapper that scrolls sideways below ~700px):
- columns: the checkbox (header box "Select all visible students", indeterminate as today, `data-header-checkbox`; row box "Select {email}", `data-row-checkbox`), Email, Full name ("—" when empty), Group (groups on; select "Group for {email}", R38; disabled while that row's request runs; a failure toasts, as today), and the actions cell (header visually hidden "Actions");
- a marked row (failed its last bulk op) gets a 3px `--danger` left rule (an inset box-shadow on its first cell), keeps its reason as the row `title`, and a visually hidden "Failed: {reason}" in the Email cell; it stays selected, as today;
- the row 🗑 "Remove {email}" (title "Remove from run", `data-action="delete-student"`) opens a one-line confirm row under its row (6a's plain delete confirm): "Remove {email} from this run?" Cancel / **Remove** (`confirmDataAction="confirm-delete-student"`). Success refetches; failure toasts, as today. Long e-mails wrap.
- Rows keep `data-row="student"` and `data-user-id`.

**No match:** today's "No students match '…'. Clear search." (`clear-search-link`) and "No students are unassigned. Clear filter." (`clear-prefilter-link`) as muted lines with link buttons.

10b's footnote ("A marked row failed its last bulk operation…") is a design note, not UI.

## Side panel (9b, `DashboardSidePanel`)

### Frame (D27, D29, R30)

- `ui/Modal` with `placement="right"`, `width={520}` (as drawn), no `closeOnBackdrop` (D29), `labelledby` the panel title, `closeDisabled` while a save runs with `closeTitle="Wait for the save to finish"`.
- **Header:** the title (`<h2>`, 14.5px / 600, as drawn) and a mono `--muted` subtitle; at the right the status badge, then Modal's ×.
- **Body:** cards with Modal's 12px gap (as drawn). Each card: `--surface`, 1px `--border`, radius; a card head is a `--surface-2` strip with a 1px bottom line (as drawn) holding an `<h3>`.
- **Closing:** × and Esc call `tryClose` (`DashboardSidePanel.svelte:374-381`): nothing while a save runs; the discard confirm when the form is dirty; otherwise close.
- **Discard confirm** (the 6b pattern): `InlineConfirm row takeFocus` in Modal's footer, shown only while asking: "Discard unsaved changes?" Cancel / **Discard** (`confirmDataAction="confirm-discard"`). While it shows the body is inert (`bodyInert`). × (or Esc while focus is on ×) moves focus to its Cancel instead of asking again; Esc on the confirm's own buttons cancels it (`InlineConfirm takeFocus`). Cancel closes the confirm and returns focus to the element that had focus when it opened (saved on open), else the checked Result radio, else ×. Discard: R36.
- `DirtyGuard` stays, so Back, an address change and a reload with a half-written evaluation ask (6a D10).
- Below 480px the Feedback and Score fields stack.

### Submission variant

**Header:** the title is the block title (`target.mp.block_title`, 6a D6), e.g. "Matrices and transformations"; subtitle "{Group} · {B2}" (no B-label when none is passed, R35); the badge is `panelStatus` with `STATUS_SHORT_LABEL` (as in the grid that opened it).

**Not submitted yet:** one muted line.

**Latest submission card:**
- head: "Latest submission", and at the right the chips "resubmission" (`--surface-2` / `--text-3`) and "late" (`--status-needs-revision-bg` / `-fg`, as drawn) when they apply;
- rows (label `--muted`): Submitted (`formatLocalWithTz`, deliberately kept, not the drawn "14 Aug 2026, 23:41 CEST"), By (`full_name ?? user_id ?? '—'`, as today), Number;
- the file card (D26): a 32×28 "PDF" tile (`--surface-2`, mono), "Submission N", mono "PDF · 2.4 MB" (`formatFileSize`), and a ⤓ `IconButton href download` ("Download submission N") to `/api/submissions/{id}/file`.

**Evaluate card** (can grade, no evaluation yet; 1.5px `--primary` border with a 3px `--primary-soft` halo, a `--primary-soft` head, as drawn):
- **Result** (R37): Accepted · Minor revision · Major revision · Rejected, none selected at first. Today's "Result is required." error stays, under the control.
- **Feedback** (textarea, `maxlength 1000`) beside **Score** (number 0–100, 96px, mono value, "(optional, 0–100)"; its error under it). Under the feedback, today's counter "N / 1000" with " — approaching limit" and its polite live region; today's "Feedback is required…" error stays.
- **Bottom row (as drawn):** at the left the feedback-file control, at the right **Save evaluation**.
  - The file control: "Feedback file (required)" unless Accepted ("Feedback file (optional)" for Accepted), then an "attach PDF" link button (its name is its visible text, with `aria-describedby` the file label) that calls `input.click()` on a `hidden` native file input (one tab stop; tests dispatch `change` on the input). A chosen file shows as "{name} · {size}" with a remove × ("Remove {name}"); remove clears the input's `value`. "PDF only, max 20 MB." and today's size / type / required errors stay.
  - **Save evaluation** (primary). While `!valid` it is disabled with a reason as `title`, first match wins: "Choose a result", "Score must be a whole number between 0 and 100", "Write feedback for a non-accepted result", "Attach the feedback PDF". While saving it is `loading` ("Saving…"), not disabled, and keeps focus; the fields freeze (textarea and score `readonly`, the Result fieldset `disabled` (R37), the file control inert) so nothing typed during an upload is lost; "Cancel upload" shows beside it (today's abort).
- A server error shows above the bottom row (`role="alert"`, the 6a error banner).
- What is sent, the 60 s timeout, the race handling and the refetches are unchanged.

**Already evaluated (not a resubmission):**
- an **Evaluation** card, read-only: Result as a badge with the result's own label (`RESULT_LABEL`: "Accepted", "Minor revision", "Major revision", "Rejected"; tokens from `resultToStatus`), Score ("—" when empty), Feedback (pre-wrapped, or "—"), Evaluated (by `full_name ?? user_id ?? '—'` and when; "You · Just now" before the refetch, as today), and when there is one the feedback file card ("Feedback file", mono "PDF", ⤓ "Download feedback file" → `/api/evaluations/{id}/feedback-file`);
- **Edit** (secondary `Button`, `data-test="edit-evaluation"`) in the card head, for people who can grade. It turns the card into the Evaluate form, pre-filled, with **Save evaluation** and **Cancel** (`data-test="cancel-button"`). Edit keeps today's rules: no file field (the line "The feedback file cannot be replaced." when there is one), and the result is locked to Accepted when there is no file (R37).

**Auto-accepted resubmission:** today's info line "Auto-accepted on resubmission. No manual evaluation needed." (the 6a info banner: `--surface-2`, 3px `--primary` rule), then the read-only Evaluation card without Edit.

**Can't grade:** the read-only cards; "Awaiting evaluation" (`data-test="awaiting-evaluation-placeholder"`) as a muted line where the form would be.

**Earlier submissions:**
- While the thread loads: the line "Loading earlier submissions…" on its own (`thread-loading`); on failure "Couldn't load submission history. Retry" (`thread-error`, `thread-retry`), as today.
- When the thread has more than one: a card with the head "Earlier submissions" and the count at the right.
- Each row is `SubmissionThreadEntry`, restyled: a disclosure button "› Submission 2" with the date "02 Aug 2026" (mono, §Dates) and the result badge (`STATUS_SHORT_LABEL`) at the right, `aria-expanded`. Opened, it shows the read-only Submission and Evaluation content indented under the row (no box in a box), with today's auto-accept line and "Awaiting evaluation" placeholder kept.

### Progress variant (no drawing)

- Header: the student's name (or e-mail) and, mono, "{Block title} — {Sequence title}". While loading or after an error the title is "Item details", so the dialog is always named. No badge.
- One **Items** card: per item `course/ItemMark` (its type; state `covered` or `not-yet`), the title, a visually hidden "covered" / "not covered" and the readable type name (`ITEM_TYPE_NAME` over the drill-down's types: `static_page` "Page" (the authoring name), `video` "Video", `quiz` "Quiz", `interactive_app` "Interactive app"; `item_type` is narrowed to these before it reaches `ItemMark`; an unknown type gets an empty 22px box and its raw name), and the last score "3/4" (mono) at the right.
- "Loading…", the error banner ("Item details unavailable. The dashboard may be out of date — close this panel and refresh the table.") and "No items in this sequence." restyled.

### Code split

- `SubmissionCards.svelte` exports the read-only snippets `submissionContent` and `evaluationContent`, used by the panel and by `SubmissionThreadEntry`.
- `ProgressBreakdown.svelte` — the Items card, from today's `:510-534`.
- `DashboardSidePanel.svelte` keeps the fetches, the evaluation state machine, the dirty / discard logic and the `evaluationForm` snippet (R43). Its props stay, plus `blockLabel` (R35); the Progress and Submissions tabs call it as today.

## Dates

- Overview Start / End: `formatShortDate` (`lib/datetime.ts:52`; never `new Date('YYYY-MM-DD')`).
- Earlier-submission rows: a new `formatLocalShortDate(iso)` in `lib/datetime.ts` ("02 Aug 2026" in the viewer's zone).
- "Submitted" and "Evaluated": `formatLocalWithTz`, as today.

## Focus

6a §Focus holds. In 6c:
- **Overview fields:** after Save or Cancel, focus → the row's ✎.
- **Publish:** `'published'` → Unpublish. `'failed'` → stays on Publish run. `'conflicts'` → the modal; on close it returns to Publish run.
- **Unpublish:** the confirm focuses its Cancel; Cancel → Unpublish. `'unpublished'` or `'draft-now'` → `focusFirst([Publish run, the readiness <h2> (tabindex -1)])`. `'failed'` → Unpublish.
- **Delete:** `DangerConfirm` focuses its box; Cancel → 🗑; after a request its box (R45); the other outcomes as §Delete this run says.
- **Roster:**
  - the toggle → the e-mail field; closing the row → the toggle;
  - chip ×, Clear selection, Clear search, Clear filter, Dismiss, or the success banner's auto-close while focus is inside it → the search field;
  - a bulk op or retry settles → the strip's 🗑 if the strip is still there, else the banner's first retry control, else Dismiss;
  - the bulk confirm focuses Cancel; Cancel → the strip's 🗑;
  - the row confirm focuses Cancel; Cancel → its 🗑; Remove → the next row's 🗑, else the previous row's, else the add toggle (when enabled), else the search field (6a's chain); a failed Remove → its 🗑.
- **Side panel:**
  - open → the checked Result radio, else the first radio when the form shows; otherwise ×;
  - Edit → the checked Result radio (Accepted when locked);
  - Save success, Cancel of an edit, Discard from Cancel (R36) → Edit, else the Evaluation card's `<h3>` (tabindex -1);
  - a 409 race → the Evaluation card's `<h3>` once it renders, else ×;
  - a failed save or a cancelled upload → after the un-freeze and `tick()`, `focusFirst([the first field with an error, Save evaluation])` (6b R20; covers a save started by Enter on a radio, and "Cancel upload" unmounting);
  - Retry on the thread → the panel title (`<h2 tabindex="-1">`);
  - a chosen file → its remove ×; remove → "attach PDF";
  - close → Modal's FocusTrap returns focus to the cell that opened it (Safari does not focus a clicked button, so there it falls back; browser-pass item, as today).
- **Import modal (R39):** closing while another tab is active → the active tab button.

## Hooks that stay

Tests select these; each stays on its successor control. Overview: `goto-unassigned`, `delete-run`, `publish`, `unpublish`. Roster: `open-import`, `open-import-link`, `add-student`, `delete-student`, `confirm-delete-student`, `bulk-delete`, `confirm-bulk-delete`, `bulk-move-select`, `clear-selection`, `retry-move-select`, `retry-delete`, `retry-cancelled`, `dismiss-banner`, `clear-prefilter`, `clear-prefilter-link`, `clear-search-link`, `nav-overview-publish-roster`, `draft-publish-hint`; `data-row="student"`, `data-user-id`, `data-header-checkbox`, `data-row-checkbox`, `data-strip="bulk"`, `input[name="roster-search"]`, `input[name="new-email"]`. Overview / Roster ids: `#roster-draft-publish-hint`; InlineConfirm's `button.confirm`. Panel: `form[aria-label="Write evaluation"]` (both modes), `aria-busy` on Save evaluation, `button[type="submit"]` (Save evaluation), `edit-evaluation`, `cancel-button`, `thread-loading`, `thread-error`, `thread-retry`, `thread-history`, `thread-entry`, `thread-entry-toggle`, `feedback-counter-visible`, `feedback-counter-live`, `awaiting-evaluation-placeholder`, the field names `evaluation-result` (now radios), `evaluation-score`, `evaluation-feedback`, `evaluation-file` and their ids. New: `toggle-add-student`, `confirm-unpublish`, `confirm-discard`; DangerConfirm brings its own.

## Code changes

- **Changed:** `components/runs/{RunOverviewTab,RunRosterTab,DashboardSidePanel,SubmissionThreadEntry,RunSubmissionTab,RunProgressTab}.svelte`; `pages/runs/RunDetailPage.svelte`; `components/ui/{Modal,InlineName,IconButton,Switch,Button,DangerConfirm}.svelte`; `lib/runs.ts`, `lib/datetime.ts`, `lib/dashboards.ts`; `backend/mathion/api/{runs,submission_files}.py`; `frontend/scripts/visual-refresh-gate.sh`.
- **New:** `components/runs/{SubmissionCards,ProgressBreakdown}.svelte`.
- **Tests changed:** `RunOverviewTab`, `RunOverviewTab.checklist`, the six `RunRosterTab.*`, `DashboardSidePanel`, `SubmissionThreadEntry`, `RunDetailPage`, `RunDetailPage.publish`, `RunDetailPage.tabs`, `RunSubmissionTab` (its `aria-label="Submission details"` pin, `:355`, becomes the block-title name), `RunProgressTab` (its `aria-label="Item-level breakdown"` pin, `:371`, becomes the "Item details" / student-name title), `Modal`, `InlineName`, `IconButton`, `Switch`, `Button`, `DangerConfirm`, `lib/datetime`; backend `test_runs.py` and `test_concurrency_mini_project.py` (D28).
- **Retired:** `RunOverviewTab.svelte.test.ts:65-193` (save on blur including the tests at `:85` and `:109`, Enter blurs, the three in-flight cross-field race tests), replaced by the R31/R32 cases.
- **Assertions that flip on purpose:** the panel's discard confirm focuses Cancel, not Discard (T28b/c/d, `DashboardSidePanel.svelte.test.ts:1220-1275`); T28c's backdrop click now does nothing (D29); the switch lock text moves from a `<label title>` to a visible line; `RunOverviewTab.checklist:133` (the delete card now shows on a published run, 🗑 disabled); `RunDetailPage.publish:111` ("Confirm Unpublish" → the one-line confirm); T21 (`DashboardSidePanel.svelte.test.ts:686`: Save natively disabled while saving → `aria-disabled` + `aria-busy`, R44); `RunSubmissionTab.svelte.test.ts:357` (the mini-project title → the block title); the copy in §Copy changes.
- **New test files:** `ProgressBreakdown`, `SubmissionCards`.

## Process

As in 6b (the per-task loop):
1. TDD per step.
2. vitest (exit 0, no "Errors" / "Unhandled" line); backend pytest through `backend/.venv` for D28.
3. svelte-check with 0 errors.
4. The gate.
5. Screenshots of the real screens at 1280 and 1000 in an overlay → the user's OK.
6. Opus + Fable review lanes on the uncommitted diff until clean.
7. Commit with exact paths.
8. Wait for the user's "go".

Rules for the work:
- Screenshots use the dev data (run 8) plus network mocks. No writes to shared data: every evaluation, delete, add, move, field save and publish is mocked. No real quiz attempts.
- The final whole-branch review (fresh Opus + Fable) and a Safari pass (one step at a time, console mock, no VoiceOver) close 6c.

Order (six tasks):
1. Overview: layout, Run details (R31, R32) and Settings (R42). Its screenshot shows the right column's lower cards still old; the user's OK covers Run details and Settings.
2. Overview: Publish readiness (R33, R34), Delete this run (D24, D28 incl. the backend change); the publish bar leaves the title row.
3. Roster: banner, toolbar, add toggle and row (D25, R40, R41), empty states, the import modal in the loaded branch (R39).
4. Roster: bulk strip and its confirm, the result banner, the table (R38), marked rows, the row confirm.
5. Drawer: `Modal` placement and `closeTitle` (R30), the panel on Modal (D27, D29), the discard footer, the header, `ProgressBreakdown`. The panel test file's frame selectors change here.
6. Submission variant: `SubmissionCards`, the `evaluationForm` snippet (R37, R43), the Evaluation card with Edit, earlier submissions, `blockLabel` (R35). The Result selectors change here.

## Testing

Each task adds or changes tests first. The cases that must exist:

**Overview**
- ✎ Title opens the field with focus in it; Enter sends one PATCH with `{title}` and closes; focus on ✎.
- Esc closes without a request; an unchanged value closes without a request.
- A failed save keeps the field open with the server text; no toast.
- Start / End use `type="date"`; an empty date's ✓ is disabled with "Choose a date"; the end-before-start text shows under the field.
- While one field is open, the other ✎ are disabled with "Finish editing the … first"; while a field save runs the switch ignores clicks; while the switch's request runs the ✎ are disabled.
- Version: "Label · v. N"; "v. N" alone with an empty label; its ✎ disabled with its title.
- The switch: one PATCH per toggle; a failure sets it back and toasts; on a published run it is disabled with the visible lock line (admin and teacher texts) in its `aria-describedby`.
- Readiness: the four rows in order with their states and hidden state words; groups off → two "not applicable" rows; a disabled version → row 2 violated, Publish run disabled with "The course version is disabled"; the disabled title is the first violated row's reason.
- "N unassigned — open Roster" jumps to Roster with the filter and focuses the tab (P10).
- Publish run: two clicks while the first request runs send one POST; while busy it is `aria-disabled`, not `disabled`, and keeps focus; `publishing` clears after a stale-token return.
- Publish success → Unpublish focused. Unpublish confirm → Publish run (or the readiness heading) focused; Cancel → Unpublish; a 409 that finds a draft → Publish run focused.
- A teacher sees the rows and "A course admin publishes this run." with no button, and no delete card.
- Delete: on a published run 🗑 is disabled with its title; on a draft 🗑 opens the danger panel; Force delete is inert until "I understand"; it sends `DELETE …?force=true`; success toasts "Run deleted." and navigates; a 409 "Unpublish run before deleting" refetches, closes the panel, toasts and disables 🗑; another failure shows the error line and re-arms.
- The title row has no publish bar.
- Backend (D28): a forced delete of a published run returns 409 and the run remains; a forced delete of a draft with students and submissions returns 204 and deletes everything; the two re-staged concurrency force tests pass; run with `backend/.venv/bin/pytest backend/tests/test_runs.py backend/tests/test_concurrency_mini_project.py`.
- R32: during a field save, Publish run, Unpublish and 🗑 do nothing; during Publish, ✎ and the switch do nothing.
- Unpublish: a second click on the confirm's Unpublish while the first runs sends one POST.
- A publish 409 whose refetch finds the run published → Unpublish focused.
- Readiness with groups on: no students → row 3 ✓ and Publish run enabled; no groups and an unassigned student → hint "No groups yet — open Groups".
- A remount of the Overview while the page is publishing keeps ✎ and the switch locked; an open danger panel's Force delete is disabled while a field saves.
- `loadAll` (e.g. `reloadRun()`) clears a stuck `publishing` flag.

**Roster**
- The toggle opens the add row with focus on e-mail, shows × with `aria-expanded="true"`; Esc / Cancel / the toggle closes it and focuses the toggle.
- Add success empties the field, keeps the row open, refetches, refocuses e-mail; a second Enter during the add or its refetch sends nothing.
- The duplicate check and a server error show under the row; `aria-invalid` on e-mail.
- On a draft run the toggle and Import roster are disabled and described by the banner; a teacher's banner has no link.
- The bulk 🗑 confirm says "Remove N students from this run?" (and the singular); Remove runs the bulk delete; Cancel → 🗑.
- R44: during a bulk op, a change on the bulk-move or a retry select sends nothing and the select resets; a click on 🗑 does nothing.
- The banner: in flight "Moving N…"; success green and gone after 5 s; partial gold with the hover hint and the retry select; cancelled with no marked rows has no hover hint; Dismiss → the search field.
- A marked row has the rule class, the `title`, and the hidden "Failed: …" text.
- Group options read "Group A · 7/10" in all five selects, and " · disabled" in the row select.
- The row confirm says "Remove {email} from this run?"; Remove → next row's 🗑, else previous, else the toggle, else search; a failed Remove → its 🗑.
- Accessible names: search, e-mail, group selects, checkboxes, 🗑s, as §Roster lists.
- **R39:** with the import modal open, an address change to `?tab=overview` keeps it mounted; closing it then focuses the Overview tab button.

**Side panel**
- It renders inside `.modal-panel.right`; Esc and × close a clean panel; a click on the backdrop does not close it (D29); a dirty panel shows the footer confirm with focus on Cancel, the body inert; × while asking focuses Cancel and keeps the confirm.
- R36: dirty edit → Cancel → Discard ends the edit, focus on Edit; dirty edit → × → Discard closes; dirty create → Esc → Discard closes.
- Nothing closes while a save runs; × is disabled with "Wait for the save to finish".
- The discard confirm: × while it shows focuses its Cancel; Esc on its Cancel closes it.
- Thread Retry → focus on the panel title.
- A failed save → focus on the first errored field, else Save evaluation; a cancelled upload → Save evaluation.
- The header: the block title, "{Group} · B2", and "{Group}" alone without `blockLabel`.
- The file card: "Submission 3", "PDF · 2.4 MB", an `<a download>` to the file.
- Result radios in the drawn order, none checked; a locked result disables three radios, with the visible lock line.
- Edit focuses the checked radio and pre-fills the form; Cancel returns to the read-only card with focus on Edit.
- The feedback-file label says "(required)" unless Accepted; "attach PDF" is one tab stop; remove clears the input.
- Save evaluation's disabled titles in order; while saving it keeps focus and the textarea is `readonly`.
- The read-only card shows "Minor revision" for a `minor_revision` evaluation.
- Earlier submissions: the loading line before the card; the count; a row toggles with `aria-expanded`; an opened auto-accepted entry keeps its info line.
- The Progress variant: "Item details" while loading; then the name and "Block — Sequence"; `ItemMark` rows with the readable type name.
- Every existing behaviour test of the panel (create, edit, abort, timeout, race, thread refetch) still passes with selectors updated, not removed.

## Gate

- **A `FILES_6C` list:** `RunOverviewTab`, `RunRosterTab`, `DashboardSidePanel`, `SubmissionThreadEntry`, `SubmissionCards`, `ProgressBreakdown`. It runs the `emoji_scan` and `colour_scan` over them, in the style of 6b's (ak). Each file joins the list in the task that restyles it.
- **New section (al)** with `own` / `uniq1`, `d` / `chk` rows and the `sweep` for the new classes, and pins for:
  - the Overview's two columns, the 14px gap, the 880px stack, the `132px 1fr 54px` grid;
  - the readiness status boxes (18px; ok / violated / n.a. tokens);
  - the roster's strip tint, the marked-row rule, the selected-row tint, the two banner tints, the info draft banner;
  - the drawer: `.modal-backdrop.right` and `.modal-panel.right` geometry (width var, `100dvh`, no max-height, square edge, left border);
  - the Evaluate card's border, halo and head tint; the segmented Result's checked state;
  - the "late" chip tokens; the PDF tile.
- **(aa):** the centre backdrop and panel rules still pass; its shadow allowance gains the drawer shadow's exact emitted string (R30).
- **Removed styles pinned absent:** `.publish-bar` in `RunDetailPage`; the panel's `.panel-backdrop` / `.dashboard-side-panel`; the roster's `form.add-row` under the table.
- `EXPECTED_CHECKS` moves with each task; the plan lists the ladder.

## Carried to the 6c browser pass

- The Overview at a laptop width and at about 1000px; the two columns stack below 880px.
- ✎ editing in Safari (the native date field; Enter and Esc).
- Publish (mocked) and a double click; Unpublish's confirm; focus after each.
- The force delete (mocked), and the "published in the meantime" 409 (mocked).
- The roster add row, the bulk strip, a partial result (mocked), a marked row's tooltip; the table at a narrow width.
- The drawer from Progress and from Submissions; Esc with a half-written evaluation; a click on the dimmed page does nothing; Edit; earlier submissions; focus back on the cell after closing (Safari may not restore it).
- "attach PDF" in Safari (a hidden file input opened by `input.click()`).
- After a failed force delete (mocked), focus is on the box again (R45).
- VoiceOver checks (the radio group, the hidden state words, the marked-row text, the lock lines) go to the beta VoiceOver pass, not this one.
