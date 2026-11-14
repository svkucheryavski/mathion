---
worth: yes
added: 2026-11-14
---
# Browser checks by hand for the beta pass

Checks only a person in a real browser can settle, collected for one pass when the beta is ready. The VoiceOver checks are in `beta-voiceover-pass.md`.

## Carried over from the slices' Safari passes

- The superuser pages (13d) in the full beta pass.
- Reduced motion (14): every transition and animation with `prefers-reduced-motion: reduce` on.
- Forced colours (15): Windows High Contrast on the student, authoring and teaching screens.
- The Evaluation control (8i) on the run pages.

## Slice 5a (authoring)

- **Forced colors: the selected picker card grows by 1px.** `label.selected { border: 2px solid Highlight }`
  shifts layout; use `outline: 2px solid Highlight; outline-offset: -1px` (or keep the 1px border and add
  an outline).

## Slice 5c (constructor)

- **Forced-colors cue for the focus panel.** Under `forced-colors: active` the
  `--focus-*` shades and `--focus-shadow` are dropped and `border-color` is
  forced, so the focus/parent panel looks like a plain row (expansion is still
  conveyed by the open body and `aria-expanded`; not a regression). Candidate:
  `@media (forced-colors: active) { .block-card.focus, .seq-card.focus { border-width: 2px } }`
  or an `outline: 2px solid Highlight`.

## Slice 5d (quiz editor)

- Safari pass with the user (2026-10-09/10) — done. OK: stacked level-3 modal (dimmed, centred, not clipped;
  Esc closes only the top one), the New question modal, narrow-window wrapping of the card actions, student
  block numbers, phone width (empty quiz-chip space kept by decision), no freeze after closing an item, the
  Video URL label, focus after a mouse Save/Create. Not done: D8's always-shown answer controls on a real
  touch device (no device test), and Japanese/Chinese input (not planned).

## Slice 6a (teacher run pages)

- At 1000px, an extreme filename together with a very long uploader email (and the plain delete confirm open in the actions cell) squeezes the Filename column; the replace confirm already sits in its own full-width row (browser pass).

## Slice 6b (teacher modals)

- **Switch in forced-colors mode.** `border: 0` and state by background only; in Windows High Contrast on/off differ only by knob position. Fix: a `@media (forced-colors: active)` block (border `ButtonText`, on-knob `Highlight`).
- **Observation:** Esc while a native `datetime-local` picker is open belongs to the browser; glance at it in the Safari pass.
- **The server-error banner sits at the bottom of the editor body.** At 1000px the assets sidebar stacks and the body scrolls, so a failed Save can show its banner below the fold (pre-6b position; New run puts its banner at the top). Glance in the browser pass.
- **After Cancel/Esc from an empty roster, focus returns to the toolbar's Import roster, not the link the teacher used.** Both open the same import; mention in the browser pass.
- About 1000px: the mini-project editor and the import fit, and the editor's assets panel stays beside the text. Below 880px it stacks and the body scrolls inside the dialog (expected). New run and Publish conflicts were not checked at 1000px in Safari (the Task 1-2 screenshots, in Chrome, cover 1000px).
- Not exercised in Safari, stay as they are: × while a confirm already shows (jsdom-tested: it keeps the confirm and moves focus to its Cancel); Esc while a native `datetime-local` picker is open (Task 4 note); the server-error banner's position after a failed Save at 1000px (no failed Save was mocked); focus after Cancel/Esc from an empty roster (run 8's roster is not empty).

## Slice 6c (overview, roster, side panel)

- **Esc in the group select may close the whole add row.** The form's keydown also catches an Esc that comes from the `<select>`. A native popup usually swallows the key, so check this in the browser pass. Fix: ignore the event when its target is the select. Safari pass: Safari's popup swallows Esc and the row stays open; other browsers are still unchecked.

## Polish 1 (confirms)

- **Focus ring clearance in `tr.delete-row` / `.ro-confirm-row`:** `td` has 0 top padding, so the ring (2px offset + 2px) overlaps the row above's border. Cosmetic; check in the Safari pass. (Fable)
- **D42 with a wrapped warning:** with `align="end"` and a long email or filename, the `.warning` lines stay left-ragged while the block sits at the right edge. Check at 1000px in the Safari pass. (Fable)
- **Esc in a clean title edit while #19's question asks** focuses that question's Cancel instead of cancelling the edit (R53, one question per place). Glance at it in the Safari pass. (Fable lane)

## Polish 2 (named items)

- The video and app iframes get no focus ring (D67, Safari pass): CSS cannot style a focused frame in Safari, and in Chrome only `:focus-within` matches it. Focus inside the frame is shown by the embedded page itself (YouTube's controls; an app's own page). Check with the keyboard at the beta pass, including an admin-authored app that draws no focus of its own.
- **Not checked in a browser:** High Contrast (forced colors) for the strip. The review traced the cascade (solid done fill, dashed not-done, a three-sided Highlight tab), but neither Chrome here nor Safari emulates forced colors; check on Windows High Contrast before beta.
- D73/D74 review: in both grids, focusing a pinned sort button (Progress Student/Group, Submissions Group) scrolls the table back to the start, so ⇧Tab from a late sequence header loses the place. Mild (Opus m2).
