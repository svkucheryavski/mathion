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
