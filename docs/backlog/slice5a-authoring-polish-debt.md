# Slice 5a (authoring: Versions + version editor) — deferred Minors

Review findings graded Minor during the Slice-5a per-task reviews (first-party Opus + Fable second lane;
codex unavailable). None blocks the slice; each is input for the final polish slice.

## T1 — primitives

- **InlineField: IME edge cases.** `if (e.isComposing) return;` runs before the Escape branch, so an
  Escape that cancels an IME composition still bubbles (a future modal's `svelte:window` Escape handler
  would close the modal). Safari also sends the Enter that confirms an IME conversion with
  `isComposing === false` and `keyCode === 229`, which would commit mid-composition. Fix: stop Escape
  propagation even while composing; treat `keyCode === 229` as composing.
- **InlineField: focus after a mouse ✓ then a read-only flip.** A mouse-clicked ✓ holds focus, becomes
  disabled while busy, and Chrome blurs it; a flip during that window sees `hadFocus === false`, so focus
  lands on `<body>` instead of the row. Cosmetic; the keyboard path parks focus correctly.
- **InlineField: a late-failure toast has no field context.** After a discard-then-navigate, the toast
  reads e.g. "Label taken" with nothing naming the field. Consider prefixing the label
  (`${label}: …`); the spec currently pins `msg(e)`.
- **InlineField: a busy (saving) draft still counts as dirty**, so DirtyGuard's "Discard unsaved
  changes?" and the D3 suffix appear for a draft that is already being saved (sub-second window).
  Spec-consistent; wording only.
- **Tests: InlineField "late failure toasts once, no inline error, no focus"** does not assert the
  "no focus" part; **"reopening clears a stale error"** cannot catch the removal of `error = null` in
  `openEditor` (`close()` already clears it); the ✓/✕ `if (!busy)` onclick guards are defensive and
  untestable (a disabled button never fires `onclick`); busy-ignore is pinned via the keydown path.
- **InlineField: the pencil disabled during a discarded in-flight commit** (the T1 fix) shows the
  plain `editTitle` tooltip with no reason. Sub-second; cosmetic.
- **Tests: dirtyRegistry "unregistering mid-loop"** does not discriminate the `[...registry]`
  snapshot in `discardAll` — JS `Set` iteration already tolerates deletes. The snapshot is harmless
  defensive code; soften its comment or the test's claim.

## T2 — Versions page (3a)

- **Focus after a row action.** Duplicate's Cancel unmounts the focused button, and a Disable click
  disables the button (busy) and swaps it for Enable, so focus falls to `<body>`. Spec only requires
  focus on open. Return focus to the row's Duplicate / Enable / Disable slot once the action settles.
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
