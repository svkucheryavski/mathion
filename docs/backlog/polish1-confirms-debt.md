# Polish 1 (confirms) — deferred minors

Minors the review lanes raised and the user did not take into the slice, by task.

## Task 1 — the look

Review round 1 (Opus + Fable). Both lanes reported one shared Minor that the controller re-graded Important and fixed in the task: AssetSidebar's disable effect looked at the first question in the list, not the asked row's, so with a busy question above an idle one, focus could drop to `<body>` (test "two questions (one busy)…"). Round 2: both lanes clean.

- **`InlineConfirm` `align="end"` assumes the row layout** (`InlineConfirm.svelte`, `.inline-confirm.end`): with `layout="column"` the flex-end pushes along the vertical axis and the question stays left. Every caller pairs it with `row`. Fix: document "row only", or add `.inline-confirm.end:not(.row) { align-items: flex-end; }`. (Opus)
- **AssetSidebar's click-stop wrapper comment is inaccurate** (`AssetSidebar.svelte`, the `<span onclick>` around the question): `button.row-click` is a sibling, not an ancestor, so no row click runs under the question anyway. Reword to "keeps the question's clicks inside the sidebar" or pin it with a test. (Opus)
- **Gate (am) coverage gaps:** the InlineConfirm `none` pattern does not catch an unguarded fill on `.ic-btn.H:hover` / `.confirm.H:hover` (widen to `(danger|primary|cancel|ic-btn|confirm)`); P57's `box-shadow:none` is not pinned on `.ic-btn:focus-visible`, `.dc-btn:focus-visible`, Button `.danger:focus-visible` (+3 checks). (Opus)
- **RunAssetsTab tests' shared `/^(Delete|Replace)$/`** (P59) lets a delete-path test pass on a Replace button and vice versa; safe today (no row button has visible text). Fix: `/^Delete$/` in the delete tests. (Opus)
- **The `code` chip in a question is white on white** (`InlineConfirm.svelte`, `.warning :global(code)` `background: var(--surface)`): in RunAssetsTab's replace row (no tinted panel since P58) the chip shows only as padding. Fix: drop the background or use `--surface-2`. (Fable)
- **Unarmed Force delete label is 1.99:1** (`--danger-off-text` on `--danger-off-bg`; was 2.35:1). Spec exempts the unarmed state; look at it deliberately in the Safari pass. (Fable)
- **`--cancel-border` is 1.8:1 on white**, below the 3:1 non-text guideline for a control boundary (better than the old 1.3:1; the label carries the affordance). Polish 3 candidate. (Fable)
- **Focus ring clearance in `tr.delete-row` / `.ro-confirm-row`:** `td` has 0 top padding, so the ring (2px offset + 2px) overlaps the row above's border. Cosmetic; check in the Safari pass. (Fable)
- **D42 with a wrapped warning:** with `align="end"` and a long email or filename, the `.warning` lines stay left-ragged while the block sits at the right edge. Check at 1000px in the Safari pass. (Fable)
- **AssetSidebar's disable effect finds the row by its `data-testid`** (`AssetSidebar.svelte`, `asset-row-${id}`): a testid rename would silently break the dismissal focus path. Fix: a `data-asset-id` on the `li`, or a `rowEls` record like `trashEls`. (Fable, round 2)

## Task 2

- **Shared question objects** (`askInPlace.svelte.ts` `DISCARD_ASK` / `DISCARD_NAV_ASK`, `AskSlot` keyed on `ask.current`): a dismiss and a re-ask in the same flush keep the key, so no fresh InlineConfirm (no `takeFocus`, stale R50 timer). Practically unreachable today; fix by asking with `{ ...DISCARD_ASK }`. (Opus lane)
- **Nav-Discard relies on the navigation unmounting the owner** (`DashboardSidePanel`, `MiniProjectModal` `answerNav(true)`): a future same-page `?param` navigation would leave the drawer reset / the modal open and empty with focus wherever the route puts it. Today's routes unmount both. (both lanes)
- **ItemEditorModal trash while the page question is drawn there** returns silently (`if (trashDisabled || asking) return;`) instead of R53's "refuse the same way" (focus to that question's Cancel); the trash is aria-disabled with "Answer the question first". (Fable lane)
- **DirtyGuard one-tick join window** after an answer: a second navigation in the same microtask turn joins the already-answered promise and, after Cancel, is refused without asking. Negligible. (Fable lane)
- **ItemEditorModal #19 `back` chain has no panel fallback** (`[trashEl, modalClose(labelId)]`): if both were unusable focus would stay put. Unreachable today (× is disabled only while saving/deleting, neither can start while the body-top question asks; `deleting` is false by `finally`). Appending `modalPanel(labelId)` would make it symmetric with PageAsk's fallback. (Opus lane, round 2)

