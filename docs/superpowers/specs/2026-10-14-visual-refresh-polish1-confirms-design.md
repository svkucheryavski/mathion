# Visual refresh — Polish 1: one confirm style

**Status:** draft rev 9 (2026-10-14), for review.
- Rev 2 folded in round 1 (Opus on the code, Opus on the design, Fable): the top-most host for the page question, a second navigation while a question is open, re-checks after every await, freezing, a focus table, the focus ring, disabled-state guards, AssetSidebar's busy confirm, the task order, the gate.
- Rev 3 folds in round 2 (`.superpowers/sdd/2026-10-14-visual-refresh-polish1-confirms/spec-r2-*.md`) and the user's answers D39–D41:
  - one question per place, across the page question and a host's own question (R53);
  - the question stays, busy, until its action settles (R54);
  - DirtyGuard can withdraw the owner's question (R55);
  - R50 guards pointer clicks only;
  - footer-less hosts;
  - the page row freezes the page and returns focus to where it was;
  - focus after a dismissal;
  - R51 and R52 restated;
  - one router line;
  - #8 moved into Task 2;
  - gate changes per task.
- Rev 4 folds in round 3 (`spec-r3-*.md`):
  - `ask` tells Cancel from a dismissal (R56);
  - focus moves after an answer only if the person has not moved it (R57);
  - row deletes whose row goes with the reload settle before the reload (R54);
  - #19 settles on the delete's promise, and the body freezes through a wrapper;
  - the page row restores the scroll position on Cancel;
  - the tree shares one keyed question;
  - DirtyGuard's `ask` hands back `focusCancel`;
  - the D10 Cancel returns to the dirty edit;
  - Code changes is now complete.
- Rev 5 folds in round 4 (`spec-r4-*.md`):
  - R57 allows a site's second focus move from its own interim target;
  - #17 settles before the reload like #18;
  - the tree keys are kind-prefixed;
  - the Discard `<body>` rescue is a single check;
  - AssetSidebar keeps the question open when the sidebar turns disabled;
  - a focus target must be enabled and not inert.
- Rev 6 folds in round 5 (`spec-r5-*.md`):
  - a failed request stays busy until `busy` clears, then focuses the trigger;
  - the `finally` order is fixed;
  - #3 and #5 settle before their forced navigate;
  - AssetSidebar closes the question when it turns disabled;
  - the Discard rescue checks `alive`.
- Rev 7 folds in round 6 (`spec-r6-*.md`):
  - the `finally` order settles before the flush, so a trigger the question replaced is back when it is focused;
  - AssetSidebar dismisses only an idle question;
  - line citations and test mounts are corrected.
- Rev 8 folds in round 7's minors: AssetSidebar's drop zone and the fallback after a busy delete, the #4 404-race chain, #3 in the early-settle list, and test wording.
- Rev 9 gives the asset drop zone a `title` with its reason (round 8).

**Branch:** `feat/visual-refresh-polish1-confirms`, cut from the 6c tip (`7e02f70`). It stays local: no push, no merge.

**Authority:**
- The user's decisions in the 2026-10-14 brainstorm (D30–D41 below). Mock-ups: `.superpowers/sdd/2026-10-14-visual-refresh-polish1-confirms/{q1-style,q2-red,q4-danger,s1-look,s2-how,s3-tasks}.html`. The factual base is `inventory.md` in the same folder (every call site, test and gate pin at `7e02f70`).
- The design handoff `docs/design/visual-refresh/` holds where this spec is silent, with one deliberate change: the handoff's "danger is a text treatment, never a red fill" rule is replaced by D31.
- The 6a, 6b and 6c specs hold where this spec is silent:
  - 6a §Focus: focus never drops to `<body>`; a row action has a fallback chain.
  - 6b R19: freeze during a request.
  - 6b R20: a busy button keeps focus.
  - 6b P23: a busy button keeps its variant look and shows a spinner.
  - 6c R44: busy controls are `aria-disabled`, not natively disabled.
  - 6c rev 8: the discard question replaces the form's button row and freezes the rest; Cancel returns focus to the saved element.
  - The earlier slices' rules: tokens only, no literal colours, no emoji, and every disabled control names its reason in `title`.
- `file:line` references are to the code at `7e02f70`; paths are relative to `frontend/src` unless stated.

## Why

The Teaching screens confirm in place (`InlineConfirm`, `DangerConfirm`). Their buttons are bare text, so in the 6c Safari pass the user missed a confirm at the drawer's edge and asked for "real but small buttons, red for the action, grey for Cancel", and a better red ("like crimson") for every danger button and error. The authoring screens still use the browser's `confirm()` pop-up in 21 places. The user ruled in the 6a Safari pass that there must be one way to confirm, in place, everywhere.

## Decisions

The user's (2026-10-14), continuing the Slice-6 numbering:
- **D30 — Polish is three slices.** This one (confirms) first. Polish 2 takes the items sent "to the end": the forced-colors focus ring, reduced motion, the page background, h4–h6 and blockquote, the Not-found page check, and bare URLs. Polish 3 triages the reviewers' deferred minors by group.
- **D31 — Outlined at rest, filled on hover or keyboard focus.** This applies to every confirm action, every danger button and the armed Force delete. At rest: a white background, a 1px outline and coloured text. On hover and on `:focus-visible`: the colour as the fill, with white text. While pressed: a darker step. Cancel has a grey outline at rest and a light-grey fill on hover and focus.
- **D32 — The red is `#C8102E`.** `--danger` changes from `#991B1B` (8.3:1 on white) to `#C8102E` (5.9:1 on white, 4.6:1 on the darkest page shade `--focus-2`). The muted "unarmed" reds `--danger-off-*` are re-derived from it. Error text and error borders follow, because they already use `--danger`.
- **D33 — Red only when something is lost.** Delete, Remove, Discard, Force delete and Replace (the old file is overwritten) are red. Publish, Unpublish, Enable, Disable, Archive, Revert and the answer-key question are steel blue (`--primary`).
- **D34 — One rule everywhere.** Page danger buttons (`Button variant="danger"`) follow D31 at page size. Confirm buttons (`InlineConfirm`, `DangerConfirm`) are small: 22px tall, with 12px text. Force delete stays muted until "I understand" is ticked, then follows D31.
- **D35 — Plain verbs.** A confirm button says the action's verb: "Confirm Delete" and "Confirm Remove" become "Delete" and "Remove", and the default label "Confirm" goes.
- **D36 — The question appears where the thing is.** All 21 browser pop-ups become in-place questions:
  - a confirm row under a row;
  - in place of a toolbar's buttons;
  - in place of a modal footer's buttons;
  - a line under the answers, or under the key field, for the answer-key question;
  - in the dirty form's own button row for unsaved work.

  Only closing the tab or reloading keeps the browser's own warning (`beforeunload`).
- **D37 — The in-app link waits.** `DirtyGuard` asks the owner of the unsaved work to show its question. The link, Back or Forward waits for the answer and goes ahead on Discard.
- **D38 — The version page asks once.** When an in-app link or Back finds unsaved work on the version page and no modal is open, one question appears in a row right under the page title, scrolled into view. When a modal is open, the top-most open modal asks (R46).
- **D39 — In a list, the question follows the click.** With a question open under row A, a click on row B's trash (or another row action) closes A's question without acting and opens the question under row B. A second click on the same row, or on a toolbar, footer or bar, keeps the open question and brings focus back to it. This matches the Teaching rows (RunGroupsTab, RunListPage, AssetSidebar). (User, round 2.)
- **D40 — The danger panel takes the mock-up's colours:** `#FDF0F2` background, `#7A1F2B` message text, `--text-2` for "I understand". The "rejected" status badges keep `--status-rejected-*`. (User, round 2.)
- **D41 — Seven tasks** (Process). (User, round 2.)

