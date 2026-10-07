# Visual Refresh — Slice 5b: Authoring — Item Editor Modal (3c + 3e + 3f) — Design Spec

**Status:** Design — **rev 7** (brainstormed with the user 2026-10-07; self-checked; revs 2-7 fold six rounds of two-lane review; round 7 clean in both lanes — see §Review resolutions). Next: user review → writing-plans.

**Authority:** `docs/design/visual-refresh/reference-screens.dc.html` (artboard **3c** `:1649-1758` page, **3e** `:1759-1835` video, **3f** `:1836-1969` quiz; `ref NNNN` below are line numbers in that file) and `docs/design/visual-refresh/mathion-visual-spec.md` (§4 "Item editor modal (3c, 3e, 3f)" `:212-229`, Icon button `:168-181`, §3 colour of state `:110-133`, type-name rule `:230`). Where the two disagree, the spec's *rules* win over the artboard's *pixels*. **User decisions** (§Decisions) override both, and each override is recorded.

**What this slice does.** Opening an item stops routing to a separate page (`pages/editor/ItemEditPage.svelte`, deleted). Instead a **modal opens over the version editor**. Four item types share one frame: page (3c), video (3e), quiz (3f) and interactive app (no artboard; borrows 3e). The slice also adds a **generic modal frame** (`ui/Modal.svelte`). Slice 6 will reuse it for `runs/{NewRunModal, PublishConflictsModal, RosterImportModal, MiniProjectModal}` (10k/10l/10m and the roster import). 5b leaves those four as they are, except a one-line Escape guard in `MiniProjectModal` (T2).

**Carried in from 5a** (`docs/backlog/slice5a-authoring-polish-debt.md` §"Browser pass (2026-10-07) — requirements carried to Slice 5b"):
- **(1) The Back freeze.** It is removed by design. With ItemEditPage gone, no page swap shares the editor store (§2).
- **(2) The disabled-version preview.** Decided below (D6).

Branch `feat/visual-refresh-slice5-authoring`, continuing from 5a's tip `736bbd4`. **LOCAL — not pushed, not merged.**

---

## Global Constraints

Constraints **1-10 are inherited verbatim from the Slice-5a spec** (`2026-10-06-…-slice5a-…-design.md` §Global Constraints):
1. colours → existing tokens only (no new colour tokens; delete every hex literal in touched files);
2. no opacity-based dimming;
3. no emoji or decorative glyphs (SVGs `aria-hidden`, `viewBox="0 0 16 16"`, `stroke="currentColor"`, 1.6 / 1.9 for the check, round caps and joins);
4. mono for every numeral;
5. per-component literal forms (a) `/* ref NNNN */`, (b) scale named, (c) mechanism — geometry only;
6. dense control metrics are final (`ui/Button.svelte` as-is);
7. `ItemMark` as-is;
8. **no backend/API/schema change**;
9. the commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, no `Claude-Session` line, and `git add` of exact named paths only;
10. the per-task process: Opus reviewer plus a second lane on the **uncommitted** diff, fix every Critical/Important, re-review after every fix, commit only when both are clean, and the user's OK closes the task.

Additionally:

11. **Literal colours in 5b-touched files.**
    - Two literal colour values are allowed, in exactly one file, `ui/Modal.svelte`. Each is annotated `/* ref 1684 */` and `/* ref 1682 */` (spec :216-217):
      - the panel shadow `0 16px 44px rgba(20,24,35,.22)`;
      - the backdrop `color-mix(in srgb, var(--text) 34%, transparent)` (= `rgba(22,24,29,.34)`).
    - No other 5b-touched file may contain a *literal* colour. A literal colour is any of:
      - a hex value;
      - `rgb(` / `rgba(` / `hsl(` / `hsla(`;
      - a CSS named colour;
      - a `var()` fallback that is any of the above.
      
      This also applies inside a `box-shadow`.
    - **Not literal colours:** the keywords `transparent`, `currentColor` and `inherit`, and CSS system colours (`Highlight`, `CanvasText`, …) inside `@media (forced-colors: active)`. That last exemption is 5a Constraint 1's, used by `ItemTypePicker.svelte:59-61`.
    - **Comments are exempt,** as in 5a Constraint 1 (e.g. `/* #E9EBEF → --border */` notes and the hexes in `MiniProjectDetailPage.svelte` comments).
    - **The (ag) scan covers** only CSS contexts: `.svelte` `<style>` blocks, inline `style=` attributes and `.css` files. It never scans `.ts` or test files, where `:` also starts object values and type annotations. A named colour matches only as a **whole value token**, never inside a `var(--…)` name (`--gold-text` is a token, not a hit). It strips `/* */` and `<!-- -->` comments first, plus `//` comments **only on lines where `//` is the first non-blank token**. It never strips mid-line `//`: CSS has none, and stripping it would eat the rest of any line holding `https://`. A trailing `//` comment after code must therefore not hold a colour literal (rule for 5b-touched files). The scan then matches named colours only in value position (after `:`, so `white-space` is not a hit), and reuses the 5a mechanism for the forced-colors scope.
    - `box-shadow` with token colours stays allowed: the D12 focus ring is the existing `base.css:21-25` / `InlineField.svelte:297` pattern, and the MarkdownEditor flash uses `--danger`.
    - Untouched files (`Toast`, the run modals, `Login`) are out of scope.
    - `MiniProjectModal.svelte` received only T2's one-line Escape guard. It stays out of (ag) until Slice 6 restyles it (D21).
    - `Modal.svelte` may also carry `-webkit-backdrop-filter`, duplicating `backdrop-filter` for Safari < 18 (the user tests in Safari).
12. **Gate discipline as in 5a.** Every new section is hash-anchored (`own` + `uniq1`), carries positive pins with paired negatives, a `sweep`, a "no rem font sizes" check and an emoji source scan. `EXPECTED_CHECKS` is bumped exactly.
13. **Stay in the project directory.** That covers scratch files, gate temp files and reviewer probes. The gate's `mktemp "${TMPDIR:-/tmp}"` (`visual-refresh-gate.sh:92`) is run with `TMPDIR` pointing into the plan workspace.
14. **Every commit is green.** Each task ends with the full suite, `npm run check` (0 errors, warnings not growing) and the gate all passing. No task may leave an item type broken for a later task to fix (§Task decomposition gives the interim wiring).

### Reference hex → token mapping (3c/3e/3f)

