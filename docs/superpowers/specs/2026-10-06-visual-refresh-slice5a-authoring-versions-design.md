# Visual Refresh — Slice 5a: Authoring — Versions + Version Editor (3a + 3b) — Design Spec

**Status:** Design — rev 1, awaiting review rounds. Next: spec review loop → Fable second opinion → user review → writing-plans.

**Authority:** `docs/design/visual-refresh/reference-screens.dc.html` (line refs below are into that file: artboard **3a** is `:1452-1503`, artboard **3b** is `:1505-1647`, the 9d "empty — nothing exists yet" variant is `:1353-1360`) and `docs/design/visual-refresh/mathion-visual-spec.md` (§3 colour of state `:110-133`; §4 Icon button `:168-181`, Inline field editing `:183-196`, Disabled rows `:198-205`, Collapsed forms `:207-210`, Accordions `:263-271`; §5 items 1-5 `:314-321`). Where the two disagree, the spec's *rules* win over the artboard's *pixels* and the deviation is recorded in §Decisions.

**What this slice restyles.** Two reference screens — the authoring list and the version editor:

| ref | screen | source today |
|---|---|---|
| 3a | Versions | `frontend/src/pages/editor/VersionsPage.svelte` |
| 3b | Version editor | `frontend/src/pages/editor/VersionEditPage.svelte` + `components/editor/{VersionMetaForm, AccordionHeader, BlockAccordion, SequenceAccordion, ItemRow, ItemTypePicker}.svelte` |

**Slice 5 split (user ruling 2026-10-06, option A).** The original Slice 5 (3a/3b/3c/3e/3f/10m) is split: **5a = this spec** (3a + 3b); **5b** = the item-editor modal (3c/3e/3f) plus a shared modal shell; **10m (`runs/MiniProjectModal.svelte`) moves to Slice 6** (Teacher) beside 10j/10k/10l, which reuse the 5b shell. Each sub-slice has its own spec → plan → SDD → browser pass.

Branch `feat/visual-refresh-slice5-authoring` off the Slice-4 tip `6fff756`. **LOCAL — not pushed, not merged**; the whole redesign lands as one stack when every slice is done. 5b branches off 5a's tip.

---

## Global Constraints

Inherited from the Slice-3/4 specs (`2026-09-01-…-slice3-…-design.md` and `2026-09-06-…-slice4-…-design.md` §Global Constraints). Restated with only what changes for this slice:

