# Slice 5c — constructor polish debt

Walked 2026-11-14 against main `1c904f9`: done and code-only items were dropped, screen-reader items moved to `beta-voiceover-pass.md`, by-hand browser checks to `beta-browser-pass.md`. What is left goes into one fix round; **[open]** marks an item that needs the user's call first.

## T2 — headers, inline title, header delete

- **Safari IME on the inline title.** `AccordionHeader` bails on `e.isComposing`
  only; WebKit's confirming Enter has `isComposing=false`, `keyCode=229`, so
  a CJK author's Enter-to-convert commits a half-typed title (Esc can cancel
  the rename). Fix: `if (e.isComposing || e.keyCode === 229) return;` — the
  same debt exists in `InlineField` (Modal already guards it).
  **Low priority (user, 2026-10-10):** Japanese/Chinese input is not planned in the near future; not tested in
  the Safari pass.
- **Read-only flip drops a dirty title silently.** InlineField toasted
  "Editing closed — this version is no longer editable" and refocused its row;
  the header closes the field without a message (focus may fall to `<body>`).
- **✎ enabled-but-inert while a closed rename is still saving** (Back mid-save,
  then Forward before the PATCH settles): `disabled={busy || saving}`.
- **Guard prompt during an in-flight save.** The tracker stays dirty while
  `saving`, so navigating prompts "Discard…", yet the PATCH still lands
  (InlineField parity). Option: `renaming && !saving && …`.

## T3

- **Enter on "+ Add …" right after a create is swallowed.** Focus returns to the line, but `createBusy` stays true through the follow-up `loadAdminTree`. `openAdd` bails, and the line isn't disabled (disabling it would drop the returned focus). Fix: a separate "posting" flag, so `openAdd` is allowed once the POST itself is done. Keep `createBusy` on reorder/header gating. (BlockAccordion, VersionEditPage.)

## T4

- **Type picker stays live while a create is posting** (both lanes). Switching Page→Video mid-POST lets a different type show than the one sent, and a 422 is mapped against the new type (a `video_url` error then reaches the alert, still visible). Fix: snapshot `sentType` in `submit()` for `known`, and freeze the picker (`<fieldset disabled>` via a `disabled` prop) while busy.
- **Browser Back + confirmed discard during an in-flight create still opens the new item** (both lanes). `tracker.discard()` closes the modal while busy, the POST continues, and the late success navigates into the item. Inherited from the old inline form. Since the r2 Safari fix, the same late success also blurs whatever the author has focused since (focus loss only; no editor has a blur handler). Fix: remember whether the modal was still open (`const open = creating`) and skip both the blur and the navigate (toast "Item created") if not.
- **Title sent untrimmed** while the starter heading uses `title.trim()` (`"  Dot "` stored padded, heading `# Dot`). Pre-existing; send `title.trim()` and update the body test.

## T5

- **Back + discard while saving still saves (r1).** The tracker reports `isDirty` while a PATCH is in flight; Back → "Discard" closes the modal, yet the PATCH lands and toasts "Saved". Use `isDirty: dirty && !saving`, or block the guard mid-save.
- **Stale permissions after a 403/409 (r1).** When the version was published elsewhere, Save shows the server message, but the modal stays editable until a reload. Reload the tree on 403/409 so it turns read-only.
- **[open]** **The read-only modal gives no reason (r1).** It just shows text. A one-line muted reason ("Published versions are read-only") would explain it; `metaReason` already has the wording (see above).
- **Safari IME commit Enter can save (r2, Opus).** Safari may fire the composition-commit Enter with `isComposing` false and `keyCode` 229, so a Japanese/Chinese label could save early. Add `|| e.keyCode === 229` to `onEnter` (Modal.svelte guards Escape this way); AccordionHeader's Enter has no IME guard at all — fix both together. Low priority: CJK input not planned (user, 2026-10-10).

## Mandatory version label, "v. N" chips, block numbers (2026-10-08)

- **The modal shows one field error at a time (r1, Opus).** A blank Label and an invalid attempts value show only the label error; the attempts error appears on the next Save. Set both before returning.

## Whole-branch review (29737f4..1ab391e, 2026-10-09) — minors, deferred

- **5c header renames don't reload the tree on 403/409** (Opus): `BlockAccordion.renameBlock` and
  `SequenceAccordion.renameSeq` pass the error to AccordionHeader without `loadAdminTree(…, { force: true })`,
  unlike every 5d write. The ✓ stays enabled and every retry fails until a manual reload. Fix together with
  "Read-only flip drops a dirty title silently" above: a reload would close the field through the
  `!canEditTitle` effect and lose the typed text.
