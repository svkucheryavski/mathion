# Polish 3 (the reviewers' minors) — deferred minors

Walked 2026-11-14 against main `1c904f9`: done and code-only items were dropped, screen-reader items moved to `beta-voiceover-pass.md`, by-hand browser checks to `beta-browser-pass.md`. What is left goes into one fix round; **[open]** marks an item that needs the user's call first.

## Task 4 — the focus sites

- **Two row group selects changed in quick succession: the first to settle takes focus.** Row A's request is in flight (A disabled, focus on `<body>`); the user changes row B (B disabled too). A settles first, and `repairFocus(selA, search)` focuses A, not the control last used; B's repair then sees focus on A and does nothing. Fix: remember the last changed select and repair to it (Opus r1 M5).
- **A failed groups refetch frees a newer change of the same row.** `onGroupChange` awaits `onRefetchGroupsOnly()` inside the PATCH's `try`, so a rejected refetch runs the `catch`, which deletes the row's `pendingGroupId` entry, by then the entry of a newer change still in flight. The select is enabled again during that PATCH and shows the previous choice, so a third change can race it; an `ApiError` from the refetch also toasts after a change that succeeded, and since Polish 3 Task 8 a `TypeError` from it toasts the offline message. Focus stays right. Older than Polish 3, but the F8 at-land repair makes the window reachable from the keyboard. Fix: move the refetch out of the PATCH's `try` with its own catch (and decide what a failed refetch says), or keep a per-row request token (both lanes, r4).

## Whole-branch review (71dd8cc..8bc9497)

- **An offline Roster add paints the e-mail field red.** `RunRosterTab.svelte:681` sets `aria-invalid` whenever `addError` is set, so `OFFLINE_MESSAGE` shows under a red field, the look C3 removed elsewhere for network failures. Fix: mark the field invalid only for an `ApiError` about the address, as the Teachers tab now does (Fable m1).
