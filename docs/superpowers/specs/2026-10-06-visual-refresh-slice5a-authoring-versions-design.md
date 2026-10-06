# Visual Refresh — Slice 5a: Authoring — Versions + Version Editor (3a + 3b) — Design Spec

**Status:** Design — **rev 5, CONVERGED** (round 1: four lanes NOT CONVERGED → rev 2; round 2: three CONVERGED, plan-readiness 1 Important → rev 3; round 3: three CONVERGED, behaviour 1 Important → rev 4; **round 4: all four lanes CONVERGED**, one optional a11y Minor folded into rev 5; resolutions for every round listed at the foot). Next: Fable second opinion → user review → writing-plans.

**Authority:** `docs/design/visual-refresh/reference-screens.dc.html` (line refs below are into that file: artboard **3a** is `:1452-1503`, artboard **3b** is `:1505-1647`, the 9d "empty — nothing exists yet" variant is `:1353-1360`) and `docs/design/visual-refresh/mathion-visual-spec.md` (§3 colour of state `:110-133`; §4 Icon button `:168-181`, Inline field editing `:183-196`, Disabled rows `:198-205`, Collapsed forms `:207-210`, Accordions `:263-271`; §5 items 1-5 `:313-322`). Where the two disagree, the spec's *rules* win over the artboard's *pixels* and the deviation is recorded in §Decisions.

**What this slice restyles.** Two reference screens — the authoring list and the version editor:

| ref | screen | source today |
|---|---|---|
| 3a | Versions | `frontend/src/pages/editor/VersionsPage.svelte` |
| 3b | Version editor | `frontend/src/pages/editor/VersionEditPage.svelte` + `components/editor/{VersionMetaForm, AccordionHeader, BlockAccordion, SequenceAccordion, ItemRow, ItemTypePicker}.svelte` |

**Slice 5 split (user ruling 2026-10-06, option A).** The original Slice 5 (3a/3b/3c/3e/3f/10m) is split: **5a = this spec** (3a + 3b); **5b** = the item-editor modal (3c/3e/3f) plus a shared modal shell; **10m (`runs/MiniProjectModal.svelte`) moves to Slice 6** (Teacher) beside 10j/10k/10l, which reuse the 5b shell. Each sub-slice has its own spec → plan → SDD → browser pass.

Branch `feat/visual-refresh-slice5-authoring` off the Slice-4 tip `6fff756`. **LOCAL — not pushed, not merged**; the whole redesign lands as one stack when every slice is done. 5b branches off 5a's tip.

---

## Global Constraints

Inherited from the Slice-3/4 specs (`2026-09-01-…-slice3-…-design.md`, `2026-09-06-…-slice4-…-design.md` §Global Constraints). Restated with only what changes for this slice:

