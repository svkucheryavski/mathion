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

## T3a — ItemEditorModal + PageBody (interim quiz/app)

- **ItemEditorModal: a mouse-clicked Save or Discard drops focus to `<body>`** (the button disables while
  saving / once clean). The next ⌘S then misses the dialog scope and opens the browser's own Save
  dialog; the next Tab starts behind the modal. Fix: in `save()`'s finally and `discard()`, refocus Title
  (or Save / ×) when focus fell to `<body>`. (Both lanes.)
- **ItemEditorModal: ⌘S is scoped to any `section.modal-panel`**, not this modal's own — a stacked modal
  (Slice 6) would save the item underneath. Fix: compare against the own panel.
- **PageBody: plain / readOnly branches have no accessible name** (the T2 hand-off was not applied here).
  Fix: `role="group" aria-label="Content"` on a wrapper, or carry `ariaLabel` onto MarkdownEditor's `pre`.
- **Header spacing: trash and × sit 10px apart** (Modal's head gap) where ref 1689 groups them at 6px.
  Spec §2's "Modal adds ×" sanctions it. Fix: a Modal `actions` snippet rendered beside ×, or document it.
- **PageBody `busy` can stick true** if the MarkdownEditor branch flips (editable → plain/readOnly)
  mid-upload — not reachable in 5b. Fix: reset `uploading` on branch change / MarkdownEditor onDestroy.
- **Interim (closes in T5a / T4 — reviewers there should check):** a disabled quiz shows two notes (the
  modal's D6 note and QuizEditor's "This version is read-only"); quiz `questionsLocked`/`saveBusy` and the
  app editor's own PATCHes are not folded into `bodyBusy`; `frozen` is not passed to QuizEditor /
  InteractiveAppEditor during a title-only save.
- **Gate (ac) gaps:** `.item-name` pins `text-overflow:ellipsis` but not `overflow:hidden`,
  `white-space:nowrap`, `min-width:0`; `.plain-input` `width`/`box-sizing` and `.field` gap unpinned.
- **Tests not yet written:** double Save / ⌘S while saving; ⌘S default-prevented when blocked; the
  `'error'` refresh toast; the `!stillOnVid` "Saved" path; `reportSaveFailure` 403/409 forced reload;
  the × fallback after the delete freeze; autofocus on a published version.

## T3c — VideoBody

- **A server-rejected URL shows only a toast.** A scheme-less paste (`www.youtube.com/watch?v=…`),
  `ftp://…`, an uppercase `HTTPS://`, or a URL over 500 characters passes `normalizeVideoUrl` unchanged
  and the server 422s ("Please correct the highlighted fields" / "URL must start with http:// or
  https://") with no inline error, `aria-invalid` or focus. Fix: mirror the backend's prefix and length
  rules in `validate()`, or prefix `https://` for scheme-less YouTube/Vimeo URLs in `normalizeVideoUrl`.
- **VideoBody duplicates ItemEditorModal's field CSS** (`.field-row`, `.field-label`, `.field`,
  `.plain-input` ×3, `.field-err`, `.ro-value`). Until T4's (ad) they are unchecked; T4 must repeat the
  full D12 `d`/`chk` set plus `sweep VideoBody`. Longer term: one shared field component (5a create form,
  modal Title, VideoBody).
- **A dirty-but-equivalent URL sends a no-op PATCH** (`  EMBED  ` normalises to the saved value). Harmless.
- **Tests not yet written:** a non-identity echo (the write-back takes the server's string, not the sent
  one); a failed PATCH keeps the draft dirty; empty title + empty URL (R9 focus ends on Title); the
  500 ms debounce and the preview returning after Discard (T4 owns the card).


## T3b — Item route hosted by VersionEditPage

- **A late DELETE success can steal focus.** Open an item in-page and press Trash with a slow DELETE.
  Press Back, open "New item" and type. When the DELETE resolves, `deleteOpenItem` focuses
  `#seq-…-header` (VersionEditPage ~:297) and the next Space toggles the sequence. The code follows
  D9's wording, but D18 says focus is never stolen. Fix: focus the header only when focus has dropped
  to `body`/null; the normal path still works because the reload removes the restored pencil.
- **B's trash does nothing while A's DELETE is in flight.** Back during A's DELETE, open B, click
  Trash: `deleteOpenItem` returns early with no confirm and no feedback. Fix: pass
  `deleteBusy={deletingIid !== null}` into the modal's `trashDisabled`, or toast from the early return.
- **No toast after a DELETE that succeeds following a version switch.** The `!stillOnVid` bail
  returns before "Item deleted". Fix: toast before the bail, or document why it is silent.
- **The `deletedIid` exemption cannot be reached in the host flow.** `navigate(…, {force})` moves the
  route to S synchronously, so no flush sees `routeIid === deleted` with a tree that lacks it. Only
  the unit test discriminates. Keep it as belt-and-braces, but reword the comment in
  `handleStaleIdFallback.ts`.
- **Stale effect-order comments in VersionEditPage.** The load effect still says "load → validation →
  focus". The focus effect still says "declared THIRD" and omits `routeIid` from its tracked list.
  The create-tracker effect still says "FOURTH". The new order is load → validation → item-route →
  focus → create-tracker.
- **`App.editorRoutes.svelte.test.ts` oversells itself.** The header comment and describe title claim
  it reproduces "the 5a Back-freeze". Step 8 showed jsdom cannot reproduce that freeze; it is a
  routing smoke test. Reword both (T7 sweep).
- **Tests not yet written:**
  - A deep-link open keeps autofocus on Title: removing the `iid !== null` early return in the focus
    effect survives the suite.
  - Forward after a close reopens the item, and × then calls `history.back()` exactly once.
  - A deep-link delete keeps `[X, S]` and never calls `history.back()`.
  - A DELETE that fails while item B is open.

## T4 — Video preview card, AppBody, frame heights

- **The app preview restarts on every tree reload** (both lanes; this predates T4). AppBody's fetch effect reads `item?.script_url` off a fresh `item` object after every `loadAdminTree`. A title Save therefore refetches the source, unmounts the iframe and loses the app's state. Fix: `const filename = $derived(item?.script_url ?? null)` and read `filename` in the effect. Add a test: no second `/assets` GET after a title Save.
- **The wrong message when the link PATCH fails** (predates T4). Scenario: the version is archived in another tab mid-upload. `PATCH script_url` returns 409, the user sees "A file with that name already exists…", and the 403/409 forced reload never happens. Fix: show the duplicate-name message only when `!uploaded`. On 403/409 with `stillOnVid`, force `loadAdminTree`.
- **"App uploaded" / "App removed" toast success even when the refresh fails.** `loadAdminTree` returns `'error'` rather than rejecting, so the row keeps showing the stale value. Fix: check the result and use the modal's "(refresh failed — reload to see latest)" info toast. The "linked asset kept when only the refresh fails" test mocks a rejection that cannot occur in practice. It still guards the `linked` gate.
- **AppBody `.field-err` sits under the label column**, not under the value as in the D12 Title/Video URL pattern. Fix: wrap `.script-row` and the error in a `.field` column, as VideoBody does.
- **A file chosen while frozen is dropped silently.** The early return comes before `input.value = ''`. This is practically unreachable, because the input is disabled. Fix: clear `input.value` before the guard.
- **Colour-mapping comments are misplaced** in the VideoBody and AppBody `.preview-foot` rules. "#F0F1F4 → --border-soft" belongs on `border-top`; the background's mapping is "#FCFCFD → --surface-3".
- **(ad) frame-hash anchors depend on declaration order.** `\{position:relative;padding-bottom:56\.25%` / `\{width:100%;height:600px`: if either source rule is reordered, the check fails loudly, with a misleading "not unique (… 0)" message. Fix: `\{[^}]*padding-bottom:56\.25%` / `\{[^}]*height:600px`.
- **(ad) pins are incomplete.**
  - VideoBody:
    - `.preview-foot` lacks `align-items`;
    - `.preview-empty` lacks `margin:0`;
    - `.plain-input[aria-invalid]`, `.field` and `.ro-value` are unpinned. The T3c debt asked for the full D12 set.
  - AppBody:
    - `.preview-head` lacks `align-items`/`gap`;
    - `.preview-foot` lacks `display`/`gap`/`padding`;
    - `.preview-title`, `.preview-meta` and `.field-label` are unpinned;
    - `.script-name` lacks `overflow`/`white-space`/`min-width`.
- **Tests not yet written:**
  - `frozen` disables Upload/Replace/Remove (start a slow title Save);
  - enabled → disabled while `ready` drops the card and fetches nothing more;
  - the link `href` is the sanitized URL (use one that `safeIframeUrl` canonicalises, or assert before the debounce);
  - the Replace label after a successful upload;
  - `stillOnVid` false → no reload after upload/remove;
  - a Replace mid-fetch aborts the earlier fetch.
- **Not a defect** (ruled): one lane read `.warnings` bullets as colliding with the left rule, but `styles/reset.css:16` sets `ul { list-style: none; padding: 0 }`, so no markers render.

## T5a — Quiz drafts and one Save

- **A stale `save-error` / `save-note` after the author types the value back.** A failed question that is typed back to its baseline is clean, so it is skipped by Save and by `discardAll`, and the red message stays until the accordion remounts. Fix: clear `lastError` / `saveNote` in an effect when `!dirty`.
- **A two-correct single-choice key takes two clicks to repair.** When the server holds two correct options, the browser shows only the last radio (B) checked. Clicking B fires no `change` (OptionRow `onchange`), while the header still reads "2 correct". Fix: `onclick={() => onMark(true)}` on the radio. `mark()` is idempotent.
- **The question editor isn't focused when it is on its Preview tab.** `focusInvalidNow` looks for `[data-field="text"] textarea`, which MarkdownEditor renders only in edit mode. The error text and header mark still show. Fix: switch the editor to edit mode, or focus its tab button.
- **⌘S with focus on a correct-mark radio or checkbox drops focus to `<body>`.** `frozen` disables checkables, and a disabled control loses focus. This is the same family as the mouse-Save focus loss. Fix: refocus in the modal's `save()` `finally` when `activeElement === body`.
- **The add-question inputs stay writable while frozen** (QuizEditor `new-question-text` / `new-numeric` / `new-precision` / `new-text-answer`). This is harmless because Save never sends them, and T5b rewrites these forms. Fix: `readonly={frozen}`.
- **The toast "Save again to send the rest."** also appears when the failing question was the only dirty part. The wording is mandated by the brief.
- **A test describes the server as trimming option text, but it doesn't.** QA test ~:289 says the server's normalised echo is written back, but `OptionUpdate.text` has no strip, so the real echo is `'Alpha '`. Behaviour matches the old blur-commit. Fix: reword the test, or trim client-side as the question fields do.
- **Tests not yet written:**
  - the `setOptions()` merge: dirty text on A, then a failed reorder and a resync with new server text for A and B. A keeps its draft, B follows the server, and only A is dirty;
  - the full save-order rank: text-only after `false`, `{is_correct:true, text}` ranked with the trues, multiple-choice B:true before A:false;
  - dirty-scoped validate against a clean-but-invalid question (numeric with `correct_numeric: null`). The current tests use a valid clean question, so removing `dirty &&` from `needsFix` stays green;
  - contributor unregister on delete: the deleted question no longer counts for `busy` / `saveDirty` / `save()`.
- **(Round 2) The post-await vid/alive guards return `'failed'` after a PATCH has landed** (QuestionAccordion `save()`: after the question PATCH and after each option PATCH). This is unobservable today, because `stillOnVid` is false there, so the modal skips both the reload and the toast. For consistency, return `'partial'`. *(Final review: the claim was wrong for an unmount while the page stays alive (close during Save). Fixed. × and Escape now freeze while saving, and an option plan always runs to the end once it starts.)*
- **(Round 2) A 403/409 after a landed part triggers two forced reloads.** The accordion's `fail()` reloads, and the modal reloads again on `'partial'`. This is harmless. Fix: skip the accordion's reload when `landed`.
- **(Round 2) The partial-inside-a-question modal test doesn't assert `not.toContain('Saved')`.** The title-partial test does. Add the assertion.

## T5b — Quiz structure with live drafts

- **Marks stay editable while an option DELETE is in flight.** If C is deleted with no confirm while the author marks C, no option is left drafted correct. Save is then blocked by `markError`; this is visible and recoverable. With a D24 reset, a mark changed during the request is reset on success, against the D10 rule "a reset never wipes input made after the request left". Fix: add `mutating` to OptionRow's mark `disabled`.
- **Question and option structure are not serialised against each other.** `structureDisabled` doesn't read the question's own `optionsLocked`, so "Delete question" is clickable while one of its option DELETEs is in flight. Nothing is corrupted: the stray resync 404s silently. Fix: add `optionsLocked` to `structureDisabled`.
- **The D24 confirm text when the option has a text draft** is untested, and a whitespace-only draft reads `Delete option "   "?`. Fix: add a text draft on the deleted row in the D24 test, and fall back to the saved text when the draft trims to empty.
- **A typed add form keeps × prompting after the footer Discard** (by design, D5). The footer then shows no "unsaved changes" while × still asks. Revisit in the Safari pass. A muted "unsent form" hint is an option.
- **Closing while an add-question POST is in flight**: the guard prompts, the author confirms, the form collapses, and the question still lands server-side. This matches the 5a create forms.

## T6 — Quiz look (3f)

- **The `+` / `×` add toggles set `aria-expanded` but not `aria-controls`** (QuizEditor's Add question, QuestionAccordion's Add option). `q-toggle` does set it. Fix: give each form an id and pass `aria-controls={adding ? formId : undefined}`.
- **The toggles keep `aria-label="Add question"` / `"Add option"` while titled "Cancel new …".** A screen reader hears "Add question, expanded" for the close action. The aria-labels are frozen contracts, so this is acceptable. A later polish could add `aria-describedby` to the title.
- **Escape on a typed add form prompts for the whole modal** instead of collapsing the form. 5a's collapsed forms behave the same. Fix: an Escape `onkeydown` on the `<form>` that calls `toggleAdd()` and prevents the default.
- **Enter-submit is untested.** Add `form.requestSubmit()` tests: an invalid form sends no POST, and two synchronous submits send one POST. By reading, both guards hold.
- **Three look claims have no discriminating test:**
  - the option legend's `sr-only` class;
  - `mono` on `.q-badge` / `.q-type` / `.q-count`.

  Add `classList.contains(...)` assertions to the header tests.
- **Gate (ae) leaves emitted rules unpinned:**
  - `.q-toggle`: `padding:0` / `color:inherit` / `font:inherit` (the button reset);
  - `.q-title`: `flex:1` / `min-width:0`;
  - `.question`: `background`;
  - `.questions-head`: `padding-top:2px`;
  - `.mark`: `flex:0 0 auto`;
  - QuestionTypePicker's visually-hidden input and its `:disabled label` (Constraint 2, the "no opacity dim" rule). This one deserves a `chk`.
- **(Round 2) A resync never refreshes a surviving question's `saved` baseline or header snippet.** The accordion seeds them once, so a clean question doesn't pick up another admin's remote edit after a failed reorder, delete or add. The old remount path did pick it up. Later saving that question overwrites the remote edit (the API is last-writer-wins). The lanes split on this. One wants a `setOptions`-style merge: a clean field follows the server and a dirty field keeps its draft. The other wants D10, where baselines come only from PATCH echoes. Decide before changing it, and don't "fix" it silently.
- **(Round 2) The resync-failure toast is `'error'`.** It stacks a second red toast under the operation's own error. The modal's equivalent secondary notice is `'info'`. Fix: `'info'`.

## T7 — Clean-up, carry-overs, gate (af)/(ag)

- **The (ag) scanner is regex-based, not a CSS parser.** Several inputs are outside its contract:
  - an inline `style={…}` expression (only literal `style="…"` attributes are read);
  - colour literals in `.ts`-built style strings;
  - a trailing `//` comment after code (Constraint 11 already forbids colours there).

  It also misses:
  - declarations before a nested CSS rule (`.a { color: red; .b {…} }`);
  - a `"/*"` inside a CSS string, which swallows the rules after it;
  - `style:prop=` directives;
  - `.css` files: none is read, though Constraint 11 (spec :46) says the scan covers them. No `.css` file was touched in 5b, so the spec sentence overstates the scan.
  - `oklch` / `hwb` / `lab` / `color()`, which are outside the spec's literal definition.

  False positives: colour words inside `url(…)` (`red.png`), font names (`Tan`) and animation names (`gold`).

  None of these occurs in today's 17 files. Widen the scanner only if a later slice adds one of these shapes.
- **Constraint 11's scope sentence lists "untouched files" as examples, not an enumeration.** The exemptions now live in two places: the spec line under Constraint 11 and the comment above `FILES_5B`. Slice 6 adds MiniProjectModal and the run modals back to (ag) when it restyles them (D21). Keep the two places in step.

## Final whole-branch review — deferred minors

- **A disabled quiz shows two notes** (both lanes). The modal's D6 note and QuizEditor's own "This version is read-only — editing is disabled." (`QuizEditor.svelte:325`) both appear. The T3a interim entry said this closes in T5a, but it didn't. Fix: render QuizEditor's `.note` only when `!versionDisabled` (archived keeps it).
- **The trash, when disabled by `bodyBusy`/`frozen`, still reads "Delete this item"** (Fable). A disabled control should state its reason. Fix: a third title branch.
- **A typed add-question/add-option form keeps the trash disabled while the footer shows nothing to discard** (Opus). The tooltip says "save or discard changes first", but Discard is disabled. This is the twin of the T5b footer-Discard vs × entry. Fix: a tooltip that names the open form.
- **Plan ruling R15 is stale** (both lanes). Since the T5a fix, a question that landed part of its PATCHes returns `'partial'`. The spec was updated in T7; the plan wasn't. Doc-only.
- **× has no reason tooltip while frozen** (saving/deleting). It is disabled with the plain "Close" title.
- **⌘S with focus on × drops focus to `<body>`** (final round 2, Opus). Since the fix, × disables while saving, so focus on it falls to `<body>`, and the next ⌘S opens the browser's Save dialog. This is the same family as the mouse-Save focus loss (T3a entry, :90). The `save()` `finally` refocus suggested there covers this too.
- **A server failure mid-plan after a confirmed browser Back is silent** (final round 2, Fable). The plan now finishes after unmount, but `QuizEditor.svelte:161` gates the partial-failure toast on `alive && stillOnVid`, so a failing `{is_correct:false}` PATCH leaves two correct options with no feedback. Rare: it needs both a confirmed discard and a server error. The Toaster is global. Fix: drop `alive &&` for the failure toast when `stillOnVid(savedVid)`.
