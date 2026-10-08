# Slice 5c — constructor polish debt

Minors from the per-task review lanes (Opus + Fable), deferred by the review
rule (Critical/Important are fixed in-task; Minor lands here).

## T1 — focus by depth

- **Forced-colors cue for the focus panel.** Under `forced-colors: active` the
  `--focus-*` shades and `--focus-shadow` are dropped and `border-color` is
  forced, so the focus/parent panel looks like a plain row (expansion is still
  conveyed by the open body and `aria-expanded`; not a regression). Candidate:
  `@media (forced-colors: active) { .block-card.focus, .seq-card.focus { border-width: 2px } }`
  or an `outline: 2px solid Highlight`.
- **`uid` / `blocksHeadingId` placement.** In `VersionEditPage.svelte` the two
  declarations sit between `expansion` and the "Slice-5c D1" `depth` comment;
  moving them next to the other template ids keeps the load → validation →
  focus commentary contiguous. Cosmetic.
- **`created` badge vs `--focus-1`.** On the block depth the grey state badge
  nearly blends into the page shade (still readable). Re-check in the browser
  pass; tune `--focus-1` or the badge fill with the user.

## T2 — headers, inline title, header delete

- **Safari IME on the inline title.** `AccordionHeader` bails on `e.isComposing`
  only; WebKit's confirming Enter has `isComposing=false`, `keyCode=229`, so
  a CJK author's Enter-to-convert commits a half-typed title (Esc can cancel
  the rename). Fix: `if (e.isComposing || e.keyCode === 229) return;` — the
  same debt exists in `InlineField` (Modal already guards it).
- **Read-only flip drops a dirty title silently.** InlineField toasted
  "Editing closed — this version is no longer editable" and refocused its row;
  the header closes the field without a message (focus may fall to `<body>`).
- **✎ enabled-but-inert while a closed rename is still saving** (Back mid-save,
  then Forward before the PATCH settles): `disabled={busy || saving}`.
- **Guard prompt during an in-flight save.** The tracker stays dirty while
  `saving`, so navigating prompts "Discard…", yet the PATCH still lands
  (InlineField parity). Option: `renaming && !saving && …`.
- **The panel's label dangles while renaming.** The heading + toggle are
  swapped for the input, so `role=region aria-labelledby={headerId}` points at
  a missing element for the duration. Keep the heading and put the input in it.
- **Focus after a header block delete** falls to `<body>` (the URL replaces to
  the version, no header to focus). Same as the pre-T2 footer; focus the next
  block's toggle or the page heading.
