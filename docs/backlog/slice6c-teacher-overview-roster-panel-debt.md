# Slice 6c — Overview, Roster and the side panel: debt and deferred minors

Spec: `docs/superpowers/specs/2026-10-13-visual-refresh-slice6c-teacher-overview-roster-panel-design.md`.
Plan: `docs/superpowers/plans/2026-10-13-visual-refresh-slice6c-teacher-overview-roster-panel.md`.

Review minors and browser-pass findings, by task. Each entry says where it lives and what fixing it would take.

## Task 1 — Overview details and settings

- **Switch failure without an `ApiError` is silent** (`RunOverviewTab.svelte`, `toggleGroups`): a network `TypeError` sets the switch back but toasts nothing. Same as before 6c. Fix: an `else pushToast('Could not update setting.', 'error')`.
- **Backend: a PATCH of only `start_date` past `end_date` is accepted** (`backend/mathion/api/runs.py:91-93` compares the new end against the old start only). Pre-existing; the per-field editor makes it as easy as before. Fix: compare against `updates.get("start_date", run.start_date)` and add a test.
- **Leaving mid-save resets the Overview's lock** (by design, Review Focus 1): a remounted Overview can start a second write while the first is in flight, and a failure of the first is lost (its `InlineName` is gone). Fix if it bites: lift the in-flight flag to the page, as Task 2 does for publish.
- **A 422 field list reads "Please correct the highlighted fields."** (only for a date the server cannot parse, e.g. a 6-digit year). The first item's `msg` would read better.
- **Narrow phones:** `.ov-row` is 132px + 1fr + 54px, so at 375px an open date editor gets about 75px and the native date control clips. The spec defines only the 880px stack. Fix in Polish: `minmax(84px, 132px)` for the label column, or a ≤480px rule that puts the label on its own line.
- **After a save, focus returns to ✎ even if the teacher tabbed away during the request.** Consistent with 6a §Focus ("back to the control that started the action"); noted so the browser pass expects it.
- **The R32 "Wait for the current change to save" line under an open field uses the error path** (review fix in Task 1): the field gets `aria-invalid` and the red line, and the line stays after the switch settles until the teacher types or saves. Check in the browser pass; a neutral hint style would read better.
- **Test tightening (optional):** in that R32 test, `field(target)!.focus()` before Enter makes the focus assertion self-fulfilling; asserting `readOnly === false` and `value === 'Summer'` after the error would pin "the field is live with its text" directly.

## Task 2 — Readiness, publish and delete

- **Network failures on Publish / Unpublish are silent.** `doPublish` / `doUnpublish` in `RunDetailPage.svelte` toast only for an `ApiError`. A `TypeError` (offline) returns `'failed'` with no message: the button stops spinning, or the confirm closes, with no reason given. This predates 6c. Fix: an `else` toast "Could not publish the run." / "Could not unpublish the run.".
- **The Unpublish confirm's own Unpublish says nothing during a field save.** With the confirm open, a teacher can still ✎ a field and press Enter. While that PATCH runs, the confirm's Unpublish returns without a word: it isn't greyed and has no title. R32 names only the footer Unpublish. Fix: a disabled reason passed through `InlineConfirm`, or close the confirm when a field save starts.
- **🗑 still closes the open panel while it is `aria-disabled`** during a field save or the switch request. `toggleDelete`'s close branch runs before the `runWrite` guard. This is harmless, since no delete request is running, but R44 says the handler returns at once. Fix: guard the close branch with `runWrite` too.
- **Focus can drop to `<body>` after a failed publish whose refetch reveals a new violation** (e.g. the last teacher was removed elsewhere). Publish run becomes natively disabled and loses focus. The case is rare. Fix: on `'failed'`, `await tick(); if (publishBlocked) focusFirst([readyHead]);`.
- **Backend: the published check reads the row loaded before the advisory locks** (`api/runs.py`, delete). The window against a concurrent publish is accepted per D28 and documented in the comment. A `db.refresh(run)` after the lock loop would narrow it at no cost.

## Task 3 — Roster toolbar and add row

- **Close requests are ignored silently while an add runs.** During the POST and its refetch, the toggle ×, Cancel and Esc in the row do nothing, and nothing says why (`closeAdd` returns while `adding`). They are not `aria-disabled`. Fix as R44 does elsewhere: `aria-disabled={adding}` and the title "Wait for the current change to finish" on Cancel and the toggle.
- **Esc in the group select may close the whole add row.** The form's keydown also catches an Esc that comes from the `<select>`. A native popup usually swallows the key, so check this in the browser pass. Fix: ignore the event when its target is the select. Safari pass: Safari's popup swallows Esc and the row stays open; other browsers are still unchecked.
- **The add error stays while the teacher edits the address.** There is no `oninput` clear, so the error line and the red edge stay until the next submit. This predates 6c. Fix: clear `addError` on input.
- **Pre-existing error-path gaps in `submitAdd`:**
  - an add that succeeds but whose refetch fails shows the refetch error under the row, as if the add had failed, after the field was already emptied;
  - a network `TypeError` says nothing.
  
  Fix: refetch outside the add's error branch, and add an `else` with a generic message.
