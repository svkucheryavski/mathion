# Visual refresh — Slice 6c: Overview, Roster and the side panel

**Status:** draft, rev 1. Written 2026-10-13 for the user's review.

**Branch:** `feat/visual-refresh-slice6-teacher`, after the 6b browser pass (`a542e51`). It stays local: no push, no merge.

**Authority:**
- The design handoff `docs/design/visual-refresh/` (`mathion-visual-spec.md`, `reference-screens.dc.html`) is the design authority. Its screens 10a (Overview), 10b (Roster) and 9b (Submission thread) are the 6c screens. Image copies: `.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/ref/{10a,10b,9b}.png`.
- The user approved all three "as drawn" in the 2026-10-10 walkthrough (`.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/walkthrough.md`), with one change: the feedback file stays **required** unless the result is Accepted (9b's "optional" label is wrong). The Progress-cell variant of the side panel has no drawing; it reuses the 9b drawer shell.
- The 6a spec (`docs/superpowers/specs/2026-10-10-visual-refresh-slice6a-teacher-restyle-design.md`, rev 5) and the 6b spec (`…-slice6b-teacher-modals-design.md`, rev 4) still hold where this spec is silent: D5 (nothing that works today is dropped), D8 ("v. N"), R13 (block numbers by position), §Focus (focus never drops to `<body>`), P10 (a tab jump focuses the new tab), 6a's chip and banner tokens and one-line confirms, 6b's R16 `Switch`. So do the handoff's §1–§4 and the earlier slices' rules: tokens only, no emoji, no literal colours, every disabled control names its reason in `title`.
- `file:line` references are to the code at `a542e51`.

## Why

6a restyled the run frame and six tabs; 6b moved the four modals onto `ui/Modal`. The Overview tab, the Roster tab and the grading / progress side panel are still the pre-refresh markup: plain inputs that save on blur, a publish bar in the title row, a delete button with no danger panel, an unstyled roster table with a form under it, and a side panel of `<p>Label: value</p>` lines with its own backdrop, Esc listener and focus trap. 6c draws them as 10a, 10b and 9b and closes three items routed from 6a and 6b.

## Decisions

The user's (2026-10-12/13), continuing the Slice-6 numbering:
- **D24 — "Delete this run" deletes for real.** As 10a says ("Roster, groups and submissions go with it"), the Overview delete sends `DELETE /api/runs/{id}?force=true`, through the shared danger panel (`ui/DangerConfirm`: "I understand", then Force delete). Admin only, draft only, as today. Today the delete sends no `force` and fails with "Clear roster before deleting." when the run has students.
- **D25 — "+" opens an add row.** The Roster toolbar's **+** opens today's add form as a row under the toolbar: e-mail, the group select (groups on), Add, Cancel. The form under the table goes.
- **D26 — The submission file card shows "Submission N" and "PDF · 2.4 MB".** Original file names are not stored; the server names files `block N - group G - submission S.pdf` (`backend/mathion/api/submission_files.py:28-36`) and the thread payload has no name. No backend change.
- **D27 — The side panel is a `ui/Modal` with a right placement** (approach A of the brainstorm). It gains Modal's stack, Esc, Tab containment, scroll lock and focus return; its own backdrop, `<svelte:window onkeydown>` and `FocusTrap` go.
- The three sections below (Overview, Roster, side panel) and §Process were approved section by section on 2026-10-13.

Rulings taken at the controller's discretion (technical; the user defers these). Each states what it costs if wrong:
- **R30 — `ui/Modal` gains `placement: 'center' | 'right'`** (default `'center'`). Right: the panel is full height (`100vh`, no radius on the right edge), pinned to the right edge, `width: min(var(--modal-w), 100vw)`; the backdrop is the same. Nothing else in Modal changes; every current caller keeps `'center'`. *Cost if wrong:* a separate drawer component later.
- **R31 — `ui/InlineName` gains `type: 'text' | 'date'`** (default `'text'`) for the Overview's dates. Everything else (Enter saves, Esc cancels, nothing saves on blur, an unchanged value cancels without a request, an empty one keeps Save disabled, a failed save stays open with its error) is reused as is. *Cost if wrong:* a second field component.
- **R32 — One Overview field edits at a time.** While a field is open, the other ✎ buttons are disabled with the title "Finish editing {Field} first". This replaces today's cross-field bookkeeping in `commitField` (`RunOverviewTab.svelte:58-99`), which existed because all three inputs were live at once. *Cost if wrong:* an Esc before the next ✎.
- **R33 — Publish and Unpublish stay in `RunDetailPage`** (they own the conflicts modal and the load token, `RunDetailPage.svelte:280-346`); the Overview gets them as props. The double-click guard is a `publishing` flag in the page: `doPublish` returns at once while it is set.
- **R34 — The readiness checks are computed where they are today** (`RunDetailPage.svelte:229-270`), with one new row, "Course version enabled", taken from `showDisabledBanner`. `publishBlocked` becomes `readiness.firstViolation !== null`, since the version row is now a check like the others.
- **R35 — The Submissions tab passes the block label.** `DashboardSidePanel` gains an optional `blockLabel?: string` ("B2"), which `RunSubmissionTab` computes with the same `blockPositions(blocks)` it uses for line 2 (`RunSubmissionTab.svelte:144-147`). No label when the block is not in `blocks` (R13).
- **R36 — Discard while editing an existing evaluation ends the edit; it does not close the drawer.** That is today's `discardAndClose` (`DashboardSidePanel.svelte:383-397`). In create mode, Discard closes. *Cost if wrong:* one more Esc.
- **R37 — The Result control is four native radio buttons** in a `role="radiogroup"` fieldset with the legend "Result", styled as a segmented control. Arrow keys come from the platform. A locked result disables the three non-accepted radios with the lock text as their `title` and as the group's `aria-describedby`.
- **R38 — The roster's group select stays native.** A native `<option>` cannot mix fonts, so the count is not mono: the option text is "Group A · 7/10", and a disabled group adds " · disabled".
- **R39 — The import modal renders at page level.** `RosterImportModal` moves out of the `{:else if activeTab === 'roster'}` branch (`RunDetailPage.svelte:429-452`) to the end of the page, still gated by `showImportModal`. A tab change (Back, an address change) no longer unmounts it mid-import.

## Scope

**In 6c:**
- `components/runs/RunOverviewTab.svelte` (10a).
- `components/runs/RunRosterTab.svelte` (10b).
- `components/runs/DashboardSidePanel.svelte` and `SubmissionThreadEntry.svelte` (9b), plus two new pieces split out of the panel: `EvaluationForm.svelte` and `ProgressBreakdown.svelte`.
- `pages/runs/RunDetailPage.svelte`: the publish bar leaves the title row; Publish's guard; the version check row; the import modal at page level; the force delete.
- `components/ui/Modal.svelte` (R30) and `components/ui/InlineName.svelte` (R31).
- `components/runs/RunSubmissionTab.svelte` and `RunProgressTab.svelte`: only what they pass to the panel (R35).

**Carried in from earlier slices:**
- 6b: the run-level Publish has no in-flight guard (R33); the import modal unmounts on a tab change (R39); the Switch's disabled reason must be visible text (§Settings).
- 6a: the Unpublish confirm and the Publish ↔ Unpublish swap drop focus to `<body>` (§Focus).

**Not in 6c:** the staff e-mail links (6a backlog); the runs-list 🗑 (stays a plain delete); a backend change of any kind; the final Polish slice's items (browser `confirm()` in authoring, reduced motion).

## Overview (10a, `RunOverviewTab`)

**Layout.** Two columns (`1fr 1fr`, gap 16px) under the tab strip:
- left: the **Run details** card;
- right, stacked: **Settings**, **Publish readiness**, **Delete this run** (when shown).
- Below 880px the columns stack (left card first).
- Each card: `--surface`, 1px `--border`, the 6a card radius, a 15px semi-bold `<h2>` title. Cards size to their content; the left card does not stretch to the right column's height.

### Run details

Four label / value rows (label `--muted`, a 1px `--border-soft` line between rows), each with a ✎ `IconButton` at the right:
- **Title** — the run title. ✎ opens `InlineName` (`maxlength 200`, label "Title").
- **Start**, **End** — the date as "01 Sep 2026". ✎ opens `InlineName type="date"` (R31).
- **Version** — the pinned version's title plus a muted mono "v. N" (D8). Its ✎ is disabled with the title "The version is fixed when the run is created". If the version is missing from `versions`, the value is "v. N" alone.

Editing (R31, R32):
- ✎ swaps the value for the field; focus goes into it. Save sends `PATCH /api/runs/{id}` with that one field, then `setRun(updated)`; the row closes and focus returns to its ✎.
- Esc / Cancel closes without a request; focus returns to ✎.
- A failed save keeps the field open with the server's message under it (`InlineName`'s error line). Today's error toasts (`Could not update {field}: …`) go; the message is in place.
- Today's rules stay: the backend's errors ("end_date must be on or after start_date", the lowered-end-date-with-submissions refusal) are shown as sent.
- Teachers and admins edit, as today (`require_run_admin_or_teacher`, `backend/mathion/api/runs.py:79`).