## Rulings

These were made from the reviews. Each one says what it costs if it is wrong.

- **R46 — The top-most open modal hosts the page question.** The order is:
  1. a level-3 quiz modal (New question, Question text, Explanation);
  2. else the item editor;
  3. else version settings or new item;
  4. else the row under the title.

  A host with no footer draws the question in a row at the top of its body. These are the quiz item and the read-only item (ItemEditorModal) and the read-only Version settings (`VersionSettingsModal.svelte:119`). Otherwise the level-3 modal's backdrop would hide the question.

  *Cost if wrong:* one host order.
- **R47 — A second navigation joins the open navigation question.** While a navigation question is open, a further guarded navigation (a link, Back, Forward) does not ask again. It waits on the same answer and brings focus back to the open question's Cancel, scrolled into view.
  - On Discard, a later `navigate()` wins over an earlier one. A Back joined to a pending link lands on the link's target, with Back one step away.
  - On Cancel, the address is restored once. Back twice + Cancel keeps one history entry fewer; that is accepted.

  Only a navigation question can be joined, never a delete, close or key question (R53). The alternative was worse: an in-place question does not block the page the way today's pop-up does, so without joining, Discard could drop the work and stay put.

  *Cost if wrong:* one router rule.
- **R48 — A question freezes what it guards.**
  - **A modal-footer question or a body-top question** makes the modal's form inert. In the body-top case, the body's other children go inert, not the body. While it asks, × and Esc move focus to the question's Cancel, and ⌘S does nothing.
  - **The page row** makes the page content below it inert: the tree section and `div.state-actions`. The "Version settings" button (`VersionEditPage.svelte:508-510`) becomes `aria-disabled` with `title="Answer the question first"`. The `<h1>` and the app header stay live, and their links join (R47).
  - **A row or toolbar question** freezes only the controls it replaces.
  - **The duplicate form under a VersionsPage row** goes inert while that row asks (#17).

  *Cost if wrong:* typed text survives a Discard nobody meant.
- **R49 — Every site re-checks after the answer.** Before asking, a site captures its subject: version id, ids and titles. After the await, it re-runs its full pre-gate and recomputes indexes from the live list, and returns if anything changed. A question whose subject goes away (the row is deleted, the version switches) is dismissed. A tree question (#3, #4, #5) is also dismissed when its block or sequence (for an item, its sequence) leaves `open-focus` or the route changes, as AccordionHeader's rename closes itself (`AccordionHeader.svelte:158-160`).

  *Cost if wrong:* an action on the wrong thing.
- **R50 — The question ignores pointer clicks for 400 ms after it appears.** The rule is `if (e.detail > 0 && performance.now() - openedAt < 400) return;`, on both buttons. A real mouse click has `detail ≥ 1`; keyboard activation and `HTMLElement.click()` have `detail === 0`, so keyboard users and the existing tests are untouched. Hover fills apply only under `@media (hover: hover)`. Without the guard, a double-click on a trigger whose question appears under the pointer would answer it.

  *Cost if wrong:* a slower double-check for a fast clicker.
- **R51 — Two discard texts, by what waits.** Both live in `lib/editorReasons.ts`; `quizEdits.svelte.ts` re-exports `DISCARD_CONTINUE` as `DISCARD_PROMPT`. When several forms are dirty, the one question speaks for all of them (no count).

  | text | when |
  |---|---|
  | `DISCARD_CONTINUE = 'Discard unsaved changes and continue?'` | Every navigation question (every owner's DirtyGuard `ask`: the page, the drawer's `'nav'`, the mini-project modal) and the D10 quiz-edit question. The item modal's × is a navigation, so it reads "…and continue?". |
  | `DISCARD = 'Discard unsaved changes?'` | Every close or Esc question: #7, #10, #11, #13, #15, #16, and the drawer's and mini-project's `'cancel'` / `'close'`. |

  *Cost if wrong:* a copy change.
- **R52 — The answer-key question leads with its question.** It uses `message`: a bold lead **"Change the answer key?"**, then today's `KEY_CONFIRM` text without its last word "Continue?", in the column layout. The button is "Change key". The group is named by the message, so a screen reader reads it all. `KEY_CONFIRM` keeps its wording minus "Continue?".

  *Cost if wrong:* a copy change.
- **R53 — One question per place.** A place shows at most one question.
  - **Rows in a list** (keyed: VersionsPage rows, the course tree, quiz cards): a newcomer with a different key replaces the open question, which is dismissed (D39). The course tree is one place: VersionEditPage provides one `treeAsk` by context, which every BlockAccordion and SequenceAccordion uses. Its keys are prefixed by kind (`block-<id>`, `seq-<id>`, `item-<id>`, as the DOM ids are), because blocks, sequences and items number their ids separately. Mounted without the context (tests), BlockAccordion and SequenceAccordion make a local `InPlaceAsk`. QuizBody owns one for its cards, keyed by question id.
  - **The same key, or a place without keys** (toolbar, footer, bar, body-top row): a newcomer is dismissed at once. The open question's Cancel takes focus and is scrolled into view. In Chrome a script focus after a mouse click shows no ring, so the refusal is quiet when the question is already on screen; that is accepted.
  - **Page question vs. a host's own question:** when a host's own question is open (#7, #8, #10, #11, #13, #15, #19, the quiz title's D10), the page `ask` refuses. It returns `false`, the router restores the address, and focus goes to that question's Cancel. A host's own `ask` while the page question is drawn at that host refuses the same way.
  - **While busy** (R54), every newcomer is dismissed without moving focus. That includes the page `ask` when the top host's own question is busy: the refusal does not call `focusOwnCancel()`.

  *Cost if wrong:* a refused navigation the person must repeat.
- **R54 — The question stays, busy, until its action settles.** `answer('confirm')` moves focus to the confirm. In Safari a mouse click leaves it on Cancel, so the move is explicit. The question then stays in its place with `busy` until the host calls `settle()` (in `finally`):
  - both buttons are `aria-disabled`;
  - the confirm is `aria-busy` with a spinner;
  - focus stays on the confirm.

  Then the question goes and focus moves to the table's target (R57). Actions with no request (closes, navigation Discard) settle at once. This is AssetSidebar's pattern today. It keeps focus off `<body>` while the triggers underneath stay natively `disabled={busy}`; no trigger changes.

  **Every settle in `finally` follows one order:** read R57's condition (is focus inside the question?) → `busy = false` → `settle()` → `tick()` → focus. The trigger and the table's targets are natively `disabled={busy}` until `busy` clears (for example #20's new bar). Where the question stands in place of its trigger (#8, #9, #20, #21), the trigger only renders again on the flush after `settle()`.

  **Actions whose row goes with the reload** (#3, #4, #5, #17, #18) settle on **success** before the reload instead. Focus then moves to an interim target that `busy` does not disable, with `{ preventScroll: true }`. The final targets after the reload are resolved by id before it (the table), and the final move uses no `preventScroll`. On **failure** the row survives, so the question stays busy through `catch`, including any reload there (`SequenceAccordion.svelte:116-118` for #3, `:159-161` for #4, `BlockAccordion.svelte:128-131` for #5), and settles in `finally` in the order above. Focus then goes to the trigger, enabled again. If the row is gone (a 404 race), R49's subject-gone dismissal is not blocked by `busy`. It fires during the reload in `catch` and takes the dismissal chain, and the `finally` settle is then a no-op. For #4 that chain starts with the `seq-<sid>-header` toggle (never disabled), because the item targets are `disabled={busy}` until `finally` (`ItemRow.svelte:67`, `SequenceAccordion.svelte:266`).

  **#3 and #5 navigate on success** (`SequenceAccordion.svelte:113`, `BlockAccordion.svelte:125`, a forced navigate). They settle and move focus before that navigate, so R49's dismissal finds the question closed. The move still obeys R57.

  `settle()` and `dismiss()` on a question that is closed, or whose host is gone, do nothing. Each question resolves exactly once, and there is no focus call after unmount.

  *Cost if wrong:* Cancel waits during a request.
- **R55 — DirtyGuard can withdraw the question.**
  - The owner's `ask` returns `{ promise, dismiss, focusCancel }`.
  - While a question is pending, a change of `currentRoute.path + currentRoute.search` (not the hash) calls `dismiss()`. The comparison is against the value captured when `ask` was called, so the effect's first run does not dismiss. This catches forced navigates, the 401 flow and stale-id fallbacks.
  - So does DirtyGuard's own teardown.
  - A dismissed question resolves `false`, so `onDiscard` never runs.

  *Cost if wrong:* a stale Discard drops work without navigating.
- **R56 — `ask` tells Cancel from a dismissal.** `InPlaceAsk.ask()` resolves `'confirm' | 'cancel' | 'dismissed'`. Refused, replaced, R55, the subject going and an unmount are all `'dismissed'`.
  - A site applies its "focus after Cancel" only on `'cancel'`.
  - On `'dismissed'` the helper alone decides focus:
    - replaced: the newcomer's `takeFocus`;
    - refused: `focusCancel()` on the open question;
    - subject gone or host unmounting: §Focus "After a dismissal".

  Without this, in Safari (where a click on row B's trash leaves focus in row A's question), row A's Cancel focus would run after row B's question took focus and pull focus back to row A.

  *Cost if wrong:* a three-way result instead of a boolean.
- **R57 — Focus moves after an answer only if the person has not moved it.** Every post-answer move applies only if focus is inside the question, on `<body>`, or nowhere: the Cancel target, the post-action target and the dismissal target alike. A site's second move (R54: from its interim target to the final one once `busy` clears) applies only if focus is still on the interim element the site itself focused, which it keeps a ref to, or on `<body>`. Otherwise focus is left where the person put it, as AssetSidebar's `refocusAfterDelete` (`AssetSidebar.svelte:130-133`) and DangerConfirm (`:57-59`) do today. A long request leaves time to Tab away or press Back.

  *Cost if wrong:* a stale question's target is not focused after the person moved on.

## Scope

In:
- the tokens, `ui/InlineConfirm`, `ui/DangerConfirm`, and `ui/Button`'s `danger` variant (Look);
- the 12 existing `InlineConfirm` uses and the 4 `DangerConfirm` uses (restyle, tone, labels);
- the two hand-rolled confirms, which become `InlineConfirm`: AssetSidebar's `.confirm-pair` (asset delete) and RunAssetsTab's replace confirm `.row-confirm`;
- the 21 `confirm()` call sites (inventory §1);
- `DirtyGuard`, `dirtyRegistry` and one router line (R47);
- a shared "ask in place" helper;
- the gate.

Not in:
- `IconButton`'s `danger` trash glyph keeps its shape; only its colour follows the token.
- `--status-rejected-*` (the status badges) stays as is.
- The error banners keep `--status-rejected-*` with their `--danger` rule: RunMiniProjectsTab `:393-395`, MiniProjectModal `:714-718`, DashboardSidePanel `:929-933`, NewRunModal, RosterImportModal, RunOverviewTab `.ov-err` and RunAssetsTab `.banner-error`. Where a banner shows beside the danger panel there are two pinks; aligning the banners with the panel tokens is a Polish 3 candidate.
- The Toast stays a red fill (`--danger` background, `--bg` text, 5.7:1).
- VersionsPage's create form: its Cancel button and in-app links discard silently today, and that stays. Only its Esc prompt is converted. Adding a guard there is a Polish 3 candidate.
- The global focus halo on other Button variants (`base.css:22-26`, 1.16:1) stays. Polish 2 takes it with the forced-colors ring, so for now the version bar mixes the strong ring (Delete) with the halo (the others).

## Look (Task 1)

### Tokens (`styles/theme-default.css`)
- `--danger: #C8102E`, plus a new `--danger-press: #A50D26` for the pressed fill and border.
- New `--primary-press: #2F465B`.
- `--danger-off-bg: #FFF7F8`, `--danger-off-border: #F4D2D8`, `--danger-off-text: #DFA3AE`. These are re-derived; they mark a disabled control, so they are exempt from contrast. The Safari pass checks that the unarmed label stays readable at 12px.
- New `--cancel-border: var(--focus-line-strong)`, `--cancel-hover: var(--focus-1)`, `--cancel-press: var(--focus-2)`.
- New `--danger-panel-bg: #FDF0F2` and `--danger-panel-fg: #7A1F2B` (D40). The panel's text is 9.2:1 on its background, `#C8102E` 5.3:1, `--text-2` 12.1:1.
- The `:root` hash in the gate (b4, `:537`) moves; its comment log records why.

### Shared button states (InlineConfirm, DangerConfirm, Button `.danger`)
Every rule below applies only to an enabled, idle control:
- Button: `:not(:disabled):not(.blocked):not([aria-busy="true"])`;
- InlineConfirm: `:not([aria-disabled="true"])`;
- DangerConfirm: `.dc-force.armed:not(:disabled)` and `.dc-cancel:not(:disabled)`.

Disabled, blocked and busy looks win in every state.

| state | red action | primary action | Cancel |
|---|---|---|---|
| rest | `--surface` background; `--danger` 1px border and text | the same with `--primary` | `--surface` background, `--cancel-border` border, `--text-3` text |
| `:hover` (only under `@media (hover: hover)`) | `--danger` background, `--primary-text` text | the same with `--primary` | `--cancel-hover` |
| `:focus-visible` (unconditional) | same as hover | same as hover | same as hover |
| `:active` | `--danger-press` background and border | `--primary-press` | `--cancel-press` |

- **Focus ring** (as in the mock-ups): every one of these buttons, armed or not, gets `:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }` in addition to the fill. The offset keeps the ring on the background. The global ring (`base.css:22-26`) is a 1.16:1 halo, and its border colour loses to these buttons' own border.
- **Busy (R54, 6b P23):**
  - The confirm keeps its rest look, shows a spinner and uses `cursor: progress`, with no fills. The spinner copies Button's scoped `.spinner` rule (`Button.svelte`) into InlineConfirm. The gate's colour and animation scans cover it.
  - Cancel takes Button's blocked look (`.btn.blocked` values, `Button.svelte:76-81`) with `cursor: not-allowed`, the same look as DangerConfirm's `.dc-cancel:disabled`.

### `ui/InlineConfirm`
- **New props:**
  - `tone?: 'danger' | 'primary'` (default `'danger'`).
  - `message?: Snippet`. TypeScript makes it mutually exclusive with `warning`. It renders inside the same `div.warning` with `id={warnId}`, so `aria-labelledby` keeps naming the group.
  - `layout?: 'row' | 'column'`. It replaces `row`, which stays as an alias for the 12 existing uses. Column puts the text above the buttons.
  - `busy?: boolean` (R54). It sets the busy look, `aria-disabled="true"` on both buttons with `title="Wait for the request to finish"`, and `aria-busy="true"` on the confirm. `onConfirm` and `onCancel` are not called, and Esc is ignored (DangerConfirm's rule, `DangerConfirm.svelte:69`). Focus stays (6b R20).
- **`confirmLabel` becomes required** (D35).
- **Naming:** with `label` set, the group is named by `label`. If a warning or message is present, it is the group's `aria-describedby` and also both buttons' `aria-describedby`, so a screen reader reads the consequence when focus lands on Cancel.
- **R50:** a pointer-click guard on both buttons.
- **On mount with `takeFocus`,** the group calls `scrollIntoView?.({ block: 'nearest' })` before focusing Cancel. This applies to the 12 Teaching confirms too (all use `takeFocus`). They are on screen when opened, so nothing moves.
- **Sizes:**
  - Buttons are 22px tall, `padding: 0 9px`, with 12px text, weight 500, 4px corners and a 6px gap.
  - Under `@media (pointer: coarse)` they get `min-height: 28px`.
  - A confirm row leaves at least 1px of clearance to other targets above and below.
- **`.warning`:** `--muted`, `12.5px` (was `0.85em`). `.warning :global(code)` takes DangerConfirm's code style, and `.warning :global(strong)` is `--text-2`, weight 600.
- **Class names stay:** `.inline-confirm`, `.row`, `button.confirm`, `button.cancel`. DashboardSidePanel:498 and MiniProjectModal:306 select them, and so do 40+ tests.

### `ui/DangerConfirm`
- **The panel (D40):** `--danger-panel-bg` background and `--danger-panel-fg` message text, with "I understand" in `--text-2`. The left rule stays `--danger`.
- **Buttons:** `.dc-force` and `.dc-cancel` take InlineConfirm's small button geometry and the shared states.
- **Unarmed `.dc-force`** (enabled, `aria-disabled`) and natively disabled: the `--danger-off-*` family, `cursor: not-allowed`, no fill on hover or focus. It keeps the focus ring.
- **Armed and busy:** the red action's rest look with the spinner, no fills (6b P23).
- **Rename:** the local function `confirm()` (`:44`, `:90`) becomes `force()`, so the gate's "no `confirm(`" check needs no exclusion.

### `ui/Button` `danger` variant
- `.danger` follows the shared red action states at page size (`--btn-pad`, 13px). Its resting background is `--surface`. A busy `.danger` keeps the rest look with its spinner.
- `.danger-off` has no consumer (inventory §4.3); it stays for its test.

### Tone and labels of the existing confirms
| place | label (old → new) | tone |
|---|---|---|
| RunTeachersTab:120 remove teacher | Confirm Remove → Remove | danger |
| RunGroupsTab:182 delete group | Confirm Delete → Delete | danger |
| RunListPage:161 delete run | Confirm Delete → Delete | danger |
| RunAssetsTab:713 bulk delete | Confirm → Delete | danger |
| RunAssetsTab:814 delete asset | Confirm → Delete | danger |
| RunAssetsTab replace (`.row-confirm`, :823-835) | Confirm → Replace. Becomes InlineConfirm with `message` and `label="Replace {filename}?"`. Cancel keeps its first focus; Esc works as today. | danger |
| AssetSidebar `.confirm-pair` (:311-329) | Confirm → Delete. Becomes InlineConfirm with `label="Delete {filename}?"` and `busy={deletingIds.has(a.id)}`, inside a wrapper element that stops click propagation. When the sidebar's `disabled` prop turns true while the question is open and idle, the question is dismissed (nothing is deleted). A busy question (its DELETE in flight) stays until it settles. `refocusAfterDelete` then runs as today, except that its last fallback is the drop zone only when that is enabled, else the panel below. Its trash and row are natively disabled then (`AssetSidebar.svelte:289, :338`). The drop zone (`:349-359`, a `div role="button" tabindex="0"`) gets `aria-disabled={disabled || uploading}` and counts as disabled. It also gets a `title` naming the reason:
  - "Wait for the upload to finish" while uploading;
  - else the new optional prop `disabledReason`. MarkdownEditor passes `FORBIDDEN_TITLE` when it is `disabled` (read-only) and `WAIT_TITLE` when it is `frozen` (a save), both from `quizEdits.svelte.ts`. The modal's × may be disabled too (`ItemEditorModal.svelte:338`, the level-3 `closeDisabled={saving}`). Focus therefore takes the dismissal chain: the first connected, enabled, not-inert target, ending at `asideEl.closest('section.modal-panel')` (as `Modal.svelte:75-81` does). In a standalone mount there is no panel, and focus is left alone. Esc keeps `preventDefault` (Modal checks `defaultPrevented`, :93-95). After Cancel, focus goes to the trash (`trashEls`); after Delete, `refocusAfterDelete` as today. Behaviour change: Cancel waits during the request too (R54). | danger |
| RunOverviewTab:348 Unpublish | Unpublish | primary |
| MiniProjectModal:495 Publish | Publish | primary |
| RunMiniProjectsTab:339, RunRosterTab:695 / :852, DashboardSidePanel:654, MiniProjectModal:485 | unchanged (Delete, Remove, Discard) | danger |

## Ask in place (Task 2)

### The helper (`lib/askInPlace.svelte.ts`)
```ts
export type Ask = {                 // field names match InlineConfirm's props
  warning?: string | (() => string);// a getter keeps an `unsavedSuffix` current while open
  message?: Snippet;                // instead of warning
  label?: string;
  confirmLabel: string;
  tone: 'danger' | 'primary';
  layout?: 'row' | 'column';
  confirmDataAction: string;        // test hook, e.g. 'confirm-delete-block'
  key?: string | number;            // which row of a list asks
};
export class InPlaceAsk {
  current = $state<Ask | null>(null);
  busy = $state(false);
  host: HTMLElement | null = null;  // bound late by the host; focusCancel queries `.inline-confirm button.cancel` in it
  get open(): boolean;
  ask(q: Ask): Promise<Answer>;     // type Answer = 'confirm' | 'cancel' | 'dismissed' (R56)
  answer(a: 'confirm' | 'cancel'): void; // confirm: resolves, sets busy, focuses the confirm (R54); cancel: resolves and closes
  settle(): void;                   // closes a confirmed question; a no-op when closed or the host is gone
  dismiss(): void;                  // resolves 'dismissed' and closes; a no-op when closed
  focusCancel(): void;
}
```
- R53 governs a newcomer. Joining a navigation question is DirtyGuard's job (its `pending`), not the helper's. A host renders the question where it belongs (under the row whose `key` matches, for lists), leaving `key` out of the spread:

  ```svelte
  {#if a.current}
    {@const { key, warning, ...q } = a.current}
    <InlineConfirm {...q}
      warning={typeof warning === 'function' ? warning() : warning}
      busy={a.busy} takeFocus
      onConfirm={() => a.answer('confirm')}
      onCancel={() => a.answer('cancel')} />
  {/if}
  ```

- Every question is resolved exactly once. A host that unmounts or drops the question calls `dismiss()`: from a component's `$effect` teardown, and for the quiz edits from `attach()`'s cleanup (`quizEdits.svelte.ts:145-148`), which every close path reaches.

### Focus
- **On open:** the question's Cancel, after `scrollIntoView?.({ block: 'nearest' })`.
- **A host that takes over an open question** (R46 hand-over on unmount) mounts a fresh InlineConfirm whose `takeFocus` focuses its Cancel. The host is already mounted, so FocusTrap's one-time autofocus (`FocusTrap.svelte:47-67`) has run already. Since the settings button is frozen (R48), no modal can mount while the page row asks.
- **A focus target counts** only if it is connected, not disabled (natively or `aria-disabled`) and not inert. Otherwise the site takes the next one in its chain.
- **Esc** on either button means Cancel, and it does not reach an enclosing modal.
- **While the action runs:** the question's confirm, busy (R54).
- **Every move below obeys R57** (only if focus is inside the question, on `<body>`, or nowhere) and R56 (Cancel targets only on `'cancel'`).
- **After the answer:** the host waits `tick()` and focuses by **identity**: the re-rendered target through its `bind:this` ref or `data-action`, not an element recorded before the question replaced it, because that element is gone. In Safari a mouse click does not focus the button, so the table's targets never depend on `document.activeElement`. The exception is the page row's Cancel, which uses the saved element only when there is one.
- **After a dismissal** (R49, R55, a host unmounting): if focus was inside the question, it goes to the table's Cancel target when that is connected, else to the site's post-action fallback (the 6a row chain). A dismissal by navigation leaves focus to the route's own target.
- **Never `<body>`** within a page. Across pages (for example Back from the version page to the versions list), the destination's own load focus applies.

### The router and `DirtyGuard` (D37, R47, R55)
- **`DirtyGuard`** gets a required prop `ask: () => { promise: Promise<boolean>; dismiss: () => void; focusCancel: () => void }` and keeps one `pending`.
  - While `pending` is set, every guard call returns its promise. No second question appears and `onDiscard` is not repeated. The joining call calls `pending.focusCancel()`, which focuses the open question's Cancel and scrolls it into view.
  - The owner maps its question's answer to the boolean: `'confirm'` → `true`, else `false`.
  - When the promise resolves `true`, `onDiscard` runs once and `pending` clears.
  - R55's dismissals apply.
  - `beforeunload` is unchanged.
- **One router change:** in `navigate()` (`lib/router.svelte.ts:105-109`), `const myGen = ++navGen` moves below the same-target return. Without the move, a navigate to the current address while a question is open would make a later Discard drop the work and stay put. A hash-only navigate is not guarded; no editor control issues one.
- **Router tests:**
  - a double click on a guarded link + Discard navigates once;
  - Back twice + Discard lands on the second target;
  - Back + Cancel restores the address once;
  - link then Back + Discard lands on the link's target;
  - a navigate to the current address while asking leaves the pending navigation intact;
  - a forced navigate while asking dismisses the question, a later click finds nothing, and the drafts survive.
- **The address bar** already shows the target during the wait on Back. On Cancel it comes back.

### Owners
- **DashboardSidePanel:**
  - `ask` opens its rev 8 question with a third source `'nav'` (`DISCARD_CONTINUE`). `dismiss` closes it.
  - Discard resolves the navigation and ends the edit as `'cancel'` does (`editing = false; resetForm()`).
  - When the form goes while asking (`:307-309`), the question is dismissed.
  - A guard while its `'cancel'` or `'close'` question is open refuses (R53).
- **MiniProjectModal:**
  - `ask` opens its footer question with `DISCARD_CONTINUE` and a navigation continuation: Discard resolves `true`, and the navigation unmounts the modal.
  - A guard while its publish question or its `pendingClose` (×) question is open refuses (R53).
- **VersionEditPage (D38, R46):**
  - **The page question:** VersionEditPage owns one page `InPlaceAsk` (`pageAsk`, text `DISCARD_CONTINUE`). It provides it by context (`setContext`), with a host stack.
  - **The tree's question:** VersionEditPage also provides `treeAsk` (R53), keyed by node id, for #3, #4 and #5.
  - **Host registration:** each modal that can host the page question registers an entry `{ ownOpen(): boolean; focusOwnCancel(): void }` while mounted. This covers ItemEditorModal, VersionSettingsModal, NewItemModal and the three level-3 quiz modals. All of them mount inside VersionEditPage's tree, with no portal. Entries are added on mount and removed by identity, not `pop()`: ItemEditorModal is keyed (`:602`).
  - **Where it draws:** the last entry draws `{#if pageAsk.current}` in its footer in place of its buttons, or in its body-top row when it has no footer. With no entry, the `.page-ask` row under the `<h1>` draws it, scrolled into view. No modal is open then, so there is no scroll lock. `.page-ask` has `scroll-margin-top: 4.5rem`, so the Toaster (`components/chrome/Toaster.svelte:13-17`, fixed top right) does not cover it.
  - **Freezing and hand-over:** the page row freezes the page (R48), including the settings button, so no modal can open under it. A host that unmounts while asking hands the question to the next host. VersionEditPage's teardown dismisses `pageAsk`.
  - **Discard:** the guard's `onDiscard` (`dirtyRegistry.discardAll()`) runs and drops every dirty tracker, the hosting modal included. The Discard schedules one check in a `setTimeout(…, 0)`, which does nothing if the page has unmounted (`alive`, `VersionEditPage.svelte:225-226`). By then the router has committed (it resumes in microtasks after the answer) and Svelte has flushed. If focus is then on `<body>`, the check focuses the route's deepest header, else the `<h1>` course link. It runs once, whether or not the route changed.
  - **Page-row Cancel:**
    - On open, the page saves the element that had focus when the guard ran and `window.scrollY`, before `scrollIntoView`.
    - On Cancel, after `tick()` (the tree thaws), focus goes to the saved element if it is connected and is not `<body>`. That is the keyboard-activated header or link, or the dirty field after ⌘[.
    - Without one (a mouse click in Safari focuses nothing), the page calls `scrollTo({ top: savedY })` and focuses the `<h1>` course link with `{ preventScroll: true }`. The view returns to where the person clicked.
- **Standalone mounts** (tests, any page without the context) get no host stack. The component falls back to its own footer question for its own close and has no page question.

### The item modal's × while the page question is open
- `requestCloseItem` (`VersionEditPage.svelte:246-255`) does not call `history.back()` or `navigate()` while `pageAsk.open`. It focuses the question's Cancel, as MiniProjectModal `:305-308` and DashboardSidePanel `:496-499` do.
- `closing` re-arms when the page question settles, on either answer, if `routeIid` is unchanged after `tick()`. It does not re-arm in the bare `popstate` listener (`:233-237`), which with an async guard would fire while the question is open.

### `quizEdits` (D10) becomes async
- **The handle:** `EditHandle` (`quizEdits.svelte.ts:17-23`) gains `ask?(q: Ask): Promise<Answer>`.
  - `InlineEdit` implements it with its own `asking: InPlaceAsk`, unless `InlineOptions.asking` passes one in.
  - The quiz title edit passes ItemEditorModal's `bodyAsk`.
  - The level-3 handles leave it undefined. They are modal on top, so no `request()` can come from beneath them.
- **`request(id?)`:**
  - nothing open, or the caller's own id → `true`;
  - saving → `false`;
  - dirty → `await a.ask({ warning: DISCARD_CONTINUE, … })`; without `ask` → `false`.
  - After the await, it returns `true` only on `'confirm'`, and only if `this.active === a` and `!a.saving`. Then it calls `#drop(a)` and settles the question.
  - On `'cancel'`, the dirty edit stays open, and focus goes back to its field (no longer readonly). The question replaced only that edit's ✓/✕ or message slot, so the kept work is where the person looks. No caller passes a trigger.
- **`requestStructure()`** returns `true` if the active edit is saving, before or after the await.
- **While an `InlineEdit` asks:**
  - its fields are `readonly` (both of KeyAnswer's Number inputs, `:138`, `:146`);
  - Enter, ✓ and ✕ only focus the question's Cancel;
  - `attach()`'s cleanup dismisses `asking`.
- **`commit()`:** `InlineOptions.confirmSend` is replaced by `confirm?: () => Ask | null`. `commit()` asks after its checks. After the await it returns unless `#alive && canSave && !saving`, then re-runs `unchanged` / `check` before sending.
- **The callers:** all 12 (inventory 1.B) become `if (!(await x.request())) return;` and then apply R49. Tests that click ✎ or "+ Add answer" now await a microtask before asserting.
- **Where an `InlineEdit` host draws its question:** a `row` question in place of ✓/✕, a `column` question in the message slot (`InlineInput.svelte:51-55`, `KeyAnswer.svelte:156`). The hosts are `InlineInput` (text fields), `KeyAnswer`'s Number edit (`div.key-edit`), and `ChoiceAnswers`' answer edit and "+ Add answer". The quiz title (a raw input in ItemEditorModal's header, `:270-296`) has no room there, so its question appears in the body-top row through `bodyAsk`.
- **Two questions in a row stay in a row,** in today's order: the D10 discard first, at the dirty edit; on Discard, the second (the delete or the key question) at its own place. Cancel at either sends nothing.

### ItemEditorModal's body-top row
- **The row:** one `InPlaceAsk` (`bodyAsk`), drawn as a row at the top of `.modal-body`. It is shared by #19 (delete item) and the quiz title's D10 question. When this modal is the top host without a footer, the page question is drawn there instead; R53 keeps them apart.
- **Freezing:** a wrapper around the body's other children (`display: contents`, `inert` set by `toggleAttribute`, since jsdom lacks the property) is inert while the row asks or the item is deleting (`deleting || bodyAsk.open`). ItemEditorModal no longer passes `bodyInert` (`:339`), so the row itself stays live and its busy confirm keeps focus. While the row asks, the header trash and the title's ✎ (`:291-294`) are `aria-disabled` with `title="Answer the question first"`.
- **#19 settles on the delete:** `onDeleteItem` becomes `() => Promise<void>` (`ItemEditorModal.svelte:41`; the page passes `deleteOpenItem`, `VersionEditPage.svelte:614`), and ItemEditorModal awaits it and settles `bodyAsk` in `finally`. `deleteOpenItem`'s early return (`:260`) resolves at once, so the question cannot stay busy. On success the modal unmounts. On failure focus goes to the trash (today's refocus effect, `ItemEditorModal.svelte:250-263`).

## Every converted call site (Tasks 2–6)

Texts are today's unless a column says otherwise. `unsavedSuffix()` stays where it is used, as a getter (R49). While any action runs, focus is on the question's busy confirm (R54); the last column is where focus goes once it settles.

| # | site | where the question appears | label / tone | focus after Cancel | focus after the action settles |
|---|---|---|---|---|---|
| 1 | DirtyGuard (link, Back) | per owner (above) | Discard / danger (`DISCARD_CONTINUE`) | page row: the saved element, else the saved scroll position + the `<h1>` course link (above). Modal host: its ×. Drawer / mini-project: as today (rev 8, `cancelClose`) | the navigation's own target. In-page: VersionEditPage's focus effect, then the one-shot `<body>` rescue above |
| 2 | ChoiceAnswers.mark, published | a line under the answer list, column layout (R52) | Change key / primary | the marker | the marker. Unpublished (no key question) after a D10 Discard: the marker is focused before `act()` |
| 3 | SequenceAccordion.deleteSeq | a confirm row under the sequence header, inside `div.seq-card` | Delete / danger | the trash (AccordionHeader's trash gets `data-action="delete-sequence"` / `"delete-block"`) | as today (the block header) |
| 4 | SequenceAccordion.deleteItem | a confirm row under the item row, inside its `<li>` | Delete / danger | the trash | while the reload runs: `seq-<sid>-header` (R54). Once `busy` clears: the next item's `item-<id>-open`, else the previous, else "+ Add item", all resolved by id before the reload |
| 5 | BlockAccordion.deleteBlock | a confirm row under the block header, inside `div.block-card` | Delete / danger | the trash (`delete-block`) | the next block's header, else the previous, else the `<h1>` course link, all resolved before the reload and focused when the DELETE succeeds (R54). Block headers are never disabled (`AccordionHeader.svelte:164-171`). If no block is left, "+ Add block" once `busy` clears |
| 6 | KeyAnswer commit, published | a line under the key field (its message slot), column layout (R52) | Change key / primary | the key input | as today (`refocusPencil`); after a failed save, the key input (the edit stays open with its error) |
| 7 | ExplanationModal close, dirty | in place of the footer buttons | Discard / danger | the close control that asked (× or the footer's Cancel; Esc counts as ×) | as today (`closeL3`) |
| 8 | ExplanationModal remove | in place of the footer buttons | Remove / danger | "Remove explanation" | after a failure: "Remove explanation"; after success: as today. `send()` is shared by Save and Remove (`ExplanationModal.svelte:48-65`); only the remove path settles the question |
| 9 | AppBody.removeApp | in place of `.script-row`'s Replace/Remove | Remove / danger | "Remove" | the Upload button (the former Replace, `:166-168`) |
| 10 | VersionSettingsModal close, dirty | in place of the footer's Discard/Save | Discard / danger | the close control that asked | as today (the settings button) |
| 11 | NewItemModal close, dirty | in place of the footer's Cancel/Create | Discard / danger | the close control that asked | as today ("+ Add item") |
| 12 | QuizBody.remove | a confirm row under the card's `.qhead`, passed into QuestionCard | Delete / danger | the card's trash | `focusFallback` as today |
| 13 | NewQuestionModal close, dirty | in place of the footer buttons | Discard / danger | the close control that asked | as today |
| 14 | quizEdits.request (D10) | at the dirty edit (above) | Discard / danger (`DISCARD_CONTINUE`) | the dirty edit's field (it stays open) | the caller's action proceeds |
| 15 | QuestionTextModal close, dirty | in place of the footer buttons | Discard / danger | the close control that asked | as today |
| 16 | VersionsPage Esc in the create form | in place of the form's Cancel/Create (`div.submit`) | Discard / danger | the field where Esc was pressed | as today ("+ Add version") |
| 17 | VersionsPage enable/disable | a confirm row (`li.ask-row`) under the version row, above an open `li.dup-row` (frozen while asking) | Enable or Disable / primary | the trigger | after success, while the reload runs (`load()` shows a Skeleton for the whole list, `VersionsPage.svelte:215-216`): the page's `<h1>` (R54). Once `busy` clears: the swapped button in the same slot, found by version id. After a failure (no reload): the trigger, once `busy` clears |
| 18 | VersionsPage delete draft | a confirm row under the version row | Delete / danger | the trash | after success, while the reload runs: the page's `<h1>` (`VersionsPage.svelte:210`; it gets `tabindex="-1"`) (R54). After a failure: the trash, once `busy` clears. After success, once `busy` clears: the next row's first control, else the previous, else "+ Add version", resolved by version id before the reload |
| 19 | delete item (item modal trash) | ItemEditorModal's body-top row. ItemEditorModal asks (it has `item.title`), re-checks `trashDisabled` after the await, then calls `onDeleteItem`; `VersionEditPage.deleteOpenItem` (`:261`) drops its `confirm` | Delete / danger | the trash | as today (`seq-<sid>-header`) |
| 20 | VersionEditPage publish / archive / revert / disable / enable | in place of the whole bottom bar (`div.state-actions`). `vid` is captured before asking (R49). The question is dismissed on a version switch by an `$effect` like `settingsOpen`'s (`VersionEditPage.svelte:339-342`); a dismissal while busy closes it | the verb / primary | the trigger | the first button of the new bar, else the `<h1>` course link |
| 21 | VersionEditPage delete version | in place of the whole bottom bar | Delete / danger | the trigger | as today (navigates away) |

- **"The close control that asked":** the handler that ran records it.
- **The R10 focus rescues** in #7, #8, #13 and #15 (ExplanationModal :83-94, NewQuestionModal :95-106, QuestionTextModal :73-84) look for the footer's "Cancel" by text. In preview mode the question's Cancel matches. Otherwise they prefer the textarea, which is inert while the question shows; that is harmless, because the question's own focus wins.
- **Confirm rows inside `.seq-card` and `.block-card`** (`overflow: hidden`, `SequenceAccordion.svelte:287`, `BlockAccordion.svelte:371`) sit in a wrapper with at least 5px of padding, so the focus ring is not clipped.

## Code changes

- `styles/theme-default.css`: the tokens.
- `components/ui/InlineConfirm.svelte`, `DangerConfirm.svelte`, `Button.svelte`.
- New `lib/askInPlace.svelte.ts`.
- `lib/editorReasons.ts`: the two discard texts, and the comment at `:41` reworded.
- `lib/dirtyRegistry.svelte.ts`: the comment at `:15` reworded; no API change (`discardAll` is the page's `onDiscard`).
- `lib/quizEdits.svelte.ts`: async `request`, `EditHandle.ask`, `InlineEdit.asking`, `InlineOptions.asking` and `confirm`.
- `lib/router.svelte.ts`: one line (R47).
- `components/editor/DirtyGuard.svelte`: `ask`, `pending`, R55.
- **Task 1 label and tone files** (they need `confirmLabel` once it is required): `components/runs/{RunTeachersTab,RunGroupsTab,RunOverviewTab,RunMiniProjectsTab,RunRosterTab,RunAssetsTab,DashboardSidePanel,MiniProjectModal}.svelte`, `pages/runs/RunListPage.svelte`, `components/editor/AssetSidebar.svelte`, and `components/editor/MarkdownEditor.svelte` (it passes AssetSidebar's `disabledReason`).
- **Owners and hosts:**
  - `pages/editor/VersionEditPage.svelte`: `pageAsk`, `treeAsk`, the host stack, the title row, the × rule, #19's `onDeleteItem`, #20, #21;
  - `components/editor/ItemEditorModal.svelte`: the header title, the body-top row and wrapper, host registration, #19;
  - `components/editor/{VersionSettingsModal,NewItemModal}.svelte`: #10, #11, footer-less hosting, host registration;
  - `components/editor/quiz/{ExplanationModal,NewQuestionModal,QuestionTextModal}.svelte`: #7, #8, #13, #15, host registration;
  - `components/runs/{DashboardSidePanel,MiniProjectModal}.svelte`: the `ask` for DirtyGuard.
- **Sites:**
  - `components/editor/{BlockAccordion,SequenceAccordion,ItemRow,AccordionHeader}.svelte`: #3, #4, #5 (the trash `data-action`s, the padded wrapper);
  - `pages/editor/VersionsPage.svelte`: #16, #17, #18, the `<h1>` `tabindex="-1"`;
  - `components/editor/quiz/{QuizBody,QuestionCard,KeyAnswer,ChoiceAnswers,ChoiceRow,InlineInput}.svelte`: #2, #6, #12, #14 and the 12 `request()` callers;
  - `components/editor/item/AppBody.svelte`: #9.
- `frontend/scripts/visual-refresh-gate.sh`: the gate changes below.
- No backend change.

## Process

Seven tasks (D41). Each one runs: TDD → full checks → screenshots → the user's OK → Opus + Fable reviews of the uncommitted diff until clean → commit → wait for "go".
1. **The look.**
   - Tokens; InlineConfirm (tone, size, states, the required label, `message`, `layout`, `busy`, R50, button `aria-describedby`); DangerConfirm and its panel (D40); Button danger.
   - The existing confirms' tones and labels, and the two hand-rolled confirms.
   - Screenshots: every Teaching confirm (6a/6b/6c), the danger panel unticked, ticked and busy, and the authoring `Button danger` uses (VersionEditPage Delete, ExplanationModal "Remove explanation", RunAssetsTab "Delete N selected"), one of them Tab-focused.
2. **Ask in place, links and modal footers.**
   - The helper and the two discard texts; DirtyGuard `ask`, `pending` and R55, the router line and its tests.
   - The owners: DashboardSidePanel, MiniProjectModal, VersionEditPage's title row and host stack. (`treeAsk` comes with Task 3.)
   - Every question in the editor modal footers: #7, #8, #10, #11, #13, #15. Also the item modal's body-top row (with #19's place, and #19 itself) and the × rule.
   - After this task no modal footer holds both an in-place question and a `confirm()`.
3. **Course tree deletes:** `treeAsk`, #3, #4, #5.
4. **Versions:** #16, #17, #18, #20, #21.
5. **The quiz edit slot:** async `request` and `confirm` (#14, #6, #2), and the quiz title's D10 question.
6. **App and quiz-question removals:** #9, #12.
7. **No pop-ups left:** the gate check, clean-up, full checks.

Then a whole-branch review (fresh Opus + Fable) and a Safari pass, one step at a time.

## Testing

- **Every converted site** gets component tests (mount / flushSync) for:
  - the question appears in its place with its text, label and tone;
  - Cancel sends nothing and focuses the table's target;
  - the action runs once, and focus is on the busy confirm while it runs (never `<body>`), then on the table's target;
  - Esc cancels, and is ignored while busy;
  - a second trigger while asking only refocuses (same key) or moves the question (another row, D39). With focus on A's Cancel, a click on B's trash leaves focus on B's Cancel after `tick()` (R56);
  - focus moved elsewhere during a busy request stays there when it settles (R57);
  - the subject changing while asking dismisses the question and focus lands on the Cancel target (R49);
  - the form is inert while asking (R48).
- **InlineConfirm:**
  - a click with `detail: 2` right after mount is ignored, while `el.click()` (`detail: 0`) and keyboard activation are not (R50);
  - `busy` blocks both buttons and Esc;
  - with `label` and a warning, `button.cancel` has `aria-describedby` pointing at `.warning`.
- **The 60 `window.confirm` spies** in 14 files (inventory §3.1) are rewritten to answer the in-place question, and their assertions on the prompt text move to the question's text. Tests that click two actions back to back (VersionEditPage `:473`, VersionsPage.slots `:381`) are rewritten for one question at a time.
- **Label and class pins:**
  - RunListPage `Confirm Delete`;
  - RunAssetsTab's 41 `/^Confirm$/` lookups and the `.row-confirm` / `.rc-confirm` / `.rc-cancel` selectors (`:2489`, `:2491`);
  - InlineConfirm's tests that mount without `confirmLabel` (svelte-check fails on them once it is required);
  - VersionEditPage's state-bar `[label, variant]` pins (`:433-450`);
  - AssetSidebar's 12 `data-testid="delete-confirm|delete-cancel"` lines (`AssetSidebar.svelte.test.ts:376-480`, `:554-596`, `AssetSidebar.run-mode.svelte.test.ts:241`), rewritten to the row's `button.confirm` / `button.cancel`. The `confirm.disabled` assertion (`:406-428`) becomes `aria-disabled`.
  - KeyAnswer `:163` (focus is never on a disabled ✓).
- **Helpers and the router:**
  - `askInPlace` unit tests: R53's newcomer rules, the three answers (R56), `busy`/`settle`, `dismiss`, and `settle`/`dismiss` after close as no-ops;
  - `DirtyGuard` tests for `ask`, `pending`, R55 (forced route, teardown, no dismissal on the first run) and the joining `focusCancel`;
  - the router tests named above.
- **`quizEdits.test.ts`:**
  - async `request` and the question on the active edit;
  - a saving edit is never closed (`:57`), including when it starts saving while asking;
  - `requestStructure` while saving;
  - ✕ on the readonly field while asking only focuses Cancel;
  - Cancel on the D10 question returns focus to the dirty edit's field;
  - tests that click ✎ or "+ Add answer" await a microtask.
- **The host stack:**
  - a dirty level-3 modal + Back asks in that modal's footer, with focus on its Cancel;
  - a dirty Explanation modal with its close question open + Back is refused, the address is restored and focus goes to the close question's Cancel (R53);
  - #19 asking + Back is refused the same way;
  - the item modal's × while asking does not navigate twice, and × works again after Cancel;
  - a read-only Version settings + Back asks at the top of its body;
  - the page row: Enter on a block header with a dirty rename elsewhere → Cancel → focus on that header; a mouse-style trigger (nothing focused) → Cancel → `scrollTo` with the saved position and focus on the `<h1>` course link; Discard at the version root → focus not on `<body>`; the tree is inert and the settings button `aria-disabled` while asking;
  - #19 with the DELETE held: focus on the busy confirm; on failure the trash;
  - #3, #4, #5, #17, #18 with the reload held: focus is never `<body>`, and it reaches the final target once `busy` clears. With the request held and failing: focus stays on the busy confirm, then goes to the trigger;
  - AssetSidebar turning `disabled` while asking (idle): the question closes and focus goes to the panel. The test wraps the sidebar in `<section class="modal-panel" tabindex="-1">`. While busy, the question stays, and after it settles focus goes to the panel, not `<body>`;
  - #20 success: focus on the first button of the re-rendered bar; #8 failure: focus on the re-rendered "Remove explanation" (never `<body>`);
  - the tree with block 1, sequence 1 and item 1: one question shows, under the right node, and D39 moves it between them;
  - a tree question is dismissed when its node leaves `open-focus`.
- **Inert pins to update:** `ItemEditorModal.svelte.test.ts:303-308` (`bodyInert` → the wrapper) and `VersionEditPage.svelte.test.ts:843`, `:873`, `:891`.
- **The Discard rescue:** with fake timers, the single check runs once after the answer and not on a later navigation.
- **Standalone mounts** of ItemEditorModal, VersionSettingsModal, NewItemModal, BlockAccordion and SequenceAccordion keep working without the page context.
- **jsdom:** `scrollIntoView` is called optionally (`?.`), because jsdom lacks it.

## Gate

By task (the plan's ladder sets `EXPECTED_CHECKS` per task):

- **Task 1:**
  - the `:root` hash (b4 `:537`);
  - new pins for the shared button states per component: size; the `:not(:disabled)`, `:not(.blocked)`, `:not([aria-busy="true"])` and `:not([aria-disabled="true"])` guards on every hover, focus-visible and active rule; the focus ring; `:hover` alone under `@media (hover: hover)`;
  - the new tokens' use;
  - the DangerConfirm `.dc-force` pins (`:4734-4736`) follow the new rules;
  - "RunAssetsTab uses … InlineConfirm" (`:4761-4766`) still holds.
- **Task 2:**
  - "DISCARD_PROMPT equals the DirtyGuard prompt" (`:4524-4528`) becomes "the discard texts appear only in `editorReasons.ts`": there is no literal `Discard unsaved changes` in `src` outside it and tests (the `dirtyRegistry.svelte.ts:15` comment is reworded);
  - "5d components use the quizEdits texts, not copies" (`:4519-4523`) greps the new wording;
  - the colour and emoji scans add `lib/askInPlace.svelte.ts`, `lib/editorReasons.ts` and `DirtyGuard.svelte`.
- **Task 3:** BlockAccordion and SequenceAccordion may not author `.row` or `.danger` rules (`:3890`) or side borders outside `.seq-card` (`:3936`). Their confirm rows use InlineConfirm's own classes inside the new padded wrapper, which has no border.
- **Task 4:** "VersionEditPage Delete uses Button variant=danger" (`:3841-3846`) is re-pinned to the new line.
- **Task 7:** a new check that there is no `confirm(` call anywhere in `frontend/src` outside tests:

  ```sh
  grep -rnE '(^|[^.[:alnum:]_])confirm[[:space:]]*\(|(window|globalThis)\.confirm' src --include='*.svelte' --include='*.ts' --exclude-dir=tests --exclude='*.test.ts'
  ```

  It must find nothing. DangerConfirm's function is renamed and the `editorReasons.ts` comment reworded, so there are no exclusions.

## Carried to the Safari pass

- **The look:**
  - hover and focus fills and the focus ring in Safari, including in a modal footer (a mouse click shows no ring; Tab skips buttons by default);
  - the danger panel's new colours, and that the unarmed Force delete's label is readable at 12px.
- **Back with unsaved work:**
  - the address bar shows the target while the question is open, and comes back on Cancel;
  - Back twice while asking, and a link then Back while asking (the history is `[…, Back's target, the link]`);
  - a dirty New question modal + Back: the question in that modal's footer.
- **The item modal and quiz edits:**
  - the item modal's × on an in-page item with a dirty quiz edit, and × again while asking;
  - scroll-into-view of a question in another quiz card.
- **The page row:**
  - Cancel brings you back to where you were (keyboard);
  - a toast does not cover it;
  - the settings button is blocked while it asks;
  - after a mouse click on a header, Cancel scrolls back to where you were.
- **Clicks:**
  - a double-click on a trigger whose question appears under the pointer;
  - a click on another row's trash moves the question (D39).
