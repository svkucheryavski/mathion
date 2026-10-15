# Polish 1: one confirm style — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** give every confirm in Mathion one look (small real buttons, the new crimson for loss, steel blue for the rest) and replace all 21 browser `confirm()` pop-ups with questions asked in place. Only closing the tab or reloading keeps the browser's own warning.

**Architecture:**
- **The look (Task 1).** New tokens (`--danger: #C8102E`, its press step, the Cancel greys, the danger panel). `ui/InlineConfirm` gets real 22px buttons, a `tone`, a required `confirmLabel`, `message` / `layout` / `busy`, and the R50 pointer guard. `ui/DangerConfirm` and `Button variant="danger"` follow D31. The two hand-rolled confirms (AssetSidebar, RunAssetsTab's replace) become `InlineConfirm`.
- **One helper (Task 2).** `lib/askInPlace.svelte.ts` holds `InPlaceAsk`: one open question per place (R53), a three-way answer (R56), `busy` until the action settles (R54), and the focus helpers (R57). `ui/AskSlot` draws the current question where its host puts it.
- **Leaving with unsaved work (Task 2).** `DirtyGuard` asks the owner of the unsaved work instead of the browser. The router waits for the answer (D37), and a second navigation joins it (R47). The page question goes to the top-most open modal, or to a row under the version page's title (D38, R46).
- **The call sites (Tasks 2–6).** Each `confirm()` becomes a question under its row, in place of its toolbar or footer buttons, or under the answers. Each re-checks its subject after the answer (R49) and freezes what it guards (R48).
- **No pop-ups left (Task 7).** Two gate rows keep `confirm()` out of `src` and its spies out of the tests.
- **Secondary buttons (Task 8, D44).** Button's `.secondary` takes the confirm's primary-action states at page size.

**Tech Stack:**
- **Svelte:** Svelte 5.55, runes only, no JS/CSS dependencies.
- **Frontend tests:** Vitest + jsdom, with `mount` / `unmount` / `flushSync` from `svelte`.
- **Gate:** the zsh gate `frontend/scripts/visual-refresh-gate.sh`.
- **Backend:** no change.

**Spec:** `docs/superpowers/specs/2026-10-14-visual-refresh-polish1-confirms-design.md` (rev 10, commit `18fc841`, approved by the user on 2026-10-14; rev 11 adds D42 from Task 1's look review). Its D30–D42 and R46–R57, its §Focus table and its §Every converted call site (#1–#21) are binding; this plan cites them by number. Where it is silent, the 6a, 6b and 6c specs hold (6a §Focus, 6b R19/R20/P23, 6c R44 and rev 8).
**Factual base:** `.superpowers/sdd/2026-10-14-visual-refresh-polish1-confirms/inventory.md` (every call site, test and gate pin at `7e02f70`). Mock-ups: `{q1-style,q2-red,q4-danger,s1-look,s2-how,s3-tasks}.html` in the same folder.

## Global Constraints

- **Branch:** `feat/visual-refresh-polish1-confirms` (cut from the 6c tip `7e02f70`). LOCAL only: never push, never merge.
- **Directory:** never leave `/Users/svkucheryavski/Documents/Developing/mathion`. Use absolute `cd` only, never `cd ..`. Scratch files go in `.superpowers/sdd/2026-10-14-visual-refresh-polish1-confirms/` (the "polish1 sdd dir": probes in `probe/`, gate temp files and logs in `tmp/`), never `/tmp`. Tell every subagent the same.
- **Code style:**
  - Svelte 5 runes only. No new npm or pip dependencies.
  - Component tests use `mount` / `unmount` / `flushSync` from `svelte`, NOT `@testing-library/svelte`.
  - Python only through `backend/.venv`.
  - Match the surrounding comment density. No comments that narrate the change ("added in Polish 1").
- **Colours and glyphs:**
  - No literal colours in component CSS or inline `style=`; theme tokens only (`src/styles/theme-default.css`). No `hsl(`, no hex fallbacks in `var(--x, #…)`.
  - No `opacity` to dim anything.
  - No emoji and no glyph characters from the gate's `emoji_scan` set in component code (`✓ ✗ × → ✎ 🗑 ⤓ ＋`). The scan strips comments and does not read test files. `—`, `·`, `…` and `›` are allowed text.
- **Class hooks:** InlineConfirm's `.inline-confirm`, `.row`, `.warning`, `button.confirm` (+ `.danger` / `.primary`), `button.cancel`, `.ic-btn`; DangerConfirm's `.dc-*`; AskSlot's `.ask-slot`. New wrapper classes are authored by one file only (`.tree-ask` TreeAskRow, `.ask-row` VersionsPage, `.page-ask` VersionEditPage, `.body-rest` ItemEditorModal, `.ans-ask` ChoiceAnswers, `.qask` QuestionCard), because the gate's `own` / `uniq1` need that.
- **Pinned CSS rules are single-selector blocks.** The gate's `d` helper matches `.cls.svelte-HASH{…}`, so a pinned rule never shares a selector list. The minifier drops the quotes in `[aria-disabled=true]`, and Svelte does not scope inside `:not(…)`: the emitted form is `.x.svelte-H:not([aria-disabled=true]):hover`.
- **Commands** (`$SDD` below stands for `/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-14-visual-refresh-polish1-confirms`; write it out in full when you run them):
  - Frontend tests: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run > $SDD/tmp/vitest.log 2>&1; echo "exit $?"; tail -5 $SDD/tmp/vitest.log; grep -cE "^ *Errors +[0-9]|Unhandled (Rejection|Error)" $SDD/tmp/vitest.log`. Green means `exit 0` AND the last count is `0`. One file: `TZ=Europe/Copenhagen npx vitest run src/tests/<File>.test.ts` from the same directory.
  - Typecheck: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx svelte-check --threshold error > $SDD/tmp/svelte-check.log 2>&1; tail -3 $SDD/tmp/svelte-check.log`. It must report 0 errors. 13 warnings is the baseline; a task may not add one.
  - Gate: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TMPDIR=$SDD/tmp zsh scripts/visual-refresh-gate.sh > $SDD/tmp/gate.log 2>&1; echo "exit $?"; grep -E "^FAIL" $SDD/tmp/gate.log; tail -1 $SDD/tmp/gate.log`. It must end `VISUAL-REFRESH GATE: ALL PASS (N checks)` with the N the task names. Never run it in two lanes at once.
  - If a pinned gate row fails only because the minifier wrote a value differently, read the emitted rule (`grep -oE '\.CLASS\.svelte-[a-z0-9]+[^{]*\{[^}]*\}' dist/_app/*.css`), match the emitted form, and ledger a ruling. Never loosen a row to make it pass.
- **Per task, in this order** (the user's per-task loop; it overrides "continuous execution"):
  1. TDD, step by step as written.
  2. vitest (green as defined above), svelte-check (0 errors, 13 warnings), the gate (the task's N).
  3. agent-browser screenshots of the real screens the task names, at 1280 wide (1000 too where a row wraps), with network mocks for every write. Show them in an agterm overlay with `--size-percent 60`, images as base64, and the HTML in the polish1 sdd dir (copy the shape of `.superpowers/sdd/2026-10-10-visual-refresh-slice6a-teacher-restyle/mk-t11.py`). Then get the user's OK on the look. Task 7 changes no screen and takes no screenshots.
  4. Two review lanes, Opus (high) and Fable, on the UNCOMMITTED diff. Fix every Critical and Important finding, then re-run both lanes after EVERY fix until both are clean. Minors go to `docs/backlog/polish1-confirms-debt.md` (created in Task 1) under the task's heading. Do not edit the tree while a lane reviews.
  5. Commit with exact paths (never `git add -A`) and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (no session line).
  6. Ledger line in `$SDD/progress.md`, update memory, then WAIT for the user's "go" before the next task.
- **Dev servers for screenshots** (both already run in this session; never start a second copy):
  - Backend: uvicorn started with `MATHION_DEBUG=1 MATHION_ASSET_PATH="$HOME/mathion-assets"`; the PIN appears in `.superpowers/sdd/2026-10-07-visual-refresh-slice5b-item-editor-modal/probe/backend.log`.
  - Frontend: vite on `http://localhost:5174`. agent-browser session `mathion-0fb6bc751f3c` (`export AGENT_BROWSER_SESSION=mathion-0fb6bc751f3c`). Screenshot paths must be absolute.
  - Logins: `dev@mathion.test` (course admin: the authoring screens) and `teacher@mathion.test` (teacher of run 8). Run 8 lives at `/teaching/demo-course/runs/8?tab=…`.
  - Never write to shared dev data without the user's yes. Every delete, remove, publish, unpublish, enable, disable, archive, revert, upload, key change and save in a screenshot is mocked with `agent-browser network route "<url glob>" --body '…'` (status per the core guide, `agent-browser skills get core --full`). Never press Enter in a real field unless its request is mocked. No real quiz attempts.
- **Texts are verbatim** from the spec (§Every converted call site, R51, R52, D35). Tests compare them exactly. ASCII apostrophes; confirm buttons say the verb ("Delete", "Remove", "Discard", "Change key"), never "Confirm".

## Rulings made while planning

Each states what it costs if wrong. P-numbers continue from 6c's P55.

**Task 1 — the look**
- **P56 — InlineConfirm's buttons share `.ic-btn` and DangerConfirm's share `.dc-btn`;** the tone is a class on the confirm (`.danger` / `.primary`). *Cost:* class names.
- **P57 — The focus ring sets `box-shadow: none`,** so the global Button halo (`base.css:22-26`) never doubles it. *Cost:* none.
- **P58 — RunAssetsTab's replace confirm loses its blue panel:** it is an `InlineConfirm` in the column layout. *Cost:* the panel's tint.
- **P59 — RunAssetsTab's tests look up `/^(Delete|Replace)$/` instead of `/^Confirm$/`.** *Cost:* test churn.
- **P60 — AssetSidebar keeps a busy question by `confirmId === a.id || deletingIds.has(a.id)`;** another row may ask meanwhile. *Cost:* two questions on screen during a delete.
- **P61 — The click-stop wrapper is a `<span onclick>` under a `svelte-ignore`.** A native listener would stop Svelte's delegated handlers. *Cost:* one ignore comment.
- **P62 — The "warning or message" exclusivity lives in the `Ask` union type;** InlineConfirm's own props stay plain. *Cost:* none.

**Task 2 — ask in place, links and modal footers**
- **P63 — `AskSlot` is a component,** keyed per question, `display: contents`, with a `flex: 0 0 auto` child. *Cost:* one file.
- **P64 — `AskHost.closeEl`: Cancel at a modal host goes to its ×,** done inside `PageAsk.guard`. *Cost:* none.
- **P65 — `useModalAsk(labelId)` bundles a modal's own `InPlaceAsk`,** its host registration (in `untrack`) and its teardown dismissal. *Cost:* none.
- **P66 — `PageAsk.guard(after)` holds the generic page-question logic,** so test harnesses can mount it. *Cost:* none.
- **P67 — `focusCancel` scrolls the `.inline-confirm` group into view** (`scroll-margin` on `.page-ask :global(.inline-confirm)`). *Cost:* none.
- **P68 — A read-only VersionSettings draws the page question at the top of its body with nothing to freeze** (`bodyInert` only when editable). *Cost:* none.
- **P69 — `.body-rest > *` and `.ask-slot > *` keep `flex: 0 0 auto`,** because Modal's `.modal-body > *` rule no longer reaches them. *Cost:* two rules.

**Task 3 — course tree deletes**
- **P70 — `TreeAskRow` is a component:** one `.tree-ask` owner, a keyed draw, and the live/fallback dismissal. *Cost:* one file.
- **P71 — #5's last move (to "+ Add block") runs after the block unmounts.** It finds the button by `data-action` and is gated by R57's interim rule. *Cost:* none.
- **P72 — `settleTo` and `withdraw` take the `Ask` object,** so a shared ask never settles another site's question. *Cost:* none.
- **P73 — `useTreeAsk`: the first caller creates and provides it; a route change (path + search) dismisses it.** *Cost:* none.
- **P74 — New hooks:** `data-action="course-link"` and `"add-block"` on VersionEditPage, `"delete-item"` on ItemRow. *Cost:* names.
- **P75 — The tree's confirm actions are `confirm-delete-block`, `-sequence` and `-item`.** #19 shares `confirm-delete-item`; the two are never open together, because opening an item is a route change. *Cost:* names.

**Task 4 — versions**
- **P76 — #20's failure focuses the trigger first;** the spec names only the success target. *Cost:* none.
- **P77 — #17 and #18 share one keyed `rowAsk` (key = version id),** so a second action on the same row only refocuses (D39). *Cost:* none.
- **P78 — The duplicate row freezes for any question on its row** (#17 and #18), not only #17. *Cost:* none.
- **P79 — VersionsPage targets focus by id** (`v-<id>-title`, `-toggle`, `-delete`). *Cost:* ids.
- **P80 — #21 settles before its navigate;** the page leaves, and its load focus applies. *Cost:* none.

**Task 5 — the quiz edit slot**
- **P81 — `attach(field)` records the field focus returns to (`fieldEl`);** Cancel on any edit question goes to that field. *Cost:* none.
- **P82 — The handle's `ask` settles a D10 Discard at once** (no request); `request()` only drops. *Cost:* none.
- **P83 — An edit's cleanup dismisses only its own last question.** The title shares `bodyAsk` with #19. *Cost:* none.
- **P84 — While `asking.open`, Enter / ✓ / ✕ / Esc only `focusCancel`, and the fields are readonly.** *Cost:* typing waits for the answer.
- **P85 — `KeyQuestion.svelte` exports `keyMessage` and `keyAsk()` from `<script module>`** (probe-compiled on 5.55.5, no warning). *Cost:* one file.
- **P86 — #2's question has no key (one place under the list):** a second marker click refocuses. `markingId` and an `options` effect withdraw it when its answer leaves (R49). *Cost:* none.
- **P87 — After a D10 Discard, a caller whose trigger stays (an unpublished marker, an answer's trash) focuses it before acting,** never `<body>`. Openers and moves focus their own targets as today. *Cost:* none.
- **P88 — The key question's R49 re-check after confirm is alive / canSave / !saving.** The value is readonly while asking, so "unchanged" and the checks still hold. *Cost:* none.

**Task 6 — app and quiz-question removals**
- **P89 — AppBody's buttons carry `data-action="app-upload"` and `"app-remove"`** (focus by identity; Upload/Replace is one slot). *Cost:* names.
- **P90 — #12's question is QuizBody's one keyed `cardAsk`,** passed to QuestionCard as `ask` and drawn in `.qask` under `.qhead` on the answers' 38px edge. *Cost:* one prop.
- **P91 — #12's success settles before the card leaves** (the card hosts the question); `focusFallback` runs only if focus was in it (R57). On failure, focus goes to the trash once it is enabled. *Cost:* none.
- **P92 — #12's R49 effect dismisses even a busy question when its card leaves** (a 404 resync: its host is gone). Focus goes to the nearest card left, by the ids at asking time. *Cost:* none.
- **P93 — #9's R49 effect withdraws an idle question when the item, the version or the script changes;** focus goes to Upload. *Cost:* none.

**Task 7 — no pop-ups left**
- **P94 — A second gate row keeps `confirm` spies out of `src/tests`** (the 60 spies rewritten in Tasks 2–6). *Cost:* one row.

**Review Focus**
- **P95 — InlineConfirm's `.warning` gets `overflow-wrap: anywhere`** (Review Focus 1), pinned in the gate. *Cost:* one declaration, +1 check.
- **P96 — D42 is `InlineConfirm`'s `align?: 'start' | 'end'` prop** (class `end`: `display: flex; justify-content: flex-end`) and an `Ask`'s `align`, which AskSlot passes on. Pinned in the gate (+2 checks). *Cost:* one prop.

## Review Focus

The five inputs or conditions most likely to bite an author or a teacher that the spec's own test list does not name. Each has its test or pin in the owning task.

1. **A long title in the question.** "Delete block "<a 200-character title>"?" or an unbroken file name wraps inside the question's text; Delete and Cancel stay on screen in the row layout. Gate pin: Task 1 (`overflow-wrap:anywhere` on `.warning`).
2. **Closing the tab or reloading with unsaved work.** The browser's own warning still shows (`beforeunload`), and nothing is discarded by the in-place guard. Test: Task 2 (`DirtyGuard` "beforeunload warns but never discards").
3. **The session ending while a navigation question is open** (the 401 flow, or any forced navigate). The question goes, nothing is discarded, and the next navigation asks afresh. Test: Task 2 (`DirtyGuard` R55 tests).
4. **The thing asked about disappearing** (another tab deletes it; the reload removes the row, the answer, the card or the script). The question goes without acting, and focus lands on a live neighbour, never `<body>`. Tests: Task 3 (#3, #5 and the route change), Task 5 (#2 R49), Task 6 (#9 R49, #12's 404).
5. **A fast double-click on a trigger whose question appears under the pointer.** The second click does not answer the question (R50); keyboard activation is not delayed. Test: Task 1 (InlineConfirm R50).

## Gate ladder

`EXPECTED_CHECKS` starts at **2062** (`frontend/scripts/visual-refresh-gate.sh:90`). Section (am) is created in Task 1; each later task appends its rows to it.

| Task | Adds | `EXPECTED_CHECKS` |
|---|---|---|
| start | | 2062 |
| 1 — The look | 86 | 2148 |
| 2 — Ask in place, links and modal footers | 15 | 2163 |
| 3 — Course tree deletes (#3, #4, #5) | 9 | 2172 |
| 4 — Versions (#16, #17, #18, #20, #21) | 7 | 2179 |
| 5 — The quiz edit slot (#14, #6, #2, D10) | 12 | 2191 |
| 6 — App and quiz-question removals (#9, #12) | 6 | 2197 |
| 7 — No pop-ups left | 2 | 2199 |
| 8 — Secondary buttons (D44, added after Task 7) | 14 | 2215 |

Executed: D43 (Task 4) added 2 checks, so the real values are Task 4 2181, Task 5 2193, Task 6 2199, Task 7 2201 (ledger rulings); Task 8's 2215 already counts from 2201.

## File map

Paths under `frontend/src` unless stated.

| File | Task | What changes |
|---|---|---|
| `styles/theme-default.css` | 1 | `--danger` `#C8102E`, `--danger-press`, `--primary-press`, re-derived `--danger-off-*`, `--cancel-*`, `--danger-panel-*` |
| `components/ui/InlineConfirm.svelte` | 1 | whole file: tone, 22px buttons, states, required `confirmLabel`, `message`, `layout`, `busy`, R50, `aria-describedby` |
| `components/ui/DangerConfirm.svelte` | 1 | `confirm` → `force`, `.dc-btn` classes, D40 panel colours |
| `components/ui/Button.svelte` | 1 | `.danger` follows D31 |
| `components/runs/RunTeachersTab.svelte`, `RunGroupsTab.svelte`, `pages/runs/RunListPage.svelte` | 1 | plain verbs (D35) |
| `components/runs/RunAssetsTab.svelte` | 1 | the replace confirm becomes InlineConfirm; labels |
| `components/runs/RunOverviewTab.svelte`, `MiniProjectModal.svelte` | 1, 2 | `tone="primary"` (1); MiniProjectModal's DirtyGuard owner (2) |
| `components/editor/AssetSidebar.svelte` | 1 | the hand-rolled `.confirm-pair` becomes InlineConfirm; busy question kept (P60) |
| `lib/askInPlace.svelte.ts` (new) | 2, 3 | `InPlaceAsk`, `Ask`, `Answer`, the discard asks, focus helpers, `useModalAsk`, `PageAsk`; (3) `settleTo`, `moveOn`, `withdraw`, `firstUsable`, `useTreeAsk` |
| `components/ui/AskSlot.svelte` (new) | 2 | draws a host's current question |
| `lib/editorReasons.ts`, `lib/dirtyRegistry.svelte.ts`, `lib/router.svelte.ts` | 2 | the two discard texts (R51); a comment; one router line (R47) |
| `components/editor/DirtyGuard.svelte` | 2 | whole file: `ask`, `pending`, R55 |
| `components/runs/DashboardSidePanel.svelte` | 2 | DirtyGuard owner; the discard questions in place |
| `components/editor/VersionSettingsModal.svelte`, `NewItemModal.svelte`, `quiz/ExplanationModal.svelte`, `quiz/NewQuestionModal.svelte`, `quiz/QuestionTextModal.svelte` | 2 | the footer questions #7, #8, #10, #11, #13, #15; page-question hosts |
| `components/editor/ItemEditorModal.svelte` | 2, 5 | (2) #19, the body-top row, `.body-rest`, the × rule; (5) the title's D10 |
| `pages/editor/VersionEditPage.svelte` | 2, 3, 4 | (2) the page row, `askPage`, the Discard rescue; (3) `useTreeAsk`, hooks; (4) #20, #21 in the state bar |
| `tests/support/ItemEditorModalHarness.svelte`, `tests/support/quizHarness.svelte.ts` | 2 | harness hosts; `renderQuiz`'s `page` option |
| `components/editor/TreeAskRow.svelte` (new) | 3 | the tree's one keyed question row |
| `components/editor/BlockAccordion.svelte`, `SequenceAccordion.svelte`, `AccordionHeader.svelte`, `ItemRow.svelte` | 3 | #3, #4, #5 |
| `pages/editor/VersionsPage.svelte` | 4 | #16, #17, #18; `li.ask-row` |
| `lib/quizEdits.svelte.ts` | 5 | async `request` / `requestStructure`, `EditHandle.ask`, `InlineEdit` asks in place |
| `components/editor/quiz/KeyQuestion.svelte` (new) | 5 | the key question's message and `keyAsk()` (R52) |
| `components/editor/quiz/InlineInput.svelte`, `KeyAnswer.svelte`, `ChoiceAnswers.svelte`, `QuestionCard.svelte` | 5, 6 | #14, #6, #2; (6) QuestionCard's `ask` prop and `.qask` |
| `components/editor/quiz/QuizBody.svelte` | 5, 6 | awaited D10 callers; (6) #12 `cardAsk` |
| `components/editor/item/AppBody.svelte` | 6 | #9 |
| `scripts/visual-refresh-gate.sh` (`frontend/`) | 1–7 | section (am), re-pins, `EXPECTED_CHECKS` |
| `docs/backlog/polish1-confirms-debt.md` (repo root) | 1, 7 | created (1); Safari list, VoiceOver-at-beta, Polish 2/3 candidates (7) |
| `docs/backlog/slice6a-teacher-restyle-debt.md`, `slice6c-teacher-overview-roster-panel-debt.md` | 7 | items marked done |

---

### Task 1: The look — tokens, InlineConfirm, DangerConfirm, Button danger, the existing confirms

**Files:**
- Modify: `frontend/src/styles/theme-default.css:36-38` (`--primary-press`), `:47` (`--danger`, `--danger-press`), `:67-73` (the `--danger-off-*` values, the new `--cancel-*` and `--danger-panel-*`)
- Modify: `frontend/src/components/ui/InlineConfirm.svelte` (whole file)
- Modify: `frontend/src/components/ui/DangerConfirm.svelte:44-61` (`confirm` → `force`), `:73-95` (button classes), `:97-154` (style)
- Modify: `frontend/src/components/ui/Button.svelte:90-91` (the `.danger` rules)
- Modify: `frontend/src/components/runs/RunTeachersTab.svelte:120`, `RunGroupsTab.svelte:182`, `pages/runs/RunListPage.svelte:161` (labels)
- Modify: `frontend/src/components/runs/RunAssetsTab.svelte:187-189` (`autoFocus` goes), `:614-619` (`onReplaceKeydown` goes), `:713-714`, `:814`, `:823-835`, `:955-961` (style)
- Modify: `frontend/src/components/runs/RunOverviewTab.svelte:348-355`, `MiniProjectModal.svelte:494-503` (`tone="primary"`)
- Modify: `frontend/src/components/editor/AssetSidebar.svelte:44-47`, `:98-142`, `:311-339`, `:349-359`, `:463-474`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (b4 `:525-537`, DangerConfirm `:4734` and `:4736`, new section (am) before `# The summary line is the parent process's (see the re-exec at the top).`, `EXPECTED_CHECKS` at `:90`)
- Create: `docs/backlog/polish1-confirms-debt.md`
- Test: `frontend/src/tests/InlineConfirm.svelte.test.ts` (rewritten), `AssetSidebar.svelte.test.ts`, `AssetSidebar.run-mode.svelte.test.ts`, `RunAssetsTab.svelte.test.ts`, `RunListPage.svelte.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - Tokens `--danger: #C8102E`, `--danger-press`, `--primary-press`, `--cancel-border`, `--cancel-hover`, `--cancel-press`, `--danger-panel-bg`, `--danger-panel-fg`.
  - `InlineConfirm` props: `confirmLabel: string` (required), `confirmDataAction?: string`, `warning?: string` | `message?: Snippet` (exclusive), `onConfirm: () => void`, `onCancel?: () => void`, `takeFocus?: boolean`, `label?: string`, `tone?: 'danger' | 'primary'` (default `'danger'`), `layout?: 'row' | 'column'`, `row?: boolean` (alias), `align?: 'start' | 'end'` (D42), `busy?: boolean`. Hooks: `.inline-confirm`, `.row`, `.warning`, `button.confirm` (+ `.danger` / `.primary`), `button.cancel`, both `.ic-btn`.
  - Busy title text `'Wait for the request to finish'` on both buttons.
  - Gate section (am) with the `hover_only` helper; Tasks 2–7 append to it.

- [ ] **Step 1: Rewrite the InlineConfirm tests (failing)**

Replace the whole of `frontend/src/tests/InlineConfirm.svelte.test.ts` with:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet, type ComponentProps } from 'svelte';
import InlineConfirm from '../components/ui/InlineConfirm.svelte';

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => { target = document.createElement('div'); document.body.appendChild(target); });
afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.removeChild(target);
  vi.restoreAllMocks();
});

function render(props: Partial<ComponentProps<typeof InlineConfirm>> = {}) {
  component = mount(InlineConfirm, {
    target,
    props: { confirmLabel: 'Delete', onConfirm: () => {}, ...props } as ComponentProps<typeof InlineConfirm>,
  });
  flushSync();
  const [confirm, cancel] = Array.from(target.querySelectorAll('button')) as HTMLButtonElement[];
  return { confirm: confirm!, cancel: cancel!, group: target.querySelector('.inline-confirm') as HTMLElement };
}

const esc = () => new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

describe('InlineConfirm', () => {
  it('renders the confirm label, then Cancel', () => {
    const { confirm, cancel } = render();
    expect(confirm.textContent?.trim()).toBe('Delete');
    expect(cancel.textContent?.trim()).toBe('Cancel');
  });

  it('renders warning above the pair when provided', () => {
    render({ warning: 'Students lose access.' });
    expect(target.querySelector('.warning')?.textContent).toBe('Students lose access.');
  });

  it('Confirm click invokes onConfirm', () => {
    const onConfirm = vi.fn();
    render({ onConfirm }).confirm.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Cancel click invokes onCancel (when provided) and does NOT invoke onConfirm', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render({ onConfirm, onCancel }).cancel.click();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Cancel click without onCancel prop is a no-op (no throw)', () => {
    const { cancel } = render();
    expect(() => cancel.click()).not.toThrow();
  });

  it('confirmDataAction is reflected on the confirm button when provided', () => {
    expect(render({ confirmDataAction: 'confirm-delete-item' }).confirm.getAttribute('data-action')).toBe('confirm-delete-item');
  });

  it('takeFocus: Cancel takes focus on mount (6a P3)', () => {
    const { cancel } = render({ onCancel: () => {}, takeFocus: true });
    expect(document.activeElement).toBe(cancel);
  });

  it('takeFocus: the group scrolls into view before Cancel takes focus (Polish 1)', () => {
    const calls: string[] = [];
    const proto = HTMLElement.prototype as unknown as { scrollIntoView?: (o?: unknown) => void };
    const had = 'scrollIntoView' in proto;
    proto.scrollIntoView = function (this: HTMLElement, o?: unknown) {
      calls.push(`${this.className.split(' ')[0]} ${JSON.stringify(o)}`);
    };
    try {
      render({ takeFocus: true });
      expect(calls).toEqual(['inline-confirm {"block":"nearest"}']);
    } finally {
      if (!had) delete proto.scrollIntoView;
    }
  });

  it('takeFocus: Esc on either button cancels', () => {
    const onCancel = vi.fn();
    const { confirm, cancel } = render({ onCancel, takeFocus: true });
    cancel.dispatchEvent(esc());
    confirm.dispatchEvent(esc());
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('without takeFocus: focus is untouched and Esc is ignored', () => {
    const onCancel = vi.fn();
    const before = document.activeElement;
    const { cancel } = render({ onCancel });
    expect(document.activeElement).toBe(before);
    cancel.dispatchEvent(esc());
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('is a group named by its warning, so a screen reader says what Cancel cancels (final review)', () => {
    const { group } = render({ warning: 'Delete this asset?', takeFocus: true });
    expect(group.getAttribute('role')).toBe('group');
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toBe('Delete this asset?');
  });

  it('a label names the group when there is no warning (final review)', () => {
    const { group } = render({ label: 'Delete Alpha?' });
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Delete Alpha?');
  });

  it('with a label and a warning, the warning describes the group and both buttons (Polish 1)', () => {
    const { group, confirm, cancel } = render({ label: 'Replace doc.pdf?', warning: 'The content is overwritten.' });
    const id = target.querySelector('.warning')!.id;
    expect(id).not.toBe('');
    expect(group.getAttribute('aria-label')).toBe('Replace doc.pdf?');
    expect(group.hasAttribute('aria-labelledby')).toBe(false);
    expect(group.getAttribute('aria-describedby')).toBe(id);
    expect(confirm.getAttribute('aria-describedby')).toBe(id);
    expect(cancel.getAttribute('aria-describedby')).toBe(id);
  });

  it('without a label, the buttons carry no aria-describedby (the warning already names the group)', () => {
    const { confirm, cancel } = render({ warning: 'Delete this asset?' });
    expect(confirm.hasAttribute('aria-describedby')).toBe(false);
    expect(cancel.hasAttribute('aria-describedby')).toBe(false);
  });

  it('with neither, it is no group', () => {
    expect(render().group.hasAttribute('role')).toBe(false);
  });

  it('a message snippet renders in the .warning slot with its markup and names the group (R52)', () => {
    const message = createRawSnippet(() => ({
      render: () => '<span><strong>Change the answer key?</strong> Scores keep the old key.</span>',
    }));
    const { group } = render({ message, confirmLabel: 'Change key', tone: 'primary' });
    const warn = target.querySelector('.warning')!;
    expect(warn.querySelector('strong')?.textContent).toBe('Change the answer key?');
    expect(group.getAttribute('aria-labelledby')).toBe(warn.id);
  });

  it('`row` lays the question and the two buttons out on one line (Safari pass)', () => {
    expect(render({ warning: 'Delete this asset?', row: true }).group.classList.contains('row')).toBe(true);
  });

  it('without `row` or `layout` it stays stacked', () => {
    expect(render({ warning: 'Delete this asset?' }).group.classList.contains('row')).toBe(false);
  });

  it('layout="row" is the same as `row`; layout="column" wins over `row`', () => {
    expect(render({ warning: 'x', layout: 'row' }).group.classList.contains('row')).toBe(true);
    unmount(component!);
    component = null;
    expect(render({ warning: 'x', layout: 'column', row: true }).group.classList.contains('row')).toBe(false);
  });

  it('tone: the confirm carries danger by default and primary on request; both buttons are ic-btn', () => {
    const { confirm, cancel } = render();
    expect(confirm.classList.contains('danger')).toBe(true);
    expect(confirm.classList.contains('ic-btn')).toBe(true);
    expect(cancel.classList.contains('ic-btn')).toBe(true);
    unmount(component!);
    component = null;
    const p = render({ tone: 'primary', confirmLabel: 'Publish' });
    expect(p.confirm.classList.contains('primary')).toBe(true);
    expect(p.confirm.classList.contains('danger')).toBe(false);
  });

  it('busy: both buttons are aria-disabled with the reason, the confirm is aria-busy with a spinner, and nothing acts (R54)', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { confirm, cancel } = render({ onConfirm, onCancel, takeFocus: true, busy: true });
    for (const b of [confirm, cancel]) {
      expect(b.disabled).toBe(false);
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.getAttribute('title')).toBe('Wait for the request to finish');
    }
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(cancel.hasAttribute('aria-busy')).toBe(false);
    expect(confirm.querySelector('.spinner')).not.toBeNull();
    confirm.click();
    cancel.click();
    const e = esc();
    cancel.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('idle: no aria-disabled, no aria-busy, no spinner, no title', () => {
    const { confirm, cancel } = render();
    for (const b of [confirm, cancel]) {
      expect(b.hasAttribute('aria-disabled')).toBe(false);
      expect(b.hasAttribute('title')).toBe(false);
    }
    expect(confirm.hasAttribute('aria-busy')).toBe(false);
    expect(confirm.querySelector('.spinner')).toBeNull();
  });

  it('R50: a pointer click within 400 ms of opening is ignored; keyboard / el.click() (detail 0) is not', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { confirm, cancel } = render({ onConfirm, onCancel });
    now.mockReturnValue(1200);
    confirm.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    cancel.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    confirm.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1401);
    cancel.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/InlineConfirm.svelte.test.ts`
Expected: FAIL. The scroll test sees no call; the describedby, message, layout, tone, busy and R50 tests fail (no such props or classes). Eleven tests still pass; they pin today's behaviour.

- [ ] **Step 3: Rewrite `InlineConfirm.svelte`**

Replace the whole of `frontend/src/components/ui/InlineConfirm.svelte` with:

```svelte
<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  // `takeFocus` (Slice-6a): Cancel takes focus when the confirm opens, so Esc
  // reaches it, and Esc on either button cancels. Callers that pass it return
  // focus to their opener in onCancel. The confirm is a group named by its
  // warning (or by `label` when there is none), so a screen reader landing
  // on Cancel hears the question first. With both, the warning describes the
  // group and both buttons.
  // Polish 1: small real buttons, red or steel blue by `tone` (D31, D33).
  // `busy` keeps the question in place while its action runs: both buttons
  // are aria-disabled and keep focus, and nothing answers (R54). A pointer
  // click in the first 400 ms is ignored, so the double-click that opened the
  // question cannot answer it (R50); keyboard and el.click() have detail 0.
  // `message` (a snippet with markup, R52) and `warning` (plain text) fill the
  // same slot; askInPlace's `Ask` type keeps them exclusive (P62).
  type Props = {
    warning?: string;
    message?: Snippet;
    confirmLabel: string;
    confirmDataAction?: string;
    onConfirm: () => void;
    onCancel?: () => void;
    takeFocus?: boolean;
    label?: string;
    tone?: 'danger' | 'primary';
    layout?: 'row' | 'column';
    // The 6a alias of layout="row" (the question and both buttons on one line).
    row?: boolean;
    busy?: boolean;
  };
  let {
    confirmLabel,
    confirmDataAction,
    warning,
    message,
    onConfirm,
    onCancel,
    takeFocus = false,
    label,
    tone = 'danger',
    layout,
    row = false,
    busy = false,
  }: Props = $props();

  const WAIT = 'Wait for the request to finish';
  const uid = $props.id();
  const warnId = `${uid}-warn`;
  const hasText = $derived(Boolean(message || warning));
  const named = $derived(Boolean(label || hasText));
  const isRow = $derived(layout ? layout === 'row' : row);
  const describedBy = $derived(label && hasText ? warnId : undefined);

  const openedAt = performance.now();
  let groupEl = $state<HTMLDivElement>();
  let cancelEl = $state<HTMLButtonElement>();
  onMount(() => {
    if (!takeFocus) return;
    groupEl?.scrollIntoView?.({ block: 'nearest' });
    cancelEl?.focus();
  });

  const tooSoon = (e: MouseEvent) => e.detail > 0 && performance.now() - openedAt < 400;
  function confirmClick(e: MouseEvent) {
    if (tooSoon(e) || busy) return;
    onConfirm();
  }
  function cancelClick(e: MouseEvent) {
    if (tooSoon(e) || busy) return;
    onCancel?.();
  }
  function onKeydown(e: KeyboardEvent) {
    if (!takeFocus || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (!busy) onCancel?.();
  }
</script>

<div class="inline-confirm" class:row={isRow} bind:this={groupEl} role={named ? 'group' : undefined} aria-label={label}
     aria-labelledby={!label && hasText ? warnId : undefined} aria-describedby={describedBy}>
  {#if message}<div class="warning" id={warnId}>{@render message()}</div>
  {:else if warning}<div class="warning" id={warnId}>{warning}</div>{/if}
  <div class="actions">
    <button type="button" class="ic-btn confirm {tone}" data-action={confirmDataAction}
            aria-disabled={busy ? 'true' : undefined} aria-busy={busy ? 'true' : undefined}
            aria-describedby={describedBy} title={busy ? WAIT : undefined}
            onclick={confirmClick} onkeydown={onKeydown}>{#if busy}<span class="spinner" aria-hidden="true"></span>{/if}{confirmLabel}</button>
    <button type="button" class="ic-btn cancel" bind:this={cancelEl}
            aria-disabled={busy ? 'true' : undefined} aria-describedby={describedBy} title={busy ? WAIT : undefined}
            onclick={cancelClick} onkeydown={onKeydown}>Cancel</button>
  </div>
</div>

<style>
  .inline-confirm { display: inline-flex; flex-direction: column; gap: 4px; }
  .inline-confirm.row { flex-direction: row; align-items: center; gap: 12px; }
  /* A long title or an unbroken name wraps inside the question, so the
     buttons stay on screen (Review Focus 1). */
  .warning { font-size: 12.5px; line-height: 1.5; color: var(--muted); overflow-wrap: anywhere; }
  .warning :global(code) { font-family: var(--font-mono); background: var(--surface); padding: 0 4px; border-radius: var(--radius-pill); }
  .warning :global(strong) { color: var(--text-2); font-weight: 600; }
  .actions { display: inline-flex; gap: 6px; }
  /* D31, D34: small real buttons. Outlined at rest; filled on hover (pointer
     devices only, R50) and on keyboard focus; darker while pressed. Every
     state rule skips an aria-disabled (busy) button, so its look wins. */
  .ic-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 9px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: var(--surface);
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
  }
  .danger { color: var(--danger); border-color: var(--danger); }
  .primary { color: var(--primary); border-color: var(--primary); }
  .cancel { color: var(--text-3); border-color: var(--cancel-border); }
  @media (hover: hover) {
    .danger:not([aria-disabled="true"]):hover { background: var(--danger); color: var(--primary-text); }
    .primary:not([aria-disabled="true"]):hover { background: var(--primary); color: var(--primary-text); }
    .cancel:not([aria-disabled="true"]):hover { background: var(--cancel-hover); }
  }
  .danger:not([aria-disabled="true"]):focus-visible { background: var(--danger); color: var(--primary-text); }
  .primary:not([aria-disabled="true"]):focus-visible { background: var(--primary); color: var(--primary-text); }
  .cancel:not([aria-disabled="true"]):focus-visible { background: var(--cancel-hover); }
  .danger:not([aria-disabled="true"]):active { background: var(--danger-press); border-color: var(--danger-press); color: var(--primary-text); }
  .primary:not([aria-disabled="true"]):active { background: var(--primary-press); border-color: var(--primary-press); color: var(--primary-text); }
  .cancel:not([aria-disabled="true"]):active { background: var(--cancel-press); }
  /* The ring sits outside the button, on the page (P57). */
  .ic-btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; box-shadow: none; }
  /* Busy (6b P23): the confirm keeps its rest look with a spinner; Cancel
     takes the blocked look (Button's .btn.blocked). */
  .confirm[aria-busy="true"] { cursor: progress; }
  .cancel[aria-disabled="true"] { background: var(--bg); color: var(--faint); border-color: var(--border-faint); cursor: not-allowed; }
  @media (pointer: coarse) {
    .ic-btn { min-height: 28px; }
  }
  .spinner {
    display: inline-block;
    width: .75rem;
    height: .75rem;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
```

- [ ] **Step 4: Run the InlineConfirm tests to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/InlineConfirm.svelte.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Add the tokens**

In `frontend/src/styles/theme-default.css`, after the line `  --primary-soft: #EAEFF4;    /* code badges, current item, hover fills */` add:

```css
  --primary-press: #2F465B;   /* a pressed primary confirm (Polish 1 D31) */
```

Replace

```css
  --danger: #991B1B;
```

with

```css
  --danger: #C8102E;          /* 5.9:1 on white, 4.6:1 on --focus-2 (Polish 1 D32) */
  --danger-press: #A50D26;    /* a pressed danger button */
```

Replace the three `--danger-off-*` lines

```css
  --danger-off-bg: #FFFAFA;
  --danger-off-border: #F2D9D9;
  --danger-off-text: #C99B9B;
```

with

```css
  --danger-off-bg: #FFF7F8;
  --danger-off-border: #F4D2D8;
  --danger-off-text: #DFA3AE;

  /* --- confirm buttons (Polish 1 D31): Cancel's outline and fills --- */
  --cancel-border: var(--focus-line-strong);
  --cancel-hover: var(--focus-1);
  --cancel-press: var(--focus-2);

  /* --- the danger panel (Polish 1 D40): its text is 9.2:1 on its background,
     --danger 5.3:1, --text-2 12.1:1. The status badges keep --status-rejected-*. --- */
  --danger-panel-bg: #FDF0F2;
  --danger-panel-fg: #7A1F2B;
```

- [ ] **Step 6: DangerConfirm — the panel, the small buttons and `force()`**

In `frontend/src/components/ui/DangerConfirm.svelte` replace

```ts
  async function confirm() {
```

with

```ts
  async function force() {
```

Replace the two buttons (`:80-93`)

```svelte
    <button
      type="button"
      class="dc-force"
```

with

```svelte
    <button
      type="button"
      class="dc-btn dc-force"
```

and in the same element `onclick={confirm}` with `onclick={force}`. Replace

```svelte
    <button type="button" class="dc-cancel" disabled={busy} onclick={onCancel} onkeydown={onKeydown}>Cancel</button>
```

with

```svelte
    <button type="button" class="dc-btn dc-cancel" disabled={busy} onclick={onCancel} onkeydown={onKeydown}>Cancel</button>
```

Replace the whole `<style>` block with:

```svelte
<style>
  .danger-confirm {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    background: var(--danger-panel-bg);
    border-left: 3px solid var(--danger);
    border-radius: var(--radius);
  }
  .dc-msg { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--danger-panel-fg); }
  .dc-msg :global(code) { font-family: var(--font-mono); background: var(--surface); padding: 0 4px; border-radius: var(--radius-pill); }
  .dc-ack { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-2); }
  .dc-actions { display: flex; gap: 6px; }
  /* D34: InlineConfirm's small button geometry. */
  .dc-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 9px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
  }
  /* Unarmed (and natively disabled): the muted red family, never grey, no fills. */
  .dc-force {
    background: var(--danger-off-bg);
    color: var(--danger-off-text);
    border: 1px solid var(--danger-off-border);
    cursor: not-allowed;
  }
  /* Armed: the red action at rest (D31). Busy keeps this look with the spinner. */
  .dc-force.armed {
    background: var(--surface);
    color: var(--danger);
    border-color: var(--danger);
    cursor: pointer;
  }
  .dc-force.armed[aria-busy="true"] { cursor: progress; }
  .dc-cancel {
    background: var(--surface);
    color: var(--text-3);
    border: 1px solid var(--cancel-border);
    cursor: pointer;
  }
  @media (hover: hover) {
    .dc-force.armed:not(:disabled):hover { background: var(--danger); color: var(--primary-text); }
    .dc-cancel:not(:disabled):hover { background: var(--cancel-hover); }
  }
  .dc-force.armed:not(:disabled):focus-visible { background: var(--danger); color: var(--primary-text); }
  .dc-cancel:not(:disabled):focus-visible { background: var(--cancel-hover); }
  .dc-force.armed:not(:disabled):active { background: var(--danger-press); border-color: var(--danger-press); color: var(--primary-text); }
  .dc-cancel:not(:disabled):active { background: var(--cancel-press); }
  /* Armed or not, a focused button shows the ring (P57). */
  .dc-btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; box-shadow: none; }
  .dc-cancel:disabled {
    background: var(--bg);
    color: var(--faint);
    border-color: var(--border-faint);
    cursor: not-allowed;
  }
  @media (pointer: coarse) {
    .dc-btn { min-height: 28px; }
  }
  .dc-spin {
    width: 10px;
    height: 10px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: dc-spin 0.6s linear infinite;
  }
  @keyframes dc-spin { to { transform: rotate(360deg); } }
</style>
```

- [ ] **Step 7: Button — the danger states**

In `frontend/src/components/ui/Button.svelte` replace

```css
  /* Danger is a text treatment, never a red fill. */
  .danger { background: transparent; color: var(--danger); }
```

with

```css
  /* D31: outlined at rest, filled on hover (pointer devices) and on keyboard
     focus, darker while pressed. Disabled, blocked and busy keep their looks. */
  .danger { background: var(--surface); color: var(--danger); border-color: var(--danger); }
  @media (hover: hover) {
    .danger:not(:disabled):not(.blocked):not([aria-busy="true"]):hover { background: var(--danger); color: var(--primary-text); }
  }
  .danger:not(:disabled):not(.blocked):not([aria-busy="true"]):focus-visible { background: var(--danger); color: var(--primary-text); }
  .danger:not(:disabled):not(.blocked):not([aria-busy="true"]):active { background: var(--danger-press); border-color: var(--danger-press); color: var(--primary-text); }
  .danger:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; box-shadow: none; }
```

- [ ] **Step 8: The existing confirms' labels and tones**

- `frontend/src/components/runs/RunTeachersTab.svelte:120`: `confirmLabel="Confirm Remove"` → `confirmLabel="Remove"`.
- `frontend/src/components/runs/RunGroupsTab.svelte:182`: `confirmLabel="Confirm Delete"` → `confirmLabel="Delete"`.
- `frontend/src/pages/runs/RunListPage.svelte:161`: `confirmLabel="Confirm Delete"` → `confirmLabel="Delete"`.
- `frontend/src/components/runs/RunOverviewTab.svelte`: in the Unpublish `<InlineConfirm` (`:348`), add the line `tone="primary"` after `takeFocus`.
- `frontend/src/components/runs/MiniProjectModal.svelte`: in the publish `<InlineConfirm` (`:495`, the one with `confirmDataAction="confirm-publish"`), add the line `tone="primary"` after `takeFocus`.
- `frontend/src/components/runs/RunAssetsTab.svelte:713-714`: replace

```svelte
          <InlineConfirm takeFocus warning="Delete {total} selected ({bc.orphanCount} orphan, {bc.referencedCount} referenced)?"
                         onConfirm={performBulkDelete} onCancel={() => void cancelBulk()} />
```

with

```svelte
          <InlineConfirm takeFocus warning="Delete {total} selected ({bc.orphanCount} orphan, {bc.referencedCount} referenced)?"
                         confirmLabel="Delete" onConfirm={performBulkDelete} onCancel={() => void cancelBulk()} />
```

- `RunAssetsTab.svelte:814`: replace

```svelte
                <InlineConfirm row takeFocus warning="Delete this asset?" onConfirm={performDelete} onCancel={() => cancelDelete(a.id)} />
```

with

```svelte
                <InlineConfirm row takeFocus warning="Delete this asset?" confirmLabel="Delete" onConfirm={performDelete} onCancel={() => cancelDelete(a.id)} />
```

- In `frontend/src/tests/RunListPage.svelte.test.ts:154` and `:169`, replace `=== 'Confirm Delete'` with `=== 'Delete'`.

- [ ] **Step 9: Write the failing RunAssetsTab replace test**

In `frontend/src/tests/RunAssetsTab.svelte.test.ts`, first run the label rewrite (P59):

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && sed -i '' 's#/\^Confirm\$/#/^(Delete|Replace)$/#g' src/tests/RunAssetsTab.svelte.test.ts && grep -c '/\^(Delete|Replace)\$/' src/tests/RunAssetsTab.svelte.test.ts
```

Expected: `41`.

Then replace (`:2489`)

```ts
    expect(row.querySelector('.row-confirm code')?.textContent).toBe('doc.pdf');
```

with

```ts
    expect(row.querySelector('.inline-confirm .warning code')?.textContent).toBe('doc.pdf');
```

and (`:2491`)

```ts
    expect(cells.querySelector('.row-confirm')).toBeNull();
```

with

```ts
    expect(cells.querySelector('.inline-confirm')).toBeNull();
```

Append inside the same `describe` that holds "the replace confirm gives Cancel the focus; Cancel and Esc return it to Replace", after that test:

```ts
  it('the replace question is an InlineConfirm column named "Replace <file>?", its button "Replace" (Polish 1)', async () => {
    component = mount(RunAssetsTab, { target, props: baseProps({ assets: [mkAsset(1, 'doc.pdf')] }) });
    flushSync();
    replaceBtn()!.click();
    flushSync();
    pickReplaceFile(new File(['N'], 'doc.pdf', { type: 'application/pdf' }));
    await settle();
    const g = target.querySelector('tr.replace-row .inline-confirm') as HTMLElement;
    expect(g.getAttribute('aria-label')).toBe('Replace doc.pdf?');
    expect(g.classList.contains('row')).toBe(false);
    const confirm = g.querySelector('button.confirm') as HTMLButtonElement;
    expect(confirm.textContent?.trim()).toBe('Replace');
    expect(confirm.classList.contains('danger')).toBe(true);
    expect(g.querySelector('.warning')?.textContent).toContain('cannot be recovered');
    expect(document.activeElement).toBe(g.querySelector('button.cancel'));
  });
```

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunAssetsTab.svelte.test.ts`
Expected: FAIL — the new test finds no `.inline-confirm` in the replace row, the `:2489` line finds no `.inline-confirm .warning code`, and every replace test that looks up `/^(Delete|Replace)$/` to confirm finds the old "Confirm" button no longer matches. The delete and bulk tests pass (Step 8 named them "Delete").

- [ ] **Step 10: RunAssetsTab — the replace question on InlineConfirm**

In `frontend/src/components/runs/RunAssetsTab.svelte` replace the replace row's body (`:826-835`)

```svelte
                <div class="row-confirm" role="group" aria-label="Replace {a.filename}">
                  <p>
                    Replace <code>{a.filename}</code> (new size: {formatFileSize(rc.file.size)})?
                    The current content will be overwritten and cannot be recovered.
                    {#if refIds.length > 0}
                      {refIds.length} mini-project{refIds.length === 1 ? '' : 's'} that reference this file will continue to point at the new content.
                    {/if}
                  </p>
                  <div class="rc-actions">
                    <button type="button" class="rc-confirm" onclick={performReplace} onkeydown={(e) => onReplaceKeydown(e, a.id)}>Confirm</button>
                    <button type="button" class="rc-cancel" use:autoFocus onclick={() => onReplaceCancel(a.id)} onkeydown={(e) => onReplaceKeydown(e, a.id)}>Cancel</button>
                  </div>
                </div>
```

with

```svelte
                {#snippet replaceMessage()}
                  Replace <code>{a.filename}</code> (new size: {formatFileSize(rc.file.size)})?
                  The current content will be overwritten and cannot be recovered.
                  {#if refIds.length > 0}
                    {refIds.length} mini-project{refIds.length === 1 ? '' : 's'} that reference this file will continue to point at the new content.
                  {/if}
                {/snippet}
                <InlineConfirm takeFocus layout="column" label="Replace {a.filename}?" message={replaceMessage}
                               confirmLabel="Replace" onConfirm={performReplace} onCancel={() => onReplaceCancel(a.id)} />
```

Delete the now unused `autoFocus` function (`:187-189`) and `onReplaceKeydown` (`:614-619`, including its blank line). Delete these style lines (`:955-961`):

```css
  .row-confirm { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px; background: var(--surface-2); border-left: 3px solid var(--primary); border-radius: var(--radius); font-size: 12.5px; color: var(--text-2); }
  .row-confirm p { margin: 0; }
  .row-confirm code, .sp-head code { font-family: var(--font-mono); }
  .rc-actions { display: flex; gap: 6px; }
  .rc-confirm, .rc-cancel { padding: var(--btn-pad); border-radius: var(--radius); font: inherit; font-size: var(--control-font); cursor: pointer; }
  .rc-confirm { background: var(--primary); color: var(--primary-text); border: 1px solid var(--primary); }
  .rc-cancel { background: var(--surface); color: var(--text); border: 1px solid var(--border-strong); }
```

and put back the one declaration another rule shared:

```css
  .sp-head code { font-family: var(--font-mono); }
```

(If `refIds` is not in scope at the snippet — it is an `{@const}` of the row at `:780-800` — the snippet sees it, because a snippet closes over the block it is declared in.)

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunAssetsTab.svelte.test.ts`
Expected: PASS.

- [ ] **Step 11: Write the failing AssetSidebar tests**

First move the existing tests to the row's InlineConfirm hooks:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && sed -i '' \
  -e 's#\[data-testid="delete-confirm"\]#.inline-confirm button.confirm#g' \
  -e 's#\[data-testid="delete-cancel"\]#.inline-confirm button.cancel#g' \
  src/tests/AssetSidebar.svelte.test.ts src/tests/AssetSidebar.run-mode.svelte.test.ts \
  && grep -c 'delete-confirm\|delete-cancel' src/tests/AssetSidebar.svelte.test.ts src/tests/AssetSidebar.run-mode.svelte.test.ts
```

Expected: `0` for both files.

In `AssetSidebar.svelte.test.ts`, the in-flight assertions move from native `disabled` to `aria-disabled` (R54). Replace (in "confirm button is disabled while delete is in flight (re-entrancy guard)")

```ts
    expect(confirm.disabled).toBe(true);
```

with

```ts
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    confirm.click();
    expect(stubCtx.remove).toHaveBeenCalledTimes(1);
```

and rename that test to `'the question stays, busy, while the delete is in flight (re-entrancy guard, R54)'`. In "cross-row delete race…" replace

```ts
    expect(confirm2.disabled).toBe(false);
```

with

```ts
    expect(confirm2.hasAttribute('aria-disabled')).toBe(false);
```

and both

```ts
    expect(confirm2.disabled).toBe(true);
```

and

```ts
    expect(confirm2After.disabled).toBe(true);
```

with the same assertion on `getAttribute('aria-disabled')`:

```ts
    expect(confirm2.getAttribute('aria-disabled')).toBe('true');
```

```ts
    expect(confirm2After.getAttribute('aria-disabled')).toBe('true');
```

Append at the end of the file:

```ts
describe('AssetSidebar — the delete question (Polish 1)', () => {
  const settleAll = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); flushSync(); } };

  // The sidebar inside a modal panel, as MarkdownEditor mounts it in the item
  // and mini-project modals; `disabled` flips through the $state props.
  function mountInPanel() {
    const panel = document.createElement('section');
    panel.className = 'modal-panel';
    panel.tabIndex = -1;
    document.body.appendChild(panel);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: any = $state({
      assetContext: stubCtx,
      onInsert: vi.fn(),
      onUploadFile: vi.fn(),
      disabled: false,
      uploading: false,
    });
    const cmp = mount(AssetSidebar, { target: panel, props });
    cleanup = () => unmount(cmp);
    return { panel, props };
  }

  it('the question is a row named "Delete <file>?" with Delete and Cancel; Cancel focuses the trash', async () => {
    (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([mkAsset({ id: 1, filename: 'a.png' })]);
    const { panel } = mountInPanel();
    await settleAll();
    panel.querySelector<HTMLButtonElement>('[data-testid="delete-trash"] button')!.click();
    flushSync();
    const g = panel.querySelector('.inline-confirm') as HTMLElement;
    expect(g.getAttribute('aria-label')).toBe('Delete a.png?');
    expect(g.querySelector('button.confirm')?.textContent?.trim()).toBe('Delete');
    expect(document.activeElement).toBe(g.querySelector('button.cancel'));
    (g.querySelector('button.cancel') as HTMLButtonElement).click();
    await settleAll();
    expect(panel.querySelector('.inline-confirm')).toBeNull();
    expect(document.activeElement).toBe(panel.querySelector('[data-testid="delete-trash"] button'));
  });

  it('turning disabled while the question is idle closes it, deletes nothing, and focus goes to the panel', async () => {
    (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([mkAsset({ id: 1, filename: 'a.png' })]);
    const { panel, props } = mountInPanel();
    await settleAll();
    panel.querySelector<HTMLButtonElement>('[data-testid="delete-trash"] button')!.click();
    flushSync();
    props.disabled = true;
    await settleAll();
    expect(panel.querySelector('.inline-confirm')).toBeNull();
    expect(stubCtx.remove).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(panel);
  });

  it('turning disabled while the delete runs keeps the busy question; once it settles focus goes to the panel, never <body>', async () => {
    let resolve!: () => void;
    (stubCtx.remove as ReturnType<typeof vi.fn>).mockReturnValue(new Promise<void>((r) => { resolve = r; }));
    (stubCtx.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([mkAsset({ id: 1, filename: 'a.png' })])
      .mockResolvedValue([]);
    const { panel, props } = mountInPanel();
    await settleAll();
    panel.querySelector<HTMLButtonElement>('[data-testid="delete-trash"] button')!.click();
    flushSync();
    (panel.querySelector('.inline-confirm button.confirm') as HTMLButtonElement).click();
    flushSync();
    props.disabled = true;
    await settleAll();
    const busy = panel.querySelector('.inline-confirm button.confirm') as HTMLButtonElement;
    expect(busy.getAttribute('aria-busy')).toBe('true');
    resolve();
    await settleAll();
    expect(panel.querySelector('.inline-confirm')).toBeNull();
    expect(document.activeElement).toBe(panel);
  });

  it('the drop zone is aria-disabled with its reason while the sidebar is disabled or uploading', async () => {
    const { panel, props } = mountInPanel();
    await settleAll();
    const zone = panel.querySelector('[data-testid="drop-zone"]') as HTMLElement;
    expect(zone.hasAttribute('aria-disabled')).toBe(false);
    expect(zone.hasAttribute('title')).toBe(false);
    props.disabled = true;
    flushSync();
    expect(zone.getAttribute('aria-disabled')).toBe('true');
    expect(zone.getAttribute('title')).toBe('Wait for the request to finish');
    props.uploading = true;
    flushSync();
    expect(zone.getAttribute('title')).toBe('Wait for the upload to finish');
  });
});
```

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/AssetSidebar.svelte.test.ts src/tests/AssetSidebar.run-mode.svelte.test.ts`
Expected: FAIL — every test that opens the question finds no `.inline-confirm`; the drop-zone test finds no `aria-disabled`.

- [ ] **Step 12: AssetSidebar on InlineConfirm**

In `frontend/src/components/editor/AssetSidebar.svelte`:

Add the import after `import IconButton from '../ui/IconButton.svelte';`:

```ts
  import InlineConfirm from '../ui/InlineConfirm.svelte';
```

Replace the block from `// R7: the inline confirm takes focus on Cancel` through the end of `onConfirmKeydown` (`:89-111`):

```ts
  // R7: the inline confirm takes focus on Cancel so Escape reaches it, and
  // gives it back to the row's trash when it closes.
  const trashEls = $state<Record<number, HTMLButtonElement | undefined>>({});
  const cancelEls = $state<Record<number, HTMLButtonElement | undefined>>({});
  async function askDelete(id: number) {
    if (disabled) return;
    confirmId = id;
    await tick();
    cancelEls[id]?.focus();
  }
  async function cancelDelete() {
    const id = confirmId;
    confirmId = null;
    await tick();
    if (id !== null) trashEls[id]?.focus();
  }
  // Escape = Cancel. preventDefault so an enclosing modal does not close (§1).
  function onConfirmKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    void cancelDelete();
  }
```

with

```ts
  // R7: the question (InlineConfirm, takeFocus) puts focus on its Cancel, so
  // Escape reaches it (default-prevented, so an enclosing modal stays open), and
  // Cancel gives it back to the row's trash.
  const trashEls = $state<Record<number, HTMLButtonElement | undefined>>({});
  function askDelete(id: number) {
    if (disabled) return;
    confirmId = id;
  }
  async function cancelDelete() {
    const id = confirmId;
    confirmId = null;
    await tick();
    if (id !== null) trashEls[id]?.focus();
  }
  // An idle question closes when the sidebar turns disabled (a save or another
  // request froze the editor); a busy one stays until its DELETE settles (R54).
  $effect(() => {
    if (!disabled || confirmId === null || deletingIds.has(confirmId)) return;
    const id = confirmId;
    const idx = untrack(() => assets.findIndex((a) => a.id === id));
    const inside = asideEl?.querySelector('.inline-confirm')?.contains(document.activeElement) ?? false;
    confirmId = null;
    if (inside) void refocusAfterDelete(id, idx);
  });
```

and change the first import line to `import { onMount, tick, untrack } from 'svelte';`.

In `refocusAfterDelete`, replace

```ts
    const near = [trashEls[id], trashEls[assets[idx]?.id ?? -1], trashEls[assets[idx - 1]?.id ?? -1]];
    const target = near.find((el) => el?.isConnected && !el.disabled) ?? dropZoneEl;
    target?.focus();
```

with

```ts
    const near: (HTMLElement | null | undefined)[] = [
      trashEls[id], trashEls[assets[idx]?.id ?? -1], trashEls[assets[idx - 1]?.id ?? -1], dropZoneEl,
    ];
    const target = near.find(usable) ?? asideEl?.closest<HTMLElement>('section.modal-panel');
    target?.focus();
```

and add after `refocusAfterDelete`:

```ts
  // A focus target counts only if it is connected, enabled (natively and by
  // aria) and not inert (Polish 1 §Focus).
  function usable(el: HTMLElement | null | undefined): el is HTMLElement {
    return !!el && el.isConnected && !(el as HTMLButtonElement).disabled
      && el.getAttribute('aria-disabled') !== 'true' && !el.closest('[inert]');
  }
```

Update the comment above `refocusAfterDelete` to:

```ts
  // R7, the Delete path: the question is gone (and the list re-rendered), so
  // focus would fall to <body>. Land on this row's trash (failed delete), else
  // the trash now at its position, the one before it, the drop zone, else the
  // modal panel. Leave focus alone if the author moved it elsewhere or opened
  // another question.
```

Replace the confirm pair (`:311-329`)

```svelte
          {#if confirmId === a.id}
            <span class="confirm-pair">
              …
            </span>
          {:else}
```

(the whole `<span class="confirm-pair">…</span>` element) with

```svelte
          {#if confirmId === a.id || deletingIds.has(a.id)}
            <!-- The row's own click (insert) must not run under the question. -->
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <span onclick={(e) => e.stopPropagation()}>
              <InlineConfirm takeFocus label="Delete {a.filename}?" confirmLabel="Delete"
                             busy={deletingIds.has(a.id)}
                             onConfirm={() => void confirmDelete(a.id)} onCancel={() => void cancelDelete()} />
            </span>
          {:else}
```

Replace the drop zone's last attribute line

```svelte
    class:disabled={disabled || uploading}
```

with

```svelte
    class:disabled={disabled || uploading}
    aria-disabled={disabled || uploading ? 'true' : undefined}
    title={uploading ? 'Wait for the upload to finish' : disabled ? 'Wait for the request to finish' : undefined}
```

Delete the `.confirm-pair` style rules (`:463-474`):

```css
  .confirm-pair { display: flex; gap: 4px; /* the 4px step */ }
  .confirm-pair button {
    padding: 2px 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 11.5px;
    cursor: pointer;
  }
  .confirm-pair .confirm { color: var(--danger); }
  .confirm-pair button:disabled { color: var(--faint); border-color: var(--border-faint); cursor: not-allowed; }
```

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/AssetSidebar.svelte.test.ts src/tests/AssetSidebar.run-mode.svelte.test.ts`
Expected: PASS.

- [ ] **Step 13: Write the failing gate rows**

In `frontend/scripts/visual-refresh-gate.sh`:

1. In the b4 comment log, after the line `# reproduces aaed0f95).`, add:

```
# Then once more in Polish 1 T1 (2448f67f -> <NEW>, user 2026-10-14): --danger
# #991B1B -> #C8102E (D32), the --danger-off-* trio re-derived from it, and
# +--danger-press, --primary-press, --cancel-border/-hover/-press and
# --danger-panel-bg/-fg (D31, D40). Those are the ONLY changes (reverting them
# reproduces 2448f67f).
```

2. In the DangerConfirm block (`:4734` and `:4736`) replace

```
  d '\.danger-confirm' '' 'background:var\(--status-rejected-bg\)' 'border-left:3px solid var\(--danger\)'
```

with

```
  d '\.danger-confirm' '' 'background:var\(--danger-panel-bg\)' 'border-left:3px solid var\(--danger\)'
```

and

```
  d '\.dc-force\.armed' '' 'background:var\(--danger\)' 'color:var\(--primary-text\)'
```

with

```
  d '\.dc-force\.armed' '' 'background:var\(--surface\)' 'color:var\(--danger\)'
```

3. Before the line `# The summary line is the parent process's (see the re-exec at the top).` add section (am):

```zsh

echo
echo "--- (am) Polish 1 — one confirm style ---"
# hover_only LABEL HASH — every :hover rule carrying HASH sits inside
# `@media (hover: hover)`: a touch tap leaves no fill behind (R50).
hover_only() {
  if python3 - "$CSS" "$2" <<'HO'
import re, sys
css, h = open(sys.argv[1]).read(), re.escape(sys.argv[2])
hov = re.compile(r'[^{}]*\.' + h + r'[^{}]*:hover[^{}]*\{')
inside = sum(len(hov.findall(m.group(1)))
             for m in re.finditer(r'@media \(hover: ?hover\)\{((?:[^{}]*\{[^{}]*\})*)\}', css))
total = len(hov.findall(css))
sys.exit(0 if total > 0 and total == inside else 1)
HO
  then echo "PASS  $1 :hover fills sit only under @media (hover: hover) (R50)"
  else echo "FAIL  $1 :hover fills sit only under @media (hover: hover) (R50)"; fail=1; fi
}
# D32: the new red, and every Polish-1 token defined exactly once.
if grep -qE '^[[:space:]]*--danger: #C8102E;' src/styles/theme-default.css; then echo "PASS  --danger is #C8102E (D32)"
else echo "FAIL  --danger is #C8102E (D32)"; fail=1; fi
p1tok=0
for t in danger-press primary-press cancel-border cancel-hover cancel-press danger-panel-bg danger-panel-fg; do
  [[ $(grep -cE "^[[:space:]]*--$t:" src/styles/theme-default.css) -eq 1 ]] || { p1tok=1; echo "      --$t is not defined exactly once"; }
done
if [[ $p1tok -eq 0 ]]; then echo "PASS  the seven Polish-1 tokens are defined once in theme-default.css"
else echo "FAIL  the seven Polish-1 tokens are defined once in theme-default.css"; fail=1; fi
# The two hand-rolled confirms are InlineConfirm now (spec §Tone and labels).
none "AssetSidebar and RunAssetsTab author no hand-rolled confirm rules" "\.(confirm-pair|row-confirm|rc-actions|rc-confirm|rc-cancel)\.svelte-"
# InlineConfirm: D31/D34 geometry and states, guarded so busy wins (spec §Look).
uniq1 inline-confirm
if [[ -n $REPLY ]]; then
  N=InlineConfirm; H=$REPLY
  IC=':not\(\[aria-disabled=true\]\)'
  d '\.ic-btn' '' 'height:22px' 'padding:0 9px' 'border-radius:4px' 'background:var\(--surface\)' 'font-size:12px' 'font-weight:500'
  d '\.danger' '' 'color:var\(--danger\)' 'border-color:var\(--danger\)'
  d '\.primary' '' 'color:var\(--primary\)' 'border-color:var\(--primary\)'
  d '\.cancel' '' 'color:var\(--text-3\)' 'border-color:var\(--cancel-border\)'
  d '\.danger' "${IC}:hover" 'background:var\(--danger\)' 'color:var\(--primary-text\)'
  d '\.danger' "${IC}:focus-visible" 'background:var\(--danger\)' 'color:var\(--primary-text\)'
  d '\.danger' "${IC}:active" 'background:var\(--danger-press\)' 'border-color:var\(--danger-press\)'
  d '\.primary' "${IC}:hover" 'background:var\(--primary\)' 'color:var\(--primary-text\)'
  d '\.primary' "${IC}:focus-visible" 'background:var\(--primary\)' 'color:var\(--primary-text\)'
  d '\.primary' "${IC}:active" 'background:var\(--primary-press\)' 'border-color:var\(--primary-press\)'
  d '\.cancel' "${IC}:hover" 'background:var\(--cancel-hover\)'
  d '\.cancel' "${IC}:focus-visible" 'background:var\(--cancel-hover\)'
  d '\.cancel' "${IC}:active" 'background:var\(--cancel-press\)'
  d '\.ic-btn' ':focus-visible' 'outline:2px solid var\(--primary\)' 'outline-offset:2px'
  d '\.cancel\[aria-disabled=true\]' '' 'background:var\(--bg\)' 'color:var\(--faint\)' 'border-color:var\(--border-faint\)' 'cursor:not-allowed'
  d '\.confirm\[aria-busy=true\]' '' 'cursor:progress'
  d '\.warning' '' 'font-size:12\.5px' 'color:var\(--muted\)' 'overflow-wrap:anywhere'
  chk "@media \(pointer: ?coarse\)\{\.ic-btn\.${H}" 'min-height:28px'
  none "InlineConfirm fills only an enabled, idle button" "\.(danger|primary|cancel)\.${H}:(hover|focus-visible|active)"
  hover_only InlineConfirm $H
  sweep InlineConfirm $H
fi
# DangerConfirm: the D40 panel, InlineConfirm's geometry, fills only when armed and idle.
uniq1 danger-confirm
if [[ -n $REPLY ]]; then
  N=DangerConfirm; H=$REPLY
  DC=':not\(:disabled\)'
  d '\.dc-msg' '' 'color:var\(--danger-panel-fg\)'
  d '\.dc-ack' '' 'color:var\(--text-2\)'
  d '\.dc-btn' '' 'height:22px' 'padding:0 9px' 'border-radius:4px' 'font-size:12px' 'font-weight:500'
  d '\.dc-force\.armed' "${DC}:hover" 'background:var\(--danger\)' 'color:var\(--primary-text\)'
  d '\.dc-force\.armed' "${DC}:focus-visible" 'background:var\(--danger\)' 'color:var\(--primary-text\)'
  d '\.dc-force\.armed' "${DC}:active" 'background:var\(--danger-press\)' 'border-color:var\(--danger-press\)'
  d '\.dc-cancel' '' 'border:1px solid var\(--cancel-border\)'
  d '\.dc-cancel' "${DC}:hover" 'background:var\(--cancel-hover\)'
  d '\.dc-cancel' "${DC}:focus-visible" 'background:var\(--cancel-hover\)'
  d '\.dc-cancel' "${DC}:active" 'background:var\(--cancel-press\)'
  d '\.dc-btn' ':focus-visible' 'outline:2px solid var\(--primary\)' 'outline-offset:2px'
  d '\.dc-force\.armed\[aria-busy=true\]' '' 'cursor:progress'
  chk "@media \(pointer: ?coarse\)\{\.dc-btn\.${H}" 'min-height:28px'
  none "DangerConfirm fills only an armed, idle Force delete and an enabled Cancel" "\.dc-(force|cancel)[.a-z-]*\.${H}:(hover|focus-visible|active)"
  hover_only DangerConfirm $H
fi
# Button danger (D34 at page size): the same states, guarded by disabled, blocked and busy.
uniq1 btn
if [[ -n $REPLY ]]; then
  N=Button; H=$REPLY
  BT=':not\(:disabled\):not\(\.blocked\):not\(\[aria-busy=true\]\)'
  d '\.danger' '' 'background:var\(--surface\)' 'color:var\(--danger\)' 'border-color:var\(--danger\)'
  d '\.danger' "${BT}:hover" 'background:var\(--danger\)' 'color:var\(--primary-text\)'
  d '\.danger' "${BT}:focus-visible" 'background:var\(--danger\)' 'color:var\(--primary-text\)'
  d '\.danger' "${BT}:active" 'background:var\(--danger-press\)' 'border-color:var\(--danger-press\)'
  d '\.danger' ':focus-visible' 'outline:2px solid var\(--primary\)' 'outline-offset:2px'
  none "Button .danger fills only an enabled, idle button" "\.danger\.${H}:((hover|active)\{|focus-visible\{[^}]*background)"
  hover_only Button $H
fi
```

4. In `GLOBAL_ALLOW` (the `:global` review list in the python block, `:388`), after `('src/components/ui/DangerConfirm.svelte', 'code'),` add:

```python
    # Polish 1 T1: InlineConfirm's `message` snippet (R52's bold lead, a
    # filename in <code>). Ancestor-scoped under its own hashed .warning, which
    # wraps only the caller's question text, never a quiz.
    ('src/components/ui/InlineConfirm.svelte', 'code'),
    ('src/components/ui/InlineConfirm.svelte', 'strong'),
```

(The check stays one line, so the count does not change.)

5. Set `EXPECTED_CHECKS=2146` (`:90`).

Run the gate (Global Constraints). Expected: FAIL — b4 "the hashless rule inventory changed" (the tokens moved the `:root` hash), and nothing else. If any (am) row fails, the minifier wrote the selector differently: read the emitted rule (`grep -oE '\.ic-btn\.svelte-[a-z0-9]+[^{]*\{[^}]*\}' dist/_app/*.css`), match its form, and ledger a ruling.

- [ ] **Step 14: Move the `:root` hash**

Read the new hash:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && python3 -c "import re,hashlib,glob;css=open(glob.glob('dist/_app/*.css')[0]).read();b=re.findall(r'(?:^|\})\:root\{([^}]*)\}',css)[0];print(hashlib.sha1(';'.join(sorted({d.strip() for d in b.split(';') if d.strip()})).encode()).hexdigest()[:8])"
```

Put it in `WANT_FULL` in place of `('', ':root', '2448f67f')` and in place of `<NEW>` in the comment from Step 13. Then prove it is the ONLY change: `git stash push src/styles/theme-default.css`, build (`npm run build > $SDD/tmp/build.log 2>&1`), run the one-liner again — it must print `2448f67f` — then `git stash pop` and rebuild.

Run the gate. Expected: `VISUAL-REFRESH GATE: ALL PASS (2146 checks)`.

- [ ] **Step 15: Full checks**

Run vitest, svelte-check and the gate (Global Constraints). Expected: vitest green; svelte-check 0 errors and 13 warnings (a missing `confirmLabel` anywhere is an error now: every caller passes one); gate `ALL PASS (2146 checks)`.

- [ ] **Step 15b: D42 — the row questions end under the row's actions** (added after the user's look review)

- InlineConfirm: prop `align?: 'start' | 'end'` (default `'start'`), `class:end={align === 'end'}` on the group, and the rule `.inline-confirm.end { display: flex; justify-content: flex-end; }`. Test: `align="end" puts the question at the end of its line, under the row's actions (D42); start by default`.
- `align="end"` on RunMiniProjectsTab's plain delete row, RunAssetsTab's `tr.delete-row` and RunRosterTab's row remove. Each site's existing row-confirm test asserts `.inline-confirm` has class `end`.
- Gate, in the InlineConfirm block after the `.warning` row: `d '\.inline-confirm\.end' '' 'display:flex' 'justify-content:flex-end'`. `EXPECTED_CHECKS=2148`. Run the full checks again: vitest green, svelte-check 0 errors and 13 warnings, gate `ALL PASS (2148 checks)`.

- [ ] **Step 16: Create the backlog**

Create `docs/backlog/polish1-confirms-debt.md`:

```markdown
# Polish 1 (confirms) — deferred minors

Minors the review lanes raised and the user did not take into the slice, by task.

## Task 1 — the look
```

- [ ] **Step 17: Screenshots, the user's OK, review lanes, commit**

Screenshots (1280 wide; the second size only where a row wraps), with network mocks for every write:
- every Teaching confirm at rest: RunTeachersTab remove, RunGroupsTab delete, RunListPage delete, RunMiniProjectsTab delete, RunAssetsTab bulk, delete and replace, RunRosterTab bulk and row remove, DashboardSidePanel discard, MiniProjectModal discard and publish (primary), RunOverviewTab unpublish (primary);
- one of them Tab-focused on the confirm (the fill and the ring) and one hovered;
- the danger panel unticked, ticked, and busy (mock the DELETE with a held response);
- the authoring `Button danger` uses: VersionEditPage Delete, ExplanationModal "Remove explanation", RunAssetsTab "Delete N selected", one Tab-focused;
- the AssetSidebar question in the item modal.

Then the per-task loop: the user's OK, both lanes until clean, commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/styles/theme-default.css \
  frontend/src/components/ui/InlineConfirm.svelte frontend/src/components/ui/DangerConfirm.svelte frontend/src/components/ui/Button.svelte \
  frontend/src/components/runs/RunTeachersTab.svelte frontend/src/components/runs/RunGroupsTab.svelte frontend/src/pages/runs/RunListPage.svelte \
  frontend/src/components/runs/RunAssetsTab.svelte frontend/src/components/runs/RunOverviewTab.svelte frontend/src/components/runs/MiniProjectModal.svelte \
  frontend/src/components/editor/AssetSidebar.svelte frontend/scripts/visual-refresh-gate.sh docs/backlog/polish1-confirms-debt.md \
  frontend/src/tests/InlineConfirm.svelte.test.ts frontend/src/tests/AssetSidebar.svelte.test.ts frontend/src/tests/AssetSidebar.run-mode.svelte.test.ts \
  frontend/src/tests/RunAssetsTab.svelte.test.ts frontend/src/tests/RunListPage.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(polish1): one confirm look — small real buttons, the new red, the danger panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 2: Ask in place — the helper, leaving with unsaved work, the modal footers

**Files:**
- Create: `frontend/src/lib/askInPlace.svelte.ts`, `frontend/src/components/ui/AskSlot.svelte`
- Modify: `frontend/src/lib/editorReasons.ts:41-44` (the two texts, the comment), `frontend/src/lib/dirtyRegistry.svelte.ts:13-16` (comment), `frontend/src/lib/quizEdits.svelte.ts:5-8` (`DISCARD_PROMPT`), `frontend/src/lib/router.svelte.ts:105-109` (one line)
- Modify: `frontend/src/components/editor/DirtyGuard.svelte` (whole file)
- Modify: `frontend/src/components/runs/DashboardSidePanel.svelte:304-321`, `:494-523`, `:652-664`, `:905`; `frontend/src/components/runs/MiniProjectModal.svelte:108-114`, `:301-327`, `:476`, `:484-492`
- Modify: `frontend/src/components/editor/VersionSettingsModal.svelte`, `NewItemModal.svelte`, `quiz/ExplanationModal.svelte`, `quiz/NewQuestionModal.svelte`, `quiz/QuestionTextModal.svelte` (the close question, the footer, the page question)
- Modify: `frontend/src/components/editor/ItemEditorModal.svelte:41`, `:96-104`, `:217-241`, `:281-314`, `:316-341` (and the body wrapper), `frontend/src/pages/editor/VersionEditPage.svelte:2`, `:42-45`, `:225-292`, `:500-512`, `:522`, `:576`, `:602-625`, style
- Modify: `frontend/scripts/visual-refresh-gate.sh` (`:4519-4528`, section (am), `EXPECTED_CHECKS`)
- Modify: `frontend/src/tests/support/ItemEditorModalHarness.svelte`, `frontend/src/tests/support/quizHarness.svelte.ts` (`renderQuiz`'s `page` option)
- Test: `frontend/src/tests/askInPlace.svelte.test.ts` (new), `DirtyGuard.svelte.test.ts` (rewritten), `router.test.ts`, `DashboardSidePanel.svelte.test.ts`, `MiniProjectModal.frame.svelte.test.ts`, `VersionSettingsModal.svelte.test.ts`, `NewItemModal.svelte.test.ts`, `QuizModals.svelte.test.ts`, `QuizStructure.svelte.test.ts`, `ItemEditorModal.svelte.test.ts`, `VersionEditPage.svelte.test.ts`

**Interfaces:**
- Consumes (Task 1): `InlineConfirm` props `confirmLabel` (required), `confirmDataAction`, `warning` | `message`, `label`, `tone`, `layout`, `busy`, `takeFocus`, `onConfirm`, `onCancel`; its markup `.inline-confirm` (`.row` for `layout="row"`), `.warning`, `button.confirm.{danger|primary}`, `button.cancel`. It scrolls its group into view and focuses Cancel on mount when `takeFocus`, and handles Esc itself (preventDefault + stopPropagation).
- Produces (Tasks 3–6 rely on these exact names):
  - `lib/editorReasons.ts`: `DISCARD_CONTINUE = 'Discard unsaved changes and continue?'`, `DISCARD = 'Discard unsaved changes?'`.
  - `lib/askInPlace.svelte.ts`:
    - `type Answer = 'confirm' | 'cancel' | 'dismissed'`; `type Ask` (`label?`, `confirmLabel`, `tone`, `layout?`, `confirmDataAction`, `key?: string | number`, and exactly one of `warning: string | (() => string)` / `message: Snippet`); `type GuardAsk = { promise: Promise<boolean>; dismiss(): void; focusCancel(): void }`; `type AskHost = { ownOpen(): boolean; focusOwnCancel(): void; closeEl(): Element | null }`.
    - `refused(): GuardAsk`; `DISCARD_ASK: Ask` (close text); `DISCARD_NAV_ASK: Ask` (navigation text).
    - `focusIsFree(within?: Element | null): boolean` (R57); `usable(el): el is HTMLElement`; `focusAfter(target: () => Element | null | undefined): Promise<void>` (tick, then R57, then `usable`); `modalPanel(labelId)`; `modalClose(labelId)`.
    - `class InPlaceAsk { current: Ask | null; busy: boolean; host: HTMLElement | null; get open(); get focusFree(); ask(q): Promise<Answer>; answer(a: 'confirm' | 'cancel'); settle(); dismiss(); focusCancel() }`.
    - `PAGE_ASK_KEY`; `class PageAsk { readonly ask: InPlaceAsk; hosts: AskHost[]; get top(): AskHost | null; register(h): () => void; guard(after?: (a: Answer, host: AskHost | null) => void): GuardAsk }`.
    - `useModalAsk(labelId: string): { own: InPlaceAsk; page: PageAsk | null; here: () => boolean }` — call during component init.
  - `components/ui/AskSlot.svelte`: prop `ask: InPlaceAsk`; draws `div.ask-slot` (`display: contents`) around a fresh `InlineConfirm` per question (`takeFocus`, `busy={ask.busy}`), and records the div as `ask.host`.
  - `DirtyGuard` props `{ isDirty: () => boolean; ask: () => GuardAsk; onDiscard?: () => void }` (`ask` is required).
  - `ItemEditorModal`: `onDeleteItem: () => Promise<void>`; its own question `bodyAsk` (from `useModalAsk`) draws at the top of the body; `asking` freezes `div.body-rest`. Task 5 hands `bodyAsk` to the quiz title's `InlineEdit`.
  - `VersionEditPage`: `page: PageAsk` (context `PAGE_ASK_KEY`), `pageAsk = page.ask`, `rowAsking`, `courseLinkEl` (the `<h1>` course link), `rescueFocus()`. Task 3 adds `treeAsk`; Task 4 asks #20/#21 in the bar.
  - Test helpers: `renderQuiz(server, { page: true })` mounts a `PageAsk` and a `DirtyGuard` around the item modal.

- [ ] **Step 1: Write the failing helper tests**

Create `frontend/src/tests/askInPlace.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { InPlaceAsk, PageAsk, focusIsFree, usable, refused, DISCARD_ASK, type Answer, type Ask, type AskHost } from '../lib/askInPlace.svelte';
import { DISCARD, DISCARD_CONTINUE } from '../lib/editorReasons';

const Q = (over: Partial<Ask> = {}): Ask =>
  ({ warning: 'Delete it?', confirmLabel: 'Delete', tone: 'danger', confirmDataAction: 'confirm-x', ...over }) as Ask;
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

// A hand-made host: what <AskSlot> draws, enough for focus and answer().
let host: HTMLDivElement;
function drawn(a: InPlaceAsk) {
  host.innerHTML = '<div class="inline-confirm"><button class="confirm">Delete</button><button class="cancel">Cancel</button></div>';
  a.host = host;
  return { confirm: host.querySelector<HTMLButtonElement>('button.confirm')!, cancel: host.querySelector<HTMLButtonElement>('button.cancel')! };
}
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); });
afterEach(() => { host.remove(); (document.activeElement as HTMLElement | null)?.blur?.(); });

describe('editorReasons — the two discard texts (R51)', () => {
  it('navigation asks "…and continue?", a close asks without it', () => {
    expect(DISCARD_CONTINUE).toBe('Discard unsaved changes and continue?');
    expect(DISCARD).toBe('Discard unsaved changes?');
    expect(DISCARD_ASK).toMatchObject({ warning: DISCARD, confirmLabel: 'Discard', tone: 'danger', layout: 'row' });
  });
});

describe('InPlaceAsk — answers (R56) and busy (R54)', () => {
  it('Cancel resolves "cancel" and closes', async () => {
    const a = new InPlaceAsk();
    const p = a.ask(Q());
    expect(a.open).toBe(true);
    a.answer('cancel');
    expect(await p).toBe('cancel');
    expect(a.open).toBe(false);
  });

  it('confirm resolves "confirm", stays open and busy, and moves focus to the confirm; settle() closes it', async () => {
    const a = new InPlaceAsk();
    const p = a.ask(Q());
    const { confirm } = drawn(a);
    a.answer('confirm');
    expect(await p).toBe('confirm');
    expect(a.open).toBe(true);
    expect(a.busy).toBe(true);
    expect(document.activeElement).toBe(confirm);
    a.answer('cancel');                       // busy: nothing answers twice
    expect(a.open).toBe(true);
    a.settle();
    expect(a.open).toBe(false);
    expect(a.busy).toBe(false);
  });

  it('settle() on an idle or closed question does nothing; dismiss() on a closed one does nothing', async () => {
    const a = new InPlaceAsk();
    a.settle();
    a.dismiss();
    const p = a.ask(Q());
    a.settle();                               // not confirmed: still open
    expect(a.open).toBe(true);
    a.dismiss();
    expect(await p).toBe('dismissed');
    a.dismiss();
    expect(a.open).toBe(false);
  });

  it('dismiss() closes a busy question too', async () => {
    const a = new InPlaceAsk();
    const p = a.ask(Q());
    a.answer('confirm');
    await p;
    a.dismiss();
    expect(a.open).toBe(false);
    expect(a.busy).toBe(false);
  });
});

describe('InPlaceAsk — a newcomer (R53)', () => {
  it('a place without keys: the newcomer is dismissed at once and focus goes back to the open Cancel', async () => {
    const a = new InPlaceAsk();
    const first = a.ask(Q());
    const { cancel } = drawn(a);
    const second = await a.ask(Q({ warning: 'Other?' }));
    expect(second).toBe('dismissed');
    expect(document.activeElement).toBe(cancel);
    expect(a.current!.warning).toBe('Delete it?');
    a.answer('cancel');
    expect(await first).toBe('cancel');
  });

  it('the same key: dismissed, the open one kept', async () => {
    const a = new InPlaceAsk();
    void a.ask(Q({ key: 'block-1' }));
    drawn(a);
    expect(await a.ask(Q({ key: 'block-1', warning: 'Again?' }))).toBe('dismissed');
    expect(a.current!.key).toBe('block-1');
    expect(a.current!.warning).toBe('Delete it?');
  });

  it('another key replaces the open question, which resolves "dismissed" (D39)', async () => {
    const a = new InPlaceAsk();
    const first = a.ask(Q({ key: 'block-1' }));
    const second = a.ask(Q({ key: 'seq-2' }));
    expect(await first).toBe('dismissed');
    expect(a.current!.key).toBe('seq-2');
    a.answer('cancel');
    expect(await second).toBe('cancel');
  });

  it('while busy every newcomer is dismissed and focus stays on the busy confirm', async () => {
    const a = new InPlaceAsk();
    const p = a.ask(Q({ key: 'block-1' }));
    const { confirm } = drawn(a);
    a.answer('confirm');
    await p;
    expect(await a.ask(Q({ key: 'seq-2' }))).toBe('dismissed');
    expect(await a.ask(Q({ key: 'block-1' }))).toBe('dismissed');
    expect(a.current!.key).toBe('block-1');
    expect(document.activeElement).toBe(confirm);
  });
});

describe('focus helpers (R57, §Focus)', () => {
  it('focusIsFree: nowhere, <body>, or inside the question', () => {
    const a = new InPlaceAsk();
    void a.ask(Q());
    const { cancel } = drawn(a);
    expect(focusIsFree(host)).toBe(true);
    cancel.focus();
    expect(focusIsFree(host)).toBe(true);
    expect(a.focusFree).toBe(true);
    const out = document.createElement('button');
    document.body.appendChild(out);
    out.focus();
    expect(focusIsFree(host)).toBe(false);
    expect(a.focusFree).toBe(false);
    out.remove();
  });

  it('usable: connected, enabled, not aria-disabled, not inert', () => {
    const b = document.createElement('button');
    expect(usable(b)).toBe(false);
    host.appendChild(b);
    expect(usable(b)).toBe(true);
    b.disabled = true;
    expect(usable(b)).toBe(false);
    b.disabled = false;
    b.setAttribute('aria-disabled', 'true');
    expect(usable(b)).toBe(false);
    b.removeAttribute('aria-disabled');
    host.toggleAttribute('inert', true);
    expect(usable(b)).toBe(false);
    expect(usable(null)).toBe(false);
  });

  it('focusCancel does nothing while busy', async () => {
    const a = new InPlaceAsk();
    const p = a.ask(Q());
    const { confirm } = drawn(a);
    a.answer('confirm');
    await p;
    a.focusCancel();
    expect(document.activeElement).toBe(confirm);
  });
});

describe('PageAsk — the host stack and the guard (R46, R53)', () => {
  const entry = (own: InPlaceAsk, close: HTMLElement | null = null): AskHost =>
    ({ ownOpen: () => own.open, focusOwnCancel: () => own.focusCancel(), closeEl: () => close });

  it('the top is the last registered host; removal is by identity', () => {
    const page = new PageAsk();
    const a = entry(new InPlaceAsk());
    const b = entry(new InPlaceAsk());
    const offA = page.register(a);
    const offB = page.register(b);
    expect(page.top).toBe(b);
    offA();
    expect(page.top).toBe(b);
    offB();
    expect(page.top).toBeNull();
  });

  it('guard: asks with the navigation text; Discard resolves true and closes at once', async () => {
    const page = new PageAsk();
    const g = page.guard();
    expect(page.ask.current!.warning).toBe(DISCARD_CONTINUE);
    expect(page.ask.current!.confirmLabel).toBe('Discard');
    page.ask.answer('confirm');
    expect(await g.promise).toBe(true);
    expect(page.ask.open).toBe(false);
  });

  it('guard: Cancel at a modal host resolves false and focuses that host\'s ×', async () => {
    const page = new PageAsk();
    const x = document.createElement('button');
    host.appendChild(x);
    page.register(entry(new InPlaceAsk(), x));
    const seen: Array<[Answer, AskHost | null]> = [];
    const g = page.guard((a, h) => { seen.push([a, h]); });
    page.ask.answer('cancel');
    expect(await g.promise).toBe(false);
    flushSync();
    expect(document.activeElement).toBe(x);
    expect(seen).toEqual([['cancel', page.top]]);
  });

  it('guard: refused while the top host\'s own question is open — false, focus on that Cancel, no page question', async () => {
    const page = new PageAsk();
    const own = new InPlaceAsk();
    page.register(entry(own));
    void own.ask(Q());
    const { cancel } = drawn(own);
    const seen: Answer[] = [];
    const g = page.guard((a) => { seen.push(a); });
    expect(await g.promise).toBe(false);
    expect(page.ask.open).toBe(false);
    expect(document.activeElement).toBe(cancel);
    expect(seen).toEqual(['dismissed']);
  });

  it('refused() resolves false and its dismiss / focusCancel do nothing', async () => {
    const r = refused();
    r.dismiss();
    r.focusCancel();
    expect(await r.promise).toBe(false);
    await flush();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/askInPlace.svelte.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/askInPlace.svelte"` (and `DISCARD` / `DISCARD_CONTINUE` are not exported).

- [ ] **Step 3: The two texts, the reworded comments, `DISCARD_PROMPT`**

In `frontend/src/lib/editorReasons.ts` replace

```ts
/** D3: appended to the confirm() of an action that can close or unmount a draft. */
export function unsavedSuffix(anyDirty: boolean): string {
```

with

```ts
/** R51: every navigation question, and the D10 quiz-edit question. */
export const DISCARD_CONTINUE = 'Discard unsaved changes and continue?';
/** R51: every close or Esc question: closing is the action itself. */
export const DISCARD = 'Discard unsaved changes?';

/** D3: appended to the question of an action that can close or unmount a draft. */
export function unsavedSuffix(anyDirty: boolean): string {
```

In `frontend/src/lib/dirtyRegistry.svelte.ts` replace the comment lines

```ts
// the registry needs to forget the parameter. `discard` (Slice-5a D3) drops
// the tracker's draft when the user confirms the "Discard unsaved changes?"
// prompt, so a confirmed discard never re-prompts on the next navigation.
```

with

```ts
// the registry needs to forget the parameter. `discard` (Slice-5a D3) drops
// the tracker's draft when the user answers Discard to the page's question,
// so a discard never asks again on the next navigation.
```

In `frontend/src/lib/quizEdits.svelte.ts` replace

```ts
import { ApiError } from './api';
import { pushToast } from '../stores/toasts.svelte';

export const DISCARD_PROMPT = 'Discard unsaved changes and continue?';
```

with

```ts
import { ApiError } from './api';
import { pushToast } from '../stores/toasts.svelte';
import { DISCARD_CONTINUE } from './editorReasons';

// R51: the D10 question asks with the navigation text.
export const DISCARD_PROMPT = DISCARD_CONTINUE;
```

- [ ] **Step 4: Write `lib/askInPlace.svelte.ts`**

Create `frontend/src/lib/askInPlace.svelte.ts`:

```ts
// Polish 1 (spec §Ask in place): a question in place of the browser's confirm dialog.
// A host owns an InPlaceAsk and draws it with <AskSlot> where the question
// belongs; the site awaits ask() and acts only on 'confirm'.
import { getContext, tick, untrack, type Snippet } from 'svelte';
import { DISCARD, DISCARD_CONTINUE } from './editorReasons';

/** R56: Cancel and a dismissal are different answers. */
export type Answer = 'confirm' | 'cancel' | 'dismissed';

type AskBase = {
  label?: string;
  confirmLabel: string;
  tone: 'danger' | 'primary';
  layout?: 'row' | 'column';
  align?: 'start' | 'end';     // 'end': under a row, under its actions (D42)
  confirmDataAction: string;   // test hook, e.g. 'confirm-delete-block'
  key?: string | number;       // which row of a list asks (R53)
};
/** Field names match InlineConfirm's props; `warning` and `message` exclude each other (P62). */
export type Ask = AskBase & (
  | { warning: string | (() => string); message?: undefined }   // a getter keeps unsavedSuffix current
  | { message: Snippet; warning?: undefined }
);

/** What DirtyGuard holds of an owner's navigation question (R55). */
export type GuardAsk = { promise: Promise<boolean>; dismiss: () => void; focusCancel: () => void };

/** A guard call refused at once (R53): the navigation is cancelled, nothing to withdraw. */
export function refused(): GuardAsk {
  return { promise: Promise.resolve(false), dismiss: () => {}, focusCancel: () => {} };
}

/** A dirty modal's ×, Esc or Cancel (#7, #10, #11, #13, #15). */
export const DISCARD_ASK: Ask = {
  warning: DISCARD, confirmLabel: 'Discard', tone: 'danger', layout: 'row', confirmDataAction: 'confirm-discard',
};
/** Every navigation question (D37). */
export const DISCARD_NAV_ASK: Ask = {
  warning: DISCARD_CONTINUE, confirmLabel: 'Discard', tone: 'danger', layout: 'row', confirmDataAction: 'confirm-discard',
};

/** R57: focus is nowhere, on <body>, or inside `within`. */
export function focusIsFree(within?: Element | null): boolean {
  const a = document.activeElement;
  return !a || a === document.body || (!!within && within.contains(a));
}

/** §Focus: a target counts only if connected, enabled (natively and by aria) and not inert. */
export function usable(el: Element | null | undefined): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected
    && !(el as HTMLButtonElement).disabled
    && el.getAttribute('aria-disabled') !== 'true'
    && !el.closest('[inert]');
}

/** After an answer: wait for the re-render, then focus the target if R57 allows and it counts. */
export async function focusAfter(target: () => Element | null | undefined): Promise<void> {
  await tick();
  if (!focusIsFree()) return;
  const t = target();
  if (usable(t)) t.focus();
}

/** The modal panel whose heading has id `labelId`, and its ×. */
export function modalPanel(labelId: string): HTMLElement | null {
  return document.getElementById(labelId)?.closest<HTMLElement>('section.modal-panel') ?? null;
}
export function modalClose(labelId: string): HTMLElement | null {
  return modalPanel(labelId)?.querySelector<HTMLElement>('header.modal-head button[aria-label="Close"]') ?? null;
}

export class InPlaceAsk {
  current = $state.raw<Ask | null>(null);
  busy = $state(false);
  /** Set by <AskSlot> while it draws this question. */
  host: HTMLElement | null = null;
  #resolve: ((a: Answer) => void) | null = null;

  get open(): boolean { return this.current !== null; }
  /** R57 for this question: focus is nowhere, on <body>, or inside it. */
  get focusFree(): boolean { return focusIsFree(this.host); }

  ask(q: Ask): Promise<Answer> {
    const open = this.current;
    if (open) {
      // R53: while busy every newcomer is dismissed quietly. The same key, or
      // a place without keys, brings the open question back. Another row's key
      // replaces it; the newcomer's takeFocus moves focus (D39).
      if (this.busy) return Promise.resolve('dismissed');
      if (open.key === undefined || q.key === undefined || open.key === q.key) {
        this.focusCancel();
        return Promise.resolve('dismissed');
      }
      this.#finish('dismissed');
    }
    this.current = q;
    return new Promise<Answer>((r) => { this.#resolve = r; });
  }

  answer(a: 'confirm' | 'cancel'): void {
    if (!this.current || this.busy) return;
    if (a === 'cancel') { this.#finish('cancel'); return; }
    // R54: the question stays, busy, until the site settles it. Safari leaves
    // a clicked button unfocused, so the busy confirm takes focus here.
    this.busy = true;
    this.host?.querySelector<HTMLElement>('.inline-confirm button.confirm')?.focus();
    const r = this.#resolve;
    this.#resolve = null;
    r?.('confirm');
  }

  /** Closes a confirmed question once its action settles (R54); otherwise does nothing. */
  settle(): void {
    if (this.current && this.busy) { this.current = null; this.busy = false; }
  }

  /** Withdraws the question (R49, R55, unmount): resolves 'dismissed'; nothing when closed. */
  dismiss(): void {
    if (this.current) this.#finish('dismissed');
  }

  /** Brings the open question back: its Cancel, scrolled into view. Not while busy (R53). */
  focusCancel(): void {
    if (!this.current || this.busy) return;
    const cancel = this.host?.querySelector<HTMLElement>('.inline-confirm button.cancel');
    cancel?.closest('.inline-confirm')?.scrollIntoView?.({ block: 'nearest' });
    cancel?.focus();
  }

  #finish(a: Answer): void {
    const r = this.#resolve;
    this.#resolve = null;
    this.current = null;
    this.busy = false;
    r?.(a);
  }
}

/** A modal that can draw the page question (R46). */
export type AskHost = {
  ownOpen(): boolean;        // its own question is open (R53)
  focusOwnCancel(): void;
  closeEl(): Element | null; // where Cancel on the page question drawn here sends focus: its ×
};

export const PAGE_ASK_KEY = Symbol('pageAsk');

/** VersionEditPage's one navigation question and the modals that can draw it (D38, R46). */
export class PageAsk {
  readonly ask = new InPlaceAsk();
  hosts = $state.raw<AskHost[]>([]);

  /** The top-most host, or null: then the row under the title draws the question. */
  get top(): AskHost | null { return this.hosts[this.hosts.length - 1] ?? null; }

  /** Added on mount, removed by identity (ItemEditorModal is keyed, so never pop()). */
  register(h: AskHost): () => void {
    this.hosts = [...this.hosts, h];
    return () => { this.hosts = this.hosts.filter((x) => x !== h); };
  }

  /** DirtyGuard's `ask`. Refused while the top host's own question is open (R53).
   *  `after` runs once with the answer and the host that drew the question
   *  (null: the page row); a refusal reports 'dismissed'. */
  guard(after: (a: Answer, host: AskHost | null) => void = () => {}): GuardAsk {
    const top = this.top;
    if (top?.ownOpen()) {
      top.focusOwnCancel();   // nothing while that question is busy (R53)
      after('dismissed', top);
      return refused();
    }
    const promise = this.ask.ask(DISCARD_NAV_ASK).then(async (a) => {
      const host = this.top;
      if (a === 'confirm') this.ask.settle();   // Discard has no request (R54)
      if (a === 'cancel' && host) await focusAfter(() => host.closeEl());
      after(a, host);
      return a === 'confirm';
    });
    return { promise, dismiss: () => this.ask.dismiss(), focusCancel: () => this.ask.focusCancel() };
  }
}

/** A modal that asks: its own question (`own`: footer or body-top), and the page
 *  question while it is the top host (`here()`). Call during component init:
 *  it registers on mount and dismisses its own question on unmount. */
export function useModalAsk(labelId: string): { own: InPlaceAsk; page: PageAsk | null; here: () => boolean } {
  const own = new InPlaceAsk();
  const page = getContext<PageAsk | undefined>(PAGE_ASK_KEY) ?? null;
  const entry: AskHost = {
    ownOpen: () => own.open,
    focusOwnCancel: () => own.focusCancel(),
    closeEl: () => modalClose(labelId),
  };
  $effect(() => {
    // untrack: register() reads the stack it writes.
    const off = untrack(() => page?.register(entry));
    return () => { off?.(); own.dismiss(); };
  });
  return { own, page, here: () => !!page && page.ask.open && page.top === entry };
}
```

- [ ] **Step 5: Write `ui/AskSlot.svelte`**

Create `frontend/src/components/ui/AskSlot.svelte`:

```svelte
<script lang="ts">
  // Draws an InPlaceAsk's open question (Polish 1 §The helper). The host puts
  // the slot where the question belongs; the slot records its element as the
  // question's host, so focusCancel() and answer() find the buttons. Keyed by
  // the question: a new question is a fresh InlineConfirm (its own 400 ms
  // guard, R50, and its own takeFocus).
  import InlineConfirm from './InlineConfirm.svelte';
  import type { InPlaceAsk } from '../../lib/askInPlace.svelte';

  let { ask }: { ask: InPlaceAsk } = $props();

  const own = (el: HTMLElement) => {
    const a = ask;
    a.host = el;
    return () => { if (a.host === el) a.host = null; };
  };
</script>

{#if ask.current}
  {#key ask.current}
    {@const q = ask.current}
    <div class="ask-slot" {@attach own}>
      <InlineConfirm
        label={q.label}
        warning={typeof q.warning === 'function' ? q.warning() : q.warning}
        message={q.message}
        confirmLabel={q.confirmLabel}
        confirmDataAction={q.confirmDataAction}
        tone={q.tone}
        layout={q.layout}
        align={q.align}
        busy={ask.busy}
        takeFocus
        onConfirm={() => ask.answer('confirm')}
        onCancel={() => ask.answer('cancel')}
      />
    </div>
  {/key}
{/if}

<style>
  /* The slot only anchors the question; the host's layout places it. Inside a
     modal body its child stays a full-size flex item, as Modal's own are. */
  .ask-slot { display: contents; }
  .ask-slot > :global(*) { flex: 0 0 auto; }
</style>
```

- [ ] **Step 6: Run the helper tests to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/askInPlace.svelte.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 7: Rewrite the DirtyGuard tests (failing)**

Replace the whole of `frontend/src/tests/DirtyGuard.svelte.test.ts` with:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import DirtyGuard from '../components/editor/DirtyGuard.svelte';
import { navigate, __resetGuardsForTests } from '../lib/router.svelte';
import type { GuardAsk } from '../lib/askInPlace.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

// The owner's question, answered by the test: what an InPlaceAsk host hands DirtyGuard.
function fakeOwner() {
  const o = { asked: 0, dismissed: 0, focused: 0, answer: (_ok: boolean) => {} };
  const ask = (): GuardAsk => {
    o.asked++;
    let resolve!: (ok: boolean) => void;
    const promise = new Promise<boolean>((r) => { resolve = r; });
    o.answer = (ok) => resolve(ok);
    return { promise, dismiss: () => { o.dismissed++; resolve(false); }, focusCancel: () => { o.focused++; } };
  };
  return { o, ask };
}

function render(isDirty: () => boolean, onDiscard: () => void, ask: () => GuardAsk) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(DirtyGuard, { target: host, props: { isDirty, onDiscard, ask } });
  flushSync();
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); flushSync(); };

afterEach(async () => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
  __resetGuardsForTests();
  vi.restoreAllMocks();
  await navigate('/', { force: true });
});

describe('DirtyGuard — the owner asks in place (Polish 1 D37)', () => {
  it('Discard: onDiscard runs once and the navigation goes through', async () => {
    const { o, ask } = fakeOwner();
    const onDiscard = vi.fn();
    render(() => true, onDiscard, ask);
    const nav = navigate('/somewhere');
    await flush();
    expect(o.asked).toBe(1);
    o.answer(true);
    await nav;
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/somewhere');
  });

  it('Cancel: nothing is discarded and the navigation is cancelled', async () => {
    const { o, ask } = fakeOwner();
    const onDiscard = vi.fn();
    render(() => true, onDiscard, ask);
    const nav = navigate('/elsewhere');
    await flush();
    o.answer(false);
    await nav;
    expect(onDiscard).not.toHaveBeenCalled();
    expect(location.pathname).not.toBe('/elsewhere');
  });

  it('nothing dirty: no question, no discard', async () => {
    const { o, ask } = fakeOwner();
    const onDiscard = vi.fn();
    render(() => false, onDiscard, ask);
    await navigate('/clean');
    expect(o.asked).toBe(0);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/clean');
  });

  it('R47: a second navigation while asking joins the open question — one question, focus back on its Cancel, one discard', async () => {
    const { o, ask } = fakeOwner();
    const onDiscard = vi.fn();
    render(() => true, onDiscard, ask);
    const a = navigate('/first');
    await flush();
    const b = navigate('/second');
    await flush();
    expect(o.asked).toBe(1);
    expect(o.focused).toBe(1);
    o.answer(true);
    await a;
    await b;
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/second');
  });

  it('R55: a forced navigate while asking withdraws the question; nothing is discarded; a later navigation asks afresh', async () => {
    const { o, ask } = fakeOwner();
    const onDiscard = vi.fn();
    render(() => true, onDiscard, ask);
    const nav = navigate('/asked');
    await flush();
    await navigate('/forced', { force: true });
    await flush();
    expect(o.dismissed).toBe(1);
    await nav;
    expect(onDiscard).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/forced');
    const again = navigate('/later');
    await flush();
    expect(o.asked).toBe(2);
    o.answer(false);
    await again;
  });

  it('R55: no withdrawal on the effect\'s first run, nor on a hash-only change', async () => {
    const { o, ask } = fakeOwner();
    render(() => true, vi.fn(), ask);
    const nav = navigate('/asked-too');
    await flush();
    expect(o.dismissed).toBe(0);
    await navigate(`${location.pathname}${location.search}#frag`);
    await flush();
    expect(o.dismissed).toBe(0);
    o.answer(false);
    await nav;
  });

  it('R55: unmounting while asking withdraws the question', async () => {
    const { o, ask } = fakeOwner();
    const onDiscard = vi.fn();
    render(() => true, onDiscard, ask);
    const nav = navigate('/gone');
    await flush();
    unmount(component!);
    component = null;
    expect(o.dismissed).toBe(1);
    await nav;
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('beforeunload warns but never discards', () => {
    const { ask } = fakeOwner();
    const onDiscard = vi.fn();
    render(() => true, onDiscard, ask);
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onDiscard).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 8: Write the failing router tests**

In `frontend/src/tests/router.test.ts`, inside `describe('navigation guards', …)`, after the last test (`'popstate restore is skipped when location already matches lastResolvedPath'`), add:

```ts
  // Polish 1 R47: DirtyGuard's `pending` — every call joins the open question.
  function joiningGuard() {
    let resolve: ((ok: boolean) => void) | null = null;
    let pending: Promise<boolean> | null = null;
    let asked = 0;
    const dispose = registerNavigationGuard(() => {
      if (pending) return pending;
      asked++;
      pending = new Promise<boolean>((r) => { resolve = r; }).then((ok) => { pending = null; return ok; });
      return pending;
    });
    return { dispose, answer: (ok: boolean) => resolve!(ok), asked: () => asked };
  }
  // jsdom fires popstate for history.back() on the second macrotask.
  const popTwice = async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };

  it('R47: a navigate to the current address while asking leaves the pending navigation intact', async () => {
    const g = joiningGuard();
    const pending = navigate('/x');
    await navigate('/');            // the same address: returns at once and must not outdate '/x'
    g.answer(true);
    await pending;
    expect(currentRoute.path).toBe('/x');
    g.dispose();
  });

  it('R47: a double navigate to a guarded target + Discard pushes once', async () => {
    const g = joiningGuard();
    const push = vi.spyOn(history, 'pushState');
    const a = navigate('/x');
    const b = navigate('/x');
    g.answer(true);
    await a;
    await b;
    expect(g.asked()).toBe(1);
    expect(push.mock.calls.filter(([, , u]) => u === '/x')).toHaveLength(1);
    expect(currentRoute.path).toBe('/x');
    push.mockRestore();
    g.dispose();
  });

  it('R47: Back twice while asking + Discard lands on the second target', async () => {
    await navigate('/a');
    await navigate('/b');
    await navigate('/c');
    const g = joiningGuard();
    history.back();
    await popTwice();
    history.back();
    await popTwice();
    expect(location.pathname).toBe('/a');
    g.answer(true);
    await popTwice();
    expect(g.asked()).toBe(1);
    expect(currentRoute.path).toBe('/a');
    g.dispose();
  });

  it('R47: Back twice while asking + Cancel restores the address once', async () => {
    await navigate('/a');
    await navigate('/b');
    await navigate('/c');
    const g = joiningGuard();
    history.back();
    await popTwice();
    history.back();
    await popTwice();
    const push = vi.spyOn(history, 'pushState');
    g.answer(false);
    await popTwice();
    expect(push).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/c');
    expect(currentRoute.path).toBe('/c');
    push.mockRestore();
    g.dispose();
  });

  it('R47: a link, then Back while asking, + Discard lands on the link', async () => {
    await navigate('/a');
    await navigate('/b');
    const g = joiningGuard();
    const link = navigate('/l');
    history.back();
    await popTwice();
    g.answer(true);
    await link;
    await popTwice();
    expect(currentRoute.path).toBe('/l');
    expect(location.pathname).toBe('/l');
    g.dispose();
  });
```

- [ ] **Step 9: Run both files to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/DirtyGuard.svelte.test.ts src/tests/router.test.ts`
Expected: FAIL.
- DirtyGuard: every question test fails: today's guard calls `window.confirm` (jsdom: "Not implemented", falsy), never `ask`. Only "nothing dirty" and "beforeunload" pass.
- router: `R47: a navigate to the current address…` fails (`expected '/' to be '/x'`). The other four R47 tests pass already; they pin the router behaviour R47 relies on.

- [ ] **Step 10: The router line and DirtyGuard**

In `frontend/src/lib/router.svelte.ts` replace

```ts
  // F3: Capture the generation token before any async work.
  const myGen = ++navGen;

  const target = path;
  const current = currentRoute.path + currentRoute.search + currentRoute.hash;
  if (target === current) return;
```

with

```ts
  const target = path;
  const current = currentRoute.path + currentRoute.search + currentRoute.hash;
  if (target === current) return;

  // F3: Capture the generation token before any async work. After the
  // same-target return: a navigate to where we are must not outdate one that
  // waits on a guard's question (Polish 1 R47).
  const myGen = ++navGen;
```

Replace the whole of `frontend/src/components/editor/DirtyGuard.svelte` with:

```svelte
<script lang="ts">
  // Mounts a guard that intercepts in-app navigation AND browser unload while
  // the parent has unsaved changes. `isDirty` is a callback (not a boolean)
  // so the navigation-guard closure dereferences the parent's $state on every
  // check; capturing a boolean prop here would freeze the value at the moment
  // of registration — Svelte 5 $props() ARE reactive on prop changes, but the
  // closure passed to registerNavigationGuard is built once inside onMount
  // and never re-runs, so it would hold a stale capture of the old boolean.
  import { onMount, untrack } from 'svelte';
  import { currentRoute, registerNavigationGuard } from '../../lib/router.svelte';
  import type { GuardAsk } from '../../lib/askInPlace.svelte';

  // Polish 1 (D37): `ask` opens the owner's question in place and resolves
  // true on Discard. `onDiscard` (Slice-5a D3) then runs once — never on
  // beforeunload, which leaves the page anyway.
  let { isDirty, ask, onDiscard = undefined }: {
    isDirty: () => boolean;
    ask: () => GuardAsk;
    onDiscard?: () => void;
  } = $props();

  // R47: while a question is open, every further guarded navigation joins it:
  // no second question, and focus goes back to its Cancel.
  let pending: GuardAsk | null = null;
  // R55: the address (path + search, not the hash) the question was asked from.
  let pendingAt = $state<string | null>(null);
  const address = () => currentRoute.path + currentRoute.search;

  // R55: a route change while asking (a forced navigate, the 401 flow, a
  // stale-id fallback) withdraws the question, which resolves false.
  $effect(() => {
    const at = pendingAt;
    if (at !== null && address() !== at) untrack(() => pending?.dismiss());
  });

  onMount(() => {
    const dispose = registerNavigationGuard(() => {
      if (pending) {
        pending.focusCancel();
        return pending.promise;
      }
      if (!isDirty()) return true;
      const q = ask();
      const joined: GuardAsk = {
        ...q,
        promise: q.promise.then((ok) => {
          if (pending === joined) { pending = null; pendingAt = null; }
          if (ok) onDiscard?.();
          return ok;
        }),
      };
      pending = joined;
      pendingAt = address();
      return joined.promise;
    });
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      dispose();
      window.removeEventListener('beforeunload', onUnload);
      pending?.dismiss();
    };
  });
</script>
```

- [ ] **Step 11: Run both files to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/DirtyGuard.svelte.test.ts src/tests/router.test.ts`
Expected: PASS (DirtyGuard 8 tests; router all tests, 5 of them new). svelte-check now reports `ask` missing on the three `<DirtyGuard>` mounts; the steps below add it.


- [ ] **Step 12: Write the failing owner tests (the drawer and the mini-project modal)**

In `frontend/src/tests/DashboardSidePanel.svelte.test.ts` add to the imports:

```ts
import { navigate, __resetGuardsForTests } from '../lib/router.svelte';
```

and at the end of the file add:

```ts
describe('DashboardSidePanel — leaving with an unsaved evaluation (Polish 1 D37)', () => {
  beforeEach(() => { __resetGuardsForTests(); });
  afterEach(async () => { __resetGuardsForTests(); await navigate('/', { force: true }); });

  it('a navigation asks in the form with "…and continue?"; Cancel keeps the text and refocuses the field', async () => {
    const { onClose } = mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), isAdmin: true });
    await settle();
    const textarea = await typeFeedback('unsaved');
    const start = location.pathname;
    const nav = navigate('/sp-nav-away');
    await settle();
    expect(host.querySelector('form[aria-label="Write evaluation"] .sp-discard .warning')!.textContent!.trim())
      .toBe('Discard unsaved changes and continue?');
    expect(document.activeElement).toBe(discardCancel());
    expect(frozen()).toEqual([true, true, true, true]);
    discardCancel()!.click();
    await nav;
    await settle();
    expect(location.pathname).toBe(start);
    expect(textarea.value).toBe('unsaved');
    expect(document.activeElement).toBe(textarea);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Discard ends the edit and lets the navigation through', async () => {
    const { onClose } = mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), isAdmin: true });
    await settle();
    await typeFeedback('unsaved');
    const nav = navigate('/sp-nav-gone');
    await settle();
    discardConfirm()!.click();
    await nav;
    await settle();
    expect(location.pathname).toBe('/sp-nav-gone');
    expect(discardCancel()).toBeNull();
    expect((host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement).value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('R53: with the × question open, a navigation is refused; focus stays on its Cancel', async () => {
    mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), isAdmin: true });
    await settle();
    await typeFeedback('unsaved');
    const start = location.pathname;
    closeX().click();
    await settle();
    closeX().focus();
    await navigate('/sp-nav-refused');
    await settle();
    expect(location.pathname).toBe(start);
    expect(document.activeElement).toBe(discardCancel());
    expect(host.querySelector('.sp-discard .warning')!.textContent!.trim()).toBe('Discard unsaved changes?');
  });
});
```

In `frontend/src/tests/MiniProjectModal.frame.svelte.test.ts` replace the whole `describe('MiniProjectModal — leaving with edits (D16)', …)` block with:

```ts
describe('MiniProjectModal — leaving with edits (D16, Polish 1 D37)', () => {
  it('a tab jump asks in the footer while dirty, never while clean; Cancel keeps the edit and focuses ×', async () => {
    open();
    await settle();
    await navigate('/mp-frame-clean');
    expect(panel().querySelector('.modal-foot .inline-confirm')).toBeNull();
    type('changed');
    await settle();
    const nav = navigate('/mp-frame-dirty');
    await settle();
    expect(panel().querySelector('.modal-foot .inline-confirm .warning')!.textContent!.trim())
      .toBe('Discard unsaved changes and continue?');
    expect(document.activeElement).toBe(confirmCancel());
    expect(bodyInert()).toBe(true);
    confirmCancel().click();
    await nav;
    await settle();
    expect(location.pathname).toBe('/mp-frame-clean');
    expect(ta().value).toBe('changed');
    expect(document.activeElement).toBe(closeX());
  });

  it('Discard on the tab-jump question lets the navigation through without onClose', async () => {
    const onClose = vi.fn();
    open({ onClose });
    await settle();
    type('changed');
    await settle();
    const nav = navigate('/mp-frame-left');
    await settle();
    btn('confirm-discard')!.click();
    await nav;
    await settle();
    expect(location.pathname).toBe('/mp-frame-left');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('R53: with the × question open, a navigation is refused; focus stays on its Cancel', async () => {
    open();
    await settle();
    await navigate('/mp-frame-start');
    type('changed');
    await settle();
    closeX().click();
    await settle();
    closeX().focus();
    await navigate('/mp-frame-away');
    await settle();
    expect(location.pathname).toBe('/mp-frame-start');
    expect(document.activeElement).toBe(confirmCancel());
    expect(panel().querySelector('.modal-foot .inline-confirm .warning')!.textContent!.trim()).toBe('Discard unsaved changes?');
  });
});
```

- [ ] **Step 13: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/DashboardSidePanel.svelte.test.ts src/tests/MiniProjectModal.frame.svelte.test.ts`
Expected: FAIL — the six new tests. Without an `ask` prop DirtyGuard throws `ask is not a function` inside the guard, so the navigations reject or stay; no question renders. Every older test passes.

- [ ] **Step 14: DashboardSidePanel — the navigation question in the form**

In `frontend/src/components/runs/DashboardSidePanel.svelte` add to the imports:

```ts
  import { DISCARD, DISCARD_CONTINUE } from '../../lib/editorReasons';
  import { refused, type GuardAsk } from '../../lib/askInPlace.svelte';
```

Replace

```ts
  let confirmDiscard = $state(false);
  // The confirm lives in the form: when the form goes (a thread load brings an
  // evaluation), the question goes with it and the body thaws.
  $effect(() => {
    if (!formShown && confirmDiscard) confirmDiscard = false;
  });
  let discardSource: 'cancel' | 'close' = 'close';
  let discardReturnEl: HTMLElement | null = null;

  function askDiscard(source: 'cancel' | 'close') {
```

with

```ts
  let confirmDiscard = $state(false);
  // Polish 1 (D37): a navigation asks here too ('nav') and waits on the answer.
  let navAnswer: ((ok: boolean) => void) | null = null;
  function answerNav(ok: boolean) {
    const r = navAnswer;
    navAnswer = null;
    r?.(ok);
  }
  // The confirm lives in the form: when the form goes (a thread load brings an
  // evaluation), the question goes with it and the body thaws. A waiting
  // navigation is cancelled (R55).
  $effect(() => {
    if (!formShown && confirmDiscard) {
      confirmDiscard = false;
      answerNav(false);
    }
  });
  let discardSource = $state<'cancel' | 'close' | 'nav'>('close');
  let discardReturnEl: HTMLElement | null = null;

  function focusDiscardCancel() {
    const c = discardEl?.querySelector<HTMLButtonElement>('button.cancel');
    c?.closest('.inline-confirm')?.scrollIntoView?.({ block: 'nearest' });
    c?.focus();
  }

  // DirtyGuard's `ask`. While the form's Cancel or × question is open, a
  // navigation is refused and focus goes back to that question (R53).
  function askNav(): GuardAsk {
    if (confirmDiscard) {
      focusDiscardCancel();
      return refused();
    }
    askDiscard('nav');
    const promise = new Promise<boolean>((r) => { navAnswer = r; });
    return {
      promise,
      dismiss: () => {
        if (!navAnswer) return;
        confirmDiscard = false;
        answerNav(false);
      },
      focusCancel: focusDiscardCancel,
    };
  }

  function askDiscard(source: 'cancel' | 'close' | 'nav') {
```

In `tryClose()` replace

```ts
    if (confirmDiscard) {
      discardEl?.querySelector<HTMLButtonElement>('button.cancel')?.focus();
      return;
    }
```

with

```ts
    if (confirmDiscard) {
      focusDiscardCancel();
      return;
    }
```

Replace `discard()` and `cancelDiscard()`:

```ts
  function discard() {
    confirmDiscard = false;
    if (discardSource === 'close') {
      onClose();
      return;
    }
    editing = false;
    resetForm();
    // A navigation goes ahead; its target takes focus.
    if (discardSource === 'nav') {
      answerNav(true);
      return;
    }
    void focusAfterEdit();
  }

  async function cancelDiscard() {
    confirmDiscard = false;
    answerNav(false);
    await tick();
    focusFirst([discardReturnEl, find<HTMLButtonElement>('button[data-test="cancel-button"]'), checkedRadio(), closeX()]);
  }
```

In the `discardRow` snippet replace `warning="Discard unsaved changes?"` with `warning={discardSource === 'nav' ? DISCARD_CONTINUE : DISCARD}`.

Replace `<DirtyGuard isDirty={() => dirtyOnScreen && !submitting} />` with:

```svelte
  <DirtyGuard isDirty={() => dirtyOnScreen && !submitting} ask={askNav} />
```

- [ ] **Step 15: MiniProjectModal — the navigation question in the footer**

In `frontend/src/components/runs/MiniProjectModal.svelte` add to the imports:

```ts
  import { DISCARD, DISCARD_CONTINUE } from '../../lib/editorReasons';
  import { refused, type GuardAsk } from '../../lib/askInPlace.svelte';
```

Replace

```ts
  let pendingClose = $state(false);
```

with

```ts
  let pendingClose = $state(false);
  // Polish 1 (D37): the × question also asks for a navigation ('nav'), which waits on it.
  let closeSource = $state<'close' | 'nav'>('close');
  let navAnswer: ((ok: boolean) => void) | null = null;
  function answerNav(ok: boolean) {
    const r = navAnswer;
    navAnswer = null;
    r?.(ok);
  }
```

Replace `requestClose`, `cancelClose` and `confirmDiscard` (`:301-327`) with:

```ts
  function focusConfirmCancel() {
    const c = panel()?.querySelector<HTMLElement>('.modal-foot .inline-confirm button.cancel');
    c?.closest('.inline-confirm')?.scrollIntoView?.({ block: 'nearest' });
    c?.focus();
  }

  // ×, Esc and create-mode Cancel. While a confirm shows they never close:
  // focus goes back to the confirm's Cancel.
  function requestClose() {
    if (submitting) return;
    if (confirmOpen) {
      focusConfirmCancel();
      return;
    }
    if (dirty) {
      closeSource = 'close';
      pendingClose = true;
      return;
    }
    uploadAbortController?.abort();
    onClose();
  }

  // DirtyGuard's `ask`. While the publish or × question is open, a navigation
  // is refused and focus goes back to that question (R53).
  function askNav(): GuardAsk {
    if (confirmOpen) {
      focusConfirmCancel();
      return refused();
    }
    closeSource = 'nav';
    pendingClose = true;
    const promise = new Promise<boolean>((r) => { navAnswer = r; });
    return {
      promise,
      dismiss: () => {
        if (!navAnswer) return;
        pendingClose = false;
        answerNav(false);
      },
      focusCancel: focusConfirmCancel,
    };
  }

  async function cancelClose() {
    pendingClose = false;
    answerNav(false);
    await tick();
    closeX()?.focus();
  }

  function confirmDiscard() {
    pendingClose = false;
    uploadAbortController?.abort();
    // A navigation goes ahead and unmounts the modal; × closes it.
    if (closeSource === 'nav') {
      answerNav(true);
      return;
    }
    onClose();
  }
```

Replace `<DirtyGuard isDirty={() => dirty && !submitting} />` with:

```svelte
<DirtyGuard isDirty={() => dirty && !submitting} ask={askNav} />
```

In the footer's `{#if pendingClose}` InlineConfirm replace `warning="Discard unsaved changes?"` with `warning={closeSource === 'nav' ? DISCARD_CONTINUE : DISCARD}`.

- [ ] **Step 16: Run the owner tests to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/DashboardSidePanel.svelte.test.ts src/tests/MiniProjectModal.frame.svelte.test.ts src/tests/MiniProjectModal.publish.svelte.test.ts src/tests/MiniProjectModal.create-edit.svelte.test.ts`
Expected: PASS.

- [ ] **Step 17: Write the failing footer tests (Version settings, New item)**

In `frontend/src/tests/VersionSettingsModal.svelte.test.ts` replace the tests `'close with changes prompts; discardAll (Back) closes'` and `'close with nothing changed closes at once'` with:

```ts
  it('close with changes asks in place of the footer buttons (#10); Cancel → ×; discardAll (Back) closes', async () => {
    const p = render();
    type(input('Label'), 'L2');
    expect(registry.isAnyDirty()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync();
    const row = panel().querySelector('footer.modal-foot .inline-confirm')!;
    expect(row.querySelector('.warning')!.textContent!.trim()).toBe('Discard unsaved changes?');
    expect(row.querySelector('button.confirm')!.textContent!.trim()).toBe('Discard');
    expect(footBtn('Save')).toBeUndefined();
    expect(panel().querySelector('div.modal-body')!.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(row.querySelector('button.cancel'));
    (row.querySelector('button.cancel') as HTMLButtonElement).click();
    await settle();
    expect(p.onClose).not.toHaveBeenCalled();
    expect(input('Label').value).toBe('L2');
    expect(document.activeElement).toBe(panel().querySelector('header.modal-head button[aria-label="Close"]'));
    registry.discardAll();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('Discard on the close question closes', async () => {
    const p = render();
    type(input('Label'), 'L2');
    panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.click();
    flushSync();
    panel().querySelector<HTMLButtonElement>('footer.modal-foot .inline-confirm button.confirm')!.click();
    await settle();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('close with nothing changed closes at once', () => {
    const p = render();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(panel().querySelector('.inline-confirm')).toBeNull();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
```

In `frontend/src/tests/NewItemModal.svelte.test.ts` replace the test `'close with typed input prompts; Cancel at the prompt keeps it open'` with:

```ts
  it('close with typed input asks in place of the footer buttons (#11); Cancel goes back to the control that asked', async () => {
    const p = render();
    type(titleIn(), 'half');
    const row = () => panel().querySelector('footer.modal-foot .inline-confirm');
    const footCancel = () => [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')]
      .find((b) => b.textContent!.trim() === 'Cancel' && !b.closest('.inline-confirm'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync();
    expect(row()!.querySelector('.warning')!.textContent!.trim()).toBe('Discard unsaved changes?');
    expect(document.activeElement).toBe(row()!.querySelector('button.cancel'));
    (row()!.querySelector('button.cancel') as HTMLButtonElement).click();
    await settle();
    expect(p.onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(panel().querySelector('header.modal-head button[aria-label="Close"]'));   // Esc counts as ×
    footCancel()!.click();
    flushSync();
    (row()!.querySelector('button.cancel') as HTMLButtonElement).click();
    await settle();
    expect(document.activeElement).toBe(footCancel());
    footCancel()!.click();
    flushSync();
    (row()!.querySelector('button.confirm') as HTMLButtonElement).click();
    await settle();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 18: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/VersionSettingsModal.svelte.test.ts src/tests/NewItemModal.svelte.test.ts`
Expected: FAIL — the three question tests find no `.inline-confirm` (today's close calls `window.confirm`). "Close with nothing changed" passes.

- [ ] **Step 19: Version settings and New item — the close question in the footer**

In `frontend/src/components/editor/VersionSettingsModal.svelte`:

Add to the imports:

```ts
  import AskSlot from '../ui/AskSlot.svelte';
  import { DISCARD_ASK, focusAfter, modalClose, useModalAsk } from '../../lib/askInPlace.svelte';
```

Replace `requestClose()`:

```ts
  // Polish 1: the close question in place of the footer buttons (#10), and the
  // page question while this is the top modal (R46). Read-only, there is no
  // footer: the page question asks at the top of the body, with nothing to freeze.
  const { own: footAsk, page, here } = useModalAsk(labelId);
  const asking = $derived(footAsk.open || here());

  async function requestClose() {
    if (saving) return;
    // × and Esc while a question shows: back to its Cancel (R48).
    if (footAsk.open) { footAsk.focusCancel(); return; }
    if (here()) { page!.ask.focusCancel(); return; }
    if (!dirty) { onClose(); return; }
    const a = await footAsk.ask(DISCARD_ASK);
    if (a === 'confirm') {
      footAsk.settle();
      if (alive) onClose();
      return;
    }
    if (a === 'cancel') void focusAfter(() => modalClose(labelId));
  }
```

Replace the `foot` snippet:

```svelte
{#snippet foot()}
  <span class="dirty mono">{dirty ? 'unsaved changes' : ''}</span>
  {#if footAsk.open}
    <AskSlot ask={footAsk} />
  {:else if here()}
    <AskSlot ask={page!.ask} />
  {:else}
    <Button variant="ghost" disabled={!dirty || saving} onclick={discard}>Discard</Button>
    <Button variant="primary" disabled={!dirty || saving} loading={saving} onclick={() => void save()}>Save</Button>
  {/if}
{/snippet}
```

Replace the `<Modal …>` opening tag:

```svelte
<Modal labelledby={labelId} width={640} maxHeight={600} onRequestClose={() => void requestClose()} closeDisabled={saving}
  bodyInert={editable && asking} header={head} footer={editable ? foot : undefined}>
  {#if !editable && here()}
    <AskSlot ask={page!.ask} />
  {/if}
```

(the existing `{#if editable}` body follows unchanged).

In `frontend/src/components/editor/NewItemModal.svelte`:

Add to the imports:

```ts
  import AskSlot from '../ui/AskSlot.svelte';
  import { DISCARD_ASK, focusAfter, modalClose, useModalAsk } from '../../lib/askInPlace.svelte';
```

Replace `requestClose()`:

```ts
  // Polish 1: the close question in place of the footer buttons (#11), and the
  // page question while this is the top modal (R46).
  const { own: footAsk, page, here } = useModalAsk(labelId);
  let cancelEl = $state<HTMLButtonElement>();

  async function requestClose(from: 'x' | 'cancel') {
    if (busy) return;
    if (footAsk.open) { footAsk.focusCancel(); return; }
    if (here()) { page!.ask.focusCancel(); return; }
    if (!dirty) { onClose(); return; }
    const a = await footAsk.ask(DISCARD_ASK);
    if (a === 'confirm') {
      footAsk.settle();
      if (alive) onClose();
      return;
    }
    // Back to the control that asked; Esc counts as ×.
    if (a === 'cancel') void focusAfter(() => (from === 'cancel' ? cancelEl : modalClose(labelId)));
  }
```

Replace the `foot` snippet and the `<Modal …>` opening tag:

```svelte
{#snippet foot()}
  <!-- Pushes the buttons right, as the item editor's footer (its .dirty slot). -->
  <span class="spacer" aria-hidden="true"></span>
  {#if footAsk.open}
    <AskSlot ask={footAsk} />
  {:else if here()}
    <AskSlot ask={page!.ask} />
  {:else}
    <Button variant="ghost" disabled={busy} bind:element={cancelEl} onclick={() => void requestClose('cancel')}>Cancel</Button>
    <Button variant="primary" disabled={!ready || busy} loading={busy} onclick={() => void submit()}>Create</Button>
  {/if}
{/snippet}

<Modal labelledby={labelId} width={640} maxHeight={600} onRequestClose={() => void requestClose('x')} closeDisabled={busy}
  bodyInert={footAsk.open || here()} header={head} footer={foot}>
```

Update the header comment's sentence "closing asks before dropping typed input" to "closing asks in the footer before dropping typed input".

- [ ] **Step 20: Run them to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/VersionSettingsModal.svelte.test.ts src/tests/NewItemModal.svelte.test.ts`
Expected: PASS.

- [ ] **Step 21: The quiz harness's page option, and the failing level-3 tests**

Replace the whole of `frontend/src/tests/support/ItemEditorModalHarness.svelte` with:

```svelte
<script lang="ts">
  // Provides the page's dirty registry (as VersionEditPage does) around one
  // ItemEditorModal, and mirrors registry.isAnyDirty() into the DOM. With
  // `withPage`, also the page question and its DirtyGuard (Polish 1 R46).
  import { setContext, untrack, type ComponentProps } from 'svelte';
  import ItemEditorModal from '../../components/editor/ItemEditorModal.svelte';
  import DirtyGuard from '../../components/editor/DirtyGuard.svelte';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../../lib/dirtyRegistry.svelte';
  import { PageAsk, PAGE_ASK_KEY } from '../../lib/askInPlace.svelte';

  let { modal, onRegistry, withPage = false }: {
    modal: ComponentProps<typeof ItemEditorModal>;
    onRegistry?: (r: DirtyRegistry) => void;
    withPage?: boolean;
  } = $props();
  const registry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, registry);
  const page = untrack(() => withPage) ? new PageAsk() : null;
  if (page) setContext(PAGE_ASK_KEY, page);
  untrack(() => onRegistry)?.(registry);
  const anyDirty = $derived(registry.isAnyDirty());
</script>

<output data-testid="any-dirty">{anyDirty}</output>
<ItemEditorModal {...modal} />
{#if page}
  <DirtyGuard isDirty={() => registry.isAnyDirty()} onDiscard={() => registry.discardAll()} ask={() => page.guard()} />
{/if}
```

In `frontend/src/tests/support/quizHarness.svelte.ts`, `renderQuiz`: change the options type to

```ts
  over: { version?: Partial<AdminTreeVersion>; item?: Partial<AdminTreeItem>; page?: boolean } = {},
```

and in the `props` object, after `onRegistry: (r: DirtyRegistry) => { registry = r; },` add:

```ts
    withPage: over.page ?? false,
```

In `frontend/src/tests/QuizModals.svelte.test.ts`:

Change the imports:

```ts
import { DISCARD, DISCARD_CONTINUE } from '../lib/editorReasons';
import { FORBIDDEN_TITLE } from '../lib/quizEdits.svelte';
import { navigate } from '../lib/router.svelte';
```

(in place of `import { DISCARD_PROMPT, FORBIDDEN_TITLE } from '../lib/quizEdits.svelte';`), and after `const isL3Open = …` add:

```ts
// A question in place of the top modal's footer buttons (Polish 1).
const footAsk = () => topPanel().querySelector<HTMLElement>('footer.modal-foot .inline-confirm');
const footAskBtn = (k: 'confirm' | 'cancel') => footAsk()?.querySelector<HTMLButtonElement>(`button.${k}`) ?? null;
const xOf = (p: HTMLElement) => p.querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
```

Replace the test `'closing without changes just closes; with changes it asks; Esc closes only the top modal'` with:

```ts
  it('closing without changes just closes; with changes it asks in the footer (#15); Esc closes only the top modal', async () => {
    const r = await renderQuiz(new QuizServer([q({ id: 1 })]));
    await openText();
    footBtn('Cancel').click();
    await settle();
    expect(isL3Open()).toBe(false);
    await openText();
    typeInto(area(), 'changed');
    expect(r.anyDirty()).toBe('true');
    press(area(), 'Escape');
    await settle();
    expect(text(footAsk()!.querySelector('.warning'))).toBe(DISCARD);
    expect(text(footAskBtn('confirm'))).toBe('Discard');
    expect(document.activeElement).toBe(footAskBtn('cancel'));
    expect(topPanel().querySelector('div.modal-body')!.hasAttribute('inert')).toBe(true);
    expect(isL3Open()).toBe(true);
    footAskBtn('cancel')!.click();
    await settle();
    expect(footAsk()).toBeNull();
    expect(document.activeElement).toBe(xOf(topPanel()));      // Esc counts as ×
    press(area(), 'Escape');
    await settle();
    footAskBtn('confirm')!.click();
    await settle();
    expect(isL3Open()).toBe(false);
    expect(r.onRequestClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(byName(cards()[0], 'Edit question 1'));
  });

  it('the footer Cancel asks; Cancel on the question returns to it; ⌘S saves nothing while it asks (R48)', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    await openText();
    typeInto(area(), 'changed');
    footBtn('Cancel').click();
    await settle();
    const e = press(footAskBtn('cancel')!, 's', { metaKey: true });
    await settle();
    expect(e.defaultPrevented).toBe(true);
    expect(qWrites(s)).toEqual([]);
    footAskBtn('cancel')!.click();
    await settle();
    expect(document.activeElement).toBe(footBtn('Cancel'));
  });
```

Replace the test `'Remove confirms, sends null, and focus goes to "+ Add explanation"'` with:

```ts
  it('Remove asks in the footer (#8), sends null on Remove, and focus goes to "+ Add explanation"', async () => {
    const s = new QuizServer([q({ id: 1, explanation_md: 'Old', explanation_html: '<p>Old</p>' })]);
    await renderQuiz(s);
    byName(cards()[0], 'Edit explanation for question 1')!.click();
    await settle();
    byName(topPanel(), 'Remove explanation')!.click();
    await settle();
    expect(text(footAsk()!.querySelector('.warning'))).toBe('Remove the explanation for question 1?');
    expect(text(footAskBtn('confirm'))).toBe('Remove');
    expect(footAskBtn('confirm')!.classList.contains('danger')).toBe(true);
    expect(document.activeElement).toBe(footAskBtn('cancel'));
    footAskBtn('cancel')!.click();
    await settle();
    expect(qWrites(s)).toEqual([]);
    expect(document.activeElement).toBe(byName(topPanel(), 'Remove explanation'));
    byName(topPanel(), 'Remove explanation')!.click();
    await settle();
    footAskBtn('confirm')!.click();
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ explanation_md: null }]);
    expect(cards()[0].querySelector('.qexpl')).toBeNull();
    expect(document.activeElement).toBe(byName(cards()[0], 'Add explanation to question 1'));
  });
```

Replace the test `'Remove keeps focus while its request runs, and after a failure'` with:

```ts
  it('Remove: the busy confirm holds focus while the request runs; after a failure focus is on "Remove explanation" (R54)', async () => {
    const s = new QuizServer([q({ id: 1, explanation_md: 'Old', explanation_html: '<p>Old</p>' })]);
    const hold = s.hold('PATCH', /\/api\/questions\/1$/);
    await renderQuiz(s);
    byName(cards()[0], 'Edit explanation for question 1')!.click();
    await settle();
    byName(topPanel(), 'Remove explanation')!.click();
    await settle();
    const confirm = footAskBtn('confirm')!;
    confirm.click();
    await settle();
    expect(document.activeElement).toBe(confirm);
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    confirm.click();                              // busy: nothing answers twice
    hold.fail(500, 'Boom');
    await settle();
    expect(qWrites(s).length).toBe(1);
    expect(footAsk()).toBeNull();
    expect(text(topPanel().querySelector('.ex-err'))).toBe('Boom');
    expect(document.activeElement).toBe(byName(topPanel(), 'Remove explanation'));
  });
```

In `'R10: a 409 on a focused Save keeps level 3 open, the text and error, and focus inside it'` replace

```ts
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    footBtn('Cancel').click();
    await settle();
```

with

```ts
    footBtn('Cancel').click();
    await settle();
    footAskBtn('confirm')!.click();
    await settle();
```

In `'R10: a 409 on a focused Remove moves focus into the explanation field'` replace

```ts
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const rm = byName(topPanel(), 'Remove explanation')!;
    rm.focus();
    rm.click();
    await settle();
```

with

```ts
    byName(topPanel(), 'Remove explanation')!.click();
    await settle();
    footAskBtn('confirm')!.click();
    await settle();
```

At the end of the file add:

```ts
describe('Level 3 — the page question (Polish 1 R46, R53)', () => {
  it('a dirty level-3 modal + a navigation asks in its footer; Cancel keeps the text and focuses its ×', async () => {
    await renderQuiz(new QuizServer([q({ id: 1 })]), { page: true });
    await openText();
    typeInto(area(), 'changed');
    const before = location.pathname;
    const nav = navigate('/l3-elsewhere');
    await settle();
    expect(text(footAsk()!.querySelector('.warning'))).toBe(DISCARD_CONTINUE);
    expect(document.activeElement).toBe(footAskBtn('cancel'));
    expect(panel().querySelector('.inline-confirm')).toBe(footAsk());    // one question, at the top modal
    expect(topPanel().querySelector('div.modal-body')!.hasAttribute('inert')).toBe(true);
    footAskBtn('cancel')!.click();
    await nav;
    await settle();
    expect(location.pathname).toBe(before);
    expect(area().value).toBe('changed');
    expect(document.activeElement).toBe(xOf(topPanel()));
  });

  it('with its own close question open, a navigation is refused: the address stays, focus on that question\'s Cancel', async () => {
    await renderQuiz(new QuizServer([q({ id: 1 })]), { page: true });
    byName(cards()[0], 'Add explanation to question 1')!.click();
    await settle();
    typeInto(area(), 'typed');
    press(area(), 'Escape');
    await settle();
    const before = location.pathname;
    xOf(topPanel()).focus();
    await navigate('/l3-refused');
    await settle();
    expect(location.pathname).toBe(before);
    expect(document.activeElement).toBe(footAskBtn('cancel'));
    expect(text(footAsk()!.querySelector('.warning'))).toBe(DISCARD);
  });

  it('Discard on the page question drops the edit and lets the navigation through', async () => {
    const r = await renderQuiz(new QuizServer([q({ id: 1 })]), { page: true });
    await openText();
    typeInto(area(), 'changed');
    const nav = navigate('/l3-discarded');
    await settle();
    footAskBtn('confirm')!.click();
    await nav;
    await settle();
    expect(location.pathname).toBe('/l3-discarded');
    expect(isL3Open()).toBe(false);
    expect(r.anyDirty()).toBe('false');
  });
});
```

In `frontend/src/tests/QuizStructure.svelte.test.ts`:

Add `import { DISCARD } from '../lib/editorReasons';`.

In the two tests that close a clean New question modal with its footer Cancel (`'opens New question directly with focus on the checked type; a type change alone is not a change'`, `:34-52`, and `'fields the chosen type hides are not unsaved work'`, `:130-146`), delete the line `const ask = vi.spyOn(window, 'confirm');` and the line `expect(ask).not.toHaveBeenCalled();`. The `expect(isL3Open()).toBe(false);` that follows proves no question was asked: the modal closed at once.

Replace the test `'typed text is unsaved work; Cancel asks first'` with:

```ts
  it('typed text is unsaved work; Cancel asks in the footer first (#13)', async () => {
    const r = await renderQuiz(new QuizServer([]));
    addQ().click();
    await settle();
    typeInto(area(), 'Draft');
    expect(r.anyDirty()).toBe('true');
    footBtn('Cancel').click();
    await settle();
    expect(text(topPanel().querySelector('footer.modal-foot .inline-confirm .warning'))).toBe(DISCARD);
    expect(isL3Open()).toBe(true);
  });
```

- [ ] **Step 22: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/QuizModals.svelte.test.ts src/tests/QuizStructure.svelte.test.ts`
Expected: FAIL — every test that looks for `footer.modal-foot .inline-confirm` (the level-3 modals still call `window.confirm`; jsdom answers it falsy), and the three page-question tests (no host draws the question). The other tests pass.

- [ ] **Step 23: The three level-3 modals — the close question, #8, the page question**

In each of `frontend/src/components/editor/quiz/ExplanationModal.svelte`, `NewQuestionModal.svelte` and `QuestionTextModal.svelte`:

Change the quizEdits import to drop `DISCARD_PROMPT` (`import { FORBIDDEN_TITLE, type EditHandle } from '../../../lib/quizEdits.svelte';`) and add:

```ts
  import AskSlot from '../../ui/AskSlot.svelte';
  import { DISCARD_ASK, focusAfter, modalClose, useModalAsk } from '../../../lib/askInPlace.svelte';
```

Replace `requestClose()` with (identical in the three files):

```ts
  // Polish 1: the close question in place of the footer buttons (#7, #13, #15),
  // and the page question while this is the top modal (R46).
  const { own: footAsk, page, here } = useModalAsk(labelId);
  const asking = $derived(footAsk.open || here());
  let cancelEl = $state<HTMLButtonElement>();

  async function requestClose(from: 'x' | 'cancel') {
    if (saving) return;
    // × and Esc while a question shows: back to its Cancel (R48).
    if (footAsk.open) { footAsk.focusCancel(); return; }
    if (here()) { page!.ask.focusCancel(); return; }
    if (!handle.dirty) { onClose(true); return; }
    const a = await footAsk.ask(DISCARD_ASK);
    if (a === 'confirm') {
      footAsk.settle();
      if (mounted) onClose(true);
      return;
    }
    // Back to the control that asked; Esc counts as ×.
    if (a === 'cancel') void focusAfter(() => (from === 'cancel' ? cancelEl : modalClose(labelId)));
  }
```

In `onWindowKeydown`, replace the last line (`save();` in ExplanationModal, `void save();` in the other two) with the same call behind `if (!asking)`:

```ts
    if (!asking) save();          // ExplanationModal
    if (!asking) void save();     // NewQuestionModal, QuestionTextModal
```

In the `<Modal …>` tag of all three: `onRequestClose={() => void requestClose('x')}` and add `bodyInert={asking}`.

**NewQuestionModal** — replace the `foot` snippet:

```svelte
{#snippet foot()}
  <span class="nq-gap"></span>
  {#if footAsk.open}
    <AskSlot ask={footAsk} />
  {:else if here()}
    <AskSlot ask={page!.ask} />
  {:else}
    <Button variant="ghost" disabled={saving} bind:element={cancelEl} onclick={() => void requestClose('cancel')}>Cancel</Button>
    <Button variant="primary" loading={saving} disabled={!valid || uploading || !ctx.canStruct}
            title={ctx.canStruct ? undefined : FORBIDDEN_TITLE} onclick={() => void save()}>Add question</Button>
  {/if}
{/snippet}
```

**QuestionTextModal** — replace the `foot` snippet:

```svelte
{#snippet foot()}
  <span class="qt-gap"></span>
  {#if footAsk.open}
    <AskSlot ask={footAsk} />
  {:else if here()}
    <AskSlot ask={page!.ask} />
  {:else}
    <Button variant="ghost" disabled={saving} bind:element={cancelEl} onclick={() => void requestClose('cancel')}>Cancel</Button>
    <Button variant="primary" loading={saving} disabled={uploading || !ctx.canText}
            title={!ctx.canText ? FORBIDDEN_TITLE : uploading ? 'Wait for the upload to finish' : undefined}
            onclick={() => void save()}>Save</Button>
  {/if}
{/snippet}
```

**ExplanationModal** — `send()` reports success, `remove()` asks (#8). Replace `send()` and `remove()`:

```ts
  async function send(md: string | null): Promise<boolean> {
    error = null;
    saving = true;
    try {
      const echo = await ctx.edits.track(updateQuestion(qid, { explanation_md: md }));
      // As InlineEdit.commit: never left saving, and a stale success says nothing.
      saving = false;
      ctx.patch(qid, { explanation_md: echo.explanation_md, explanation_html: echo.explanation_html });
      if (!alive()) return true;
      ctx.say('Saved');
      onClose(true);
      return true;
    } catch (e) {
      const m = ctx.failed(e, qid);
      if (!alive()) { saving = false; pushToast(m, 'error'); return false; }
      saving = false;
      error = m;
      return false;
    }
  }

  let removeEl = $state<HTMLButtonElement>();

  // #8: Remove asks in place of the footer buttons; the question stays, busy,
  // while the request runs (R54).
  async function remove() {
    if (saving || !ctx.canText) return;
    if (here()) { page!.ask.focusCancel(); return; }
    const a = await footAsk.ask({
      warning: `Remove the explanation for question ${n}?`,
      confirmLabel: 'Remove', tone: 'danger', layout: 'row', confirmDataAction: 'confirm-remove-explanation',
    });
    if (a === 'cancel') { void focusAfter(() => removeEl); return; }
    if (a !== 'confirm') return;
    // R49: the right to save may have gone while it asked (R10 moves focus then).
    if (!alive() || saving || !ctx.canText) { footAsk.dismiss(); return; }
    let ok = false;
    try {
      ok = await send(null);
    } finally {
      // Success closes this modal (as today); a failure brings focus back to
      // "Remove explanation" if it was still in the question (R57).
      const free = footAsk.focusFree;
      footAsk.settle();
      if (!ok && free && mounted) void focusAfter(() => removeEl);
    }
  }
```

Replace the `foot` snippet:

```svelte
{#snippet foot()}
  {#if exists && !asking}
    <Button variant="danger" bind:element={removeEl} disabled={!ctx.canText} title={ctx.canText ? undefined : FORBIDDEN_TITLE}
            onclick={() => void remove()}>Remove explanation</Button>
  {/if}
  <span class="ex-gap"></span>
  {#if footAsk.open}
    <AskSlot ask={footAsk} />
  {:else if here()}
    <AskSlot ask={page!.ask} />
  {:else}
    <Button variant="ghost" disabled={saving} bind:element={cancelEl} onclick={() => void requestClose('cancel')}>Cancel</Button>
    <Button variant="primary" loading={saving} disabled={!ctx.canText} title={ctx.canText ? undefined : FORBIDDEN_TITLE}
            onclick={save}>Save</Button>
  {/if}
{/snippet}
```

(The old comment "Stays enabled while its own request runs…" goes: the busy question holds focus now.)

- [ ] **Step 24: Run them to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/QuizModals.svelte.test.ts src/tests/QuizStructure.svelte.test.ts`
Expected: PASS.


- [ ] **Step 25: Write the failing ItemEditorModal tests (#19, the body-top row)**

In `frontend/src/tests/ItemEditorModal.svelte.test.ts`, after the `toastTexts` helper add:

```ts
// The body-top question (Polish 1): #19, and the page question when there is no footer.
const bodyAsk = () => panel().querySelector<HTMLElement>('.modal-body > .ask-slot .inline-confirm');
const bodyAskBtn = (k: 'confirm' | 'cancel') => bodyAsk()?.querySelector<HTMLButtonElement>(`button.${k}`) ?? null;
```

Replace the test `'the trash calls onDeleteItem'` with:

```ts
  it('#19: the trash asks at the top of the body; Cancel sends nothing and focuses the trash; Delete calls onDeleteItem once', async () => {
    await render();
    trash().click();
    flushSync();
    expect(bodyAsk()!.querySelector('.warning')!.textContent!.trim()).toBe('Delete item "Eigenvalues"? This cannot be undone.');
    expect(bodyAskBtn('confirm')!.textContent!.trim()).toBe('Delete');
    expect(bodyAskBtn('confirm')!.classList.contains('danger')).toBe(true);
    expect(document.activeElement).toBe(bodyAskBtn('cancel'));
    expect(panel().querySelector('div.body-rest')!.hasAttribute('inert')).toBe(true);
    expect(bodyAsk()!.closest('[inert]')).toBeNull();
    expect(trash().getAttribute('aria-disabled')).toBe('true');
    expect(trash().title).toBe('Answer the question first');
    bodyAskBtn('cancel')!.click();
    await settle();
    expect(bodyAsk()).toBeNull();
    expect(props.modal.onDeleteItem).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trash());
    trash().click();
    flushSync();
    bodyAskBtn('confirm')!.click();
    await settle();
    expect(props.modal.onDeleteItem).toHaveBeenCalledTimes(1);
    expect(bodyAsk()).toBeNull();
  });

  it('#19: while it asks, × and Esc go to its Cancel and never close', async () => {
    await render();
    trash().click();
    flushSync();
    closeBtn().focus();
    closeBtn().click();
    flushSync();
    expect(document.activeElement).toBe(bodyAskBtn('cancel'));
    closeBtn().focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync();
    expect(document.activeElement).toBe(bodyAskBtn('cancel'));
    expect(props.modal.onRequestClose).not.toHaveBeenCalled();
  });

  it('#19: the busy confirm holds focus while the delete runs; when it fails, focus goes to the trash (R54)', async () => {
    let finish!: () => void;
    const onDeleteItem = vi.fn(() => {
      props.modal.deleting = true;
      return new Promise<void>((r) => { finish = () => { props.modal.deleting = false; r(); }; });
    });
    await render({ modal: { onDeleteItem } });
    trash().click();
    flushSync();
    const confirm = bodyAskBtn('confirm')!;
    confirm.click();
    await settle();
    expect(onDeleteItem).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(confirm);
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(closeBtn().disabled).toBe(true);
    finish();
    await settle();
    await settle();
    expect(bodyAsk()).toBeNull();
    expect(document.activeElement).toBe(trash());
  });
```

In `'while deleting: body inert; ×, Save and trash disabled; Escape ignored'` replace

```ts
    expect(panel().querySelector('div.modal-body')!.hasAttribute('inert')).toBe(true);
```

with

```ts
    expect(panel().querySelector('div.body-rest')!.hasAttribute('inert')).toBe(true);
```

- [ ] **Step 26: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/ItemEditorModal.svelte.test.ts`
Expected: FAIL — the three #19 tests (the trash calls `onDeleteItem` at once; no `.ask-slot`) and the deleting test (`div.body-rest` does not exist).

- [ ] **Step 27: ItemEditorModal — the body-top row, #19, the page question**

In `frontend/src/components/editor/ItemEditorModal.svelte`:

Add to the imports:

```ts
  import AskSlot from '../ui/AskSlot.svelte';
  import { focusAfter, useModalAsk } from '../../lib/askInPlace.svelte';
```

In `Props` replace `onDeleteItem: () => void;` with:

```ts
    // #19: called after the body-top question's Delete; resolves when the page's DELETE settles.
    onDeleteItem: () => Promise<void>;
```

After `const isQuiz = $derived(item.type === 'quiz');` add:

```ts
  // ---- Polish 1: the body-top row (#19) and the page question while this is
  //      the top modal (R46). Without a footer (a quiz, a read-only item) the
  //      page question asks in the body-top row too; R53 keeps the two apart.
  const { own: bodyAsk, page, here: pageHere } = useModalAsk(labelId);
  const hasFoot = $derived(canEditText && !isQuiz);
  const asking = $derived(bodyAsk.open || pageHere());
```

In `openTitle()` replace the first line with:

```ts
    if (!quizEdits || titleEdit || deleting || asking || quizEdits.locked) return;
```

In `onWindowKeydown` replace `if (!isQuiz) void save();` with:

```ts
    if (!isQuiz && !asking) void save();   // R48: nothing saves while a question asks
```

After `let trashEl = $state<HTMLButtonElement>();` add:

```ts
  // #19: the delete asks in the body-top row; the page owns the DELETE (D9).
  async function askDelete() {
    if (trashDisabled || asking) return;
    const a = await bodyAsk.ask({
      warning: `Delete item "${item.title}"? This cannot be undone.`,
      confirmLabel: 'Delete', tone: 'danger', layout: 'row', confirmDataAction: 'confirm-delete-item',
    });
    if (a === 'cancel') { void focusAfter(() => trashEl); return; }
    if (a !== 'confirm') return;
    // R49: a save or an edit may have started while it asked.
    if (!alive || trashDisabled) { bodyAsk.dismiss(); return; }
    try {
      await onDeleteItem();
    } finally {
      // Success unmounts this modal; a failure brings focus back to the trash
      // if it was still in the question (R54, R57).
      if (alive) {
        const free = bodyAsk.focusFree;
        bodyAsk.settle();
        if (free) void focusAfter(() => trashEl);
      }
    }
  }

  // × and Esc: while the body-top row asks, back to its Cancel (R48). The page
  // handles its own question (VersionEditPage.requestCloseItem).
  function requestClose() {
    if (bodyAsk.open) { bodyAsk.focusCancel(); return; }
    onRequestClose();
  }
```

In the `head` snippet, the title ✎ becomes:

```svelte
    <IconButton glyph="pencil" size="sm" borderless id={titleEditId} bind:element={titleEditBtn}
                title={asking ? 'Answer the question first' : quizEdits?.locked ? WAIT_TITLE : 'Edit title'}
                aria-label="Edit title" aria-disabled={asking}
                disabled={!!quizEdits?.locked || deleting} onclick={openTitle} />
```

and the trash:

```svelte
    <IconButton
      glyph="trash"
      size="sm"
      danger
      title={asking ? 'Answer the question first' : trashTitle}
      aria-label="Delete item"
      aria-disabled={asking}
      disabled={trashDisabled}
      bind:element={trashEl}
      onclick={() => void askDelete()}
    />
```

Replace the `foot` snippet:

```svelte
{#snippet foot()}
  <span class="dirty mono">{saveDirty ? 'unsaved changes' : ''}</span>
  {#if pageHere()}
    <AskSlot ask={page!.ask} />
  {:else}
    <Button
      variant="ghost"
      disabled={!saveDirty || frozen || bodyBusy}
      title={saveDirty ? undefined : 'No changes to discard'}
      onclick={discard}
    >Discard</Button>
    <Button
      variant="primary"
      disabled={saveBlocked}
      title={saveDirty ? undefined : 'No changes to save'}
      loading={saving}
      onclick={() => void save()}
    >Save</Button>
  {/if}
{/snippet}
```

Replace the `<Modal …>` opening tag and wrap its children:

```svelte
<Modal
  labelledby={labelId}
  autofocusSelector={`#${titleEditId}, [data-autofocus], header.modal-head button[aria-label="Close"]`}
  onRequestClose={requestClose}
  closeDisabled={deleting || saving}
  header={head}
  footer={hasFoot ? foot : undefined}
>
  {#if bodyAsk.open}
    <AskSlot ask={bodyAsk} />
  {:else if pageHere() && !hasFoot}
    <AskSlot ask={page!.ask} />
  {/if}
  <!-- R48: the rest of the body freezes while a question asks or the item
       deletes; the question itself stays live (so no bodyInert). The
       attribute, not the property: jsdom lacks `inert`. -->
  <div class="body-rest" {@attach (el) => { el.toggleAttribute('inert', deleting || asking); }}>
```

and close the `div` just before `</Modal>`: every existing child of `<Modal>` (from `{#if titleEdit?.error}` through the closing `{/if}` of the type bodies) moves inside `div.body-rest`, re-indented by two spaces.

At the end of `<style>` add:

```css
  /* Layout-free: the body's children stay the modal body's flex items, at full size. */
  .body-rest { display: contents; }
  .body-rest > :global(*) { flex: 0 0 auto; }
```

- [ ] **Step 28: Run them to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/ItemEditorModal.svelte.test.ts src/tests/QuizModals.svelte.test.ts src/tests/QuizStructure.svelte.test.ts src/tests/QuizHeader.svelte.test.ts src/tests/QuizItem.svelte.test.ts`
Expected: PASS.

- [ ] **Step 29: Write the failing VersionEditPage tests (the page question)**

In `frontend/src/tests/VersionEditPage.svelte.test.ts`:

After `Element.prototype.scrollIntoView = () => {};` add:

```ts
// …nor scrollTo; the page row's Cancel calls it (D38).
window.scrollTo = (() => {}) as typeof window.scrollTo;
```

After the `posts` helper (`:272`) add:

```ts
// Polish 1 (D38): the page question under the title, and in a modal's footer or body top.
const pageRow = () => target.querySelector<HTMLElement>('.page-ask');
const pageBtn = (k: 'confirm' | 'cancel') => target.querySelector<HTMLButtonElement>(`.page-ask .inline-confirm button.${k}`);
const footAskBtn = (k: 'confirm' | 'cancel') =>
  document.querySelector<HTMLButtonElement>(`section.modal-panel footer.modal-foot .inline-confirm button.${k}`);
const bodyAskBtn = (k: 'confirm' | 'cancel') =>
  document.querySelector<HTMLButtonElement>(`section.modal-panel .modal-body > .ask-slot .inline-confirm button.${k}`);
// A draft the page's Discard really drops (makeDirty's tracker has no discard()).
async function makeDraft() {
  const t = { dirty: true, get isDirty() { return t.dirty; }, discard() { t.dirty = false; } };
  hoisted.registry!.register(t);
  await settle();
  return t;
}
```

Replace the test `'a typed title is guard-dirty; a confirmed navigation discards it'` with:

```ts
  it('a typed title is guard-dirty; Discard on the page question drops it', async () => {
    await render();
    addLine()!.click();
    await settle();
    typeTitle('New block');
    const nav = navigate('/courses/c/edit/v/1/blocks/10');
    await settle();
    expect(pageRow()!.querySelector('.warning')!.textContent!.trim()).toBe('Discard unsaved changes and continue?');
    pageBtn('confirm')!.click();
    await nav;
    await settle();
    expect(addInput()).toBeNull();
    await navigate('/courses/c/edit/v/1');
    await settle();
    expect(pageRow()).toBeNull();
  });
```

In `'a create failure after a confirmed discard toasts and leaves no stale error for the next open'` replace

```ts
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await navigate('/courses/c/edit/v/1/blocks/10');
    await settle();
```

with

```ts
    const nav = navigate('/courses/c/edit/v/1/blocks/10');
    await settle();
    pageBtn('confirm')!.click();
    await nav;
    await settle();
```

Replace the test `'collapse with a confirmed prompt drops the draft; re-expanding, + opens an empty form without a prompt'` with:

```ts
  it('collapse with Discard on the page question drops the draft; re-expanding, + opens an empty form without a question', async () => {
    await navigate('/courses/c/edit/v/1/blocks/10', { force: true });
    await renderRouted();
    const plus = () => [...target.querySelectorAll<HTMLButtonElement>('button.add-line')].find((b) => b.textContent!.includes('Add sequence'))!;
    const title = () => target.querySelector<HTMLInputElement>('input[aria-label="New sequence title"]');
    plus().click();
    await settle();
    title()!.value = 'Draft';
    title()!.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const nav = navigate('/courses/c/edit/v/1'); // collapse the block: the page question asks under the title
    await settle();
    expect(pageRow()).not.toBeNull();
    pageBtn('confirm')!.click();
    await nav;
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    // 5c: a collapsed block carries no "+ Add sequence" — expand it, then open the row.
    target.querySelector<HTMLButtonElement>('#block-10-header')!.click();
    await settle();
    plus().click();
    await settle();
    expect(pageRow()).toBeNull();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/10');
    expect(title()!.value).toBe('');
  });
```

In `describe('VersionEditPage — the item modal (Slice-5b T3b)', …)`:

Replace `'a prompt cancelled on × re-arms it; the next confirmed × closes'` with:

```ts
  it('× with a draft asks in the item modal\'s footer (R46); Cancel re-arms × and focuses it; Discard closes', async () => {
    await openFromPage();
    typeInto(titleField(), 'Draft');
    const back = vi.spyOn(history, 'back');
    xBtn().click();
    await waitPop();
    expect(modal()!.querySelector('footer.modal-foot .inline-confirm .warning')!.textContent!.trim())
      .toBe('Discard unsaved changes and continue?');
    expect(document.activeElement).toBe(footAskBtn('cancel'));
    expect(modal()!.querySelector('div.body-rest')!.hasAttribute('inert')).toBe(true);
    expect(pageRow()).toBeNull();
    footAskBtn('cancel')!.click();
    await waitPop();
    expect(currentRoute.path).toBe(ITEM(30));
    expect(titleField().value).toBe('Draft');
    expect(document.activeElement).toBe(xBtn());
    xBtn().click();
    await waitPop();
    footAskBtn('confirm')!.click();
    await waitPop();
    expect(back).toHaveBeenCalledTimes(2);
    expect(currentRoute.path).toBe(SEQ);
    expect(modal()).toBeNull();
  });
```

Replace `'deep link with a draft: × prompts, cancel keeps the draft and re-arms; Escape prompts again'` with:

```ts
  it('deep link with a draft: × asks, Cancel keeps the draft and re-arms; Escape asks again', async () => {
    await navigate(ITEM(30), { force: true });
    await renderRouted();
    typeInto(titleField(), 'Draft');
    xBtn().click();
    await settle();
    expect(footAskBtn('cancel')).not.toBeNull();
    footAskBtn('cancel')!.click();
    await settle();
    expect(currentRoute.path).toBe(ITEM(30));
    expect(titleField().value).toBe('Draft');
    esc();
    await settle();
    expect(footAskBtn('cancel')).not.toBeNull();
    expect(titleField().value).toBe('Draft');
  });
```

Replace `'browser Back and the course link prompt while the modal has a draft; cancel keeps it'` with:

```ts
  it('browser Back and the course link ask while the modal has a draft; Cancel keeps it', async () => {
    await openFromPage();
    typeInto(titleField(), 'Draft');
    history.back();
    await waitPop();
    expect(footAskBtn('cancel')).not.toBeNull();
    footAskBtn('cancel')!.click();
    await waitPop();
    expect(modal()).not.toBeNull();
    target.querySelector<HTMLAnchorElement>('h1 a')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await settle();
    expect(footAskBtn('cancel')).not.toBeNull();
    footAskBtn('cancel')!.click();
    await settle();
    expect(currentRoute.path).toBe(ITEM(30));
    expect(titleField().value).toBe('Draft');
  });
```

In `'delete: one confirm, frozen in flight, …'` rename it to `'delete: one question, frozen in flight, one replace+force close after which the reload lands, then toast and header focus'`, delete the `const confirmSpy = …` line, and replace

```ts
    trashBtn().click();
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith('Delete item "Item 30"? This cannot be undone.');
    expect(modal()!.querySelector('div.modal-body')!.hasAttribute('inert')).toBe(true);
```

with

```ts
    trashBtn().click();
    await settle();
    expect(modal()!.querySelector('.modal-body > .ask-slot .warning')!.textContent!.trim())
      .toBe('Delete item "Item 30"? This cannot be undone.');
    bodyAskBtn('confirm')!.click();
    await settle();
    expect(document.activeElement).toBe(bodyAskBtn('confirm'));      // R54: the busy confirm holds focus
    expect(modal()!.querySelector('div.body-rest')!.hasAttribute('inert')).toBe(true);
```

In `'a failed DELETE keeps the modal open and unfrozen, with focus on the trash'` replace

```ts
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openFromPage();
    trashBtn().click();
    await settle();
    await settle();
```

with

```ts
    await openFromPage();
    trashBtn().click();
    await settle();
    bodyAskBtn('confirm')!.click();
    await settle();
    await settle();
```

and `div.modal-body` with `div.body-rest` in its inert assertion; add `expect(bodyAskBtn('confirm')).toBeNull();` before the focus assertion.

In `'browser Back during the DELETE, then another item: …'` delete the `vi.spyOn(window, 'confirm').mockReturnValue(true);` line, replace

```ts
    trashBtn().click();
    await settle();
    history.back();
```

with

```ts
    trashBtn().click();
    await settle();
    bodyAskBtn('confirm')!.click();
    await settle();
    history.back();
```

and `div.modal-body` with `div.body-rest` in its inert assertion.

At the end of the same describe add:

```ts
  it('× while the page question is open in the item modal focuses its Cancel and never navigates twice; × works again after Cancel', async () => {
    await openFromPage();
    typeInto(titleField(), 'Draft');
    const back = vi.spyOn(history, 'back');
    xBtn().click();
    await waitPop();
    xBtn().focus();
    xBtn().click();
    esc();
    await waitPop();
    expect(back).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(footAskBtn('cancel'));
    footAskBtn('cancel')!.click();
    await waitPop();
    expect(document.activeElement).toBe(xBtn());
    xBtn().click();
    await waitPop();
    expect(back).toHaveBeenCalledTimes(2);
    expect(footAskBtn('cancel')).not.toBeNull();
  });

  it('R53: with the delete question open, Back with a draft elsewhere is refused; focus goes to its Cancel', async () => {
    await openFromPage();
    await makeDirty();               // a draft elsewhere on the page; the item itself is clean, so its trash is live
    trashBtn().click();
    await settle();
    xBtn().focus();
    history.back();
    await waitPop();
    expect(currentRoute.path).toBe(ITEM(30));
    expect(location.pathname).toBe(ITEM(30));
    expect(document.activeElement).toBe(bodyAskBtn('cancel'));
    expect(modal()!.querySelectorAll('.inline-confirm')).toHaveLength(1);
  });
```

At the end of the file add:

```ts
describe('VersionEditPage — the page question (Polish 1 D38, R46–R48)', () => {
  beforeEach(() => {
    tree.blocks = [mkBlock(10), mkBlock(11)];
  });
  const courseLink = () => target.querySelector<HTMLAnchorElement>('h1 a')!;
  const gearBtn = () => target.querySelector<HTMLButtonElement>('.editor-heading button[aria-label="Version settings"]')!;

  it('Enter on a block header with a draft elsewhere asks under the title; the page below freezes; Cancel returns to that header', async () => {
    await navigate('/courses/c/edit/v/1', { force: true });
    await renderRouted();
    await makeDirty();
    const header = target.querySelector<HTMLButtonElement>('#block-10-header')!;
    header.focus();
    header.click();                                    // keyboard activation: detail 0
    await settle();
    expect(pageRow()!.querySelector('.warning')!.textContent!.trim()).toBe('Discard unsaved changes and continue?');
    expect(pageBtn('confirm')!.textContent!.trim()).toBe('Discard');
    expect(document.activeElement).toBe(pageBtn('cancel'));
    expect(target.querySelector('section.blocks')!.hasAttribute('inert')).toBe(true);
    expect(target.querySelector('.state-actions')!.hasAttribute('inert')).toBe(true);
    expect(courseLink().closest('[inert]')).toBeNull();
    expect(gearBtn().getAttribute('aria-disabled')).toBe('true');
    expect(gearBtn().title).toBe('Answer the question first');
    gearBtn().click();
    await settle();
    expect(document.querySelector('section.modal-panel')).toBeNull();
    pageBtn('cancel')!.click();
    await settle();
    expect(pageRow()).toBeNull();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    expect(target.querySelector('section.blocks')!.hasAttribute('inert')).toBe(false);
    expect(gearBtn().getAttribute('aria-disabled')).toBeNull();
    expect(document.activeElement).toBe(header);
  });

  it('a mouse-style trigger (nothing focused): Cancel scrolls back to where it was and focuses the course link', async () => {
    await navigate('/courses/c/edit/v/1', { force: true });
    await renderRouted();
    await makeDirty();
    (document.activeElement as HTMLElement | null)?.blur();
    Object.defineProperty(window, 'scrollY', { value: 240, configurable: true });
    const scrollTo = vi.spyOn(window, 'scrollTo');
    void navigate('/courses/c/edit/v/1/blocks/10');
    await settle();
    pageBtn('cancel')!.click();
    await settle();
    expect(scrollTo).toHaveBeenCalledWith({ top: 240 });
    expect(document.activeElement).toBe(courseLink());
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });

  it('Discard with focus left on <body>: one check focuses the course link, and only once', async () => {
    await navigate('/courses/c/edit/v/1', { force: true });
    await renderRouted();
    await makeDraft();
    (document.activeElement as HTMLElement | null)?.blur();
    const nav = navigate('/courses/c/edit/v/1?tab=x');
    await settle();
    pageBtn('confirm')!.click();
    await nav;
    await settle();
    await tick0();
    expect(currentRoute.search).toBe('?tab=x');
    expect(document.activeElement).toBe(courseLink());
    courseLink().blur();
    await navigate('/courses/c/edit/v/1?tab=y');
    await tick0();
    expect(document.activeElement).toBe(document.body);
  });

  it('a read-only Version settings + a navigation asks at the top of its body; Cancel → its ×', async () => {
    tree.version = mkVersion({ state: 'published' });
    await navigate('/courses/c/edit/v/1', { force: true });
    await renderRouted();
    await makeDirty();
    gearBtn().click();
    await settle();
    expect(modal()!.querySelector('footer.modal-foot')).toBeNull();
    const nav = navigate('/courses/c/edit/v/1/blocks/10');
    await settle();
    expect(pageRow()).toBeNull();
    expect(bodyAskBtn('cancel')).not.toBeNull();
    expect(modal()!.querySelector('.modal-body > .ask-slot .warning')!.textContent!.trim()).toBe('Discard unsaved changes and continue?');
    expect(document.activeElement).toBe(bodyAskBtn('cancel'));
    bodyAskBtn('cancel')!.click();
    await nav;
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    expect(document.activeElement).toBe(xBtn());
  });
});
```

- [ ] **Step 30: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/VersionEditPage.svelte.test.ts`
Expected: FAIL — every rewritten or new navigation test (VersionEditPage's DirtyGuard has no `ask` yet, so its guard throws; no `.page-ask`). The tests of other tasks (`state bar`, `late transition`, `no spurious stale-id toast`) still pass on their `window.confirm` spies.

- [ ] **Step 31: VersionEditPage — the page question, the × rule, #19's DELETE**

In `frontend/src/pages/editor/VersionEditPage.svelte`:

Replace the svelte import (`:2`) with:

```ts
  import { setContext, onDestroy, tick, untrack } from 'svelte';
```

and add:

```ts
  import AskSlot from '../../components/ui/AskSlot.svelte';
  import { PageAsk, PAGE_ASK_KEY, focusIsFree, usable, type GuardAsk } from '../../lib/askInPlace.svelte';
```

After `setContext(DIRTY_REGISTRY_KEY, dirtyRegistry);` add:

```ts
  // Polish 1 (D38, R46): the one navigation question. The top-most modal that
  // hosts it draws it, else the row under the title, which freezes the page
  // below it (R48). Provided before any host mounts, as the registry is.
  const page = new PageAsk();
  setContext(PAGE_ASK_KEY, page);
  const pageAsk = page.ask;
  const rowAsking = $derived(pageAsk.open && page.hosts.length === 0);
```

Replace

```ts
  let alive = true;
  onDestroy(() => { alive = false; clearEditorVersion(); });
```

with

```ts
  let alive = true;
  onDestroy(() => { alive = false; pageAsk.dismiss(); clearEditorVersion(); });
```

Delete the popstate listener (`:232-237`):

```ts
  // D7: a guard cancelled at the prompt leaves the item open — re-arm ×.
  onMount(() => {
    const onPop = () => { closing = false; };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });
```

(× re-arms in `askPage` below, once the question is answered or refused.)

In `requestCloseItem()` replace

```ts
  function requestCloseItem() {
    if (closing) return;
```

with

```ts
  function requestCloseItem() {
    // The page question is open in this modal (R46): × and Esc go to its
    // Cancel and never navigate twice.
    if (pageAsk.open) { pageAsk.focusCancel(); return; }
    if (closing) return;
```

In `deleteOpenItem()` delete the line

```ts
    if (!confirm(`Delete item "${it.title}"? This cannot be undone.`)) return;
```

and change its leading comment to:

```ts
  // D9: page-owned, so the reload, toast and focus survive the modal's unmount.
  // The item modal asked first (#19) and awaits this.
```

After `deleteOpenItem()` add:

```ts
  // DirtyGuard's `ask` (D38). The row under the title remembers where the
  // person was — the focused element and the scroll position — before it
  // scrolls itself into view.
  let rowReturnEl: HTMLElement | null = null;
  let rowScrollY = 0;
  let courseLinkEl = $state<HTMLAnchorElement>();

  function askPage(): GuardAsk {
    if (page.hosts.length === 0) {
      const a = document.activeElement;
      rowReturnEl = a instanceof HTMLElement && a !== document.body ? a : null;
      rowScrollY = window.scrollY;
    }
    const iid = routeIid;
    return page.guard((answer, host) => {
      // D7: × re-arms once the question is answered or refused, unless it closed the item.
      void tick().then(() => { if (alive && routeIid === iid) closing = false; });
      if (answer === 'confirm') setTimeout(rescueFocus, 0);
      else if (answer === 'cancel' && !host) void restoreAfterRowCancel();
    });
  }

  // Page-row Cancel: back to the saved element; without one (a mouse click in
  // Safari focuses nothing), back to the saved scroll position and the course link.
  async function restoreAfterRowCancel() {
    await tick();   // the page thaws
    if (!alive || !focusIsFree()) return;
    const back = rowReturnEl;
    rowReturnEl = null;
    if (usable(back)) { back.focus(); return; }
    window.scrollTo({ top: rowScrollY });
    courseLinkEl?.focus({ preventScroll: true });
  }

  // Discard: once the router committed and Svelte flushed, focus is never left
  // on <body> — the route's deepest header, else the course link. Runs once.
  function rescueFocus() {
    if (!alive) return;
    const a = document.activeElement;
    if (a && a !== document.body) return;
    const deep = routeSid !== null ? document.getElementById(`seq-${routeSid}-header`)
      : routeBid !== null ? document.getElementById(`block-${routeBid}-header`) : null;
    (usable(deep) ? deep : courseLinkEl)?.focus();
  }
```

In the markup, the `<h1>` link gets `bind:this={courseLinkEl}`:

```svelte
        <h1><a href={`/courses/${courseSlug}/edit`} title="Back to versions" bind:this={courseLinkEl} onclick={onCourseLink}>{tree.course.name}</a>{#if v.label}<span class="vlabel">{` · ${v.label}`}</span>{/if}</h1>
```

the settings button becomes:

```svelte
          <IconButton size="sm" glyph="pencil" title={rowAsking ? 'Answer the question first' : 'Version settings'}
            aria-label="Version settings" aria-disabled={rowAsking}
            bind:element={settingsBtn} onclick={() => { if (!rowAsking) settingsOpen = true; }} />
```

and right after the closing `</div>` of `div.editor-heading` add:

```svelte
      {#if rowAsking}
        <!-- D38: the page's question while no modal hosts it. -->
        <div class="page-ask"><AskSlot ask={pageAsk} /></div>
      {/if}
```

`section.blocks` and `div.state-actions` freeze while the row asks:

```svelte
      <section class="blocks" aria-labelledby={blocksHeadingId} {@attach (el) => { el.toggleAttribute('inert', rowAsking); }}>
```

```svelte
      <div class="state-actions" {@attach (el) => { el.toggleAttribute('inert', rowAsking); }}>
```

On `<ItemEditorModal>` replace `onDeleteItem={() => void deleteOpenItem()}` with `onDeleteItem={deleteOpenItem}`.

Replace the DirtyGuard line with:

```svelte
      <DirtyGuard isDirty={() => dirtyRegistry.isAnyDirty()} onDiscard={() => dirtyRegistry.discardAll()} ask={askPage} />
```

At the end of `<style>` add:

```css
  /* D38: the row under the title. When it scrolls into view, the fixed Toaster
     (components/chrome/Toaster.svelte) stays clear of it. */
  .page-ask { margin: 0 0 18px; }
  .page-ask :global(.inline-confirm) { scroll-margin-top: 4.5rem; }
```

- [ ] **Step 32: Run them to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/VersionEditPage.svelte.test.ts src/tests/ItemEditorModal.svelte.test.ts`
Expected: PASS. If a test hangs at `await navigate(…)`, it navigates with unsaved work and never answers the question: answer it as the tests above do (`const nav = navigate(…); await settle(); pageBtn('confirm')!.click(); await nav;`).

- [ ] **Step 33: Write the failing gate rows**

In `frontend/scripts/visual-refresh-gate.sh`, replace `:4519-4528`:

```zsh
# Every 5d prompt and title comes from quizEdits (DISCARD_PROMPT, WAIT_TITLE,
# FORBIDDEN_TITLE, KEY_CONFIRM), never a copy.
if grep -lE "Discard unsaved changes and continue|Wait for the save to finish|This version can no longer be edited|This quiz is published\. Changing the answer key" $FILES_5D >/dev/null 2>&1; then
  echo "FAIL  5d components use the quizEdits texts, not copies"; fail=1
else echo "PASS  5d components use the quizEdits texts, not copies"; fi
# DISCARD_PROMPT is the DirtyGuard text (spec §Unsaved work): the two literals stay equal.
dp_q=$(grep -oE "DISCARD_PROMPT = '[^']+'" src/lib/quizEdits.svelte.ts | sed -E "s/.*= '([^']+)'/\1/")
dp_g=$(grep -oE "window\.confirm\('[^']+'\)" src/components/editor/DirtyGuard.svelte | sed -E "s/.*\('([^']+)'\)/\1/")
if [[ -n $dp_q && $dp_q == $dp_g ]]; then echo "PASS  DISCARD_PROMPT equals the DirtyGuard prompt ($dp_q)"
else echo "FAIL  DISCARD_PROMPT ('$dp_q') differs from the DirtyGuard prompt ('$dp_g')"; fail=1; fi
```

with

```zsh
# Every 5d prompt and title comes from quizEdits / editorReasons (DISCARD_PROMPT,
# DISCARD, WAIT_TITLE, FORBIDDEN_TITLE, KEY_CONFIRM), never a copy.
if grep -lE "Discard unsaved changes|Wait for the save to finish|This version can no longer be edited|This quiz is published\. Changing the answer key" $FILES_5D >/dev/null 2>&1; then
  echo "FAIL  5d components use the quizEdits texts, not copies"; fail=1
else echo "PASS  5d components use the quizEdits texts, not copies"; fi
# Polish 1 R51: the two discard texts are written once, in editorReasons.ts.
dlit=(${(f)"$(grep -rlF 'Discard unsaved changes' src --include='*.svelte' --include='*.ts' --exclude-dir=tests --exclude='*.test.ts' | grep -v '^src/lib/editorReasons\.ts$')"})
if [[ ${#dlit[@]} -eq 0 ]]; then echo "PASS  the discard texts appear only in editorReasons.ts (R51)"
else echo "FAIL  the discard texts appear outside editorReasons.ts: $dlit"; fail=1; fi
```

At the end of section (am) (before `# The summary line is the parent process's …`) add:

```zsh
# Task 2 — ask in place.
if grep -qF "DISCARD_CONTINUE = 'Discard unsaved changes and continue?'" src/lib/editorReasons.ts \
   && grep -qF "DISCARD = 'Discard unsaved changes?'" src/lib/editorReasons.ts; then
  echo "PASS  editorReasons.ts defines DISCARD_CONTINUE and DISCARD (R51)"
else echo "FAIL  editorReasons.ts defines DISCARD_CONTINUE and DISCARD (R51)"; fail=1; fi
emoji_scan "the Polish-1 ask files" src/lib/askInPlace.svelte.ts src/lib/editorReasons.ts \
  src/components/editor/DirtyGuard.svelte src/components/ui/AskSlot.svelte
colour_scan polish1-ask src/lib/askInPlace.svelte.ts src/lib/editorReasons.ts \
  src/components/editor/DirtyGuard.svelte src/components/ui/AskSlot.svelte
# The slot anchors a question without a box of its own.
own ask-slot AskSlot.svelte
uniq1 ask-slot
if [[ -n $REPLY ]]; then
  N=AskSlot; H=$REPLY
  d '\.ask-slot' '' 'display:contents'
  chk "\.ask-slot\.${H}>\*" 'flex:0 0 auto'
fi
# D38: the row under the title, clear of the fixed Toaster when it scrolls into view.
own page-ask VersionEditPage.svelte
uniq1 page-ask
if [[ -n $REPLY ]]; then
  N=VersionEditPage; H=$REPLY
  d '\.page-ask' '' 'margin:0 0 18px'
  chk "\.page-ask\.${H} \.inline-confirm" 'scroll-margin-top:4\.5rem'
fi
# R48: ItemEditorModal's body freezes below its body-top row in a layout-free wrapper.
own body-rest ItemEditorModal.svelte
uniq1 body-rest
if [[ -n $REPLY ]]; then
  N=ItemEditorModal; H=$REPLY
  d '\.body-rest' '' 'display:contents'
  chk "\.body-rest\.${H}>\*" 'flex:0 0 auto'
fi
```

In `GLOBAL_ALLOW` (`:388`), after the two InlineConfirm entries from Task 1, add:

```python
    # Polish 1 T2: the ask slot and the item modal's body wrapper are layout-free
    # (display: contents); `> :global(*)` keeps their direct children full-size
    # flex items, child-combinator scoped under the hashed class. The page row's
    # `:global(.inline-confirm)` sets only scroll-margin, scoped under the hashed
    # .page-ask. None renders inside SequencePlayer.
    ('src/components/ui/AskSlot.svelte', '*'),
    ('src/components/editor/ItemEditorModal.svelte', '*'),
    ('src/pages/editor/VersionEditPage.svelte', '.inline-confirm'),
```

Set `EXPECTED_CHECKS=2163` (`:90`).

Run the gate (Global Constraints). Expected: `ALL PASS (2163 checks)` once the code of Steps 3–31 is in. To see these rows fail first, run it with the Step 27 and Step 31 style blocks stashed: the four `.ask-slot` rows pass, the eight `.page-ask` / `.body-rest` rows fail.

- [ ] **Step 34: Full checks**

Run vitest, svelte-check and the gate (Global Constraints). Expected: vitest green; svelte-check 0 errors, 13 warnings; gate `ALL PASS (2163 checks)`.

- [ ] **Step 35: Screenshots, the user's OK, review lanes, commit**

Screenshots at 1280 wide, dev data, every write mocked (the item DELETE held, so the busy state shows):
- the page row under the title: a block rename draft + a click on another block's header; one with Cancel Tab-focused;
- the page question in the item modal's footer (a static page with a title draft + Back) and at its body top (a quiz item with a draft elsewhere + Back);
- a read-only Version settings + Back (the body-top row);
- the footer questions: Version settings ×, New item Esc, New question Cancel, Question text ×, Explanation × and Remove (busy);
- #19 in the item modal: asking, and busy;
- the drawer's and the mini-project modal's navigation question ("…and continue?").

Then the per-task loop: the user's OK, both lanes until clean, commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/lib/askInPlace.svelte.ts frontend/src/components/ui/AskSlot.svelte \
  frontend/src/lib/editorReasons.ts frontend/src/lib/dirtyRegistry.svelte.ts frontend/src/lib/quizEdits.svelte.ts frontend/src/lib/router.svelte.ts \
  frontend/src/components/editor/DirtyGuard.svelte frontend/src/components/runs/DashboardSidePanel.svelte frontend/src/components/runs/MiniProjectModal.svelte \
  frontend/src/components/editor/VersionSettingsModal.svelte frontend/src/components/editor/NewItemModal.svelte \
  frontend/src/components/editor/quiz/ExplanationModal.svelte frontend/src/components/editor/quiz/NewQuestionModal.svelte \
  frontend/src/components/editor/quiz/QuestionTextModal.svelte frontend/src/components/editor/ItemEditorModal.svelte \
  frontend/src/pages/editor/VersionEditPage.svelte frontend/scripts/visual-refresh-gate.sh \
  frontend/src/tests/support/ItemEditorModalHarness.svelte frontend/src/tests/support/quizHarness.svelte.ts \
  frontend/src/tests/askInPlace.svelte.test.ts frontend/src/tests/DirtyGuard.svelte.test.ts frontend/src/tests/router.test.ts \
  frontend/src/tests/DashboardSidePanel.svelte.test.ts frontend/src/tests/MiniProjectModal.frame.svelte.test.ts \
  frontend/src/tests/VersionSettingsModal.svelte.test.ts frontend/src/tests/NewItemModal.svelte.test.ts \
  frontend/src/tests/QuizModals.svelte.test.ts frontend/src/tests/QuizStructure.svelte.test.ts \
  frontend/src/tests/ItemEditorModal.svelte.test.ts frontend/src/tests/VersionEditPage.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(polish1): ask in place — leaving with unsaved work and the modal footers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 3: Course tree deletes (#3, #4, #5)

**Files:**
- Create: `frontend/src/components/editor/TreeAskRow.svelte`
- Modify: `frontend/src/lib/askInPlace.svelte.ts` (the tree's question and three focus helpers)
- Modify: `frontend/src/components/editor/BlockAccordion.svelte` (`deleteBlock`, `:109-136`; markup `:286-307`)
- Modify: `frontend/src/components/editor/SequenceAccordion.svelte` (`deleteSeq` `:97-122`, `deleteItem` `:149-165`; markup `:217-262`)
- Modify: `frontend/src/components/editor/AccordionHeader.svelte` (the trash, `:242-250`)
- Modify: `frontend/src/components/editor/ItemRow.svelte` (the trash, `:69`)
- Modify: `frontend/src/pages/editor/VersionEditPage.svelte` (`useTreeAsk()`, the course link and "+ Add block" `data-action`s)
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (am), `EXPECTED_CHECKS`)
- Test: `frontend/src/tests/askInPlace.svelte.test.ts`, `frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts` (`:343-389`, `:431-440`), `frontend/src/tests/BlockAccordion.svelte.test.ts` (`:194-273`), `frontend/src/tests/VersionEditPage.svelte.test.ts` (`:616-649`)

**Interfaces:**
- Consumes (Task 2): `InPlaceAsk` (`current`, `busy`, `host`, `focusFree`, `ask`, `settle`, `dismiss`), `Ask`, `focusAfter`, `focusIsFree`, `usable`, `AskSlot`; Task 2's VersionEditPage import line from `askInPlace.svelte`.
- Produces (Tasks 4 and 6 use the helpers):
  - `firstUsable(...els: (Element | null | undefined)[]): HTMLElement | null`
  - `settleTo(ask: InPlaceAsk, q: Ask, target: () => Element | null | undefined, opts?: FocusOptions): Promise<HTMLElement | null>` — R54's settle for question `q` only; returns what it focused.
  - `moveOn(interim: HTMLElement, target: () => Element | null | undefined): Promise<void>` — R57's second move.
  - `withdraw(ask: InPlaceAsk, q: Ask, target: () => Element | null | undefined): void` — R49 after a confirm.
  - `TREE_ASK_KEY`, `useTreeAsk(): InPlaceAsk` — keys `block-<id>`, `seq-<id>`, `item-<id>`.
  - `TreeAskRow` props `{ ask: InPlaceAsk; askKey: string; live?: boolean; fallback?: () => Element | null | undefined }`.
  - `data-action`s: `delete-block`, `delete-sequence` (AccordionHeader), `delete-item` (ItemRow), `course-link`, `add-block` (VersionEditPage); confirms `confirm-delete-block`, `confirm-delete-sequence`, `confirm-delete-item`.

- [ ] **Step 1: Write the failing helper tests**

In `frontend/src/tests/askInPlace.svelte.test.ts`, extend the import:

```ts
import { InPlaceAsk, PageAsk, focusIsFree, usable, refused, settleTo, moveOn, withdraw, firstUsable, DISCARD_ASK, type Answer, type Ask, type AskHost } from '../lib/askInPlace.svelte';
```

and append:

```ts
describe('settleTo / moveOn / withdraw (Task 3, R54, R57, R49)', () => {
  async function confirmed(a: InPlaceAsk, q: Ask) {
    const p = a.ask(q);
    const b = drawn(a);
    a.answer('confirm');
    await p;
    return b;
  }
  let t: HTMLButtonElement;
  beforeEach(() => { t = document.createElement('button'); document.body.appendChild(t); });
  afterEach(() => { t.remove(); });

  it('settleTo closes the busy question and focuses the target when focus was in it', async () => {
    const a = new InPlaceAsk();
    const q = Q();
    await confirmed(a, q);
    expect(await settleTo(a, q, () => t)).toBe(t);
    expect(a.open).toBe(false);
    expect(document.activeElement).toBe(t);
  });

  it('settleTo still closes, but leaves focus the person moved (R57)', async () => {
    const a = new InPlaceAsk();
    const q = Q();
    await confirmed(a, q);
    const away = document.createElement('input');
    document.body.appendChild(away);
    away.focus();
    expect(await settleTo(a, q, () => t)).toBeNull();
    expect(a.open).toBe(false);
    expect(document.activeElement).toBe(away);
    away.remove();
  });

  it('settleTo leaves another question and a dismissed one alone', async () => {
    const a = new InPlaceAsk();
    const q = Q();
    await confirmed(a, q);
    a.dismiss();
    expect(await settleTo(a, q, () => t)).toBeNull();
    const other = Q({ warning: 'Other?' });
    await confirmed(a, other);
    expect(await settleTo(a, q, () => t)).toBeNull();
    expect(a.current).toBe(other);
    expect(a.busy).toBe(true);
  });

  it('moveOn moves only from the interim element or <body>; firstUsable skips a disabled one', async () => {
    const final = document.createElement('button');
    document.body.appendChild(final);
    t.focus();
    await moveOn(t, () => final);
    expect(document.activeElement).toBe(final);
    const away = document.createElement('input');
    document.body.appendChild(away);
    away.focus();
    await moveOn(t, () => final);
    expect(document.activeElement).toBe(away);
    final.disabled = true;
    expect(firstUsable(null, final, t)).toBe(t);
    final.remove();
    away.remove();
  });

  it('withdraw dismisses its own question and follows focus out of it; another question stays', async () => {
    const a = new InPlaceAsk();
    const q = Q();
    await confirmed(a, q);
    withdraw(a, Q(), () => t);
    expect(a.open).toBe(true);
    withdraw(a, q, () => t);
    expect(a.open).toBe(false);
    host.innerHTML = '';                       // the slot unmounts
    await flush();
    expect(document.activeElement).toBe(t);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/askInPlace.svelte.test.ts`
Expected: FAIL — `settleTo`, `moveOn`, `withdraw` and `firstUsable` are not exported.

- [ ] **Step 3: The helpers and the tree's question**

In `frontend/src/lib/askInPlace.svelte.ts`, replace the svelte import with:

```ts
import { getContext, setContext, tick, untrack, type Snippet } from 'svelte';
import { currentRoute } from './router.svelte';
```

After `focusAfter` add:

```ts
/** §Focus: the first target in a site's chain that counts. */
export function firstUsable(...els: (Element | null | undefined)[]): HTMLElement | null {
  for (const el of els) if (usable(el)) return el;
  return null;
}
```

At the end of the file add:

```ts
// ---- Task 3: settling, the second move, withdrawing; the course tree ----

/** R54: closes question `q` once its action settles and, after the re-render,
 *  focuses `target` — only if focus was in the question or nowhere and still
 *  is (R57). Returns what it focused. A no-op unless `q` is the busy question:
 *  a dismissed one, or another site's on a shared ask, is left alone. */
export async function settleTo(
  ask: InPlaceAsk, q: Ask, target: () => Element | null | undefined, opts?: FocusOptions,
): Promise<HTMLElement | null> {
  if (!ask.busy || ask.current !== q) return null;
  const host = ask.host;
  const free = ask.focusFree;
  ask.settle();
  await tick();
  if (!free || !focusIsFree(host)) return null;
  const t = target();
  if (!usable(t)) return null;
  t.focus(opts);
  return t;
}

/** R57's second move (R54): from the interim element a site focused to its
 *  final target, only while focus is still on the interim element or <body>. */
export async function moveOn(interim: HTMLElement, target: () => Element | null | undefined): Promise<void> {
  await tick();
  const a = document.activeElement;
  if (a && a !== document.body && a !== interim) return;
  const t = target();
  if (usable(t)) t.focus();
}

/** R49 after a confirm: the subject changed, so question `q` goes without
 *  acting, and focus that was in it follows to `target`. */
export function withdraw(ask: InPlaceAsk, q: Ask, target: () => Element | null | undefined): void {
  if (ask.current !== q) return;
  const free = ask.focusFree;
  ask.dismiss();
  if (free) void focusAfter(target);
}

export const TREE_ASK_KEY = Symbol('treeAsk');

/** The course tree's one question (R53), keyed `block-<id>`, `seq-<id>` or
 *  `item-<id>` (the three number their ids separately). The first caller —
 *  VersionEditPage, or an accordion mounted on its own — creates it and
 *  provides it to its subtree. It goes when the route moves on (R49) and with
 *  its creator. Call during component init. */
export function useTreeAsk(): InPlaceAsk {
  const shared = getContext<InPlaceAsk | undefined>(TREE_ASK_KEY);
  if (shared) return shared;
  const a = new InPlaceAsk();
  setContext(TREE_ASK_KEY, a);
  $effect(() => {
    void currentRoute.path;
    void currentRoute.search;
    untrack(() => a.dismiss());   // a no-op on the first run: nothing is open
  });
  $effect(() => () => a.dismiss());
  return a;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/askInPlace.svelte.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing SequenceAccordion tests (#3, #4)**

D42: in each site's first "the question appears" test, also assert that its `.inline-confirm` has class `end` (the row questions end under the row's actions).

In `frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts`, after the `trash` helper add:

```ts
// Polish 1 #3, #4: the tree's question, under the node that asked.
const askBtn = (t: HTMLElement, k: 'confirm' | 'cancel') => t.querySelector<HTMLButtonElement>(`.tree-ask .inline-confirm button.${k}`)!;
const itemTrash = (t: HTMLElement, name: string) => t.querySelector<HTMLButtonElement>(`button[aria-label="Delete ${name}"]`)!;
const deletes = () => fetchSpy.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === 'DELETE');
// Hold the DELETE at `path` (answered with `status`) and the admin-tree reloads after it.
function holdDeleteAndReload(path: string, status = 200) {
  const h = { del: () => {}, reload: () => {} };
  serve((url, init) => {
    if (url === path && init?.method === 'DELETE') {
      return new Promise<void>((r) => { h.del = r; }).then(() => jres(status < 400 ? {} : { detail: 'Boom' }, status));
    }
    if (url.endsWith('/admin-tree')) {
      treeFetchPaths.push(currentRoute.path);
      return new Promise<void>((r) => { h.reload = r; }).then(() => jres(structuredClone(served)));
    }
    return undefined;
  });
  return h;
}
```

Replace the three tests from `'success: navigates to the block (replace, no prompt) BEFORE the reload'` through `'a late delete after a version change neither navigates nor reloads'` with:

```ts
  it('#3: the question sits under the header; Delete sends one DELETE and navigates to the block (replace) BEFORE the reload', async () => {
    const replaceSpy = vi.spyOn(history, 'replaceState');
    const { target } = mountAccordion();
    trash(target).click();
    flushSync();
    const q = target.querySelector('.seq-card > .tree-ask .inline-confirm')!;
    expect(q.querySelector('.warning')!.textContent!.trim()).toBe('Delete sequence "Seq"? This cannot be undone.');
    expect(askBtn(target, 'confirm').textContent!.trim()).toBe('Delete');
    expect(askBtn(target, 'confirm').classList.contains('danger')).toBe(true);
    expect(document.activeElement).toBe(askBtn(target, 'cancel'));
    expect(deletes()).toHaveLength(0);
    askBtn(target, 'confirm').click();
    await settle();
    expect(deletes().map(([u]) => String(u))).toEqual(['/api/sequences/2']);
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3');
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/courses/c/edit/v/1/blocks/3');
    expect(treeFetchPaths).toEqual(['/courses/c/edit/v/1/blocks/3']);
  });

  it('#3: Cancel sends nothing and focuses the trash; leaving the focus withdraws an open question (R49)', async () => {
    const { target, props } = mountAccordion();
    trash(target).click();
    flushSync();
    askBtn(target, 'cancel').click();
    await settle();
    expect(target.querySelector('.tree-ask')).toBeNull();
    expect(document.activeElement).toBe(trash(target));
    trash(target).click();
    flushSync();
    props.routeSid = null;                       // the sequence collapses
    flushSync();
    expect(target.querySelector('.tree-ask')).toBeNull();
    expect(deletes()).toHaveLength(0);
  });

  it('delete success while a sibling sequence is expanded: the busy question goes; reload only, no navigate', async () => {
    let release!: () => void;
    serve((url, init) => (url === '/api/sequences/2' && init?.method === 'DELETE'
      ? new Promise<void>((r) => { release = r; }).then(() => jres({}))
      : undefined));
    const { target, props } = mountAccordion();
    trash(target).click();
    flushSync();
    askBtn(target, 'confirm').click();
    await settle();
    props.routeSid = '5';
    flushSync();
    expect(target.querySelector('.tree-ask')).toBeNull();
    release();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3/sequences/2');
    expect(treeFetchPaths.length).toBe(1);
  });

  it('a late delete after a version change neither navigates nor reloads', async () => {
    let release!: () => void;
    serve((url, init) => (url === '/api/sequences/2' && init?.method === 'DELETE'
      ? new Promise<void>((r) => { release = r; }).then(() => jres({}))
      : undefined));
    const { target, stillOnVid } = mountAccordion();
    trash(target).click();
    flushSync();
    askBtn(target, 'confirm').click();
    await settle();
    stillOnVid.mockReturnValue(false);
    release();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3/sequences/2');
    expect(treeFetchPaths).toEqual([]);
  });
```

Replace `'an item delete never carries the unsaved suffix (D3)'` with:

```ts
  it('an item delete never carries the unsaved suffix (D3)', async () => {
    const { target } = mountAccordion(mkSeq({ items: [item] }));
    target.querySelector<HTMLButtonElement>('button[aria-label="Edit the sequence title"]')!.click();
    await settle();
    type(titleInput(target)!, 'Dirty');
    itemTrash(target, 'Page').click();
    flushSync();
    const row = target.querySelector('#item-9-open')!.closest('li')!;
    expect(row.querySelector('.tree-ask .inline-confirm .warning')!.textContent!.trim()).toBe('Delete "Page"? This cannot be undone.');
  });
```

At the end of `describe('SequenceAccordion — item rows (T6)', …)` add:

```ts
  it('#4: busy confirm while the DELETE runs, the sequence header during the reload, then the next item', async () => {
    const h = holdDeleteAndReload('/api/items/9');
    const { target } = mountAccordion(two());
    itemTrash(target, 'Page').click();
    flushSync();
    expect(askBtn(target, 'confirm').textContent!.trim()).toBe('Delete');
    expect(askBtn(target, 'confirm').classList.contains('danger')).toBe(true);
    expect(document.activeElement).toBe(askBtn(target, 'cancel'));
    askBtn(target, 'confirm').click();
    await settle();
    expect(document.activeElement).toBe(askBtn(target, 'confirm'));
    expect(askBtn(target, 'confirm').getAttribute('aria-busy')).toBe('true');
    h.del();
    await settle();
    expect(target.querySelector('.tree-ask')).toBeNull();
    expect(document.activeElement).toBe(target.querySelector('#seq-2-header'));
    h.reload();
    await settle();
    await settle();
    expect(document.activeElement).toBe(target.querySelector('#item-10-open'));
    expect(deletes()).toHaveLength(1);
  });

  it('#4: a failed DELETE keeps the busy question through the reload, then focus goes to the trash (R54)', async () => {
    const h = holdDeleteAndReload('/api/items/9', 500);
    const { target } = mountAccordion(two());
    itemTrash(target, 'Page').click();
    flushSync();
    askBtn(target, 'confirm').click();
    await settle();
    h.del();
    await settle();
    expect(document.activeElement).toBe(askBtn(target, 'confirm'));
    expect(askBtn(target, 'confirm').getAttribute('aria-busy')).toBe('true');
    h.reload();
    await settle();
    await settle();
    expect(target.querySelector('.tree-ask')).toBeNull();
    expect(document.activeElement).toBe(itemTrash(target, 'Page'));
  });

  it('#4: Cancel and Esc send nothing and focus the trash', async () => {
    const { target } = mountAccordion(two());
    itemTrash(target, 'Page').click();
    flushSync();
    askBtn(target, 'cancel').click();
    await settle();
    expect(target.querySelector('.tree-ask')).toBeNull();
    expect(document.activeElement).toBe(itemTrash(target, 'Page'));
    itemTrash(target, 'Page').click();
    flushSync();
    askBtn(target, 'cancel').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(target.querySelector('.tree-ask')).toBeNull();
    expect(document.activeElement).toBe(itemTrash(target, 'Page'));
    expect(deletes()).toHaveLength(0);
  });

  it('D39: another item\'s trash moves the question there; the same trash again only brings it back (R53, R56)', async () => {
    const { target } = mountAccordion(two());
    itemTrash(target, 'Page').click();
    flushSync();
    itemTrash(target, 'Two').click();
    await settle();
    const row10 = target.querySelector('#item-10-open')!.closest('li')!;
    expect(target.querySelectorAll('.inline-confirm')).toHaveLength(1);
    expect(row10.querySelector('.inline-confirm')).not.toBeNull();
    expect(document.activeElement).toBe(askBtn(target, 'cancel'));
    expect(row10.contains(document.activeElement)).toBe(true);
    itemTrash(target, 'Two').focus();
    itemTrash(target, 'Two').click();
    await settle();
    expect(target.querySelectorAll('.inline-confirm')).toHaveLength(1);
    expect(document.activeElement).toBe(askBtn(target, 'cancel'));
    expect(deletes()).toHaveLength(0);
  });

  it('R57: focus moved away while the DELETE runs stays there', async () => {
    const h = holdDeleteAndReload('/api/items/9');
    const { target } = mountAccordion(two());
    const away = document.createElement('button');
    document.body.appendChild(away);
    itemTrash(target, 'Page').click();
    flushSync();
    askBtn(target, 'confirm').click();
    await settle();
    away.focus();
    h.del();
    await settle();
    h.reload();
    await settle();
    await settle();
    expect(target.querySelector('.tree-ask')).toBeNull();
    expect(document.activeElement).toBe(away);
  });
```

(`two` is the describe's existing helper; the new tests go after it.)

- [ ] **Step 6: Write the failing BlockAccordion tests (#5)**

In `frontend/src/tests/BlockAccordion.svelte.test.ts`, inside `describe('BlockAccordion — body (T5b)', …)` after `expand()` add:

```ts
  // Polish 1 #5: the tree's question, under the header.
  const treeBtn = (k: 'confirm' | 'cancel') => target.querySelector<HTMLButtonElement>(`.tree-ask .inline-confirm button.${k}`)!;
  const warning = () => target.querySelector('.block-card > .tree-ask .warning')!.textContent!.trim();
```

Replace `'delete success: navigates to the version (replace, no prompt) BEFORE the reload'` with:

```ts
  it('#5: the question sits under the header, its suffix live; Delete navigates to the version (replace) BEFORE the reload', async () => {
    const replaceSpy = vi.spyOn(history, 'replaceState');
    await expand();
    mountBlock();
    await settle();
    trash().click();
    flushSync();
    expect(warning()).toBe('Delete block "Vectors"? This cannot be undone.');
    expect(treeBtn('confirm').textContent!.trim()).toBe('Delete');
    expect(treeBtn('confirm').classList.contains('danger')).toBe(true);
    expect(document.activeElement).toBe(treeBtn('cancel'));
    // Some other draft on the page appears while it asks: the suffix follows (a getter).
    registry.register({ isDirty: true, discard: () => {} });
    flushSync();
    expect(warning()).toBe('Delete block "Vectors"? This cannot be undone. Unsaved edits may be lost.');
    treeBtn('confirm').click();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/courses/c/edit/v/1');
    expect(treeFetchPaths).toEqual(['/courses/c/edit/v/1']);
  });

  it('#5: Cancel sends nothing and focuses the trash; the route moving on withdraws the question (R49)', async () => {
    await expand();
    mountBlock();
    await settle();
    trash().click();
    flushSync();
    treeBtn('cancel').click();
    await settle();
    expect(target.querySelector('.tree-ask')).toBeNull();
    expect(document.activeElement).toBe(trash());
    trash().click();
    flushSync();
    await navigate('/courses/c/edit/v/1/blocks/3?tab=x', { force: true });   // the route moves on
    await settle();
    expect(target.querySelector('.tree-ask')).toBeNull();
    expect(fetchSpy.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
  });
```

In `'delete success while another block is expanded: reload only, no navigate'`, `'a sequence delete still reloads after the parent block collapsed (stillOnVid prop)'` and `'a late delete after an unmount neither navigates nor reloads'`, delete the `vi.spyOn(window, 'confirm').mockReturnValue(true);` line, and right after the trash click's `await settle();` add:

```ts
    treeBtn('confirm').click();
    await settle();
```

In the second of them the confirm is `[data-action="confirm-delete-sequence"]`, which `treeBtn('confirm')` finds as well.

- [ ] **Step 7: Write the failing VersionEditPage tests (#3, #5)**

In `frontend/src/tests/VersionEditPage.svelte.test.ts`, after the `makeDraft` helper (Task 2) add:

```ts
// Polish 1 #3, #4, #5: the tree's question, under the node.
const treeBtn = (k: 'confirm' | 'cancel') => target.querySelector<HTMLButtonElement>(`.tree-ask .inline-confirm button.${k}`);
```

Replace `describe('VersionEditPage — no spurious stale-id toast after a delete (T5b)', …)` with:

```ts
describe('VersionEditPage — tree deletes (T5b, Polish 1 #3, #5)', () => {
  const seq20: AdminTreeSequence = { id: 20, block_id: 10, title: 'Seq 20', slug: 's20', order: 1, items: [] };

  it('deleting the expanded block lands on the version with no "Block not found."; focus ends on "+ Add block"', async () => {
    serve((url, init) => {
      if (url === '/api/blocks/10' && init?.method === 'DELETE') { tree.blocks = []; return jres({}); }
      return undefined;
    });
    await navigate('/courses/c/edit/v/1/blocks/10', { force: true });
    await renderRouted();
    target.querySelector<HTMLButtonElement>('button[aria-label="Delete block Block 10"]')!.click();
    await settle();
    expect(target.querySelector('.block-card > .tree-ask .warning')!.textContent!.trim())
      .toBe('Delete block "Block 10"? This cannot be undone.');
    treeBtn('confirm')!.click();
    await settle();
    await settle();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    expect(target.querySelector('#block-10-header')).toBeNull();
    expect(toasts.list.map((t) => t.message)).not.toContain('Block not found.');
    expect(document.activeElement).toBe(target.querySelector('[data-action="add-block"]'));
  });

  it('#5: with another block left, focus goes to its header', async () => {
    tree.blocks = [mkBlock(10), mkBlock(11)];
    serve((url, init) => {
      if (url === '/api/blocks/10' && init?.method === 'DELETE') { tree.blocks = [mkBlock(11)]; return jres({}); }
      return undefined;
    });
    await navigate('/courses/c/edit/v/1/blocks/10', { force: true });
    await renderRouted();
    target.querySelector<HTMLButtonElement>('button[aria-label="Delete block Block 10"]')!.click();
    await settle();
    treeBtn('confirm')!.click();
    await settle();
    await settle();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    expect(document.activeElement).toBe(target.querySelector('#block-11-header'));
  });

  it('deleting the expanded sequence lands on its block with no "Sequence not found."; focus on the block header', async () => {
    tree.blocks = [mkBlock(10, { sequences: [seq20] })];
    serve((url, init) => {
      if (url === '/api/sequences/20' && init?.method === 'DELETE') { tree.blocks[0].sequences = []; return jres({}); }
      return undefined;
    });
    await navigate('/courses/c/edit/v/1/blocks/10/sequences/20', { force: true });
    await renderRouted();
    target.querySelector<HTMLButtonElement>('button[aria-label="Delete sequence Seq 20"]')!.click();
    await settle();
    treeBtn('confirm')!.click();
    await settle();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/10');
    expect(target.querySelector('#seq-20-header')).toBeNull();
    expect(toasts.list.map((t) => t.message)).not.toContain('Sequence not found.');
    expect(document.activeElement).toBe(target.querySelector('#block-10-header'));
  });

  it('a tree question goes when the route moves on (R49), and sends nothing', async () => {
    tree.blocks = [mkBlock(10, { sequences: [seq20] })];
    await navigate('/courses/c/edit/v/1/blocks/10/sequences/20', { force: true });
    await renderRouted();
    target.querySelector<HTMLButtonElement>('button[aria-label="Delete sequence Seq 20"]')!.click();
    await settle();
    expect(treeBtn('cancel')).not.toBeNull();
    target.querySelector<HTMLButtonElement>('#seq-20-header')!.click();     // collapse the sequence
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/10');
    expect(target.querySelector('.tree-ask')).toBeNull();
    expect(fetchSpy.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
  });
});
```

- [ ] **Step 8: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/SequenceAccordion.interactive.svelte.test.ts src/tests/BlockAccordion.svelte.test.ts src/tests/VersionEditPage.svelte.test.ts`
Expected: FAIL — every new or rewritten delete test (the sites still call `window.confirm`, which jsdom does not implement, and there is no `.tree-ask`). The rest pass.

- [ ] **Step 9: Write `TreeAskRow.svelte`**

Create `frontend/src/components/editor/TreeAskRow.svelte`:

```svelte
<script lang="ts">
  // Polish 1 (#3, #4, #5): the course tree's question, under the node that
  // asked. One InPlaceAsk serves the whole tree (R53); each node draws it only
  // for its own key. It goes quietly when the node leaves the focus (`live`
  // false: a route change, whose own focus applies), and when the node goes
  // (R49): then focus that was in it moves to `fallback`.
  import { untrack } from 'svelte';
  import AskSlot from '../ui/AskSlot.svelte';
  import { focusAfter, focusIsFree, type InPlaceAsk } from '../../lib/askInPlace.svelte';

  type Props = {
    ask: InPlaceAsk;
    askKey: string;
    live?: boolean;
    fallback?: () => Element | null | undefined;
  };
  let { ask, askKey, live = true, fallback }: Props = $props();

  // Kept past unmount: the teardown asks whether focus was inside it.
  let wrap: HTMLElement | null = null;
  const mine = () => ask.current?.key === askKey;

  $effect(() => {
    if (!live) untrack(() => { if (mine()) ask.dismiss(); });
  });
  $effect(() => {
    const [a, k, fb] = untrack(() => [ask, askKey, fallback] as const);
    return () => {
      if (a.current?.key !== k) return;
      const free = focusIsFree(wrap);
      a.dismiss();
      if (free && fb) void focusAfter(fb);
    };
  });
</script>

{#if mine()}
  <div class="tree-ask" {@attach (el) => { wrap = el; }}><AskSlot {ask} /></div>
{/if}

<style>
  /* The cards clip (overflow: hidden): the padding keeps the focus ring inside. */
  .tree-ask { padding: 6px 12px; }
</style>
```

- [ ] **Step 10: The trash `data-action`s**

In `frontend/src/components/editor/AccordionHeader.svelte`, the trash becomes:

```svelte
      {#if isFocus && canStructure}
        <IconButton
          size="sm"
          glyph="trash"
          danger
          title={deleteBlockedReason ?? `Delete this ${level}`}
          aria-label={`Delete ${level} ${ariaName}`}
          data-action={level === 'block' ? 'delete-block' : 'delete-sequence'}
          disabled={busy || deleteBlockedReason !== null}
          onclick={onDelete}
        />
      {/if}
```

In `frontend/src/components/editor/ItemRow.svelte`, the trash becomes:

```svelte
      <IconButton size="sm" glyph="trash" danger title="Delete" aria-label={`Delete ${ariaName}`} data-action="delete-item" disabled={busy} onclick={onDelete} />
```

- [ ] **Step 11: SequenceAccordion — #3 and #4**

In `frontend/src/components/editor/SequenceAccordion.svelte`:

Add to the imports:

```ts
  import TreeAskRow from './TreeAskRow.svelte';
  import { useTreeAsk, settleTo, moveOn, withdraw, firstUsable, focusAfter, type Ask } from '../../lib/askInPlace.svelte';
```

After `const panelId = …` add:

```ts
  // Polish 1 #3, #4 (R53): the tree's one question, keyed by node.
  const treeAsk = useTreeAsk();
  const seqKey = $derived(`seq-${String(seq.id)}`);
  let cardEl = $state<HTMLDivElement>();
  const seqTrash = () => cardEl?.querySelector<HTMLElement>('[data-action="delete-sequence"]');
  const itemTrash = (id: number) =>
    document.getElementById(`item-${id}-open`)?.closest('li')?.querySelector<HTMLElement>('[data-action="delete-item"]');
```

Replace `deleteSeq()` with:

```ts
  async function deleteSeq() {
    if (creating || !canStructure || busy || parentBusy || seq.items.length > 0) return;
    const savedVid = vid;
    const check = stillOnVid;
    const savedBid = block.id;
    const savedSid = seq.id;
    const savedSlug = courseSlug;
    const title = seq.title;
    const q: Ask = {
      // A getter: the suffix follows the page while it asks.
      warning: () => `Delete sequence "${title}"? This cannot be undone.${unsavedSuffix(dirty.isAnyDirty())}`,
      confirmLabel: 'Delete', tone: 'danger', layout: 'row', align: 'end', confirmDataAction: 'confirm-delete-sequence', key: seqKey,
    };
    const a = await treeAsk.ask(q);
    if (a === 'cancel') { void focusAfter(seqTrash); return; }
    if (a !== 'confirm') return;
    // R49: the same sequence, still deletable, at the focus, on the same version.
    if (!alive || !check(savedVid) || seq.id !== savedSid || seq.title !== title || mode !== 'open-focus'
        || creating || !canStructure || busy || parentBusy || seq.items.length > 0) {
      withdraw(treeAsk, q, () => firstUsable(seqTrash(), document.getElementById(headerId)));
      return;
    }
    busy = true;
    try {
      await api.delete(`/api/sequences/${savedSid}`);
      // R54: the row goes with the reload, so the question settles now and
      // focus moves to the block header (never disabled) before the navigate.
      await settleTo(treeAsk, q, () => document.getElementById(`block-${savedBid}-header`));
      // Navigate FIRST (no spurious "Sequence not found."), only while the
      // live route still names this sequence; `force` — already confirmed;
      // `replace` — keep the deleted URL out of history. Then reload, gated on
      // the parent's guard so it still runs after the block collapsed.
      if (alive && expanded && check(savedVid)) {
        void navigate(`/courses/${savedSlug}/edit/v/${savedVid}/blocks/${savedBid}`, { replace: true, force: true });
      }
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
      // A failure keeps the row: the question stayed busy through the reload
      // above and settles now, back on the trash (R54). After success: nothing.
      void settleTo(treeAsk, q, seqTrash);
    }
  }
```

Replace `deleteItem()` with:

```ts
  async function deleteItem(itemId: number, itemTitle: string) {
    if (busy || !canStructure) return;
    const savedVid = vid;
    const check = stillOnVid;
    const q: Ask = {
      warning: `Delete "${itemTitle}"? This cannot be undone.`,   // D3: never the unsaved suffix
      confirmLabel: 'Delete', tone: 'danger', layout: 'row', align: 'end', confirmDataAction: 'confirm-delete-item', key: `item-${itemId}`,
    };
    const a = await treeAsk.ask(q);
    if (a === 'cancel') { void focusAfter(() => itemTrash(itemId)); return; }
    if (a !== 'confirm') return;
    // R49: re-run the gate and find the item again in the live list.
    const ids = seq.items.map((i) => i.id);
    const at = ids.indexOf(itemId);
    if (!alive || !check(savedVid) || busy || !canStructure || at < 0 || seq.items[at].title !== itemTitle) {
      withdraw(treeAsk, q, () => firstUsable(itemTrash(itemId), document.getElementById(headerId)));
      return;
    }
    // R54: where focus lands once `busy` clears, resolved by id before the
    // reload: the next item's ✎, else the previous, else "+ Add item".
    const nextId = ids[at + 1] ?? ids[at - 1];
    const final = () => firstUsable(nextId !== undefined ? document.getElementById(`item-${nextId}-open`) : null, addLineEl);
    let interim: HTMLElement | null = null;
    busy = true;
    try {
      await api.delete(`/api/items/${itemId}`);
      // The row goes with the reload: settle now, and hold focus on the
      // sequence header (never disabled) meanwhile.
      interim = await settleTo(treeAsk, q, () => document.getElementById(headerId), { preventScroll: true });
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
      pushToast('Item deleted', 'success');
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
      if (interim) { if (alive) void moveOn(interim, final); }
      // A failure: the question stayed busy through the reload; back to the trash.
      else void settleTo(treeAsk, q, () => itemTrash(itemId));
    }
  }
```

In the markup, the card and its rows:

```svelte
<div class="seq-card" bind:this={cardEl} class:at-focus={mode === 'row-focus'} class:focus={mode === 'open-focus'}>
  <AccordionHeader
    …unchanged…
  />
  <!-- #3: the delete question, under the header. -->
  <TreeAskRow ask={treeAsk} askKey={seqKey} live={mode === 'open-focus'}
              fallback={() => document.getElementById(`block-${block.id}-header`)} />
```

and each item's `<li>`:

```svelte
            <li>
              <ItemRow
                …unchanged…
              />
              <!-- #4: under its row; it goes with the row (R49). -->
              <TreeAskRow ask={treeAsk} askKey={`item-${item.id}`} fallback={() => document.getElementById(headerId)} />
            </li>
```

- [ ] **Step 12: BlockAccordion — #5**

In `frontend/src/components/editor/BlockAccordion.svelte`:

Replace `import { unsavedSuffix } from '../../lib/editorReasons';` with:

```ts
  import { unsavedSuffix } from '../../lib/editorReasons';
  import TreeAskRow from './TreeAskRow.svelte';
  import { useTreeAsk, settleTo, moveOn, withdraw, firstUsable, focusAfter, type Ask } from '../../lib/askInPlace.svelte';
```

After `const panelId = …` add:

```ts
  // Polish 1 #5 (R53): the tree's one question, keyed by node. Mounted on its
  // own (tests), the block makes it and shares it with its sequences.
  const treeAsk = useTreeAsk();
  const askKey = $derived(`block-${String(block.id)}`);
  let cardEl = $state<HTMLDivElement>();
  const trashEl = () => cardEl?.querySelector<HTMLElement>('[data-action="delete-block"]');
  const courseLink = () => document.querySelector('[data-action="course-link"]');
```

Replace `deleteBlock()` with:

```ts
  async function deleteBlock() {
    if (creating || !canStructure || busy || createBusy || parentBusy || block.sequences.length > 0) return;
    const savedVid = vid;
    const savedSlug = courseSlug;
    const savedId = block.id;
    const title = block.title;
    const q: Ask = {
      // A getter: the suffix follows the page while it asks.
      warning: () => `Delete block "${title}"? This cannot be undone.${unsavedSuffix(dirty.isAnyDirty())}`,
      confirmLabel: 'Delete', tone: 'danger', layout: 'row', align: 'end', confirmDataAction: 'confirm-delete-block', key: askKey,
    };
    const a = await treeAsk.ask(q);
    if (a === 'cancel') { void focusAfter(trashEl); return; }
    if (a !== 'confirm') return;
    // R49: the same block, still deletable, at the focus, on the same version.
    if (!stillOnVid(savedVid) || block.id !== savedId || block.title !== title || mode !== 'open-focus'
        || creating || !canStructure || busy || createBusy || parentBusy || block.sequences.length > 0) {
      withdraw(treeAsk, q, () => firstUsable(trashEl(), document.getElementById(headerId)));
      return;
    }
    // R54: where focus goes on success, resolved by id before the reload: the
    // next block's header, else the previous (block headers are never
    // disabled); with no block left, the course link meanwhile and
    // "+ Add block" once the reload lands. The block itself unmounts with that
    // reload, so the last move finds its target by data-action.
    const ids = currentEditorVersion.value?.blocks.map((b) => b.id) ?? [];
    const at = ids.indexOf(savedId);
    const nextId = at < 0 ? undefined : (ids[at + 1] ?? ids[at - 1]);
    busy = true;
    try {
      await api.delete(`/api/blocks/${savedId}`);
      const interim = nextId !== undefined
        ? await settleTo(treeAsk, q, () => document.getElementById(`block-${nextId}-header`))
        : await settleTo(treeAsk, q, courseLink, { preventScroll: true });
      if (stillOnVid(savedVid)) {
        // Navigate FIRST so the route no longer names the deleted block when
        // the new tree lands (otherwise the page's validation effect shows a
        // spurious "Block not found."). Only when the live route still names
        // it (`expanded`): if the user has meanwhile expanded another block,
        // a forced navigate would collapse it and drop its drafts unprompted.
        // `force` — the user already confirmed; `replace` — keep the deleted
        // URL out of history.
        if (expanded) void navigate(`/courses/${savedSlug}/edit/v/${savedVid}`, { replace: true, force: true });
        await loadAdminTree(savedVid, { force: true });
        if (interim && nextId === undefined) await moveOn(interim, () => document.querySelector('[data-action="add-block"]'));
      }
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      if (stillOnVid(savedVid)) {
        await loadAdminTree(savedVid, { force: true });
      }
    } finally {
      busy = false;
      // A failure keeps the row: the question stayed busy through the reload
      // above and settles now, back on the trash (R54). After success: nothing.
      void settleTo(treeAsk, q, trashEl);
    }
  }
```

In the markup:

```svelte
<div class="block-card" bind:this={cardEl} class:at-focus={mode === 'row-focus'} class:focus={mode === 'open-focus'} class:parent={mode === 'open-parent'}>
  <AccordionHeader
    …unchanged…
  />
  <!-- #5: the delete question, under the header. -->
  <TreeAskRow ask={treeAsk} {askKey} live={mode === 'open-focus'} fallback={courseLink} />
```

- [ ] **Step 13: VersionEditPage — the tree's question and two targets**

In `frontend/src/pages/editor/VersionEditPage.svelte`:

Extend the askInPlace import (Task 2):

```ts
  import { PageAsk, PAGE_ASK_KEY, focusIsFree, usable, useTreeAsk, type GuardAsk } from '../../lib/askInPlace.svelte';
```

After `const rowAsking = …` (Task 2) add:

```ts
  // R53: one question for the whole course tree (#3, #4, #5), provided to
  // every accordion; it goes when the route moves on and with the page.
  useTreeAsk();
```

The `<h1>` link gains `data-action="course-link"`:

```svelte
        <h1><a href={`/courses/${courseSlug}/edit`} title="Back to versions" data-action="course-link" bind:this={courseLinkEl} onclick={onCourseLink}>{tree.course.name}</a>{#if v.label}<span class="vlabel">{` · ${v.label}`}</span>{/if}</h1>
```

and "+ Add block" gains `data-action="add-block"`:

```svelte
            <button bind:this={addLineEl} type="button" class="add-line" data-action="add-block" disabled={busy} onclick={() => void openAdd()}>+ Add block</button>
```

- [ ] **Step 14: Run them to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/askInPlace.svelte.test.ts src/tests/SequenceAccordion.interactive.svelte.test.ts src/tests/BlockAccordion.svelte.test.ts src/tests/VersionEditPage.svelte.test.ts src/tests/accordionHeader.svelte.test.ts src/tests/ItemRow.svelte.test.ts`
Expected: PASS.

- [ ] **Step 15: Write the gate rows**

The spec's Task 3 pins (`:3890` no `.row` / `.danger` rules, `:3936` no side borders outside `.seq-card`) hold unchanged: the confirm rows live in `TreeAskRow`, whose rules carry their own hash. At the end of section (am) add:

```zsh
# Task 3 — the course tree's question (#3, #4, #5).
own tree-ask TreeAskRow.svelte
uniq1 tree-ask
if [[ -n $REPLY ]]; then
  N=TreeAskRow; H=$REPLY
  # The cards clip (overflow: hidden): the padding keeps the focus ring inside, with no border of its own.
  d '\.tree-ask' '' 'padding:6px 12px'
  none "TreeAskRow draws no border" "\.tree-ask\.${H}[^{]*\{[^}]*border"
  sweep $N $H
fi
if grep -qF "data-action={level === 'block' ? 'delete-block' : 'delete-sequence'}" src/components/editor/AccordionHeader.svelte \
   && grep -qF 'data-action="delete-item"' src/components/editor/ItemRow.svelte \
   && grep -qF 'data-action="course-link"' src/pages/editor/VersionEditPage.svelte \
   && grep -qF 'data-action="add-block"' src/pages/editor/VersionEditPage.svelte; then
  echo "PASS  the tree's focus targets carry their data-action (focus by identity)"
else echo "FAIL  the tree's focus targets carry their data-action (focus by identity)"; fail=1; fi
emoji_scan "the Polish-1 tree files" src/components/editor/TreeAskRow.svelte \
  src/components/editor/BlockAccordion.svelte src/components/editor/SequenceAccordion.svelte
colour_scan polish1-tree src/components/editor/TreeAskRow.svelte \
  src/components/editor/BlockAccordion.svelte src/components/editor/SequenceAccordion.svelte
```

Set `EXPECTED_CHECKS=2172` (`:90`).

Run the gate (Global Constraints). Expected: `ALL PASS (2172 checks)`. To see the `.tree-ask` rows fail first, run it with TreeAskRow's `<style>` block stashed: `own`, `uniq1` and `d` fail.

- [ ] **Step 16: Full checks**

Run vitest, svelte-check and the gate (Global Constraints). Expected: vitest green; svelte-check 0 errors, 13 warnings; gate `ALL PASS (2172 checks)`.

- [ ] **Step 17: Screenshots, the user's OK, review lanes, commit**

Screenshots at 1280 wide, dev data, every DELETE mocked (held, so the busy state shows):
- the block question under an open block's header; its Cancel Tab-focused;
- the sequence question under an open sequence's header;
- an item question under its row, idle and busy;
- the question moved to another item (D39).

Then the per-task loop: the user's OK, both lanes until clean, commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/lib/askInPlace.svelte.ts frontend/src/components/editor/TreeAskRow.svelte \
  frontend/src/components/editor/BlockAccordion.svelte frontend/src/components/editor/SequenceAccordion.svelte \
  frontend/src/components/editor/AccordionHeader.svelte frontend/src/components/editor/ItemRow.svelte \
  frontend/src/pages/editor/VersionEditPage.svelte frontend/scripts/visual-refresh-gate.sh \
  frontend/src/tests/askInPlace.svelte.test.ts frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts \
  frontend/src/tests/BlockAccordion.svelte.test.ts frontend/src/tests/VersionEditPage.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(polish1): course tree deletes ask in place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 4: Versions (#16, #17, #18, #20, #21)

**Files:**
- Modify: `frontend/src/pages/editor/VersionsPage.svelte` (`escCancels` `:90-99`, `transition` `:126-147`, `deleteVersion` `:149-161`; markup `:205-263`, `:269-271`; style)
- Modify: `frontend/src/pages/editor/VersionEditPage.svelte` (`transition` `:419-450`, `deleteVersion` `:460-476`, the state bar `:576-595`)
- Modify: `frontend/scripts/visual-refresh-gate.sh` (`:3841-3846`, section (am), `EXPECTED_CHECKS`)
- Test: `frontend/src/tests/VersionsPage.slots.svelte.test.ts` (`:261-283`, `:340-405`), `frontend/src/tests/VersionEditPage.svelte.test.ts` (`:452-569`)

**Interfaces:**
- Consumes (Tasks 2, 3): `InPlaceAsk`, `Ask`, `DISCARD_ASK`, `AskSlot`, `focusAfter`, `firstUsable`, `settleTo`, `moveOn`, `withdraw`; VersionEditPage's `courseLinkEl` (Task 2) and its askInPlace import line (Task 3).
- Produces: VersionsPage ids `v-<id>-title`, `v-<id>-toggle`, `v-<id>-delete`, `li.ask-row`, the `<h1 tabindex="-1">`; confirms `confirm-disable-version`, `confirm-enable-version`, `confirm-delete-version`; VersionEditPage bar `data-action`s `version-publish|archive|revert|disable|enable|delete` and confirms `confirm-<action>`, `confirm-delete-version`.

- [ ] **Step 1: Write the failing VersionsPage tests**

D42: in each site's first "the question appears" test, also assert that its `.inline-confirm` has class `end` (the row questions end under the row's actions).

In `frontend/src/tests/VersionsPage.slots.svelte.test.ts`:

Replace `'Escape with typed input asks first; "no" keeps the form and the text (final review)'` with:

```ts
  it('#16: Escape with typed input asks in place of Cancel/Create; Cancel keeps the text and returns to the field; Discard closes', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    addLine()!.click();
    await settle();
    const info = target.querySelector<HTMLTextAreaElement>('form.create textarea')!;
    info.value = 'A long paragraph';
    info.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    info.focus();
    const esc = () => info.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const submit = () => target.querySelector<HTMLElement>('form.create .submit')!;
    esc();
    await settle();
    expect(submit().querySelector('.inline-confirm .warning')!.textContent!.trim()).toBe('Discard unsaved changes?');
    expect([...submit().querySelectorAll('button')].map((b) => b.textContent!.trim())).toEqual(['Discard', 'Cancel']);
    expect(submit().querySelector('button.confirm')!.classList.contains('danger')).toBe(true);
    expect(document.activeElement).toBe(submit().querySelector('button.cancel'));
    submit().querySelector<HTMLButtonElement>('button.cancel')!.click();
    await settle();
    expect(target.querySelector<HTMLTextAreaElement>('form.create textarea')!.value).toBe('A long paragraph');
    expect(document.activeElement).toBe(info);
    esc();
    await settle();
    submit().querySelector<HTMLButtonElement>('button.confirm')!.click();
    await settle();
    expect(target.querySelector('form.create')).toBeNull();
    expect(document.activeElement).toBe(addLine());
  });
```

In `describe('VersionsPage — row actions through the slots', …)`:

Delete `vi.stubGlobal('confirm', vi.fn(() => true));` from the `beforeEach` and the `afterEach(() => { vi.unstubAllGlobals(); });` line. After `const loadMock = …` add:

```ts
  // Polish 1 #17, #18: the row's question, under it.
  const askRow = () => target.querySelector<HTMLElement>('li.ask-row');
  const rowBtn = (k: 'confirm' | 'cancel') => target.querySelector<HTMLButtonElement>(`li.ask-row .inline-confirm button.${k}`)!;
  // A reload the test releases, landing `next` as the new list.
  function holdLoad(next: Version[]) {
    let release!: () => void;
    loadMock.mockImplementationOnce(() => new Promise<undefined>((r) => {
      release = () => { versionsPageState.versions = next; r(undefined); };
    }));
    return () => release();
  }
```

In `'Disable POSTs /disable then reloads'`, `'Enable POSTs /enable'` and `'Delete sends DELETE /api/versions/{id} and no transition'`, after the slot's `.click();` add:

```ts
    await settle();
    rowBtn('confirm').click();
```

In `'while a request is in flight every slot and "+ Add version" are disabled'`, after `byLabel('Disable v7')!.click();` add the same two lines.

Replace `'a cancelled confirm sends nothing'` with:

```ts
  it('#17, #18: the question sits under its row; Cancel sends nothing and returns to the trigger, one question at a time', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    byLabel('Disable v7')!.click();
    await settle();
    expect(askRow()!.previousElementSibling!.classList.contains('vrow')).toBe(true);
    expect(askRow()!.querySelector('.warning')!.textContent!.trim()).toBe('Disable version 7?');
    expect(rowBtn('confirm').textContent!.trim()).toBe('Disable');
    expect(rowBtn('confirm').classList.contains('primary')).toBe(true);
    expect(document.activeElement).toBe(rowBtn('cancel'));
    rowBtn('cancel').click();
    await settle();
    expect(askRow()).toBeNull();
    expect(document.activeElement).toBe(byLabel('Disable v7'));
    byLabel('Delete v7')!.click();
    await settle();
    expect(askRow()!.querySelector('.warning')!.textContent!.trim()).toBe('Delete draft version 7? This cannot be undone.');
    expect(rowBtn('confirm').textContent!.trim()).toBe('Delete');
    expect(rowBtn('confirm').classList.contains('danger')).toBe(true);
    rowBtn('cancel').click();
    await settle();
    expect(document.activeElement).toBe(byLabel('Delete v7'));
    expect(postMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('D39: another row\'s action moves the question there; the same row again only brings it back', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 }), mkVersion({ id: 8 })];
    await render();
    byLabel('Disable v7')!.click();
    await settle();
    byLabel('Delete v8')!.click();
    await settle();
    expect(target.querySelectorAll('li.ask-row')).toHaveLength(1);
    expect(askRow()!.previousElementSibling!.querySelector('[aria-label="Open v8"]')).not.toBeNull();
    expect(document.activeElement).toBe(rowBtn('cancel'));
    byLabel('Disable v8')!.click();
    await settle();
    expect(target.querySelectorAll('li.ask-row')).toHaveLength(1);
    expect(askRow()!.querySelector('.warning')!.textContent!.trim()).toBe('Delete draft version 8? This cannot be undone.');
    expect(document.activeElement).toBe(rowBtn('cancel'));
  });

  it('R48: an open duplicate form under the row freezes while its row asks', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    byLabel('Duplicate v7')!.click();
    await settle();
    byLabel('Disable v7')!.click();
    await settle();
    const dup = target.querySelector('li.dup-row')!;
    expect(askRow()!.nextElementSibling).toBe(dup);
    expect(dup.hasAttribute('inert')).toBe(true);
    rowBtn('cancel').click();
    await settle();
    expect(dup.hasAttribute('inert')).toBe(false);
  });

  it('#17: while the list reloads focus waits on the <h1>, then lands on the swapped button', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    const release = holdLoad([mkVersion({ id: 7, is_disabled: true })]);
    byLabel('Disable v7')!.click();
    await settle();
    rowBtn('confirm').click();
    await settle();
    expect(askRow()).toBeNull();
    expect(document.activeElement).toBe(target.querySelector('h1'));
    release();
    await settle();
    await settle();
    expect(document.activeElement).toBe(byLabel('Enable v7'));
  });

  it('#18: after a delete focus lands on the next row\'s title; after a failure, on the trash', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 }), mkVersion({ id: 8 })];
    await render();
    const release = holdLoad([mkVersion({ id: 8 })]);
    byLabel('Delete v7')!.click();
    await settle();
    rowBtn('confirm').click();
    await settle();
    expect(document.activeElement).toBe(target.querySelector('h1'));
    release();
    await settle();
    await settle();
    expect(document.activeElement).toBe(target.querySelector('#v-8-title'));
    deleteMock.mockRejectedValueOnce(new Error('boom'));
    byLabel('Delete v8')!.click();
    await settle();
    rowBtn('confirm').click();
    await settle();
    await settle();
    expect(askRow()).toBeNull();
    expect(document.activeElement).toBe(byLabel('Delete v8'));
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/VersionsPage.slots.svelte.test.ts src/tests/VersionsPage.duplicate.svelte.test.ts`
Expected: FAIL — the row-action tests and #16 (the page still calls `confirm()`, which jsdom does not implement; no `li.ask-row`). The duplicate suite passes.

- [ ] **Step 3: VersionsPage — #16, #17, #18**

In `frontend/src/pages/editor/VersionsPage.svelte`:

Replace the svelte import and the `DISCARD_PROMPT` import:

```ts
  import { onDestroy, tick, untrack } from 'svelte';
```

```ts
  import AskSlot from '../../components/ui/AskSlot.svelte';
  import { InPlaceAsk, DISCARD_ASK, focusAfter, firstUsable, settleTo, moveOn, withdraw, type Ask } from '../../lib/askInPlace.svelte';
```

After `let busy = $state(false);` add:

```ts
  // Polish 1: the create form's question (#16) in place of its Cancel/Create,
  // and one question for the list (#17, #18) under the row that asked, keyed
  // by version id (R53).
  const createAsk = new InPlaceAsk();
  const rowAsk = new InPlaceAsk();
  let h1El = $state<HTMLHeadingElement>();
  const toggleBtn = (id: number) => document.getElementById(`v-${id}-toggle`);
  const trashBtn = (id: number) => document.getElementById(`v-${id}-delete`);

  // R49: a row question goes with its row — a reload (the Skeleton takes the
  // list) or another course. Focus that was in it waits on the <h1>.
  $effect(() => {
    const k = rowAsk.current?.key;
    if (k === undefined) return;
    if (loading || !versions.some((x) => x.id === k)) {
      untrack(() => {
        const free = rowAsk.focusFree;
        rowAsk.dismiss();
        if (free) void focusAfter(() => h1El);
      });
    }
  });
```

Replace `onDestroy(() => resetVersionsPageState());` with:

```ts
  onDestroy(() => { createAsk.dismiss(); rowAsk.dismiss(); resetVersionsPageState(); });
```

Replace `escCancels` with:

```ts
  // Escape in a field cancels, as the editor's add rows do — but a stray
  // Escape must not silently drop typed input (final review): then it asks,
  // in place of Cancel/Create (#16). Cancel returns to the field.
  const createDirty = () => newLabel !== '' || info_md !== '' || max_quiz_attempts !== 3;
  async function escCancels(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.isComposing || busy) return;
    e.preventDefault();
    if (!createDirty()) { void cancelCreate(); return; }
    const field = e.currentTarget as HTMLElement;
    const a = await createAsk.ask(DISCARD_ASK);
    if (a === 'cancel') { void focusAfter(() => field); return; }
    if (a !== 'confirm') return;
    createAsk.settle();   // a close: nothing to wait for (R54)
    void cancelCreate();
  }
```

In `createVersion()`, the first line becomes:

```ts
    if (!course || !newLabel.trim() || createAsk.open) return; // the label is mandatory; R48
```

Replace `transition()` and `deleteVersion()` with:

```ts
  async function transition(v: Version, action: 'disable' | 'enable') {
    if (busy) return;
    // Spec §8: confirm → POST → refetch / toast. The question asks under the row (#17).
    const verb = action === 'disable' ? 'Disable' : 'Enable';
    const id = v.id;
    const q: Ask = {
      warning: `${verb} version ${id}?`, confirmLabel: verb, tone: 'primary', layout: 'row', align: 'end',
      confirmDataAction: `confirm-${action}-version`, key: id,
    };
    const a = await rowAsk.ask(q);
    if (a === 'cancel') { void focusAfter(() => toggleBtn(id)); return; }
    if (a !== 'confirm') return;
    // R49: the row is still there, in the state the question named.
    const live = versions.find((x) => x.id === id);
    if (busy || !live || live.is_disabled !== (action === 'enable')) {
      withdraw(rowAsk, q, () => firstUsable(toggleBtn(id), h1El));
      return;
    }
    // load() pins courseSlug internally, so a prop-change mid-await re-loads
    // the original course's list, not the newly-routed-in slug.
    let interim: HTMLElement | null = null;
    busy = true;
    try {
      await api.post(`/api/versions/${id}/${action}`);
      // R54: the reload shows a Skeleton for the whole list, so the question
      // settles now and focus waits on the page's <h1>.
      interim = await settleTo(rowAsk, q, () => h1El, { preventScroll: true });
      await load();
      // Close a stale duplicate form on this row after any transition. The row
      // just changed state; a concurrent disable may have hidden the form via
      // the render guard, and a later enable must not spuriously re-open it.
      if (duplicatingId === id) duplicatingId = null;
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : `Could not ${action}`;
      pushToast(msg, 'error');
    } finally {
      busy = false;
      // The row's toggle, found by version id once `busy` clears: after success
      // the swapped button in the same slot, after a failure the trigger.
      if (interim) void moveOn(interim, () => toggleBtn(id));
      else void settleTo(rowAsk, q, () => toggleBtn(id));
    }
  }

  async function deleteVersion(v: Version) {
    if (busy || deleteVersionReason(v) !== null) return;
    const id = v.id;
    const q: Ask = {
      warning: `Delete draft version ${id}? This cannot be undone.`, confirmLabel: 'Delete', tone: 'danger', layout: 'row', align: 'end',
      confirmDataAction: 'confirm-delete-version', key: id,
    };
    const a = await rowAsk.ask(q);
    if (a === 'cancel') { void focusAfter(() => trashBtn(id)); return; }
    if (a !== 'confirm') return;
    // R49: the row is still there and still deletable.
    const live = versions.find((x) => x.id === id);
    if (busy || !live || deleteVersionReason(live) !== null) {
      withdraw(rowAsk, q, () => firstUsable(trashBtn(id), h1El));
      return;
    }
    // R54: where focus lands once `busy` clears, resolved by version id before
    // the reload: the next row's title, else the previous, else "+ Add version".
    const ids = versions.map((x) => x.id);
    const at = ids.indexOf(id);
    const nextId = ids[at + 1] ?? ids[at - 1];
    const final = () => firstUsable(nextId !== undefined ? document.getElementById(`v-${nextId}-title`) : null, addLineEl);
    let interim: HTMLElement | null = null;
    busy = true;
    try {
      await api.delete(`/api/versions/${id}`);
      interim = await settleTo(rowAsk, q, () => h1El, { preventScroll: true });
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : 'Could not delete';
      pushToast(msg, 'error');
    } finally {
      busy = false;
      if (interim) void moveOn(interim, final);
      else void settleTo(rowAsk, q, () => trashBtn(id));
    }
  }
```

In the markup, the `<h1>` becomes a focus target:

```svelte
      <h1 bind:this={h1El} tabindex="-1">{course.name}</h1>
```

the row title gets an id:

```svelte
            <button type="button" class="vtitle" class:off={v.is_disabled} disabled={busy} id={`v-${v.id}-title`}
              aria-label={`${vtitle} (v${v.id})`}
              onclick={() => navigate(`/courses/${courseSlug}/edit/v/${v.id}`)}>{vtitle}</button>
```

the toggle and the trash get ids and void their promises:

```svelte
              {#if v.is_disabled}
                <IconButton size="sm" glyph="enable" title="Enable" aria-label="Enable v{v.id}" id={`v-${v.id}-toggle`} disabled={busy}
                  onclick={() => void transition(v, 'enable')} />
              {:else}
                <IconButton size="sm" glyph="disable" title="Disable" aria-label="Disable v{v.id}" id={`v-${v.id}-toggle`} disabled={busy}
                  onclick={() => void transition(v, 'disable')} />
              {/if}
              <IconButton size="sm" glyph="trash" danger title={delReason ?? 'Delete'} aria-label="Delete v{v.id}" id={`v-${v.id}-delete`}
                disabled={busy || delReason !== null} onclick={() => void deleteVersion(v)} />
```

after `</li>` of `li.vrow`, and on `li.dup-row`:

```svelte
          {#if rowAsk.current?.key === v.id}
            <!-- #17, #18: the row's question, under it (R53: one for the list). -->
            <li class="ask-row"><AskSlot ask={rowAsk} /></li>
          {/if}
          {#if !v.is_disabled && duplicatingId === v.id}
            <!-- R48: frozen while its row asks. -->
            <li class="dup-row" {@attach (el) => { el.toggleAttribute('inert', rowAsk.current?.key === v.id); }}>
```

the three fields' `onkeydown={escCancels}` become `onkeydown={(e) => void escCancels(e)}`, and `div.submit`:

```svelte
        <div class="submit">
          {#if createAsk.open}
            <!-- #16: in place of Cancel / Create. -->
            <AskSlot ask={createAsk} />
          {:else}
            <Button variant="ghost" disabled={busy} onclick={() => void cancelCreate()}>Cancel</Button>
            <Button type="submit" disabled={busy || !newLabel.trim()} loading={busy}>Create</Button>
          {/if}
        </div>
```

In `<style>`, after the `.dup-row` rule add:

```css
  /* #17, #18: the row's question, boxed as the rows and the duplicate form. */
  .ask-row {
    padding: 9px 12px 9px 14px;
    background: var(--focus-0);
    border: 1px solid var(--focus-line);
    border-radius: var(--radius);
  }
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/VersionsPage.slots.svelte.test.ts src/tests/VersionsPage.duplicate.svelte.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing VersionEditPage tests (#20, #21)**

In `frontend/src/tests/VersionEditPage.svelte.test.ts`, inside `describe('VersionEditPage — state bar (T4)', …)` after `labels` add:

```ts
  // Polish 1 #20, #21: the question in place of the whole bar.
  const barBtn = (k: 'confirm' | 'cancel') => target.querySelector<HTMLButtonElement>(`.state-actions .inline-confirm button.${k}`)!;
  const barWarning = () => target.querySelector('.state-actions .inline-confirm .warning')!.textContent!.trim();
  const trigger = (action: string) => target.querySelector<HTMLButtonElement>(`.state-actions [data-action="version-${action}"]`);
```

Replace the tests from `'a dirty field does not block Publish; the confirm warns'` through `'delete-version replaces the history entry, so Back skips the deleted version'` with:

```ts
  it('#20: a dirty field does not block Publish; the question replaces the bar and warns', async () => {
    await render();
    await makeDirty();
    trigger('publish')!.click();
    await settle();
    expect(barWarning()).toBe('Publish version 1? Students will see it. Unsaved edits may be lost.');
    expect(barBtn('confirm').textContent!.trim()).toBe('Publish');
    expect(barBtn('confirm').classList.contains('primary')).toBe(true);
    expect(trigger('publish')).toBeNull();
    expect(trigger('delete')).toBeNull();
    expect(document.activeElement).toBe(barBtn('cancel'));
    barBtn('confirm').click();
    await settle();
    expect(posts()).toContain('/api/versions/1/publish');
  });

  it('#20: a publish refreshes the page to the new state; focus goes to the first button of the new bar', async () => {
    await render();
    tree.version = mkVersion({ state: 'published' }); // the server's state after the POST
    trigger('publish')!.click();
    await settle();
    barBtn('confirm').click();
    await settle();
    await settle();
    expect(target.querySelector('.editor-heading .vbadge')!.textContent).toBe('published');
    expect(target.querySelector('.state-actions .inline-confirm')).toBeNull();
    expect(document.activeElement).toBe(trigger('archive'));
  });

  it('#20: a failed publish returns focus to the trigger', async () => {
    serve((url, init) => (url === '/api/versions/1/publish' && init?.method === 'POST' ? jres({ detail: 'Conflict' }, 409) : undefined));
    await render();
    trigger('publish')!.click();
    await settle();
    barBtn('confirm').click();
    await settle();
    await settle();
    expect(target.querySelector('.state-actions .inline-confirm')).toBeNull();
    expect(document.activeElement).toBe(trigger('publish'));
  });

  it('archive and disable warn when dirty; revert never does — one question at a time, Cancel back to its trigger', async () => {
    tree.version = mkVersion({ state: 'published' });
    await render();
    hoisted.registry!.register({ isDirty: true });
    const ask = async (action: string, text: string, verb: string) => {
      trigger(action)!.click();
      await settle();
      expect(barWarning()).toBe(text);
      expect(barBtn('confirm').textContent!.trim()).toBe(verb);
      barBtn('cancel').click();
      await settle();
      expect(document.activeElement).toBe(trigger(action));
    };
    await ask('archive', 'Archive version 1? Unsaved edits may be lost.', 'Archive');
    await ask('disable', 'Disable version 1? Unsaved edits may be lost.', 'Disable');
    await ask('revert', 'Revert version 1 to created?', 'Revert');
    expect(posts()).toEqual([]);
  });

  it('enable never carries the suffix', async () => {
    tree.version = mkVersion({ is_disabled: true });
    await render();
    hoisted.registry!.register({ isDirty: true }); // dirty, so a suffix would show
    trigger('enable')!.click();
    await settle();
    expect(barWarning()).toBe('Enable version 1?');
  });

  it('a clean page asks without the suffix', async () => {
    await render();
    trigger('publish')!.click();
    await settle();
    expect(barWarning()).toBe('Publish version 1? Students will see it.');
  });

  it('#21: delete-version warns when dirty and navigates with force (one question only)', async () => {
    await render();
    await makeDirty();
    trigger('delete')!.click();
    await settle();
    expect(barWarning()).toBe('Delete version v1? This cannot be undone. Unsaved edits may be lost.');
    expect(barBtn('confirm').textContent!.trim()).toBe('Delete');
    expect(barBtn('confirm').classList.contains('danger')).toBe(true);
    barBtn('confirm').click();
    await settle();
    expect(fetchSpy.mock.calls.filter(([u, init]) => String(u) === '/api/versions/1' && (init as RequestInit).method === 'DELETE')).toHaveLength(1);
    expect(currentRoute.path).toBe('/courses/c/edit');
  });

  it('delete-version replaces the history entry, so Back skips the deleted version', async () => {
    await render();
    const replaceSpy = vi.spyOn(history, 'replaceState');
    trigger('delete')!.click();
    await settle();
    barBtn('confirm').click();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit');
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/courses/c/edit');
  });

  it('R49: a version switch withdraws the bar question', async () => {
    serve((url) => (url.endsWith('/versions/2/admin-tree')
      ? jres({ ...structuredClone(tree), version: mkVersion({ id: 2, label: 'Second' }) })
      : undefined));
    const props = await renderReactive();
    trigger('publish')!.click();
    await settle();
    props.versionId = '2';
    await settle();
    expect(target.querySelector('.state-actions .inline-confirm')).toBeNull();
    expect(posts()).toEqual([]);
  });
```

In `describe('VersionEditPage — a late transition / delete after a version switch (Review Focus 4)', …)`, in both tests delete the `vi.spyOn(window, 'confirm').mockReturnValue(true);` line, and replace

```ts
    btnByText('Publish')!.click();
    await settle();
```

(and the same with `'Delete'`) with:

```ts
    btnByText('Publish')!.click();
    await settle();
    target.querySelector<HTMLButtonElement>('.state-actions .inline-confirm button.confirm')!.click();
    await settle();
```

- [ ] **Step 6: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/VersionEditPage.svelte.test.ts`
Expected: FAIL — the state bar tests (no `data-action`s, no question) and the two late-switch tests.

- [ ] **Step 7: VersionEditPage — #20, #21**

In `frontend/src/pages/editor/VersionEditPage.svelte`:

Extend the askInPlace import (Tasks 2, 3):

```ts
  import { PageAsk, PAGE_ASK_KEY, InPlaceAsk, focusIsFree, usable, useTreeAsk, focusAfter, firstUsable, settleTo, withdraw, type Ask, type GuardAsk } from '../../lib/askInPlace.svelte';
```

After the settings modal's version-switch `$effect` add:

```ts
  // ---- Polish 1 #20, #21: the state bar's question, in place of the whole
  //      bar (a place without keys). A version switch withdraws it, as it
  //      closes the settings modal (R49); while busy that closes it too.
  const barAsk = new InPlaceAsk();
  let barEl = $state<HTMLDivElement>();
  const barBtn = (action: string) => barEl?.querySelector<HTMLElement>(`[data-action="version-${action}"]`);
  const barFirst = () => firstUsable(barEl?.querySelector('button'), courseLinkEl);
  $effect(() => {
    void vid;
    untrack(() => barAsk.dismiss());
  });
```

In `onDestroy` add `barAsk.dismiss();`:

```ts
  onDestroy(() => { alive = false; pageAsk.dismiss(); barAsk.dismiss(); clearEditorVersion(); });
```

Replace `transition()` with:

```ts
  type Transition = 'publish' | 'archive' | 'revert' | 'disable' | 'enable';
  const VERB: Record<Transition, string> = {
    publish: 'Publish', archive: 'Archive', revert: 'Revert', disable: 'Disable', enable: 'Enable',
  };
  // D3: transitions are never blocked by an open draft. Publish / archive /
  // disable make every field read-only (closing open drafts), so their
  // question warns; revert and enable never drop a draft.
  function transitionText(action: Transition, v: number): string {
    const suffix = unsavedSuffix(dirtyRegistry.isAnyDirty());
    switch (action) {
      case 'publish': return `Publish version ${v}? Students will see it.${suffix}`;
      case 'archive': return `Archive version ${v}?${suffix}`;
      case 'revert': return `Revert version ${v} to created?`;
      case 'disable': return `Disable version ${v}?${suffix}`;
      case 'enable': return `Enable version ${v}?`;
    }
  }
  function offered(action: Transition): boolean {
    if (!perms) return false;
    return { publish: perms.canPublish, archive: perms.canArchive, revert: perms.canRevert,
             disable: perms.canDisable, enable: perms.canEnable }[action];
  }

  async function transition(action: Transition) {
    if (busy) return;
    const savedVid = vid;
    const q: Ask = {
      warning: () => transitionText(action, savedVid),   // a getter: the suffix stays current
      confirmLabel: VERB[action], tone: 'primary', layout: 'row', confirmDataAction: `confirm-${action}`,
    };
    const a = await barAsk.ask(q);
    if (a === 'cancel') { void focusAfter(() => barBtn(action)); return; }
    if (a !== 'confirm') return;
    // R49: the same version, and the action still offered.
    if (!stillOnVid(savedVid) || busy || !offered(action)) {
      withdraw(barAsk, q, () => firstUsable(barBtn(action), barFirst()));
      return;
    }
    let ok = false;
    busy = true;
    try {
      await api.post(`/api/versions/${savedVid}/${action}`);
      // A version switch mid-request: a forced reload of the old version would
      // discard the new version's load and strand the page on its Skeleton.
      if (stillOnVid(savedVid)) await loadAdminTree(savedVid, { force: true });
      const past: Record<Transition, string> = {
        publish: 'published', archive: 'archived', revert: 'reverted',
        disable: 'disabled', enable: 'enabled',
      };
      pushToast(`Version ${past[action]}`, 'success');
      ok = true;
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : `Could not ${action}`, 'error');
    } finally {
      busy = false;
      // R54: the question settles once the reload has landed. Success: the
      // first button of the new bar; a failure: the trigger first.
      void settleTo(barAsk, q, ok ? barFirst : () => firstUsable(barBtn(action), barFirst()));
    }
  }
```

Replace `deleteVersion()` with:

```ts
  async function deleteVersion() {
    if (busy) return;
    const savedVid = vid;
    const savedSlug = courseSlug;
    const q: Ask = {
      warning: () => `Delete version v${savedVid}? This cannot be undone.${unsavedSuffix(dirtyRegistry.isAnyDirty())}`,
      confirmLabel: 'Delete', tone: 'danger', layout: 'row', confirmDataAction: 'confirm-delete-version',
    };
    const a = await barAsk.ask(q);
    if (a === 'cancel') { void focusAfter(() => barBtn('delete')); return; }
    if (a !== 'confirm') return;
    // R49: the same version, still deletable.
    if (!stillOnVid(savedVid) || busy || !perms?.canDeleteVersion) {
      withdraw(barAsk, q, () => firstUsable(barBtn('delete'), barFirst()));
      return;
    }
    busy = true;
    try {
      await api.delete(`/api/versions/${savedVid}`);
      // force: the user already answered the question — no second DirtyGuard
      // question. replace: Back must not return to the deleted version. Only
      // while still on it — after a version switch, a forced navigate would
      // drop the new page's drafts. The page leaves: its own load focus applies.
      if (stillOnVid(savedVid)) {
        barAsk.settle();
        void navigate(`/courses/${savedSlug}/edit`, { replace: true, force: true });
      }
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
    } finally {
      busy = false;
      // A failure: back to the trigger once the bar is back (R54).
      void settleTo(barAsk, q, () => firstUsable(barBtn('delete'), barFirst()));
    }
  }
```

Replace the state bar (Task 2 gave it the inert attach) with:

```svelte
      <div class="state-actions" bind:this={barEl} {@attach (el) => { el.toggleAttribute('inert', rowAsking); }}>
        {#if barAsk.open}
          <!-- #20, #21: the question, in place of the whole bar. -->
          <AskSlot ask={barAsk} />
        {:else}
          {#if perms.canPublish}
            <Button variant="primary" data-action="version-publish" disabled={busy} onclick={() => void transition('publish')}>Publish</Button>
          {/if}
          {#if perms.canArchive}
            <Button variant="secondary" data-action="version-archive" disabled={busy} onclick={() => void transition('archive')}>Archive</Button>
          {/if}
          {#if perms.canRevert}
            <Button variant="secondary" data-action="version-revert" disabled={busy} onclick={() => void transition('revert')}>Revert</Button>
          {/if}
          {#if perms.canDisable}
            <Button variant="ghost" data-action="version-disable" disabled={busy} onclick={() => void transition('disable')}>Disable</Button>
          {/if}
          {#if perms.canEnable}
            <Button variant="ghost" data-action="version-enable" disabled={busy} onclick={() => void transition('enable')}>Enable</Button>
          {/if}
          {#if perms.canDeleteVersion}
            <Button variant="danger" data-action="version-delete" disabled={busy} onclick={() => void deleteVersion()}>Delete</Button>
          {/if}
        {/if}
      </div>
```

- [ ] **Step 8: Run them to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/VersionEditPage.svelte.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the gate rows**

In `frontend/scripts/visual-refresh-gate.sh`, re-pin the Delete line (`:3841-3846`) in place:

```zsh
# Source: the state bar uses Button's own variants; Delete is the danger variant.
if grep -qE '<Button variant="danger" data-action="version-delete" disabled=\{busy\} onclick=\{\(\) => void deleteVersion\(\)\}>Delete</Button>' src/pages/editor/VersionEditPage.svelte; then
  echo "PASS  VersionEditPage Delete uses Button variant=danger"
else
  echo "FAIL  VersionEditPage Delete uses Button variant=danger"; fail=1
fi
```

At the end of section (am) add:

```zsh
# Task 4 — the versions list's row question (#17, #18), boxed as its rows.
own ask-row VersionsPage.svelte
uniq1 ask-row
if [[ -n $REPLY ]]; then
  N=VersionsPage; H=$REPLY
  d '\.ask-row' '' 'padding:9px 12px 9px 14px' 'background:var\(--focus-0\)' \
                   'border:1px solid var\(--focus-line\)' 'border-radius:var\(--radius\)'
fi
if grep -qF '<h1 bind:this={h1El} tabindex="-1">' src/pages/editor/VersionsPage.svelte \
   && grep -qF 'id={`v-${v.id}-toggle`}' src/pages/editor/VersionsPage.svelte \
   && grep -qF 'id={`v-${v.id}-delete`}' src/pages/editor/VersionsPage.svelte \
   && grep -qF 'id={`v-${v.id}-title`}' src/pages/editor/VersionsPage.svelte; then
  echo "PASS  VersionsPage focus targets: the <h1> (tabindex -1) and the row ids (R54)"
else echo "FAIL  VersionsPage focus targets: the <h1> (tabindex -1) and the row ids (R54)"; fail=1; fi
```

Set `EXPECTED_CHECKS=2179` (`:90`).

Run the gate (Global Constraints). Expected: `ALL PASS (2179 checks)`.

- [ ] **Step 10: Full checks**

Run vitest, svelte-check and the gate (Global Constraints). Expected: vitest green; svelte-check 0 errors, 13 warnings; gate `ALL PASS (2179 checks)`.

- [ ] **Step 11: Screenshots, the user's OK, review lanes, commit**

Screenshots at 1280 wide, dev data, every POST and DELETE mocked:
- VersionsPage: the Disable question under a row; the Delete question under a draft row with its duplicate form open below (frozen); the create form's Discard question (#16); one with Cancel Tab-focused;
- VersionEditPage: the Publish question in place of the bar (dirty: with the suffix), busy; the Delete version question.

Then the per-task loop: the user's OK, both lanes until clean, commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/pages/editor/VersionsPage.svelte frontend/src/pages/editor/VersionEditPage.svelte \
  frontend/scripts/visual-refresh-gate.sh frontend/src/tests/VersionsPage.slots.svelte.test.ts frontend/src/tests/VersionEditPage.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(polish1): version actions ask in place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 5: The quiz edit slot (#14, #6, #2, the quiz title's D10)

**Files:**
- Create: `frontend/src/components/editor/quiz/KeyQuestion.svelte` (the key question's message and builder, R52)
- Modify: `frontend/src/lib/quizEdits.svelte.ts` (`KEY_CONFIRM` `:12-15`, `EditHandle` `:17-23`, `request`/`requestStructure` `:47-61`, `InlineOptions` `:91-114`, `InlineEdit` `:116-204`)
- Modify: `frontend/src/components/editor/quiz/InlineInput.svelte` (attach `:18-21`, markup `:31-56`)
- Modify: `frontend/src/components/editor/quiz/KeyAnswer.svelte` (header comment, imports, `confirmKey` `:44`, `openNumber`/`openText` `:74-115`, `attachNum` `:127-130`, markup `:133-157`)
- Modify: `frontend/src/components/editor/quiz/ChoiceAnswers.svelte` (imports, `onDestroy` `:39`, `mark` `:168-183`, `openEdit`/`openAdd` `:186-233`, `move`/`remove` `:236-273`, the `load` call `:61`, markup `:301`, style)
- Modify: `frontend/src/components/editor/quiz/QuizBody.svelte` (`openAdd` `:144-148`, `move` `:197-203`, `remove` `:233-241`)
- Modify: `frontend/src/components/editor/quiz/QuestionCard.svelte` (`open` `:52-56`)
- Modify: `frontend/src/components/editor/ItemEditorModal.svelte` (`openTitle` `:99-133`, `attachTitle` `:136-140`, the title input `:277`)
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (am), `EXPECTED_CHECKS`)
- Test: `frontend/src/tests/quizEdits.test.ts`, `frontend/src/tests/ChoiceAnswers.svelte.test.ts` (`:261-293`, `:394-410`, `:441-463`), `frontend/src/tests/KeyAnswer.svelte.test.ts` (`:198-219`), `frontend/src/tests/QuizStructure.svelte.test.ts` (`:166-186`, `:371-382`), `frontend/src/tests/QuizHeader.svelte.test.ts`

**Interfaces:**
- Consumes (Tasks 2, 3): `InPlaceAsk`, `Ask`, `Answer`, `DISCARD_NAV_ASK`, `AskSlot`, `focusAfter`, `settleTo`, `withdraw`; ItemEditorModal's `bodyAsk` and `div.body-rest` (Task 2); `DISCARD_PROMPT` re-exported from `DISCARD_CONTINUE` (Task 2).
- Produces:
  - `EditHandle.ask?(q: Ask): Promise<Answer>`;
  - `QuizEdits.request(id?: string): Promise<boolean>` and `QuizEdits.requestStructure(): Promise<boolean>`;
  - `InlineOptions.confirm?: () => Ask | null` (replaces `confirmSend`) and `InlineOptions.asking?: InPlaceAsk`;
  - `InlineEdit.asking: InPlaceAsk`, `InlineEdit.fieldEl: HTMLElement | null`, `InlineEdit.ask(q: Ask): Promise<Answer>`, `InlineEdit.attach(field?: HTMLElement | null): () => void`;
  - `KeyQuestion.svelte` module exports `keyMessage` (snippet) and `keyAsk(): Ask` (confirm action `confirm-change-key`);
  - ChoiceAnswers' `div.ans-ask` line; `KEY_CONFIRM` without "Continue?".
  - Task 6 builds #12 on QuizBody's async `remove` from Step 11.

- [ ] **Step 1: Write the failing `quizEdits` tests**

In `frontend/src/tests/quizEdits.test.ts`:

Replace the imports, the `afterEach` and `handle()` (`:1-14`) with:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  QuizEdits, InlineEdit, DISCARD_PROMPT, type EditHandle, type InlineOptions,
} from '../lib/quizEdits.svelte';
import { InPlaceAsk, DISCARD_NAV_ASK, type Ask, type Answer } from '../lib/askInPlace.svelte';
import { ApiError } from '../lib/api';
import { toasts, clearToasts } from '../stores/toasts.svelte';

afterEach(() => { vi.restoreAllMocks(); clearToasts(); document.body.replaceChildren(); });

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function handle(over: { dirty?: boolean; saving?: boolean; ask?: (q: Ask) => Promise<Answer> } = {}, id = 'a') {
  const close = vi.fn();
  const h: EditHandle = { id, dirty: over.dirty ?? false, saving: over.saving ?? false, close, ask: over.ask };
  return { h, close };
}

/** Stands in for <AskSlot>: a drawn question with its two buttons. Returns its Cancel. */
function drawn(a: InPlaceAsk): HTMLButtonElement {
  const el = document.body.appendChild(document.createElement('div'));
  el.innerHTML = '<div class="inline-confirm"><button class="confirm">OK</button><button class="cancel">Cancel</button></div>';
  a.host = el;
  return el.querySelector<HTMLButtonElement>('button.cancel')!;
}
```

In `describe('QuizEdits (D10)')`, replace the tests from `'lets any action through when nothing is open'` through `'never closes a saving edit, and a saving edit is not unsaved work'` (`:17-64`) with:

```ts
  it('lets any action through when nothing is open', async () => {
    expect(await new QuizEdits().request()).toBe(true);
  });

  it('lets the open edit act on itself', async () => {
    const e = new QuizEdits();
    e.open(handle({ dirty: true }).h);
    expect(await e.request('a')).toBe(true);
  });

  it('closes a clean edit silently, without asking or moving focus', async () => {
    const e = new QuizEdits();
    const ask = vi.fn(async () => 'cancel' as Answer);
    const { h, close } = handle({ ask });
    e.open(h);
    expect(await e.request()).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(false);
    expect(e.active).toBeNull();
  });

  it('#14: a changed edit asks at itself; Cancel and a dismissal keep it, Discard drops it', async () => {
    const e = new QuizEdits();
    const ask = vi.fn(async (_q: Ask): Promise<Answer> => 'cancel');
    const { h, close } = handle({ dirty: true, ask });
    e.open(h);
    expect(await e.request()).toBe(false);
    const q = ask.mock.calls[0]![0];
    expect(q).toMatchObject({ warning: DISCARD_PROMPT, confirmLabel: 'Discard', tone: 'danger', layout: 'row' });
    expect(q).not.toBe(DISCARD_NAV_ASK);   // a fresh object per question: sites compare by identity
    expect(close).not.toHaveBeenCalled();
    expect(e.active).toBe(h);
    ask.mockResolvedValue('dismissed');
    expect(await e.request()).toBe(false);
    expect(close).not.toHaveBeenCalled();
    ask.mockResolvedValue('confirm');
    expect(await e.request()).toBe(true);
    expect(close).toHaveBeenCalledWith(false);
    expect(e.active).toBeNull();
  });

  it('a changed edit that cannot ask (a level-3 modal) is kept', async () => {
    const e = new QuizEdits();
    const { h, close } = handle({ dirty: true });
    e.open(h);
    expect(await e.request()).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it('never closes a saving edit, and a saving edit is not unsaved work', async () => {
    const e = new QuizEdits();
    const ask = vi.fn(async () => 'confirm' as Answer);
    const { h, close } = handle({ dirty: true, saving: true, ask });
    e.open(h);
    expect(await e.request()).toBe(false);
    expect(ask).not.toHaveBeenCalled();
    expect(e.locked).toBe(true);
    expect(e.dirty).toBe(false);
    e.discardAll();
    expect(close).not.toHaveBeenCalled();
  });

  it('an edit that starts saving while it asks is never closed, even on Discard', async () => {
    const e = new QuizEdits();
    const st = { saving: false };
    const close = vi.fn();
    const h: EditHandle = {
      id: 'a', dirty: true, get saving() { return st.saving; }, close,
      ask: async () => { st.saving = true; return 'confirm'; },
    };
    e.open(h);
    expect(await e.request()).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(e.active).toBe(h);
  });
```

Replace `'a move or delete passes a saving edit untouched; otherwise it is D10'` (`:88-100`) with:

```ts
  it('a move or delete passes a saving edit untouched, before or after the question; otherwise it is D10', async () => {
    const e = new QuizEdits();
    const saving = handle({ dirty: true, saving: true });
    e.open(saving.h);
    expect(await e.requestStructure()).toBe(true);
    expect(saving.close).not.toHaveBeenCalled();
    expect(e.active).toBe(saving.h);
    const ask = vi.fn(async (_q: Ask): Promise<Answer> => 'cancel');
    const changed = handle({ dirty: true, ask }, 'b');
    e.open(changed.h);
    expect(await e.requestStructure()).toBe(false);
    expect(ask.mock.calls[0]![0]).toMatchObject({ warning: DISCARD_PROMPT });
    const st = { saving: false };
    const late: EditHandle = {
      id: 'c', dirty: true, get saving() { return st.saving; }, close: vi.fn(),
      ask: async () => { st.saving = true; return 'cancel'; },
    };
    e.open(late);
    expect(await e.requestStructure()).toBe(true);
    expect(late.close).not.toHaveBeenCalled();
  });
```

In `describe('InlineEdit')`, replace `make()` (`:124-136`) with:

```ts
  function make(over: Partial<InlineOptions<string>> = {}) {
    const edits = new QuizEdits();
    const close = vi.fn();
    const send = vi.fn().mockResolvedValue(undefined);
    const ed = new InlineEdit<string>({
      id: 'x', edits, initial: 'old',
      same: (a, b) => a.trim() === b.trim(),
      check: (v) => (v.trim() === '' ? 'Required' : null),
      send, close, ...over,
    });
    const field = document.body.appendChild(document.createElement('input'));
    const detach = ed.attach(field);
    return { edits, ed, close, send, detach, field };
  }
  const keyQ = (): Ask => ({
    warning: 'Change the key?', confirmLabel: 'Change key', tone: 'primary', layout: 'column', confirmDataAction: 'confirm-change-key',
  });
```

Delete `'a declined confirm keeps the field open and sends nothing'` (`:169-175`) and `'a declined key confirm clears an earlier check message'` (`:277-286`). At the end of `describe('InlineEdit')` add:

```ts
  it('#14: its handle asks with the edit\'s own question; Cancel returns focus to the field', async () => {
    const { edits, ed, field } = make();
    ed.value = 'new';
    const p = edits.request();
    expect(ed.asking.current).toMatchObject({ warning: DISCARD_PROMPT });
    ed.asking.answer('cancel');
    expect(await p).toBe(false);
    await flush();
    expect(document.activeElement).toBe(field);
    expect(edits.active).toBe(ed.handle);
  });

  it('#14: Discard settles the question at once (no request) and drops the edit', async () => {
    const { edits, ed, close } = make();
    ed.value = 'new';
    const p = edits.request();
    ed.asking.answer('confirm');
    expect(await p).toBe(true);
    expect(ed.asking.open).toBe(false);
    expect(close).toHaveBeenCalledWith(false);
    expect(edits.active).toBeNull();
  });

  it('while it asks, Enter, ✓, ✕ and Esc only bring the question back', async () => {
    const { edits, ed, close, send, field } = make();
    ed.value = 'new';
    void edits.request();
    const cancel = drawn(ed.asking);
    field.focus();
    ed.keydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(document.activeElement).toBe(cancel);
    field.focus();
    await ed.commit();
    expect(document.activeElement).toBe(cancel);
    field.focus();
    ed.cancel();
    expect(document.activeElement).toBe(cancel);
    field.focus();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    ed.keydown(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
    expect(send).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(ed.asking.open).toBe(true);
  });

  it('closing the field withdraws its own question, never another site\'s on a shared row', async () => {
    const shared = new InPlaceAsk();
    const { edits, ed, detach } = make({ asking: shared });
    ed.value = 'new';
    const p = edits.request();
    detach();
    expect(await p).toBe(false);
    expect(shared.open).toBe(false);
    const other = make({ asking: shared });
    const theirs = shared.ask({ warning: 'Delete it?', confirmLabel: 'Delete', tone: 'danger', confirmDataAction: 'confirm-x' });
    other.detach();
    expect(shared.open).toBe(true);
    shared.answer('cancel');
    expect(await theirs).toBe('cancel');
  });

  it('#6 confirm: asks after the checks, with the old message cleared; Cancel sends nothing and focuses the field', async () => {
    const { ed, send, close, field } = make({ confirm: keyQ });
    ed.value = ' ';
    await ed.commit();
    expect(ed.error).toBe('Required');
    expect(ed.asking.open).toBe(false);          // the check comes first
    ed.value = 'new';
    const p = ed.commit();
    expect(ed.error).toBeNull();
    expect(ed.asking.current).toMatchObject({ confirmLabel: 'Change key' });
    ed.asking.answer('cancel');
    await p;
    await flush();
    expect(send).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);
  });

  it('#6 confirm: the save runs with the question busy; it settles when the save succeeds', async () => {
    let resolve!: () => void;
    const { ed, close, send } = make({ confirm: keyQ, send: vi.fn(() => new Promise<void>((r) => { resolve = r; })) });
    ed.value = 'new';
    const p = ed.commit();
    ed.asking.answer('confirm');
    await flush();
    expect(send).toHaveBeenCalledWith('new');
    expect(ed.asking.busy).toBe(true);
    expect(ed.saving).toBe(true);
    resolve();
    await p;
    expect(ed.asking.open).toBe(false);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('#6 confirm: a failed save keeps the field and its error; the question settles and focus returns to the field', async () => {
    const { ed, close, field } = make({ confirm: keyQ, send: vi.fn().mockRejectedValue(new ApiError(422, 'Nope')) });
    ed.value = 'new';
    const p = ed.commit();
    ed.asking.answer('confirm');
    await p;
    expect(ed.asking.open).toBe(false);
    expect(ed.error).toBe('Nope');
    expect(ed.value).toBe('new');
    expect(close).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);
  });

  it('#6 confirm (R49): a save the version stopped allowing while it asked sends nothing; the field stays', async () => {
    let ok = true;
    const { ed, send, close } = make({ confirm: keyQ, allowed: () => ok });
    ed.value = 'new';
    const p = ed.commit();
    ok = false;
    ed.asking.answer('confirm');
    await p;
    expect(send).not.toHaveBeenCalled();
    expect(ed.asking.open).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(ed.value).toBe('new');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/quizEdits.test.ts`
Expected: FAIL. `request()` still returns a boolean and calls `window.confirm`; `InlineEdit` has no `asking`, `fieldEl` or `confirm`. The tests that never reach a question (`say`, `track`, the save and failure tests) pass.

- [ ] **Step 3: `quizEdits` asks in place**

In `frontend/src/lib/quizEdits.svelte.ts`:

Replace the header comment's last two sentences ("…and any other action asks first. The quiz body owns one instance and exposes it as ItemBodyApi.edits.") with:

```ts
// slot while it is open, and any other action asks first — at the open edit,
// in place (Polish 1 #14). The quiz body owns one instance and exposes it as
// ItemBodyApi.edits.
```

Add after `import { DISCARD_CONTINUE } from './editorReasons';`:

```ts
import {
  InPlaceAsk, DISCARD_NAV_ASK, focusAfter, settleTo, withdraw, type Ask, type Answer,
} from './askInPlace.svelte';
```

Replace `KEY_CONFIRM` (R52: the question leads; the text loses "Continue?"):

```ts
export const KEY_CONFIRM =
  'This quiz is published. Changing the answer key does not re-score students who already ' +
  'attempted — their recorded scores keep the old key. To re-grade everyone, create a new ' +
  'version instead.';
```

Replace `EditHandle`:

```ts
export type EditHandle = {
  readonly id: string;
  readonly dirty: boolean;
  readonly saving: boolean;
  // Close without a request. `refocus` is false when another action takes over.
  close(refocus: boolean): void;
  // D10 in place (#14): asks at the edit. Absent on the level-3 modals: they
  // sit on top, so no other action can ask past them.
  ask?(q: Ask): Promise<Answer>;
};
```

Replace `request` and `requestStructure`:

```ts
  /** D10: resolves true when the caller may go ahead. `id` names the caller's
   *  own edit, if any. A changed edit asks at itself (#14); Discard drops it. */
  async request(id?: string): Promise<boolean> {
    const a = this.active;
    if (a === null || a.id === id) return true;
    if (a.saving) return false;
    if (a.dirty) {
      if (!a.ask) return false;
      // A fresh object: settleTo and the attach cleanup compare questions by identity.
      if ((await a.ask({ ...DISCARD_NAV_ASK })) !== 'confirm') return false;
      // R49: the edit may have closed or started saving while it asked.
      if (this.active !== a || a.saving) return false;
    }
    this.#drop(a);
    return true;
  }

  /** A move or delete follows its locks alone (spec §While a request runs): a
   *  saving edit lets it through untouched, before or after the question;
   *  otherwise the D10 rule applies. */
  async requestStructure(): Promise<boolean> {
    if (this.active?.saving) return true;
    const ok = await this.request();
    return ok || (this.active?.saving ?? false);
  }
```

In `InlineOptions`, replace

```ts
  // A published answer key asks first; false keeps the field open, unsent.
  confirmSend?: () => boolean;
```

with

```ts
  // A published answer key asks first (#6): the question, or null to send at once.
  confirm?: () => Ask | null;
  // Where the edit's questions ask. Default: its own. The quiz title passes the
  // item modal's body-top row, because the header has no room (#14).
  asking?: InPlaceAsk;
```

Replace the whole `InlineEdit` class with:

```ts
/** One inline edit (spec §Saving): Enter or ✓ saves, Esc or ✕ cancels. */
export class InlineEdit<T> {
  // A $state FIELD initialiser, then set in the constructor. A bare `value: T;`
  // declaration would compile to an own property that shadows Svelte's state
  // accessor, and `bind:value` would stop updating.
  value = $state<T>() as T;
  error = $state<string | null>(null);
  saving = $state(false);
  readonly handle: EditHandle;
  /** The edit's questions: D10 (#14) and the key question (#6). While one
   *  asks, the field is readonly and Enter, ✓ and ✕ only bring it back. */
  readonly asking: InPlaceAsk;
  /** Where focus returns after Cancel; attach() records it. */
  fieldEl: HTMLElement | null = null;
  #o: InlineOptions<T>;
  #alive = true;
  #asked: Ask | null = null;   // this edit's last question (a shared `asking` may hold another's)

  constructor(o: InlineOptions<T>) {
    this.#o = o;
    this.value = o.initial;
    this.asking = o.asking ?? new InPlaceAsk();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.handle = {
      id: o.id,
      get dirty() { return !o.same(self.value, o.initial); },
      get saving() { return self.saving; },
      close: (refocus) => o.close(refocus),
      ask: async (q) => {
        const a = await self.ask(q);
        // D10's Discard sends nothing: it settles at once (R54).
        if (a === 'confirm' && self.asking.current === q) self.asking.settle();
        return a;
      },
    };
  }

  /** Call from the field's attachment with the field focus returns to: the edit
   *  takes the slot; the cleanup releases it and withdraws its own question. */
  attach(field: HTMLElement | null = null): () => void {
    this.#alive = true;
    this.fieldEl = field;
    this.#o.edits.open(this.handle);
    return () => {
      this.#alive = false;
      if (this.fieldEl === field) this.fieldEl = null;
      // Only this edit's own: the title shares the body-top row with #19.
      if (this.#asked && this.asking.current === this.#asked) this.asking.dismiss();
      this.#o.edits.release(this.handle);
    };
  }

  /** Asks at this edit. Cancel returns focus to the field, readonly no more (#14, #6). */
  async ask(q: Ask): Promise<Answer> {
    this.#asked = q;
    const a = await this.asking.ask(q);
    if (a === 'cancel') void focusAfter(() => this.fieldEl);
    return a;
  }

  cancel(): void {
    if (this.asking.open) { this.asking.focusCancel(); return; }
    if (!this.saving) this.#o.close(true);
  }

  /** The version still allows this save; ✓ is disabled with FORBIDDEN_TITLE otherwise. */
  get canSave(): boolean { return this.#o.allowed?.() ?? true; }

  #unchanged(): boolean {
    const o = this.#o;
    return o.unchanged ? o.unchanged(this.value) : o.same(this.value, o.initial);
  }

  async commit(): Promise<void> {
    if (this.asking.open) { this.asking.focusCancel(); return; }
    if (this.saving || !this.canSave) return;
    const o = this.#o;
    // Unchanged first: an untouched empty Text key closes rather than erroring.
    if (this.#unchanged()) { o.close(true); return; }
    const msg = o.check(this.value);
    if (msg !== null) { this.error = msg; return; }
    // Cleared before the key question, so a Cancel leaves no stale message.
    this.error = null;
    const q = o.confirm?.() ?? null;
    if (q) {
      if ((await this.ask(q)) !== 'confirm') return;
      // R49: the field may have closed or lost its right to save while it asked.
      if (!this.#alive || !this.canSave || this.saving) { withdraw(this.asking, q, () => this.fieldEl); return; }
    }
    this.saving = true;
    let ok = false;
    try {
      await o.edits.track(o.send(this.value));
      ok = true;
    } catch (e) {
      const m = e instanceof ApiError ? e.displayMessage : 'Save failed';
      // A save always reports its failure: inline while the field is open on
      // this version, otherwise as a toast (spec §While a request runs).
      this.saving = false;   // never left "Saving…" (a field that outlived its version can still cancel)
      if (!this.#alive || !o.edits.live()) pushToast(m, 'error');
      else this.error = m;
    } finally {
      this.saving = false;
      // #6: the question leaves once the save settles (R54). After a failure
      // focus goes back to the field, which keeps the typed key and the error.
      if (q) {
        if (ok) { if (this.asking.current === q) this.asking.settle(); }
        else await settleTo(this.asking, q, () => this.fieldEl);
      }
    }
    if (!ok) return;
    // A stale success writes nothing into the modal (spec §Stale responses).
    if (!o.edits.live()) return;
    o.edits.say('Saved');
    if (!this.#alive) return;
    if (o.after === 'reset') this.value = o.initial;
    else o.close(true);
  }

  /** Enter saves and Esc cancels; Esc never reaches the modal, even while
   *  saving. While a question asks, both only bring it back. */
  keydown(e: KeyboardEvent): void {
    // Safari confirms an IME composition with an Enter whose isComposing is false.
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      void this.commit();
    }
  }
}
```

The value cannot change while a question asks (the field is readonly), so the R49 re-check after the key question need not re-run `unchanged` and `check`: the spec's re-run is that both still hold for the same value.

- [ ] **Step 4: Run them to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/quizEdits.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing component tests**

In `frontend/src/tests/ChoiceAnswers.svelte.test.ts`:

Add after `const single = …`:

```ts
// A question drawn in place (Polish 1): at an answer field (#14), or under the list (#2).
const rowAsk = (card: HTMLElement) => card.querySelector<HTMLElement>('.inline-row .inline-confirm');
const keyLine = (card: HTMLElement) => card.querySelector<HTMLElement>('.ans-ask .inline-confirm');
const btnOf = (ask: HTMLElement | null, k: 'confirm' | 'cancel') => ask!.querySelector<HTMLButtonElement>(`button.${k}`)!;
```

Replace `'D10: a changed field asks before another action; Cancel keeps it, OK discards and acts'` with:

```ts
  it('#14: a changed field asks at itself, in place of ✓ and ✕; Cancel keeps it and returns to it; Discard drops it and acts', async () => {
    const s = single();
    await renderQuiz(s);
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    typeInto(field(cards()[0]), 'changed');
    marker(rows(cards()[0])[1]).click();
    await settle();
    const ask = rowAsk(cards()[0])!;
    expect(text(ask.querySelector('.warning'))).toBe(DISCARD_PROMPT);
    expect(ask.classList.contains('row')).toBe(true);
    expect(btnOf(ask, 'confirm').classList.contains('danger')).toBe(true);
    expect(byName(cards()[0], 'Save answer')).toBeUndefined();
    expect(field(cards()[0]).readOnly).toBe(true);
    expect(document.activeElement).toBe(btnOf(ask, 'cancel'));
    // Enter and Esc in the readonly field only bring the question back.
    field(cards()[0]).focus();
    press(field(cards()[0]), 'Enter');
    expect(document.activeElement).toBe(btnOf(ask, 'cancel'));
    field(cards()[0]).focus();
    press(field(cards()[0]), 'Escape');
    expect(document.activeElement).toBe(btnOf(ask, 'cancel'));
    btnOf(ask, 'cancel').click();
    await settle();
    expect(rowAsk(cards()[0])).toBeNull();
    expect(document.activeElement).toBe(field(cards()[0]));
    expect(field(cards()[0]).value).toBe('changed');
    expect(field(cards()[0]).readOnly).toBe(false);
    expect(optWrites(s)).toEqual([]);
    marker(rows(cards()[0])[1]).click();
    await settle();
    btnOf(rowAsk(cards()[0]), 'confirm').click();
    await settle();
    expect(field(cards()[0])).toBeNull();
    expect(optWrites(s).map((c) => c.body)).toEqual([{ is_correct: true }]);
    // #2 unpublished: the marker takes focus before it acts, never <body>.
    expect(document.activeElement).toBe(marker(rows(cards()[0])[1]));
  });
```

In `'D10: an unchanged open field closes silently when another action starts'`, delete `const ask = vi.spyOn(window, 'confirm');` and replace `expect(ask).not.toHaveBeenCalled();` with `expect(cards()[0].querySelector('.inline-confirm')).toBeNull();`.

In `'delete: no confirm; focus goes to the next answer, then the previous, then + Add answer'`, delete `const ask = vi.spyOn(window, 'confirm');` and replace `expect(ask).not.toHaveBeenCalled();` with `expect(cards()[0].querySelector('.inline-confirm')).toBeNull();`.

Replace `'published: the marker asks first; Cancel keeps the key; structure controls are absent; text saves'` with:

```ts
  it('#2 published: the marker asks under the list (R52); Cancel keeps the key; Change key saves; text saves', async () => {
    const s = single();
    await renderQuiz(s, { version: { state: 'published' } });
    marker(rows(cards()[0])[1]).click();
    await settle();
    const ask = keyLine(cards()[0])!;
    expect(ask.classList.contains('row')).toBe(false);
    expect(text(ask.querySelector('.warning strong'))).toBe('Change the answer key?');
    expect(text(ask.querySelector('.warning'))).toBe(`Change the answer key? ${KEY_CONFIRM}`);
    expect(text(btnOf(ask, 'confirm'))).toBe('Change key');
    expect(btnOf(ask, 'confirm').classList.contains('primary')).toBe(true);
    expect(document.activeElement).toBe(btnOf(ask, 'cancel'));
    btnOf(ask, 'cancel').click();
    await settle();
    expect(keyLine(cards()[0])).toBeNull();
    expect(document.activeElement).toBe(marker(rows(cards()[0])[1]));
    expect(optWrites(s)).toEqual([]);
    expect(marks()).toEqual([true, false, false]);
    marker(rows(cards()[0])[1]).click();
    await settle();
    btnOf(keyLine(cards()[0]), 'confirm').click();
    await settle();
    expect(marks()).toEqual([false, true, false]);
    expect(keyLine(cards()[0])).toBeNull();
    expect(document.activeElement).toBe(marker(rows(cards()[0])[1]));
    expect(cards()[0].querySelector('.row-acts')).toBeNull();
    expect(cards()[0].querySelector('.ans-add')).toBeNull();
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    typeInto(field(cards()[0]), 'Renamed');
    press(field(cards()[0]), 'Enter');
    await settle();
    expect(optWrites(s).at(-1)!.body).toEqual({ text: 'Renamed' });
  });

  it('#2: while the key saves the question stays busy with focus on Change key; another marker is refused; then the marker', async () => {
    const s = single();
    const hold = s.hold('PATCH', /\/api\/options\/12$/);
    await renderQuiz(s, { version: { state: 'published' } });
    marker(rows(cards()[0])[1]).click();
    await settle();
    btnOf(keyLine(cards()[0]), 'confirm').click();
    await settle();
    const ok = btnOf(keyLine(cards()[0]), 'confirm');
    expect(document.activeElement).toBe(ok);
    expect(ok.getAttribute('aria-busy')).toBe('true');
    press(ok, 'Escape');
    expect(keyLine(cards()[0])).not.toBeNull();     // Esc is ignored while busy
    marker(rows(cards()[0])[2]).click();
    await settle();
    expect(document.activeElement).toBe(ok);        // R53: refused quietly while busy
    hold.release();
    await settle();
    expect(keyLine(cards()[0])).toBeNull();
    expect(optWrites(s).length).toBe(1);
    expect(document.activeElement).toBe(marker(rows(cards()[0])[1]));
  });

  it('#2 R57: focus moved away during the save stays where the author put it', async () => {
    const s = single();
    const hold = s.hold('PATCH', /\/api\/options\/12$/);
    await renderQuiz(s, { version: { state: 'published' } });
    marker(rows(cards()[0])[1]).click();
    await settle();
    btnOf(keyLine(cards()[0]), 'confirm').click();
    await settle();
    const elsewhere = byName(panel(), 'Edit title')!;
    elsewhere.focus();
    hold.release();
    await settle();
    expect(keyLine(cards()[0])).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('#2 + #14: a changed field asks first, at itself; on Discard the key question follows under the list; its Cancel sends nothing', async () => {
    const s = single();
    await renderQuiz(s, { version: { state: 'published' } });
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    typeInto(field(cards()[0]), 'changed');
    marker(rows(cards()[0])[1]).click();
    await settle();
    expect(keyLine(cards()[0])).toBeNull();
    btnOf(rowAsk(cards()[0]), 'confirm').click();
    await settle();
    expect(field(cards()[0])).toBeNull();
    expect(document.activeElement).toBe(btnOf(keyLine(cards()[0]), 'cancel'));
    btnOf(keyLine(cards()[0]), 'cancel').click();
    await settle();
    expect(optWrites(s)).toEqual([]);
    expect(document.activeElement).toBe(marker(rows(cards()[0])[1]));
  });

  it('#2 R49: the answer it asks about leaves the list (a reload) — the question goes; focus the author moved stays', async () => {
    const s = single();
    s.failNext('PATCH', /\/api\/options\/11$/, 422, 'Nope');
    await renderQuiz(s, { version: { state: 'published' } });
    marker(rows(cards()[0])[1]).click();
    await settle();
    expect(keyLine(cards()[0])).not.toBeNull();
    s.options = s.options.filter((o) => o.id !== 12);   // deleted elsewhere
    textBtn(rows(cards()[0])[0]).click();               // the author moves on: a text edit
    await settle();
    typeInto(field(cards()[0]), 'Renamed');
    press(field(cards()[0]), 'Enter');                  // fails, so the list reloads without 12
    await settle();
    expect(rows(cards()[0]).map((r) => r.dataset.aId)).toEqual(['11', '13']);
    expect(keyLine(cards()[0])).toBeNull();
    expect(document.activeElement).toBe(field(cards()[0]));
    expect(optWrites(s).filter((c) => /options\/12/.test(c.path))).toEqual([]);
  });
```

In `frontend/src/tests/KeyAnswer.svelte.test.ts`:

Replace `'the D10 prompt comes before the key confirm; Cancel on the confirm keeps the field'` with:

```ts
  it('#14 then #6: D10 asks at the dirty Number edit; the key question then asks under the Text field (R52)', async () => {
    const s = new QuizServer([num(), txt()]);
    await renderQuiz(s, { version: { state: 'published' } });
    pencil(0).click();
    await settle();
    typeInto(input(0, 'Answer'), '9');
    pencil(1).click();
    await settle();
    // #14: in place of the Number edit's ✓ and ✕; both its fields are readonly.
    const d10 = cards()[0].querySelector<HTMLElement>('.key-fields .inline-confirm')!;
    expect(text(d10.querySelector('.warning'))).toBe(DISCARD_PROMPT);
    expect(document.activeElement).toBe(d10.querySelector('button.cancel'));
    expect(input(0, 'Answer').readOnly).toBe(true);
    expect(input(0, 'Decimals').readOnly).toBe(true);
    expect(byName(cards()[0], 'Save answer')).toBeUndefined();
    d10.querySelector<HTMLButtonElement>('button.confirm')!.click();
    await settle();
    expect(cards()[0].querySelector('.key-edit')).toBeNull();
    typeInto(input(1, 'Answer'), 'changed');
    press(input(1, 'Answer'), 'Enter');
    await settle();
    // #6: in the field's message slot, led by its question.
    const key = () => cards()[1].querySelector<HTMLElement>('.inline-field > .ask-slot .inline-confirm');
    expect(key()!.classList.contains('row')).toBe(false);
    expect(text(key()!.querySelector('.warning'))).toBe(`Change the answer key? ${KEY_CONFIRM}`);
    expect(text(key()!.querySelector('button.confirm'))).toBe('Change key');
    expect(cards()[1].querySelector('.inline-hint')).toBeNull();
    expect(document.activeElement).toBe(key()!.querySelector('button.cancel'));
    key()!.querySelector<HTMLButtonElement>('button.cancel')!.click();
    await settle();
    expect(key()).toBeNull();
    expect(document.activeElement).toBe(input(1, 'Answer'));
    expect(input(1, 'Answer').value).toBe('changed');
    expect(input(1, 'Answer').readOnly).toBe(false);
    expect(qWrites(s)).toEqual([]);
    press(input(1, 'Answer'), 'Enter');
    await settle();
    key()!.querySelector<HTMLButtonElement>('button.confirm')!.click();
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ correct_text: 'changed' }]);
    expect(document.activeElement).toBe(pencil(1));
  });

  it('#6: while the key saves the question stays busy; a failed save brings focus back to the field with the error', async () => {
    const s = new QuizServer([txt({ id: 1 })]);
    const hold = s.hold('PATCH', /\/api\/questions\/1$/);
    await renderQuiz(s, { version: { state: 'published' } });
    pencil().click();
    await settle();
    typeInto(input(0, 'Answer'), 'basis');
    press(input(0, 'Answer'), 'Enter');
    await settle();
    const key = () => cards()[0].querySelector<HTMLElement>('.inline-field > .ask-slot .inline-confirm');
    key()!.querySelector<HTMLButtonElement>('button.confirm')!.click();
    await settle();
    const ok = key()!.querySelector<HTMLButtonElement>('button.confirm')!;
    expect(document.activeElement).toBe(ok);
    expect(ok.getAttribute('aria-busy')).toBe('true');
    expect(input(0, 'Answer').readOnly).toBe(true);
    press(ok, 'Escape');
    expect(key()).not.toBeNull();             // Esc is ignored while busy
    hold.fail(422, 'Nope');
    await settle();
    expect(key()).toBeNull();
    expect(text(cards()[0].querySelector('.inline-err'))).toBe('Nope');
    expect(input(0, 'Answer').value).toBe('basis');
    expect(document.activeElement).toBe(input(0, 'Answer'));   // never a disabled ✓, never <body>
  });
```

In `frontend/src/tests/QuizStructure.svelte.test.ts`:

In `'a slow answer load for a new choice question does not interrupt work the author moved on to'`, delete `const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);` and replace `expect(ask).not.toHaveBeenCalled();` with `expect(panel().querySelector('.inline-confirm')).toBeNull();`.

Replace `'D10: deleting the question that holds a changed edit asks the discard prompt first'` with:

```ts
  it('#14: deleting the question that holds a changed edit asks the discard question first, at the edit', async () => {
    const s = two();
    await renderQuiz(s);
    rows(cards()[0])[0].querySelector<HTMLButtonElement>('button.ans-edit')!.click();
    await settle();
    const f = cards()[0].querySelector<HTMLInputElement>('input.inline-input')!;
    typeInto(f, 'changed');
    byName(cards()[0], 'Delete question 1')!.click();
    await settle();
    const d10 = cards()[0].querySelector<HTMLElement>('.inline-row .inline-confirm')!;
    expect(text(d10.querySelector('.warning'))).toBe(DISCARD_PROMPT);
    expect(document.activeElement).toBe(d10.querySelector('button.cancel'));
    d10.querySelector<HTMLButtonElement>('button.cancel')!.click();
    await settle();
    expect(document.activeElement).toBe(f);
    expect(f.value).toBe('changed');
    expect(s.writes()).toEqual([]);
  });
```

In `frontend/src/tests/QuizHeader.svelte.test.ts`:

Change the imports:

```ts
import { DISCARD_PROMPT, FORBIDDEN_TITLE } from '../lib/quizEdits.svelte';
import { navigate } from '../lib/router.svelte';
```

(in place of `import { FORBIDDEN_TITLE } from '../lib/quizEdits.svelte';`), add `cards` to the harness import, and after `const itemPatches = …` add:

```ts
// The title's D10 question asks in the body-top row (Polish 1 #14).
const topAsk = () => panel().querySelector<HTMLElement>('.modal-body > .ask-slot .inline-confirm');
const head = () => panel().querySelector<HTMLElement>('header.modal-head')!;
```

At the end of `describe('Quiz header (5d T4)')` add:

```ts
  it('#14: a changed title asks in the body-top row; the body freezes; Cancel returns to the title; Discard opens the next editor', async () => {
    await renderQuiz(new QuizServer([q({ id: 1 })]));
    await openTitle();
    typeInto(field(), 'Changed');
    byName(cards()[0], 'Edit question 1')!.click();
    await settle();
    expect(text(topAsk()!.querySelector('.warning'))).toBe(DISCARD_PROMPT);
    expect(document.activeElement).toBe(topAsk()!.querySelector('button.cancel'));
    expect(field().readOnly).toBe(true);
    expect(panel().querySelector('.body-rest')!.hasAttribute('inert')).toBe(true);
    // Enter, ✓ and ✕ in the header only bring the question back (R48).
    for (const act of [() => press(field(), 'Enter'), () => byName(head(), 'Save title')!.click(), () => byName(head(), 'Cancel')!.click()]) {
      field().focus();
      act();
      expect(document.activeElement).toBe(topAsk()!.querySelector('button.cancel'));
    }
    topAsk()!.querySelector<HTMLButtonElement>('button.cancel')!.click();
    await settle();
    expect(topAsk()).toBeNull();
    expect(document.activeElement).toBe(field());
    expect(field().value).toBe('Changed');
    expect(field().readOnly).toBe(false);
    expect(panel().querySelector('.body-rest')!.hasAttribute('inert')).toBe(false);
    byName(cards()[0], 'Edit question 1')!.click();
    await settle();
    topAsk()!.querySelector<HTMLButtonElement>('button.confirm')!.click();
    await settle();
    expect(h2().querySelector('input')).toBeNull();
    expect(document.querySelectorAll('section.modal-panel').length).toBe(2);   // the question text editor
  });

  it('R53: while the title\'s D10 question asks, a navigation is refused and focus returns to it', async () => {
    await renderQuiz(new QuizServer([q({ id: 1 })]), { page: true });
    await openTitle();
    typeInto(field(), 'Changed');
    byName(cards()[0], 'Edit question 1')!.click();
    await settle();
    const before = location.pathname;
    closeX().focus();
    await navigate('/title-refused');
    await settle();
    expect(location.pathname).toBe(before);
    expect(document.activeElement).toBe(topAsk()!.querySelector('button.cancel'));
    expect(text(topAsk()!.querySelector('.warning'))).toBe(DISCARD_PROMPT);
  });
```

- [ ] **Step 6: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/ChoiceAnswers.svelte.test.ts src/tests/KeyAnswer.svelte.test.ts src/tests/QuizStructure.svelte.test.ts src/tests/QuizHeader.svelte.test.ts`
Expected: FAIL — every new and rewritten question test (the callers still treat `request()` as a boolean, so a pending promise reads as "go ahead"; no host draws the edit's question; the marker and the key edits still call `window.confirm`). The other tests pass.

- [ ] **Step 7: Write `KeyQuestion.svelte`**

Create `frontend/src/components/editor/quiz/KeyQuestion.svelte`:

```svelte
<script module lang="ts">
  // The answer-key question (Polish 1 R52), shared by the marker (#2) and the
  // Number / Text key (#6). It leads with its question in bold, then the
  // published-quiz warning; the group is named by the whole message. This
  // component renders nothing: import `keyAsk` from its module.
  import { KEY_CONFIRM } from '../../../lib/quizEdits.svelte';
  import type { Ask } from '../../../lib/askInPlace.svelte';

  export { keyMessage };

  export function keyAsk(): Ask {
    return { message: keyMessage, confirmLabel: 'Change key', tone: 'primary', layout: 'column', confirmDataAction: 'confirm-change-key' };
  }
</script>

{#snippet keyMessage()}<strong>Change the answer key?</strong> {KEY_CONFIRM}{/snippet}
```

- [ ] **Step 8: `InlineInput` draws its edit's question**

In `frontend/src/components/editor/quiz/InlineInput.svelte`:

Update the header comment's first sentence to: "The markup of one inline text edit (spec §Saving): the field, the check and cancel buttons, and the error or hint under it. A question at the edit (Polish 1) stands in place of ✓ and ✕ (row), or of the message (column)."

Add to the imports:

```ts
  import AskSlot from '../../ui/AskSlot.svelte';
```

Replace `attach`:

```ts
  const attach = (el: HTMLInputElement) => {
    el.focus();
    return untrack(() => edit.attach(el));
  };
  // Where the edit's question asks: a row question (D10) in place of ✓ and ✕,
  // a column question (the key, R52) in the message slot.
  const asksInRow = $derived(!!edit.asking.current && edit.asking.current.layout === 'row');
  const asksInMsg = $derived(!!edit.asking.current && edit.asking.current.layout !== 'row');
```

Replace the markup (`<span class="inline-field">` … `</span>`) with:

```svelte
<span class="inline-field">
  <span class="inline-row" bind:this={rowEl}>
    <input
      class="inline-input"
      type="text"
      aria-label={label}
      {maxlength}
      readonly={edit.saving || edit.asking.open}
      aria-invalid={edit.error ? 'true' : undefined}
      aria-describedby={(edit.error || hint) && !asksInMsg ? msgId : undefined}
      bind:this={inputEl}
      bind:value={() => edit?.value ?? '', (v) => { if (edit) edit.value = v; }}
      onkeydown={(e) => edit.keydown(e)}
      oninput={() => { edit.error = null; }}
      {@attach attach}
    />
    {#if asksInRow}
      <AskSlot ask={edit.asking} />
    {:else}
      <IconButton glyph="check" size="sm" title={edit.saving ? 'Saving…' : edit.canSave ? saveTitle : FORBIDDEN_TITLE}
                  disabled={!edit.canSave} onclick={() => void edit.commit()} />
      <IconButton glyph="close" size="sm" title="Cancel" disabled={edit.saving} onclick={() => edit.cancel()} />
    {/if}
  </span>
  {#if asksInMsg}
    <AskSlot ask={edit.asking} />
  {:else if edit.error}
    <span class="inline-err" id={msgId} role="alert">{edit.error}</span>
  {:else if hint}
    <span class="inline-hint" id={msgId}>{hint}</span>
  {/if}
</span>
```

- [ ] **Step 9: `KeyAnswer` — the key question (#6) and the Number edit's question**

In `frontend/src/components/editor/quiz/KeyAnswer.svelte`:

In the header comment replace "a published version confirms first (after the D10 prompt, which ran when the editor opened)" with "a published version asks first, under the field (#6; after the D10 question, which ran when the editor opened)".

Replace the imports of IconButton … quizEdits with:

```ts
  import IconButton from '../../ui/IconButton.svelte';
  import AskSlot from '../../ui/AskSlot.svelte';
  import InlineInput from './InlineInput.svelte';
  import { keyAsk } from './KeyQuestion.svelte';
  import { FORBIDDEN_TITLE, InlineEdit, WAIT_TITLE } from '../../../lib/quizEdits.svelte';
```

Replace `const confirmKey = () => !ctx.published || window.confirm(KEY_CONFIRM);` with:

```ts
  // #6: a published key asks under the field first (R52); null sends at once.
  const keyQuestion = () => (ctx.published ? keyAsk() : null);
```

Replace the first two lines of `openNumber` with:

```ts
  async function openNumber() {
    if (numEdit || editReason !== null) return;
    if (!(await ctx.edits.request())) return;
    // R49: re-checked after the D10 question.
    if (numEdit || editReason !== null || !alive() || !ctx.canText) return;
```

and in its options replace `confirmSend: confirmKey,` with `confirm: keyQuestion,`.

Replace the first two lines of `openText` with:

```ts
  async function openText() {
    if (textEdit || editReason !== null) return;
    if (!(await ctx.edits.request())) return;
    // R49: re-checked after the D10 question.
    if (textEdit || editReason !== null || !alive() || !ctx.canText) return;
```

and in its options replace `confirmSend: confirmKey,` with `confirm: keyQuestion,`.

Replace `attachNum`:

```ts
  const attachNum = (el: HTMLElement) => {
    const field = el.querySelector<HTMLInputElement>('input');
    field?.focus();
    return untrack(() => numEdit!.attach(field));
  };
  // The Number edit's question: a row (D10) in place of ✓ and ✕, a column
  // (the key, R52) in the message slot.
  const numInRow = $derived(!!numEdit?.asking.current && numEdit.asking.current.layout === 'row');
  const numInMsg = $derived(!!numEdit?.asking.current && numEdit.asking.current.layout !== 'row');
```

Replace the `{#if numEdit}` branch (`<div class="key-edit" …>` … `</div>`) with:

```svelte
{#if numEdit}
  <div class="key-edit" role="group" aria-label={`Answer to question ${n}`} bind:this={editEl} {@attach attachNum}>
    <div class="key-fields">
      <label class="key-field">
        <span class="key-label">Answer</span>
        <input class="key-input mono" type="text" aria-label="Answer" maxlength="40"
               readonly={numEdit.saving || numEdit.asking.open} aria-invalid={numEdit.error && !decBad ? 'true' : undefined}
               aria-describedby={numEdit.error && !decBad && !numInMsg ? errId : undefined}
               bind:value={() => numEdit?.value.v ?? '', (v) => { if (numEdit) numEdit.value.v = v; }} onkeydown={(e) => numEdit?.keydown(e)}
               oninput={() => { if (numEdit) numEdit.error = null; }} />
      </label>
      <label class="key-field">
        <span class="key-label">Decimals</span>
        <input class="key-input key-dec mono" type="text" inputmode="numeric" aria-label="Decimals" maxlength="2"
               aria-invalid={decBad ? 'true' : undefined} aria-describedby={decBad && !numInMsg ? errId : undefined}
               readonly={numEdit.saving || numEdit.asking.open} bind:value={() => numEdit?.value.d ?? '', (v) => { if (numEdit) numEdit.value.d = v; }} onkeydown={(e) => numEdit?.keydown(e)}
               oninput={() => { if (numEdit) numEdit.error = null; }} />
      </label>
      {#if numInRow}
        <AskSlot ask={numEdit.asking} />
      {:else}
        <IconButton glyph="check" size="sm"
                    title={numEdit.saving ? 'Saving…' : numEdit.canSave ? 'Save answer' : FORBIDDEN_TITLE}
                    disabled={!numEdit.canSave} onclick={() => void numEdit?.commit()} />
        <IconButton glyph="close" size="sm" title="Cancel" disabled={numEdit.saving} onclick={() => numEdit?.cancel()} />
      {/if}
    </div>
    {#if numInMsg}
      <AskSlot ask={numEdit.asking} />
    {:else if numEdit.error}<span class="key-err" id={errId} role="alert">{numEdit.error}</span>{/if}
  </div>
```

In the pencil, `onclick={isNumber ? openNumber : openText}` stays: Svelte ignores the returned promise.

- [ ] **Step 10: `ChoiceAnswers` — the marker's key question (#2) and the four callers**

In `frontend/src/components/editor/quiz/ChoiceAnswers.svelte`:

Replace the imports from `svelte` through `quizEdits` with:

```ts
  import { getContext, onDestroy, onMount, tick, untrack } from 'svelte';
  import Button from '../../ui/Button.svelte';
  import AskSlot from '../../ui/AskSlot.svelte';
  import ChoiceRow from './ChoiceRow.svelte';
  import InlineInput from './InlineInput.svelte';
  import { keyAsk } from './KeyQuestion.svelte';
  import { ApiError } from '../../../lib/api';
  import { InPlaceAsk, focusAfter, settleTo, withdraw } from '../../../lib/askInPlace.svelte';
  import { InlineEdit, WAIT_TITLE } from '../../../lib/quizEdits.svelte';
```

Replace `onDestroy(() => { mounted = false; token++; });` with:

```ts
  // #2: a published key asks under the list (R52). One place: a second marker
  // while it asks brings the open question back (R53).
  const markAsk = new InPlaceAsk();
  let markingId: number | null = null;   // the answer the open question is about
  onDestroy(() => { mounted = false; token++; markAsk.dismiss(); });
  // R49: the answer it asks about left the list (a reload): the question goes,
  // unless busy (its own write settles it).
  $effect(() => {
    const list = options;
    untrack(() => {
      if (!markAsk.open || markAsk.busy || (list ?? []).some((x) => x.id === markingId)) return;
      const free = markAsk.focusFree;
      markAsk.dismiss();
      if (free) void tick().then(() => { if (alive()) ctx.focusFallback(q.id); });
    });
  });
```

In `load()`, replace `if (alive() && ctx.edits.active === null && mine) openAdd();` with `if (alive() && ctx.edits.active === null && mine) void openAdd();`.

After `const addBtn = …` add:

```ts
  const markerEl = (id: number) => rowEl(id)?.querySelector<HTMLButtonElement>('button.ans-mark') ?? null;
  const trashEl = (id: number) => rowEl(id)?.querySelector<HTMLButtonElement>('button[data-glyph="trash"]') ?? null;
```

Replace the whole `// ---- The marker ----` section (`mark`) with:

```ts
  // ---- The marker ----
  // It may act: nothing running here, enabled, and it would change the key.
  // Re-run after every question against the live list (R49).
  function markable(id: number): boolean {
    const cur = (options ?? []).find((x) => x.id === id);
    if (!cur || !alive() || !ctx.canText || op !== null || markReason(cur) !== null) return false;
    const others = (options ?? []).some((x) => x.is_correct && x.id !== id);
    return multiple || !cur.is_correct || others;   // single choice: already the one correct answer
  }
  async function setCorrect(id: number) {
    const cur = (options ?? []).find((x) => x.id === id);
    if (!cur) return;
    const next = multiple ? !cur.is_correct : true;
    const echo = await act(`mark:${id}`, () => updateOption(id, { is_correct: next }));
    if (!echo || !alive()) return;
    // Only is_correct is written back; single choice clears the others (D12).
    options = (options ?? []).map((x) =>
      x.id === id ? { ...x, is_correct: echo.is_correct }
        : !multiple && echo.is_correct ? { ...x, is_correct: false } : x);
    ctx.say('Saved');
  }
  async function mark(o: AuthoringOption) {
    if (!markable(o.id)) return;
    if (!(await ctx.edits.request())) return;                 // D10 first (#14) …
    if (!markable(o.id)) return;
    const marker = () => markerEl(o.id);
    if (!ctx.published) {
      // After a D10 Discard the question took focus with it: the marker, not <body>.
      await focusAfter(marker);
      await setCorrect(o.id);
      return;
    }
    if (markAsk.open) { markAsk.focusCancel(); return; }    // R53: one question here
    markingId = o.id;
    const q = keyAsk();
    const a = await markAsk.ask(q);                          // … then the key question (#2)
    if (a === 'cancel') { void focusAfter(marker); return; }
    if (a !== 'confirm') return;
    if (!markable(o.id)) { withdraw(markAsk, q, marker); return; }
    try {
      await setCorrect(o.id);
    } finally {
      await settleTo(markAsk, q, marker);
    }
  }
```

Replace the first lines of `openEdit` up to `editId = o.id;`:

```ts
  async function openEdit(o: AuthoringOption) {
    if (editId === o.id || textReason() !== null) return;
    if (!(await ctx.edits.request())) return;
    // R49: re-checked after the D10 question.
    if (editId === o.id || textReason() !== null || !alive() || !ctx.canText) return;
    if (!(options ?? []).some((x) => x.id === o.id)) return;
    editId = o.id;
```

Replace the first two lines of `openAdd`:

```ts
  async function openAdd() {
    if (addEdit || addReason !== null) return;
    if (!(await ctx.edits.request())) return;
    // R49: re-checked after the D10 question.
    if (addEdit || addReason !== null || !alive() || !ctx.canStruct) return;
```

In `move`, replace

```ts
    if (op !== null || held) return;
    const cur = options ?? [];
    const i = cur.findIndex((x) => x.id === o.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return;
    if (!ctx.edits.requestStructure()) return;   // moves follow their locks alone
```

with

```ts
    const at = () => {
      const i = (options ?? []).findIndex((x) => x.id === o.id);
      const j = i + dir;
      return i < 0 || j < 0 || j >= (options ?? []).length ? null : [i, j] as const;
    };
    if (op !== null || held || !at()) return;
    if (!(await ctx.edits.requestStructure())) return;   // moves follow their locks alone
    // R49: recomputed from the live list after the D10 question.
    const ij = at();
    if (op !== null || held || !alive() || !ij) return;
    const [i, j] = ij;
    const cur = options ?? [];
```

In `remove`, replace

```ts
    if (op !== null || deleteReason(o) !== null) return;
    if (!ctx.edits.requestStructure()) return;   // deletes follow their locks alone
```

with

```ts
    if (op !== null || deleteReason(o) !== null) return;
    if (!(await ctx.edits.requestStructure())) return;   // deletes follow their locks alone
    // R49: re-checked after the D10 question.
    const cur = (options ?? []).find((x) => x.id === o.id);
    if (!cur || op !== null || deleteReason(cur) !== null || !alive()) return;
    // After a D10 Discard the question took focus with it: the trash, not <body>.
    await focusAfter(() => trashEl(o.id));
```

In the markup, after `</ul>` add:

```svelte
  {#if markAsk.open}
    <!-- #2: the key question, under the list (R52). -->
    <div class="ans-ask"><AskSlot ask={markAsk} /></div>
  {/if}
```

and change the "+ Add answer" button's `onclick={openAdd}` to `onclick={() => void openAdd()}`. In ChoiceRow's props, `onEdit={() => openEdit(o)}` becomes `onEdit={() => void openEdit(o)}`.

At the end of `<style>` add:

```css
  /* Lines up with "+ Add answer" under the list. */
  .ans-ask { margin-top: 4px; padding-left: 8px; }
```

- [ ] **Step 11: `QuizBody` and `QuestionCard` — the remaining callers**

In `frontend/src/components/editor/quiz/QuizBody.svelte`:

Replace `openAdd`:

```ts
  async function openAdd() {
    if (adding || addReason !== null) return;
    if (!(await edits.request())) return;
    // R49: re-checked after the D10 question.
    if (adding || addReason !== null || !live() || !perms.canEditStructure) return;
    adding = true;
  }
```

and the "+ Add question" button's `onclick={openAdd}` becomes `onclick={() => void openAdd()}`.

In `move`, replace

```ts
    if (quizLock || busyQuestions.has(qid)) return;
    const i = questions.findIndex((x) => x.id === qid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= questions.length) return;
    if (!edits.requestStructure()) return;   // moves follow their locks alone
```

with

```ts
    const at = () => {
      const i = questions.findIndex((x) => x.id === qid);
      const j = i + dir;
      return i < 0 || j < 0 || j >= questions.length ? null : [i, j] as const;
    };
    if (quizLock || busyQuestions.has(qid) || !at()) return;
    if (!(await edits.requestStructure())) return;   // moves follow their locks alone
    // R49: recomputed from the live list after the D10 question.
    const ij = at();
    if (quizLock || busyQuestions.has(qid) || !live() || !ij) return;
    const [i, j] = ij;
```

In `remove`, replace

```ts
    if (quizLock || busyQuestions.has(qid)) return;
    const idx = questions.findIndex((x) => x.id === qid);
    if (idx < 0) return;
    if (!edits.requestStructure()) return;   // deletes follow their locks alone
```

with

```ts
    if (quizLock || busyQuestions.has(qid) || !questions.some((x) => x.id === qid)) return;
    if (!(await edits.requestStructure())) return;   // deletes follow their locks alone
    // R49: re-checked, and the index recomputed, after the D10 question.
    const idx = questions.findIndex((x) => x.id === qid);
    if (quizLock || busyQuestions.has(qid) || !live() || idx < 0) return;
```

(The `window.confirm` that follows stays until Task 6.)

In `frontend/src/components/editor/quiz/QuestionCard.svelte`, replace `open`:

```ts
  async function open(kind: 'text' | 'expl') {
    if (l3 !== null || openReason !== null) return;
    if (!(await ctx.edits.request())) return;
    // R49: re-checked after the D10 question.
    if (l3 !== null || openReason !== null || !alive()) return;
    l3 = kind;
  }
```

and its three `onclick={() => open(…)}` become `onclick={() => void open(…)}`.

- [ ] **Step 12: ItemEditorModal — the title's D10 question in the body-top row**

In `frontend/src/components/editor/ItemEditorModal.svelte`:

Replace the first lines of `openTitle` up to `titleEdit = new InlineEdit<string>({` and its `edits: quizEdits,` line with:

```ts
  async function openTitle() {
    if (!quizEdits || titleEdit || deleting || asking || quizEdits.locked) return;
    const edits = quizEdits;
    if (!(await edits.request())) return;
    // R49: re-checked after the D10 question.
    if (!alive || quizEdits !== edits || titleEdit || deleting || asking || edits.locked || !perms.canEditTextFields) return;
    const savedVid = vid;
    titleEdit = new InlineEdit<string>({
      id: 'title',
      edits,
      // The header has no room: the title's D10 question asks in the body-top row (#14).
      asking: bodyAsk,
```

(the rest of the options is unchanged). Replace `attachTitle`:

```ts
  const attachTitle = (el: HTMLInputElement) => {
    el.focus();
    el.select();
    return untrack(() => titleEdit!.attach(el));
  };
```

On the title input replace `readonly={titleEdit.saving}` with `readonly={titleEdit.saving || titleEdit.asking.open}`. The ✎ keeps `onclick={openTitle}`.

The body-top `AskSlot` (Task 2) already draws `bodyAsk`, and `asking` (`bodyAsk.open || pageHere()`) already freezes `div.body-rest` and marks the trash `aria-disabled`.

- [ ] **Step 13: Run them to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/quizEdits.test.ts src/tests/ChoiceAnswers.svelte.test.ts src/tests/KeyAnswer.svelte.test.ts src/tests/QuizStructure.svelte.test.ts src/tests/QuizHeader.svelte.test.ts src/tests/QuizModals.svelte.test.ts src/tests/ItemEditorModal.svelte.test.ts`
Expected: PASS. Every other quiz test already waits with `await settle()` after a click, so the async callers need no other test change.

- [ ] **Step 14: Write the gate rows**

At the end of section (am) add:

```zsh
# Task 5 — the quiz edit slot asks in place (#14, #6, #2).
own ans-ask ChoiceAnswers.svelte
uniq1 ans-ask
if [[ -n $REPLY ]]; then
  N=ChoiceAnswers; H=$REPLY
  # The key question's line under the answer list lines up with "+ Add answer".
  d '\.ans-ask' '' 'margin-top:4px' 'padding-left:8px'
  sweep $N $H
fi
if grep -qF 'async request(id?: string): Promise<boolean>' src/lib/quizEdits.svelte.ts \
   && grep -qF 'async requestStructure(): Promise<boolean>' src/lib/quizEdits.svelte.ts \
   && grep -qF 'ask?(q: Ask): Promise<Answer>;' src/lib/quizEdits.svelte.ts; then
  echo "PASS  quizEdits asks in place: async request / requestStructure, EditHandle.ask (#14)"
else echo "FAIL  quizEdits asks in place: async request / requestStructure, EditHandle.ask (#14)"; fail=1; fi
# Every D10 caller waits for the answer; R49 re-checks follow the await.
qreq=(${(f)"$(grep -nE '(^|[^[:alnum:]_])(request|requestStructure)\(\)' src/components/editor/quiz/*.svelte src/components/editor/ItemEditorModal.svelte | grep -v 'await ')"})
if [[ ${#qreq[@]} -eq 0 ]]; then echo "PASS  every quiz D10 caller awaits request() (#14)"
else echo "FAIL  quiz D10 callers that do not await request(): $qreq"; fail=1; fi
if grep -qF '{#snippet keyMessage()}<strong>Change the answer key?</strong> {KEY_CONFIRM}{/snippet}' src/components/editor/quiz/KeyQuestion.svelte \
   && grep -qF "confirmLabel: 'Change key', tone: 'primary', layout: 'column', confirmDataAction: 'confirm-change-key'" src/components/editor/quiz/KeyQuestion.svelte; then
  echo "PASS  the key question leads with its question; its button is Change key (R52)"
else echo "FAIL  the key question leads with its question; its button is Change key (R52)"; fail=1; fi
if grep -qF "'version instead.';" src/lib/quizEdits.svelte.ts && ! grep -qF 'Continue?' src/lib/quizEdits.svelte.ts; then
  echo "PASS  KEY_CONFIRM ends without \"Continue?\" (R52)"
else echo "FAIL  KEY_CONFIRM ends without \"Continue?\" (R52)"; fail=1; fi
if grep -qF '<AskSlot ask={edit.asking} />' src/components/editor/quiz/InlineInput.svelte \
   && grep -qF '<AskSlot ask={numEdit.asking} />' src/components/editor/quiz/KeyAnswer.svelte \
   && grep -qF '<AskSlot ask={markAsk} />' src/components/editor/quiz/ChoiceAnswers.svelte \
   && grep -qF 'asking: bodyAsk,' src/components/editor/ItemEditorModal.svelte; then
  echo "PASS  the quiz edits' questions are drawn where they belong (#14, #6, #2)"
else echo "FAIL  the quiz edits' questions are drawn where they belong (#14, #6, #2)"; fail=1; fi
if grep -qE '(^|[^.[:alnum:]_])confirm[[:space:]]*\(|(window|globalThis)\.confirm' \
     src/lib/quizEdits.svelte.ts src/components/editor/quiz/KeyAnswer.svelte src/components/editor/quiz/ChoiceAnswers.svelte; then
  echo "FAIL  the quiz edit slot calls no confirm()"; fail=1
else echo "PASS  the quiz edit slot calls no confirm()"; fi
```

`KeyQuestion.svelte` joins `FILES_5D` (`quiz/*.svelte`) by itself, so the 5d emoji and colour scans and the "texts, not copies" check cover it with no new row.

Set `EXPECTED_CHECKS=2191` (`:90`).

Run the gate (Global Constraints). Expected: `ALL PASS (2191 checks)`. To see the `.ans-ask` rows fail first, run it with ChoiceAnswers' `.ans-ask` rule removed: `own`, `uniq1` and `d` fail.

- [ ] **Step 15: Full checks**

Run vitest, svelte-check and the gate (Global Constraints). Expected: vitest green; svelte-check 0 errors, 13 warnings; gate `ALL PASS (2191 checks)`.

- [ ] **Step 16: Screenshots, the user's OK, review lanes, commit**

Screenshots at 1280 wide, dev data on a draft quiz and a published one, every PATCH mocked (held, so the busy state shows):
- a changed answer field's D10 question in place of its ✓ and ✕, Cancel Tab-focused;
- the Number key edit's D10 question in its row;
- the key question under a published Text key field, idle and busy;
- the marker's key question under the answer list;
- the title's D10 question in the body-top row, with the body frozen.

Then the per-task loop: the user's OK, both lanes until clean, commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/lib/quizEdits.svelte.ts \
  frontend/src/components/editor/quiz/KeyQuestion.svelte frontend/src/components/editor/quiz/InlineInput.svelte \
  frontend/src/components/editor/quiz/KeyAnswer.svelte frontend/src/components/editor/quiz/ChoiceAnswers.svelte \
  frontend/src/components/editor/quiz/QuizBody.svelte frontend/src/components/editor/quiz/QuestionCard.svelte \
  frontend/src/components/editor/ItemEditorModal.svelte frontend/scripts/visual-refresh-gate.sh \
  frontend/src/tests/quizEdits.test.ts frontend/src/tests/ChoiceAnswers.svelte.test.ts frontend/src/tests/KeyAnswer.svelte.test.ts \
  frontend/src/tests/QuizStructure.svelte.test.ts frontend/src/tests/QuizHeader.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(polish1): quiz edits ask in place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 6: App and quiz-question removals (#9, #12)

**Files:**
- Modify: `frontend/src/components/editor/item/AppBody.svelte` (imports, `onDestroy` `:28`, `removeApp` `:116-133`, the script row `:156-174`)
- Modify: `frontend/src/components/editor/quiz/QuizBody.svelte` (imports, `onDestroy` `:55`, `remove` (Task 5's), the card loop `:315-327`)
- Modify: `frontend/src/components/editor/quiz/QuestionCard.svelte` (imports, props `:19-29`, markup after `.qhead`, style)
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (am), `EXPECTED_CHECKS`)
- Test: `frontend/src/tests/ItemEditorModal.svelte.test.ts` (`:639-654`), `frontend/src/tests/QuizStructure.svelte.test.ts` (`:299-330`, after Task 5's #14 test)

**Interfaces:**
- Consumes (Tasks 2, 3, 5): `InPlaceAsk`, `Ask`, `AskSlot`, `focusAfter`, `firstUsable`, `settleTo`, `withdraw`; QuizBody's async `remove` and `requestStructure` (Task 5).
- Produces: AppBody's `data-action="app-upload"` / `"app-remove"` and confirm `confirm-remove-app`; QuestionCard's `ask?: InPlaceAsk | null` prop and `div.qask`; confirm `confirm-delete-question`. After this task no `confirm(` call is left in the quiz or app bodies; Task 7 pins that for all of `src`.

- [ ] **Step 1: Write the failing tests**

D42: in #12's first test, also assert that the card's `.qask .inline-confirm` has class `end`. #9 asks in place of its buttons and keeps the start alignment.

In `frontend/src/tests/ItemEditorModal.svelte.test.ts`, in `describe('ItemEditorModal — app body …')`, after `const scriptBtn = …` add:

```ts
  // #9: the remove question, in place of Replace / Remove.
  const scriptAsk = () => panel().querySelector<HTMLElement>('.script-row .inline-confirm');
  const uploadBtn = () => panel().querySelector<HTMLButtonElement>('.script-row [data-action="app-upload"]');
```

Replace `'Remove confirms first: Cancel sends nothing; OK unlinks, reloads and toasts'` with:

```ts
  it('#9: Remove asks in place of Replace / Remove; Cancel sends nothing and returns to Remove; Remove unlinks, reloads and toasts', async () => {
    serve((u) => (u.includes('/assets/') ? Promise.resolve(resp("getElementById('app-root')")) : undefined));
    await render({ item: { type: 'interactive_app', script_url: 'app.js' } });
    scriptBtn('Remove').click();
    await settle();
    const ask = scriptAsk()!;
    expect(ask.querySelector('.warning')!.textContent!.trim()).toBe('Remove the app script? Students will see an empty app.');
    expect(ask.classList.contains('row')).toBe(true);
    expect([...ask.querySelectorAll('button')].map((b) => b.textContent!.trim())).toEqual(['Remove', 'Cancel']);
    expect(ask.querySelector('button.confirm')!.classList.contains('danger')).toBe(true);
    expect(scriptBtn('Replace')).toBeUndefined();
    expect(document.activeElement).toBe(ask.querySelector('button.cancel'));
    ask.querySelector<HTMLButtonElement>('button.cancel')!.click();
    await settle();
    expect(scriptAsk()).toBeNull();
    expect(patchBodies()).toEqual([]);
    expect(document.activeElement).toBe(scriptBtn('Remove'));
    scriptBtn('Remove').click();
    await settle();
    scriptAsk()!.querySelector<HTMLButtonElement>('button.confirm')!.click();
    await settle();
    await settle();
    expect(patchBodies()).toEqual([{ script_url: null }]);
    expect(calls(/\/admin-tree$/).length).toBe(1);
    expect(toastTexts()).toContain('App removed');
    expect(scriptAsk()).toBeNull();
    expect(document.activeElement).toBe(uploadBtn());
  });

  it('#9: while the remove runs, focus is on the busy Remove; a failure shows the error and returns to the first button', async () => {
    let fail!: () => void;
    serve((u, init) => {
      if (u.includes('/assets/')) return Promise.resolve(resp("getElementById('app-root')"));
      if (/\/api\/items\/7$/.test(u) && init?.method === 'PATCH') {
        return new Promise<Response>((r) => { fail = () => r(resp({ detail: 'Nope' }, 422)); });
      }
      return undefined;
    });
    await render({ item: { type: 'interactive_app', script_url: 'app.js' } });
    scriptBtn('Remove').click();
    await settle();
    scriptAsk()!.querySelector<HTMLButtonElement>('button.confirm')!.click();
    await settle();
    const ok = scriptAsk()!.querySelector<HTMLButtonElement>('button.confirm')!;
    expect(document.activeElement).toBe(ok);
    expect(ok.getAttribute('aria-busy')).toBe('true');
    ok.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync();
    expect(scriptAsk()).not.toBeNull();       // Esc is ignored while busy
    fail();
    await settle();
    await settle();
    expect(scriptAsk()).toBeNull();
    expect(panel().querySelector('.field-err')!.textContent).toBe('Nope');
    expect(document.activeElement).toBe(uploadBtn());   // "Replace": the script stayed
    expect(uploadBtn()!.textContent!.trim()).toBe('Replace');
  });

  it('#9 R49: the script going while it asks (a tree reload) withdraws the question; focus goes to Upload', async () => {
    serve((u) => (u.includes('/assets/') ? Promise.resolve(resp("getElementById('app-root')")) : undefined));
    await render({ item: { type: 'interactive_app', script_url: 'app.js' } });
    scriptBtn('Remove').click();
    await settle();
    props.modal.item = mkItem({ type: 'interactive_app', script_url: null });
    await settle();
    expect(scriptAsk()).toBeNull();
    expect(document.activeElement).toBe(uploadBtn());
    expect(uploadBtn()!.textContent!.trim()).toBe('Upload');
    expect(patchBodies()).toEqual([]);
  });
```

In `frontend/src/tests/QuizStructure.svelte.test.ts`, after `const two = …` (`:258`) add:

```ts
  // #12: the delete question under a card's head.
  const cardAsk = (card: HTMLElement) => card.querySelector<HTMLElement>('.qask .inline-confirm');
  async function confirmDelete(i: number, n: number) {
    byName(cards()[i], `Delete question ${n}`)!.click();
    await settle();
    cardAsk(cards()[i])!.querySelector<HTMLButtonElement>('button.confirm')!.click();
    await settle();
    await settle();
  }
```

In `'a delete of a question already deleted elsewhere (404) moves focus to the next card'`, delete `vi.spyOn(window, 'confirm').mockReturnValue(true);` and after `b.click();` add:

```ts
    await settle();
    cardAsk(cards()[1])!.querySelector<HTMLButtonElement>('button.confirm')!.click();
```

Replace `'delete confirms; focus goes to the next card, then the previous, then + Add question'` with:

```ts
  it('#12: delete asks under the card\'s head; Cancel returns to the trash; Delete removes it and focus goes to the next card, then the previous, then + Add question', async () => {
    const s = new QuizServer([q({ id: 1 }), q({ id: 2 }), q({ id: 3 })]);
    await renderQuiz(s);
    byName(cards()[1], 'Delete question 2')!.click();
    await settle();
    const ask = cardAsk(cards()[1])!;
    expect(text(ask.querySelector('.warning'))).toBe('Delete question "Q2"? This cannot be undone.');
    expect(ask.classList.contains('row')).toBe(true);
    expect(text(ask.querySelector('button.confirm'))).toBe('Delete');
    expect(ask.querySelector('button.confirm')!.classList.contains('danger')).toBe(true);
    expect(document.activeElement).toBe(ask.querySelector('button.cancel'));
    ask.querySelector<HTMLButtonElement>('button.cancel')!.click();
    await settle();
    expect(cardAsk(cards()[1])).toBeNull();
    expect(document.activeElement).toBe(byName(cards()[1], 'Delete question 2'));
    expect(cards().length).toBe(3);
    expect(s.writes()).toEqual([]);
    await confirmDelete(1, 2);
    expect(cards().map((c) => c.dataset.qId)).toEqual(['1', '3']);
    expect(document.activeElement).toBe(byName(cards()[1], 'Edit question 2'));
    await confirmDelete(1, 2);
    expect(document.activeElement).toBe(byName(cards()[0], 'Edit question 1'));
    await confirmDelete(0, 1);
    expect(document.activeElement).toBe(addQ());
  });

  it('#12 D39: another card\'s trash moves the question there, with focus on its Cancel', async () => {
    await renderQuiz(new QuizServer([q({ id: 1 }), q({ id: 2 })]));
    byName(cards()[0], 'Delete question 1')!.click();
    await settle();
    expect(document.activeElement).toBe(cardAsk(cards()[0])!.querySelector('button.cancel'));
    byName(cards()[1], 'Delete question 2')!.click();
    await settle();
    expect(cardAsk(cards()[0])).toBeNull();
    expect(document.activeElement).toBe(cardAsk(cards()[1])!.querySelector('button.cancel'));
    expect(panel().querySelectorAll('.inline-confirm').length).toBe(1);
  });

  it('#12: while the delete runs, focus is on the busy Delete; a failure keeps the card and returns to its trash', async () => {
    const s = new QuizServer([q({ id: 1 }), q({ id: 2 })]);
    const hold = s.hold('DELETE', /\/api\/questions\/2$/);
    await renderQuiz(s);
    byName(cards()[1], 'Delete question 2')!.click();
    await settle();
    cardAsk(cards()[1])!.querySelector<HTMLButtonElement>('button.confirm')!.click();
    await settle();
    const ok = cardAsk(cards()[1])!.querySelector<HTMLButtonElement>('button.confirm')!;
    expect(document.activeElement).toBe(ok);
    expect(ok.getAttribute('aria-busy')).toBe('true');
    hold.fail(500, 'Boom');
    for (let i = 0; i < 3; i++) await settle();
    expect(toastTexts()).toEqual(['Boom']);
    expect(cardAsk(cards()[1])).toBeNull();
    expect(cards().length).toBe(2);
    expect(document.activeElement).toBe(byName(cards()[1], 'Delete question 2'));
  });

  it('#12 R57: focus moved away while the delete runs stays there', async () => {
    const s = new QuizServer([q({ id: 1 }), q({ id: 2 })]);
    const hold = s.hold('DELETE', /\/api\/questions\/2$/);
    await renderQuiz(s);
    byName(cards()[1], 'Delete question 2')!.click();
    await settle();
    cardAsk(cards()[1])!.querySelector<HTMLButtonElement>('button.confirm')!.click();
    await settle();
    const elsewhere = byName(panel(), 'Edit title')!;
    elsewhere.focus();
    hold.release();
    for (let i = 0; i < 3; i++) await settle();
    expect(cards().map((c) => c.dataset.qId)).toEqual(['1']);
    expect(document.activeElement).toBe(elsewhere);
  });
```

After Task 5's `'#14: deleting the question that holds a changed edit asks the discard question first, at the edit'` add:

```ts
  it('#14 then #12: on Discard the delete question follows under the card\'s head; its Cancel returns to the trash', async () => {
    const s = two();
    await renderQuiz(s);
    rows(cards()[0])[0].querySelector<HTMLButtonElement>('button.ans-edit')!.click();
    await settle();
    typeInto(cards()[0].querySelector<HTMLInputElement>('input.inline-input')!, 'changed');
    byName(cards()[0], 'Delete question 1')!.click();
    await settle();
    expect(cardAsk(cards()[0])).toBeNull();
    cards()[0].querySelector<HTMLButtonElement>('.inline-row .inline-confirm button.confirm')!.click();
    await settle();
    expect(cards()[0].querySelector('input.inline-input')).toBeNull();
    expect(document.activeElement).toBe(cardAsk(cards()[0])!.querySelector('button.cancel'));
    cardAsk(cards()[0])!.querySelector<HTMLButtonElement>('button.cancel')!.click();
    await settle();
    expect(document.activeElement).toBe(byName(cards()[0], 'Delete question 1'));
    expect(s.writes()).toEqual([]);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/ItemEditorModal.svelte.test.ts src/tests/QuizStructure.svelte.test.ts`
Expected: FAIL — every test that looks for `.script-row .inline-confirm` or `.qask .inline-confirm` (AppBody and QuizBody still call `confirm()`, which jsdom answers falsy). The other tests pass.

- [ ] **Step 3: AppBody — #9 in place of Replace / Remove**

In `frontend/src/components/editor/item/AppBody.svelte`:

Replace `import { onDestroy } from 'svelte';` with:

```ts
  import { onDestroy, untrack } from 'svelte';
  import AskSlot from '../../ui/AskSlot.svelte';
  import { InPlaceAsk, firstUsable, focusAfter, settleTo, withdraw, type Ask } from '../../../lib/askInPlace.svelte';
```

(keep the other imports), and replace

```ts
  let alive = true;
  onDestroy(() => { alive = false; });
```

with

```ts
  let alive = true;
  // #9: the remove asks in place of Replace / Remove (R48: only they freeze).
  const removeAsk = new InPlaceAsk();
  let askedFor: { id: number; vid: number } | null = null;
  let rowEl = $state<HTMLElement>();
  const rowBtn = (a: 'app-upload' | 'app-remove') => rowEl?.querySelector<HTMLElement>(`[data-action="${a}"]`) ?? null;
  onDestroy(() => { alive = false; removeAsk.dismiss(); });
  // R49: another item or version, or the script gone (a tree reload),
  // withdraws an idle question; focus that was in it goes to Upload.
  $effect(() => {
    const id = item?.id;
    const v = vid;
    const has = !!item?.script_url;
    untrack(() => {
      if (!removeAsk.open || removeAsk.busy || !askedFor) return;
      if (id === askedFor.id && v === askedFor.vid && has) return;
      const free = removeAsk.focusFree;
      removeAsk.dismiss();
      if (free) void focusAfter(() => rowBtn('app-upload'));
    });
  });
```

Replace `removeApp`:

```ts
  async function removeApp() {
    if (uploadBusy || frozen || !item?.script_url) return;
    const itemId = item.id;
    const savedVid = vid;
    const q: Ask = {
      warning: 'Remove the app script? Students will see an empty app.',
      confirmLabel: 'Remove', tone: 'danger', layout: 'row', confirmDataAction: 'confirm-remove-app',
    };
    askedFor = { id: itemId, vid: savedVid };
    const a = await removeAsk.ask(q);
    if (a === 'cancel') { void focusAfter(() => rowBtn('app-remove')); return; }
    if (a !== 'confirm') return;
    // R49: re-checked after the question.
    if (!alive || uploadBusy || frozen || item?.id !== itemId || vid !== savedVid || !item.script_url) {
      withdraw(removeAsk, q, () => firstUsable(rowBtn('app-remove'), rowBtn('app-upload')));
      return;
    }
    uploadBusy = true;
    uploadError = null;
    try {
      await api.patch(`/api/items/${itemId}`, { script_url: null });
      if (stillOnVid(savedVid)) await loadAdminTree(savedVid, { force: true });
      if (alive) warnings = [];
      pushToast('App removed', 'success');
    } catch (err) {
      if (alive) uploadError = err instanceof ApiError ? err.displayMessage : 'Remove failed.';
    } finally {
      if (alive) uploadBusy = false;
      // R54: the question leaves once the request settles; then the first
      // button — Upload, or Replace after a failure.
      await settleTo(removeAsk, q, () => rowBtn('app-upload'));
    }
  }
```

Replace the script row (`<div class="script-row">` … `</div>`) with:

```svelte
    <div class="script-row" bind:this={rowEl}>
      <span class="mono script-name" class:none={!item.script_url}>{item.script_url ?? 'No script'}</span>
      {#if editable}
        <input
          bind:this={fileEl}
          type="file"
          accept=".js,application/javascript"
          hidden
          disabled={uploadBusy || frozen}
          onchange={onFileChosen}
        />
        {#if removeAsk.open}
          <AskSlot ask={removeAsk} />
        {:else}
          <Button variant="secondary" data-action="app-upload" disabled={uploadBusy || frozen} onclick={() => fileEl?.click()}>
            {item.script_url ? 'Replace' : 'Upload'}
          </Button>
          {#if item.script_url}
            <Button variant="ghost" data-action="app-remove" disabled={uploadBusy || frozen} onclick={() => void removeApp()}>Remove</Button>
          {/if}
        {/if}
      {/if}
    </div>
```

Update the header comment's second sentence to: "The App script row acts immediately (files, not drafts); its Remove asks in place of the row's buttons (Polish 1 #9)."

- [ ] **Step 4: QuestionCard draws the card's question**

In `frontend/src/components/editor/quiz/QuestionCard.svelte`:

Add to the imports:

```ts
  import AskSlot from '../../ui/AskSlot.svelte';
  import type { InPlaceAsk } from '../../../lib/askInPlace.svelte';
```

In the props, after `autoAdd = false, onAutoAddDone = () => {},` add `ask = null,`, and in the type after `autoAdd?: boolean; onAutoAddDone?: () => void;` add:

```ts
    // #12: QuizBody's one question for its cards; drawn here when it is about this card.
    ask?: InPlaceAsk | null;
```

After the `.qhead` div's closing `</div>` add:

```svelte
  {#if ask && ask.current?.key === q.id}
    <div class="qask"><AskSlot {ask} /></div>
  {/if}
```

At the end of `<style>` (before the `@media` line) add:

```css
  /* Under the head, on the answers' left edge. */
  .qask { padding: 0 12px 8px 38px; }
```

- [ ] **Step 5: QuizBody — #12 asks under the card's head**

In `frontend/src/components/editor/quiz/QuizBody.svelte`:

Add to the imports:

```ts
  import { InPlaceAsk, focusAfter, settleTo, withdraw, type Ask } from '../../../lib/askInPlace.svelte';
```

Replace `onDestroy(() => { alive = false; loadToken++; });` with:

```ts
  // #12: one question for the cards, keyed by question id: another card's
  // trash moves it there (D39). QuestionCard draws it under its head.
  const cardAsk = new InPlaceAsk();
  let askedIds: number[] = [];   // the list when it asked: the nearest card if its own goes
  onDestroy(() => { alive = false; loadToken++; cardAsk.dismiss(); });
```

After `fallbackTarget`/`focusFallback` add:

```ts
  // The nearest card still listed after `qid`, else before it, in `ids`' order.
  function nearOf(qid: number, ids: number[]): number | null {
    const i = ids.indexOf(qid);
    const left = (id: number) => questions.some((x) => x.id === id);
    return ids.slice(i + 1).find(left) ?? ids.slice(0, i).reverse().find(left) ?? null;
  }
  // R49: a card leaving the list (a resync, a 404) takes its question, busy or
  // not — the card was its host. Focus that was in it goes to the nearest card.
  $effect(() => {
    const list = questions;
    untrack(() => {
      const k = cardAsk.current?.key;
      if (typeof k !== 'number' || list.some((x) => x.id === k)) return;
      const free = cardAsk.focusFree;
      cardAsk.dismiss();
      if (free) void focusFallback(nearOf(k, askedIds));
    });
  });
```

Replace the whole `// ---- Delete: confirms (D14) ----` section (Task 5's `remove`) with:

```ts
  // ---- Delete: asks under the card's head (D14, #12) ----
  async function remove(qid: number) {
    if (quizLock || busyQuestions.has(qid) || !questions.some((x) => x.id === qid)) return;
    if (!(await edits.requestStructure())) return;   // D10 first (#14); deletes follow their locks alone
    let idx = questions.findIndex((x) => x.id === qid);
    if (quizLock || busyQuestions.has(qid) || !live() || idx < 0) return;
    // Inert parse (no image loads), so entities read as characters.
    const plain = new DOMParser().parseFromString(questions[idx]!.text_html, 'text/html').body.textContent ?? '';
    const title = plain.replace(/\s+/g, ' ').trim().slice(0, 80) || `Question ${idx + 1}`;
    const trash = () => rootEl?.querySelector<HTMLElement>(`[data-q-id="${qid}"] .qhead button[data-glyph="trash"]`) ?? null;
    const q: Ask = {
      key: qid, warning: `Delete question "${title}"? This cannot be undone.`,
      confirmLabel: 'Delete', tone: 'danger', layout: 'row', align: 'end', confirmDataAction: 'confirm-delete-question',
    };
    askedIds = questions.map((x) => x.id);
    const a = await cardAsk.ask(q);                 // … then the delete question (#12)
    if (a === 'cancel') { void focusAfter(trash); return; }
    if (a !== 'confirm') return;
    // R49: re-checked, and the index recomputed, after the question.
    idx = questions.findIndex((x) => x.id === qid);
    if (quizLock || busyQuestions.has(qid) || !live() || idx < 0 || !perms.canEditStructure) {
      withdraw(cardAsk, q, trash);
      return;
    }
    const ids = questions.map((x) => x.id);
    quizLock = true;
    busyQuestions.add(qid);
    deletingId = qid;
    try {
      await edits.track(deleteQuestion(qid));
      if (!live()) return;
      // R54: the card goes, and its question with it, so the question settles
      // first; focus moves on only if it was in the question (R57).
      const free = cardAsk.focusFree;
      if (cardAsk.current === q) cardAsk.settle();
      questions = questions.filter((x) => x.id !== qid);
      if (stillOnVid(savedVid)) void loadAdminTree(savedVid, { force: true });
      if (free) void focusFallback(ids[idx + 1] ?? ids[idx - 1] ?? null);
    } catch (e) {
      pushToast(failed(e, qid), 'error');
      if (live()) {
        await resync();
        await tick();
        // Gone already (deleted elsewhere): the R49 effect took the question and
        // its focus. This repairs only a drop, over the cards left.
        if (live() && dropped()) fallbackTarget(questions.some((x) => x.id === qid) ? qid : nearOf(qid, ids))?.focus();
      }
    } finally {
      busyQuestions.delete(qid);
      if (alive) { quizLock = false; deletingId = null; }
      // A failure keeps the card: back to its trash once enabled (R54).
      await settleTo(cardAsk, q, trash);
    }
  }
```

In the card loop, add `ask={cardAsk}` to `<QuestionCard …>` (after `onAutoAddDone={…}`).

- [ ] **Step 6: Run them to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/ItemEditorModal.svelte.test.ts src/tests/QuizStructure.svelte.test.ts src/tests/QuizModals.svelte.test.ts src/tests/ChoiceAnswers.svelte.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the gate rows**

At the end of section (am) add:

```zsh
# Task 6 — the app script and quiz-question removals (#9, #12).
own qask QuestionCard.svelte
uniq1 qask
if [[ -n $REPLY ]]; then
  N=QuestionCard; H=$REPLY
  # On the answers' left edge (.qanswers pads 38px), under the card's head.
  d '\.qask' '' 'padding:0 12px 8px 38px'
fi
if grep -qF '<AskSlot ask={removeAsk} />' src/components/editor/item/AppBody.svelte \
   && grep -qF 'data-action="app-upload"' src/components/editor/item/AppBody.svelte \
   && grep -qF 'data-action="app-remove"' src/components/editor/item/AppBody.svelte; then
  echo "PASS  AppBody's Remove asks in place of the row's buttons; its focus targets carry data-action (#9)"
else echo "FAIL  AppBody's Remove asks in place of the row's buttons; its focus targets carry data-action (#9)"; fail=1; fi
if grep -qF 'ask={cardAsk}' src/components/editor/quiz/QuizBody.svelte \
   && grep -qF "confirmDataAction: 'confirm-delete-question'" src/components/editor/quiz/QuizBody.svelte \
   && grep -qF '<div class="qask"><AskSlot {ask} /></div>' src/components/editor/quiz/QuestionCard.svelte; then
  echo "PASS  a quiz question's delete asks under its card's head (#12)"
else echo "FAIL  a quiz question's delete asks under its card's head (#12)"; fail=1; fi
if grep -qE '(^|[^.[:alnum:]_])confirm[[:space:]]*\(|(window|globalThis)\.confirm' \
     src/components/editor/item/AppBody.svelte src/components/editor/quiz/QuizBody.svelte; then
  echo "FAIL  AppBody and QuizBody call no confirm()"; fail=1
else echo "PASS  AppBody and QuizBody call no confirm()"; fi
```

AppBody and the quiz files are already in the 5b and 5d emoji and colour scans, so no scan row is added.

Set `EXPECTED_CHECKS=2197` (`:90`).

Run the gate (Global Constraints). Expected: `ALL PASS (2197 checks)`. To see the `.qask` rows fail first, run it with QuestionCard's `.qask` rule removed: `own`, `uniq1` and `d` fail.

- [ ] **Step 8: Full checks**

Run vitest, svelte-check and the gate (Global Constraints). Expected: vitest green; svelte-check 0 errors, 13 warnings; gate `ALL PASS (2197 checks)`.

- [ ] **Step 9: Screenshots, the user's OK, review lanes, commit**

Screenshots at 1280 wide, dev data, every PATCH and DELETE mocked (held, so the busy state shows):
- an interactive-app item: the Remove question in place of Replace / Remove, idle and busy;
- a quiz: the delete question under a card's head, Cancel Tab-focused; the same question moved to another card (D39).

Then the per-task loop: the user's OK, both lanes until clean, commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/components/editor/item/AppBody.svelte \
  frontend/src/components/editor/quiz/QuizBody.svelte frontend/src/components/editor/quiz/QuestionCard.svelte \
  frontend/scripts/visual-refresh-gate.sh frontend/src/tests/ItemEditorModal.svelte.test.ts frontend/src/tests/QuizStructure.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(polish1): app script and quiz question removals ask in place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 7: No pop-ups left

**Files:**
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (am), `EXPECTED_CHECKS`)
- Modify: `docs/backlog/polish1-confirms-debt.md` (created in Task 1; three sections at the end)
- Modify: `docs/backlog/slice6a-teacher-restyle-debt.md` (`:121-122`), `docs/backlog/slice6c-teacher-overview-roster-panel-debt.md` (`:100-102`)

**Interfaces:**
- Consumes (Tasks 1-6): every converted site; DangerConfirm's `force()` (Task 1); the reworded `editorReasons.ts` comment (Task 2).
- Produces: two gate checks that keep `confirm()` out of `src` and its spies out of the tests; the Polish 1 backlog's Safari list, which the whole-branch review and the Safari pass write into.

- [ ] **Step 1: Look for any `confirm(` left in `src`**

Run the spec's check:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && grep -rnE '(^|[^.[:alnum:]_])confirm[[:space:]]*\(|(window|globalThis)\.confirm' src --include='*.svelte' --include='*.ts' --exclude-dir=tests --exclude='*.test.ts'
```

Expected: no output, exit 1. Before this plan it printed 23 lines: the 21 call sites, DangerConfirm's `async function confirm()` (renamed `force()` in Task 1) and the `editorReasons.ts:41` comment (reworded in Task 2). A line here means a task missed a site. Convert it as the owning task does for its neighbours, and ledger a ruling.

- [ ] **Step 2: Look for any `confirm` spy left in the tests**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && grep -rnE "spyOn\((window|globalThis), 'confirm'\)|(window|globalThis)\.confirm" src/tests
```

Expected: no output, exit 1. Before this plan it printed 58 lines in 14 files; Tasks 2-6 rewrite each one to answer the question in place. A line here means a test still answers a pop-up nobody shows: rewrite it to click the question's `button.confirm` / `button.cancel`, as its file's neighbours do.

- [ ] **Step 3: Write the gate rows**

At the end of section (am) add:

```zsh
# Task 7 — no pop-ups left (spec §Gate): no confirm() anywhere in src, no
# confirm spy in the tests. The close-tab warning (beforeunload) is no confirm().
cfl=(${(f)"$(grep -rnE '(^|[^.[:alnum:]_])confirm[[:space:]]*\(|(window|globalThis)\.confirm' src --include='*.svelte' --include='*.ts' --exclude-dir=tests --exclude='*.test.ts')"})
if [[ ${#cfl[@]} -eq 0 ]]; then echo "PASS  no confirm() call anywhere in src (Polish 1)"
else echo "FAIL  confirm() calls left in src: $cfl"; fail=1; fi
cft=(${(f)"$(grep -rnE "spyOn\((window|globalThis), 'confirm'\)|(window|globalThis)\.confirm" src/tests)"})
if [[ ${#cft[@]} -eq 0 ]]; then echo "PASS  no test answers a confirm() pop-up (Polish 1)"
else echo "FAIL  tests still spy on confirm(): $cft"; fail=1; fi
```

Set `EXPECTED_CHECKS=2199` (`:90`).

Run the gate (Global Constraints). Expected: `ALL PASS (2199 checks)`. To see the first row fail, add `const x = () => confirm('probe');` to the end of the `<script>` in `frontend/src/components/ui/AskSlot.svelte`, run the gate (`FAIL  confirm() calls left in src: …AskSlot.svelte…`), then remove the line and run it again.

- [ ] **Step 4: The Polish 1 backlog, and the items it closes**

`docs/backlog/polish1-confirms-debt.md` exists since Task 1, with each task's minors under its own `## Task N` heading. Under its first line add:

```markdown
Spec: `docs/superpowers/specs/2026-10-14-visual-refresh-polish1-confirms-design.md`.
Plan: `docs/superpowers/plans/2026-10-14-visual-refresh-polish1-confirms.md`.
```

Then add at the end of the file:

```markdown
## Carried to the Safari pass (spec §Carried to the Safari pass)

One step at a time, every write mocked, no VoiceOver step.

- **The look:** hover and focus fills and the focus ring in Safari, also in a modal footer (a mouse click shows no ring; Tab skips buttons by default); the danger panel's colours, and the unarmed Force delete's label at 12px.
- **Back with unsaved work:** the address bar shows the target while the question is open and comes back on Cancel; Back twice while asking, and a link then Back while asking; a dirty New question modal + Back asks in that modal's footer.
- **The item modal and quiz edits:** the item modal's × on an in-page item with a dirty quiz edit, and × again while asking; scroll-into-view of a question in another quiz card.
- **The page row:** Cancel brings you back where you were (keyboard); a toast does not cover it; the settings button is blocked while it asks; after a mouse click on a header, Cancel scrolls back.
- **Clicks:** a double-click on a trigger whose question appears under the pointer (R50); a click on another row's trash moves the question (D39).

## For the VoiceOver pass at beta

- Each question group is named by its text ("Delete block "Vectors"? This cannot be undone., group") before its buttons; the key question reads its bold lead and the warning as one name (R52).
- A busy confirm announces busy (`aria-busy`), and Cancel is announced as unavailable while it runs.

## Polish 2 / Polish 3 candidates (spec §Scope, "Not in")

- The error banners keep `--status-rejected-*`; beside the danger panel there are two pinks. Aligning them with the panel tokens is a Polish 3 candidate.
- VersionsPage's create form: Cancel and in-app links discard silently; only Esc asks. A guard there is a Polish 3 candidate.
- The global focus halo on other Button variants (`base.css:22-26`) stays until Polish 2 takes it with the forced-colors ring.
```

In `docs/backlog/slice6a-teacher-restyle-debt.md`, at the end of the `- **One way to confirm a delete: in place, everywhere.**` item (`:122`) add:

```markdown
  **Done in Polish 1** (`docs/superpowers/plans/2026-10-14-visual-refresh-polish1-confirms.md`): all 21 `confirm()` sites ask in place; only `beforeunload` stays the browser's.
```

In `docs/backlog/slice6c-teacher-overview-roster-panel-debt.md`, at the end of the `- **FIRST ITEM: confirms as real small buttons, and a crimson danger red.**` item (`:102`) add:

```markdown
  **Done in Polish 1** (`docs/superpowers/plans/2026-10-14-visual-refresh-polish1-confirms.md`, Task 1).
```

- [ ] **Step 5: Full checks**

Run vitest, svelte-check and the gate (Global Constraints). Expected: vitest green; svelte-check 0 errors, 13 warnings; gate `ALL PASS (2199 checks)`.

- [ ] **Step 6: The user's OK, review lanes, commit**

No screenshots: this task changes no screen. Then the per-task loop: the user's OK, both lanes until clean, commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/scripts/visual-refresh-gate.sh \
  docs/backlog/polish1-confirms-debt.md docs/backlog/slice6a-teacher-restyle-debt.md docs/backlog/slice6c-teacher-overview-roster-panel-debt.md
git commit -m "$(cat <<'EOF'
chore(polish1): no confirm() pop-ups left; the Polish 1 backlog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


### Task 8: Secondary buttons look like the confirm's primary action (D44)

Added after Task 7 at the user's request (spec rev 13, D44). The gate is at **2201** (Task 7, with the D43 shift).

**Files:**
- Modify: `frontend/src/components/ui/Button.svelte` (the `.secondary` rule in `<style>`)
- Modify: `frontend/scripts/visual-refresh-gate.sh` (the Button block in section (am), `EXPECTED_CHECKS`)
- Modify: `docs/backlog/polish1-confirms-debt.md` (one line in "## Carried to the Safari pass")

**Interfaces:**
- Consumes (Task 1): the tokens `--primary`, `--primary-text`, `--primary-press`, `--surface`; Button's state guard `:not(:disabled):not(.blocked):not([aria-busy="true"])`; the gate's Button block (`uniq1 btn`, `BT`, `d`, `none`, `hover_only Button`).
- Produces: nothing new for code. The 23 `variant="secondary"` call sites keep their markup.

- [ ] **Step 1: Write the failing gate rows**

In section (am), in the Button block (`# Button danger (D34 at page size)…`), after the line `none "Button .danger fills only an enabled, idle button" …` and before `hover_only Button $H`, add:

```zsh
  # D44 (Task 8): secondary = the confirm's primary action at page size.
  d '\.secondary' '' 'background:var\(--surface\)' 'color:var\(--primary\)' 'border-color:var\(--primary\)'
  d '\.secondary' "${BT}:hover" 'background:var\(--primary\)' 'color:var\(--primary-text\)'
  d '\.secondary' "${BT}:focus-visible" 'background:var\(--primary\)' 'color:var\(--primary-text\)'
  d '\.secondary' "${BT}:active" 'background:var\(--primary-press\)' 'border-color:var\(--primary-press\)' 'color:var\(--primary-text\)'
  d '\.secondary' ':focus-visible' 'outline:2px solid var\(--primary\)' 'outline-offset:2px' 'box-shadow:none'
  none "Button .secondary fills only an enabled, idle button" "\.secondary\.${H}:((hover|active)\{|focus-visible\{[^}]*background)"
```

`hover_only Button $H` (already there) then also covers the new `:hover` rule: it must sit inside `@media (hover: hover)`.

Set `EXPECTED_CHECKS=2215` (`:90`): 13 `d` checks and one `none`.

Run the gate (Global Constraints). Expected: FAIL — the rest row (today `color:var(--text-3)`, `border-color:var(--border-strong)`) and every state row; `ALL PASS` is not printed.

- [ ] **Step 2: Button `.secondary` — the primary action states**

In `frontend/src/components/ui/Button.svelte`, replace

```css
  .secondary { background: var(--surface); color: var(--text-3); border-color: var(--border-strong); }
```

with

```css
  /* D44: the confirm's primary action at page size — outlined at rest, filled
     on hover (pointer devices) and on keyboard focus, darker while pressed.
     Disabled, blocked and busy keep their looks. Kept apart from the .danger
     rules: the minifier merges adjacent identical rules (the two rings). */
  .secondary { background: var(--surface); color: var(--primary); border-color: var(--primary); }
  @media (hover: hover) {
    .secondary:not(:disabled):not(.blocked):not([aria-busy="true"]):hover { background: var(--primary); color: var(--primary-text); }
  }
  .secondary:not(:disabled):not(.blocked):not([aria-busy="true"]):focus-visible { background: var(--primary); color: var(--primary-text); }
  .secondary:not(:disabled):not(.blocked):not([aria-busy="true"]):active { background: var(--primary-press); border-color: var(--primary-press); color: var(--primary-text); }
  .secondary:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; box-shadow: none; }
```

The `.ghost` rule stays between these and the `.danger` rules, so the two focus rings never sit side by side in the built CSS.

- [ ] **Step 3: Run the gate to verify it passes**

Run the gate. Expected: `ALL PASS (2215 checks)`. If the `.danger` ring pin (`d '\.danger' ':focus-visible' …`) fails, the minifier merged the two rings: check the order in Step 2.

- [ ] **Step 4: The Safari list**

In `docs/backlog/polish1-confirms-debt.md`, in "## Carried to the Safari pass", at the end of the **The look** item add:

```markdown
  A secondary Button (D44) at rest, hovered, pressed and Tab-focused, beside a filled primary (the player's Previous / Next, the version bar).
```

- [ ] **Step 5: Full checks**

Run vitest, svelte-check and the gate (Global Constraints). Expected: vitest green (2408, unchanged: `Button.svelte.test.ts` checks the class, not the colours); svelte-check 0 errors, 13 warnings; gate `ALL PASS (2215 checks)`.

- [ ] **Step 6: Screenshots, the user's OK, review lanes, commit**

Screenshots at 1280 wide, dev data, writes held. Each one shows a secondary at rest beside the same button hovered (mouse) and Tab-focused:
- the version bar of a published version (Archive / Revert beside the filled Publish or the ghost Disable);
- a Teaching screen (the Roster tab's secondary button);
- a modal footer with a secondary (e.g. RosterImportModal or PublishConflictsModal);
- the student player: Previous beside the filled Next;
- one disabled secondary (the player's Previous on the first item), to show the disabled look is unchanged.

Then the per-task loop: the user's OK, both lanes until clean, commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/components/ui/Button.svelte \
  frontend/scripts/visual-refresh-gate.sh docs/backlog/polish1-confirms-debt.md
git commit -m "$(cat <<'EOF'
feat(polish1): secondary buttons look like the confirm's primary action

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

After Task 8: the whole-branch review (fresh Opus + Fable on `main..HEAD`), then the Safari pass from the backlog's list, one step at a time.