1. **Colours → tokens.** No hardcoded hex outside comments; **no new colour tokens**. Every reference hex in 3a/3b resolves to an existing token in `frontend/src/styles/theme-default.css` (mapping table below). This slice **deletes every pre-existing hex literal** in the files it touches (`VersionsPage.svelte` `.badge.*` `:233-236`; `VersionEditPage.svelte` `.state-*`/`.banner`/`.banner.err` `:386-391`; `AccordionHeader.svelte` `#f5f5f5` fallback `:93`). Forced-colors system colours inside `@media (forced-colors: active)` are exempt (Slice-3 exemption).
2. **No opacity-based disabled/dim.** Disabled rows recede via tokens only (D5). `ItemTypePicker`'s visually-hidden radio (`opacity: 0` + `position:absolute` + `pointer-events:none`) is the sr-only idiom for a still-focusable control, not a dim treatment — keep and annotate it.
3. **No emoji, no decorative glyphs.** Every emoji in the touched files is removed (`ItemRow` `:42-48`, `ItemTypePicker` `:19-37`). New SVGs follow the repo convention: `aria-hidden="true"`, `viewBox="0 0 16 16"`, `stroke="currentColor"`, `stroke-width` 1.6 (1.9 for the check, §4), round caps/joins.
4. **Mono for every numeral** via the global `.mono` class: version numbers (`v7`), the versions count, B/S code badges, slugs, the max-attempts value, the `N questions` count.
5. **Per-component literals — three forms** ((a) `/* ref NNNN */`, (b) no-ref with the scale named, (c) mechanism). Geometry only, never colour.
6. **Dense control metrics are final.** `ui/Button.svelte` is used as-is (artboard secondary/ghost `4px 9px` vs Button's `--btn-pad` is a Slice-1 decision). `ui/Input.svelte` is **not** used (it lacks `disabled`/`required`/`oninput`/`maxlength`/`aria-*`); create-form fields stay raw `<input>`/`<textarea>`, styled locally to `height: var(--control-h)` (inputs) — see §4 "Create forms".
7. **`ItemMark` is used as-is** (the `not-yet` state is the 3b item-row tile, ref 1589). `ItemIcon` is not used here (it is a clickable button; item rows need a non-interactive mark).
8. **No backend/API/schema change.** Verified: `VersionUpdate`, `BlockUpdate`, `SequenceUpdate` (`backend/mathion/schemas.py:63,171,177`) accept single-field partial PATCHes; `update_version` drops only `None`, so `label: ""` clears a label; an empty block/sequence title 422s (`min_length=1`) and is also caught client-side by `required`; published-version block edits are limited to `{title, info}` server-side, matching `textReason`. **No route change** (`routes.ts` untouched; the item route stays until 5b).
9. **Commit trailer (user decision 2026-10-06, replaces the Slice-4 pin):** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` — **no `Claude-Session` line.** `git add` exact named paths only, never `-A`/`.`.
10. **Process.** Per task: implement → first-party Opus review + second lane (codex@high when available; otherwise a second independent reviewer) on the **UNCOMMITTED** diff → fix every Critical/Important → re-review until both lanes are clean → commit. Gate `frontend/scripts/visual-refresh-gate.sh` stays ALL PASS with `EXPECTED_CHECKS` = printed count. Polish/taste findings → one file each in `docs/backlog/`, not fixed mid-slice. User browser pass + explicit OK closes the slice.

### Reference hex → token mapping (3a/3b)

| ref hex | where | token |
|---|---|---|
| `#16181D` | titles, values, `v7` | `--text` |
| `#2A2F3A` | open inline-editor text (ref 1544) | `--text-2` |
| `#5A616E` | labels, slugs, counts, version label text, chevrons, ✕ glyph, disabled `v3` | `--muted` |
| `#3D4350` | icon-button glyph (ref 1473, 1486…) | see D7 (IconButton keeps `--muted`) |
| `#3F5C77` | course link, filled `+`/✓ background, badge text | `--primary` |
| `#EAEFF4` | code-badge fill, field focus ring | `--primary-soft` |
| `#E3E5EA` | card/section borders | `--border` |
| `#DDE1E9` | icon-button border | `--border-strong` |
| `#F0F1F4` | row hairlines inside a card | `--border-soft` |
| `#E9EBEF` | block header-strip bottom edge (ref 1564), empty-state tile edge (ref 1356) | `--border` (Slice-3 role split: card/strip/tile **edge** → `--border`) |
| `#F5F6F9` | block header strip, empty-state icon tile | `--surface-2` |
| `#FBFBFC` / `#B4B9C4` / `#EDEFF2` | disabled icon button bg / glyph / border | `--bg` / `--faint` / `--border-faint` (IconButton's existing `:disabled`) |
| `#B4B9C4` | `·` separator in the quiz item row (ref 1606) | `--faint` (separator — sanctioned use) |
| `#fff` | cards, sequence header | `--surface` |
| `#F0F1F4`/`#3D4350` | created badge (enabled version) | `--state-created-{bg,fg}` |
| `#D1FAE5`/`#065F46` | published badge (enabled version) | `--state-published-{bg,fg}` |
| *(no artboard instance)* | archived badge (enabled version) | `--state-archived-{bg,fg}` (`#E9EBEF`/`#5A616E`, §3 table) |
| `#F0F1F4`/`#5A616E` | **any** lifecycle badge **and** the `disabled` badge on a disabled version (ref 1497) | `--state-disabled-{bg,fg}` (D5) |
| `#991B1B` | Delete text in the state bar | `--danger` (via `Button variant="danger"`) |
| `#8B919E` | empty-state icon glyph (ref 1356) | `--muted` (Slice-4 pre-ruling: no token has this hex; `--faint` is disabled-only) |

### Decisions (locked in brainstorming 2026-10-06 + round-1 review)

- **D1 — Scope split.** 5a = 3a+3b; 5b = 3c/3e/3f + modal shell; 10m → Slice 6.
- **D2 — Inline editing everywhere in the version editor.** Not just Version info (§5.5): **block title + info** and **sequence title** also become inline fields. No panel-level Save/Discard remains in the version editor.
- **D3 — Unsaved drafts.** An inline field that is open **and** whose draft differs from its saved value — and an open create form with typed input — counts as unsaved. Route changes (including accordion expand/collapse, which are route changes) and tab close prompt via `DirtyGuard` ("Discard unsaved changes and continue?"). **Confirming really discards:** `DirtyGuard` gains an optional `onDiscard` callback; `VersionEditPage` passes `() => dirtyRegistry.discardAll()`, which closes every open field and resets every create form, so a confirmed discard never re-prompts on the next navigation. In-page actions (reorder, `+ New …`, fold) are **not** blocked and do not discard (folded bodies stay mounted). **Destructive and state-changing actions warn instead of block:** the `confirm()` text of the actions that can close or unmount a draft — publish, archive, disable (each makes fields read-only), delete-version, delete-block, delete-sequence — gains the suffix ` Unsaved edits may be lost.` when `dirtyRegistry.isAnyDirty()` ("may": drafts outside the affected scope survive). Revert, enable and delete-item never drop a draft and get no suffix. After a successful delete the follow-up navigation uses `{ force: true }` so the user is not prompted twice. **Accepted edge:** `onDiscard` runs when the guard passes; the router's later `navGen` abort can only fire if a newer `navigate()` starts in between, which the blocking `confirm()` prevents — so discard-then-abort is not reachable in practice. A field that becomes read-only (e.g. after Publish) closes and drops its draft; if that draft was dirty an info toast says "Editing closed — this version is no longer editable".
- **D4 — Read-only states show text.** All inline fields always render (value as text). When the version state forbids editing, the pencil renders **disabled** with the reason in `title` (§4 "keep the slot count fixed"). Today the Version-info panel is hidden for non-created versions and block/sequence fields are hidden for archived/disabled — both change. Disabled buttons are not focusable, so the reason is pointer-only — the accepted §4 trade-off; the disabled-version banner gives the one keyboard-visible explanation. That banner names the blocker without a link (visual-spec `:293-294` asks for one): its resolution — the **Enable** button — sits in the same view's state bar, so no link is added.
- **D5 — Disabled versions = reference treatment, not `--dimmed`.** A disabled version's number drops `--text` → `--muted` (ref 1495) and **all** of its badges — the lifecycle badge included — use `--state-disabled-{bg,fg}` (ref 1497; visual-spec `:199-201` "badge fills drop to `--state-disabled-bg`"). No `--dimmed` token is added; the `TODO(version-slice)` comment at `theme-default.css:109` is deleted in T2.
- **D6 — Artboard annotations are not built.** The 3a caption (ref 1501) and the 3b state-bar sentence (ref 1640) are designer notes, not product copy.
- **D7 — IconButton glyph colour stays `--muted`** (Slice-1 pin; the artboard's `#3D4350` is not re-litigated). Its 12px `sm` glyph also stays for the fold chevron (artboard 13px, ref 1534) — one glyph scale per button size. Both noted for the polish slice if the browser pass flags them.
- **D8 — `confirm()` stays** for publish/archive/revert/disable/enable/delete (D3 only changes its text). The in-place confirm pattern (§4 Confirm-then-act) is for deletes with dependents (10i/10j).
- **D9 — Approach: one shared primitive** `ui/InlineField.svelte`. Slice 6's 10a inline-edit reuses it.
- **D10 — No nested sequence boxes (rule beats pixels).** visual-spec `:269-270`: "Nesting is carried by indentation, the code badges and the header tints — not by nested boxes." The artboard boxes only the expanded S1 (ref 1571) while S2/S3 are bare rows (ref 1614, 1620); the rule and two of three artboard sequences agree, so **sequences render without a card border**, collapsed or expanded. An expanded sequence is its header row followed by its body (`border-top: 1px solid var(--border-soft)`, ref 1578).
- **D11 — Sequence title 13.5px (rule beats pixels).** visual-spec `:265-266` "13.5px title" over ref 1574's 13px — the same choice Slice 3 made for `SequenceLink`.
- **D12 — Focus rings follow the 2026-09-07 user ruling.** The global focus ring (1.16:1, invisible in forced colors) is **backlogged for the polish slice** (`docs/backlog/global-focus-ring-invisible-in-forced-colors.md`); this slice does **not** add per-control rings to IconButton, the accordion toggle, the course link or InlineField. T1 appends the new 5a focusables (IconButton incl. `primary`, the InlineField editor and its focus-parking row container, the accordion toggle, the h1 course link, the restyled raw create-form inputs/textareas and the duplicate-row input) to that backlog file so the polish fix covers them. **Exception:** `ItemTypePicker` already owns a custom focus indicator for its sr-only radios — it is restyled to the established idiom (§5), since leaving a mouse-triggered `:focus-within` outline would be a regression of an existing control.
- **D13 — InlineField metrics are uniform.** The sequence-title row's ref 1579 metrics (`align-items:center; padding:2px 0 12px`, no hairline) are not reproduced; every InlineField uses the Version-info row metrics (ref 1537) so the three panels read as one pattern.
- **D14 — Accordion chevron is a pointer convenience.** The accessible toggle is the header's title button (`aria-expanded`/`aria-controls`, inside the section heading). The chevron at the far right (ref 1568/1576) is an `IconButton` with `tabindex="-1"` and `aria-hidden="true"` that calls the same toggle — not in the tab order, not announced, so there is no duplicate control for AT.

---

## Enumerated changes (the non-pure-CSS touches)

1. **VersionsPage `<h1>`** drops "Edit ·" (§5.1); the text back button becomes a 28px round IconButton `back` ("Back to courses").
2. **Create-version form starts collapsed** behind a filled `+` IconButton that toggles to `close` (§5.3). Fields unchanged.
3. **Version rows: four fixed icon slots** (§5.4) — Open · Duplicate · Disable/Enable · Delete — forbidden ones render disabled with a reason.
4. **VersionEditPage heading** leads with the label (§5.2); the course name is a link back to the version list replacing the `← Versions` button; label-less fallback defined (§3).
5. **Version info, block title/info, sequence title → per-field inline editing** (§5.5, D2). Removes `makeDirtyTracker` + Save/Discard from `VersionMetaForm`, `BlockAccordion`, `SequenceAccordion`; removes dirty-**blocking** of reorder / `+ New …` / transitions / deletes (replaced by D3's warn-in-confirm).
6. **Version info and Blocks panels foldable** (chevron beside the heading; component-local, default open, not persisted; folded body stays mounted with `hidden`).
7. **Create forms start collapsed** behind `+` IconButtons: **filled `md`** for block (Blocks card heading, ref 1560) and item (beside `Items`, ref 1586); **outlined `sm`** for sequence (in the block header, ref 1568).
8. **Reorder arrows always render** (block, sequence, item) — disabled at the boundary or when structure is forbidden; today they are hidden in both cases.
9. **Item rows: ItemMark replaces emoji**; four fixed slots ↑ ↓ open delete. `ItemTypePicker` emoji → ItemMark glyphs.
10. **Delete block / delete sequence move to a body footer** (28px trash + reason-mirroring text).
11. **Loading / error / empty states** on both pages adopt `ui/Skeleton|ErrorState|EmptyState` (9d).
12. **`EmptyState` gains optional icon tile, hint, action** (deferred from Slice-4 D2; first consumer "No versions yet").
13. **`IconButton` gains** glyphs `back`, `check`, `chevron-right`; props `round`, `primary`, a bindable `element` ref, and forwarded `id` / `tabindex` / `aria-hidden` / `aria-expanded` / `aria-controls` / `onmousedown`.
14. **New `editor/VersionBadges.svelte`** (lifecycle + disabled badges) used by 3a rows and the 3b heading.
15. **New `lib/editorReasons.ts`** — the disabled-reason strings, one place.
16. **`dirtyRegistry` + `DirtyGuard` gain discard-on-confirm** (D3): `RegisteredTracker.discard?()`, `registry.discardAll()`, `DirtyGuard` prop `onDiscard?`.
17. **Accordion headers become headings:** block toggle inside `<h3>`, sequence toggle inside `<h4>`; the sequence body's `Items` label is an `<h5>`.

---

## Scope

### In scope
- New: `components/ui/InlineField.svelte`, `components/editor/VersionBadges.svelte`, `lib/editorReasons.ts` (all T1).
- Extended: `components/ui/IconButton.svelte`, `components/ui/EmptyState.svelte`, `lib/dirtyRegistry.svelte.ts` (optional `discard` + `discardAll`), `components/editor/DirtyGuard.svelte` (optional `onDiscard`).
- Restyled/restructured: `pages/editor/VersionsPage.svelte`, `pages/editor/VersionEditPage.svelte`, `components/editor/{VersionMetaForm, AccordionHeader, BlockAccordion, SequenceAccordion, ItemRow, ItemTypePicker}.svelte`.
- `styles/theme-default.css`: delete the `TODO(version-slice)` comment only (no token change).
- `docs/backlog/global-focus-ring-invisible-in-forced-colors.md`: append the 5a focusables (D12).
- Tests + gate sections for all of the above.

### Out of scope / deferred
- `pages/editor/ItemEditPage.svelte` and everything it renders (`QuizEditor`, `QuestionAccordion`, `QuestionTypePicker`, `OptionRow`, `MarkdownEditor`, `AssetSidebar`, `InteractiveAppEditor`, `VideoFrame`) → **5b**. In 5a an item row's Open still navigates to today's (unstyled) item route; `ItemEditPage`'s `DirtyGuard` usage is unchanged (no `onDiscard`).
- `components/runs/MiniProjectModal.svelte` (10m) → **Slice 6**.
- `lib/dirty.svelte.ts`, `lib/versionPermissions.ts`, the router, `stores/currentEditorVersion.svelte.ts`, `lib/versionsPageLoader.svelte.ts`, `ui/Button.svelte`, `ui/Input.svelte`, `course/ItemMark.svelte` — **unchanged**.
- Per-control focus rings (D12) and the 404 page — polish slice.

---

## Per-surface design

### 1. Primitives — T1

#### 1.1 `ui/InlineField.svelte`

**Purpose.** One row that reads as text until opened; each field commits on its own (§4 Inline field editing).

**Props.**

| prop | type | notes |
|---|---|---|
| `label` | `string` | visible label; the editor's accessible name via `aria-labelledby` |
| `value` | `string \| number` | saved value (from the tree) |
| `kind` | `'text' \| 'textarea' \| 'number'` | default `'text'` |
| `editTitle` | `string` | pencil `title` + `aria-label`, e.g. "Edit the label" |
| `disabledReason` | `string \| null` | `null` = editable; else pencil disabled with this `title` |
| `validate` | `(parsed: string \| number) => string \| null` | optional; a message blocks commit and shows inline |
| `required` | `boolean` | trimmed-empty draft → "{label} is required" |
| `maxlength` | `number` | text/textarea only |
| `min`, `max`, `step` | `number` | number only (native attributes; `validate` is the authority) |
| `onCommit` | `(parsed: string \| number) => Promise<void>` | panel's PATCH + tree refresh; **throws** to signal failure |

**Draft model.** `draft` is always a `string` (`$state`). The editor is **one-way** (`value={draft}` + `oninput={(e) => draft = e.currentTarget.value}`), never `bind:value` (a bound `type=number` yields `number|null`). `parse(draft)`: `text`/`textarea` → `draft` unchanged (not trimmed; the server strips labels and validates titles); `number` → `draft.trim() === ''` ? `NaN` : `Number(draft)`. `same(draft, value)`: `number` → `parse(draft) === value` (a blank draft is never same); else `draft === String(value)`. Both the dirty check and the unchanged-close use `same`.

**Layout** (`/* ref 1537-1551 */`). Root element `<div class="inline-field" bind:this={rowEl}>`: `display:grid; grid-template-columns: 132px 1fr 54px; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--border-soft)`. The last row's hairline is removed by the consuming panel: each panel wraps its InlineFields in `<div class="fields">` and scopes `.fields > :global(.inline-field:last-child) { border-bottom: 0 }` (the wrapper is required — in block/sequence bodies the fields are followed by forms, lists and footers, so a bare `:last-child` would never match). Label `<span id={labelId}>` 12.5px `--muted`; value 13px `--text`, `line-height:1.55`, `white-space:pre-wrap`, `overflow-wrap:anywhere`; `number` values wrapped in `.mono`. Empty value → `Not set` in `--muted`. Action slot `display:flex; justify-content:flex-end; gap:6px` — the 54px column is **fixed in both states** (ref 1579-1582 closed precedent), so opening never shifts the value column and **✓ lands where the pencil was** (§4). Closed: `IconButton sm pencil`. Open: `IconButton sm close` then `IconButton sm primary check`. Closed rows: `align-items: baseline`, slot `align-self:center` (ref 1537, 1540). Open rows: `align-items: start`; label `padding-top: 9px` for `textarea` (ref 1543) and `6px` for `text`/`number` (form (b): centres the ~18px label line on the 30px `--control-h` field); slot `padding-top: 7px` for `textarea` (ref 1546) and `3px` for `text`/`number` (centres a 24px button on the 30px field).

**Open editor styling** (ref 1544): `border: 1.5px solid var(--primary); border-radius: var(--radius); box-shadow: 0 0 0 3px var(--primary-soft); background: var(--surface); color: var(--text-2); font-size: 13px`. Textarea: `.mono`, `padding: 8px 10px; line-height: 1.6; rows=3; resize: vertical; width: 100%`. Text/number: `height: var(--control-h); padding: 0 10px; width: 100%` (number in `.mono`). Editor `aria-labelledby={labelId}`; textarea also `aria-describedby` a visually-hidden hint "Press Control or Command plus Enter to save, Escape to cancel". There is no global `.sr-only` class, so InlineField scopes its own: `position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path: inset(50%); white-space:nowrap; border:0` (no `opacity`, so the no-opacity gate sweep stays clean).

**Behaviour.**
- **Open:** pencil click → `open = true`, `draft = String(value)` (`''` for empty), `error = null` → `await tick()` → focus the editor, caret at end.
- **Generation guard:** a `gen` counter increments on every open and every close (cancel, success, `closeSilently`). `gen` is captured **immediately before each `await`** (not once per operation — e.g. the success path closes, which bumps `gen`, *then* captures it before `await tick()`), and the continuation bails if it changed or the component is no longer mounted (`alive`, `onDestroy`). The guard covers only **error, open-state and focus writes**: `busy = false` always runs in a `finally` (when `alive`), regardless of `gen` — otherwise a discard during an in-flight commit would leave `busy` stuck and the field permanently read-only on reopen. This covers a discard or read-only close during an in-flight commit: the late result neither steals focus nor writes an error onto a closed field, and the field reopens writable.
- **Keys** (on the editor): `Escape` → `preventDefault()` + `stopPropagation()` (Slice-6 10a may sit in an Escape-closing modal) → cancel. `Enter` in `text`/`number`, `Ctrl/Cmd+Enter` in `textarea` → `preventDefault()` → commit. Ignored while `e.isComposing`.
- **Cancel** (✕ / Escape): close, drop draft → `await tick()` → focus the pencil (`element` ref).
- **Commit** (✓ / keys): clear any error → `required` check (trimmed) → for `number`, non-finite `parse` → "Enter a number" → `validate(parse(draft))` → if `same(draft, value)` close (cancel path) without calling `onCommit`; else `busy = true`, `await onCommit(parse(draft))`:
  - **success** → close → `await tick()` → focus the pencil;
  - **failure** → stay open, keep draft, `error = msg(e)` where `msg(e) = e instanceof ApiError ? (e.validationErrors()?.[0]?.msg ?? e.displayMessage) : 'Save failed'` → `await tick()` → focus the editor. The error renders below the editor as `<p class="err" role="alert" id={errId}>` (12.5px `--danger`), editor `aria-invalid="true"` + `aria-describedby` includes `errId`. Typing clears it.
  - While `busy`: editor `readonly`, ✕ and ✓ `disabled`.
  - Every continuation after `await` applies the generation guard above before touching state or focus.
- **Unsaved registration (D3):** `getContext<DirtyRegistry | undefined>(DIRTY_REGISTRY_KEY)` — **optional** (no throw when absent). When present, an `$effect` registers, while `open`, a tracker `{ get isDirty() { return open && !same(draft, value) }, discard() { closeSilently() } }`, unregistering on close/unmount. `closeSilently` closes and drops the draft without moving focus.
- **Read-only flip:** an `$effect` that reads **both** `disabledReason` and `busy`: when `disabledReason` is non-null while `open` and **not** `busy` → (1) capture `hadFocus = rowEl.contains(document.activeElement)` and `wasDirty = !same(draft, value)` **before** closing (once the editor unmounts, `activeElement` is `<body>`), (2) close silently, (3) if `wasDirty` → `pushToast('Editing closed — this version is no longer editable', 'info')`, (4) if `hadFocus` → `await tick()` then focus the row container. The row container carries `tabindex="-1" role="group" aria-labelledby={labelId}` so it is announced as the field's group, and no outline styling (it is only a focus parking spot). If `disabledReason` flips while `busy`, the effect re-runs when `busy` clears and closes then. In that window the failure path checks `disabledReason` first: if it is now non-null it pushes `pushToast(msg(e), 'error')`, skips the inline error (the field is about to close) and marks the field as having had focus, so the deferred flip parks focus on the row container (focus was on the disabled ✓ and has already dropped to `<body>`, so `hadFocus` would otherwise read false). The user may therefore see two toasts — the error and, if the draft was dirty, "Editing closed …" — which is accepted; the test expects both.
- **Server refresh:** while closed the display follows `value`; while open the draft is never overwritten (dirty uses the live `value`).
- **No success toast** — closing with the new value is the confirmation. Panels keep the "Saved (refresh failed — reload to see latest)" info toast for PATCH-ok/refresh-failed.
- **Names:** pencil `aria-label = editTitle`; ✕ `aria-label = "Cancel editing {label}"`, `title = "Cancel"`; ✓ `aria-label = "Save {label}"`, `title = "Save"`.

#### 1.2 `IconButton` additions

- Glyph `back` — `<line x1="12.4" y1="8" x2="3.6" y2="8"/><polyline points="7.2,4.4 3.6,8 7.2,11.6"/>` (ref 1473).
- Glyph `check` — `<polyline points="3.4,8.4 6.6,11.6 12.6,4.8" stroke-width="1.9"/>` (ref 1546; per-element 1.9 per §4).
- Glyph `chevron-right` — `<polyline points="6.6,4.6 10,8 6.6,11.4"/>` (ref 1618, the collapsed "Expand" chevron). Fold/accordion chevrons swap `chevron` ↔ `chevron-right` (no CSS rotation — a parent's scoped CSS cannot reach IconButton's svg).
- Prop `round: boolean` → `border-radius: 50%` (ref 1473).
- Prop `primary: boolean` → `background: var(--primary); color: var(--primary-text); border-color: var(--primary)` (ref 1479, 1546, 1560, 1586). The existing `:disabled` rule must still win (verify specificity; add `.icon-btn.primary:disabled` to the disabled selector list if needed).
- Prop `element = $bindable<HTMLButtonElement | undefined>()` bound to the `<button>` (`bind:this`) — InlineField's focus target.
- Forwarded attributes: `id`, `tabindex`, `aria-hidden`, `aria-expanded`, `aria-controls`, `onmousedown` (explicit typed props, `undefined` by default so they are omitted from the DOM).

#### 1.3 `EmptyState` additions

Optional `icon: 'list'` (38×38 tile, `border-radius: 8px`, `background: var(--surface-2)`, `1px solid var(--border)`, glyph 18px `--muted`: `<line x1="3" y1="4" x2="13" y2="4"/><line x1="3" y1="8" x2="13" y2="8"/><line x1="3" y1="12" x2="9" y2="12"/>` — ref 1356), optional `hint: string` (13px, `line-height:1.5`, `--muted`, `max-width: 44ch` — ref 1358), optional `action: Snippet` (wrapper `margin-top: 4px` — ref 1359). Title-only callers unchanged.

#### 1.4 `editor/VersionBadges.svelte`

Props `state: 'created'|'published'|'archived'`, `isDisabled: boolean`. Renders the lifecycle badge `<span class="vbadge">{state}</span>` and, when disabled, `<span class="vbadge">disabled</span>`. Badge `font-size:11px; font-weight:500; padding:3px 8px; border-radius:3px /* ref 1485 */; white-space:nowrap`. Colour: enabled → `--state-{state}-{bg,fg}`; disabled → **both** badges `--state-disabled-{bg,fg}` (D5). Wrapper `display:inline-flex; gap:6px` (ref 1497). The `.vbadge` class name is unique to this component so gate anchors cannot collide with AccordionHeader's code badge.

#### 1.5 `dirtyRegistry` + `DirtyGuard`

`RegisteredTracker` becomes `{ readonly isDirty: boolean; discard?: () => void }`. Registry gains `discardAll()` → calls `discard?.()` on every registered tracker whose `isDirty` is true. `DirtyGuard` gains optional `onDiscard?: () => void`, called after the user confirms the navigation prompt (not on `beforeunload`, which leaves the page). Existing callers unchanged.

### 2. Versions page (3a) — T2

- **Frame:** page padding stays the app's `.page` frame. Heading row (ref 1472) `display:flex; align-items:center; gap:10px; margin-bottom:16px`: `IconButton md round back` (title + label "Back to courses" → `navigate('/courses')`) + `<h1>` 21px/600 `letter-spacing:-.015em` = course name only.
- **Versions header** (ref 1476-1480): `display:flex; align-items:center; gap:10px; margin-bottom:12px`; `<h2>` 15px/600 + `<span class="mono count">{versions.length}</span>` 11.5px `--muted` + right-aligned (`margin-left:auto`) `IconButton md primary plus`, `aria-label="New version"` (stable — only `title` and glyph swap, per the APG disclosure pattern), title "New version", `aria-expanded={creating}`; while open glyph `close`, title "Cancel new version". Disabled while `busy`.
- **Create form** (collapsed by default; opening focuses the Label input after `tick()`): a `--surface` card (`1px solid var(--border)`, `--radius`, `padding: 14px`, `margin-bottom: 12px`) holding Label (optional), Info (markdown) textarea, Max quiz attempts (number, 1-10) and a primary `Button` "Create". Behaviour unchanged (`createVersion` validation + navigate). Closing via the toggle resets the three fields.
- **List card** (ref 1481): `1px solid var(--border)`, `--radius`, `--surface`, `overflow:hidden`. Row (ref 1482): `display:flex; align-items:center; gap:10px; padding:9px 12px 9px 14px; border-bottom:1px solid var(--border-soft)` (none on last). Children: `<span class="mono vnum">v{id}</span>` 13px `--text` (`--muted` when disabled — D5); label 13px `--muted` (omitted when empty); `VersionBadges` pushed right (`margin-left:auto`); slot group `display:flex; gap:6px; margin-left:22px` (ref 1486).
- **Slots** (four, always rendered, `IconButton sm`; reasons via `lib/editorReasons.ts`):

| slot | glyph | enabled when | title when disabled |
|---|---|---|---|
| Open | `pencil` | always | — |
| Duplicate | `duplicate` | `!is_disabled` | "Duplicate — enable the version first" (ref 1498) |
| Disable / Enable | `disable` / `enable` | always (by `is_disabled`) | — |
| Delete | `trash` `danger` | `state==='created' && !is_disabled` | `state!=='created'` → "Delete — only for a created version" (ref 1498, v3 archived+disabled); else (created+disabled) → "Delete — enable the version first" |

  Every slot is also disabled while `busy` (title unchanged). Enabled titles: "Open", "Duplicate", "Disable", "Enable", "Delete" (ref 1486). Accessible names include the version: `aria-label="Open v7"`, `"Duplicate v7"`, `"Disable v7"`/`"Enable v7"`, `"Delete v7"`.
- **Duplicate row:** unchanged behaviour (single open row, label prefill, close on transition), restyled as an inset row under its version: `padding: 9px 12px 9px 14px; background: var(--surface-2); border-bottom: 1px solid var(--border-soft)`; label "New draft label" + input (`--control-h`) + primary `Button` "Create copy" + ghost `Button` "Cancel". Opening focuses the input.
- **States:** loading → `<Skeleton rows={3} />` in the list position; error → `ErrorState variant="page"` title "Couldn't load", `message`, action `Button` "Back to courses"; empty → the Versions header still renders, then `EmptyState icon="list" title="No versions yet" hint="A version holds the blocks, sequences and items students see. Create one to start authoring."` with action primary `Button` "+ New version" that opens the create form (ref 1353-1360).

### 3. Version editor shell (3b) — T3 (Version info) + T4 (Blocks card + state bar)

**T3 — heading, banners, Version info, discard plumbing.**
- **Heading** (ref 1525-1528): row `display:flex; align-items:center; gap:10px; margin-bottom:18px`. `<h1>` 20px/600 `letter-spacing:-.015em`: `<a href="/courses/{slug}/edit" title="Back to versions" onclick={(e) => { e.preventDefault(); navigate(href); }}>{course.name}</a>` (`--primary`, no underline, underline on hover; the `SequencePlayer.svelte:160-161` idiom — the router has no global anchor interception) then, **when `v.label` is non-empty**, ` · {label}` in `--text`. Then `<span class="mono vid">v{id}</span>` 12px `--muted`, then `VersionBadges`. **No label:** the `<h1>` is the course link only; `v{id}` + badges follow.
- **Banners:** disabled version → info banner `background: var(--surface-2); border-left: 3px solid var(--primary); padding: 8px 12px; font-size: 13px; color: var(--text)` "This version is disabled — editing is not allowed. Enable it first." (§4 Precondition banners, information form). Refresh error while a tree is shown → `ErrorState variant="inline" title="Couldn't refresh this version" message={loadError} onretry={() => loadAdminTree(vid, { force: true })}`.
- **Version info card** (ref 1531-1553): `--surface` card, `1px solid var(--border)`, `--radius`, `padding:16px 18px; margin-bottom:18px`. Heading row `display:flex; align-items:center; gap:8px; margin-bottom:4px` (ref 1532): `<h2>` 14px/600 + `IconButton sm borderless` glyph `chevron`/`chevron-right`, `title` "Collapse"/"Expand", `aria-label` "Collapse version info"/"Expand version info", `aria-expanded`, `aria-controls={bodyId}`. Body `<div id={bodyId} hidden={folded}>` (fields inside a `.fields` wrapper) — **stays mounted** (D3). The element carrying `hidden` gets **no `display` rule** of its own (an author `display` would beat the UA `[hidden]{display:none}` and the fold would silently fail); layout goes on an inner wrapper. Same rule for the Blocks body. Three `InlineField`s:
  - Label — `kind="text" maxlength={200} editTitle="Edit the label"`; commit PATCHes `{ label }`.
  - Info (markdown) — `kind="textarea" editTitle="Edit the info"`; commit PATCHes `{ info_md }`.
  - Max quiz attempts — `kind="number" min={1} max={10} step={1} editTitle="Edit the attempt limit"`, `validate` (narrow first: `typeof n === 'number' &&`) `Number.isInteger(n) && n >= 1 && n <= 10` else "Max quiz attempts must be a whole number between 1 and 10"; commit PATCHes `{ max_quiz_attempts }`.
  - `disabledReason = metaReason(v)`.
  - Each `onCommit`: pin `savedVid`; `api.patch('/api/versions/{savedVid}', { field })`; if still on `savedVid` → `loadAdminTree(savedVid, { force: true })`, `'error'` → info toast "Saved (refresh failed — reload to see latest)". PATCH failure → rethrow.
  - `VersionMetaForm` keeps its file and name; loses `makeDirtyTracker`, the registry registration, `save()`/`discard()`, the `parentBusy` prop and the `{#if perms.canEditVersionMeta}` wrapper (D4).
- **Discard plumbing:** `<DirtyGuard isDirty={() => dirtyRegistry.isAnyDirty()} onDiscard={() => dirtyRegistry.discardAll()} />`.
- **Page states:** initial load → `<Skeleton rows={4} />`; load error without a tree → `ErrorState variant="page" title="Couldn't load"` + action `Button` "Back to versions"; bad id / slug mismatch / not found → `ErrorState variant="page"` with their current titles ("Bad URL", "Not found") + the same action.

**T4 — Blocks card, create-block, state bar, transitions.**
- **Blocks card** (ref 1556-1560): same card chrome without `margin-bottom`. Heading row `display:flex; align-items:center; gap:8px; margin-bottom:10px` (ref 1557): `<h2>` "Blocks" + fold chevron (labels "Collapse blocks"/"Expand blocks", body stays mounted; an `$effect` that tracks **only** `routeBid` — `$effect(() => { if (routeBid !== null) untrack(() => { blocksFolded = false; }); })` — unfolds the card on every change of the route block id (including Back/forward from block A to block B), so a deep link never targets a header inside a hidden body (the focus `$effect` would otherwise call `focus()` on a hidden element). Because it does not read the fold state, the user can still fold Blocks while a block is expanded) + `IconButton md primary plus` (`margin-left:auto`, `aria-label="New block"` stable, title "New block", `aria-expanded={creating}`; while open glyph `close`, title "Cancel new block"). The `+` is disabled with `structureReason(v)` as title when set, and while `busy || createBusy`. **No dirty blocking.**
- **Create-block form** (collapsed; opening focuses Title): raw `<input>` Title (`--control-h`, `required`, `disabled` while busy, `oninput` clears the field error) + primary `Button` "Create"; errors as today (`mapCreateError`). Its `createTracker` registers while `creating` and gains `discard() { reset + close }`.
- **Block list:** `{#each tree.blocks as block, i (block.id)}` → `BlockAccordion`. Empty → `EmptyState` title "No blocks yet" (created) / "This version has no blocks." (otherwise) — title-only.
- **State-action bar** (ref 1639-1644): `display:flex; align-items:center; gap:10px; justify-content:flex-end; margin-top:20px; padding-top:14px; border-top:1px solid var(--border)`. Buttons, only those `perms` permits (unchanged logic): Publish `primary`, Archive `secondary`, Revert `secondary`, Disable `ghost`, Enable `ghost`, Delete `variant="danger"`. All disabled while `busy`.
- **Transitions / delete-version (D3):** the `if (dirtyRegistry.isAnyDirty()) return;` early returns in `transition()` and `deleteVersion()` are removed; the publish/archive/disable and delete-version `confirm()` texts gain ` Unsaved edits may be lost.` when dirty (revert/enable do not — D3); `deleteVersion` navigates with `{ force: true }` after a successful DELETE. Delete-version text becomes `Delete version v{id}? This cannot be undone.` (+ suffix).
- `reorderBlock` loses its `isAnyDirty()` guard (keeps `busy || createBusy`).

### 4. Accordions (3b) — T5

**Reasons — `lib/editorReasons.ts`** (introduced in **T1** — plain TS, no CSS, so the first-consumer gate rule does not apply; consumed by T2 (`deleteVersionReason`, `duplicateVersionReason`), T3 (`metaReason`), T4-T6 (`structureReason`, `textReason`)). State is checked **before** `is_disabled`, so "Enable the version first" appears only when enabling would actually unlock the action:

- `metaReason(v)`: `state !== 'created'` → "Only a created version can change its info"; else `is_disabled` → "Enable the version first"; else `null`.
- `structureReason(v)`: `state !== 'created'` → "Only a created version can change its structure"; else `is_disabled` → "Enable the version first"; else `null`.
- `textReason(v)`: `state === 'archived'` → "Archived versions are read-only"; else `is_disabled` → "Enable the version first"; else `null` (published text fields are editable — `versionPermissions.canEditTextFields`).
- `deleteVersionReason(v)`: `state !== 'created'` → "Delete — only for a created version"; else `is_disabled` → "Delete — enable the version first"; else `null`.
- `duplicateVersionReason(v)`: `is_disabled` → "Duplicate — enable the version first"; else `null`.

**`AccordionHeader`** (ref 1564-1568 block, 1572-1576 sequence):
- Props: drop `dirty`; add `badge: string` (`'B1'`/`'S1'`), `structureReason: string | null`, `extra?: Snippet` (block's `+`); `canReorderUp`/`canReorderDown` now mean **"not at the boundary"** (arrows always render). Keep `headerId`, `panelId`, `level`, `title`, `slug`, `index`, `expanded`, `busy`, `onToggle`, `onMoveUp`, `onMoveDown`.
- Row `display:flex; align-items:center; gap:10px`; block `padding:9px 12px; background: var(--surface-2)`; sequence `padding:8px 12px; background: var(--surface)`. `border-bottom: 1px solid var(--border)` on the **block** header only when expanded (ref 1564 vs 1630). Sequence header: no border (D10; the body supplies the `--border-soft` top rule).
- Heading: `<h3 class="hd">` (block) / `<h4 class="hd">` (sequence), `margin:0; flex:1 1 auto; min-width:0; font: inherit`, wrapping the toggle `<button id={headerId} aria-expanded aria-controls={panelId} aria-label={ariaName}>`. The toggle contains the badge `<span class="mono code">` (11px/500 `--primary` on `--primary-soft`, `padding:2px 6px; border-radius:3px` — ref 1565), the title (block 14px/600, sequence **13.5px**/600 — D11, `--text`) and `<span class="mono slug" aria-hidden="true">/{slug}</span>` 12px `--muted`. Toggle `display:flex; align-items:center; gap:10px; width:100%; text-align:left; background:transparent; border:0; padding:0; cursor:pointer`; **no hover background** (the strip tint is the affordance; the old `--surface-hover` fallback rule is deleted).
- Right group `display:flex; align-items:center; gap:6px`: `IconButton sm up`, `IconButton sm down`, `{@render extra?.()}`, then the chevron `IconButton sm borderless` glyph `chevron`/`chevron-right`, title "Collapse"/"Expand", `tabindex={-1}`, `aria-hidden="true"` (D14), `onmousedown={(e) => e.preventDefault()}` (a click never leaves focus on an `aria-hidden` element — on collapse the page's focus `$effect` returns early and would not move it), `onclick={onToggle}`.
- Arrow state: disabled when `busy`, or `structureReason` (title = reason), or at the boundary (title "Move up — already first" / "Move down — already last"); else title "Move up"/"Move down". Accessible names keep today's `Move {level} up: {name}` / `down`. Precedence for the title: `structureReason` → boundary → normal.

**`BlockAccordion`**:
- Card (ref 1563): `border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; margin-bottom: 10px`.
- Header: `badge="B{index}"`, `extra` = `IconButton sm plus`, title "New sequence", `aria-label="New sequence in {block name}"`, `aria-expanded={creating && expanded}`; while the form is open glyph `close`, title "Cancel new sequence"; disabled with `structureReason` / busy.
  - On an **expanded** block it toggles the form (opening focuses its Title).
  - On a **collapsed** block: `await navigate(expandUrl); await tick(); if (expanded) { creating = true; focus Title }` — if the guard prompt is cancelled nothing changes.
- **Collapse resets the create form:** an `$effect` resets and closes the create-sequence form whenever `expanded` becomes false; `createTracker` registers only while `creating && expanded`, with `discard() { reset + close }`.
- Body (`id={panelId}`, `role="region"`, `aria-labelledby={headerId}`; `padding:12px 14px; display:flex; flex-direction:column; gap:10px` — ref 1570): InlineFields (in a `.fields` wrapper) "Block title" (`text`, `required`, `maxlength={200}`, "Edit the block title") and "Info (markdown)" (`textarea`, "Edit the block info"), `disabledReason = textReason(v)`; commits PATCH `/api/blocks/{id}` with the single field + forced refresh (pin `savedVid`/`savedBid`, `stillOnVid` guard as today). Then the create-sequence form (when open), the sequence list (or `No sequences yet.` / `No sequences.` 13px `--muted`), then the delete footer.
- **Delete footer** (ref 1609-1610 pattern): `margin-top:14px; padding-top:12px; border-top:1px solid var(--border-soft); display:flex; align-items:center; gap:8px`: `IconButton md trash danger`, `aria-label="Delete block {name}"`, + a 12.5px `--muted` text span that **mirrors the button's title** (ref 1610 shows the reason as visible text). Precedence: `structureReason` set → "Delete this block — " + the reason with its first letter lower-cased; else sequences > 0 → "Delete this block — remove its sequences first"; else create-sequence form open → "Delete this block — cancel the new sequence first"; else "Delete this block" (enabled). Also disabled while busy (text unchanged). Behaviour = today's `deleteBlock()` minus the `tracker.isDirty` guard, with the D3 confirm suffix and `navigate(…, { force: true })` after success — the reload and the forced navigate stay gated on `stillOnVid(savedVid)` (as today), so a late delete never force-navigates a page that has moved to another version.
- Removed: `makeDirtyTracker` for title/info, `save()`, `discard()`, the expanded-only tracker registration, dirty blocking of reorder/create/delete. Kept: `createTracker` (now gated on `expanded`), `stillOnVid`, all API/reload logic, the `canStructure`-flip reset effect.

**`SequenceAccordion`**:
- No card border (D10). Header: `badge="S{index}"`, no `extra`.
- Body (`id={panelId}`, `role="region"`; ref 1578: `padding:12px 14px; border-top:1px solid var(--border-soft)`): InlineField (in a `.fields` wrapper) "Sequence title" (`text`, `required`, `maxlength={200}`, "Edit the sequence title", `disabledReason = textReason(v)`); Items row (ref 1584-1586: `display:flex; align-items:center; justify-content:space-between; margin-bottom:4px`; `<h5>` 13px/600 "Items" + `IconButton md primary plus` "New item", `aria-label="New item in {sequence name}"`, `aria-expanded`; glyph `close` + "Cancel new item" while open (the `aria-label` stays "New item in {sequence name}"); disabled with `structureReason`/busy; opening focuses the **checked radio of the type picker** — the first field in tab order — via a query scoped to the form element (`formEl.querySelector('input[type=radio]:checked')`, after `tick()`), never a document-wide `name="item-type"` lookup); the create-item form; item rows; delete footer as BlockAccordion's (precedence: `structureReason` → items > 0 "Delete this sequence — remove its items first" (ref 1610) → create-item form open "Delete this sequence — cancel the new item first" → "Delete this sequence"), `aria-label="Delete sequence {name}"`, D3 suffix, `{ force: true }` after success.
- **Race guards added:** `SequenceAccordion` today has no `alive`/`stillOnVid` (unlike `BlockAccordion`). It gains the same pair (`alive` via `onDestroy`, `stillOnVid(savedVid)` comparing the live `vid`), and every post-await reload and the post-delete forced navigate are gated on it — required now that the navigate bypasses guards.
- Create-item form: **fields and validation unchanged, restyle only** — `ItemTypePicker`, Title, the type-specific `content_md` textarea (static page) / `video_url` input (video) with their field errors and the `contentMdTouched` logic, `createGlobalError`, primary `Button` "Create". `createTracker` registers while `creating && expanded`, `discard()` resets; collapse resets the form (same effect as BlockAccordion).
- Removed/kept: as BlockAccordion.

**Create forms (block / sequence / item) — shared look.** Inline under their trigger: `padding: 12px 0; display:flex; flex-direction:column; gap:8px`; inputs `height: var(--control-h); padding: 0 10px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface); font-size: 13px`; textareas the same with `height:auto; padding: 8px 10px`; field error `12.5px --danger`; the submit row right-aligned.

### 5. Item rows + type picker (3b) — T6

**`ItemRow`** (ref 1588-1606): `display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border-soft)` (none on last — parent `:last-child`). Children: `<ItemMark type={item.type} state="not-yet" />`; title 13px/600 `--text`; slug `.mono` 12px `--muted` (`aria-hidden`, as today); quiz: `<span class="sep" aria-hidden="true">·</span>` (`--faint`) + `<span class="mono q-count">{n} question(s)</span>` 12px `--muted`. Right group `margin-left:auto; display:flex; gap:6px`: ↑ ↓ (AccordionHeader's rules and precedence), `IconButton sm pencil` title "Open", `aria-label="Open {name}"` (enabled unless busy), `IconButton sm trash danger` title "Delete" (or the structure reason), `aria-label="Delete {name}"`. Props: drop `parentDirty` and `canStructure`; add `structureReason: string | null`; `canReorderUp/Down` = "not at boundary". Item delete gets **no** D3 suffix (an item row holds no inline field — D3).

**`ItemTypePicker`**: fieldset of four radio cards; each card = `<ItemMark type=… state="not-yet" />` + label (Page / Video / Quiz / Interactive app) 13px. Card `display:flex; align-items:center; gap:8px; padding:6px 10px; border:1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface); cursor:pointer`; selected `border-color: var(--primary); background: var(--primary-soft)`. Focus (D12 exception, Slice-3/Login idiom): `label:has(input:focus-visible) { box-shadow: inset 0 0 0 2px var(--primary) }`; the old `:focus-within` outline is removed. Forced colors: `@media (forced-colors: active) { label.selected { border: 2px solid Highlight } label:has(input:focus-visible) { outline: 2px solid Highlight; outline-offset: -2px } }`. Radios stay sr-only (Constraint 2). Legend "Item type" 12.5px `--muted`.

---

## Data flow & error handling

- **No change to data flow.** `currentEditorVersion` / `loadAdminTree` / `versionsPageLoader` are the only sources; every mutation keeps its pin-at-start + forced-refresh discipline, and every post-await reload/navigate is gated on `stillOnVid` (newly added to `SequenceAccordion`, §4). `deriveExpansion`, `handleStaleIdFallback` and the focus `$effect` (`lastFocusedTarget`) are untouched.
- **Inline commit errors** surface inline with the first 422 detail message (§1.1 `msg`) — never a toast, except the read-only-flip-while-busy case. **Create errors** keep `mapCreateError` (field-level inline + toast only when no field error). **Reorder / delete / transitions** keep toast + forced refresh.
- **Concurrent draft + structure change:** an open field inside a block that is reordered stays mounted (keyed `{#each}`) and keeps its draft; a fold hides but keeps it; a route collapse unmounts it behind the D3 prompt, and a confirmed prompt discards every draft (`discardAll`).

## Testing strategy

Pattern: `mount`/`unmount`/`flushSync` from `svelte`, no `@testing-library/svelte`.

- **T1 — new `InlineField.svelte.test.ts`:** closed render (label, value, `Not set`, mono number); open → editor focused with value; ✕ and Escape cancel + focus pencil, Escape does not propagate; Enter (text), Cmd/Ctrl+Enter (textarea), Enter ignored while composing; unchanged draft closes without `onCommit`; **number field opened and unchanged is not dirty**; blank number → "Enter a number"; `required` + `validate` block commit; rejected `onCommit` (string detail and 422 array detail) keeps draft, shows the right message, `aria-invalid`, focuses the editor; busy disables controls; success focuses the pencil; discard during an in-flight commit → late success/failure neither focuses nor sets an error (generation guard) **and reopening afterwards gives a writable editor (`busy` reset)**; reopening clears a stale error; read-only flip during a failing commit → error toast (+ "Editing closed" toast when dirty), no inline error; registry sees dirty only while open and changed; `discard()` closes; no registry → no throw; `disabledReason` flip while open closes + toast when dirty; flip while busy defers; `value` change while open keeps draft; `value` change while closed updates text.
- **T1 — extended `IconButton.svelte.test.ts`:** `back`/`check`/`chevron-right` glyphs, `round`, `primary`, disabled-beats-primary, `element` binding, forwarded `id`/`tabindex`/`aria-*` present only when passed.
- **T1 — extended `EmptyState.svelte.test.ts`:** icon/hint/action; title-only unchanged.
- **T1 — new `VersionBadges.svelte.test.ts`:** created/published/archived enabled colours via class/attr hooks; disabled → both badges use the disabled treatment.
- **T1 — extended `dirtyRegistry.test.ts`** (`discardAll` calls `discard` only on dirty trackers) and new `DirtyGuard.svelte.test.ts` (`onDiscard` called after confirm, not on cancel, not on beforeunload).
- **T2 — new `VersionsPage.slots.svelte.test.ts`:** four slots per row with the table's states + titles (incl. archived+disabled and created+disabled Delete); disabled number `--muted` hook; collapsed create toggle + focus; empty/error/loading. **Rewritten:** `VersionsPage.duplicate`.
- **T1 — new `editorReasons.test.ts`** (every function × all six state×disabled combinations).
- **T3 — new `VersionEditPage.svelte.test.ts`** (heading with/without label, course-link navigation, Version-info fold keeps a dirty draft mounted, disabled banner, `onDiscard` wiring); **rewritten** `VersionMetaForm.label` → inline commit PATCHes `{label}` only.
- **T4 — extend `VersionEditPage.svelte.test.ts`:** Blocks fold, a route expansion (and a block-A→block-B route change) unfolds it, and folding while a block is expanded stays folded; create-block collapsed + focus; state bar per state; transitions not blocked by a dirty field; publish/archive/disable confirm carries the suffix, revert/enable do not; delete-version suffix + `force` navigation.
- **T5 — new `BlockAccordion.svelte.test.ts`:** header badge/slug/`<h3>`; arrows always present with precedence titles; `+` on collapsed block expands then opens form, cancelled guard leaves it closed; collapse resets form; inline title commit PATCHes `{title}` only; delete footer precedence + `force` navigation. **Rewritten:** `accordionHeader` (+ chevron `mousedown` does not take focus), `SequenceAccordion.interactive` (+ inline title commit, items `+` focuses the checked type radio, delete footer, create-item type-specific fields retained, late delete after a version change does not navigate). Update the stale line cite in `BlockGroup.svelte.test.ts:176`.
- **T6 — rewritten:** `ItemRow` (ItemMark, four slots, names), `ItemTypePicker` (ItemMark glyphs, selected class, no emoji).
- **Unchanged:** `dirty`, `versionPermissions`, `currentEditorVersion`, `versionsPageLoader`, `router`.
- **Gate:** one section per task in `visual-refresh-gate.sh`, Slice-3/4 conventions (hash-coupled dist greps; selector-agnostic `none` anchors; no-hex / no-opacity / no-emoji sweeps over every touched file; `EXPECTED_CHECKS` = printed count). A primitive's CSS section lands with its **first consumer's** task (Vite emits no CSS for unimported components): **T2** pins IconButton's base `.icon-btn` + `:disabled` + `round` + `primary` rules (IconButton reaches dist for the first time there), `EmptyState` additions and `VersionBadges` (`.vbadge` hash-coupled to VersionBadges' own scope); **T3** pins InlineField. The plan owns exact grep authoring.

## Task decomposition (6 tasks; carried into the implementation plan)

| task | content | gate |
|---|---|---|
| **T1** | Primitives: `InlineField`, `IconButton` additions, `EmptyState` additions, `VersionBadges`, `lib/editorReasons.ts`, `dirtyRegistry.discardAll` + `DirtyGuard.onDiscard`; backlog-file append (D12); unit tests | unit only (no consumer yet) |
| **T2** | Versions page (3a); delete `TODO(version-slice)` | 3a + IconButton base/round/primary + EmptyState additions + VersionBadges |
| **T3** | Editor heading, banners, page states, Version info card (InlineFields), `VersionMetaForm` rewrite, `DirtyGuard onDiscard` wiring | 3b shell + InlineField |
| **T4** | Blocks card + fold + create-block, empty blocks, state-action bar, transitions/delete-version (D3 warn + force), `reorderBlock` unguarded | 3b blocks card + state bar |
| **T5** | `AccordionHeader`, `BlockAccordion`, `SequenceAccordion` (InlineFields, `+` buttons, fixed arrows, delete footers, create-form collapse reset, headings, SequenceAccordion race guards) | 3b accordion |
| **T6** | `ItemRow` + `ItemTypePicker` | 3b item rows + picker |

Then whole-branch review (both lanes) → user browser pass → explicit OK closes 5a.

## Git stacking (decided)

`main ← s2 ← s3 ← s4 (6fff756) ← s5a (this) ← s5b`. Nothing merges until all slices are done.

---

## Round-1 review resolutions (for re-review verification)

Four lanes on rev 1 (`7d776bf`): **fidelity** (3I/8M), **behaviour** (8I/5M), **a11y** (6I/9M), **plan-readiness** (5I/12M). All NOT CONVERGED.

**Important — all resolved:**
- *Disabled-version badge colours* (fidelity I1) → D5 rewritten, mapping table split (archived enabled `--state-archived-*`; any badge on a disabled version `--state-disabled-*`), §1.4, VersionBadges test.
- *Delete-slot reason order vs ref 1498* (fidelity I2, behaviour I4) → state checked before `is_disabled` everywhere: §2 table, `lib/editorReasons.ts` (§4), tests for all six combinations.
- *Nested sequence boxes vs §4 rule* (fidelity I3) → D10 (no sequence card), + D11 (13.5px title, fidelity M4).
- *IconButton cannot accept the attributes used* (a11y I1, plan I1, behaviour I5) → §1.2: bindable `element`, forwarded `id`/`tabindex`/`aria-hidden`/`aria-expanded`/`aria-controls`, `chevron-right` glyph swap instead of CSS rotation; `aria-busy` dropped.
- *Focus invisible on new controls* (a11y I2) → D12: follows the 2026-09-07 user ruling (polish slice), new focusables appended to the backlog file; ItemTypePicker exception restyled to the established idiom (a11y I5).
- *Fold destroys drafts / duplicate fold names* (a11y I3, plan I4, behaviour I2) → folded bodies stay mounted (`hidden`), distinct `aria-label`s, fold-keeps-draft test.
- *InlineField focus targets* (a11y I4) → §1.1 pins `tick()` + target for open/cancel/success/failure/read-only flip; `element` ref.
- *ItemTypePicker forced colors / focus idiom* (a11y I5) → §5.
- *Repeated accessible names* (a11y I6) → item delete "Delete {name}", "New sequence in {block}", "New item in {sequence}", footer deletes named, 3a slots name the version.
- *`.danger-text` on Button cannot apply* (plan I2) → `Button variant="danger"`.
- *`Input` lacks needed props* (plan I3) → Constraint 6: raw inputs, shared create-form look (§4).
- *Create-item form under-specified* (plan I5) → "fields and validation unchanged, restyle only" incl. type-specific fields.
- *Create-form trackers survive collapse; `+`-then-navigate leaves `creating` stuck* (behaviour I1) → collapse-reset effect, registration gated on `creating && expanded`, `+` sets `creating` only after the awaited navigation lands expanded; `discard()` on create trackers.
- *Transitions silently drop drafts* (behaviour I3) → D3 warn-in-confirm suffix on every transition/delete.
- *Number dirty always-true with `bind:value`* (behaviour I6) → one-way string draft + `same()` normalisation + test.
- *422 inline message meaningless* (behaviour I7) → `msg(e)` uses the first `validationErrors()` message.
- *Delete-block dead with no reason while create form open* (behaviour I8) → footer precedence includes "cancel the new sequence first" (and the sequence analogue).

**Minor — resolved:** open-slot `padding-top` 7px/3px (fid M5); editor `--text-2` (fid M6); sequence-title metrics → D13 (fid M7); Versions header 12px / Blocks heading 10px margins (fid M8); chevron 12px → D7 (fid M9); toggle hover removed (fid M10); line refs corrected (fid M11); heading levels h3/h4/h5 (a11y M1); chevron `tabindex=-1` rationale → D14 (a11y M2); title-only reasons recorded in D4 (a11y M3); key handling: preventDefault/stopPropagation/isComposing + sr-only Ctrl+Enter hint (a11y M4); error cleared on commit start (a11y M5); `aria-labelledby` instead of a dangling `<label for>` (a11y M6, plan M7); `aria-expanded` + focus-on-open for every `+` (a11y M7); read-only-flip toast (a11y M9); enumerated item 7 filled vs outlined (plan M1); number contract typed and normalised, blank → "Enter a number" (plan M2, behaviour minor); flip-while-busy deferred (plan M3, behaviour minor); footer precedence (plan M4, behaviour minor); `+` swaps to `close` (plan M5); Skeleton composition (plan M6); test-list gaps (plan M8); gate pins IconButton base + `.vbadge` ownership (plan M9); confirmed discard really discards via `discardAll` (plan M10); delete block/sequence/item suffix + `force` (plan M11, behaviour minor); T3 split → T3 + T4, now 6 tasks (plan M12); stale cite `BlockGroup.svelte.test.ts:176` (behaviour minor).

**Minor — accepted, not changed:** a11y M8 (course link is the only back affordance — per §5.2; its name is the course name and `title` says "Back to versions"); the `aria-busy` / "Saving…" live status (a11y M5 second half) — dropped, the disabled ✓ plus the field closing is the feedback.

## Round-2 review resolutions (for re-review verification)

Round 2 on rev 2 (`aded33b`): **fidelity** CONVERGED (0I/3M), **behaviour** CONVERGED (0I/3M), **a11y** CONVERGED (0I/7M), **plan-readiness** NOT CONVERGED (1I/5M). All round-1 findings confirmed resolved by their lanes.

**Important — resolved:**
- *`editorReasons.ts` consumed in T2 but introduced in T3* (plan N1) → moved to **T1** with its test (§4 lead-in, Scope, Testing, task table).

**Minor — resolved:** `#E9EBEF` mapping row completed (fid M3); text/number open-label offset 6px, form (b) (fid M2); disabled banner without link recorded in D4 (fid M1); `.fields` wrapper + named `inline-field` root so the last-row rule matches (plan N2); suffix reworded "may be lost" and limited to publish/archive/disable/delete-version/delete-block/delete-sequence (plan N3, behaviour M3); discard-then-abort recorded as unreachable in D3 (plan N4); route expansion unfolds Blocks (plan N5); `validate` narrowing + read-only effect tracks `busy` (plan N6); D12 coverage list extended (a11y M1); read-only flip captures focus/dirty before closing, parking row `role=group` + `aria-labelledby` (a11y M2); stable `aria-label` on the Versions/Blocks `+` (a11y M3); no `display` on `hidden` elements (a11y M4); scoped sr-only without opacity (a11y M5); create-item focuses the checked type radio (a11y M6); chevron `onmousedown` preventDefault, `onmousedown` forwarded by IconButton (a11y M7); InlineField generation guard + open clears error (behaviour M1); `SequenceAccordion` gains `alive`/`stillOnVid`, gating reload and forced navigate (behaviour M2).

## Round-3 review resolutions (for re-review verification)

Round 3 on rev 3 (`4b1e79c`): **fidelity** CONVERGED (0/0/0), **a11y** CONVERGED (0I/4M), **plan-readiness** CONVERGED (0I/2M), **behaviour** NOT CONVERGED (1I/3M).

**Important — resolved:**
- *Generation guard leaves `busy` stuck after a mid-commit discard* (behaviour I1) → §1.1: guard covers only error/open/focus writes; `busy = false` always in `finally` when `alive`; test "discard mid-commit → reopen → writable".

**Minor — resolved:** `gen` captured immediately before each `await` + success-focuses-pencil test (behaviour M1, a11y N1); Blocks unfold effect tracks only `routeBid` via `untrack`, covers A→B, fold still possible (behaviour M2, a11y N3); failure during the busy-window flip → toast, no inline error, two toasts accepted (behaviour M3, plan R2); checked-radio focus via a form-scoped query (a11y N4); stray "item delete gets the suffix" sentence removed from §5 (plan R1).

**Minor — accepted:** `role=group` on every row, not only while parked (a11y N2) — harmless, noted for the browser pass.

## Round-4 review resolutions

Round 4 on rev 4 (`64b0319`): **all four lanes CONVERGED** (fidelity 0/0/0, behaviour 0/0/0, plan-readiness 0/0/0, a11y 0I/1 optional M). The optional a11y Minor — a failed commit during the busy-window flip left focus on `<body>` — is folded into rev 5: that branch forces `hadFocus` so focus parks on the row container.
