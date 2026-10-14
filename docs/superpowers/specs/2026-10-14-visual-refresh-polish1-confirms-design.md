# Visual refresh — Polish 1: one confirm style

**Status:** draft rev 2 (2026-10-14), for review.
- Rev 2 folds in round 1 (Opus on the code, Opus on the design, Fable; notes in `.superpowers/sdd/2026-10-14-visual-refresh-polish1-confirms/spec-r1-*.md`): the top-most host for the page question, a second navigation while a question is open, the question's content on the ask, re-checks after every await, freezing while asking, a focus table with Cancel targets, the focus ring, disabled-state guards, AssetSidebar's busy confirm, the task order, and the gate.

**Branch:** `feat/visual-refresh-polish1-confirms`, cut from the 6c tip (`7e02f70`). It stays local: no push, no merge.

**Authority:**
- The user's decisions in the 2026-10-14 brainstorm (D30–D38 below). Mock-ups: `.superpowers/sdd/2026-10-14-visual-refresh-polish1-confirms/{q1-style,q2-red,q4-danger,s1-look,s2-how,s3-tasks}.html`. The factual base is `inventory.md` in the same folder (every call site, test and gate pin at `7e02f70`).
- The design handoff `docs/design/visual-refresh/` holds where this spec is silent, with one deliberate change: the handoff's "danger is a text treatment, never a red fill" rule is replaced by D31.
- The 6a, 6b and 6c specs hold where this spec is silent: 6a §Focus (focus never drops to `<body>`; a row action's fallback chain), 6b R19 (freeze during a request), 6b R20 (a busy button keeps focus), 6c R44 (busy controls are `aria-disabled`, not natively disabled), 6c rev 8 (the discard question replaces the form's button row and freezes the rest). So do the earlier slices' rules: tokens only, no literal colours, no emoji, every disabled control names its reason in `title`.
- `file:line` references are to the code at `7e02f70`.

## Why

The Teaching screens confirm in place (`InlineConfirm`, `DangerConfirm`). Their buttons are bare text, so in the 6c Safari pass the user missed a confirm at the drawer's edge and asked for "real but small buttons, red for the action, grey for Cancel", and a better red ("like crimson") for every danger button and error. The authoring screens still use the browser's `confirm()` pop-up in 21 places. The user ruled in the 6a Safari pass that there must be one way to confirm, in place, everywhere.

## Decisions

The user's (2026-10-14), continuing the Slice-6 numbering:
- **D30 — Polish is three slices.** This one (confirms) first; Polish 2 takes the items sent "to the end" (forced-colors focus ring, reduced motion, page background, h4–h6/blockquote, the Not-found page check, bare URLs); Polish 3 triages the reviewers' deferred minors by group.
- **D31 — Outlined at rest, filled on hover or keyboard focus.** Every confirm action, every danger button and the armed Force delete: a white background, a 1px outline and coloured text at rest; on hover and on `:focus-visible` the fill is the colour and the text white; while pressed a darker step. Cancel: a grey outline, a light-grey fill on hover and focus.
- **D32 — The red is `#C8102E`.** `--danger` changes from `#991B1B` (8.3:1 on white) to `#C8102E` (5.9:1 on white, 4.6:1 on the darkest page shade `--focus-2`). The muted "unarmed" reds `--danger-off-*` are re-derived from it. Error text and error borders follow, because they already use `--danger`.
- **D33 — Red only when something is lost.** Delete, Remove, Discard, Force delete and Replace (the old file is overwritten) are red. Publish, Unpublish, Enable, Disable, Archive, Revert and the answer-key warning are steel blue (`--primary`).
- **D34 — One rule everywhere.** Page danger buttons (`Button variant="danger"`) follow D31 at page size. Confirm buttons (`InlineConfirm`, `DangerConfirm`) are small: 22px tall, 12px text. Force delete stays muted until "I understand" is ticked, then follows D31.
- **D35 — Plain verbs.** A confirm button says the action's verb: "Confirm Delete" and "Confirm Remove" become "Delete" and "Remove"; the default label "Confirm" goes.
- **D36 — The question appears where the thing is.** All 21 browser pop-ups become in-place questions: a confirm row under a row; in place of a toolbar's buttons; in place of a modal footer's buttons; a line under the answers (or under the key field) for the answer-key warning; in the dirty form's own button row for unsaved work. Only closing the tab or reloading keeps the browser's own warning (`beforeunload`).
- **D37 — The in-app link waits.** `DirtyGuard` asks the owner of the unsaved work to show its question; the link, Back or Forward waits for the answer and goes ahead on Discard.
- **D38 — The version page asks once.** When an in-app link or Back finds unsaved work on the version page and no modal is open, one question appears in a row right under the page title, scrolled into view. When a modal is open, the top-most open modal asks (R46).

