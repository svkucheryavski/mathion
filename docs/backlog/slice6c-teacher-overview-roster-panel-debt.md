# Slice 6c — Overview, Roster and the side panel: debt and deferred minors

Spec: `docs/superpowers/specs/2026-10-13-visual-refresh-slice6c-teacher-overview-roster-panel-design.md`.
Plan: `docs/superpowers/plans/2026-10-13-visual-refresh-slice6c-teacher-overview-roster-panel.md`.

Review minors and browser-pass findings, by task. Each entry says where it lives and what fixing it would take.

## Task 1 — Overview details and settings

- **Leaving mid-save resets the Overview's lock** (by design, Review Focus 1): a remounted Overview can start a second write while the first is in flight, and a failure of the first is lost (its `InlineName` is gone). Fix if it bites: lift the in-flight flag to the page, as Task 2 does for publish.
- **A 422 field list reads "Please correct the highlighted fields."** (only for a date the server cannot parse, e.g. a 6-digit year). The first item's `msg` would read better.
- **After a save, focus returns to ✎ even if the teacher tabbed away during the request.** Consistent with 6a §Focus ("back to the control that started the action"); noted so the browser pass expects it.
- **The R32 "Wait for the current change to save" line under an open field uses the error path** (review fix in Task 1): the field gets `aria-invalid` and the red line, and the line stays after the switch settles until the teacher types or saves. Check in the browser pass; a neutral hint style would read better.
- **Test tightening (optional):** in that R32 test, `field(target)!.focus()` before Enter makes the focus assertion self-fulfilling; asserting `readOnly === false` and `value === 'Summer'` after the error would pin "the field is live with its text" directly.

## Task 2 — Readiness, publish and delete

- **The Unpublish confirm's own Unpublish says nothing during a field save.** With the confirm open, a teacher can still ✎ a field and press Enter. While that PATCH runs, the confirm's Unpublish returns without a word: it isn't greyed and has no title. R32 names only the footer Unpublish. Fix: a disabled reason passed through `InlineConfirm`, or close the confirm when a field save starts.
- **🗑 still closes the open panel while it is `aria-disabled`** during a field save or the switch request. `toggleDelete`'s close branch runs before the `runWrite` guard. This is harmless, since no delete request is running, but R44 says the handler returns at once. Fix: guard the close branch with `runWrite` too.
- **Backend: the published check reads the row loaded before the advisory locks** (`api/runs.py`, delete). The window against a concurrent publish is accepted per D28 and documented in the comment. A `db.refresh(run)` after the lock loop would narrow it at no cost.

## Task 3 — Roster toolbar and add row

- **Close requests are ignored silently while an add runs.** During the POST and its refetch, the toggle ×, Cancel and Esc in the row do nothing, and nothing says why (`closeAdd` returns while `adding`). They are not `aria-disabled`. Fix as R44 does elsewhere: `aria-disabled={adding}` and the title "Wait for the current change to finish" on Cancel and the toggle.
- **Esc in the group select may close the whole add row.** The form's keydown also catches an Esc that comes from the `<select>`. A native popup usually swallows the key, so check this in the browser pass. Fix: ignore the event when its target is the select. Safari pass: Safari's popup swallows Esc and the row stays open; other browsers are still unchecked.
- **An add that succeeds but whose refetch fails** shows the refetch error under the row (`submitAdd`), as if the add had failed, after the field was already emptied. Pre-existing. Fix: refetch outside the add's error branch. (Its network half, "a `TypeError` says nothing", was fixed in Polish 3 Task 8.)
- **No success announcement after an add.** The row just clears, with focus back in the e-mail field. Collect for the VoiceOver pass at beta.
- **Untested:** `open-add-link` while the row is already open (it only refocuses the e-mail field).
- **The `IconButton` link variant** never binds `element`, which is typed `HTMLButtonElement`. It does not pass `tabindex` or `aria-hidden` either. Task 6's download link needs none of these. Document or widen this if a later caller needs them.

## Task 4 — Roster strip, result banner, table and confirms

