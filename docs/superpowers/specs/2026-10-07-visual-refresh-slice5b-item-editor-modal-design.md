# Visual Refresh — Slice 5b: Authoring — Item Editor Modal (3c + 3e + 3f) — Design Spec

**Status:** Design — **rev 1** (brainstormed with the user 2026-10-07; self-checked). Next: two-lane review → user review → writing-plans.

**Authority:** `docs/design/visual-refresh/reference-screens.dc.html` (artboard **3c** `:1649-1758` page, **3e** `:1759-1835` video, **3f** `:1836-1969` quiz; `ref NNNN` below are line numbers in that file) and `docs/design/visual-refresh/mathion-visual-spec.md` (§4 "Item editor modal (3c, 3e, 3f)" `:212-229`, Icon button `:168-181`, §3 colour of state `:110-133`, type-name rule `:230`). Where the two disagree, the spec's *rules* win over the artboard's *pixels*. **User decisions** (§Decisions) override both, and each override is recorded.

**What this slice does.** Opening an item stops routing to a separate page (`pages/editor/ItemEditPage.svelte`, deleted). Instead a **modal opens over the version editor**. Four item types share one frame: page (3c), video (3e), quiz (3f) and interactive app (no artboard; borrows 3e). The slice also adds a **generic modal frame** (`ui/Modal.svelte`). Slice 6 will reuse it for `runs/{NewRunModal, PublishConflictsModal, RosterImportModal, MiniProjectModal}` (10k/10l/10m and the roster import). 5b does not touch those four.

**Carried in from 5a** (`docs/backlog/slice5a-authoring-polish-debt.md` §"Browser pass (2026-10-07) — requirements carried to Slice 5b"):
- **(1) The Back freeze.** It is removed by design. With ItemEditPage gone, no page swap shares the editor store (§2).
- **(2) The disabled-version preview.** Decided below (D6).

Branch `feat/visual-refresh-slice5-authoring`, continuing from 5a's tip `736bbd4`. **LOCAL — not pushed, not merged.**

---

## Global Constraints

Inherited verbatim from the Slice-5a spec (`2026-10-06-…-slice5a-…-design.md` §Global Constraints 1-7): colours → existing tokens only (no new colour tokens; delete every hex literal in touched files); no opacity-based dimming; no emoji or decorative glyphs (SVGs `aria-hidden`, `viewBox="0 0 16 16"`, `stroke="currentColor"`, 1.6 / 1.9 for the check, round caps and joins); mono for every numeral; per-component literal forms (a) `/* ref NNNN */`, (b) scale named, (c) mechanism, geometry only; dense control metrics are final (`ui/Button.svelte` as-is); `ItemMark` as-is. Additionally:

8. **Two non-hex literals are allowed in exactly one file, `ui/Modal.svelte`**, each annotated `/* ref 1684 */` and `/* ref 1682 */` (spec :216-217):
   - the panel shadow `0 16px 44px rgba(20,24,35,.22)`;
   - the backdrop `color-mix(in srgb, var(--text) 34%, transparent)` (= `rgba(22,24,29,.34)`, i.e. `--text` at 34%).

   No other file may contain `rgba(` or `box-shadow` with a colour.
9. **Gate discipline as in 5a.** Every new section is hash-anchored (`own` + `uniq1`), carries positive pins with paired negatives, a `sweep`, a "no rem font sizes" check and an emoji source scan. `EXPECTED_CHECKS` is bumped exactly.
10. **Stay in the project directory.** That covers scratch files, gate temp files and reviewer probes. The gate's `mktemp "${TMPDIR:-/tmp}"` (`visual-refresh-gate.sh:92`) is run with `TMPDIR` pointing into the plan workspace.

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
| `rgba(22,24,29,.34)` / `rgba(20,24,35,.22)` | backdrop, shadow | Constraint 8 |

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
- **D6 (user) — Disabled version: read-only text plus a calm note, with no server call.**
  - Page bodies and quiz question text show their markdown as plain mono text, and the interactive app shows no preview.
  - All carry the note *"Preview is unavailable while this version is disabled — enable it to preview or edit."*
  - Nothing calls `/render` or fetches assets. The deliberate 403 (`backend/mathion/api/versions.py:185-186`) stays, but the UI no longer provokes it.
  - Archived versions still render (the server allows it).