- **The open add row unmounts under focus if the run turns draft** (a refetch after another session unpublished it). Focus falls to `<body>`, since the toggle is disabled by then. Only reachable across sessions.
- **No success announcement after an add.** The row just clears, with focus back in the e-mail field. Collect for the VoiceOver pass at beta.
- **Untested:** `open-add-link` while the row is already open (it only refocuses the e-mail field).
- **The `IconButton` link variant** never binds `element`, which is typed `HTMLButtonElement`. It does not pass `tabindex` or `aria-hidden` either. Task 6's download link needs none of these. Document or widen this if a later caller needs them.

## Task 4 — Roster strip, result banner, table and confirms

- **A bulk op can stick on "Moving N…"** (`dispatchBulkOp`). The page's `refetchRosterData` throws on a network error, and the refetch after the ops is not guarded. If the ops succeed but the refetch fails:
  - the promise rejects unhandled;
  - the banner stays "Moving N…" with no Dismiss;
  - every bulk and retry control stays locked until a reload.
  
  This predates 6c. Fix: wrap the refetch in `try/catch` so the result still settles.
- **A stale `pendingDelete` reopens the row confirm and steals focus** when that student comes back. Sequence: the row confirm is open, the student is bulk-removed, then they are re-added later; the confirm row renders again and `takeFocus` moves focus to its Cancel. Fix: clear `pendingDelete` in the `students` effect when its id is no longer on the roster.
- **Cancel during a slow row Remove is overridden.** The confirm shows no busy state while the DELETE runs. Clicking Cancel puts focus on the row's 🗑, but the success chain then moves it to the next row's 🗑. A second Remove is ignored silently.
- **Other rows' 🗑 are ignored silently while a remove runs** (`askRemove` returns). They have no `aria-disabled` or reason. R44 names only the strip 🗑.
- **Row actions and the add row are not blocked during a bulk op.** This applies to the row 🗑, the row group select and Add. It matches today's behaviour, and the spec doesn't ask for more. The server stays consistent and the last refetch wins.
- **The row group select is natively `disabled` while its request runs,** so a keyboard user's focus drops to `<body>`. This predates 6c and the spec says "disabled while that row's request runs". Check it in the VoiceOver pass at beta.
- **The strip can count a student whose row a refresh removed** ("1 selected" with no row). Found in plan review; this predates 6c.
- **The roster's strip-gone focus fallback is unreachable today,** because failed rows stay selected, so the strip stays up. The comment says so; there is no test.

## Task 5 — Side panel frame and Progress view

- Fixed in the Safari pass (spec rev 8): ~~**Discard Cancel can leave focus on `<body>`**~~. `askDiscard` no longer saves `<body>`; Cancel falls back to the form's Cancel, then the checked Result radio, then ×.
- **× while the confirm asks always moves focus to its Cancel,** even when the confirm came from the form's Cancel (source `cancel`). This is what the spec says, but to close, a teacher must press Cancel, then ×, then Discard. A cheaper path: re-arm the confirm with source `close`. This is a design note.

## Task 6 — Submission cards and evaluation form

- **Save's title says "Attach the feedback PDF" in a locked edit,** but the edit form has no attach control. Sequence: edit an evaluation with no feedback file and a non-accepted result; Save stays disabled (today's behaviour, as the spec says) until Accepted is picked. Fix: in edit mode, use the lock text (or "Choose Accepted") as the title.
- **The feedback-file error is not in the attach button's `aria-describedby`.** "Only PDF files accepted." is announced once (role=alert). When focus returns to "attach PDF", the error isn't read again. Fix: give the `<p>` an id and add it to the describedby while the error shows, as the Score and Feedback fields do. Check in the VoiceOver pass at beta.
- **T25's closing `evalCalls(...).toHaveLength(0)` is vacuous now:** nothing dispatches a submit, so it can't fail. `checkedResult() === 'accepted'` carries the intent. Fix: drop that assertion and the stale "Save guarded" comment.
- **T19b's `toContain('accepted')` is always true,** because the auto-accept banner contains "Auto-accepted". Fix: assert the card's badge text "Accepted".
- **The prefill effect re-runs when `effectiveEvaluation` changes identity mid-edit** (this predates 6c). A thread that lands after an early Edit, or a grid refresh that refetches the thread, re-fills the form over in-progress edits. Focus also jumps back to the checked radio.
- Fixed in the Safari pass (spec rev 8): ~~**A 409 doesn't reset the form**~~. The 409 branch now resets it, and × asks about unsaved edits only while the form is on screen.
- **Focus drops to `<body>` when the first thread load replaces a focused create form** (Safari-pass review, both lanes). For example, the confirm is open from a stale cell and the thread brings an evaluation: the form and the confirm go, and focus is left on `<body>` inside the drawer. Tab re-enters the drawer, so this is no trap; a focused field already did this before 6c. Fix: after the form goes, focus the Evaluation heading, else ×.
- **"Result is required." is effectively unreachable,** because Save is natively disabled whenever the form is invalid (this predates 6c).
- **After a PATCH, the "Evaluated" line names the previous evaluator** until the refetch lands (this predates 6c).
- **The `awaiting-evaluation-placeholder` hook repeats inside opened earlier submissions,** so `querySelector` returns whichever comes first. The tests scope it today.
- **Seen in the screenshot pass:** the "Evaluation saved; group notified" toast covers the panel's status badge and × for a few seconds. The toast position is outside this slice.

