# Slice 6a — teacher screens restyle: deferred minors

Walked 2026-11-14 against main `1c904f9`: done and code-only items were dropped, screen-reader items moved to `beta-voiceover-pass.md`, by-hand browser checks to `beta-browser-pass.md`. What is left goes into one fix round; **[open]** marks an item that needs the user's call first.

## T3 — DangerConfirm, InlineName, InlineConfirm takeFocus

- InlineName shows "Please correct the highlighted fields." for a 422 with a list detail, though nothing else is highlighted. Callers pass `maxlength={80}`, so a 422 is unlikely.

## T6 — the two runs lists

- Pre-existing: a double-click on "Confirm Delete" sends two `deleteRun` calls; the second 404s, so an error toast follows "Run deleted." and focus jumps. InlineConfirm has no in-flight guard (DangerConfirm got one in T3).

## T7 — Progress

- **[open]** `.block-header, .seq-header { position: sticky; top: 0 }` is inert (`.table-scroll` has no height limit, so headers never stick on a page scroll). Pre-existing; look at it in the browser pass.

## T9 — Groups and Teachers

- `addGroup`: if `createGroup` succeeds but `onRefetchGroups()` throws, the refetch error shows under the field, which still holds the created name; Save again reports "already exists".
- Teachers `submit` always moves focus back to the email field when the request settles; during a slow add, a user who moved on (e.g. opened a remove confirm) gets focus pulled back. Guard on `activeElement` being `<body>` or inside the tab if it shows up.

## T10 — Mini-projects

- After a failed force delete, focus goes to the row's 🗑 (the panel rule), and the panel stays open unarmed below it; focusing the panel's checkbox would keep a retrying user in place.
- An admin's 409 whose refetched row is still not locked leaves the inline confirm open with no feedback (pre-existing).

## Final whole-branch review (fresh Opus + Fable: no Critical; two minors re-graded Important and fixed; the rest deferred)

- Assets 403 on force delete reloads the whole run page, so the "no longer have permission" banner disappears and focus lands on `<body>` (pre-existing, rare). Toast it, or refetch only the course.
- "Delete N selected" stays enabled while a bulk delete runs; a second deliberate confirm starts a duplicate loop and a misleading "deleted by another user" banner (pre-existing).