- **D7 — Close semantics.** × and Escape call the page's `requestCloseItem()`:
  - **If the modal was opened from within this page instance** (an Open pencil, a create-item success, or Forward onto it), close = `history.back()`. Back and × then behave identically and history doesn't grow.
  - **Otherwise** (a deep link, or a reload on the item URL), close = `navigate(seqUrl, { replace: true })`.

  Both paths run the dirty guard. Cost if wrong: one extra history entry or one lost Forward entry.
- **D8 — Clicking the backdrop does nothing.** This avoids losing edits by accident. `ui/Modal` offers `closeOnBackdrop` (default `false`) for Slice 6.
- **D9 — Header delete.**
  - **Enabled** only when the structure is editable, nothing is dirty and nothing is in flight (as in 3c/3e/3f).
  - **Tooltips:**
    - the structure reason, when structure is forbidden;
    - else *"Delete this item — save or discard changes first"*;
    - else *"Delete this item"*.
  - **On confirm:** `DELETE`, then `navigate(seqUrl, { replace: true, force: true })`, then a forced tree reload, then the toast "Item deleted".
  - Navigating first avoids a spurious "Item not found." from the stale-item check (5a pattern).
- **D10 — Footer Save.**
  - **One click sends everything.** The modal stays open, and **⌘S / Ctrl+S** inside the modal also saves.
  - **Validation runs before anything is sent.** If any field is invalid (empty title, empty video URL, empty question text, invalid numeric answer, a single-choice question without exactly one correct option, a multiple-choice question without any, option text outside 1-500), nothing is sent. Every invalid field shows its inline error, and the toast reads "Fix the highlighted fields".
  - **Partial failure.** Requests go in a fixed order (§5.3). Each part that succeeds advances its saved baseline. **The save stops at the first failure.** That field shows the server message, and later parts stay unsaved. A pop-up names what failed. Nothing is rolled back (the API has no batch endpoint).
  - Cost if wrong: a partially saved quiz, made visible rather than hidden.
- **D11 — The asset hint box** uses the information-banner treatment:
  - `--surface-2` background, a 3px `--primary` left rule, `--text-3` 11.5px text, no radius;
  - the legacy yellow hexes are deleted.
- **D12 — Plain inputs** follow the 5a create-form precedent:
  - `height: var(--control-h)`, `padding: 0 var(--control-pad-x)`, `1px solid var(--border-strong)`, `--radius`, `--surface`, `font-size: var(--control-font)`, `--text`, `caret-color: var(--primary)`;
  - focus: `1.5px var(--primary)` plus a `3px var(--primary-soft)` ring (`:focus-visible`), matching InlineField's open editor;
  - error: border `--danger`, and a 12px `--danger` message below;
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
  - disabled arrows carry a reason: "Already first", "Already last", or the structure reason.
