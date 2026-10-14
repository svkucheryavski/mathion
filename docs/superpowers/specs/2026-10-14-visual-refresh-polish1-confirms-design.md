# Visual refresh — Polish 1: one confirm style

**Status:** draft rev 1 (2026-10-14), for review.

**Branch:** `feat/visual-refresh-polish1-confirms`, cut from the 6c tip (`7e02f70`). It stays local: no push, no merge.

**Authority:**
- The user's decisions in the 2026-10-14 brainstorm (D30–D38 below). Mock-ups: `.superpowers/sdd/2026-10-14-visual-refresh-polish1-confirms/{q1-style,q2-red,q4-danger,s1-look,s2-how,s3-tasks}.html`. The factual base is `inventory.md` in the same folder (every call site, test and gate pin at `7e02f70`).
- The design handoff `docs/design/visual-refresh/` holds where this spec is silent, with one deliberate change: the handoff's "danger is a text treatment, never a red fill" rule is replaced by D31.
- The 6a, 6b and 6c specs hold where this spec is silent. In particular: 6a §Focus (focus never drops to `<body>`; a row action's fallback chain), the 6a one-line confirms, 6b R19 (freeze during a request) and R20 (a busy button keeps focus), 6c rev 8 (the discard question replaces the form's button row). So do the earlier slices' rules: tokens only, no literal colours, no emoji, every disabled control names its reason in `title`.
- `file:line` references are to the code at `7e02f70`.

## Why

The Teaching screens confirm in place (`InlineConfirm`, `DangerConfirm`). Their buttons are bare text, so in the 6c Safari pass the user missed a confirm at the drawer's edge and asked for "real but small buttons, red for the action, grey for Cancel", and a better red ("like crimson") for every danger button and error. The authoring screens still use the browser's `confirm()` pop-up in 21 places. The user ruled in the 6a Safari pass that there must be one way to confirm, in place, everywhere.

## Decisions

The user's (2026-10-14), continuing the Slice-6 numbering:
- **D30 — Polish is three slices.** This one (confirms) first; Polish 2 takes the items sent "to the end" (forced-colors focus ring, reduced motion, page background, h4–h6/blockquote, the Not-found page check, bare URLs); Polish 3 triages the reviewers' deferred minors by group.
- **D31 — Outlined at rest, filled on hover or keyboard focus.** Every confirm action, every danger button and the danger panel's Force delete: a 1px outline and coloured text at rest; on `:hover` and `:focus-visible` the fill is the colour and the text white; while pressed (`:active`) a darker step. Cancel: a grey outline, a light-grey fill on hover and focus.
- **D32 — The red is `#C8102E`.** `--danger` changes from `#991B1B` (5.9:1 on white). The muted "unarmed" reds `--danger-off-*` are re-derived from it. Error text and error borders follow, because they already use `--danger`.
- **D33 — Red only when something is lost.** Delete, Remove, Discard, Force delete and Replace (the old file is overwritten) are red. Publish, Unpublish, Enable, Disable, Archive, Revert and the answer-key warning are steel blue (`--primary`).
- **D34 — One rule everywhere.** Page danger buttons (`Button variant="danger"`) follow D31 at page size. Confirm buttons (`InlineConfirm`, `DangerConfirm`) are small: 22px tall, 12px text. Force delete stays muted until "I understand" is ticked, then follows D31.
- **D35 — Plain verbs.** A confirm button says the action's verb: "Confirm Delete" and "Confirm Remove" become "Delete" and "Remove"; the default label "Confirm" goes (every confirm names its verb).
- **D36 — The question appears where the thing is.** All 21 browser pop-ups become in-place questions: a confirm row under a row; in place of a toolbar's buttons; in place of a modal footer's buttons; a line under the answers for the answer-key warning; in the dirty form's own button row for unsaved work. Only closing the tab or reloading keeps the browser's own warning (`beforeunload`).
- **D37 — The in-app link waits.** `DirtyGuard` asks the owner of the unsaved work to show its question; the link, Back or Forward waits for the answer and goes ahead on Discard.
- **D38 — The version page asks once, at the top.** When an in-app link or Back finds unsaved work on the version page and no modal is open, one question appears in a row right under the page title, scrolled into view. When a modal is open (item editor, version settings, new item), the question appears in that modal's footer; a quiz item, which has no footer, shows it as a row at the top of its body.

