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
- **Esc in the group select may close the whole add row.** The form's keydown also catches an Esc that comes from the `<select>`. A native popup usually swallows the key, so check this in the browser pass. Fix: ignore the event when its target is the select.
- **The add error stays while the teacher edits the address.** There is no `oninput` clear, so the error line and the red edge stay until the next submit. This predates 6c. Fix: clear `addError` on input.
- **Pre-existing error-path gaps in `submitAdd`:**
  - an add that succeeds but whose refetch fails shows the refetch error under the row, as if the add had failed, after the field was already emptied;
  - a network `TypeError` says nothing.
  
  Fix: refetch outside the add's error branch, and add an `else` with a generic message.
- **The open add row unmounts under focus if the run turns draft** (a refetch after another session unpublished it). Focus falls to `<body>`, since the toggle is disabled by then. Only reachable across sessions.
- **No success announcement after an add.** The row just clears, with focus back in the e-mail field. Collect for the VoiceOver pass at beta.
- **Untested:** `open-add-link` while the row is already open (it only refocuses the e-mail field).
- **The `IconButton` link variant** never binds `element`, which is typed `HTMLButtonElement`. It does not pass `tabindex` or `aria-hidden` either. Task 6's download link needs none of these. Document or widen this if a later caller needs them.
