# Slice 6c — Overview, Roster and the side panel: debt and deferred minors

Walked 2026-11-14 against main `1c904f9`: done and code-only items were dropped, screen-reader items moved to `beta-voiceover-pass.md`, by-hand browser checks to `beta-browser-pass.md`. What is left goes into one fix round; **[open]** marks an item that needs the user's call first.

## Task 3 — Roster toolbar and add row

- **Close requests are ignored silently while an add runs.** During the POST and its refetch, the toggle ×, Cancel and Esc in the row do nothing, and nothing says why (`closeAdd` returns while `adding`). They are not `aria-disabled`. Fix as R44 does elsewhere: `aria-disabled={adding}` and the title "Wait for the current change to finish" on Cancel and the toggle.
- **An add that succeeds but whose refetch fails** shows the refetch error under the row (`submitAdd`), as if the add had failed, after the field was already emptied. Pre-existing. Fix: refetch outside the add's error branch. (Its network half, "a `TypeError` says nothing", was fixed in Polish 3 Task 8.)

## Task 4 — Roster strip, result banner, table and confirms

- **A stale `pendingDelete` reopens the row confirm and steals focus** when that student comes back. Sequence: the row confirm is open, the student is bulk-removed, then they are re-added later; the confirm row renders again and `takeFocus` moves focus to its Cancel. Fix: clear `pendingDelete` in the `students` effect when its id is no longer on the roster.
- **Cancel during a slow row Remove is overridden.** The confirm shows no busy state while the DELETE runs. Clicking Cancel puts focus on the row's 🗑, but the success chain then moves it to the next row's 🗑. A second Remove is ignored silently.
- **Other rows' 🗑 are ignored silently while a remove runs** (`askRemove` returns). They have no `aria-disabled` or reason. R44 names only the strip 🗑.
- **[open]** **Row actions and the add row are not blocked during a bulk op.** This applies to the row 🗑, the row group select and Add. It matches today's behaviour, and the spec doesn't ask for more. The server stays consistent and the last refetch wins.
- **The strip can count a student whose row a refresh removed** ("1 selected" with no row). Found in plan review; this predates 6c.

## Task 5 — Side panel frame and Progress view

- **[open]** **× while the confirm asks always moves focus to its Cancel,** even when the confirm came from the form's Cancel (source `cancel`). This is what the spec says, but to close, a teacher must press Cancel, then ×, then Discard. A cheaper path: re-arm the confirm with source `close`. This is a design note.

## Task 6 — Submission cards and evaluation form

- **[open]** **Save's title says "Attach the feedback PDF" in a locked edit,** but the edit form has no attach control. Sequence: edit an evaluation with no feedback file and a non-accepted result; Save stays disabled (today's behaviour, as the spec says) until Accepted is picked. Fix: in edit mode, use the lock text (or "Choose Accepted") as the title.
- **[open]** **Seen in the screenshot pass:** the "Evaluation saved; group notified" toast covers the panel's status badge and × for a few seconds. The toast position is outside this slice.