### Settings

- "Groups enabled" with the shared `Switch` (6b R16), its visible `<label for>` and the help line "Disabling groups hides group assignments but does not delete them." (today's text) as its `aria-describedby`.
- **Published run:** the switch is disabled and a visible line under the help says why: "Locked while the run is published — unpublish to change." (admin) or "Locked while the run is published. Ask a course admin to unpublish before changing." (teacher). The line joins `aria-describedby`; the switch's `title` keeps the same text.
- **While the request runs:** the switch is `frozen` (6b R19). A failure flips it back and toasts "Could not update setting: …", as today (`RunOverviewTab.svelte:112-125`), including the 409 "Cannot disable groups; mini-projects exist".

### Publish readiness

Rows, each a 22px status box, the label, and an optional muted hint; a 1px `--border-soft` line between rows:
- ✓ ok: `--status-accepted-bg` / `-fg`;
- × violated: `--status-needs-revision-bg` / `-fg`;
- – not applicable: `--surface-2` / `--muted`, with the hint "not applicable".

The checks (R34), in this order:
1. **At least one teacher assigned** — hint when violated: "Add a teacher — open Teachers" (a link button to the Teachers tab).
2. **Course version enabled** — hint when violated: "The version is disabled — re-enable it in the course editor" (admin) / "The version is disabled — ask a course admin" (teacher).
3. **Every student assigned to a group** — hint when violated: "N unassigned — open Roster", a link button that jumps to Roster with the Unassigned filter (today's `goto-unassigned`, `RunOverviewTab.svelte:171-177`). Not applicable when groups are off.
4. **No group over 10 students** — hint when violated: today's list "Group A (12), Group C (11)". Not applicable when groups are off.

**Footer** (above it a 1px `--border` line; a muted note at the left, the action at the right):
- **Draft, admin:** "Fix the outstanding check to publish." (one violation) / "Fix the N outstanding checks to publish." with **Publish run** disabled, its title the first violation; or "Ready to publish." with **Publish run** enabled (primary).
  - A click calls the page's `onPublish` (R33). While it runs the button is busy and further clicks do nothing.
  - A 409 with conflicts opens today's `PublishConflictsModal`; other errors toast, as today.
- **Published, admin:** "Published — students have access." with **Unpublish** (secondary). Unpublish opens today's `InlineConfirm` in the footer ("Students will lose access immediately. Their progress data is preserved.", Confirm Unpublish / Cancel).
- **Teacher (not admin):** the checks, and the note "A course admin publishes this run." (draft) or "Published — students have access." (published), with no button.

The title row loses its publish bar (`RunDetailPage.svelte:367-382`) and its `.publish-bar` style.

### Delete this run (D24)

Shown to admins on a draft run, as today (`RunOverviewTab.svelte:184-198`).
- The card: the title "Delete this run", the muted line "Only while unpublished. Roster, groups and submissions go with it.", and a 🗑 `IconButton` ("Delete this run") at the right.
- 🗑 opens `DangerConfirm` inside the card, with the message "This deletes the run with its roster, groups, mini-projects, submissions and evaluations. It cannot be undone." Force delete sends `DELETE /api/runs/{id}?force=true` (`deleteRun(runId, { force: true })`, a new optional argument in `lib/runs.ts`).
- Success: navigation to `/teaching/{slug}`, as today (`RunDetailPage.svelte:304-319`).
- Failure: the toast with the server's message; the panel stays open and re-arms (`DangerConfirm` un-ticks).
- Cancel closes the panel; focus returns to 🗑.

## Roster (10b, `RunRosterTab`)

**Draft run.** Today's banner ("Publish this run before adding students. You can still move or remove students already on the roster." + "Publish on Overview") stays above the toolbar, restyled as the 6a precondition banner (`--status-needs-revision-bg`, 3px `--gold` left rule).

**Toolbar** (one row, wraps below 760px):
- left: the search field (`ui/Input`, placeholder "Search name or email…", 280px) and, when the Unassigned filter is on, the chip **Unassigned (N) ×** (`--surface-2`, a pill; × is "Clear filter");
- right: **Import roster** (secondary `Button`) and **+** (primary `IconButton`, "Add student").
- On a draft run, Import roster and + are disabled, with `aria-describedby` the banner and the title "Publish this run before adding students".

**Add row (D25).** + opens a row under the toolbar (`--surface-2`, the 6a add-row look):
- the e-mail `Input` (type email, `maxlength 254`, placeholder "student@example.com"), the group select (groups on; enabled groups only, "Unassigned" first), **Add** (primary) and **Cancel**;
- focus goes to the e-mail field; Enter submits; Add is disabled while the e-mail is empty or the request runs;
- success: the field empties, the group resets to Unassigned, the roster refetches, focus returns to the e-mail field; the row stays open;
- today's duplicate check ("{email} is already enrolled. Edit their group in the table.") and server errors show under the row (`role="alert"`, the 6a error line), and the e-mail field gets `aria-invalid`;
- Esc (in the row) or Cancel closes it and returns focus to +;
- + while the row is open moves focus to its e-mail field.

**Empty roster:** the 6a `EmptyState` "No students yet." with two link buttons, "Import roster" and "Add student" (both disabled on a draft run). "Import roster" keeps 6b's `openImportFromLink` focus hand-off to the toolbar button.

**Bulk strip** (when anything is selected; `--surface-2`, 1px `--border`, radius):
- "N selected" (semi-bold), plus " (M visible)" while the search or filter hides some;
- "Move to group…" select (groups on), today's options and reset-after-change;
- 🗑 (`IconButton`, "Delete selected"), which turns the strip's right part into the one-line confirm: "Delete N students?" Cancel / **Delete** (danger). Delete runs today's bulk delete;
- "Clear selection" (text button) at the right.
- While a bulk op runs, the select and 🗑 are disabled, as today.

**Result banner** (today's `bulkOpResult`, `RunRosterTab.svelte:85-118`):
- success: `--status-accepted-bg` with a 3px `--success` rule; "Moved 36 of 36 — 0 failed."; closes itself after 5 s, as today;
- partial / cancelled: `--status-needs-revision-bg` with a 3px `--gold` rule; today's text plus " Hover a marked row for the reason.";
- at the right: today's retry controls ("Retry N → group…" select, "Retry N delete", "Retry cancelled") as text-styled controls, then "Dismiss".

**Table** (6a table look: `--surface`, header `--surface-2`, 1px `--border-soft` row lines):
- columns: a checkbox (header box selects all visible, indeterminate as today), Email, Full name ("—" when empty), Group (groups on), and the row's 🗑;
- Group: today's native select (R38), disabled while that row's request runs; a failure toasts, as today;
- a marked row (failed its last bulk op) gets a 3px `--danger` left rule (an inset box-shadow on its first cell), keeps its reason as the row `title`, and gets a visually hidden "Failed: {reason}" in the Email cell;
- 🗑 opens a one-line confirm row under its row (6a's plain delete confirm): "Remove {email} from this run?" Cancel / **Remove**. Success refetches; failure toasts, as today.

**No match:** today's "No students match '…'. Clear search." and "No students are unassigned. Clear filter." as muted lines with link buttons.

**Import modal (R39):** opened from Import roster or the empty state, rendered at page level.

## Side panel (9b, `DashboardSidePanel`)

### Frame (D27, R30)

- `ui/Modal` with `placement="right"`, `width={560}`, `closeOnBackdrop` (a click on the dimmed page closes, as today), `labelledby` the panel title.
- **Header:** the title (`<h2>`, 17px semi-bold) and a mono `--muted` subtitle under it; at the right the status badge, then Modal's ×.
- **Body:** cards with 16px between them; the body scrolls.
- **Closing:** Esc, × and the dimmed page call the panel's `tryClose` (`DashboardSidePanel.svelte:374-381`): nothing while a save runs (`closeDisabled`); the discard confirm when the form is dirty; otherwise close.
- **Discard confirm:** Modal's footer, shown only while asking: "Discard unsaved changes?" Cancel / **Discard** (R36 for what Discard does). Focus goes to Cancel; Cancel returns focus to the form.
- **Focus:** on open, the first Result radio when the form shows, otherwise ×. On close, focus returns to the cell that opened it (Modal's `FocusTrap`).
- `DirtyGuard` stays, so a reload with a half-written evaluation asks (6a D10).

### Submission variant

**Header:** the mini-project title; subtitle "{Group} · {B2} · {Block title}" (the B-label only when passed, R35); the badge is today's `panelStatus`.

**Not submitted yet:** one muted line.

**Latest submission card:**
- head: "Latest submission", and at the right the chips "resubmission" (`--surface-2` / `--muted`) and "late" (`--gold-soft` / `--gold-text`) when they apply;
- rows: Submitted (`formatLocalWithTz`), By (the name, or "—"), Number;
- the file card (D26): a 36px "PDF" tile (`--surface-2`, mono), "Submission N", mono "PDF · 2.4 MB" (`formatFileSize`), and a ⤓ `IconButton` link ("Download submission N") to `/api/submissions/{id}/file`.

**Evaluate card** (can grade, no evaluation yet; `--primary` 1px border, a `--primary-soft` head):
- **Result** (R37): Accepted · Minor revision · Major revision · Rejected, none selected at first. The "(required)" helper and the inline "Result is required." error stay.
- **Feedback** (textarea, `maxlength 1000`) beside **Score** (number 0–100, 120px). Under the feedback, today's counter "N / 1000" with " — approaching limit" and its polite live region. "(required)" shows after Feedback unless Accepted, as today.
- **Feedback file:** the label "Feedback file (required)" unless Accepted, else "Feedback file (optional)"; an "attach PDF" link button opens the file picker (a visually hidden native file input with its own label); a chosen file shows as a file card (name, size) with a remove ×. "PDF only, max 20 MB." and today's size / type errors stay.
- **Footer of the card:** a server error (`role="alert"`, the 6a error banner) above it; **Save evaluation** (primary, busy while saving) at the right; "Cancel upload" beside it while a save runs (today's abort).
- What is sent, the 60 s timeout, the race handling and the refetches are unchanged.

**Already evaluated (not a resubmission):**
- an **Evaluation** card, read-only: Result (the status badge), Score ("—" when empty), Feedback (pre-wrapped text, or "—"), Evaluated (by, when; "You · just now" before the refetch, as today), and the feedback file card with ⤓ when there is one;
- **Edit** (secondary `Button`) in the card head, for people who can grade. It turns the card into the Evaluate form, pre-filled, with **Save evaluation** and **Cancel**. Edit keeps today's rules: no file field ("Existing feedback file uploaded — replace not supported." when there is one), and the result is locked to Accepted when there is no file (R37).

**Auto-accepted resubmission:** today's info line "Auto-accepted on resubmission. No manual evaluation needed." (`--status-awaiting-eval-bg` with a 3px `--primary` rule), then the read-only Evaluation card without Edit.

**Can't grade:** the read-only cards; "Awaiting evaluation" as a muted line where the form would be.

**Earlier submissions** (only when the thread has more than one):
- a card with the head "Earlier submissions" and the count at the right;
- each row is `SubmissionThreadEntry`, restyled: a disclosure button "› Submission 2  02 Aug 2026" (date mono) with the result badge at the right, `aria-expanded`; opened, it shows the same read-only Submission and Evaluation cards (no Edit);
- "Loading earlier submissions…" and "Couldn't load submission history. Retry" sit inside the card.

### Progress variant (no drawing)

- Header: the student's name (or e-mail); subtitle "{Block title} — {Sequence title}".
- One **Items** card: per item a 22px box (✓ covered, `--status-accepted-*`; ○ not, `--surface-2`), the title, a type chip (`--surface-2`, mono), and the last score "3/4" (mono) at the right.
- "Loading…", the error banner, and "No items in this sequence." restyled.
- No badge in the header.

### Code split

- `EvaluationForm.svelte` — the one form for create and edit (today two near-copies, `DashboardSidePanel.svelte:601-664` and `:670-735`). It takes the form state and handlers from the panel as props; it holds no request logic.
- `ProgressBreakdown.svelte` — the Items card, from today's `:510-534`.
- `SubmissionThreadEntry.svelte` — restyled; its read-only cards are shared with the panel through two small snippets in a new `SubmissionCards.svelte` (`SubmissionCard`, `EvaluationCard`), so the latest and the earlier entries look the same.
- `DashboardSidePanel.svelte` keeps the fetches, the evaluation state machine and the dirty / discard logic. Its props stay as they are, plus `blockLabel` (R35); the Progress and Submissions tabs call it as today.

## Focus

6a §Focus holds. In 6c:
- **Overview fields:** after Save or Cancel, focus returns to the row's ✎.
- **Publish:** after a successful publish, focus goes to Unpublish (it replaces Publish). After a failed publish it stays on Publish run. After the conflicts modal closes, it returns to Publish run (its opener).
- **Unpublish:** opening the confirm focuses its Cancel (`InlineConfirm`). Cancel → Unpublish. Confirm success → `focusFirst([Publish run, the readiness card's <h2>])`: Publish run when it is enabled; a disabled one cannot take focus, so the heading (`tabindex="-1"`) takes it. A failed unpublish → Unpublish.
- **Delete this run:** `DangerConfirm` focuses its box; Cancel → 🗑.
- **Roster:** + → the e-mail field; closing the row → +. A row's confirm focuses Cancel; Cancel → the row's 🗑; Remove → the next row's 🗑, else the search field. The bulk confirm focuses Cancel; Cancel → the strip's 🗑; Delete → the search field.
- **Side panel:** §Frame.

## Code changes

- **Changed:** `components/runs/{RunOverviewTab,RunRosterTab,DashboardSidePanel,SubmissionThreadEntry,RunSubmissionTab,RunProgressTab}.svelte`; `pages/runs/RunDetailPage.svelte`; `components/ui/{Modal,InlineName}.svelte`; `lib/runs.ts` (`deleteRun` option).
- **New:** `components/runs/{EvaluationForm,ProgressBreakdown,SubmissionCards}.svelte`.
- **Tests:** the existing files (`RunOverviewTab`, `RunOverviewTab.checklist`, the six `RunRosterTab.*`, `DashboardSidePanel`, `SubmissionThreadEntry`, `RunDetailPage.publish`, `RunDetailPage.tabs`, `RunSubmissionTab`, `RunProgressTab`, `Modal`, `InlineName`) change where markup changes; new files for `EvaluationForm` and `ProgressBreakdown`.
- **No backend change.**

## Process

As in 6b (the per-task loop):
1. TDD per step.
2. vitest (exit 0, no "Errors" / "Unhandled" line).
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
1. Overview: layout, Run details (R31, R32) and Settings.
2. Overview: Publish readiness with Publish / Unpublish (R33, R34), Delete this run (D24); the publish bar leaves the title row.
3. Roster: banner, toolbar, + and the add row (D25), empty states, the import modal at page level (R39).
4. Roster: bulk strip and its confirm, the result banner, the table (R38), marked rows, the row confirm.
5. Drawer: `Modal` placement (R30), the panel on Modal (D27), the discard footer, the header, `ProgressBreakdown`.
6. Submission variant: `SubmissionCards`, `EvaluationForm` (R37), the Evaluation card with Edit, earlier submissions, `blockLabel` (R35).

## Testing

Each task adds or changes tests first. The cases that must exist:

**Overview**
- ✎ Title opens the field with focus in it; Enter sends one PATCH with `{title}` and closes; focus is on ✎.
- Esc closes without a request; an unchanged value closes without a request.
- A failed save keeps the field open with the server text; no toast.
- Start / End use `type="date"`; the end-before-start 422 text shows under the field.
- While one field is open, the other ✎ are disabled with "Finish editing … first".
- Version's ✎ is disabled with its title; the value shows the version title and "v. N".
- The switch is disabled on a published run with the visible lock line (admin and teacher texts), and the line is in its `aria-describedby`.
- The four readiness rows in order with their states; groups off → two "not applicable" rows; a disabled version → row 2 violated and Publish run disabled with that title.
- "N unassigned — open Roster" jumps to Roster with the filter (and focuses the tab, P10).
- Publish run: two clicks while the first request runs send one POST.
- Publish success → Unpublish focused. Unpublish confirm → Publish run focused; Cancel → Unpublish focused.
- A teacher sees the checks and "A course admin publishes this run." with no button.
- Delete: 🗑 opens the danger panel; Force delete is inert until "I understand"; it sends `DELETE …?force=true`; success navigates; failure toasts and re-arms.
- The title row has no publish bar.

**Roster**
- + opens the add row with focus on e-mail; Esc / Cancel closes and focuses +.
- Add success empties the field, keeps the row open, refetches, refocuses e-mail.
- The duplicate check and a server error show under the row; `aria-invalid` on e-mail.
- On a draft run + and Import roster are disabled and described by the banner.
- The bulk 🗑 confirm says "Delete N students?"; Delete runs the bulk delete; Cancel → 🗑.
- The banner: success green and gone after 5 s; partial gold with the hover hint and the retry select; Dismiss.
- A marked row has the class for the red rule, the `title`, and the hidden "Failed: …" text.
- Group options read "Group A · 7/10" and " · disabled".
- The row confirm says "Remove {email} from this run?"; Remove → next row's 🗑 focused.
- **R39:** with the import modal open, an address change to `?tab=overview` keeps the modal mounted.

**Side panel**
- It renders inside `.modal-panel` with the right placement; Esc, × and a backdrop click close a clean panel; a dirty one shows the footer confirm with focus on Cancel.
- Discard in create mode closes; while editing, it ends the edit (R36).
- Nothing closes while a save runs.
- The header subtitle with and without `blockLabel`.
- The file card: "Submission 3", "PDF · 2.4 MB", the download link.
- Result radios in the drawn order, none checked; a locked result disables three radios with the lock text.
- The feedback-file label says "(required)" unless Accepted.
- Edit pre-fills the form; Cancel returns to the read-only card.
- Earlier submissions: the count, a row toggles with `aria-expanded`.
- The Progress variant: name, "Block — Sequence", the Items rows.
- Every existing behaviour test of the panel (create, edit, abort, timeout, race, thread refetch) still passes with selectors updated, not removed.

## Gate

- **A `FILES_6C` list:** the changed and new components (`RunOverviewTab`, `RunRosterTab`, `DashboardSidePanel`, `SubmissionThreadEntry`, `EvaluationForm`, `ProgressBreakdown`, `SubmissionCards`). It runs the `emoji_scan` and `colour_scan` over them, in the style of 6b's (ak). Each file joins the list in the task that restyles it.
- **New section (al)** with `own` / `uniq1`, `d` / `chk` rows and the `sweep` for the new classes, and pins for:
  - the Overview's two columns and the 880px stack;
  - the readiness status boxes (ok / violated / n.a. tokens);
  - the roster's marked-row rule and the two banner tints;
  - the drawer: `placement="right"` geometry (full height, right edge, width 560);
  - the Evaluate card's border and head tint; the segmented Result's checked state;
  - the file card tile.
- **Removed styles pinned absent:** `.publish-bar` in `RunDetailPage`; the panel's `.panel-backdrop` / `.dashboard-side-panel`; the roster's `form.add-row` under the table.
- `EXPECTED_CHECKS` moves with each task; the plan lists the ladder.

## Carried to the 6c browser pass

- The Overview at a laptop width and at about 1000px; the two columns stack below 880px.
- ✎ editing in Safari (the native date field; Enter and Esc).
- Publish (mocked) and the double click; Unpublish's confirm; focus after each.
- The force delete (mocked).
- The roster add row, the bulk strip, a partial result (mocked), a marked row's tooltip.
- An import started, then Back: the modal stays.
- The drawer from Progress and from Submissions; Esc with a half-written evaluation; Edit; earlier submissions.
- VoiceOver checks (the radio group, the marked-row text, the lock line) go to the beta VoiceOver pass, not this one.
