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
