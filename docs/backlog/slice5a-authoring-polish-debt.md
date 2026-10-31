# Slice 5a (authoring: Versions + version editor) — deferred Minors

Review findings graded Minor during the Slice-5a per-task reviews (first-party Opus + Fable second lane;
codex unavailable). None blocks the slice; each is input for the final polish slice.

## T1 — primitives

- **Tests: dirtyRegistry "unregistering mid-loop"** does not discriminate the `[...registry]`
  snapshot in `discardAll` — JS `Set` iteration already tolerates deletes. The snapshot is harmless
  defensive code; soften its comment or the test's claim.

## T2 — Versions page (3a)

- **The versions count has no screen-reader context.** `<span class="mono count">2</span>` after the
  `<h2>` is announced as a bare "2". Add a visually-hidden " versions" (or an `aria-label`).
- **Create-version 422 with an array detail** toasts "Please correct the highlighted fields." with
  nothing highlighted (only `max_quiz_attempts` is validated client-side). Use
  `validationErrors()?.[0]?.msg ?? displayMessage`, as InlineField does. Pre-existing.
- **No `alive` guard after a transition / delete.** `transition` / `deleteVersion` call `load()` after
  the request; leaving the page mid-request repopulates the module store for that slug post-unmount.
  Harmless today (the next mount reloads); pre-existing.
- **Gate coverage gaps (u).** The create card (`padding:14px`, border, `margin-bottom:12px`) and the
  form inputs' `height:var(--control-h)` / border are not pinned; `own` / `uniq1` scan `.svelte`
  files only, so a global `.icon-btn {…}` in `src/styles/*.css` would escape them.
- **Test gaps.** The EmptyState-action test does not assert that Label gets focus.
- **Create / duplicate state survives an in-place slug change.** `creating`, `newLabel` and
  `duplicatingId` persist when App rebinds `courseSlug`, so a half-typed create form from course A
  reappears under course B once it loads. Reset them in the `courseSlug` effect. Pre-existing.

## T3 — version editor shell (heading, banners, Version info)

- **Fold body `display` is not guarded.** The folded body relies on `hidden`; an author `display` rule
  on it (e.g. `.body { display: block }`) would silently break the fold while the gate and tests stay
  green (the fold test only checks the `hidden` attribute). Add a source-level gate check that the
  `hidden={folded}` element carries no styled class — the T4 Blocks body needs the same.
- **A late refresh can be skipped after a quick round trip.** ✓ on v1 → switch to v2 → back to v1 before
  the PATCH returns: the old `VersionMetaForm` instance is dead (`alive` false), so its forced reload is
  skipped, and v1's fresh GET may predate the PATCH — the field shows the old value until the next
  reload. Sub-second; a page-level `stillOnVid` would close it.
- **Test gaps.** No test pins the `{info_md}` PATCH body, the "Saved (refresh failed — reload to see
  latest)" info toast, the inline refresh ErrorState retry, the `vid !== savedVid` / unmount reload
  gate (defensive only — a version switch unmounts the card), Shift/Alt clicks on the course link, or
  a non-integer max-attempts value (`'2.5'`; only `'11'` is exercised).
- **Fold chevron name changes with `aria-expanded`** ("Collapse" / "Expand version info"), so assistive
  tech hears the state twice; the T2 `+` toggles keep a stable name. Spec-specified; consistency note.
- **The heading link's purpose is only in its `title`** — a screen reader hears "link, Applied Linear
  Algebra"; "Back to versions" is a description only, and `v{id}` sits outside the `<h1>`. Spec choice.
- **`.editor-heading h1` `min-width:0; overflow-wrap:anywhere`** carries no form-(c) mechanism comment.

## T4 — Blocks card, create-block form, state bar

- **A sequence-to-sequence history step under a folded card stays folded.** The unfold effect tracks only
  `routeBid` (spec-specified), so Back/forward from `/blocks/A/sequences/S1` to `…/S2` while the card is
  folded leaves it folded, and the focus effect's `focus()` on a header inside the hidden body is a no-op.
- **An empty create-block form survives a version switch.** `creating` (with an empty title) is not
  reset on a `vid` change, so the empty form reappears on the new version; `discard()` only runs for a
  dirty title. Reset `creating` on a `vid` change. Pre-existing.
- **A late transition toast after a version switch is ambiguous.** "Version published" still fires (the
  action did succeed) while the author is on another version; consider naming the version (`v1`).
- **Create-block field error is not linked to the Title input** (`small.field-err` has no
  `aria-describedby` / `aria-invalid`). Pre-existing.
