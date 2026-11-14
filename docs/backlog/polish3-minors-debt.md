# Polish 3 (the reviewers' minors) — deferred minors

Walked 2026-11-14 against main `1c904f9`: done and code-only items were dropped, screen-reader items moved to `beta-voiceover-pass.md`, by-hand browser checks to `beta-browser-pass.md`. What is left goes into one fix round; **[open]** marks an item that needs the user's call first.

## Task 4 — the focus sites

- **Two row group selects changed in quick succession: the first to settle takes focus.** Row A's request is in flight (A disabled, focus on `<body>`); the user changes row B (B disabled too). A settles first, and `repairFocus(selA, search)` focuses A, not the control last used; B's repair then sees focus on A and does nothing. Fix: remember the last changed select and repair to it (Opus r1 M5).
- **A failed groups refetch frees a newer change of the same row.** `onGroupChange` awaits `onRefetchGroupsOnly()` inside the PATCH's `try`, so a rejected refetch runs the `catch`, which deletes the row's `pendingGroupId` entry, by then the entry of a newer change still in flight. The select is enabled again during that PATCH and shows the previous choice, so a third change can race it; an `ApiError` from the refetch also toasts after a change that succeeded, and since Polish 3 Task 8 a `TypeError` from it toasts the offline message. Focus stays right. Older than Polish 3, but the F8 at-land repair makes the window reachable from the keyboard. Fix: move the refetch out of the PATCH's `try` with its own catch (and decide what a failed refetch says), or keep a per-row request token (both lanes, r4).
- **A busy asset question that outlives a failed reload comes back with `takeFocus`.** The failed reload closes only an idle question; a busy one (its DELETE in flight) stays in `confirmId` while the rows are gone. If an outside reload succeeds before the DELETE settles, the row and its question remount and `InlineConfirm` takes focus. Very rare (a failed reload and a second reload inside one DELETE). Fix: keep the busy question's focus intent, or skip `takeFocus` on a remount (Opus r2 m4).

## Task 7 — teacher screens

- **Focus in the "used by" panel drops to `<body>` when only its own entry goes.** A reload that removes the focused mini-project's line from an open panel, while the chip keeps other uses, unmounts the focused Edit button; the D87 repair runs only when the chip drops to 0. Older than Polish 3. Fix: in the same `$effect.pre`, repair a focused panel button whose mini-project left the list to the panel's next Edit, else the chip (Fable r2 m1).

## Task 8 — behaviour

- **The Teaching crumb on a run page drops the status filter.** `TeachingCrumbs.svelte:15` links to the bare `/teaching`, so a teacher who filtered to Upcoming or Finished and goes back through the crumb lands on Active; the browser's Back keeps `?status=` (C18). Fix: carry the last `?status=` into the crumb's link, or have the crumb go back in history when the previous entry is `/teaching?…` (Opus r1 m4).

## Whole-branch review (71dd8cc..8bc9497)

- **[open]** **Three offline sentences on one run page.** An offline title or date save on the Overview shows InlineName's "Could not save." (`InlineName.svelte:58-60`), while the groups switch and Publish/Unpublish toast `OFFLINE_MESSAGE`, and Delete says "Could not delete the run.". Spec rev 12 ("every offline write says the same thing") and its InlineName bullet disagree. Fix: InlineName maps a `TypeError` to `OFFLINE_MESSAGE` (Opus m1, Fable m2).
- **A failed Refresh shows the browser's raw text.** On Progress and Submissions (`RunProgressTab.svelte:63, 83`, `RunSubmissionTab.svelte:68, 88`) a failed Refresh shows "Failed to fetch" / "Load failed"; since C17 keeps the table, it sits above the still-visible rows. Older than Polish 3. Fix: map a non-API error to "Check your connection and try again." as CourseList does (Opus m2).
- **An offline Roster or Teachers add paints the e-mail field red.** `RunRosterTab.svelte:681` and `RunTeachersTab.svelte:97` set `aria-invalid` whenever `addError` is set, so `OFFLINE_MESSAGE` shows under a red field, the look C3 removed elsewhere for network failures. Fix: mark the field invalid only for an `ApiError` about the address (Fable m1).
- **[open]** **Two wordings for the date rule.** `NewRunModal.svelte:22` says "End date must be on or after start date"; the Overview's 422 says "End date must be on or after the start date (01 Sep 2026). …" (Opus m3, nit).
- **Modal focuses its panel on every loose keydown, modifier-only included** (`Modal.svelte:95`). Cosmetic: a focus ring can flash on Shift or ⌘ alone (Fable m5).