- **D16 — Option reorder is kept.** It exists today; 3f simply doesn't draw it. Option rows get ↑ ↓ before 🗑, with the same rules as D15. Dropping a working feature would be the bigger deviation.
- **D17 — Modal placement.**
  - The backdrop is `position: fixed; inset: 0`, above the app header (`z-index: 100`, the existing modals' value).
  - It blurs everything behind it with **`backdrop-filter: blur(1px)`**, which matches the artboard's blurred page and header without blurring the modal itself.
  - The panel is centred horizontally, with `top: 26px` (ref 1684).
  - Width is `min(920px, 100vw - 32px)`; max height is `min(600px, 100vh - 52px)`.
  - While the modal is open, the document doesn't scroll (`overflow: hidden` on `<html>`, restored on close).
- **D18 — Focus.**
  - **On open,** the first field takes focus (Title) when editable, otherwise the × button.
  - **On close,** focus returns to the opener (the item's Open pencil) if it's still connected. Otherwise, after a deep link, it goes to the sequence header.
  - **The page's focus `$effect`** is skipped while an item is open, so it doesn't race the modal.
- **D19 — Stale item addresses.**
  - This covers an item that no longer exists, belongs to another sequence, or has an invalid id.
  - The page shows the toast "Item not found." and replaces the address with the sequence (`{ replace: true, force: true }`), extending 5a's `deriveExpansion` / `handleStaleIdFallback`.
  - Precedence: block > sequence > item.
- **D20 — Published versions.**
  - Text stays editable. Structure buttons are disabled, with the 5a structure reasons.
  - If a Save changes any answer key (a numeric or text answer, or a correct mark), **one confirm** appears before anything is sent: *"This quiz is published. Changing the answer key does not re-score students who already attempted — their recorded scores keep the old key. To re-grade everyone, create a new version instead. Continue?"* It asks on every such Save.
  - This replaces the per-question, per-mount latch. Cost if wrong: one extra confirm.
- **D21 — The `MarkdownEditor` / `AssetSidebar` restyle also reaches `MiniProjectModal`** (run assets), which uses them. This is accepted; Slice 6 restyles the rest of 10m.
- **D22 — The store contract.** `currentEditorVersion`'s header comment changes to: *"only `VersionEditPage` reads and clears the editor tree; nothing else may call `clearEditorVersion`"*. `VersionEditPage` keeps `onDestroy(clearEditorVersion)`, which is safe because no page it swaps with reads the store.

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
- `autofocusSelector?`, `autofocusPriorityOrder?` (passed to `FocusTrap`);
- snippets `header` (required), `children` (body), `footer?`.

**DOM:**

```
div.modal-backdrop (fixed, inset 0, z-index 100, backdrop colour + backdrop-filter, display:flex, justify-content:center, align-items:flex-start, padding-top:26px)
  FocusTrap
    section.modal-panel role="dialog" aria-modal="true" aria-label|aria-labelledby  (width/max-height via style vars from props)
      header.modal-head   {@render header()}  + IconButton glyph="close" size="md" aria-label="Close" title="Close" → onRequestClose
      div.modal-body      {@render children()}
      footer.modal-foot   {@render footer()}   (omitted when no footer snippet)
```

**Styles:**

| element | style |
|---|---|
| panel | `width: min(var(--modal-w), 100vw - 32px)`, `max-height: min(var(--modal-h), 100vh - 52px)` (`--modal-w/--modal-h` are component-local custom properties set from props, not theme tokens); `display:flex; flex-direction:column; overflow:hidden; background:var(--surface); border:1px solid var(--border-strong); border-radius:var(--radius-lg); box-shadow:` Constraint 8 |
| `.modal-head` | `display:flex; align-items:center; gap:10px; padding:12px 14px 12px 16px; border-bottom:1px solid var(--border)` (ref 1685) |
| `.modal-body` | `flex:1 1 auto; min-height:0; overflow:auto; padding:14px 16px; display:flex; flex-direction:column; gap:12px` (ref 1695), and `.modal-body > :global(*) { flex: 0 0 auto; }` (spec :220-221) |
| `.modal-foot` | `display:flex; align-items:center; gap:9px; padding:12px 16px; border-top:1px solid var(--border); background:var(--surface-3)` (ref 1750) |

**Behaviour:**
- **Escape:** a `<svelte:window onkeydown>` in the bubble phase. When `e.key === 'Escape' && !e.isComposing && !e.defaultPrevented`, it calls `preventDefault()` and `onRequestClose()`. Inner widgets that consume Escape (InlineField, inline delete confirms) stop propagation or `preventDefault` first.
- **Backdrop click:** only when `closeOnBackdrop`, and only when the target is the backdrop itself.
- **Scroll lock:** on mount, save `document.documentElement.style.overflow` and set it to `hidden`; restore it on destroy.
- Modal holds no dirty state; the parent decides what closing means.

**Tests (`Modal.svelte.test.ts`):**
- the role and ARIA name;
- × and Escape call `onRequestClose`;
- Escape while composing, or after an inner `preventDefault`, does not;
- a backdrop click does nothing by default and closes with `closeOnBackdrop`;
- a click inside the panel never closes it;
- the scroll lock is applied and restored;
- autofocus passes through;
- the footer is omitted when no snippet is given.

### 2. Hosting, routing, close — T3

**`routes.ts:14`** → `component: 'VersionEditPage'`. Svelte keeps the same page instance across all four editor patterns, because `App.svelte`'s `<Comp {...params}/>` keeps one constructor. On the item pattern `itemId` is a string; elsewhere it is `undefined`.

**`VersionEditPage.svelte`:**
- **Props** gain `itemId?: string`; `routeIid = itemId ?? null`.
- **Opened from the page (D7).** A plain (non-reactive) `let mountedOnItem = itemId !== undefined` is captured at script init, alongside `let openedFromPage = $state(false)`. An `$effect` tracking `routeIid` sets `openedFromPage = routeIid !== null && !mountedOnItem`. Once `routeIid` becomes `null`, `mountedOnItem` is set to `false`, so later opens count as in-page.
- **`requestCloseItem()`:**
  - if `openedFromPage`, `history.back()`;
  - else `navigate(seqUrl, { replace: true })` (guards run).
- **`deriveExpansion(routeBid, routeSid, routeIid, effectiveTree)`** returns `expandedItem`, plus `staleIid` when the item is absent from the expanded sequence or the id is not a positive integer. `handleStaleIdFallback` handles `staleIid` with "Item not found." and `navigate(seqUrl, { replace: true, force: true })`. Precedence: `staleBid > staleSid > staleIid`.
- **Template.** Inside the loaded `{:else}` branch, after the state bar: `{#if expandedItem}{#key expandedItem.id}<ItemEditorModal …/>{/key}{/if}`. The modal sits inside the page so it shares the page's `DIRTY_REGISTRY_KEY` context.
- **Focus `$effect`** (5a order: load → validation → focus) returns early while `routeIid !== null` (D18). It tracks `routeIid` so that, after a deep-link close, it focuses the sequence header. An in-page close is skipped by the existing `lastFocusedTarget` equality, so `FocusTrap`'s restore-to-opener wins.
- **Store.** `onDestroy(clearEditorVersion)` stays, and the comment is updated (D22).

**Openers:** `SequenceAccordion.openItem` and the create-item success keep their plain `navigate(itemUrl)`. They now land on the same page instance, so there is no swap and no freeze.

**`ItemEditorModal.svelte`:**
- **Props:** `courseSlug`, `vid`, `version: AdminTreeVersion`, `perms`, `block`, `seq`, `seqIndex: number` (for "S1"), `item`, `itemIndex`, `itemCount`, `stillOnVid`, `onRequestClose`.
- **Header snippet:**
  - `ItemMark type={item.type} state="covered"` (22px tile, ref 1686);
  - `<h2 id={labelId} class="name">{item.title}</h2>` (15px/600 `--text`);
  - `<span class="mono ctx">{typeWords} · S{seqIndex} · item {itemIndex} of {itemCount}</span>` (11.5px `--muted`; `typeWords` = `static page` / `video` / `quiz` / `interactive app`);
  - a right group `margin-left:auto; gap:6px` holding `IconButton glyph="trash" size="sm" danger` (D9).
  
  `Modal` adds ×. `labelledby={labelId}`.
- **Body:**
  - the Title row (`.field-row` grid `132px 1fr; align-items:center; gap:12px`; label 12.5px `--muted`; input per D12, `maxlength="200"`, `aria-label="Title"`, required);
  - then the type body:
    - `PageBody` for `static_page`;
    - `VideoBody` for `video`;
    - `AppBody` for `interactive_app`;
    - `QuizEditor` for `quiz`;
    - otherwise "This item type can't be edited here."
- **Footer** (omitted when `!perms.canEditTextFields`, i.e. archived or disabled):
  - `<span class="dirty mono">` (flex:1; 11.5px `--status-needs-revision-fg`; text "unsaved changes" when dirty, else empty);
  - `Button variant="ghost"` **Discard** (disabled when clean or busy; title "No changes to discard" when clean);
  - `Button variant="primary"` **Save** (disabled when clean or busy; title "No changes to save" when clean; `loading` while busy).
- **Read-only note (D6):** when `version.is_disabled`, an information banner sits under the Title row (D11 treatment) with the D6 text.

**Save / discard protocol:**
- **Each body** exports `save(titleDraft: string | undefined): Promise<SaveOutcome>` and `discard(): void`, plus bindable `dirty` and `validate(): boolean`.
- **The modal** owns the title tracker and registers **one** `RegisteredTracker` in the page registry: `isDirty = titleDirty || body.dirty`; `discard()` resets both. Unregister on destroy.
- **Save sequence:**
  1. `validate()` on the modal and the body;
  2. then `body.save(titleDirty ? title : undefined)`.
- **Page and video bodies** send the title inside their single `PATCH`. **App and quiz** send `PATCH {title}` first.
- **After a full success**, `loadAdminTree(vid, { force: true })` is gated on `stillOnVid`. Baselines advance from the response or fresh tree; the `'error'` and `'discarded'` refetch outcomes keep ItemEditPage's rules (`:169-203`). Then `refreshKey++` and the toast "Saved".
- **A failure** produces the D10 partial-failure behaviour.
- **⌘S / Ctrl+S** inside the panel triggers Save (`preventDefault`).

**Delete:** D9.

**Close:** `onRequestClose` = the page's `requestCloseItem`.

**Tracker seeding.** Drafts are seeded once per mount from `item`; `{#key expandedItem.id}` remounts on item change. Forced tree reloads, such as a quiz add or an app upload, never re-seed (ItemEditPage `:122` rule).

### 3. Page body (3c) — T2 (MarkdownEditor/AssetSidebar) + T3 (PageBody)

**`PageBody.svelte`:** a tracker `{ content_md }`, `<MarkdownEditor assetContext bind:value bind:refreshKey>`. `save` sends `PATCH /api/items/{id}` `{ title?, content_md }`.

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
- **New prop `plain = false` (D6):** with `readOnly && plain`, no tabs, no `/render` call (the `onMount` `loadPreview` is skipped), and the source shows as `pre`-wrapped mono text in the card.
- **Delete** `#a33`, `#c62828` and the `ui-monospace` literal; use `--danger` and `--font-mono`.

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
- **Delete** every hex, `rem` font size and opacity literal listed in research §6.2 (`:327-351`). Emoji `🗑` and `×` become SVG `IconButton`s.
- **The two-step inline delete confirm stays.**

### 4. Video body (3e) and App body — T4

**`VideoBody.svelte`:**
- **Fields:** a tracker `{ video_url }`, plus a **Video URL** `.field-row` (mono input, `type="url"`, required, `aria-label="Video URL"`) with the hint text below in 12px `--muted`: "Paste any YouTube or Vimeo URL — it is converted to embed form on save."
- **Preview card** (ref 1813-1824):
  - the card is `1px solid var(--border)`, `--radius`, `overflow:hidden`;
  - header: `padding:8px 12px; background:var(--surface-2); border-bottom:1px solid var(--border)`, with "Preview" 12.5px/600 and a mono 11.5px `--muted` provider;
  - player area: 296px, `--surface-2` (D13), holding `VideoFrame height={296}` from a 500ms debounce of `safeIframeUrl(normalizeVideoUrl(url))`;
  - footer: `padding:8px 12px; border-top:1px solid var(--border-soft); background:var(--surface-3)`, with a mono status on the left and an **Open in new tab** link (12.5px `--primary`, `target="_blank" rel="noopener noreferrer"`) on the right.
- **Validation:** an empty URL gives "Video URL is required".
- **Save:** `PATCH { title?, video_url: normalizeVideoUrl(url) }`.
- **Read-only:** the URL is shown as mono text, with the preview card kept (the iframe is external, so there is no server call even when disabled).

**`AppBody.svelte`** (replaces `components/items/InteractiveAppEditor.svelte`; its 13 tests in `tests/InteractiveAppEditor.svelte.test.ts` are ported):
- **App script row** in the `.field-row` grid: the current filename in mono, or "No script", plus buttons Upload (when none) or Replace and Remove (`Button variant="secondary"` / `"ghost"`).
- **Upload and Replace:** read the file, run `scanAppSource` warnings, `uploadAsset`, `PATCH {script_url}`, force a reload, then toast. This keeps the orphan clean-up and the 409 message.
- **Remove** now **confirms** ("Remove the app script? Students will see an empty app."), then `PATCH {script_url:null}` and a reload.
- **Lifecycle guards:** an `alive` flag plus `stillOnVid` on every post-await write.
- **Preview card:** the same card as video. Header "Preview" with a mono `interactive app` meta, and body `InteractiveFrame height={360}` (D14). Disabled versions show the D6 note instead and fetch nothing. The blank-preview hint is kept.
- **Save:** `PATCH {title}` only.
- **Its `.notice` rule** is renamed `.app-hint` and moved under the D11 treatment. The gate's `notices` structural target (`visual-refresh-gate.sh:937`, count 2) drops to **1** (`InteractiveAppItem` only), and the two-authors comments at `:934-936` and `:1017` are updated.

### 5. Quiz (3f) — T5 (save model) + T6 (look)

#### 5.1 Ownership
- **`QuizEditor` keeps its private dirty registry** as the quiz-level aggregator (`QuizEditor.svelte:27-30`). It exposes bindable `dirty` (= `registry.isAnyDirty()`) plus `save()`, `discard()` and `validate()` to the modal.
- **The modal's single page-registered tracker covers the quiz** (§2), so the page `DirtyGuard` sees quiz drafts. **There's no second guard:** `QuizEditor` mounts no `DirtyGuard`.
- **Each `QuestionAccordion` keeps its draft and saved state** (`:49-57`), and its option trackers (`:105-124`), extended with `is_correct` per option. These live in the accordion component, which stays mounted while its body is collapsed (`:80-82`).
- **Each accordion registers a save contributor** with `QuizEditor` through a new context `QUIZ_SAVE_KEY`. The contributor offers:
  - `{ questionId, order(): number, isDirty, keyChanged(): boolean, validate(): boolean, save(): Promise<'ok' | 'failed'>, discard() }`.

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
1. Title (the modal, `renameItem`).
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
The two-way lock is removed: the `dirty` term leaves `optionsDisabled` (`:142`) and `structureDisabled` (`:372`). The rest stays serialised: `questionsLocked` and `optionsLocked` still prevent concurrent structure operations.

Drafts are keyed by id:
- **Add a question or option:** existing drafts are untouched. The add forms stay immediate, are not dirty-tracked, and use the 5a collapsed-form pattern, so `+` becomes `×`.
- **Delete a question:** `confirm('Delete question "…"? This cannot be undone.' + (dirty ? ' Its unsaved edits will be lost.' : ''))`, then its contributor unregisters.
- **Delete an option:** drops its draft. `canDeleteOption` (C2, `:140-141`) uses the **saved** `is_correct`, because the delete acts on the server.
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
  - a **Question** row (grid `132px 1fr; align-items:start`) with a `MarkdownEditor` (no sidebar in question mode, as today; `plain` when disabled);
  - an **Explanation** row (the same editor);
  - per type:
    - **single and multiple choice:** an **Options** heading row (label 12.5px `--muted`, `width:132px`; `+` primary, labelled "Add option") and an options list (`gap:6px`);
    - **numeric:** **Answer** and **Precision** rows (D12 inputs, mono);
    - **text:** an **Answer** row.
- **Option row** (ref 1913, 1919):
  - `display:flex; align-items:center; gap:10px; padding:4px 9px; border:1px solid var(--border); background:var(--surface); border-radius:var(--radius)`;
  - a correct row uses `border-color:var(--primary); background:var(--primary-soft)`;
  - a native radio or checkbox, `accent-color: var(--primary)`, 15px;
  - a text input (D12 metrics, transparent border until focus, so a row reads like 3f's text but stays editable);
  - a `correct` badge (11px/500, `--status-accepted-*`, `2px 7px`, radius 3) on correct rows;
  - ↑ ↓ (D16) and 🗑 `IconButton sm`.
- **`QuestionTypePicker`** (in the add form): restyled like 5a's `ItemTypePicker` cards, with the labels `single choice` / `multiple choice` / `numeric answer` / `text answer`.
- **Emoji removal:** all of 🗑 ↑ ↓ ▾ ▸ ✓ ◉ ☑ ✎ ＋ are removed from the quiz files.

---

## Data flow & error handling

- **Single tree owner.** Only `VersionEditPage` reads and clears `currentEditorVersion`. The modal and its bodies read through props, and refresh with `loadAdminTree(vid, { force: true })` gated on `stillOnVid`.
- **Navigation guard.**
  - Opening an item while a page draft is open prompts (5a D3); confirming discards all.
  - While the modal is open, the page behind it can't gain new drafts (focus trap and backdrop), so a confirmed close only discards the modal's own drafts.
- **Refetch failure after a save:** the toast "Saved (refresh failed — reload to see latest)". The page's `refresh-err` ErrorState shows behind the modal; ItemEditPage's `postSaveRefetchFailed` suppression is dropped.
- **Every post-await write** in the modal and bodies checks `alive && stillOnVid(savedVid)`.

## Testing strategy

Vitest/jsdom with mount, unmount and flushSync (no testing-library).

- **T1 Modal:** the cases in §1.
- **T2 MarkdownEditor / AssetSidebar:** the existing tests are kept with selectors updated (`MarkdownEditor` 26, `MarkdownEditor.run-mode` 5, `AssetSidebar` 23). New tests:
  - `plain` read-only makes no render call and shows the source;
  - the D11 hint;
  - delete via `IconButton`;
  - no emoji.
- **T3 host + page/video:**
  - `VersionEditPage.svelte.test.ts` (`renderRouted` gains `get itemId()`):
    - opening via Open, then ×, then the modal is gone, the sequence is still open, and focus is back on the Open pencil;
    - **the Back-freeze regression in both directions:** open an item, close or Back, then create another item without reloading, with no thrown error and the modal open on the new item; plus sequence → item → sequence → item;
    - a deep link, then × replaces the address with the sequence address;
    - in-page open, then × calls `history.back()`;
    - Escape;
    - the dirty prompt on × / Escape / Back / the course link, with cancel keeping the drafts;
    - a stale item address gives the toast and replace;
    - delete: one confirm, navigate-replace, reload, no "Item not found.";
    - Save and Discard for page and video;
    - ⌘S;
    - `videoUrlEmpty` blocks;
    - read-only published / archived / disabled, where disabled makes no render call;
    - `refreshKey` increments after a save.
  - `deriveExpansion` and `handleStaleIdFallback` get item-level cases; `router.test.ts:54` is updated.
- **T4 Video/App:**
  - the preview debounce;
  - the provider meta;
  - the invalid-URL footer;
  - the 296px frame;
  - the App tests ported;
  - Remove confirms;
  - the title saves via the footer;
  - disabled: no asset fetch;
  - no write after unmount.
- **T5 quiz save model:**
  - one Save sends title → questions → options in the §5.3 order (single choice: true before false);
  - validation blocks with inline errors;
  - a partial failure stops, keeps the later parts dirty, and advances the earlier baselines;
  - the published confirm appears once, and Cancel sends nothing;
  - structure operations while drafts exist (D3 / §5.4);
  - `discard()` resets all;
  - the page guard sees quiz drafts.
- **T6 quiz look:** the 3f structure and classes, the type names, the D15/D16 reasons, and no emoji.
- **Gate:** sections (aa)-(af), one per task, plus a `.notice` target update. Every new check is mutation-tested.
- **Final:** the full suite, `npm run check` (0 errors; warnings must not grow), the gate, a whole-branch review, and the browser pass (Safari, step by step, with the user).

## Task decomposition (7 tasks; carried into the implementation plan)

| Task | Deliverable | Notes |
|---|---|---|
| **T1** | `ui/Modal.svelte` + tests + gate (aa) | Generic; no item knowledge |
| **T2** | `MarkdownEditor` + `AssetSidebar` restyle (3c) + the `plain` mode (D6) + gate (ab) | Also restyles MiniProjectModal's use (D21) |
| **T3** | Routing + `VersionEditPage` host + `ItemEditorModal` (header, Title, footer, protocol, delete, close, focus, stale item) + `PageBody` + `VideoBody` (logic; card styling minimal) + delete `ItemEditPage` and its tests + the D22 contract + Back-freeze tests + gate (ac) | The largest task; it can be split in the plan as T3a (host + modal + page) / T3b (video) if the plan finds it too big |
| **T4** | Video preview card (3e) + `AppBody` (D4, D14) + the `VideoFrame` / `InteractiveFrame` `height` props + gate (ad) + the `.notice` target | |
| **T5** | Quiz save model (§5.1-5.4) wired to the modal footer | Logic only; the look waits for T6 |
| **T6** | Quiz look (§5.5) + `QuestionTypePicker` + gate (ae) | |
| **T7** | Clean-up: stale comment references, close the backlog carry-overs, the final gate count (af: an emoji scan over every 5b file) | |

## Review Focus (for the plan)
1. Close semantics on a deep link vs. in-page (D7): × must never leave the app.
2. One Save across N independent PATCHes (D10, §5.3): order, partial failure, baselines.
3. Structure operations with live drafts in the quiz (§5.4): no lost or misattributed drafts after reorder, delete or refetch.
4. Disabled version: zero `/render` and asset requests anywhere in the modal (D6).
5. Focus: open → first field, close → opener, deep-link close → sequence header (D18), with no racing scroll.

## Git stacking
Same local branch as 5a. One commit per task after its two-lane review is clean; no push and no merge.