## Scope

In:
- the tokens, `ui/InlineConfirm`, `ui/DangerConfirm`, `ui/Button`'s `danger` variant (Look);
- the 12 existing `InlineConfirm` uses and 4 `DangerConfirm` uses (restyle, tone, labels);
- the two hand-rolled confirms: AssetSidebar's `.confirm-pair` (asset delete) and RunAssetsTab's replace confirm `.row-confirm` (become `InlineConfirm`);
- the 21 `confirm()` call sites (inventory §1) and `DirtyGuard`;
- a shared "ask in place" helper;
- the gate.

Not in:
- `IconButton`'s `danger` trash glyph keeps its shape; only its colour follows the token.
- `--status-rejected-*` (status badges) stays as is: badges are a separate family.
- The Toast stays a red fill (`--danger` background, `--bg` text, 5.7:1 with the new red).
- VersionsPage's create form: its Cancel button and in-app links discard silently today; that stays (only its Esc prompt is converted). Adding a guard there is a Polish 3 candidate.
- The Escape-only discard of VersionsPage (#16) stays bound to Escape.

## Look (Task 1)

### Tokens (`styles/theme-default.css`)
- `--danger: #C8102E`.
- New `--danger-press: #A50D26` (the pressed fill) and `--primary-press: #2F465B`.
- `--danger-off-bg: #FFF7F8`, `--danger-off-border: #F4D2D8`, `--danger-off-text: #DFA3AE` (re-derived; the unarmed Force delete stays recognisably red).
- New `--cancel-hover: var(--focus-1)` (the grey fill) and `--cancel-press: var(--focus-2)`.
- The `:root` hash in the gate (b4, `:537`) moves; its comment log records why.

### `ui/InlineConfirm`
- New prop `tone?: 'danger' | 'primary'` (default `'danger'`).
- `confirmLabel` becomes required (D35: no default "Confirm").
- New optional `message?: Snippet` for a warning with markup (the replace confirm's `<code>`); `warning` stays for plain text. Exactly one of them names the group (as today: `aria-labelledby` the warning, or `label`).
- Buttons: 22px tall, `padding: 0 9px`, 12px text, weight 500, 4px corners, `border: 1px solid`.
  - `.confirm.danger`: `--danger` outline and text; hover/focus-visible: `--danger` fill, `--primary-text`; active: `--danger-press`.
  - `.confirm.primary`: the same with `--primary` / `--primary-press`.
  - `.cancel`: `--border-strong` outline, `--text-3` text on `--surface`; hover/focus-visible `--cancel-hover`; active `--cancel-press`.
- The class names `.inline-confirm`, `.row`, `button.confirm`, `button.cancel` stay (DashboardSidePanel and MiniProjectModal select them, inventory §2.2–2.3; 40+ tests).
- `.warning` keeps `--muted`; its `0.85em` becomes `12.5px` (the slices' px sizes).
- Focus ring: the global `:focus-visible` ring stays in addition to the fill.

### `ui/DangerConfirm`
- `.dc-force` and `.dc-cancel` take the InlineConfirm button geometry (small).
- Unarmed / natively disabled `.dc-force`: the `--danger-off-*` family, `cursor: not-allowed`, no hover change.
- `.dc-force.armed`: D31 with `--danger`.
- The panel (`--status-rejected-bg`, 3px `--danger` left rule, `.dc-msg`) is unchanged.

### `ui/Button` `danger` variant
- `.danger`: `--surface` background, `--danger` text and 1px `--danger` border; hover/focus-visible: `--danger` fill, `--primary-text`; active: `--danger-press`. Page size (`--btn-pad`, 13px).
- `.danger-off` has no consumer (inventory §4.3); it stays for DangerConfirm's tokens and its test.

### Tone and labels of the existing confirms
| place | label (old → new) | tone |
|---|---|---|
| RunTeachersTab:120 remove teacher | Confirm Remove → Remove | danger |
| RunGroupsTab:182 delete group | Confirm Delete → Delete | danger |
| RunListPage:161 delete run | Confirm Delete → Delete | danger |
| RunAssetsTab:713 bulk delete | Confirm → Delete | danger |
| RunAssetsTab:814 delete asset | Confirm → Delete | danger |
| RunAssetsTab replace (`.row-confirm`, :823-835) | Confirm → Replace (becomes InlineConfirm with `message`) | danger |
| AssetSidebar `.confirm-pair` (:311-329) | Confirm → Delete (becomes InlineConfirm) | danger |
| RunOverviewTab:348 Unpublish | Unpublish | primary |
| MiniProjectModal:495 Publish | Publish | primary |
| RunMiniProjectsTab:339, RunRosterTab:695 / :852, DashboardSidePanel:654, MiniProjectModal:485 | unchanged (Delete, Remove, Discard) | danger |

## Ask in place (Task 2)

### The helper (`lib/askInPlace.svelte.ts`)
```ts
export class InPlaceAsk {
  open = $state(false);
  ask(): Promise<boolean>;      // opens the question; resolves true on the action, false on Cancel
  answer(ok: boolean): void;    // called by the InlineConfirm's onConfirm / onCancel
  dismiss(): void;              // resolves false without an answer (unmount, the host went away)
}
```
- One question per place: `ask()` while `open` resolves the newcomer `false` at once and moves focus to the open question's Cancel.
- The component that owns the place renders `{#if q.open}<InlineConfirm … takeFocus onConfirm={() => q.answer(true)} onCancel={() => q.answer(false)} />{/if}` where the question belongs, and replaces `if (!confirm(text)) return;` with `if (!(await q.ask())) return;`.
- A component that unmounts while asking calls `dismiss()` (an `$effect` teardown), so no promise is left hanging.
- While a question is open, the controls it replaces are not rendered (the host shows the question in their place). Other controls stay usable unless the site says otherwise.

### Focus
- On open: the question's Cancel (`takeFocus`), and the question is scrolled into view (`scrollIntoView({ block: 'nearest' })`).
- Esc on either button = Cancel (InlineConfirm `takeFocus`, as today), and it does not reach an enclosing modal.
- After Cancel: the control that asked, if it is still in the DOM and focusable; else the site's fallback (table below); never `<body>`. In Safari a mouse click does not focus the button, so the asking control is recorded by the site (the trigger element), not read from `document.activeElement`.
- After the action: as today where today's code already moves focus; the table below fills in the sites where focus dropped to `<body>`.

### `DirtyGuard` (D37)
- New required prop `ask: () => Promise<boolean>`. The guard closure becomes `async () => { if (!isDirty()) return true; const ok = await ask(); if (ok) onDiscard?.(); return ok; }`. `beforeunload` is unchanged.
- The router already awaits guards (`router.svelte.ts:68-77`), drops a stale navigate through `navGen`, and on a cancelled Back pushes `lastResolvedPath` back. During the wait the address bar already shows the target on Back; on Cancel it comes back (as today).
- Owners:
  - **DashboardSidePanel:** `ask` = `askDiscard('nav')`, a third source of the existing rev 8 question in the form's button row; Discard resolves the navigation, Cancel returns focus as rev 8 does.
  - **MiniProjectModal:** `ask` reuses `pendingClose`'s footer question with a navigation continuation (Discard → resolve true instead of `onClose()`; the guard's `onDiscard` is unset, the navigation unmounts the modal).
  - **VersionEditPage (D38):** a page `InPlaceAsk` drawn in a row right under the `<h1>` header (`.page-ask`, full width, `--focus-row` background like the Teaching confirm rows) with "Discard unsaved changes?" [Discard] [Cancel] — when no modal is open. When the item editor, version settings or new-item modal is open, the open modal draws it in its footer in place of its buttons (ItemEditorModal: the quiz variant, which has no footer, draws it as a row at the top of its body). On Discard the guard's existing `onDiscard` (`dirtyRegistry.discardAll()`) runs.
- The item modal's × / Esc on an in-page open item uses `history.back()` (inventory §2.1), so its question comes through the popstate guard path; `closing` re-arms on Cancel as today (:233-237).

### `quizEdits.request()` becomes async
- `request(id?)` and `requestStructure()` return `Promise<boolean>`. On a dirty, not-saving active edit, the active `InlineEdit` opens its own question (`InlineEdit.asking`, an `InPlaceAsk`) and the caller awaits it. On Discard the edit is dropped (`#drop`) and the caller acts.
- The question is drawn by the component that draws the dirty edit, in place of its ✓/✕: `InlineInput` (text fields and the modal-header title), `KeyAnswer`'s Number edit (`div.key-edit`) and Text edit, `ChoiceAnswers`' answer edit and "+ Add answer". It is scrolled into view (it may be in another card, inside the modal body).
- All 12 callers (inventory 1.B) change from `if (!x.request()) return;` to `if (!(await x.request())) return;`; the action after it re-checks its own preconditions (busy locks, the edit still being its own) after the await.
- `InlineOptions.confirmSend` becomes `() => Promise<boolean>`; `InlineEdit.commit()` awaits it (it is already async).
- Two questions in a row stay in a row (today's order): the D10 discard first, at the dirty edit; on Discard, the second (the delete or the key warning) at its own place. Cancel at either sends nothing.

## Every converted call site (Tasks 2–5)

Text: today's prompt text, unchanged, unless the row says otherwise. The discard text is `DISCARD_PROMPT`, which becomes "Discard unsaved changes?" (the 6c wording; the button says Discard). `unsavedSuffix()` stays where it is used today.

| # | site | where the question appears | label / tone | focus after the action (where today it dropped) |
|---|---|---|---|---|
| 1 | DirtyGuard (in-app link, Back) | per owner, above | Discard / danger | the navigation leaves |
| 2 | ChoiceAnswers.mark, published | a line under the answer list (`ul.ans-list`), in ChoiceAnswers | Change key / primary | stays on the marker (as today) |
| 3 | SequenceAccordion.deleteSeq | a confirm row under the sequence header, inside `div.seq-card` | Delete / danger | as today (the block header) |
| 4 | SequenceAccordion.deleteItem | a confirm row under the item row, inside its `<li>` | Delete / danger | the next item's row, else the previous, else "+ Add item" |
| 5 | BlockAccordion.deleteBlock | a confirm row under the block header, inside `div.block-card` | Delete / danger | the next block's header, else the previous, else "+ Add block" |
| 6 | KeyAnswer confirmSend, published | in place of the edit's ✓/✕ (Number: `div.key-edit`; Text: InlineInput's buttons) | Change key / primary | as today (`refocusPencil`) |
| 7 | ExplanationModal close, dirty | in place of the footer buttons | Discard / danger | as today (`closeL3`) |
| 8 | ExplanationModal remove | in place of the footer buttons | Remove / danger | as today |
| 9 | AppBody.removeApp | in place of `.script-row`'s Replace/Remove | Remove / danger | the upload control that replaces the script row |
| 10 | VersionSettingsModal close, dirty | in place of the footer's Discard/Save | Discard / danger | as today (the settings button) |
| 11 | NewItemModal close, dirty | in place of the footer's Cancel/Create | Discard / danger | as today ("+ Add item") |
| 12 | QuizBody.remove | a confirm row under the question card's head (`.qhead`), passed into QuestionCard | Delete / danger | as today (`focusFallback`) |
| 13 | NewQuestionModal close, dirty | in place of the footer buttons | Discard / danger | as today |
| 14 | quizEdits.request (D10) | at the dirty edit, above | Discard / danger | the caller's action proceeds |
| 15 | QuestionTextModal close, dirty | in place of the footer buttons | Discard / danger | as today |
| 16 | VersionsPage Esc in the create form | in place of the form's Cancel/Create (`div.submit`) | Discard / danger | as today ("+ Add version") |
| 17 | VersionsPage enable/disable | a confirm row under the version row (the `li.dup-row` precedent) | Enable or Disable / primary | the swapped button in the same slot |
| 18 | VersionsPage delete draft | a confirm row under the version row | Delete / danger | the next row's first control, else the previous, else "+ Add version" |
| 19 | VersionEditPage delete item (item modal trash) | a row at the top of the item modal's body (the header has no room; the footer is absent for quizzes) | Delete / danger | as today (`seq-<sid>-header`) |
| 20 | VersionEditPage publish / archive / revert / disable / enable | in place of the bottom bar's buttons (`div.state-actions`) | the verb / primary | the first button of the new bar, else the `<h1>` course link |
| 21 | VersionEditPage delete version | in place of the bottom bar's buttons | Delete / danger | as today (navigates away) |

The modal-footer sites (#7, #8, #10, #11, #13, #15) keep each modal's R10 focus rescue working: the rescue looks for the footer's "Cancel" by text, which the question's Cancel also is.

## Code changes

- `styles/theme-default.css`: the tokens.
- `components/ui/InlineConfirm.svelte`, `DangerConfirm.svelte`, `Button.svelte`.
- New `lib/askInPlace.svelte.ts`.
- `components/editor/DirtyGuard.svelte` (the `ask` prop), `lib/quizEdits.svelte.ts` (async `request`, `InlineEdit.asking`, async `confirmSend`, `DISCARD_PROMPT` text).
- The owners and sites listed above; `components/editor/AssetSidebar.svelte`, `components/runs/RunAssetsTab.svelte` (the hand-rolled confirms).
- No backend change.

## Process

Six tasks, each: TDD → full checks → screenshots → the user's OK → Opus + Fable reviews of the uncommitted diff until clean → commit → wait for "go".
1. **The look:** tokens, InlineConfirm (tone, size, required label, `message`), DangerConfirm, Button danger; the existing confirms' tones and labels; the two hand-rolled confirms. Screenshots: every Teaching confirm (6a/6b/6c).
2. **Ask in place + links:** the helper; DirtyGuard `ask`; DashboardSidePanel, MiniProjectModal and VersionEditPage (the title row and the modals' footers) as owners.
3. **Course tree deletes:** #3, #4, #5, #19.
4. **Versions:** #16, #17, #18, #20, #21.
5. **Quiz and app editors:** async `request` and `confirmSend` (#14, #6), #2, #7, #8, #9, #10, #11, #12, #13, #15.
6. **No pop-ups left:** the gate check, clean-up, full checks.
Then a whole-branch review (fresh Opus + Fable) and a Safari pass, one step at a time.

## Testing

- Component tests (mount / flushSync) for every converted site: the question appears in its place, Cancel sends nothing and returns focus, the action runs once, Esc cancels, a second trigger while asking only refocuses.
- The 60 `window.confirm` spies in 14 files (inventory §3.1) are rewritten to answer the in-place question (click its Discard / action, or its Cancel); their assertions on the prompt text move to the question's text.
- Label pins (inventory §3.2): RunListPage `Confirm Delete`, RunAssetsTab's 41 `/^Confirm$/` lookups, InlineConfirm's default-label test, VersionEditPage's state-bar `[label, variant]` pins.
- `askInPlace` unit tests; `DirtyGuard` tests for the async `ask`; router tests stay (async guards are covered).
- `quizEdits.test.ts`: async `request`, the question on the active edit, `requestStructure` while saving.
- A test that `window.confirm` is never called in the suite's own flows is not needed: the gate's source check covers it.

## Gate

- New check: no `confirm(` call in `frontend/src` outside tests (excluding `DangerConfirm`'s local function named `confirm` and the `editorReasons.ts` comment).
- New pins: the InlineConfirm button rules (size, D31 states, tones), DangerConfirm's small buttons, Button `.danger`'s D31 rules, the new tokens' use (`--danger-press`, `--primary-press`, `--cancel-hover`, `--cancel-press`).
- Changed: the `:root` hash (b4 `:537`); "DISCARD_PROMPT equals the DirtyGuard prompt" (`:4524-4528`) becomes "DirtyGuard has no prompt text of its own"; "VersionEditPage Delete uses Button variant=danger" (`:3841-3846`) is re-pinned to the new line; the DangerConfirm `.dc-force` pins (`:4734-4736`) follow the new rules; "RunAssetsTab uses … InlineConfirm" (`:4761-4766`) still holds.
- Kept: the colour and emoji scans over every touched file (no literal colours; no `×` or arrows in labels); BlockAccordion / SequenceAccordion may not author `.row` or `.danger` rules (`:3890`), so their confirm rows use InlineConfirm's own classes and a new wrapper class.
- `EXPECTED_CHECKS` is bumped per task by the plan's ladder.

## Carried to the Safari pass

- Hover and `:focus-visible` fills in Safari (a mouse click shows no ring; Tab skips buttons by default).
- Back with unsaved work: the address bar shows the target while the question is open, and comes back on Cancel.
- The item modal's × on an in-page item (the popstate path) with a dirty quiz edit.
- Scroll-into-view of a question in another quiz card.