| reference | where | token |
|---|---|---|
| `#fff` | panel, inputs, closed question header, option rows, play button | `--surface` (glyph on primary: `--primary-text`) |
| `#16181D` | item name, values, active tab, headings, Q title, option text | `--text` |
| `#2A2F3A` | markdown pane, question text | `--text-2` |
| `#3D4350` | icon-button glyphs | `--text-3`, but `IconButton` keeps `--muted` (5a D7) |
| `#5A616E` | mono context, labels, inactive tab, Discard, sizes, type names, drop zone, meta, counts | `--muted` |
| `#B4B9C4` | disabled glyphs and buttons | `--faint` |
| `#3F5C77` | type tile, Save, caret, play glyph, link, Q badge, `+` fill, correct row border and radio | `--primary` |
| `#EAEFF4` | correct-option row | `--primary-soft` |
| `#F5F6F9` | active tab, preview header and player, open question header | `--surface-2` |
| `#FCFCFD` | footer, asset sidebar, preview footer | `--surface-3` |
| `#FBFBFC` | disabled button fill | `--bg` |
| `#E3E5EA` | header and footer rules, card borders, tab rule, sidebar rule | `--border` |
| `#DDE1E9` | panel border, icon buttons, play ring, drop-zone dash | `--border-strong` |
| `#EDEFF2` | disabled button border | `--border-faint` |
| `#F0F1F4` | preview-footer rule (1821); asset type-tile fill (1721) | `--border-soft` (the tile fill reuses it: same value, no fill token — recorded) |
| `#E9EBEF` | preview / open-question header rule, option-row border | **no token** → `--border` (5a precedent) |
| `#C4CAD4` | unselected radio ring | **no token** → `--border-strong` (Slice-3 precedent) |
| `#991B1B` | trash glyphs | `--danger` |
| `#065F46` / `#D1FAE5` | `used` and `correct` badges | `--status-accepted-fg` / `--status-accepted-bg` |
| `#92400E` | footer "unsaved changes" | **no token** → `--status-needs-revision-fg` (#7A4E0B; amber = "act on this", spec :120). Not `--gold-text` (gold is chrome, never state) |
| `#5D4037` / `#FFF8E1` / `#F9A825` | the asset-sidebar hint box (legacy hexes) | **no token** → the information-banner treatment (D11) |
| `rgba(22,24,29,.34)` / `rgba(20,24,35,.22)` | backdrop, shadow | Constraint 11 |

### Decisions

User decisions (brainstorm 2026-10-07) are marked **(user)**. The rest are mine; each states what it costs if wrong.

- **D1 (user) — The item stays in the URL.** `/courses/:courseSlug/edit/v/:versionId/blocks/:blockId/sequences/:sequenceId/items/:itemId` is served by **`VersionEditPage`**, which hosts the modal. `ItemEditPage` is deleted. Back, reload and shared links work.
- **D2 (user) — No pencils inside the modal.** Title, Video URL, question text and answers are **plain input fields**, and **one footer Save/Discard** commits everything. This is a deliberate override of the 3c/3e/3f pencil rows (refs 1699, 1806, 1811, 1883, 1906). The row grid drops the 54px slot (`132px 1fr`).
- **D3 (user) — The quiz's footer Save covers all text and answers:** title, question text, explanation, numeric answer and precision, text answer, option text, and correct marks. **Structure acts immediately:** add, delete and reorder for questions and options, as for blocks in 5a.
- **D4 (user) — Interactive app borrows the 3e layout:**
  - a Title field, saved by the footer;
  - an **App script** row with Upload / Replace / Remove, which act immediately because they are files;
  - a **Preview** card running the app.
- **D5 (user) — The 5a discard-prompt rule (D3 there) holds inside the modal.** ×, Escape, Back and every in-app navigation prompt "Discard unsaved changes and continue?" through the page's existing `DirtyGuard`.
  - **"Unsaved" means the same thing as in 5a:** a changed field, *or* an open create form with typed input. That includes the quiz's add-question and add-option forms.
  - **The modal therefore keeps two signals:**
    - **`guardDirty`** = save drafts or a typed create form. This feeds the page registry (the prompt) and D9's delete gate.
    - **`saveDirty`** = save drafts only. This feeds the footer's "unsaved changes", Save and Discard.
  - **Footer Discard** resets save drafts only. **A confirmed close** (`discardAll`) resets both and collapses the create forms.
- **D6 (user) — Disabled version: read-only text plus a calm note, with no server call.**
  - Page bodies and quiz question text show their markdown as plain mono text, and the interactive app shows no preview.
  - Page, quiz and app carry the note *"Preview is unavailable while this version is disabled — enable it to preview or edit."*
  - **Video (user, T3c review):** its preview is an external iframe and stays (§4), so a disabled video item's note reads *"Editing is unavailable while this version is disabled — enable it to edit."*
  - Nothing calls `/render` or fetches assets. The deliberate 403 (`backend/mathion/api/versions.py:185-186`) stays, but the UI no longer provokes it.
  - Archived versions still render (the server allows it).
  - **Plumbing.** `perms.canEditTextFields` is false for *both* archived and disabled (`versionPermissions.ts:22`), so it can't select plain mode. Instead an explicit `versionDisabled: boolean` (= `version.is_disabled`) is passed down:
    - `ItemEditorModal` → each body;
    - `QuizEditor` → `QuestionAccordion` → `MarkdownEditor plain`;
    - `PageBody` → `MarkdownEditor plain`;
    - `AppBody` → its preview gate.
  - **Task:** the quiz leg (`QuizEditor` → `QuestionAccordion` → `MarkdownEditor plain`) lands in **T3a** together with the interim wiring, so a disabled-version quiz never calls `/render` between tasks (Constraint 14).
- **D7 — Close semantics.** × and Escape call the page's `requestCloseItem()`:
  - **If the modal was opened from within this page instance** (an Open pencil, a create-item success, or Forward onto it), close = `history.back()`. Back and × then behave identically and history doesn't grow.
  - **Otherwise** (a deep link, or a reload on the item URL), close = `navigate(seqUrl, { replace: true })`.
  - **Re-entrancy latch.**
    - `requestCloseItem()` sets `closing = true` and returns at once if `closing` is already set. This stops a double ×, Escape-then-×, or Escape auto-repeat from issuing a second `history.back()` that would pop past the sequence page (possibly out of the app).
    - `closing` clears in the `routeIid` effect (the item closed) and in a window `popstate` listener, so a guard cancelled at the prompt re-arms it.
    - `Modal` also ignores Escape with `e.repeat`.

  Both paths run the dirty guard. Cost if wrong: one extra history entry or one lost Forward entry.
- **D8 — Clicking the backdrop does nothing.** This avoids losing edits by accident.
  - `ui/Modal` offers `closeOnBackdrop` (default `false`) for Slice 6.
  - A `mousedown` on the backdrop calls `preventDefault()`, so focus stays inside the panel.
- **D9 — Header delete.**
  - **Enabled** only when the structure is editable, `guardDirty` is false and the body is not busy (`busy`, §2), as in 3c/3e/3f.
  - **Tooltips:**
    - the structure reason, when structure is forbidden;
    - else *"Delete this item — save or discard changes first"*;
    - else *"Delete this item"*.
  - **Ownership.** The delete flow lives in **`VersionEditPage`** (`deleteOpenItem()`), not in the modal. The modal's trash button just calls it. This matters because the modal unmounts as soon as the route leaves the item, and its `alive` flag would then skip the reload and the toast. The page's own `stillOnVid` gates every step, as `SequenceAccordion.deleteSeq` does (`:109-116`).
  - **On confirm** (`confirm('Delete item "…"? This cannot be undone.')`):
    1. **Freeze the modal.** Set page state `deletingIid = id`. The modal receives `deleting = (deletingIid === item.id)`, so another item opened via browser Back + Open is never frozen. While it is set:
       - the modal body is **`inert`** via a new `Modal` prop `bodyInert` on `div.modal-body` (a wrapper would break the body's gap and `flex: 0 0 auto` rule). Losing focus is fine during a delete. This also covers checkable inputs and the T3a interim bodies. With every header and footer button disabled too, focus falls back to the panel itself (`tabindex="-1"`, §1);
       - Save, Discard, trash and × are disabled;
       - Modal's Escape is ignored (`closeDisabled`);
       - `requestCloseItem` returns early **only** when `deletingIid !== null && String(deletingIid) === routeIid`.
       
       Nothing can make the item dirty or issue a second close while the request is in flight.
    2. `DELETE /api/items/{id}`.
    3. **On failure:** the error toast, a forced reload (`stillOnVid`-gated), then clear `deletingIid` and `await tick()`. The modal stays open; focus returns to the trash button, or to × if trash is still disabled (the disabled trash had dropped focus to `body`).
    4. **On success:** record `deletedIid = id` only if `routeIid === String(id)` (otherwise the user already left, and nothing needs suppressing). Then:
       - if `routeIid === String(id)` (the user hasn't already left with the browser's own Back), set `closing = true` and close the item with **`navigate(seqUrl, { replace: true, force: true })`**. The delete never uses `history.back()`: a user Back press queued just before the DELETE resolves would otherwise be followed by a second traversal past the sequence page. Cost: an in-page open leaves history `[S, S]` (one dead Back), as D19 already accepts;
       - force a tree reload (await it);
       - toast "Item deleted";
       - focus the sequence header, only if `routeIid === null && stillOnVid(savedVid) && routeSid === String(savedSid)` (the deleted row's pencil is gone; D18);
       - clear `deletingIid`.
  - **Stale-item check.** It treats `staleIid && routeIid === String(deletedIid)` as an expected close in flight: no toast and no navigation. (`staleIid` is a boolean flag, like `staleBid` / `staleSid`.) `deletedIid` clears when `routeIid` becomes `null`.
  - Cost if wrong: one suppressed "Item not found." in a race nobody can trigger by hand.
- **D10 — Footer Save.**
  - **One click sends everything.** The modal stays open, and **⌘S / Ctrl+S** inside the modal also saves.
  - **Validation runs before anything is sent, and only over what this Save would send.** It checks the dirty title and **dirty contributors only**; a clean question never blocks a Save.
    - **Field rules:** empty title, empty video URL, empty question text, invalid numeric answer, option text outside 1-500.
    - **Correct-mark rule:** applies only to a question whose *mark drafts* differ from saved, and only when it has at least one option. Single choice needs exactly one correct; multiple choice needs at least one.
    - **Exempt:** a choice question with zero options, or with options that failed to load (as created by design, `QuizEditor.svelte:147,303`).
    - **If anything is invalid,** nothing is sent:
      - every invalid field shows its inline error (the correct-mark error sits on the question's **Options** heading row);
      - the first invalid question is expanded and its first invalid field focused;
      - each invalid question's header shows the mono text `needs fixing` and `aria-invalid="true"` (not colour alone);
      - the toast reads "Fix the highlighted fields".
  - **Busy interlock.**
    - While Save is running, every input in the modal is **read-only without losing focus**:
      - plain text inputs get the `readonly` attribute, never `disabled` (a focused input that becomes disabled is blurred);
      - **checkable inputs** (correct-mark radios and checkboxes) ignore `readonly`, so they get **`disabled`** while frozen; there is no caret to lose;
      - `MarkdownEditor`s get the new `frozen` prop (T2): the textarea's `readonly` attribute, and drops, sidebar inserts and uploads blocked, like the existing `disabled` guards (`MarkdownEditor.svelte:67,184,204`). Its `readOnly` switches to preview and `disabled` blurs, so neither is used here.
      
      The main gesture (type, then ⌘S) keeps the caret where it was.
    - Every structure control (add/delete/reorder, upload/replace/remove) is disabled while saving.
    - Save, Discard and ⌘S are disabled while any structure operation, app-script upload or asset upload is in flight. Each body exposes a bindable `busy` for this, which includes every inner `MarkdownEditor`'s `uploading`.
    - **After a successful part,** `saved` takes the server's echo, and **each field that was in that request** gets `draft.x = saved.x`. This applies to every body: page, video, app title and quiz.
      - This is needed because the client normalises before sending, and the server may normalise too: `correct_text` is trimmed, a numeric `"2.50"` comes back as `"2.5"`, and the Video URL comes back in embed form. Whatever the server echoes is written back.
      - It is safe because inputs are frozen while the request is out, so no newer input can be overwritten.
      - Fields that were not sent (other questions, untouched fields) keep their drafts. The whole-draft `draft = { ...saved }` (`QuestionAccordion.svelte:354`) and the whole-tracker `reset()` are replaced by this per-field write-back.
    - So a Save never interleaves with a structure change, and a reset never wipes input made after a request left.
  - **Partial failure.**
    - Requests go in a fixed order (§5.3), and each part that succeeds advances its saved baseline. **The save stops at the first failure.**
    - That field shows the server message, and later parts stay unsaved. A pop-up names what failed and says "Save again to send the rest." Nothing is rolled back (the API has no batch endpoint).
    - **Tree reload.** If any part succeeded before the failure, the tree is reloaded (forced, `stillOnVid`-gated), so the header and item rows show what is saved.
    - **Single choice.** If a Save stops between the `true` and the `false` PATCH, the server briefly holds two correct options; the server only checks uniqueness at publish. The question keeps its draft (still dirty) and shows "Saved partly — save again to finish the answer key."
  - Cost if wrong: a partially saved quiz, made visible rather than hidden.
- **D11 — The asset hint box** borrows the information banner's *colour* treatment, at sidebar size:
  - `--surface-2` background, a 3px `--primary` left rule, `--text-3` 11.5px text, `padding: 8px 10px`, no radius;
  - the legacy yellow hexes are deleted.
  
  The page banner itself (`VersionEditPage.svelte:467-474`, 13px `--text`, `8px 12px`) is unchanged.
- **D12 — Plain inputs** follow the 5a create-form precedent, with one correction:
  - **Metrics:** `height: var(--control-h)`, `padding: 0 var(--control-pad-x)`, `1px solid var(--border-strong)`, `--radius`, `--surface`, `font-size: var(--control-font)`, `--text`, `caret-color: var(--primary)`.
    - The padding is the 9px dense-control token. The 5a create-form's literal `0 10px` (`VersionEditPage.svelte:491`) is a pre-token leftover and is not copied.
  - **Focus:** `1.5px var(--primary)` border plus the `3px var(--primary-soft)` ring (`:focus-visible`), matching InlineField's open editor.
  - **Error:** `1.5px` `--danger` border plus `aria-invalid="true"`, with a 12px `--danger` message below (`aria-describedby`).
  - Video URL is mono;
  - textareas: `--control-pad-textarea`, mono 13px, line-height 1.6, `--text-2`.
- **D13 — Video preview.**
  - **Frame:** a fixed **296px**-high player area (ref 1818) holding the real iframe. `VideoFrame` gains an optional `height` prop; the student player keeps its 16:9 default.
  - **Meta:** the provider only (`youtube` / `vimeo` / `embed`), derived from the URL. No duration, since we have no data for it.
  - **Card footer:** `embed resolved` plus **Open in new tab** when `safeIframeUrl` accepts the URL; otherwise `no embed — paste a YouTube or Vimeo link`, with no link.
- **D14 — Interactive-app preview height.** The app preview is **360px**. `InteractiveFrame` gains an optional `height` prop; the student player keeps 600px.
- **D15 — Question accordion follows 3f's pixels**:
  - the Q badge is plain mono 11px `--primary` text, not the 3b chip;
  - there's no chevron, because the header button itself toggles `aria-expanded`;
  - type names are lowercase mono `--muted`: `single choice`, `multiple choice`, `numeric answer`, `text answer`;
  - disabled arrows carry a reason: "Move up — already first", "Move down — already last" (5a's wording, plan R12), or the structure reason.
- **D16 — Option reorder is kept.** It exists today; 3f simply doesn't draw it. Option rows get ↑ ↓ before 🗑, with the same rules as D15. Dropping a working feature would be the bigger deviation.
- **D17 — Modal placement.**
  - The backdrop is `position: fixed; inset: 0`, above the app header (`z-index: 100`, the existing modals' value).
  - It blurs everything behind it with **`backdrop-filter: blur(1px)`**, which matches the artboard's blurred page and header without blurring the modal itself.
  - The panel is centred horizontally, with `top: 26px` (ref 1684).
  - Width is `min(920px, 100vw - 32px)`; max height is `min(600px, 100vh - 52px)`.
  - While the modal is open, the document doesn't scroll (`overflow: hidden` on `<html>`, restored on close).
- **D18 — Focus.**
  - **On open,** the Title input takes focus (`data-autofocus`) when editable, otherwise the × button.
    - `Modal`'s **default** is `autofocusSelector = "[data-autofocus], #<closeId>"` with `autofocusPriorityOrder = true`. Both stay overridable props. × gets a stable per-instance `id` (`$props.id()`).
    - It never relies on FocusTrap's default selector, which would pick the header trash button (`FocusTrap.svelte:56-57`).
  - **Containment.** FocusTrap's Tab wrap only fires on the exact first or last focusable (`FocusTrap.svelte:24-37`). A disabled footer button, AssetSidebar's hidden file input, or an iframe can therefore let Tab escape to the page behind.
    - `Modal` adds a document `focusin` listener: if focus lands outside the panel, it is moved back to the first focusable in the panel (or to the last one, if focus left from the first).
    - The listener returns immediately when `!panel.isConnected`. On teardown, Svelte detaches the DOM and runs FocusTrap's restore *before* Modal's own cleanup (`destroy_effect`), so the restore to the opener must not be fought.
    - With that, plus D8's backdrop `mousedown`, the page behind can't take focus or gain drafts.
  - **On close:**
    - focus returns to the opener (the item's Open pencil) if it's still connected (FocusTrap's restore);
    - otherwise it goes to the closed item's Open pencil, if that exists (after a create-item success, the Create button is gone; after a deep-link close the pencil exists and wins);
    - otherwise to the sequence header.
    - After a delete, `deleteOpenItem` focuses the sequence header itself (D9).
    
    **Mechanism:**
    - The `routeIid` effect records `lastClosedIid` and sets a one-shot `justClosedItem` flag on the non-null → null transition. It is **declared before** the focus effect (added to the 5a effect-order comment).
    - The focus effect reads the flag inside `untrack`, at the **top** of the effect, before the existing `lastFocusedTarget` equality skip (`VersionEditPage.svelte:136`). A tracked write-then-read would re-run it. When the flag is set, the equality skip is bypassed for that run.
    - The flag is **cleared inside the async block, only when the close handling actually runs** (after the `cancelled` check, `:142-146`). A run cancelled by an overlapping tree reload therefore leaves it for the next run. The flag is **also cleared on the effect's synchronous early returns** (`if (!t) return`, `:111`; the `!headerId` branch, `:128-133`), so the one-shot can never outlive its close. Its body/`null` check runs **after `await tick()`**, as today (`VersionEditPage.svelte:143-149`), because within the same flush the modal's × is still mounted and focused.
    - **When the flag is set, after `await tick()`:**
      - if `document.activeElement` is `body` or `null`, apply the fallback (focus the pencil, else the header);
      - **otherwise leave focus where it is.** FocusTrap has already restored it to the opener, or to whatever the user had focused.
      
      Either way, set `lastFocusedTarget` to the sequence-header id (so a later reload doesn't refocus) and **return**. The existing header focus-and-scroll path runs only when the flag is not set; it never overrides a close.
    - The fallback looks up the pencil by the new `id="item-{id}-open"` on `ItemRow`'s Open button (`ItemRow.svelte:79`).
    - A tree reload without a close never runs the fallback, so it can't steal focus.
  - **The page's focus `$effect`** is skipped while an item is open, so it doesn't race the modal.
- **D19 — Stale item addresses.**
  - This covers an item that no longer exists, belongs to another sequence, or has an invalid id.
  - The page shows the toast "Item not found." and replaces the address with the sequence (`{ replace: true, force: true }`), extending 5a's `deriveExpansion` / `handleStaleIdFallback`.
  - Precedence: block > sequence > item. The D9 `deletedIid` exception applies.
  - **Cost:** if the stale item had been opened in-page, `replace` leaves history as `[S, S]`, so one Back appears to do nothing. Accepted: it only happens when another admin deletes the item under you.
- **D20 — Published versions.**
  - Text stays editable. Structure buttons are disabled, with the 5a structure reasons.
  - If a Save changes any answer key (a numeric or text answer, or a correct mark), **one confirm** appears before anything is sent: *"This quiz is published. Changing the answer key does not re-score students who already attempted — their recorded scores keep the old key. To re-grade everyone, create a new version instead. Continue?"* It asks on every such Save.
  - This replaces the per-question, per-mount latch. Cost if wrong: one extra confirm.
- **D21 — The `MarkdownEditor` / `AssetSidebar` restyle also reaches `MiniProjectModal`** (run assets), which uses them. This is accepted; Slice 6 restyles the rest of 10m.
- **D22 — The store contract.** `currentEditorVersion`'s header comment changes to: *"read by `VersionEditPage` and its subtree (BlockAccordion, SequenceAccordion, the item modal); loaded and cleared only by `VersionEditPage`. No other page may call `clearEditorVersion`."* `VersionEditPage` keeps `onDestroy(clearEditorVersion)`, which is safe because no page it swaps with reads the store.
- **D23 — Question editors keep their asset sidebars, stacked.**
  - Today every edit-mode `MarkdownEditor` renders an `AssetSidebar` (`MarkdownEditor.svelte:285-295`), and a question has two editors (Question and Explanation). Dropping them would remove image upload from questions, a working feature.
  - Inside the quiz, the **Question** and **Explanation** rows therefore **stack the label above the editor** (full width, not the 132px grid), so the 260px sidebar fits beside the pane.
  - In `plain` mode (D6) there is no sidebar. Each sidebar still fetches the asset list (today's behaviour).
  - Cost if wrong: a taller open question, and one more fetch per question.
- **D24 — Delete-option versus mark drafts.**
  - `canDeleteOption` (C2) judges the **saved** marks, because the delete acts on the server.
  - **When the question's mark drafts differ from saved,** deleting **any** option works like this:
    1. confirm with `Delete option "…"? This cannot be undone. Your unsaved correct-answer change will be reset.`;
    2. send the `DELETE`;
    3. **on success**, reset that question's mark drafts to saved, so no draft can point at a deleted row;
    4. **on failure**, leave everything as it was.
    
    Text drafts on the other options survive.
  - **When no mark draft differs,** an option delete keeps today's behaviour: immediate, no confirm (`QuestionAccordion.svelte:200-203`).
  - When C2 blocks the delete button, its tooltip reads "Can't delete the only correct option — mark another one correct and save first" (plan R14).
- **D25 — The correct-row look follows the *draft* mark,** so the author sees what Save will send. After a partial single-choice failure (D10), the draft still shows exactly one correct row.

---

## Scope

### In scope
- New `ui/Modal.svelte` (generic) + tests + gate section.
- New `components/editor/ItemEditorModal.svelte` (header, Title field, footer, save/discard/delete orchestration) and the type bodies `components/editor/item/{PageBody, VideoBody, AppBody}.svelte`; the quiz body is `QuizEditor.svelte`, adapted.
- `VersionEditPage.svelte` hosts the modal (prop `itemId?`, opened-from-page tracking, `requestCloseItem`, stale-item fallback, focus effect gate).
- `routes.ts:14` → `VersionEditPage`; `App.svelte` drops `ItemEditPage`.
- `lib/deriveExpansion.ts` + `lib/handleStaleIdFallback.ts` gain the item level.
- Restyle and behaviour changes: `MarkdownEditor.svelte` (3c tabs + pane; plain read-only mode, D6), `AssetSidebar.svelte` (3c sidebar, D11), `QuizEditor.svelte` / `QuestionAccordion.svelte` / `OptionRow.svelte` / `QuestionTypePicker.svelte` (3f + D3 save model), `components/items/InteractiveAppEditor.svelte` → `components/editor/item/AppBody.svelte` (D4), `components/items/{VideoFrame,InteractiveFrame}.svelte` (`height` prop).
- Delete `pages/editor/ItemEditPage.svelte` and `tests/ItemEditPage.{interactive,refreshKey}.svelte.test.ts` + `tests/ItemEditPage.refreshKey.harness.svelte` (ported into the T3/T4 tests); update `router.test.ts:54`; update stale comment references (`MiniProjectDetailPage.svelte:184`, `QuizEditor.svelte:27`, `QuestionAccordion.svelte:35`, `InteractiveAppEditor.svelte:14` (file deleted), `tests/dirtyRegistry.test.ts:103`, `AssetSidebar.svelte.test.ts:189`, `currentEditorVersion.svelte.ts:1-5`).
- Backlog: close the two 5b carry-over entries in `slice5a-authoring-polish-debt.md` with a pointer to this slice.

### Out of scope / deferred
- The four run modals and 10m (Slice 6 adopts `ui/Modal`).
- Any backend change.
- Previous/next-item navigation inside the modal (not designed).
- Concurrent-admin edits to the same item (today's behaviour: no auto-resync).
- Video duration metadata (D13).

---

## Per-surface design

### 1. `ui/Modal.svelte` — T1

**Props:**
- `label?: string` or `labelledby?: string` (exactly one is required: `aria-label` / `aria-labelledby`);
- `width = 920` (px), `maxHeight = 600` (px);
- `onRequestClose: () => void`;
- `closeOnBackdrop = false`;
- `autofocusSelector = "[data-autofocus], #<closeId>"`, `autofocusPriorityOrder = true` (passed to `FocusTrap`; D18);
- `closeDisabled = false` (disables × and ignores Escape; used during a delete, D9);
- snippets `header` (required), `children` (body), `footer?`.

**DOM:**

```
div.modal-backdrop (fixed, inset 0, z-index 100, backdrop colour + backdrop-filter, display:flex, justify-content:center, align-items:flex-start, padding-top:26px)
  FocusTrap
    section.modal-panel role="dialog" aria-modal="true" aria-label|aria-labelledby  (width/max-height via style vars from props)
      header.modal-head   {@render header()}  + IconButton id={closeId} glyph="close" size="md" aria-label="Close" title="Close" → onRequestClose   (closeId = a per-instance unique id; IconButton forwards `id`)
      div.modal-body      {@render children()}
      footer.modal-foot   {@render footer()}   (omitted when no footer snippet)
```

**Styles:**

| element | style |
|---|---|
| panel | `width: min(var(--modal-w), 100vw - 32px)`, `max-height: min(var(--modal-h), 100vh - 52px)` (`--modal-w/--modal-h` are component-local custom properties set from props, not theme tokens); `display:flex; flex-direction:column; overflow:hidden; background:var(--surface); border:1px solid var(--border-strong); border-radius:var(--radius-lg); box-shadow:` Constraint 11 |
| `.modal-head` | `display:flex; align-items:center; gap:10px; padding:12px 14px 12px 16px; border-bottom:1px solid var(--border)` (ref 1685) |
| `.modal-body` | `flex:1 1 auto; min-height:0; overflow:auto; padding:14px 16px; display:flex; flex-direction:column; gap:12px` (ref 1695), and `.modal-body > :global(*) { flex: 0 0 auto; }` (spec :220-221) |
| `.modal-foot` | `display:flex; align-items:center; gap:9px; padding:12px 16px; border-top:1px solid var(--border); background:var(--surface-3)` (ref 1750) |

**Behaviour:**
- **Escape:** a `<svelte:window onkeydown>` in the bubble phase.
  - It fires when `e.key === 'Escape' && !closeDisabled && !e.repeat && !e.isComposing && e.keyCode !== 229 && !e.defaultPrevented`. The `keyCode 229` check is Safari's IME signal, as in 5a's T1 backlog.
  - It then calls `preventDefault()` and `onRequestClose()`.
  - Inner widgets that own an Escape call `preventDefault()` first: InlineField (already), and AssetSidebar's inline delete confirm, which T2 adds (Escape = Cancel).
- **Backdrop:**
  - `mousedown` on the backdrop itself calls `preventDefault()`, which keeps focus in the panel;
  - `click` closes only when `closeOnBackdrop` is set and the target is the backdrop itself.
- **Focus containment:** the document `focusin` listener from D18. It bails when the panel is disconnected, and is removed on destroy. The panel carries `tabindex="-1"` and is the **last-resort target**: when nothing inside can take focus (e.g. `bodyInert` with all buttons disabled), both the `focusin` handler and the Tab handling move focus to the panel itself.
  - **Detection:** `querySelectorAll` still returns elements inside an `inert` subtree, and `.focus()` on them is a silent no-op. So the handler focuses the candidate, then checks `panel.contains(document.activeElement)`, and calls `panel.focus()` if not.
- **`bodyInert = false`** puts `inert` on `div.modal-body` (D9).
- **Scroll lock:** on mount, save `document.documentElement.style.overflow` and set it to `hidden`; restore it on destroy.
- Modal holds no dirty state; the parent decides what closing means.

**Tests (`Modal.svelte.test.ts`):**
- the role and ARIA name;
- × and Escape call `onRequestClose`;
- Escape does not close while composing, with `keyCode 229`, on `repeat`, or after an inner `preventDefault`;
- a backdrop click does nothing by default and closes with `closeOnBackdrop`;
- a backdrop `mousedown` is default-prevented;
- a click inside the panel never closes it;
- focusing an element outside the panel moves focus back inside;
- the scroll lock is applied and restored;
- the autofocus priority is honoured, with × as the fallback;
- the footer is omitted when no snippet is given.

### 2. Hosting, routing, close — T3b (host) + T3a (ItemEditorModal)

**`routes.ts:14`** → `component: 'VersionEditPage'`. Svelte keeps the same page instance across all four editor patterns, because `App.svelte`'s `<Comp {...params}/>` keeps one constructor. On the item pattern `itemId` is a string; elsewhere it is `undefined`.

**`VersionEditPage.svelte`:**
- **Props** gain `itemId?: string`; `routeIid = itemId ?? null`.
- **Opened from the page (D7).**
  - A plain (non-reactive) `let mountedOnItem = untrack(() => itemId) !== undefined` is captured at script init. The `untrack` avoids a `state_referenced_locally` warning; `npm run check` warnings must not grow.
  - Alongside it, `let openedFromPage = $state(false)`.
  - An `$effect` tracking `routeIid` sets `openedFromPage = routeIid !== null && !mountedOnItem`. Once `routeIid` becomes `null`, it sets `mountedOnItem = false` (so later opens count as in-page) and clears `closing` and `deletedIid`.
- **`requestCloseItem()`:**
  - if `closing`, or `deletingIid !== null && String(deletingIid) === routeIid`, return; otherwise set `closing = true`;
  - if `openedFromPage`, `history.back()`;
  - else `navigate(seqUrl, { replace: true })` (guards run).

  A window `popstate` listener clears `closing` (this re-arms it after a cancelled prompt). A cancelled `navigate` also clears it (when `navigate` resolves without leaving).
- **`deleteOpenItem()`** — D9.
- **`deriveExpansion(routeBid, routeSid, effectiveTree, routeIid)`** (`routeIid` is **appended** as the last parameter, so the 9 existing tests stay valid) returns `expandedItem`. It also returns `staleIid` when the item is absent from the expanded sequence or the id is not a positive integer.
  - `handleStaleIdFallback` handles `staleIid` with "Item not found." and `navigate(seqUrl, { replace: true, force: true })`.
  - It skips the toast and navigation when `staleIid && routeIid === String(deletedIid)` (D9).
  - Precedence: `staleBid > staleSid > staleIid`.
- **Template.** Inside the loaded `{:else}` branch, after the state bar: `{#if expandedItem}{#key expandedItem.id}<ItemEditorModal …/>{/key}{/if}`. The modal sits inside the page, so it shares the page's `DIRTY_REGISTRY_KEY` context.
- **Focus `$effect`** (5a order: load → validation → focus) returns early while `routeIid !== null` (D18). It tracks `routeIid`.
  - After an in-page close, the existing `lastFocusedTarget` equality skips it, so `FocusTrap`'s restore-to-opener wins.
  - D18's fallback (closed item's Open pencil `#item-{lastClosedIid}-open`, else the sequence header) runs **only** when the one-shot `justClosedItem` flag is set and focus is on `body`/`null`; plain tree reloads never trigger it.
- **Store.** `onDestroy(clearEditorVersion)` stays, and the comment is updated (D22).

**Openers:** `SequenceAccordion.openItem` and the create-item success keep their plain `navigate(itemUrl)`. They now land on the same page instance, so there is no swap and no freeze.

**`ItemEditorModal.svelte`:**
- **Props:** `courseSlug`, `vid`, `version: AdminTreeVersion`, `perms`, `block`, `seq`, `seqIndex: number` (for "S1"), `item`, `itemIndex`, `itemCount`, `stillOnVid`, `onRequestClose`, `onDeleteItem` (the page's `deleteOpenItem`), `deleting: boolean` (D9 freeze — treated like `saving` for inputs, plus × / Escape / trash / Save / Discard disabled via `Modal closeDisabled`).
- **Derived:** `versionDisabled = version.is_disabled` and `assetContext = $derived(courseAssetContext(vid))`. `assetContext` is memoised per `vid`, as ItemEditPage did at `:27-29`, and passed to the bodies.
- **Header snippet:**
  - `ItemMark type={item.type} state="covered"` (22px tile, ref 1686);
  - `<h2 id={labelId} class="name">{item.title}</h2>` (15px/600 `--text`);
  - `<span class="mono ctx">{typeWords} · S{seqIndex} · item {itemIndex} of {itemCount}</span>` (11.5px `--muted`; `typeWords` = `static page` / `video` / `quiz` / `interactive app`);
  - a right group `margin-left:auto; gap:6px` holding `IconButton glyph="trash" size="sm" danger` (D9).
  
  `Modal` adds ×. `labelledby={labelId}`.
- **Body:**
  - the Title row:
    - grid `132px 1fr; align-items:center; gap:12px`, class `.field-row`;
    - label 12.5px `--muted`;
    - input per D12, with `maxlength="200"`, `aria-label="Title"`, required and `data-autofocus`;
    - when `!perms.canEditTextFields`, the title is shown as plain 13px `--text` text instead of an input;
  - then the type body:
    - `PageBody` for `static_page`;
    - `VideoBody` for `video`;
    - `AppBody` for `interactive_app`;
    - `QuizEditor` for `quiz`;
    - otherwise "This item type can't be edited here."
- **Footer** (omitted when `!perms.canEditTextFields`, i.e. archived or disabled):
  - `<span class="dirty mono">` (flex:1; 11.5px `--status-needs-revision-fg`; text "unsaved changes" when `saveDirty`, else empty);
  - `Button variant="ghost"` **Discard**: disabled when `!saveDirty`, while saving, or when `body.busy`; title "No changes to discard" when clean;
  - `Button variant="primary"` **Save**: disabled the same way; title "No changes to save" when clean; `loading` while saving.
- **Read-only note (D6):** when `versionDisabled`, an information banner sits under the Title row (D11 colour treatment, 13px) with the D6 text.

**Save / discard protocol (the body contract):**
- **Each body** exports:
  - `save(titleDraft: string | undefined): Promise<{ outcome: 'ok' | 'partial' | 'failed'; savedTitle?: string }>` — `savedTitle` is the server's echo when the title part succeeded;
  - `discard(): void` (save drafts only);
  - `discardAll(): void` (also collapses typed create forms);
  - `validate(): boolean` (D10 scope);
  - bindable `saveDirty`, `guardDirty` and `busy` (any structure operation or upload in flight);
  - a `frozen` prop (from the modal: `saving || deleting`) that makes its inputs read-only **without blurring** (`readonly` attribute; `MarkdownEditor frozen`) and its structure controls disabled (D10 interlock, D9).
- **The modal** owns the title tracker and registers **one** `RegisteredTracker` in the page registry:
  - `isDirty = titleDirty || body.guardDirty`;
  - `discard()` (the guard's confirmed close) resets the title and calls `body.discardAll()`;
  - it unregisters on destroy.
  
  `saveDirty` (footer) = `titleDirty || body.saveDirty`.
- **Save sequence:**
  1. `validate()` on the modal and the body;
  2. then `body.save(titleDirty ? title : undefined)`. **The body sends the title**:
     - page and video put it inside their single `PATCH`;
     - app and quiz send `PATCH {title}` first (§5.3 step 1);
  3. the modal advances the title baseline from `savedTitle` when present.
- **After a full or partial success**, `loadAdminTree(vid, { force: true })` is gated on `stillOnVid`, and the body stays `frozen` until it settles.
  - **Baselines come only from the PATCH responses** (D10 per-field write-back). The reload refreshes only the tree: the header, the item rows and the `used` badges. Nothing is reset from the fresh tree after it.
  - From ItemEditPage's outcome handling (`:169-203`) only the toast wording is kept: `'error'` → "Saved (refresh failed — reload to see latest)"; `'discarded'` → "Saved" (the PATCH succeeded; only the refetch was superseded; the Toaster is global, `ItemEditPage.svelte:170-175`).
  
  Then:
  - the toast "Saved", or the D10 partial-failure pop-up;
  - `PageBody` bumps its own `refreshKey` (it owns it and binds it to `MarkdownEditor`), so the sidebar's `used` badges refresh.
- **⌘S / Ctrl+S** inside the panel triggers Save (`preventDefault`), subject to the same disabled rules.

**Delete:** the trash button calls `onDeleteItem` (D9; the page owns the flow).

**Close:** `onRequestClose` = the page's `requestCloseItem`.

**Tracker seeding.** Drafts are seeded once per mount from `item`; `{#key expandedItem.id}` remounts on item change. Forced tree reloads, such as a quiz add or an app upload, never re-seed (ItemEditPage `:122` rule).

### 3. Page body (3c) — T2 (MarkdownEditor/AssetSidebar) + T3a (PageBody)

**`PageBody.svelte`:**
- a tracker `{ content_md }`;
- `<MarkdownEditor {assetContext} plain={versionDisabled} bind:value bind:refreshKey>`;
- `save` sends `PATCH /api/items/{id}` `{ title?, content_md }`, then `refreshKey++`.

**`MarkdownEditor` restyle (3c):**

| element | style |
|---|---|
| card | `1px solid var(--border)`, `--radius`, `overflow:hidden` (ref 1702) |
| tab bar | `display:flex; border-bottom:1px solid var(--border)` |
| tabs | `padding:8px 14px; font-size:13px` |
| active tab | `600 var(--text)` on `--surface-2` |
| inactive tab | `400 var(--muted)` |

The tabs keep `aria-pressed`.

- **Pane:** a textarea, `flex:1 1 0; min-width:0; padding:12px 14px; font: 13px/1.7 var(--font-mono); color:var(--text-2); min-height:230px; border:0; resize:vertical; caret-color:var(--primary)` (ref 1708).
- **Sidebar:** `flex:0 0 260px; border-left:1px solid var(--border); padding:12px; gap:8px; background:var(--surface-3)` (ref 1717).
- **Layout:** the row stacks to a column under 880px (kept).
- **Preview tab:** shows the rendered HTML in the same card. The sidebar is hidden in Preview (today's behaviour).
- **New prop `plain = false` (D6):** when `plain` is set, the editor is read-only regardless of `readOnly`, with:
  - no tabs and no sidebar;
  - no `/render` call (the `onMount` `loadPreview` is skipped);
  - the source shown as `pre`-wrapped mono text in the card.
- **New prop `frozen = false` (D10 interlock, D9):** the textarea gets the `readonly` attribute (focus and caret are kept); drops, sidebar inserts and uploads are blocked exactly like the existing `disabled` guards (`:67`, `:184`, `:204`), plus a `frozen` guard in `uploadOne` (`:111`) and `AssetSidebar disabled={disabled || frozen}` (its own checks at `AssetSidebar.svelte:81,99,114` block drop/pick); tabs stay usable. `uploading` stays bindable so bodies can fold it into `busy`.
- **Delete** `#a33`, `#c62828`, the `var(--surface, #f7f7f7)` fallback (`:310`) and the `ui-monospace` literal; use `--danger`, `--surface` and `--font-mono`.

**`AssetSidebar` restyle (3c):**
- **Heading:** "Course assets", 12.5px/600 `--text`.
- **Hint (D11).**
- **Rows:** `display:flex; align-items:center; gap:9px; padding:6px 7px; border-radius:var(--radius)`. Each row has:
  - a type tile `32×28`, radius 4px (scale named), `--border-soft` fill, mono 9.5px/600 `--muted`;
  - the name (12.5px `--text`, ellipsis);
  - the size (mono 10.5px `--muted`);
  - a `used` badge (11px/500, `--status-accepted-*`, `3px 8px`, radius 3);
  - delete as `IconButton glyph="trash" size="sm" danger`, disabled when used, with the title "Remove asset — referenced by this item".
- **Drop zone:** `2px dashed var(--border-strong)`, `--radius`, `padding:11px 10px`, centred 12px `--muted`, text "Drop here or click to pick".
- **Error and progress banners:** use `--danger` / `--surface-2` with the D11 rule.
- **Delete** every hex, `rem` font size and opacity literal in `AssetSidebar.svelte:327-351`. Emoji `🗑` and `×` become SVG `IconButton`s.
- **The two-step inline delete confirm stays,** and gains Escape = Cancel (`preventDefault`, so the modal doesn't close; §1).
- The `AssetSidebar.run-mode` tests (7) are updated for the IconButton change (D21).

### 4. Video body (3e) and App body — T3c (video logic) + T4 (video card, App)

**`VideoBody.svelte`:**
- **Fields:** a tracker `{ video_url }`, plus a **Video URL** `.field-row` (mono input, `type="url"`, required, `aria-label="Video URL"`) with the hint text below in 12px `--muted`: "Paste any YouTube or Vimeo URL — it is converted to embed form on save."
  The row uses `align-items: baseline` (not `center`, T3c review): the hint sits under the input, so `center` would drop the label below the input's text line.
- **Preview card** (ref 1813-1824):
  - the card is `1px solid var(--border)`, `--radius`, `overflow:hidden`;
  - header: `padding:8px 12px; background:var(--surface-2); border-bottom:1px solid var(--border)`, with "Preview" 12.5px/600 and a mono 11.5px `--muted` provider;
  - player area: 296px, `--surface-2` (D13):
    - it holds `VideoFrame height={296}`, fed by a 500ms debounce of `safeIframeUrl(normalizeVideoUrl(url))`;
    - `VideoFrame`'s own `margin-bottom: var(--space-3)` is zeroed inside the card;
    - with no embeddable URL, the area stays empty `--surface-2` with a centred 12px `--muted` "No preview";
  - footer: `padding:8px 12px; border-top:1px solid var(--border-soft); background:var(--surface-3)`, with a mono status on the left and an **Open in new tab** link (12.5px `--primary`, `target="_blank" rel="noopener noreferrer"`) on the right.
- **Validation:** an empty URL gives "Video URL is required".
- **Save:** `PATCH { title?, video_url: normalizeVideoUrl(url) }`.
- **Read-only:** the URL is shown as mono text, with the preview card kept (the iframe is external, so there is no server call even when disabled).

**`AppBody.svelte`** (replaces `components/items/InteractiveAppEditor.svelte`; its 13 tests in `tests/InteractiveAppEditor.svelte.test.ts` are ported):
- **App script row** in the `.field-row` grid: the current filename in mono, or "No script", plus buttons Upload (when none) or Replace and Remove (`Button variant="secondary"` / `"ghost"`).
- **Upload and Replace:** read the file, run `scanAppSource` warnings, `uploadAsset`, `PATCH {script_url}`, force a reload, then toast. This keeps the orphan clean-up and the 409 message.
- **Remove** now **confirms** ("Remove the app script? Students will see an empty app."), then `PATCH {script_url:null}` and a reload.
- **Lifecycle guards:** an `alive` flag plus `stillOnVid` on every post-await write.
- **`busy`** is true while an upload, replace or remove is in flight. It disables Save (D10).
- **Preview card:** the same card as video. Header "Preview" with a mono `interactive app` meta, and body `InteractiveFrame height={360}` (D14). Disabled versions show the D6 note instead and fetch nothing. The blank-preview hint is kept.
- **Save:** `PATCH {title}` only.
- **Its `.notice` rule** is renamed `.app-hint` and moved under the D11 treatment. The gate's `notices` structural target (`visual-refresh-gate.sh:937`, count 2) drops to **1** (`InteractiveAppItem` only), and the two-authors comments at `:934-936` and `:1017` are updated.

### 5. Quiz (3f) — T5a (draft model + Save) + T5b (structure with drafts) + T6 (look)

#### 5.1 Ownership
- **`QuizEditor` keeps its private dirty registry** (`QuizEditor.svelte:27-30`) for the **save drafts** (question and option trackers). It implements the §2 body contract:
  - `saveDirty` = `registry.isAnyDirty()`;
  - `guardDirty` = `saveDirty` or a typed add-question / add-option form;
  - `busy` = `questionsLocked`, or any contributor's `locked()` (its `optionsLocked` or an inner `MarkdownEditor` `uploading`);
  - plus `save`, `discard`, `discardAll` and `validate`.
  
  The add forms register their 5a-style create-tracker shims in a *second* private registry (the guard registry). That keeps them out of the footer and out of Save (D5).
- **The modal's single page-registered tracker covers the quiz** (§2), so the page `DirtyGuard` sees quiz drafts. **There's no second guard:** `QuizEditor` mounts no `DirtyGuard`.
- **Each `QuestionAccordion` keeps its draft and saved state** (`:45-57`), and its option trackers (`:105-124`), extended with `is_correct` per option.
  - These live in the accordion component, which stays mounted while its body is collapsed (`:80-84`).
  - It receives `versionDisabled` (D6), `frozen` (D10/D9) and `expanded` / `onExpand`. `QuizEditor` keeps the single `expandedId` and sets it on a validation failure (D10).
- **Each accordion registers a save contributor** with `QuizEditor` through a new context `QUIZ_SAVE_KEY`:
  - `{ questionId, order(): number, isDirty, locked(): boolean, keyChanged(): boolean, validate(): boolean, focusFirstInvalid(): void, save(): Promise<'ok' | 'partial' | 'failed'>, discard() }`.

#### 5.2 What becomes a draft
These all stop being immediate writes:
- question `text_md`, `explanation_md`, numeric answer and precision, and `correct_text`;
- option `text`;
- option `is_correct`.

Removed: the per-question Save/Discard buttons (`QuestionAccordion.svelte:481-486`), the option blur commit (`OptionRow.svelte:56`, `QuestionAccordion.commitText`), the immediate `toggleCorrect` (`:268-310`) and the quiz "Save title" button (`QuizEditor.svelte:244-245`; the title moves to the modal).

How correct marks behave in the draft:
- a single-choice radio sets that option's draft `is_correct=true` and its siblings' `false`;
- a multiple-choice checkbox flips just its own draft;
- `OptionRow`'s controlled-input workaround (`:28-37`) is replaced by plain draft binding.

#### 5.3 Save order (D10)
1. Title: `QuizEditor.save` sends `PATCH /api/items/{id} {title}` when the modal passed a title draft (§2).
2. Questions in display order. For each question with a dirty contributor:
   - (a) `PATCH /api/questions/{qid}` with only the changed question fields, if any;
   - (b) option PATCHes:
     - all `{is_correct:true}` (with any changed `text`) first;
     - then all `{is_correct:false}` (with any changed `text`);
     - then text-only changes.

   This keeps the server's "≥1 correct" rule (`backend/mathion/api/questions.py:233-239`) satisfied mid-sequence.
3. Then stop. Each part that succeeds advances its baseline from the response.
4. A published key change asks the D20 confirm **once, before step 1**. Cancel sends nothing.
5. 403/409 on any part triggers a forced tree reload (existing rule) and stops.

#### 5.4 Structure while drafts exist (D3)
The two-way lock is removed: the `dirty` term leaves `optionsDisabled` (`:142`) and `structureDisabled` (`:372`). The rest stays serialised:
- `questionsLocked` and `optionsLocked` still prevent concurrent structure operations;
- the D10 interlock adds `saving` to both, and exposes both through `busy` to block Save.

Drafts are keyed by id:
- **Add a question or option:** existing drafts are untouched.
  - The add forms submit immediately and use the 5a collapsed-form pattern, so `+` becomes `×`.
  - A form with typed input is **guard-dirty** (D5): closing the modal prompts. It is **not** save-dirty: the footer ignores it and Save doesn't submit it.
- **Delete a question:** `confirm('Delete question "…"? This cannot be undone.' + unsavedSuffix(contributor.isDirty))` (the shared `editorReasons.unsavedSuffix`), then its contributor unregisters.
- **Delete an option:** drops its draft. `canDeleteOption` (C2, `:140-141`) uses the **saved** `is_correct`, and D24 resets the question's mark drafts first.
- **Reorder:** drafts survive.
- **Option refetch:** `resyncOptions` / `reconcileTrackers` (`:110-122`) keep the drafts of surviving ids.

#### 5.5 Look (3f)
- **Questions heading row** (ref 1885):
  - "Questions" 12.5px/600 `--text`;
  - a mono 11.5px `--muted` count;
  - at the right, `IconButton glyph="plus" size="sm" primary`, labelled "Add question" (it toggles the add form).
- **Question card** (ref 1890):
  - card: `1px solid var(--border)`, `--radius`, `overflow:hidden`; cards are 12px apart (the body gap);
  - header: `display:flex; align-items:center; gap:10px; padding:8px 12px`, `--surface-2` when open with `border-bottom:1px solid var(--border)`, else `--surface`;
  - a toggle `<button aria-expanded aria-controls>` wraps a mono 11px `--primary` badge `Q{n}` and the title 13px/600 `--text` (`flex:1`; the title is a text snippet of the question);
  - a mono 11.5px `--muted` type name (D15);
  - `IconButton sm` ↑ ↓ 🗑, with the D15 reasons.
- **Open body** (ref 1901): `padding:12px; display:flex; flex-direction:column; gap:10px`. It contains:
  - a **Question** row with a `MarkdownEditor` (`plain={versionDisabled}`). It is stacked (D23): the label (12.5px `--muted`) sits above a full-width editor with its asset sidebar;
  - an **Explanation** row (the same, stacked);
  - per type:
    - **single and multiple choice:** an **Options** heading row (label 12.5px `--muted`, `width:132px`; `+` primary, labelled "Add option") and an options list (`gap:6px`);
    - **numeric:** **Answer** and **Precision** rows (D12 inputs, mono);
    - **text:** an **Answer** row.
- **Option row** (ref 1913, 1919):
  - `display:flex; align-items:center; gap:10px; padding:4px 9px; border:1px solid var(--border); background:var(--surface); border-radius:var(--radius)`;
  - a correct row (by the **draft** mark, D25) uses `border-color:var(--primary); background:var(--primary-soft)`;
  - a native radio or checkbox, `accent-color: var(--primary)`, 15px;
  - a text input (D12 metrics, transparent border until focus, so a row reads like 3f's text but stays editable);
  - a `correct` badge (11px/500, `--status-accepted-*`, `2px 7px`, radius 3) on correct rows;
  - ↑ ↓ (D16) and 🗑 `IconButton sm`.
- **`QuestionTypePicker`** (in the add form): restyled like 5a's `ItemTypePicker` cards, with the labels `single choice` / `multiple choice` / `numeric answer` / `text answer`.
- **Emoji removal:** all of 🗑 ↑ ↓ ▾ ▸ ✓ ◉ ☑ ✎ ＋ are removed from the quiz files.
- **Non-token fallbacks removed:** `--text-muted` / `--success` references and the `var(--danger, #c00)` hex fallbacks in `QuizEditor.svelte:320-321`, `QuestionAccordion.svelte:496-497` and `OptionRow.svelte:71-75` become `--muted` / `--status-accepted-fg` / bare `var(--danger)`.

---

## Data flow & error handling

- **Single tree loader.** Only `VersionEditPage` loads and clears `currentEditorVersion` (D22). The modal and its bodies read through props, and refresh with `loadAdminTree(vid, { force: true })` gated on `stillOnVid`.
- **Navigation guard.**
  - Opening an item while a page draft is open prompts (5a D3); confirming discards all.
  - While the modal is open, the page behind it can't take focus or gain drafts (D18 containment plus D8 backdrop), so a confirmed close only discards the modal's own drafts.
- **Refetch failure after a save:** the toast "Saved (refresh failed — reload to see latest)". The page's `refresh-err` ErrorState shows behind the modal; ItemEditPage's `postSaveRefetchFailed` suppression is dropped.
- **Post-await writes.** Every post-await write *inside the modal and bodies* checks `alive && stillOnVid(savedVid)`. The item delete is the exception: it is page-owned (D9) and checks only the page's `stillOnVid`.

## Testing strategy

Vitest/jsdom with mount, unmount and flushSync (no testing-library).

- **T1 Modal:** the cases in §1.
- **T2 MarkdownEditor / AssetSidebar:** the existing tests are kept with selectors updated (`MarkdownEditor` 26, `MarkdownEditor.run-mode` 5, `AssetSidebar` 23, `AssetSidebar.run-mode` 7). New tests:
  - `plain` makes no render call, shows no tabs or sidebar, and shows the source;
  - `frozen` sets `readonly` on the textarea, keeps focus, and blocks drop/insert/upload;
  - the D11 hint;
  - delete via `IconButton`;
  - Escape on the inline delete confirm cancels it and is default-prevented;
  - no emoji.
- **T3a modal + page body (unit level, not yet routed):**
  - `ItemEditorModal.svelte.test.ts`:
    - the header, title row, footer and states;
    - the body contract (`saveDirty` vs `guardDirty`, `savedTitle`);
    - Save, Discard and ⌘S;
    - the busy interlock: Save is disabled while the body is busy, and inputs are `readonly` while saving, **with focus kept in a focused textarea and input across a ⌘S save**;
    - the `deleting` freeze. jsdom does not enforce `inert`, so assert the attribute plus disabled ×, Save and trash, rather than typing into the body;
    - **normalised fields come back clean:** a pasted `youtube.com/watch?v=…` URL, a trimmed text answer and a numeric `"2.50"` each save and leave no "unsaved changes" (the quiz cases run in T5a);
    - read-only published / archived / disabled, where disabled makes no render call (page **and** quiz);
    - autofocus lands on Title, and on × when read-only (never the trash button);
    - `refreshKey` increments after a page save;
    - the interim quiz wiring: a question draft makes the item guard-dirty only (the footer stays clean), and the per-question Save still works;
    - the interim app wiring.
  - MarkdownEditor `frozen` tests (T2 owns the prop; T3a adds the integration).
- **T3b routing + host:**
  - In `VersionEditPage.svelte.test.ts` (`renderRouted` gains `get itemId()`):
    - opening via Open, then ×: the modal is gone, the sequence is still open, and focus is back on the Open pencil;
    - **restore beats fallback:** open the item by `navigate` while focus is on a different element (e.g. the sequence header's toggle); on close, focus is on **that** element, not on the pencil;
    - in-page open, then × calls `history.back()` **once**, even after a double × or Escape-then-×;
    - a reload with focus on `body` while no item just closed does not move focus;
    - a cancelled prompt re-arms × (`closing` is cleared);
    - a deep link, then × replaces the address with the sequence address;
    - Escape (and not on `repeat`);
    - the dirty prompt on × / Escape / Back / the course link, with cancel keeping the drafts;
    - a stale item address gives the toast and the replace;
    - **delete:**
      - one confirm;
      - × and Escape are inert while the DELETE is unresolved; on success the close is a single `navigate(…, { replace: true, force: true })` and `history.back()` is never called;
      - the reload runs after the modal unmounted;
      - the toast "Item deleted" appears, with no "Item not found.";
      - focus lands on the sequence header;
      - a failed DELETE keeps the modal open and unfrozen, with focus on the trash button;
      - browser Back during the DELETE, then opening another item: that item's modal is **not** frozen and its × works;
    - browser Back during an unresolved DELETE: no second pop;
    - Tab from the last panel element can't reach the page behind;
    - after a create-item close, focus lands on the new item's Open pencil (`#item-{id}-open`); after a deep-link close, also on the item's pencil;
    - a tree reload (e.g. reorder) with focus on `body` does **not** move focus.
  - **Back-freeze regression, through `App.svelte`** (a new `tests/App.editorRoutes.svelte.test.ts` that mounts `App` and drives the real router, like `SuperuserShell.svelte.test.ts`):
    - It runs in **two stages**:
      1. **Freeze stage**, right after Back from the item:
         - no uncaught error (a `window` `error` / `unhandledrejection` spy, plus vitest's unhandled-error failure);
         - the page's load effect has run (the Blocks card rendered, not stuck);
         - the sequence's create-item `+` opens its form.
      2. **Modal stage:** create another item without reloading; the modal opens on it. Plus sequence → item → sequence → item.
    - **Prove it can fail:**
      1. write it **first**, against today's routing (ItemEditPage still mapped), and confirm it fails **at the freeze stage**;
      2. after the switch, run a one-off mutation: map the item route to a stub page that reads the store and calls `clearEditorVersion` on destroy; confirm it fails **at the freeze stage** again; then remove the stub.
      
      A failure at the modal stage proves nothing. If jsdom can't reproduce the freeze in step 1, record that in the ledger and keep the test as a routing smoke test; the mutation step still runs.
  - `deriveExpansion` and `handleStaleIdFallback` get item-level cases, including the `deletedIid` suppression; `router.test.ts:54` is updated.
- **T3c video:** Video URL Save/Discard, `videoUrlEmpty` blocks, normalise-on-save.
- **T4 Video card / App:**
  - the preview debounce;
  - the provider meta;
  - the no-embed footer and "No preview" area;
  - the 296px frame;
  - the App tests ported;
  - Remove confirms;
  - the title saves via the footer;
  - `busy` during an upload disables Save;
  - disabled: no asset fetch;
  - no write after unmount.
- **T5a quiz draft model + Save:** (plus: focus kept across ⌘S in a question editor; correct-mark controls are `disabled` during an in-flight Save, and a click there changes nothing)
  - one Save sends title → questions → options in the §5.3 order (single choice: true before false);
  - validation is dirty-scoped: a clean zero-option choice question does not block a title Save;
  - an invalid dirty question is expanded and focused, and shows `needs fixing`;
  - a partial failure stops, keeps the later parts dirty, advances the earlier baselines and reloads the tree;
  - the published confirm appears once, and Cancel sends nothing;
  - `discard()` resets save drafts; the page guard sees quiz drafts;
  - the draft-mark row look (D25).
- **T5b quiz structure with drafts:**
  - add, delete and reorder of questions and options while drafts exist (§5.4);
  - a typed add form prompts on close but is not save-dirty;
  - D24's mark-draft reset on option delete;
  - the delete-question confirm suffix;
  - structure is disabled while saving, and Save is disabled while structure is in flight.
- **T6 quiz look:** the 3f structure and classes, the type names, the D15/D16 reasons, the stacked question editors (D23), and no emoji.
- **Gate:** sections (aa)-(ag), one per styling task, plus the `.notice` target update. Every new check is mutation-tested.
- **Final:** the full suite, `npm run check` (0 errors; warnings must not grow), the gate, a whole-branch review, and the browser pass (Safari, step by step, with the user).

## Task decomposition (10 tasks; carried into the implementation plan)

Every task ends green (Constraint 14).

| Task | Deliverable | Notes |
|---|---|---|
| **T1** | `ui/Modal.svelte` (+ `closeDisabled`, focus containment, autofocus default) + tests | Generic; no item knowledge. **No gate section yet:** the gate grades the built bundle (`visual-refresh-gate.sh:7,118-119`), and nothing imports Modal until T3a |
| **T2** | `MarkdownEditor` + `AssetSidebar` restyle (3c) + `plain` (D6) + `frozen` (D10) + the AssetSidebar Escape + gate (ab) | Also restyles MiniProjectModal's use (D21) |
| **T3a** | `ItemEditorModal` (header, Title, footer, body contract, interlock, `deleting` freeze) + `PageBody` + **interim wiring** + the D6 quiz `plain` leg + gate (aa) Modal + (ac) ItemEditorModal/PageBody | Unit-tested, and **imported into `VersionEditPage` behind `{#if expandedItem}` with `expandedItem` still always `null`** (routing untouched, so ItemEditPage still serves items), which puts Modal's and the modal's CSS into the bundle for the gate. `expandedItem` is declared `$state<AdminTreeItem \| null>(null)` (a plain `const … = null` narrows to `never` and fails `npm run check`). The dead branch's other props come from the expanded block/sequence with typed fallbacks; T3b replaces it with `deriveExpansion`. **Interim wiring** (quiz): mount today's `QuizEditor` with `showTitle={false}` and `versionDisabled`; the modal Save sends the title (`PATCH {title}`); `QuizEditor`'s `quizDirty` is bridged into **`guardDirty` only**; `saveDirty` = the title, and the footer's Discard resets only the title; per-question Save/Discard keep serving question drafts until T5a. Interim `discardAll` resets the title only: a confirmed close unmounts the modal, which drops today's `QuizEditor` drafts anyway. **Interim wiring** (interactive app): the modal Save sends `PATCH {title}`; mount today's `InteractiveAppEditor` with its `<h3>` title hidden (`showTitle={false}`) and its `uploadBusy` made bindable and bound to `busy`, under the modal Title, and **only when `!versionDisabled`** (otherwise the D6 note; its script fetch would 403, `assets.py:142-143`), until T4 |
| **T3b** | Routing + `VersionEditPage` host (D7 latch, D9 page-owned delete with freeze, D18 focus with `justClosedItem` + `ItemRow` pencil ids, D19 stale item) + delete `ItemEditPage` and its tests + the D22 contract + the App-level Back-freeze test (written first, mutation-proved) | |
| **T3c** | `VideoBody` logic (field, validation, normalise, save) | Card styling arrives in T4 |
| **T4** | Video preview card (3e) + `AppBody` (D4, D14, `busy`) replacing `InteractiveAppEditor` + the `VideoFrame` / `InteractiveFrame` `height` props + gate (ad) + the `.notice` target | |
| **T5a** | Quiz draft model + one-Save orchestration (§5.1-5.3, D10 validation, D20, D25, `frozen`) | Removes the interim bridge and per-question Save |
| **T5b** | Quiz structure with live drafts (§5.4, D24, add-form guard trackers, interlock, `locked()`) | |
| **T6** | Quiz look (§5.5, D23) + `QuestionTypePicker` + gate (ae) | |
| **T7** | Clean-up: stale comment references, close the backlog carry-overs, the final gate count (af: an emoji scan over every 5b file; ag: the Constraint 11 literal-colour scan, with its exemptions, over every 5b-touched file) | |

## Review Focus (for the plan)
1. Close semantics on a deep link vs. in-page (D7): × must never leave the app, including double × or Escape and a cancelled prompt.
2. One Save across N independent PATCHes (D10, §5.3): order, dirty-scoped validation, partial failure, baselines, and the busy interlock.
3. Structure operations with live drafts in the quiz (§5.4, D24): no lost or misattributed drafts after reorder, delete or refetch.
4. Disabled version: zero `/render` and asset requests anywhere in the modal (D6), via the `versionDisabled` plumbing.
5. Focus: open → Title, containment, close → opener / Open pencil / sequence header (D18), with no racing scroll.

## Review resolutions (round 1, 2026-10-07: Opus + Fable)

No Critical findings in either lane. Every Important finding was accepted:

- **Repeated close could pop past the sequence page** → D7 latch, plus `e.repeat`.
- **The delete reload and toast were lost after the modal unmounted** → D9 page-owned delete with `deletedIid`.
- **Validation was quiz-wide** → D10 is dirty-scoped, with a zero-option exemption, plus expand/focus and `needs fixing`.
- **Quiz add forms were untracked** → D5 split into `guardDirty` / `saveDirty`.
- **Save could interleave with structure operations** → the D10 busy interlock.
- **`plain` couldn't be derived from `perms`** → the D6 `versionDisabled` plumbing.
- **Focus could escape the modal** → D18 containment and D8 `mousedown`.
- **Autofocus landed on trash** → the D18 autofocus selector.
- **The Back-freeze test couldn't catch the regression** → an App-level test.
- **The "no sidebar in questions" claim was false** → D23.
- **T3 broke quiz/app items in between commits** → Constraint 14 and the interim wiring.
- **Constraint 8 contradicted the focus ring** → Constraint 11 rewritten.

Minors folded in:
- focus fallbacks (D18);
- the D22 wording;
- the `[S,S]` cost (D19; D9's close is settled in round 3);
- `untrack`;
- the title ownership (§2/§5.3);
- the single-choice partial state (D10);
- the plumbing gaps (`assetContext`, `refreshKey`, read-only title, no-embed area, AssetSidebar Escape, `keyCode 229`);
- D11/D12 precision;
- `unsavedSuffix`;
- D24/D25;
- the `VideoFrame` margin;
- the `deriveExpansion` parameter order;
- inheriting Constraints 8-10;
- `AssetSidebar.run-mode`;
- the T3/T5 splits;
- the `-webkit-backdrop-filter`.

## Review resolutions (round 2, 2026-10-07: Opus + Fable on rev 2)

Every round-1 Important finding was confirmed resolved, except the four below, which were resolved now. The new Important findings were all accepted:

- **No protection while a DELETE is in flight** (both lanes): the D9 freeze (`deletingIid`, `closeDisabled`, `requestCloseItem` early-return), the `routeIid` check before closing, and the failure path.
- **The interim quiz wiring lit up Save for drafts it couldn't send** (both lanes): bridge into `guardDirty` only (T3a), and the quiz `plain` leg moved into T3a.
- **The named-colour ban forbade `transparent`, `currentColor` and system colours** (both lanes): Constraint 11's definition plus exemptions.
- **"Read-only while saving" would blur or unmount the editor**: `MarkdownEditor frozen` and the `readonly` attribute (D10).
- **The focus fallback fired on every tree reload**: the one-shot `justClosedItem` (D18).
- **The Back-freeze test could pass trivially**: write it first and mutation-prove it (T3b).

Minors folded in:
- `savedTitle`;
- `busy` includes uploads, and the contributor gains `locked()`;
- the focus after delete;
- the `focusin` teardown order;
- the `staleIid` wording;
- the D24 order and scope;
- the hex fallbacks;
- the Modal autofocus default;
- the pencil ids;
- T3 split into T3a/T3b/T3c.

## Review resolutions (round 3, 2026-10-07: Opus + Fable on rev 3)

Both lanes confirmed the round-2 Important findings resolved. The new Important findings were accepted:

- **`readonly` doesn't freeze radios and checkboxes** (both lanes): checkable inputs are `disabled` while frozen; a save advances `saved` only (D10); the modal body is `inert` while deleting (D9).
- **The Back-freeze proof steps failed for the wrong reason**: a two-stage test, where both proof steps must fail at the freeze stage (T3b).
- **Gate sections (aa)/(ac) could not see unimported components**: both move to T3a, which imports the modal behind an always-null `{#if}`; T1 has no gate section.

Minors folded in:
- `deleting` is per item, and the close early-return is per route item;
- the delete close always uses `navigate` replace + force (no `history.back()` race);
- the delete failure refocuses;
- the gated header focus;
- the D18 effect order, `untrack` and `await tick()`, with the pencil winning on a deep-link close;
- the restore-vs-fallback test;
- Constraint 11: comment exemption and value-position matching;
- `frozen` reaches `uploadOne` and `AssetSidebar`;
- the interim app's title, hidden `<h3>` and no fetch when disabled;
- the interim `discardAll` is title-only.

## Review resolutions (round 4, 2026-10-07: Opus + Fable on rev 4)

Both lanes confirmed the round-3 Important findings resolved.

**One new Important finding, raised in both lanes, was accepted.** The rev-4 "advance `saved` only" rule left normalised fields (trimmed text, `"2.50"` → `"2.5"`, the embed URL) dirty forever. The fix is the per-field write-back of sent fields after success (D10), plus a test.

Minors folded in:
- `Modal bodyInert` and the panel `tabindex="-1"` as the last-resort focus target;
- `await tick()` before the failure refocus;
- jsdom `inert` assertions;
- `deletedIid` set only when the route is still on the item;
- the D18 flag consumed before the equality skip, with the fallback replacing the header path;
- Constraint 11 doesn't strip `//`;
- the T3a `expandedItem` typing and dead-branch props;
- the interim app's `uploadBusy` bound to `busy`.

## Review resolutions (round 5, 2026-10-07: Opus + Fable on rev 5)

Both lanes confirmed the round-4 Important finding resolved. Fable found no Critical or Important issues.

**Opus raised one Important finding, which was accepted.** Bypassing the equality skip let the header path override FocusTrap's restore after an in-page close. The fix: when the close flag is set, leave focus alone unless it is on `body`/`null`, then return (D18).

Minors folded in:
- baselines come only from the PATCH echo, with the reload frozen and refreshing the tree only (§2);
- the `schemas.py:48` citation is dropped;
- the containment handler verifies that focus actually landed;
- the close flag is cleared only when its handling runs;
- `//` comments are stripped only when they start a line.

## Review resolutions (round 6, 2026-10-07: Opus + Fable on rev 6)

**No Critical or Important findings in either lane.** The round-5 Important finding is confirmed resolved.

Minors folded in (rev 7):
- the close flag is also cleared on the focus effect's early returns;
- (ag) covers CSS contexts only, matching named colours as whole value tokens;
- `'discarded'` keeps the "Saved" toast.

## Git stacking
Same local branch as 5a. One commit per task after its two-lane review is clean; no push and no merge.