## Task 3

- **Test gaps in the tree deletes:** no component test drives #3 / #5 failure (busy through the reload, then focus on the trash; only #4 has one), an R49 `withdraw` after a confirm (subject renamed / deleted / switched while asking; only the helper is unit-tested), or the 404 race where the failed DELETE's reload removes the row (TreeAskRow teardown dismisses, focus to its fallback: seq header for #4). Also nothing pins that `block-1` and `item-1` are different keys (D39 across kinds). (both lanes)
- **`live={mode === 'open-focus'}` on the block / sequence TreeAskRows is redundant** with `useTreeAsk`'s route dismissal (their mode comes from the route). Harmless; a one-line comment would explain why item rows don't pass it. (Opus lane)
- **TreeAskRow's "Kept past unmount" comment misleads** (`TreeAskRow.svelte`): by teardown the DOM is detached, so `wrap.contains(activeElement)` is always false and the check works through the `<body>` branch. Reword, or drop `wrap` and call `focusIsFree()`; behaviour unchanged. (Fable lane)
- **#4's failure `settleTo` finds the trash via `item-<id>-open` → `closest('li')`** (`SequenceAccordion.svelte` `itemTrash`), coupling it to the ✎ having an id; a `data-action` lookup scoped to the `<li>` would match the other two sites. Cosmetic. (Fable lane)

## Task 4

- **A course switch mid-question** (VersionsPage stays mounted; only `courseSlug` rebinds): a row question is dismissed but its `<h1>` target is gone under the Skeleton, so focus stays on `<body>`; an open #16 question survives the switch with the form (`creating` was never reset — today's behaviour). Fix: dismiss `createAsk` and reset `creating` in the `courseSlug` effect; optionally focus the new `<h1>` once it loads. (both lanes)
- **Test gaps, VersionsPage:** the R49 effect (an idle or busy row question while an external reload starts, or while its row disappears), an R49 `withdraw` after confirm (state flipped / row deleted while asking), the last row's delete falling back to "+ Add version", a failed #17 (focus to the trigger), and #16's R48 / R53 (Enter in a field does not submit while it asks; a second Esc refocuses its Cancel). (both lanes)
- **Test gaps, VersionEditPage:** `withdraw` when `offered(action)` turns false while asking, and a failed #21 (focus back to Delete). (both lanes)
- **`VersionsPage.svelte` comment "load() pins courseSlug internally"** is inaccurate (it reads the live prop; `loadGen` makes the race harmless). Pre-existing wording; fix when the file is next touched. (Fable lane)

## Task 5

- **`InlineEdit.ask()` records `#asked = q` before the ask is accepted** (`quizEdits.svelte.ts`): a D10 `request()` refused by R53 while this edit's key question is open overwrites `#asked`; an unmount without `close()` then skips the `dismiss()`, leaving `commit()`'s await unresolved. No visible effect (the component is gone). Fix: record `#asked` only when `asking.current === q` after the call. (both lanes)
- **Test gap, KeyAnswer:** the published Number key's column question in the message slot (`numInMsg`): the `aria-describedby` drop on Answer/Decimals while it asks, and a failed save restoring `.key-err` with focus on the field. The Text key path is covered. (Fable lane)
- **Gate awaits grep** matches only `request()` / `requestStructure()` with empty parens; a future `request(someId)` call would slip past unawaited. Widen the pattern. (Fable lane)
- **Esc in a clean title edit while #19's question asks** focuses that question's Cancel instead of cancelling the edit (R53, one question per place). Glance at it in the Safari pass. (Fable lane)
- **ChoiceAnswers `mark`: the R53 check (`ctx.published && markAsk.open` → `focusCancel`) runs after the D10 question**: with the key question open for answer A and another answer's text edit dirty, clicking marker C asks D10 first; after Discard the mark only refocuses the open key question, so the draft went for an action that never runs. Fix: move the check above `request()`. (Opus lane)
- **Uneven permission re-checks after the D10 await**: QuestionCard `open` (canText), ChoiceAnswers `move` / `remove` and QuizBody `move` / `remove` (canStruct) do not re-check perms; a 403/409 reload during the question lets the action go and the server rejects it (toast + resync, nothing lost). Add the checks for consistency with R49. (Opus lane)
- **QuizBody `remove`: focus is on `<body>` after a D10 Discard** while the `window.confirm` shows; Task 6's in-place question should focus the trash first (P87). (Opus lane — feeds Task 6)