1. **Colours → tokens.** No hardcoded hex outside comments; **no new colour tokens**. Every reference hex in 3a/3b resolves to an existing token in `frontend/src/styles/theme-default.css` (mapping table below). This slice **deletes every pre-existing hex literal** in the files it touches (`VersionsPage.svelte` `.badge.*` `:233-236`, `VersionEditPage.svelte` `.state-*`/`.banner` `:384-390`, `AccordionHeader.svelte` `#f5f5f5` fallback `:94`). Forced-colors system colours inside `@media (forced-colors: active)` are exempt (Slice-3 exemption).
2. **No opacity-based disabled/dim.** Disabled rows recede via tokens only (see D4). `ItemTypePicker`'s visually-hidden radio (`opacity: 0` + `position:absolute` + `pointer-events:none`) is the sr-only idiom for a still-focusable control, not a dim treatment — keep and annotate it.
3. **No emoji, no decorative glyphs.** Every emoji in the touched files is removed (`ItemRow` `:42-48`, `ItemTypePicker` `:19-37`). New SVGs follow the repo convention: `aria-hidden="true"`, `viewBox="0 0 16 16"`, `stroke="currentColor"`, `stroke-width` 1.6, round caps/joins.
4. **Mono for every numeral** via the global `.mono` class: version numbers (`v7`), the versions count, B/S code badges, slugs, the max-attempts value, the `N questions` count.
5. **Per-component literals — three forms** ((a) `/* ref NNNN */`, (b) no-ref with the scale named, (c) mechanism). Geometry only, never colour.
6. **Dense control metrics are final.** `ui/Button.svelte` is used as-is (artboard secondary/ghost `4px 9px` vs Button's `--btn-pad` is a Slice-1 decision). Fields use `--control-h` (30px).
7. **`ItemMark` is used as-is** (the `not-yet` state is the 3b item-row tile, ref 1589). `ItemIcon` is not used here (it is a clickable button; item rows need a non-interactive mark).
8. **No backend/API/schema change.** Verified: `VersionUpdate`, `BlockUpdate`, `SequenceUpdate` (`backend/mathion/schemas.py:63,171,177`) all accept single-field partial PATCHes, which per-field commits rely on. **No route change** (`routes.ts` untouched; the item route stays until 5b).
9. **Commit trailer (user decision 2026-10-06, replaces the Slice-4 pin):** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` — **no `Claude-Session` line.** `git add` exact named paths only, never `-A`/`.`.
10. **Process.** Per task: implement → first-party Opus review + second lane (codex@high when available) on the **UNCOMMITTED** diff → fix every Critical/Important → re-review until both lanes are clean → commit. Gate `frontend/scripts/visual-refresh-gate.sh` stays ALL PASS with `EXPECTED_CHECKS` = printed count. Polish/taste findings → one file each in `docs/backlog/`, not fixed mid-slice. User browser pass + explicit OK closes the slice.

### Reference hex → token mapping (3a/3b)

| ref hex | where | token |
|---|---|---|
| `#16181D` | titles, values, `v7` | `--text` |
| `#5A616E` | labels, slugs, counts, label text, chevrons, ✕ glyph | `--muted` |
| `#3D4350` | icon-button glyph (ref 1473, 1486…) | see D7 (IconButton keeps `--muted`) |
| `#3F5C77` | course link, filled `+`/✓ background, badge text | `--primary` |
| `#EAEFF4` | code-badge fill, field focus ring | `--primary-soft` |
| `#E3E5EA` | card/section borders | `--border` |
| `#DDE1E9` | icon-button border | `--border-strong` |
| `#F0F1F4` | row hairlines inside a card | `--border-soft` |
| `#E9EBEF` | accordion header-strip bottom edge | `--border` (role split, Slice-3 note: card/strip **edge** → `--border`) |
| `#F5F6F9` | block header strip | `--surface-2` |
| `#FBFBFC` / `#B4B9C4` / `#EDEFF2` | disabled icon button bg / glyph / border | `--bg` / `--faint` / `--border-faint` (IconButton's existing `:disabled`) |
| `#fff` | cards, sequence header | `--surface` |
| `#F0F1F4`/`#3D4350`, `#D1FAE5`/`#065F46`, `#F0F1F4`/`#5A616E` | created / published / archived+disabled badges | `--state-{created,published,archived,disabled}-{bg,fg}` |
| `#991B1B` | Delete text in the state bar | `--danger` |
| `#8B919E` | empty-state icon glyph (ref 1356) | `--muted` (Slice-4 pre-ruling: no token has this hex; `--faint` is disabled-only) |

### Decisions (locked in brainstorming 2026-10-06)

- **D1 — Scope split.** As above (5a = 3a+3b; 5b = 3c/3e/3f + modal shell; 10m → Slice 6).
- **D2 — Inline editing everywhere in the version editor.** Not just Version info (§5.5): **block title + info** and **sequence title** also become inline fields. The version editor has no panel-level Save/Discard anywhere after this slice.
- **D3 — Unsaved inline drafts.** An inline field that is open **and** whose draft differs from its saved value counts as unsaved: route changes (including accordion expand/collapse, which are route changes) and tab close prompt via the existing `DirtyGuard` ("Discard unsaved changes and continue?"). In-page actions (reorder, `+ New …`, state transitions) are **not** blocked; an open field keeps its draft. Exception: if the field becomes read-only (e.g. Publish while Label is open), it closes and drops its draft.
- **D4 — Read-only states show text.** All inline fields always render (value as text). When the version state forbids editing, the pencil renders **disabled** with the reason in `title` (§4 "keep the slot count fixed"). Today the Version-info panel is hidden for non-created versions and block/sequence fields are hidden for archived/disabled — both change.
- **D5 — Disabled-row treatment = reference, not `--dimmed`.** A disabled version's number drops `--text` → `--muted` (ref 1495) and its badges use `--state-*` tokens; no `--dimmed` token is added. This resolves `TODO(version-slice)` at `theme-default.css:109` (the comment is deleted in T2).
- **D6 — Artboard annotations are not built.** The 3a caption (ref 1501) and the 3b state-bar sentence (ref 1640) are designer annotations, not product copy.
- **D7 — IconButton glyph colour stays `--muted`.** The artboard paints icon-button glyphs `#3D4350` (`--text-3`); Slice 1 pinned `--muted` in `IconButton`. Not re-litigated here (would touch every future consumer); noted for the polish slice if the browser pass flags it.
- **D8 — `confirm()` stays** for publish/archive/revert/disable/enable/delete. §5 does not change these flows; the in-place confirm pattern (§4 Confirm-then-act) is for deletes with dependents (10i/10j).
- **D9 — Approach: one shared primitive** `ui/InlineField.svelte` (not per-panel state, not restyle-in-place). Slice 6's 10a inline-edit reuses it.

---

## Enumerated changes (the non-pure-CSS touches)

1. **VersionsPage `<h1>`** drops "Edit ·" (§5.1); the text back button becomes a 28px round IconButton `back` ("Back to courses").
2. **Create-version form starts collapsed** behind a filled `+` IconButton that toggles to `×` (§5.3). Fields unchanged.
3. **Version rows: four fixed icon slots** (§5.4) — Open · Duplicate · Disable/Enable · Delete — forbidden ones render disabled with a reason.
4. **VersionEditPage heading** leads with the label (§5.2); course name is a link back to the version list replacing the `← Versions` button; label-less fallback defined (§3.1).
5. **Version info, block title/info, sequence title → per-field inline editing** (§5.5, D2). Removes `makeDirtyTracker` + Save/Discard from `VersionMetaForm`, `BlockAccordion`, `SequenceAccordion`; removes dirty-gating of reorder / `+ New block|sequence|item` / state transitions / delete-version.
6. **Version info and Blocks panels foldable** (chevron beside the heading; component-local, default open, not persisted).
7. **Create-block / create-sequence / create-item forms start collapsed** behind filled `+` IconButtons (block: in the Blocks card heading; sequence: in the block header; item: beside the `Items` heading).
8. **Reorder arrows always render** (block, sequence, item) — disabled at the boundary ("Move up — already first" / "Move down — already last") or when structure is forbidden; today they are hidden in both cases.
9. **Item rows: ItemMark replaces emoji**; four fixed slots ↑ ↓ open delete; `ItemTypePicker` emoji → ItemMark glyphs.
10. **Delete block / delete sequence move to a body footer** (28px trash + text), disabled with "remove its sequences/items first" when non-empty.
11. **Loading / error / empty states** on both pages adopt `ui/Skeleton|ErrorState|EmptyState` (9d).
12. **`EmptyState` gains optional icon tile, hint, action** (deferred from Slice-4 D2; first consumer "No versions yet").
13. **`IconButton` gains** glyph `back`, prop `round` (50% radius), prop `primary` (filled `--primary`, `--primary-text` glyph, no border).
14. **New `editor/VersionBadges.svelte`** (state + disabled badges) used by 3a rows and the 3b heading.

---

## Scope

### In scope
- New: `components/ui/InlineField.svelte`, `components/editor/VersionBadges.svelte`, `lib/editorReasons.ts`.
- Extended: `components/ui/IconButton.svelte`, `components/ui/EmptyState.svelte`.
- Restyled/restructured: `pages/editor/VersionsPage.svelte`, `pages/editor/VersionEditPage.svelte`, `components/editor/{VersionMetaForm, AccordionHeader, BlockAccordion, SequenceAccordion, ItemRow, ItemTypePicker}.svelte`.
- `styles/theme-default.css`: delete the `TODO(version-slice)` comment only (no token change).
- Tests + gate sections for all of the above.

### Out of scope / deferred
- `pages/editor/ItemEditPage.svelte` and everything it renders (`QuizEditor`, `QuestionAccordion`, `QuestionTypePicker`, `OptionRow`, `MarkdownEditor`, `AssetSidebar`, `InteractiveAppEditor`, `VideoFrame`) → **5b**. In 5a an item row's Open still navigates to today's (unstyled) item route.
- `components/runs/MiniProjectModal.svelte` (10m) → **Slice 6**.
- `lib/dirtyRegistry.svelte.ts`, `lib/dirty.svelte.ts`, `components/editor/DirtyGuard.svelte`, `lib/versionPermissions.ts`, the router, `stores/currentEditorVersion.svelte.ts` — **unchanged** (consumed, not modified).
- Backlogged Slice-4 items (global focus ring, 404 page) — polish slice.

---

## Per-surface design

### 1. `ui/InlineField.svelte` — T1

**Purpose.** One row that reads as text until opened; each field commits on its own (§4 Inline field editing).

**Props.**

| prop | type | notes |
|---|---|---|
| `label` | `string` | visible label + the input's accessible name |
| `value` | `string \| number` | saved value (from the tree) |
| `kind` | `'text' \| 'textarea' \| 'number'` | default `'text'` |
| `editTitle` | `string` | pencil tooltip + aria-label, e.g. "Edit the label" |
| `disabledReason` | `string \| null` | `null` = editable; else pencil disabled with this `title` |
| `validate` | `(draft) => string \| null` | optional; message blocks commit and shows inline |
| `required` | `boolean` | empty/whitespace-only draft → "{label} is required" |
| `maxlength` | `number` | text/textarea only |
| `min`, `max`, `step` | `number` | number only |
| `onCommit` | `(draft) => Promise<void>` | panel's PATCH + tree refresh; **throws** to signal failure (error message = thrown `ApiError.displayMessage` or "Save failed") |

**Layout** (`/* ref 1537-1551, 1579-1582 */`). `display:grid; grid-template-columns: 132px 1fr 54px; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--border-soft)`; last row in its group has no bottom border (parent-scoped `:last-child`). Label 12.5px `--muted`; value 13px `--text`, `line-height:1.55`, `white-space:pre-wrap`, `overflow-wrap:anywhere`; `number` values wrap in `.mono`. Empty value renders `Not set` in `--muted` (13px). Action slot `display:flex; justify-content:flex-end; gap:6px` — the 54px column is **fixed in both states** (ref 1579-1582 closed precedent), so opening never shifts the value column and **✓ lands exactly where the pencil was** (§4). Closed: one `IconButton sm pencil`. Open: `IconButton sm close` ("Cancel") then `IconButton sm primary` glyph `check` ("Save"). Textarea/text alignment: the open row switches to `align-items:start` and the label takes `padding-top: 9px` (ref 1543); closed rows `align-items: baseline` with the slot `align-self:center` (ref 1537, 1540).

**Open editor styling** (ref 1544): `border: 1.5px solid var(--primary); border-radius: var(--radius); box-shadow: 0 0 0 3px var(--primary-soft); background: var(--surface); font-size:13px; padding: 8px 10px` for textarea (mono, `line-height:1.6`), `height: var(--control-h); padding: 0 10px` for text/number (number in `.mono`). Textarea `rows` = 3, `resize: vertical`.

**Behaviour.**
- **Open:** pencil click → `open = true`, `draft = String(value)`, focus moves into the editor (`tick()` then `.focus()`; caret at end).
- **Cancel:** ✕ or Escape (keydown on the editor) → close, discard draft, focus the pencil.
- **Commit:** ✓, Enter in `text`/`number`, Cmd/Ctrl+Enter in `textarea` → trim-check `required` → `validate` → if the draft equals the saved value (string compare after normalisation: `number` compares numerically) close without calling `onCommit`; else `busy = true`, await `onCommit(draft)` → success: close, focus pencil; failure: stay open, keep draft, show the message inline below the editor (`<p class="err" role="alert" id=…>`, editor `aria-describedby` + `aria-invalid="true"`), `busy=false`. Editing the draft clears the error. While `busy`: editor `readonly`, ✕ and ✓ disabled, ✓ `aria-busy="true"`.
- **Number parsing:** `number` draft is the input's string; commit parses `Number(draft)`; `validate` receives the parsed number for `number` kind (non-finite → "Enter a number").
- **Unsaved registration (D3):** `getContext(DIRTY_REGISTRY_KEY)` — **optional** (no throw when absent). When present, an `$effect` registers a `RegisteredTracker` whose `isDirty` getter is `open && draft !== String(value)` while `open`; unregisters on close/unmount.
- **Read-only flip:** an `$effect` closes the field (draft dropped, no prompt) when `disabledReason` becomes non-null while open.
- **Server refresh:** while closed the display follows `value`; while open the draft is never overwritten (the dirty comparison uses the live `value`).
- **No success toast** — closing with the new value is the confirmation. Panels keep the existing "Saved (refresh failed — reload to see latest)" info toast for the PATCH-ok/refresh-failed case.
- **A11y:** the editor's accessible name is `label` (`<label for>` on the label cell); the pencil's `aria-label` = `editTitle`; ✕ = "Cancel editing {label}", ✓ = "Save {label}".

**IconButton additions (T1).**
- Glyph `back` — `<line x1="12.4" y1="8" x2="3.6" y2="8"/><polyline points="7.2,4.4 3.6,8 7.2,11.6"/>` (ref 1473).
- Glyph `check` — `<polyline points="3.4,8.4 6.6,11.6 12.6,4.8" stroke-width="1.9"/>` (ref 1546; the per-element 1.9 stroke matches §4's "1.9 for the check" and overrides the svg-level 1.6).
- Prop `round: boolean` → `border-radius: 50%` (ref 1473).
- Prop `primary: boolean` → `background: var(--primary); color: var(--primary-text); border-color: var(--primary)` (ref 1479, 1546 ✓, 1560, 1586). `:disabled` keeps winning (existing specificity note).

**`EmptyState` additions (T1).** Optional `icon: 'list' | null` (38px tile, `border-radius: 8px`, `background: var(--surface-2)`, `1px solid var(--border)` edge, `--muted` 18px glyph — ref 1356; the glyph is the three-lines "page" mark from ref 1356), optional `hint: string` (13px, `line-height:1.5`, `--muted`, `max-width: 44ch` — ref 1358), optional `action` snippet (`margin-top: 4px` wrapper — ref 1359). Title-only callers are unchanged.

**`editor/VersionBadges.svelte` (T1).** Props `state`, `isDisabled`. Renders `<span class="badge">{state}</span>` + `<span class="badge disabled">disabled</span>` when disabled; `font-size:11px; font-weight:500; padding:3px 8px; border-radius:3px /* ref 1485 */; white-space:nowrap`, colours from `--state-{state}-{bg,fg}` / `--state-disabled-{bg,fg}`; wrapper `display:inline-flex; gap:6px`.

### 2. Versions page (3a) — T2

- **Frame** `/* ref 1471 */`: page padding stays the app's `.page` frame; heading row `display:flex; align-items:center; gap:10px; margin-bottom:16px` with `IconButton md round back` ("Back to courses", navigates `/courses`) + `<h1>` 21px/600 `letter-spacing:-.015em` = course name only.
- **Versions header** (ref 1476-1480): `<h2>` 15px/600 + `<span class="mono count">{versions.length}</span>` 11.5px `--muted` + right-aligned `IconButton md primary plus` ("New version") — while the form is open the glyph is `close` and title "Cancel new version". Disabled while `busy`.
- **Create form** (collapsed by default): a `--surface` card (`1px solid var(--border)`, `--radius`, padding 14px) above the list holding Label (optional), Info (markdown) textarea, Max quiz attempts (number, 1-10), and a primary `Button` "Create". Behaviour unchanged (`createVersion` validation + navigate). Closing via × resets the three fields.
- **List card** (ref 1481): `1px solid var(--border)`, `--radius`, `--surface`, `overflow:hidden`. Row (ref 1482): `display:flex; align-items:center; gap:10px; padding:9px 12px 9px 14px; border-bottom:1px solid var(--border-soft)` (none on last). Children: `<span class="mono vnum">v{id}</span>` 13px `--text` (`--muted` when disabled — D5); label 13px `--muted` (omitted when empty); `VersionBadges` pushed right (`margin-left:auto`); slot group `display:flex; gap:6px; margin-left:22px` (ref 1486).
- **Slots** (four, always rendered, `IconButton sm`):

| slot | glyph | enabled when | title when disabled |
|---|---|---|---|
| Open | `pencil` | always | — |
| Duplicate | `duplicate` | `!is_disabled` | "Duplicate — enable the version first" (ref 1498) |
| Disable / Enable | `disable` / `enable` | always (toggles by `is_disabled`) | — |
| Delete | `trash` `danger` | `state==='created' && !is_disabled` | `is_disabled` → "Delete — enable the version first"; else "Delete — only for a created version" (ref 1492) |

  Every slot is also disabled while `busy` (title unchanged). Enabled titles: "Open", "Duplicate", "Disable", "Enable", "Delete" (ref 1486). Accessible names add the version: `aria-label="Open v7"` etc.
- **Duplicate row**: unchanged behaviour (single open row, label prefill, close on transition), restyled as an inset row under its version: `padding: 9px 12px 9px 14px; background: var(--surface-2); border-bottom:1px solid var(--border-soft)`, label "New draft label" + input + primary `Button` "Create copy" + ghost "Cancel".
- **States:** loading → `Skeleton` (3 rows in the list card shape); error → `ErrorState variant="page"` title "Couldn't load", message, action `Button` "Back to courses"; empty → `EmptyState icon="list" title="No versions yet" hint="A version holds the blocks, sequences and items students see. Create one to start authoring."` with action primary `Button` "+ New version" that opens the create form (ref 1353-1360). The Versions header (with its `+`) still renders above the empty state.

### 3. Version editor shell + Version info (3b) — T3

- **Heading** (ref 1525-1528): row `display:flex; align-items:center; gap:10px; margin-bottom:18px`. `<h1>` 20px/600 `letter-spacing:-.015em`: `<a href="/courses/{slug}/edit" title="Back to versions">{course.name}</a>` (`--primary`, no underline; underline on hover; `onclick` → `e.preventDefault(); navigate(href)` — the `SequencePlayer.svelte:160-161` breadcrumb idiom; the router has no global anchor interception) then, **when `v.label` is non-empty**, ` · {label}` in `--text`. Then `<span class="mono">v{id}</span>` 12px `--muted`, then `VersionBadges`. **No label:** the `<h1>` is the course link only; `v{id}` + badges follow unchanged.
- **Banners:** disabled version → info banner `background: var(--surface-2); border-left: 3px solid var(--primary); padding: 8px 12px; font-size: 13px` "This version is disabled — editing is not allowed. Enable it first." (§4 Precondition banners, information form). Tree refresh error with a tree already shown → `ErrorState variant="inline" title="Couldn't refresh this version" message={loadError} onretry={() => loadAdminTree(vid, {force:true})}`.
- **Version info card** (ref 1531-1553): `--surface` card, `1px solid var(--border)`, `--radius`, `padding:16px 18px; margin-bottom:18px`. Heading row `display:flex; align-items:center; gap:8px; margin-bottom:4px`: `<h2>` 14px/600 + `IconButton sm borderless chevron` (title "Collapse"/"Expand", `aria-expanded`, `aria-controls` = body id; glyph rotated `-90deg` when collapsed). Body: three `InlineField`s:
  - Label — `kind="text" maxlength=200 editTitle="Edit the label"`; commit PATCHes `{label}`.
  - Info (markdown) — `kind="textarea" editTitle="Edit the info"`; commit PATCHes `{info_md}`.
  - Max quiz attempts — `kind="number" min=1 max=10 step=1 editTitle="Edit the attempt limit"`, `validate`: whole number 1-10 → else "Max quiz attempts must be a whole number between 1 and 10"; commit PATCHes `{max_quiz_attempts}`.
  - `disabledReason`: `v.is_disabled` → "Enable the version first"; else `!perms.canEditVersionMeta` → "Only a created version can change its info"; else `null` (a third helper `metaReason(v)` in `lib/editorReasons.ts`).
  - Each `onCommit`: pin `savedVid`; `api.patch('/api/versions/{savedVid}', {field})`; then `loadAdminTree(savedVid, {force:true})` → `'error'` → info toast "Saved (refresh failed — reload to see latest)"; PATCH failure → rethrow (InlineField shows it). `VersionMetaForm` keeps its file and name, loses `makeDirtyTracker`, the registry registration, `save()`/`discard()`, and the `parentBusy` prop (the fields' own `busy` covers in-flight commits; page `busy` maps to nothing — commits are independent).
- **Blocks card** (ref 1556-1560): same card chrome (no `margin-bottom`), heading `<h2>` "Blocks" + borderless chevron (fold) + right-aligned `IconButton md primary plus` "New block" (→ `close` "Cancel new block" while open). Create form collapsed: one `Input` "Title" + primary `Button` "Create", errors as today (`mapCreateError`). The `+` is disabled with the structure reason (§4 below) when `!perms.canEditStructure`, and while `busy || createBusy`. **No dirty gating.** The create form's `createTracker` registration stays (a typed title is an unsaved draft — D3).
- **Empty blocks:** `EmptyState` title "No blocks yet" (created) / "This version has no blocks." (otherwise) — title-only.
- **State-action bar** (ref 1639-1644): `display:flex; align-items:center; gap:10px; justify-content:flex-end; margin-top:20px; padding-top:14px; border-top:1px solid var(--border)`. Buttons, only those permitted (unchanged `perms` logic): Publish `primary`, Archive `secondary`, Revert `secondary`, Disable `ghost`, Enable `ghost`, Delete `ghost` with `.danger-text { color: var(--danger) }`. All disabled while `busy`. **No dirty gating:** the `if (dirtyRegistry.isAnyDirty()) return;` early-returns in `transition()` and `deleteVersion()` are removed.
- **Delete version with an unsaved draft (D3):** `deleteVersion` confirm text becomes `Delete version v{id}? This cannot be undone.` plus, when `dirtyRegistry.isAnyDirty()`, ` Unsaved field edits will be lost.`; after a successful DELETE it navigates with `{ force: true }` (router `force` bypasses guards, `lib/router.svelte.ts:97-112`) so the user is not prompted twice.
- **Page loading/error:** initial load → `Skeleton` (heading line + two card blocks); load error without a tree → `ErrorState variant="page" title="Couldn't load"` + action "Back to versions"; bad id / not found keep their headings, restyled through `ErrorState variant="page"`.

### 4. Accordions (3b) — T4

**Structure reason** — new pure module `frontend/src/lib/editorReasons.ts` exporting `structureReason(v)` and `textReason(v)` (input `{ state, is_disabled }`, unit-tested in T3 where it is first consumed; T4/T5 import it): `is_disabled` → "Enable the version first"; `!canEditStructure` → "Only a created version can change its structure"; else `null`. **Text reason** (`textReason`): `is_disabled` → "Enable the version first"; `!canEditTextFields` → "Archived versions are read-only"; else `null`.

**`AccordionHeader`** (ref 1564-1568 block, 1572-1576 sequence):
- Props change: drop `dirty`; add `badge` (`'B1'`/`'S1'`), `structureReason: string | null`, `extra` snippet (block's `+`), keep `canReorderUp/Down` **semantics changed to "not at the boundary"** (always rendered; see below).
- Row `display:flex; align-items:center; gap:10px`; block: `padding:9px 12px; background:var(--surface-2)`, title 14px/600; sequence: `padding:8px 12px; background:var(--surface)`, title 13px/600. `border-bottom:1px solid var(--border)` **only when expanded** (ref 1564 expanded B1 vs 1630 collapsed B2).
- Toggle button (keeps `id={headerId}`, `aria-expanded`, `aria-controls`, `aria-label`) wraps badge + title + slug: badge `<span class="mono badge">` 11px/500 `--primary` on `--primary-soft`, `padding:2px 6px; border-radius:3px` (ref 1565 — Slice-3 badge treatment); title `--text`; slug `<span class="mono slug">/{slug}</span>` 12px `--muted`. Toggle `flex:1 1 auto; min-width:0; text-align:left; background:transparent; border:0`.
- Right group `display:flex; align-items:center; gap:6px`: `IconButton sm up`, `IconButton sm down`, `{@render extra?.()}`, then `IconButton sm borderless chevron` (`tabindex="-1"`, `aria-hidden="true"` — a mouse duplicate of the toggle; title "Collapse"/"Expand"; rotated `-90deg` when collapsed).
- Arrow state: disabled when `busy`, or `structureReason` (title = reason), or at the boundary (title "Move up — already first" / "Move down — already last"); else title "Move up"/"Move down". Accessible names keep today's `Move {level} up: {name}`.

**`BlockAccordion`**:
- Header: `badge="B{index}"`, `extra` = `IconButton sm plus` "New sequence" (disabled with `structureReason` / busy). Clicking it on a **collapsed** block sets `creating = true` and navigates to expand (`/edit/v/{vid}/blocks/{id}`); on an expanded block it toggles the form.
- Card: `1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; margin-bottom:10px` (ref 1563).
- Body (`padding:12px 14px; display:flex; flex-direction:column; gap:10px` — ref 1570): InlineFields "Block title" (`text`, `required`, maxlength 200, "Edit the block title") and "Info (markdown)" (`textarea`, "Edit the block info"); `disabledReason = textReason`; commits PATCH `/api/blocks/{id}` with the single field + forced refresh (pin `savedVid`/`savedBid`, `stillOnVid` guard as today). Then the create-sequence form (when open), the sequence list (or `No sequences yet.` muted 13px), then the **delete footer**.
- **Delete footer** (ref 1609-1610 pattern): `margin-top:14px; padding-top:12px; border-top:1px solid var(--border-soft); display:flex; align-items:center; gap:8px`: `IconButton md trash danger` + a 12.5px `--muted` text span that **mirrors the button's title** (ref 1610 shows the reason as visible text): enabled → "Delete this block"; sequences > 0 → "Delete this block — remove its sequences first"; structure forbidden → "Delete this block — " + lower-cased `structureReason`. Disabled also while busy (text unchanged). The button's accessible name is "Delete block {name}". Behaviour = today's `deleteBlock()` minus the `tracker.isDirty` guard.
- Removed: `makeDirtyTracker` for title/info, `save()`, `discard()`, the expanded-only registry registration, dirty gating on reorder/create/delete. Kept: `createTracker` registration, `stillOnVid`, all API/reload logic.

**`SequenceAccordion`**:
- Header: `badge="S{index}"`, no `extra`.
- Card (ref 1571): `1px solid var(--border); border-radius: var(--radius); overflow:hidden`; collapsed sequences render as header-only cards.
- Body (ref 1578: `padding:12px 14px; border-top:1px solid var(--border-soft)`): InlineField "Sequence title" (`text`, `required`, maxlength 200, "Edit the sequence title", `disabledReason = textReason`); "Items" row (ref 1584-1587: `<h4>` 13px/600 + `IconButton md primary plus` "New item", → `close` "Cancel new item" while open, disabled with `structureReason`/busy); create-item form (collapsed; `ItemTypePicker` + Title `Input` + primary "Create"); item rows; delete footer as BlockAccordion's: "Delete this sequence" / "Delete this sequence — remove its items first" (ref 1610) / structure reason.
- Removed/kept: as BlockAccordion.

### 5. Item rows + type picker (3b) — T5

**`ItemRow`** (ref 1588-1606): `display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border-soft)` (none on last — parent `:last-child`). Children: `<ItemMark type={item.type} state="not-yet" />` (22px tile, the `title` tooltip of the type is not added — the slot is decorative, `aria-hidden` comes from ItemMark); title 13px/600 `--text`; slug `.mono` 12px `--muted`; quiz: `<span class="sep" aria-hidden="true">·</span>` (`--faint`, ref 1606 — a separator is a sanctioned `--faint` use) + `<span class="mono q-count">{n} question(s)</span>` 12px `--muted`. Right group `margin-left:auto; display:flex; gap:6px`: ↑ ↓ (rules as AccordionHeader), `IconButton sm pencil` "Open" (`aria-label="Open {name}"`, enabled unless busy), `IconButton sm trash danger` "Delete" (disabled with `structureReason`/busy). Props: drop `parentDirty` and `canStructure`; add `structureReason`; `canReorderUp/Down` = "not at boundary".

**`ItemTypePicker`**: fieldset of four radio cards; each card shows `<ItemMark type=… state="not-yet" />` + label (Page / Video / Quiz / Interactive app) 13px. Card `padding:8px 10px; border:1px solid var(--border-strong); border-radius: var(--radius); min-width: 96px`; selected `border-color: var(--primary); background: var(--primary-soft)`; `:focus-within` → `box-shadow: inset 0 0 0 2px var(--primary)` + the forced-colors outline companion (Slice-3 idiom). Radios stay sr-only (Constraint 2).

---

## Data flow & error handling

- **No change to data flow.** `currentEditorVersion` / `loadAdminTree` / `versionsPageLoader` are the only sources; every mutation keeps its pin-at-start + `stillOnVid` + forced-refresh discipline.
- **Inline commit errors** surface inline (D9 primitive) — never a toast. **Create errors** keep `mapCreateError` (field-level inline + toast only when no field error). **Reorder / delete / transitions** keep toast + forced refresh (a 403 from a mid-action state change re-syncs `perms`).
- **Concurrent draft + structure change:** an open field inside a block that is reordered stays mounted (keyed `{#each … (block.id)}`) and keeps its draft. An open field inside a block/sequence that is **collapsed by navigation** is behind the D3 guard prompt; confirming discards it.

## Testing strategy

Pattern: `mount`/`unmount`/`flushSync` from `svelte`, no `@testing-library/svelte`.

- **New `InlineField.svelte.test.ts`:** closed render (label, value, `Not set`, mono number); open → editor focused with value; ✕ and Escape cancel + focus pencil; ✓ / Enter / Cmd+Enter commit; unchanged draft closes without `onCommit`; `required` + `validate` block commit with inline message; rejected `onCommit` keeps draft + shows message + `aria-invalid`; busy disables controls; registry sees dirty only while open and changed (fake registry via context); no registry → no throw; `disabledReason` flip while open closes and drops draft; `value` change while open keeps draft; `value` change while closed updates text.
- **New `VersionEditPage.svelte.test.ts`:** heading with/without label; course link target; fold toggles (`aria-expanded`); disabled banner; state bar per state; transitions not blocked by an open dirty field; delete-version confirm wording with/without dirty + `force` navigation.
- **New `BlockAccordion.svelte.test.ts`:** header badge/slug; arrows always present with boundary/structure titles; `+` on collapsed block expands + opens form; inline title commit PATCHes `{title}` only; delete footer reasons.
- **Rewritten to new markup:** `VersionsPage.duplicate`, `VersionMetaForm.label`, `accordionHeader`, `ItemRow`, `ItemTypePicker`, `SequenceAccordion.interactive`.
- **Extended:** `IconButton` (back/check glyphs, round, primary, disabled-beats-primary), `EmptyState` (icon/hint/action; title-only unchanged).
- **New `VersionsPage.slots.svelte.test.ts`:** four slots per row with the table's enabled/disabled states + titles; disabled version number `--muted` class; collapsed create form toggle; empty/error/loading states.
- **Unchanged:** `dirtyRegistry`, `dirty`, `versionPermissions`, `currentEditorVersion`, `versionsPageLoader`, `router`.
- **Gate:** one section per task in `visual-refresh-gate.sh`, Slice-3/4 conventions (hash-coupled dist greps; a primitive's section lands with its **first consumer's** task because Vite emits no CSS for unimported components — so `InlineField`/`VersionBadges`/IconButton-additions/EmptyState-additions CSS is gated in T2/T3, not T1; selector-agnostic `none` anchors; no-hex / no-opacity / no-emoji sweeps over every touched file; `EXPECTED_CHECKS` = printed count). The plan owns exact grep authoring.

## Task decomposition (5 tasks; carried into the implementation plan)

| task | content | gate |
|---|---|---|
| **T1** | Primitives: `InlineField`, `IconButton` (+`back`,`check`,`round`,`primary`), `EmptyState` (+icon/hint/action), `VersionBadges`; their unit tests | unit only (no consumer yet) |
| **T2** | Versions page (3a): heading, collapsed create, list card + four slots, duplicate row, 9d states; delete `TODO(version-slice)` | 3a section + IconButton round/primary + EmptyState additions + VersionBadges |
| **T3** | `lib/editorReasons.ts` (+ unit test); version editor shell: heading, banners, Version info card (InlineFields), Blocks card + collapsed create-block, state bar, dirty-gate removal, delete-version wording/force | 3b shell section + InlineField |
| **T4** | Accordions: `AccordionHeader`, `BlockAccordion`, `SequenceAccordion` (InlineFields, `+` buttons, fixed arrows, delete footers) | 3b accordion section |
| **T5** | `ItemRow` + `ItemTypePicker` (ItemMark, four slots) | 3b item-row section |

Then whole-branch review (both lanes) → user browser pass → explicit OK closes 5a.

## Git stacking (decided)

`main ← s2 ← s3 ← s4 (6fff756) ← s5a (this) ← s5b`. Nothing merges until all slices are done.
