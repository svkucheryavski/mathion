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
