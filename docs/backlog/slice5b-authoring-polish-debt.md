# Slice 5b (authoring: item editor modal) — deferred Minors

Review findings graded Minor during the Slice-5b per-task reviews (first-party Opus + Fable second lane).
None blocks the slice; each is input for the final polish slice.

## T1 — Modal shell

- **Modal: autofocus on a disabled or inert target.** FocusTrap's priority chain picks the first
  selector that *matches*, so a disabled `[data-autofocus]` (or one under `bodyInert`) wins, `.focus()`
  is a no-op, and focus stays behind the modal until the first Tab. Fix: after autofocus, if the panel
  does not contain `document.activeElement`, run `refocus(false)`.
- **Modal: a drag-select released on the backdrop closes the modal** when `closeOnBackdrop` is set
  (mousedown in a field, mouseup outside → the click target is the backdrop). Fix: record the mousedown
  target and close only when both ends are the backdrop. No 5b caller sets `closeOnBackdrop`.
- **Modal: `onclick={onRequestClose}` passes the MouseEvent** to a `() => void` callback. Harmless today;
  `() => onRequestClose()` keeps the contract exact.
- **Modal: `label` / `labelledby` are both optional.** A union type (`{ label: string } | { labelledby:
  string }`) would make an unnamed dialog a type error.
- **Modal: Shift+Tab escaping off the panel itself** (focus on the panel, as in the freeze state) lands on
  the first candidate rather than the last; `refocus` only reads `relatedTarget === first`.
- **Modal: the panel's own focus ring** in the freeze state (body inert, buttons disabled → focus parked
  on the `tabindex=-1` panel) is the browser default; a `:focus-visible` style would match the design.
- **Tests not yet written:** × / Escape close → focus returns to the opener; `bodyInert` true → false
  re-enables the body's focusables; the Tab-hold branch (no candidates → Tab stays on the panel).
- **Modal stack: focus can escape when the top modal closes** and its FocusTrap restores to an opener
  outside the still-open bottom modal — the restore runs before the top's cleanup splices the stack, so
  the bottom one ignores that focusin. Fix: after the splice, refocus into the new top if focus is
  outside it. Nothing in 5b stacks Modals (its confirms are native `confirm()`); matters for Slice 6.
- **Modal stack under HMR (dev only):** hot-reloading with two stacked modals can save `'hidden'` as the
  original overflow. Fix: `import.meta.hot?.dispose` carries the stack, or accept it.
- **FocusTrap/Modal: CSS-hidden focusables** (`display:none`, e.g. RunAssetsTab's file inputs) still
  count; only the `hidden` attribute is filtered. Shift+Tab off the first visible element then sticks.
  Fix: skip elements with no rendered box (`!el.getClientRects().length`) when Slice 6 adopts Modal there.
- **Tests: the stacking test can leak** its second modal into the module stack if an assertion fails
  before `unmount(b)`; register it for `afterEach` cleanup.
- **Modal stack: a nested Modal mounted in the same flush as its parent inverts the stack** (the inner's
  onMount runs first, so the outer counts as top: Escape closes the outer, containment pulls focus behind
  the inner panel). Opened-later nesting is fine. Fix (probe-verified): derive top from document order
  (`compareDocumentPosition`), and skip FocusTrap's autofocus when focus is already inside its container.
- **Tests: the stacking test never asserts the bottom modal is live again** after the top closes (a
  cached-at-mount `isTop` would pass). Add: unmount B, Escape → A's `onRequestClose` called once.
- **Modal/FocusTrap: duplicated focusable selector + `[hidden], [inert]` filter**; `onFocusIn`'s
  `from === candidates()[0]` assumes both agree. Extract one shared `getFocusable(root)`.
- **Hand-off to T3a/T3b:** after a failed delete, refocus the header trash; an Escape pressed inside an
  iframe in the body (none in 5b) never reaches `svelte:window`.

## T2 — MarkdownEditor + AssetSidebar

- **AssetSidebar: a row that turns referenced while its confirm is open keeps an enabled Confirm**
  (open confirm on A → type a reference → Save → reload). Confirm then sends a DELETE the server rejects
  with 409 — shown as an error, nothing lost. Fix: `|| a.is_referenced` on Confirm, or clear `confirmId`.
- **AssetSidebar: the disabled trash's reason is hidden from assistive tech** — `aria-label="Delete …"`
  overrides the `title`. Fix: when referenced, `aria-label={`${inUseReason}: ${a.filename}`}`.
- **AssetSidebar: disabled rows do not recede** (`.row-click:disabled` changes only the cursor). Add a
  token colour (`--faint`) on the name under `:disabled`.
- **AssetSidebar: `.thumb` fill uses `--border-soft`** (matches ref 1721 by value, but it is a border token).
  Design call: a fill token, or keep.
- **MarkdownEditor: `frozen` lets an upload already in flight finish** (its ref is not inserted;
  `refreshKey` bumps). Same as `disabled`; unreachable in 5b (Save is disabled while uploading). Abort it
  on freeze if "blocked" must be literal.
- **MarkdownEditor: `frozen` disables (and so blurs) a focused sidebar control** — trash, row, Confirm.
  The textarea keeps focus as promised; D10 accepts disabled structure controls.
- **MarkdownEditor: `plain` flipped true → false with `readOnly` set leaves an empty preview**
  (`loadPreview` runs only in onMount). Not reachable while the modal is open.
- **Hand-off to T3a: plain mode drops `ariaLabel` / `ariaDescribedby`** — the `pre` has no accessible
  name. PageBody should label its wrapper (visible label or `aria-labelledby`).
- **Tests not yet written:** Escape on the inline Cancel inside the real `Modal` (the delegated handler
  runs before `svelte:window` — a capture-phase listener would silently break it); an in-flight upload
  then a freeze; a wrapper drop while frozen.
- **Gate (ab) gaps:** the two `@media (max-width: 880px)` rules are not pinned; `textarea` background
  is not pinned; `emoji_scan` reads source, so an escaped glyph (`{'\u{1F5D1}'}`, `&#x1F5D1;`) evades it.
  The older 5a sections' `no rem font sizes` checks keep the class-led-only prefix (they miss element-led
  rules); (ab) now uses sweep's selector-agnostic prefix.
- **AssetSidebar: focus after a delete — lost-focus-only rule.** Every `fetchAssets` swaps the whole list
  out (`loading`), destroying any focused row control. `refocusAfterDelete` acts only when Confirm closed
  the pair and treats focus anywhere in the aside as movable. Gaps: (a) a second confirm opened while
  the first delete is in flight loses its Cancel focus on the refetch → `<body>`, and the next Escape
  closes the enclosing modal; (b) Cancel clicked during an in-flight delete → `<body>`; (c) focus the
  author moved within the aside (drop zone, a row) jumps to the neighbour trash; (d) a disabled neighbour
  falls through to the drop zone even when an enabled trash sits further on. Fix: always run the refocus
  after the refetch but only when focus fell to `<body>`; focus `cancelEls[confirmId]` if a confirm is
  open; otherwise search forward then back for the first enabled trash.
- **AssetSidebar: Escape while a confirm is open but focus is on the row's insert button** still closes an
  enclosing modal (R7 scopes Escape to the pair). Polish if "confirm open ⇒ Escape = Cancel" is wanted.
- **Tests: the "focus after a confirmed delete" `settleAll`** is a fixed 4-microtask loop; an extra await
  in `confirmDelete` would turn them red (never falsely green).

