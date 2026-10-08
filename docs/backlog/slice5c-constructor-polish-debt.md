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

## T3

- **Enter on "+ Add …" right after a create is swallowed.** Focus returns to the line, but `createBusy` stays true through the follow-up `loadAdminTree`. `openAdd` bails, and the line isn't disabled (disabling it would drop the returned focus). Fix: a separate "posting" flag, so `openAdd` is allowed once the POST itself is done. Keep `createBusy` on reorder/header gating. (BlockAccordion, VersionEditPage.)
- **No test for a permission flip closing an open add row.** The `canStructure`-flip effects in BlockAccordion and VersionEditPage still close the new rows, but no test covers "row open → version published → row gone, tracker unregistered".
- **The page's focus return runs before the version check.** In VersionEditPage `submitCreateBlock`, the focus return runs before `if (!stillOnVid(savedVid)) return;`. A late success after a version switch could focus the new version's "+ Add block", but only when focus sat on `<body>`.
- **Screen readers read "plus Add block".** Wrap the glyph: `<span aria-hidden="true">+</span> Add block`, and the same for sequence and item.
- **Gate:** `.item-row` padding is deliberately unpinned (§Process). `gap:10px` was restored in r1.

## T4

- **Type picker stays live while a create is posting** (both lanes). Switching Page→Video mid-POST lets a different type show than the one sent, and a 422 is mapped against the new type (a `video_url` error then reaches the alert, still visible). Fix: snapshot `sentType` in `submit()` for `known`, and freeze the picker (`<fieldset disabled>` via a `disabled` prop) while busy.
- **Video URL check is case-insensitive; the backend isn't** (both lanes). `HTTP://…` enables Create, then a 422 lands under the URL field. Drop the `/i` in NewItemModal and flip the test that asserts the uppercase form.
- **Browser Back + confirmed discard during an in-flight create still opens the new item** (both lanes). `tracker.discard()` closes the modal while busy, the POST continues, and the late success navigates into the item. Inherited from the old inline form. Since the r2 Safari fix, the same late success also blurs whatever the author has focused since (focus loss only; no editor has a blur handler). Fix: remember whether the modal was still open (`const open = creating`) and skip both the blur and the navigate (toast "Item created") if not.
- **Field errors are not announced** (the 409 "title taken" `<small>` has no `role="alert"`, focus stays put). Add `role="alert"` or focus the errored input; consider `required` on Title / Video URL as ItemEditorModal does.
- **Test gaps:** "× and Escape are frozen" never dispatches Escape or checks Cancel; no test that a second Create/Enter while busy calls `onCreate` once; "Create is disabled until…" never checks the empty-title Page default.
- **Title sent untrimmed** while the starter heading uses `title.trim()` (`"  Dot "` stored padded, heading `# Dot`). Pre-existing; send `title.trim()` and update the body test.
