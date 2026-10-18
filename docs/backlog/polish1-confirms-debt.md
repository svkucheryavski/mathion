# Polish 1 (confirms) — deferred minors

Spec: `docs/superpowers/specs/2026-10-14-visual-refresh-polish1-confirms-design.md`.
Plan: `docs/superpowers/plans/2026-10-14-visual-refresh-polish1-confirms.md`.

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

## Task 6

- **QuizBody `remove`: the post-question re-check never re-asks D10**: open the delete question on one card, then open and change an answer edit on another, then Delete — the delete runs with a dirty edit open elsewhere (the old synchronous `confirm()` could not interleave). Consider `edits.active?.dirty` in the re-check, or re-running `requestStructure()`. (Fable lane)
- **AppBody R49 after a `vid` change** with the question idle focuses the *new* item's Upload / Replace — a different row than the one asked; acceptable. (Fable lane)
- **Test gaps:** the QuizBody R49 effect with an idle question whose card leaves the list on a resync (only the busy 404 path is tested); AppBody R49 on a switch to another item or version (only "script gone" is tested); no test pins `.qask .inline-confirm` inside `li[data-q-id]` (the gate's grep does). (both lanes)
- **QuizBody `fallbackTarget` queries × without `:not([disabled])`**, so `back` can return null when ✎, "+ Add question" and × are all disabled — reachable only during the item's own delete, when `.body-rest` is inert. (Fable lane, r2)
- **AppBody `orModal` lands on the panel while × is disabled** (footer Save in flight); after the save focus stays on the panel rather than returning to Remove. Consistent with PageAsk's panel fallback. (Fable lane, r2)

## Task 7

- **Gate `cft` row (no test answers a confirm() pop-up) has blind spots**: it scans only `src/tests` (colocated `src/lib/*.test.ts` sit outside both rows) and misses `vi.stubGlobal('confirm', …)` (a live idiom here for `fetch`) and double-quoted `spyOn(window, "confirm")`. Second-line only: a real spy implies a `confirm(` in `src`, which the first row catches. Widen to `src --include='*.test.ts'` with `|stubGlobal\(['"]confirm`. (both lanes)

## Task 8

- **A modal whose only button is a secondary opens filled**: `PublishConflictsModal.svelte:62` Close carries `data-autofocus`; in a keyboard flow the programmatic focus matches `:focus-visible`, so it shows the steel-blue fill and reads as a primary. Consistent with the approved D44 rule; on the Safari list. (Fable)
- **Ring and fill are the same `--primary`**: a focused secondary's ring stands apart only by the 2px offset gap. Fine on `--surface`; the Safari "Tab-focused" step covers it. (Fable)
- **The gate cannot pin source order**: a reorder putting `.secondary:…:active` before the `@media (hover: hover)` block would let the hover fill win while pressing. Not pinnable by grep. (Fable)

## Whole-branch review

Fresh Opus + Fable on 7e02f70..ec0d5bc. Fixed in this pass (test-first): the published key's save no longer pulls focus back after the author moved it (R57); an asset question whose row a reload removes closes and focus moves on; Cancel at #2, #3, #4, #5, #17, #18, #19, #20 and #21 falls back along the site's chain when its trigger is disabled; AskSlot's full-size flex rule only in the modal body, so a question in a row wraps; #8's Cancel falls back too; the asset list stays on screen during a reload ("Loading…" only on the first load), so an open question never takes focus back (R57).

- **Two questions on screen in the quiz item modal**: with an inline edit's own question open (D10 at an answer row, or the key question), × or Back draws the page question in the body-top row; the inline one sits inert beneath it. Cancel brings it back; nothing is lost. Fix: `ownOpen()` also reports the open edit's question, so the guard refuses and focuses it (R53). (Fable)
- **Body-top precedence is not defended**: `{#if bodyAsk.open}` comes before the page question; a `bodyAsk.ask()` while the page question is drawn would hide it with its navigation pending. Unreachable today (the body is inert; `openTitle` / `askDelete` check `asking`). (Fable)
- **AssetSidebar: a failed list reload with an idle question focused** — the list error replaces the list, and focus falls to `<body>`. Contrived (a list GET failing right after a click). (controller)
- **AssetSidebar: an `assetContext` swap with focus in the sidebar's question** drops focus to `<body>` (the rows go before anything refocuses). Unreachable today: a version or run change unmounts the host modal. Fix: read `untrack(questionHasFocus)` before clearing, then fall back to the drop zone or panel. (Fable, round 4)
- Ruling (not fixed): ChoiceAnswers' `onDestroy` dismisses the key question without moving focus — the key question exists only on a published version, where no question can be deleted, so its card cannot leave while it asks; a whole-modal teardown has its own focus. (Opus)

## Carried to the Safari pass (spec §Carried to the Safari pass)

One step at a time, every write mocked, no VoiceOver step.

- **The look:** hover and focus fills and the focus ring in Safari, also in a modal footer (a mouse click shows no ring; Tab skips buttons by default); the danger panel's colours, and the unarmed Force delete's label at 12px.
  A secondary Button (D44) at rest, hovered, pressed and Tab-focused, beside a filled primary (the player's Previous / Next, the version bar, where Disable and Enable are secondary too, D45); the publish-conflicts modal opening by keyboard with its only button, Close, filled.
  A narrow window (about 700px): the version bar's question ("Publish version N? Students will see it. Unsaved edits may be lost.") wraps and its start stays on screen; the same for a modal footer's question.
- **Back with unsaved work:** the address bar shows the target while the question is open and comes back on Cancel; Back twice while asking, and a link then Back while asking; a dirty New question modal + Back asks in that modal's footer.
- **The item modal and quiz edits:** the item modal's × on an in-page item with a dirty quiz edit, and × again while asking; scroll-into-view of a question in another quiz card.
- **The page row:** Cancel brings you back where you were (keyboard); a toast does not cover it; the settings button is blocked while it asks; after a mouse click on a header, Cancel scrolls back.
- **Clicks:** a double-click on a trigger whose question appears under the pointer (R50); a click on another row's trash moves the question (D39); a question opened by keyboard, then Enter on its confirm within 400 ms, acts at once (Safari's keyboard click must report `detail: 0`).

## Safari pass (2026-10-15 – 2026-10-17): DONE

Twenty-one steps, run one at a time. Every write was held or mocked by a console guard (`.superpowers/sdd/2026-10-14-visual-refresh-polish1-confirms/probe/safari-p1-guard.js`): `__p1.conflicts` mocks run 8's publish 409, and `__p1.fail` (added for step 14) fails writes at once so an error toast shows. All steps OK. The user's changes along the way:

- **D45 → Task 9 `8348d1d`:** the version bar's Disable and Enable are secondary Buttons ("But why disable does not look like button?").
- **D46 → Task 10 `398a9eb`:** a question drawn directly in a modal body (the body-top row) is right-aligned, under the header's × and trash.
- **D47 → Task 11 `1e3e873`:** a question scrolled into view keeps 16px of room (`scroll-margin-block`), so the dirty inline quiz edit's row shows whole.

Checked:
- **The look:** the bar at rest, hovered and pressed; ⌥Tab fill and ring; a mouse click shows no ring; the item modal's footer question, with Discard's red hover and ring; the danger panel and the unarmed Force delete label; the publish-conflicts modal opened by keyboard, with Close focused and filled; the player's Previous beside a filled Next.
- **Narrow window (~700px):** the bar question, a body-top question and a footer question wrap, and their buttons stay on screen.
- **Back with unsaved work:**
  - the address bar shows the target while asking and is restored on Cancel;
  - Back twice while asking gives one question;
  - a link, then Back while asking;
  - a dirty New question modal asks in its footer.
- **The item modal and quiz edits:** × on a quiz item with a dirty inline answer edit asks in the body-top row, and × again gives still one question; another card's edit brings the D10 question into view at the dirty edit. Step 10 was first run against a question-text edit, which is a level-3 modal, so it was redone with an inline answer edit.
- **The page row:** keyboard ⌘[ then Cancel brings focus and scroll back to the field; a mouse click on a header, then Cancel, scrolls back with no ring; the settings button says "Answer the question first" and stays shut; an error toast does not cover the row.
- **Clicks:** a double-click on the bar's Delete leaves its question open (R50); another row's toggle moves the VersionsPage question (D39); a double Enter cancels at once (keyboard `detail: 0`).

## For the VoiceOver pass at beta

- Each question group is named by its text ("Delete block "Vectors"? This cannot be undone., group") before its buttons; the key question reads its bold lead and the warning as one name (R52).
- A busy confirm announces busy (`aria-busy`), and Cancel is announced as unavailable while it runs.

## Polish 2 / Polish 3 candidates (spec §Scope, "Not in")

- The error banners keep `--status-rejected-*`; beside the danger panel there are two pinks. Aligning them with the panel tokens is a Polish 3 candidate.
- VersionsPage's create form: Cancel and in-app links discard silently; only Esc asks. A guard there is a Polish 3 candidate.
- ~~The global focus halo on other Button variants~~ — done in Polish 2 Task 1 (D48: the 2px ring, and an outline in forced colors).
- **Focus not obscured (WCAG 2.4.11) in the Progress and Submissions grids:** a focused cell scrolled under the sticky columns or header. Polish 3 candidate.
- **Three fields carry `aria-invalid` with no error border:** the VersionEditPage and BlockAccordion create fields and the AccordionHeader title field. They turn blue on focus like any field. Polish 3 candidate.
- **Internal links in authored content do a full page reload.** A mid-quiz click on one still loses unsubmitted answers; routing same-origin links through `navigate()` is the candidate fix. Polish 3 candidate.
- **No-op focus rules kept by Polish 2:** the hidden inputs' `input:focus-visible { box-shadow: none }` (Login, Single/MultiChoice, the mini-project `.drop`), and the seven `:focus { outline: none }` heading rules. Polish 3: remove them with their gate pins. The 16 per-component forced-colors blocks are only partly redundant: the outline colour is global now, but their `-2px` offsets (SequenceLink, MiniProjectLink, `.num`, `.txt`, `.inline-input`, `.key-input`) and the label outlines (`.opt`, `.segment`, `.drop`, the pickers, `.sp-seg-opt`) are not covered. Polish 3 keeps those.