- **Unannotated literals.** `.cr-form { padding: 12px 0 }` and the `.state-actions` gap / margins carry no
  ref or scale comment (Constraint 5); only the `border-top` cites ref 1639.

## T5a — accordion headers

- **The block `+` busy-disable is untested.** Dropping `busy` from the `+`'s `disabled`, or the whole
  `onPlus` guard line, leaves the suite green (each guard covers the other). The arrows have a "busy
  disables" test; add one for the `+` (start a sequence reorder against an unresolved fetch, assert the
  `+` is disabled, then resolve).
- **`onPlus`'s `await tick()` before the `expanded` check is belt-and-braces** — the `$derived` is
  already fresh after `navigate`; removing it passes the suite. Keep or drop.
- **Focus after `+` on a collapsed block depends on microtask order** (the page focus `$effect` runs one
  hop before `onPlus`'s second `tick()`, so Title wins). Verified by a throwaway page-level probe; no
  committed test pins it.

## T5b — accordion bodies

- **Two inputs share the accessible name "Sequence title".** The block's create-sequence input and an
  expanded sequence's title InlineField both announce "Sequence title"; with a sequence open and the
  create form open, a screen-reader user hears two identically named fields in one block. Rename the
  create input (e.g. "New sequence title"). Pre-existing name.
- **No D3-suffix test on item delete.** Adding `unsavedSuffix(...)` to `deleteItem`'s confirm leaves
  the suite green; the T6 test "an item delete never carries the unsaved suffix (D3)" is meant to pin it.
- **Back after a delete can land on a deeper stale entry** (e.g. `/blocks/3/sequences/7` from before the
  delete); `handleStaleIdFallback` handles it. The spec only promises the current entry is replaced.
- **Re-expanding a sequence whose DELETE is still pending** (the old instance unmounted, `busy` lost)
  ends in the stale-id toast. Contrived timing.
- **The block "late … after an unmount" tests pin only the `alive` half of `stillOnVid`.** A mutation to
  `return alive;` passes; a twin that bumps the `vid` prop to 2 before releasing the request would pin
  `vid === savedVid` too (the sequence tests already drive their stub to false).
- **The closed-form create toast can lose part of a mixed 422.** With a field error and an unmapped entry
  together, `globalMessage` (the unmapped part) wins and the field message is dropped; a network failure
  reads `mapCreateError`'s generic "Save failed", odd wording for a create. Pre-existing mapper behaviour.
- **Gate D10: a multi-rule FAIL prints extra offenders on unprefixed lines.** Only the first offending rule
  sits on the `FAIL` line; join `$bad` onto one line (`${(f)bad}` / `tr '\n' ' '`). Nothing is mis-graded.
- **Gate D10: a comma group led by the inputs selector escapes the check.** The `[,{]` terminator lets
  `.cr-form.H input:where(.H),.seq-box.H{border:…}` exempt its later members. Require every group member
  to be an inputs selector: `^\.cr-form\.${H} (input|textarea):where\(\.${H}\)(,\.cr-form\.${H} (input|textarea):where\(\.${H}\))*\{`.

## T6 — item rows + item type picker

- **Forced colors: the selected picker card grows by 1px.** `label.selected { border: 2px solid Highlight }`
  shifts layout; use `outline: 2px solid Highlight; outline-offset: -1px` (or keep the 1px border and add
  an outline).
- **The item type is not announced.** `ItemMark` is `aria-hidden`, so a screen reader hears the item title
  but not its type (the old emoji was `aria-hidden` too). A visually-hidden type word would fix it.

## Final whole-branch review (both lanes)

- ~~**Every accordion expand / collapse prompts for an open dirty Version-info draft**~~ — **resolved, keep as
  specified (D3).** Browser pass 2026-10-07: the user found the prompt natural ("prevent the next step if the
  previous one is not complete"). No change.
- **Remaining selector-exact gate negatives** (same class as the (x)/(z) fixes): (v) `.inline-field.H:focus`
  misses `.inline-field.open:focus` / `[role]:focus-visible`; (w) `.blocks-card.H{…margin-bottom}` misses the
  `margin` shorthand and descendant forms; the three "no rem font sizes" checks miss element selectors
  (`h5.H{font-size:1rem}`); InlineField `.sr-only` opacity misses compound forms and `sweep`'s
  `opacity:0?\.[0-9]` misses an integer `opacity:0`; the legacy "rule gone" negatives (`.badge.H`, `.state-*.H`)
  are exact (the hex sweep is the real Constraint-1 guard).
- **Stale text.** `dirtyRegistry.svelte.ts:1-4` still describes per-form `makeDirtyTracker` getters registered on
  mount (the editor now registers InlineField trackers and create-form shims while open);
  `docs/backlog/flex-1-titles-may-collapse-to-zero-width.md` cites `ItemRow.svelte:99` and
  `AccordionHeader.svelte:92` rules this slice rewrote — update or close those bullets.
- **The read-only flip that closes an open create form is unpinned at page level.** Deleting
  `VersionEditPage`'s `canStructure`-flip effect leaves the suite green; the accordions' twin effects are
  covered only indirectly. One case — open the form, a publish lands, the form is gone — would pin it.
- **Untested pre-existing 3a behaviours:** closing the duplicate row on a transition, and hiding the
  "+ New version" EmptyState action while the create form is open.

## Browser pass (2026-10-07) — requirements carried to Slice 5b

These two were found in the 5a browser pass. They live on the item-editor screen that 5b replaces with a modal,
so they are 5b requirements, not 5a polish.

- **Back from the item editor freezes the version editor (Critical for 5b).** `App.svelte` swaps
  `ItemEditPage` → `VersionEditPage` as one dynamic component (`<Comp>`). Svelte builds the incoming page first
  and renders it from the shared `currentEditorVersion` tree, but defers its top-level `$effect`s, including the
  load effect. Then the outgoing page's `onDestroy(() => clearEditorVersion())` (`ItemEditPage.svelte:248`)
  nulls the tree. In the deferred flush, `InlineField`'s `$effect` reads `VersionMetaForm`'s
  `$derived(metaReason(version))` with `version` undefined. That happens before the parent's `!tree` skeleton
  branch (`VersionEditPage.svelte:337`) re-evaluates in the next batch. The result is a `TypeError` in
  `metaReason` (`editorReasons.ts:10`). The error aborts the flush, so the page's own load effect never runs, and
  the page stays frozen until a reload. Reproduced in Chrome and Safari. The ordering comes from reading the
  Svelte 5.55.5 source; it was not runtime-traced. Guarding the child would likely stop the crash, but would
  leave a skeleton flash and a redundant refetch. The same clear-on-unmount and an unguarded
  `$derived(versionPermissions(version))` exist on `main` (merge-base `378a566`), so the race is likely older
  than 5a; it was not reproduced on `main`. The forward swap (`VersionEditPage` → `ItemEditPage`,
  `VersionEditPage.svelte:160`) clears the tree under the mounted item page too; it does not throw today only
  because `ItemEditPage`'s deriveds are guarded.
  **5b requirement:** no editor page may clear the tree while another page that reads it is mounted. A modal that
  keeps `VersionEditPage` mounted removes the swap. If any `/items/:id` deep-link route still mounts a separate
  page, use an owner token (a page clears only the tree it still owns) or drop clear-on-unmount. Either way,
  update the store's documented contract (`currentEditorVersion.svelte.ts:1-5`, `ItemEditPage.svelte:246-247`).
  **Regression test:** open an item → close or Back → create another item without reloading.
  **Closed in Slice 5b (T3b).** Items open as a modal over the still-mounted `VersionEditPage`, `ItemEditPage`
  is deleted, and only `VersionEditPage` loads and clears the tree (D22, documented in
  `currentEditorVersion.svelte.ts`). The fix is structural: the editor routes share one page instance, so there
  is no page swap to race. `frontend/src/tests/App.editorRoutes.svelte.test.ts` pins the routing (item route →
  `VersionEditPage` modal, Back, create another item). It is a smoke test, because jsdom does not reproduce the
  5a freeze even with the old clear-on-unmount restored. The Safari browser pass is the real check.
- **A disabled version's item shows an inline 403 instead of a rendered preview.**
  `POST /api/versions/{id}/render` returns 403 "Version is disabled" (`versions.py:185-186`). `ItemEditPage`'s
  read-only preview calls it and shows that message inline. This was specified on purpose (an earlier spec's §11
  item 7, quoted at `ItemEditPage.svelte:308-313`), so it is a product decision to revisit, not a regression.
  The row's Open pencil stays enabled by design (5a spec, ItemRow: "enabled unless busy"). 5b decides whether
  to keep this, to relax the endpoint for read-only rendering, or to show the reason in the modal instead.
  **Closed in Slice 5b (D6; T2 `plain`, T3a, T4).** A disabled version's page, quiz and app items show their plain
  source (the app shows no preview) plus the note "Preview is unavailable while this version is disabled — enable it
  to preview or edit.", and make no `/render` or asset request (pinned in `ItemEditorModal.svelte.test.ts`). A video
  item keeps its external preview and its note reads "Editing is unavailable while this version is disabled — enable
  it to edit." (user decision, T3c review). The endpoint is unchanged.