- **A stale `pendingDelete` reopens the row confirm and steals focus** when that student comes back. Sequence: the row confirm is open, the student is bulk-removed, then they are re-added later; the confirm row renders again and `takeFocus` moves focus to its Cancel. Fix: clear `pendingDelete` in the `students` effect when its id is no longer on the roster.
- **Cancel during a slow row Remove is overridden.** The confirm shows no busy state while the DELETE runs. Clicking Cancel puts focus on the row's 🗑, but the success chain then moves it to the next row's 🗑. A second Remove is ignored silently.
- **Other rows' 🗑 are ignored silently while a remove runs** (`askRemove` returns). They have no `aria-disabled` or reason. R44 names only the strip 🗑.
- **Row actions and the add row are not blocked during a bulk op.** This applies to the row 🗑, the row group select and Add. It matches today's behaviour, and the spec doesn't ask for more. The server stays consistent and the last refetch wins.
- **The row group select is natively `disabled` while its request runs.** Since Polish 3 F8 focus comes back to it when the request lands, but it is on `<body>` meanwhile. Check what VoiceOver announces in the VoiceOver pass at beta.
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
- Fixed in the Safari pass (spec rev 8): ~~**A 409 doesn't reset the form**~~. The 409 branch now resets it, and × asks about unsaved edits only while the form is on screen.
- **"Result is required." is effectively unreachable,** because Save is natively disabled whenever the form is invalid (this predates 6c).
- **After a PATCH, the "Evaluated" line names the previous evaluator** until the refetch lands (this predates 6c).
- **The `awaiting-evaluation-placeholder` hook repeats inside opened earlier submissions,** so `querySelector` returns whichever comes first. The tests scope it today.
- **Seen in the screenshot pass:** the "Evaluation saved; group notified" toast covers the panel's status badge and × for a few seconds. The toast position is outside this slice.

## Whole-branch review (9aec18e..5aaba37)

Fixed: **a late Overview save no longer overwrites another run** (Fable, Important). `setRun` now ignores a response whose `id` is not the current run, so a field or groups PATCH that lands after Back/Forward to another run can't put the old run's data on the new run's page.

Deferred minors:
- **A failed forced delete is lost when the admin has left the Overview.** The `'failed'` outcome only shows in the Overview's card, which is gone after the remount. `localWrite` resets, so a second DELETE can start. Fix: a toast in `onDeleteRun`'s failure branch, or a page-level `deleting` flag.
- **`onDeleteRun` navigates without a load-token check.** If the admin moves to another run while the DELETE runs, success still sends them to the course page. Fix: `if (myToken === loadToken)` before the navigation.
- **A delete that returns 404** (the run was deleted elsewhere) re-arms the panel with "Run not found". Kinder: take the "Run deleted." path.
- **A busy Publish has no reason `title`** (R44 asks for one); the visible "Publishing…" covers sighted users.
- **The Version row's disabled ✎ has no `aria-label`,** so its name is the reason sentence. Fix: `aria-label="Edit the version"`, or check it in the VoiceOver pass at beta.
- **Nits:** a stale "else Save evaluation" comment in `DashboardSidePanel.svelte` (~441); `NOUN` duplicates `FIELDS[].noun` in `RunOverviewTab.svelte`.

## Safari pass (2026-10-13/14)

Every step was run on a console mock that answers every write, so no dev data changed. Steps 1-17 passed: the Overview fields, Unpublish, force delete (fail and 409), roster add and bulk move, Publish double-click, the Progress drawer, the discard confirm, Edit, earlier submissions, attach PDF and Save. The fixes it led to:
- `e3186cd` (spec rev 7): a marked roster row fixed by hand loses its mark, and Dismiss clears every mark (user decision).
- `04016d5` (spec rev 8): the drawer's discard confirm sits in the form's button row, because the teacher missed it at the drawer's edge (user decision). Closing asks only while the form is on screen, and a 409 clears the lost edits.
- `80dd43a`: a Safari click on blank drawer space focuses the panel itself, so the panel is no return target for the confirm's Cancel.

Known and as specified: Safari shows no focus ring after a mouse click and Tab skips buttons by default. (Focus after the drawer closes by a mouse click now returns to the clicked cell: Polish 3 F13.)

## For the Polish slice (user, 6c Safari pass)

- **FIRST ITEM: confirms as real small buttons, and a crimson danger red.** Every confirm that asks (`InlineConfirm`: "Discard unsaved changes?", Unpublish, the roster row and bulk confirms; and `DangerConfirm`) shows its action and Cancel as real buttons with a lower height and smaller padding: red for the action, grey for Cancel. Every danger button and error uses a stronger red, like crimson (the `--danger` token and its uses). Check this on every screen that uses them (6a, 6b and 6c), with screenshots and a review.
  **Done in Polish 1** (`docs/superpowers/plans/2026-10-14-visual-refresh-polish1-confirms.md`, Task 1).