## Whole-branch review (9aec18e..5aaba37)

Fixed: **a late Overview save no longer overwrites another run** (Fable, Important). `setRun` now ignores a response whose `id` is not the current run, so a field or groups PATCH that lands after Back/Forward to another run can't put the old run's data on the new run's page.

Deferred minors:
- **A long e-mail doesn't wrap in two places:** the row-confirm warning "Remove {email} from this run?" (`InlineConfirm`'s `.warning`) and the add-row error `.ro-err`. With an e-mail that has no break points, the table grows past its column and Remove/Cancel move right inside the scroll wrapper. Fix: `overflow-wrap: anywhere` on `.ro-err` and on a wrapper around the confirm warning.
- **A failed forced delete is lost when the admin has left the Overview.** The `'failed'` outcome only shows in the Overview's card, which is gone after the remount. `localWrite` resets, so a second DELETE can start. Fix: a toast in `onDeleteRun`'s failure branch, or a page-level `deleting` flag.
- **`onDeleteRun` navigates without a load-token check.** If the admin moves to another run while the DELETE runs, success still sends them to the course page. Fix: `if (myToken === loadToken)` before the navigation.
- **A delete that returns 404** (the run was deleted elsewhere) re-arms the panel with "Run not found". Kinder: take the "Run deleted." path.
- **A network failure under an Overview field shows the browser's raw text** ("Failed to fetch" / "Load failed") from `InlineName`'s `e.message` branch. Fix: show `ApiError.displayMessage`, else "Could not save.", and keep the raw text only for the R32 wait constant.
- **A busy Publish has no reason `title`** (R44 asks for one); the visible "Publishing…" covers sighted users.
- **The Version row's disabled ✎ has no `aria-label`,** so its name is the reason sentence. Fix: `aria-label="Edit the version"`, or check it in the VoiceOver pass at beta.
- **Nits:** a stale "else Save evaluation" comment in `DashboardSidePanel.svelte` (~441); `NOUN` duplicates `FIELDS[].noun` in `RunOverviewTab.svelte`.

## Safari pass (2026-10-13/14)

Every step was run on a console mock that answers every write, so no dev data changed. Steps 1-17 passed: the Overview fields, Unpublish, force delete (fail and 409), roster add and bulk move, Publish double-click, the Progress drawer, the discard confirm, Edit, earlier submissions, attach PDF and Save. The fixes it led to:
- `e3186cd` (spec rev 7): a marked roster row fixed by hand loses its mark, and Dismiss clears every mark (user decision).
- `04016d5` (spec rev 8): the drawer's discard confirm sits in the form's button row, because the teacher missed it at the drawer's edge (user decision). Closing asks only while the form is on screen, and a 409 clears the lost edits.
- `80dd43a`: a Safari click on blank drawer space focuses the panel itself, so the panel is no return target for the confirm's Cancel.

Known and as specified: Safari shows no focus ring after a mouse click, Tab skips buttons by default, and focus after the drawer closes by a mouse click is `<body>`.

## For the Polish slice (user, 6c Safari pass)

- **FIRST ITEM: confirms as real small buttons, and a crimson danger red.** Every confirm that asks (`InlineConfirm`: "Discard unsaved changes?", Unpublish, the roster row and bulk confirms; and `DangerConfirm`) shows its action and Cancel as real buttons with a lower height and smaller padding: red for the action, grey for Cancel. Every danger button and error uses a stronger red, like crimson (the `--danger` token and its uses). Check this on every screen that uses them (6a, 6b and 6c), with screenshots and a review.