## Rulings

Made in rev 2 from the round-1 review; each says what it costs if wrong.
- **R46 — The top-most open modal hosts the page question.** A level-3 quiz modal (New question, Question text, Explanation) asks in its footer; else the item editor (its footer; a quiz item or a read-only item, which have no footer, ask in a row at the top of the body); else version settings or new item (their footers); else the title row. The level-3 modal's backdrop would otherwise hide the question (all three reviewers). Cost if wrong: one host order.
- **R47 — A second navigation joins the open question.** While a navigation question is open, a further guarded navigation (a link, Back, Forward) does not ask again: it waits on the same answer. Discard lets the latest navigation go ahead (the router's "later navigate wins"); Cancel restores the address once. A guard that would pass while the question is open joins it too, and the question is dismissed if the route changes by a forced path. Today's pop-up blocked the page; an in-place question does not, and otherwise Discard could drop the work and stay put. Cost if wrong: one router rule.
- **R48 — A question freezes what it guards.** An unsaved-work question and a modal-footer question make the form they guard inert (6c rev 8, 6b `bodyInert`); while a modal shows a question, its × and Esc move focus to the question's Cancel; ⌘S does nothing. A question drawn inside `.modal-body` inerts the body's other children, not the body. Row and toolbar questions freeze only the controls they replace. Cost if wrong: typed text survives a Discard nobody meant.
- **R49 — Every site re-checks after the answer.** A site captures its subject (version id, ids, titles) before asking and, after the await, re-runs its full pre-gate and recomputes indexes from the live list; it returns if anything changed. A question whose subject goes away (the row is deleted, the version switches) is dismissed. Cost if wrong: an action on the wrong thing.
- **R50 — The confirm ignores clicks for 400 ms after it appears,** and hover fills apply only under `@media (hover: hover)`. A double-click on a trigger whose question appears under the pointer would otherwise answer it. Keyboard focus starts on Cancel, so keyboard users are unaffected. Cost if wrong: a slower double-check for a fast clicker.
- **R51 — Two discard texts.** `DISCARD_CONTINUE = 'Discard unsaved changes and continue?'` where a click waits (the navigation question, the D10 quiz-edit question); `DISCARD = 'Discard unsaved changes?'` where Discard is itself the action (modal closes, Esc in the versions create form, the 6b/6c questions). Both live in `lib/editorReasons.ts`; `quizEdits.svelte.ts` re-exports `DISCARD_CONTINUE` as `DISCARD_PROMPT`. When several forms are dirty, the one question speaks for all of them (no count). Cost if wrong: a copy change.
- **R52 — The answer-key question is named "Change the answer key?"** (its `label`), with today's KEY_CONFIRM text, minus "Continue?", as its description, in the column layout; the button is "Change key". Cost if wrong: a copy change.

## Scope

In:
- the tokens, `ui/InlineConfirm`, `ui/DangerConfirm`, `ui/Button`'s `danger` variant (Look);
- the 12 existing `InlineConfirm` uses and 4 `DangerConfirm` uses (restyle, tone, labels);
- the two hand-rolled confirms: AssetSidebar's `.confirm-pair` (asset delete) and RunAssetsTab's replace confirm `.row-confirm` (become `InlineConfirm`);
- the 21 `confirm()` call sites (inventory §1), `DirtyGuard`, the router's waiting rule (R47), `dirtyRegistry`;
- a shared "ask in place" helper;
- the gate.

Not in:
- `IconButton`'s `danger` trash glyph keeps its shape; only its colour follows the token.
- `--status-rejected-*` (status badges) stays as is. The danger panel keeps its `--status-rejected-bg` background and `--status-rejected-fg` message text; the mock-up's panel colours are not adopted.
- The Toast stays a red fill (`--danger` background, `--bg` text, 5.7:1).
- VersionsPage's create form: its Cancel button and in-app links discard silently today; that stays (only its Esc prompt is converted). Adding a guard there is a Polish 3 candidate.

## Look (Task 1)

### Tokens (`styles/theme-default.css`)
- `--danger: #C8102E`; new `--danger-press: #A50D26` (pressed fill and border).
- New `--primary-press: #2F465B`.
- `--danger-off-bg: #FFF7F8`, `--danger-off-border: #F4D2D8`, `--danger-off-text: #DFA3AE` (re-derived; disabled, so exempt from contrast; the Safari pass checks the unarmed label stays readable at 12px).
- New `--cancel-border: var(--focus-line-strong)`, `--cancel-hover: var(--focus-1)`, `--cancel-press: var(--focus-2)`.
- The `:root` hash in the gate (b4, `:537`) moves; its comment log records why.

### Shared button states (InlineConfirm, DangerConfirm, Button `.danger`)
Every rule below applies only to an enabled, unblocked control: Button `:not(:disabled):not(.blocked)`; InlineConfirm `:not([aria-disabled="true"])`; `.dc-force.armed:not(:disabled)`; `.dc-cancel:not(:disabled)`. Disabled and blocked looks win in every state.
- Red action: rest `--surface` background, `--danger` 1px border and text; `@media (hover: hover)` `:hover` and `:focus-visible`: `--danger` background, `--primary-text` text; `:active`: `--danger-press` background and border.
- Primary action: the same with `--primary` / `--primary-press`.
- Cancel: rest `--surface`, `--cancel-border` border, `--text-3` text; hover and focus-visible `--cancel-hover`; active `--cancel-press`.
- Focus ring (the mock-ups): `:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }` on every one of these buttons, armed or not, in addition to the fill. The offset keeps the ring on the background. (The global ring, `base.css:22-26`, is a 1.16:1 halo and its border colour loses to these buttons' own border.)

### `ui/InlineConfirm`
- New prop `tone?: 'danger' | 'primary'` (default `'danger'`).
- `confirmLabel` becomes required (D35).
- New optional `message?: Snippet`, mutually exclusive with `warning` (a TypeScript union). It renders inside the same `div.warning` with `id={warnId}`, so `aria-labelledby` keeps naming the group. With `label` set, the group is named by `label` and the warning or message is its `aria-describedby` (R52's key question).
- New optional `layout?: 'row' | 'column'` replaces `row` (kept as an alias for the 12 existing uses). Column puts the text above the buttons.
- New prop `busy?: boolean`: both buttons `aria-disabled="true"` with the reason `title="Wait for the request to finish"`, the confirm `aria-busy="true"`; `onConfirm` is not called; focus stays (R20, R44).
- R50: the confirm button ignores clicks for 400 ms after mount.
- On mount with `takeFocus`, the group calls `scrollIntoView?.({ block: 'nearest' })` before focusing Cancel. This applies to the 12 Teaching confirms too (all `takeFocus`); they are on screen when opened, so nothing moves.
- Buttons: 22px tall, `padding: 0 9px`, 12px text, weight 500, 4px corners, 6px gap. Under `@media (pointer: coarse)` `min-height: 28px`. A confirm row leaves at least 1px of clearance to other targets above and below.
- `.warning`: `--muted`, `12.5px` (was `0.85em`); `.warning :global(code)` takes DangerConfirm's code style.
- The class names `.inline-confirm`, `.row`, `button.confirm`, `button.cancel` stay (DashboardSidePanel:498 and MiniProjectModal:306 select them; 40+ tests).

### `ui/DangerConfirm`
- `.dc-force` and `.dc-cancel` take the InlineConfirm button geometry (small) and the shared states.
- Unarmed `.dc-force` (enabled, `aria-disabled`) and natively disabled: the `--danger-off-*` family, `cursor: not-allowed`, no fill on hover or focus; it keeps the focus ring.
- `.dc-force.armed` while busy (natively disabled, spinner): the `--danger-off-*` family with the spinner, as a disabled control.
- The local function `confirm()` (`:44`, `:90`) is renamed `force()`, so the gate's "no `confirm(`" check needs no exclusion.
- The panel itself is unchanged.

### `ui/Button` `danger` variant
- `.danger` follows the shared red action states at page size (`--btn-pad`, 13px). Its resting background is `--surface`.
- `.danger-off` has no consumer (inventory §4.3); it stays for its test.

### Tone and labels of the existing confirms
| place | label (old → new) | tone |
|---|---|---|
| RunTeachersTab:120 remove teacher | Confirm Remove → Remove | danger |
| RunGroupsTab:182 delete group | Confirm Delete → Delete | danger |
| RunListPage:161 delete run | Confirm Delete → Delete | danger |
| RunAssetsTab:713 bulk delete | Confirm → Delete | danger |
| RunAssetsTab:814 delete asset | Confirm → Delete | danger |
| RunAssetsTab replace (`.row-confirm`, :823-835) | Confirm → Replace; becomes InlineConfirm with `message` and `label="Replace {filename}?"`; Cancel keeps its first focus; Esc as today | danger |
| AssetSidebar `.confirm-pair` (:311-329) | Confirm → Delete; becomes InlineConfirm with `label="Delete {filename}?"`, `busy={deletingIds.has(a.id)}`, clicks still `stopPropagation()`, Esc keeps `preventDefault` (Modal checks `defaultPrevented`, :93-95); focus after Cancel → the trash (`cancelEls`), after Delete → `refocusAfterDelete` as today | danger |
| RunOverviewTab:348 Unpublish | Unpublish | primary |
| MiniProjectModal:495 Publish | Publish | primary |
| RunMiniProjectsTab:339, RunRosterTab:695 / :852, DashboardSidePanel:654, MiniProjectModal:485 | unchanged (Delete, Remove, Discard) | danger |

## Ask in place (Task 2)

### The helper (`lib/askInPlace.svelte.ts`)
```ts
export type Ask = {
  text?: string | (() => string);   // a getter keeps an `unsavedSuffix` current while open
  message?: Snippet;                // instead of text
  label?: string;                   // names the group when set (R52)
  confirmLabel: string;
  tone: 'danger' | 'primary';
  layout?: 'row' | 'column';
  key?: string | number;            // which row of a list asks (VersionsPage, tree rows)
  dataAction: string;               // test hook, e.g. 'confirm-delete-block'
};
export class InPlaceAsk {
  current = $state<Ask | null>(null);
  get open(): boolean;
  constructor(cancelEl: () => HTMLElement | null | undefined);
  ask(q: Ask): Promise<boolean>;    // resolves true on the action, false on Cancel
  join(): Promise<boolean> | null;  // the open question's promise (R47)
  answer(ok: boolean): void;
  dismiss(): void;                  // resolves false without an answer
  focusCancel(): void;
}
```
- **One `InPlaceAsk` per place**, shared by every question that appears there. `ask()` while open resolves the newcomer `false` at once and calls `focusCancel()` (a second click on the same toolbar or row). The navigation owners use `join()` instead (R47).
- The host renders `{#if a.current}<InlineConfirm … {...a.current} onConfirm={() => a.answer(true)} onCancel={() => a.answer(false)} />{/if}` where the question belongs (under the row whose `key` matches, for lists).
- Every question is resolved exactly once: a host that unmounts or drops the question calls `dismiss()` (a component's `$effect` teardown; `InlineEdit.close()` and `attach()`'s cleanup for the quiz edits).

### Focus
- On open: the question's Cancel (`takeFocus`), after `scrollIntoView?.({ block: 'nearest' })`.
- Esc on either button = Cancel, and it does not reach an enclosing modal.
- After either answer the host waits `tick()` and focuses by **identity**: the re-rendered trigger through its `bind:this` ref or `data-action`, not an element recorded before the question replaced it (that element is gone). In Safari a mouse click does not focus the button, so nothing is read from `document.activeElement`.
- While the action's request runs, focus sits on the re-rendered trigger, shown busy (`aria-disabled`, R20/R44); the post-action target in the table then follows. Never `<body>`.

### The router and `DirtyGuard` (D37, R47)
- `DirtyGuard` gets a required prop `ask: () => Promise<boolean>`. It keeps one `pending` promise: while it is set, every guard call returns it (no second question, `onDiscard` not repeated), whether or not the form is still dirty. When it resolves `true`, `onDiscard` runs once. When the route changes by a forced navigate while it is pending, it is dismissed (`false`). `beforeunload` is unchanged.
- The router needs no change for this: a stale navigate is dropped by `navGen` and the latest one commits after the shared answer; two Backs both await the shared answer, and on Cancel only the first restores the address (the second finds it restored, `router.svelte.ts:134-135`). Router tests are added for: a double click on a guarded link + Discard navigates once; Back twice + Discard lands on the second target; Back + Cancel restores once; a forced navigate while asking dismisses the question.
- During the wait on Back the address bar already shows the target; on Cancel it comes back.

### Owners
- **DashboardSidePanel:** `ask` opens its rev 8 question with a third source `'nav'` (`DISCARD`, the 6c text). Discard resolves the navigation and also ends the edit as `'cancel'` does (`editing = false; resetForm()`). When the form goes while asking (`:307-309`), the question is dismissed (`false`). A guard while its `'cancel'` or `'close'` question is open refuses (`false`) and focuses the open question's Cancel.
- **MiniProjectModal:** `ask` opens its footer `pendingClose` question with a navigation continuation (Discard resolves `true`; the navigation unmounts the modal). A guard while its publish question is open refuses and focuses that question's Cancel.
- **VersionEditPage (D38, R46):** VersionEditPage owns one page `InPlaceAsk` (`pageAsk`, text `DISCARD_CONTINUE`) and provides it, with a host stack, by context (`setContext`). Each modal that can host the page question registers itself while mounted (push on mount, pop on unmount): ItemEditorModal, VersionSettingsModal, NewItemModal, and the level-3 quiz modals. The top of the stack renders `{#if pageAsk.current}` in its footer in place of its buttons; ItemEditorModal without a footer (quiz, read-only) renders it in its body-top row (below). With an empty stack, the `.page-ask` row under the `<h1>` renders it and is scrolled into view (no modal open, so no scroll lock). A host that unmounts while asking hands the question to the next host. The guard's existing `onDiscard` (`dirtyRegistry.discardAll()`) runs on Discard and drops every dirty tracker, the hosting modal included.
- Standalone mounts (tests, any page without the context) get no host stack: the component falls back to its own footer question for its own close and has no page question.

### The item modal's × while the page question is open
`requestCloseItem` (`VersionEditPage.svelte:246-255`) does not call `history.back()` or `navigate()` while `pageAsk.open`; it focuses the question's Cancel (as MiniProjectModal `:305-308` and DashboardSidePanel `:496-499` do). `closing` re-arms when the guard resolves `false`, not in the bare `popstate` listener (`:233-237`), which with an async guard would fire while the question is open.

### `quizEdits` (D10) becomes async
- `EditHandle` (`quizEdits.svelte.ts:17-23`) gains `ask?(q: Ask): Promise<boolean>`. `InlineEdit` implements it with its own `asking: InPlaceAsk`. The level-3 handles leave it undefined: they are modal on top, so no `request()` can come from beneath them.
- `request(id?)`: nothing open or own id → `true`; saving → `false`; dirty → `await a.ask({ text: DISCARD_CONTINUE, … })` (no `ask` → `false`); after the await, `true` only if `this.active === a` and `!a.saving`, then `#drop(a)`. `requestStructure()`: `true` if the active edit is saving, before or after the await.
- While an `InlineEdit` asks, its field is `readonly` and Enter or ✓ only focus the question's Cancel. `InlineEdit.close()` dismisses `asking`.
- `InlineOptions.confirmSend` is replaced by `confirm?: () => Ask | null` (the InlineEdit asks in its own place). `commit()` asks after its checks and, after the await, returns unless `#alive && canSave && !saving`, then re-runs `unchanged` / `check` before sending.
- All 12 callers (inventory 1.B) become `if (!(await x.request())) return;` and then apply R49.
- Hosts that draw an `InlineEdit`'s question in place of its ✓/✕: `InlineInput` (text fields), `KeyAnswer`'s Number edit (`div.key-edit`), `ChoiceAnswers`' answer edit and "+ Add answer". The quiz title edit (a raw input in ItemEditorModal's header, `:270-296`) has no room there: its question appears in ItemEditorModal's body-top row.
- Two questions in a row stay in a row (today's order): the D10 discard first, at the dirty edit; on Discard, the second (the delete or the key question) at its own place. Cancel at either sends nothing.

### ItemEditorModal's body-top row
One `InPlaceAsk` (`bodyAsk`) drawn as a row at the top of `.modal-body`, shared by #19 (delete item), the quiz title's D10 question, and the page question when this modal is the top host without a footer. While it asks, the body's other children are inert (R48); `bodyInert` stays `deleting`.

## Every converted call site (Tasks 2–6)

Texts are today's, unless a column says otherwise; `unsavedSuffix()` stays where it is used, as a getter (R49). "Trigger" = the control that asked, re-rendered.

| # | site | where the question appears | label / tone | focus after Cancel | focus after the action |
|---|---|---|---|---|---|
| 1 | DirtyGuard (link, Back) | per owner (above) | Discard / danger | page row: the `<h1>` course link; a modal host: its ×; drawer / mini-project: as today (rev 8, `cancelClose`) | the navigation's own target (VersionEditPage's focus effect for in-page navigations; never `<body>`) |
| 2 | ChoiceAnswers.mark, published | a line under the answer list, column layout (R52) | Change key / primary | the marker | the marker |
| 3 | SequenceAccordion.deleteSeq | a confirm row under the sequence header, inside `div.seq-card` | Delete / danger | the trash | as today (the block header) |
| 4 | SequenceAccordion.deleteItem | a confirm row under the item row, inside its `<li>` | Delete / danger | the trash | the next item's `item-<id>-open`, else the previous, else "+ Add item" (after `busy` clears) |
| 5 | BlockAccordion.deleteBlock | a confirm row under the block header, inside `div.block-card` | Delete / danger | the trash | the next block's header, else the previous, else "+ Add block", else the `<h1>` course link |
| 6 | KeyAnswer commit, published | a line under the key field (its message slot), column layout (R52) | Change key / primary | the key input | as today (`refocusPencil`); while saving, the key input |
| 7 | ExplanationModal close, dirty | in place of the footer buttons | Discard / danger | the footer's Cancel, else × | as today (`closeL3`) |
| 8 | ExplanationModal remove | in place of the footer buttons | Remove / danger | "Remove explanation" | "Remove explanation" while it runs and after a failure (R20; QuizModals test :259); after success as today |
| 9 | AppBody.removeApp | in place of `.script-row`'s Replace/Remove | Remove / danger | "Remove" | the Upload button (the former Replace, `:166-168`) |
| 10 | VersionSettingsModal close, dirty | in place of the footer's Discard/Save | Discard / danger | × | as today (the settings button) |
| 11 | NewItemModal close, dirty | in place of the footer's Cancel/Create | Discard / danger | the footer's Cancel | as today ("+ Add item") |
| 12 | QuizBody.remove | a confirm row under the card's `.qhead`, passed into QuestionCard | Delete / danger | the card's trash | the card's trash while it runs; then `focusFallback` as today |
| 13 | NewQuestionModal close, dirty | in place of the footer buttons | Discard / danger | the footer's Cancel, else × | as today |
| 14 | quizEdits.request (D10) | at the dirty edit (above) | Discard / danger (`DISCARD_CONTINUE`) | the trigger, else `focusFallback(qid)` (`request(id?, trigger?)`) | the caller's action proceeds |
| 15 | QuestionTextModal close, dirty | in place of the footer buttons | Discard / danger | the footer's Cancel, else × | as today |
| 16 | VersionsPage Esc in the create form | in place of the form's Cancel/Create (`div.submit`) | Discard / danger | the field where Esc was pressed | as today ("+ Add version") |
| 17 | VersionsPage enable/disable | a confirm row (`li.ask-row`) under the version row; it closes that row's duplicate form | Enable or Disable / primary | the trigger | the swapped button in the same slot, after `busy` clears |
| 18 | VersionsPage delete draft | a confirm row under the version row | Delete / danger | the trash | the next row's first control, else the previous, else "+ Add version", after `busy` clears |
| 19 | VersionEditPage delete item (item modal trash) | ItemEditorModal's body-top row | Delete / danger | the trash | as today (`seq-<sid>-header`); after the await it re-checks `guardDirty` (R49) |
| 20 | VersionEditPage publish / archive / revert / disable / enable | in place of the whole bottom bar (`div.state-actions`) | the verb / primary | the trigger | the trigger while it runs; then the first button of the new bar, else the `<h1>` course link; `vid` is captured before asking (R49) and the question is dismissed on a version switch |
| 21 | VersionEditPage delete version | in place of the whole bottom bar | Delete / danger | the trigger | the trigger while it runs; then as today (navigates away) |

The modals with an R10 focus rescue (#7, #8, #13, #15: ExplanationModal :83-94, NewQuestionModal :95-106, QuestionTextModal :73-84) look for the footer's "Cancel" by text; the question's Cancel also matches, which keeps the rescue working.

## Code changes

- `styles/theme-default.css`: the tokens.
- `components/ui/InlineConfirm.svelte`, `DangerConfirm.svelte`, `Button.svelte`.
- New `lib/askInPlace.svelte.ts`; `lib/editorReasons.ts` (the two discard texts, the comment at `:41` reworded); `lib/quizEdits.svelte.ts` (async `request`, `EditHandle.ask`, `InlineEdit.asking`, `confirm`); `lib/dirtyRegistry.svelte.ts` (no API change; `discardAll` is the page's `onDiscard`).
- `components/editor/DirtyGuard.svelte` (`ask`, `pending`).
- The owners and sites above, including ItemEditorModal (header title, body-top row, host registration), VersionSettingsModal and NewItemModal (the discard text from `editorReasons.ts`), the level-3 quiz modals (host registration), `components/editor/AssetSidebar.svelte`, `components/runs/RunAssetsTab.svelte`.
- No backend change.

## Process

Seven tasks, each: TDD → full checks → screenshots → the user's OK → Opus + Fable reviews of the uncommitted diff until clean → commit → wait for "go".
1. **The look:** tokens, InlineConfirm (tone, size, states, required label, `message`, `layout`, `busy`, R50), DangerConfirm, Button danger; the existing confirms' tones and labels; the two hand-rolled confirms. Screenshots: every Teaching confirm (6a/6b/6c) and the authoring `Button danger` uses (VersionEditPage Delete, ExplanationModal "Remove explanation", RunAssetsTab "Delete N selected").
2. **Ask in place, links and modal closes:** the helper; the two discard texts; DirtyGuard `ask`/`pending` and the router tests; the owners (DashboardSidePanel, MiniProjectModal, VersionEditPage's title row and host stack); the modal-close questions in the same footers (#7, #10, #11, #13, #15), the item modal's body-top row and × rule. After this task no file holds both an in-place question and a `confirm()` for the same footer.
3. **Course tree deletes:** #3, #4, #5, #19.
4. **Versions:** #16, #17, #18, #20, #21.
5. **The quiz edit slot:** async `request` and `confirm` (#14, #6, #2), the quiz title's D10 question.
6. **Quiz and app removals:** #8, #9, #12.
7. **No pop-ups left:** the gate check, clean-up, full checks.

Then a whole-branch review (fresh Opus + Fable) and a Safari pass, one step at a time.

## Testing

- Component tests (mount / flushSync) for every converted site: the question appears in its place with its text, label and tone; Cancel sends nothing and focuses the table's target; the action runs once; Esc cancels; a second trigger while asking only refocuses; a double-click on the trigger leaves the question open (R50); the subject changing while asking cancels (R49); the form is inert while asking (R48).
- The 60 `window.confirm` spies in 14 files (inventory §3.1) are rewritten to answer the in-place question; their assertions on the prompt text move to the question's text. Tests that click two actions back to back (VersionEditPage `:473`, VersionsPage.slots `:381`) are rewritten for one question at a time.
- Label and class pins: RunListPage `Confirm Delete`; RunAssetsTab's 41 `/^Confirm$/` lookups and the `.row-confirm` / `.rc-confirm` / `.rc-cancel` selectors (`:2489`, `:2491`); InlineConfirm's tests that mount without `confirmLabel` (svelte-check fails on them once it is required); VersionEditPage's state-bar `[label, variant]` pins (`:433-450`); AssetSidebar's 12 `data-testid="delete-confirm|delete-cancel"` lines (`AssetSidebar.svelte.test.ts:376-480`, `:554-596`, `AssetSidebar.run-mode.svelte.test.ts:241`), rewritten to the row's `button.confirm` / `button.cancel`; KeyAnswer `:163` (focus never on a disabled ✓).
- `askInPlace` unit tests; `DirtyGuard` tests for `ask`, `pending` and the forced-route dismissal; the router tests named above.
- `quizEdits.test.ts`: async `request`; the question on the active edit; a saving edit is never closed (`:57`), including when it starts saving while asking; `requestStructure` while saving.
- The host stack: a dirty level-3 modal + Back asks in that modal's footer with focus on its Cancel; the item modal's × while asking does not navigate twice.
- Standalone mounts of ItemEditorModal, VersionSettingsModal and NewItemModal keep working without the page context.
- `scrollIntoView` is called optionally (`?.`), because jsdom lacks it.

## Gate

- New check: no `confirm(` call anywhere in `frontend/src` outside tests: `grep -rnE '(^|[^.[:alnum:]_])confirm[[:space:]]*\(|(window|globalThis)\.confirm' src --include='*.svelte' --include='*.ts' --exclude-dir=tests` finds nothing (DangerConfirm's function is renamed and the `editorReasons.ts` comment reworded, so there are no exclusions).
- New pins: the shared button states per component (size, the `:not(:disabled)` / `:not(.blocked)` / `:not([aria-disabled="true"])` guards on every hover, focus-visible and active rule, the focus ring, `@media (hover: hover)`), the new tokens' use.
- Changed:
  - the `:root` hash (b4 `:537`);
  - "DISCARD_PROMPT equals the DirtyGuard prompt" (`:4524-4528`) becomes "the discard texts appear only in `editorReasons.ts`": no literal `Discard unsaved changes` in `src` outside it and tests;
  - "5d components use the quizEdits texts, not copies" (`:4519-4523`) greps the new wording;
  - "VersionEditPage Delete uses Button variant=danger" (`:3841-3846`) is re-pinned to the new line;
  - the DangerConfirm `.dc-force` pins (`:4734-4736`) follow the new rules;
  - "RunAssetsTab uses … InlineConfirm" (`:4761-4766`) still holds.
- The colour and emoji scans add `lib/askInPlace.svelte.ts`, `lib/editorReasons.ts` and `DirtyGuard.svelte`.
- BlockAccordion / SequenceAccordion may not author `.row` or `.danger` rules (`:3890`) or side borders outside `.seq-card` (`:3936`): their confirm rows use InlineConfirm's own classes inside a new wrapper class with no border.
- `EXPECTED_CHECKS` is bumped per task by the plan's ladder.

## Carried to the Safari pass

- Hover and focus fills and the focus ring in Safari (a mouse click shows no ring; Tab skips buttons by default), including in a modal footer.
- Back with unsaved work: the address bar shows the target while the question is open, and comes back on Cancel; Back twice while asking.
- A dirty New question modal + Back: the question in that modal's footer.
- The item modal's × on an in-page item with a dirty quiz edit, and × again while asking.
- Scroll-into-view of a question in another quiz card.
- A double-click on a trigger whose question appears under the pointer.
- The unarmed Force delete's label is readable at 12px.
