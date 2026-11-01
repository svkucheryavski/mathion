# Polish 3: the reviewers' minors that users meet — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fix the deferred Minor findings that a student, teacher or author actually meets before the beta. Students keep their quiz answers while moving around, and in-app links stay in the app. Focus no longer falls to `<body>` after an action. The visual stragglers are aligned. A handful of behaviour and backend gaps close.

**Architecture:**
- **Student quiz (Task 1).** `ItemRouter` keys its branch on `item.id`, so every item gets its own component. A new `stores/quizDrafts.svelte.ts` mirrors each quiz's unsubmitted answers per item and owner, and warns on unload while one holds answers. `recordQuizAttempt` writes a submit's attempt count into the course store.
- **Links (Task 2).** `routeClick` in the router lets modifier and middle clicks through at every site that has its own click handler. A new `lib/linkRouter.ts` installs one bubble-phase document listener, from `App.svelte`, that routes every other plain same-origin Mathion link.
- **Focus (Tasks 3, 4).** Task 3 builds the primitives:
  - `canHoldFocus` and `repairFocus` in `askInPlace.svelte.ts`;
  - `focusFirst` rewritten on `usable`;
  - FocusTrap: autofocus that skips unusable targets, and a last-press opener record (`lib/pressRecorder.ts`);
  - Modal: `isTopModal` and the `<body>` key backstop;
  - the item modal's footer: busy is `loading`, clean is `aria-disabled`.

  Task 4 applies them at the remaining sites F1, F2, F4 and F6–F12.
- **Look (Tasks 5–7).** Task 5 is the token-level changes, Task 6 the student and content screens, Task 7 the teacher screens and their loading state.
- **Behaviour (Task 8)** and **backend (Task 9)** follow the spec's §Behaviour, §Course files and C9–C11.

**Tech Stack:**
- **Frontend:** Svelte 5.55, runes only; Vitest + jsdom with `mount` / `unmount` / `flushSync`.
- **Gate:** the zsh gate `frontend/scripts/visual-refresh-gate.sh`, graded against `dist`.
- **Backend:** FastAPI + Pydantic, Starlette 1.0 `FileResponse`, markdown-it-py + nh3; pytest via `backend/.venv`. No new npm or pip packages.

**Spec:** `docs/superpowers/specs/2026-10-31-visual-refresh-polish3-minors-design.md`. Rev 4 (`23f8afb`) was approved by the user on 2026-10-31; rev 5 (`9a12964`) adds D88 and the 400px results. Its decisions D82–D88 and calls C1–C19 are binding; this plan cites them by name and does not repeat their reasoning. Recon: `$SDD/inventory.html`; 400px shots: `$SDD/shots-400.html`.

**Line numbers** are from `9a12964`. An earlier task shifts them in files it also touches; find the place by the quoted text.

## Global Constraints

- **Branch:** `feat/visual-refresh-polish3-minors` (off the Polish 2 tip `71dd8cc`). LOCAL only: never push, never merge.
- **Directory:** never leave `/Users/svkucheryavski/Documents/Developing/mathion`; absolute `cd` only, never `cd ..`. Scratch goes in `$SDD` = `/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-31-visual-refresh-polish3-minors`: probes in `probe/`, gate temp files and logs in `tmp/`, screenshots in `shots/`. Never use `/tmp`. Tell every subagent the same.
- **Code style:**
  - Svelte 5 runes only; no new npm or pip dependencies.
  - Component tests use `mount` / `unmount` / `flushSync` from `svelte`, never `@testing-library/svelte`.
  - Python, pytest and alembic only through `backend/.venv`.
  - Match the surrounding comment density. A comment may carry the decision tag (`D83`, `C13`, `F3`), never "added in Polish 3".
- **Colours:** theme tokens only (`src/styles/theme-default.css`); no literal colours in components; no `opacity` to dim.
- **Pinned CSS rules are single-selector blocks** (the gate's `d` helper matches `.cls.svelte-HASH{…}`). The gate's markup scanner runs inside `node -e '…'`: no apostrophe in that payload, comments included.
- **Focus vocabulary** (spec §The mechanism):
  - **blocked** = `aria-disabled`: looks disabled, keeps focus, the handler returns;
  - **busy** = `loading`: keeps its variant look, shows the spinner, `aria-busy`, the handler returns;
  - **native `disabled`** only for "unavailable for another reason". It drops focus.
- **Narrow screens (D82, D88):** 400px matters only for Login, the course list, the course page, the player, the mini-project page and the 404. Authoring and teaching screens are laptop-only: never plan, fix or shoot them at 400px.
- **Commands** (write `$SDD` out in full when you run them):
  - **Frontend tests:**
    ```
    cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run > $SDD/tmp/vitest.log 2>&1; echo "exit $?"; tail -5 $SDD/tmp/vitest.log; grep -cE "^ *Errors +[0-9]|Unhandled (Rejection|Error)" $SDD/tmp/vitest.log
    ```
    Green = `exit 0` AND the last count `0`. One file: `TZ=Europe/Copenhagen npx vitest run src/tests/<File>`.
  - **Typecheck:**
    ```
    cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx svelte-check --threshold error > $SDD/tmp/svelte-check.log 2>&1; tail -3 $SDD/tmp/svelte-check.log
    ```
    0 errors. Record the warning count at Task 1 start as the baseline; no task may add one.
  - **Gate:**
    ```
    cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TMPDIR=$SDD/tmp zsh scripts/visual-refresh-gate.sh > $SDD/tmp/gate.log 2>&1; echo "exit $?"; grep -E "^FAIL" $SDD/tmp/gate.log; tail -1 $SDD/tmp/gate.log
    ```
    It must end `VISUAL-REFRESH GATE: ALL PASS (N checks)`. Never run it in two lanes at once.
  - **Backend:** `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q`.
  - If a pinned row fails only because the minifier wrote a value differently, match the emitted form (`grep -oE '\.CLASS\.svelte-[a-z0-9]+[^{]*\{[^}]*\}' dist/_app/*.css`) and ledger a ruling. Never loosen a row to pass. Dist wins over a planned hash; ledger both values.
- **Testing CSS** (spec §Testing): jsdom sees neither layout nor the cascade. For CSS the gate row is the red/green: written first, run red against the old build, then green. jsdom tests pin only what jsdom can see (classes, attributes, markup).
- **Per task, in this order** (the user's loop; it overrides "continuous execution"):
  1. TDD, step by step as written.
  2. vitest green, svelte-check (0 errors, baseline warnings), the gate (the new N); for Task 9 the backend suite.
  3. agent-browser shots of the screens the task names. Use 1280 wide, plus 400 wide for a student screen (D88). Show them in an agterm overlay (`--size-percent 60`, base64 images, the HTML in `$SDD`), then get the user's OK on the look.
  4. Two review lanes on the UNCOMMITTED diff: Opus (high effort) and Fable. Fix every Critical and Important, then re-run both lanes after EVERY fix until both are clean. Push back on a wrong finding with evidence. Minors go to `docs/backlog/polish3-minors-debt.md` (created in Task 1) under the task's heading. Never edit the tree while a lane reviews.
  5. With the user's commit OK: a docs commit (spec/plan amendments, backlog edits) and the code commit. Use exact paths (never `git add -A`) and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, with no session line.
  6. A ledger line in `$SDD/progress.md`, a memory update, then WAIT for the user's "go".
- **Dev servers and the browser** (already running; never start a second copy):
  - backend uvicorn on :8000 (`MATHION_DEBUG=1 MATHION_ASSET_PATH="$HOME/mathion-assets"`, `--reload`);
  - vite on `http://localhost:5174`;
  - agent-browser session `p3-admin`, signed in as `dev@mathion.test` (course admin, enrolled student of Demo Course, and sees run 8).
  - Every shot goes through `$SDD/probe/shot.sh <session> <name> <url|->`. It checks the write guard (`$SDD/probe/guard.js`, `window.__p2`) before shooting and prints `sw=` (page scroll width) and `blocked=`. Before ANY click in a script: `G=$(agent-browser --session p3-admin eval "(() => typeof window.__p2)()" | tail -1); [ "$G" = '"object"' ] || exit 1`.
  - The guard blocks every non-GET call except the two sign-in calls. A state that needs a write is mocked with `agent-browser network route` or reached read-only. Never write shared dev data without the user's yes; no real quiz submits.
  - Dev rows to delete at slice end: `login_pins` id 39, `sessions` id 40.

## Rulings made while planning

Each states what it costs if wrong. P-numbers continue from Polish 2's P116.

- **P117 — Nine tasks, not the spec's suggested six.** Quiz drafts and links split (Task 1 / Task 2); the focus work splits into primitives (Task 3) and sites (Task 4); the look splits by surface (Tasks 5, 6, 7). A reviewer can reject each one alone. *Cost:* three more review cycles.
- **P118 — `recordQuizAttempt(res)` copies `attempt_count`, `max_attempts`, `last_score` (`{correct: res.score_correct, total: res.score_total}`) and `is_covered = true`.** The response carries no answers, so `last_answers` is left alone. It replaces QuizItem's `markItemCovered(res.item_id)` call; `markItemCovered` stays for its other callers. Bonus: the course page's quiz chip is current after a submit. *Cost:* none.
- **P119 — The unload warning is one `beforeunload` listener that the drafts module adds on its first write and keeps.** It warns only while `hasUnsavedDrafts()`. This is the spec's second form, chosen because it needs no add/remove bookkeeping. *Cost:* one idle listener per session.
- **P120 — The two plain course-page links (`MiniProjectLink`, `CourseDeadlines`) do not adopt `routeClick`.** The app-wide handler routes them, so their SIG rows stay. *Cost:* none; the handler's test covers both.
- **P121 — The link router and the press recorder are module-level and idempotent.** `installLinkRouter()` is called from an `App.svelte` `$effect` and ref-counts its one listener (jsdom mounts App repeatedly). `ensurePressRecorder()` is called from FocusTrap's module script and registers once per document. *Cost:* none.
- **P122 — F13 uses the last-press record, not `returnTo` props.** Fall back to `returnTo` only if Task 3's tests show the record unreliable; ledger it if so. *Cost:* the fallback touches six openers.
- **P123 — A "modal panel itself" in `repairFocus` means `document.activeElement.matches('section.modal-panel')`.** That is the Modal panel's own element, which is focusable through `tabindex="-1"`. *Cost:* none.
- **P124 — The new `.sp-error` gate row and all other Polish 3 rows go in a new gate section `(ao) Polish 3 — minors`,** before the summary line; each task appends to it. Changed existing rows stay in place. *Cost:* none.
- **P125 — The gate gains one source-scan row in Task 2:** no file under `src/` (tests aside) contains `preventDefault();` followed by `navigate(`, on one line or across lines. The scan reads each file whole (`perl -0777`, pattern `preventDefault\(\);?\s*(?:(?:void|await|return)\s+)?navigate\(`); a line-based grep missed the two-line form (Task 2 review). A second count asserts that `grep -rEn 'function go\(e' src` finds nothing, since the three `go(e, href)` helpers are deleted. That makes the click-helper sweep complete and keeps it so. *Cost:* a future hand-rolled handler reds the gate, which is the point.

## Review Focus

The inputs most likely to bite a student, teacher or author that the spec's own test lists do not name. Each has its test in the owning task.

1. **A click on a nested element inside a link, or a keyboard-activated link** (Enter fires `click` with `detail: 0`, e.g. on `<a><strong>…</strong></a>` in authored content): it routes in-app like a mouse click. Test: Task 2, `routes a click on a child of the link and an Enter-activated click`.
2. **A multi-choice quiz with every box unticked again** (`[]`): the draft is dropped and the leave-page warning goes off. Test: Task 1, `an emptied multi-choice answer drops the draft and the unload warning`.
3. **A run whose start and end are the same day:** allowed in both edit directions. Test: Task 9, `test_patch_same_day_start_and_end_is_allowed`.
4. **A course file whose name has an upper-case extension** (`Report.PDF`): inline is decided by the stored MIME type, not the name. Test: Task 9, `test_pdf_with_uppercase_extension_is_inline`.
5. **The user moves focus during the tick before a repair:** `repairFocus` leaves it there. Test: Task 3, `repairFocus never moves focus the user put elsewhere`.

## Gate ladder

`EXPECTED_CHECKS` is **2405** at `9a12964` (`frontend/scripts/visual-refresh-gate.sh:90`). Each task raises it by the rows it adds, minus the rows it removes, and records the new N in its ledger line and commit message. The rows each task touches are listed in its "Gate" step. Row counts are decided when the rows are written; the plan fixes which rows exist, not their count.

## File map

| File | Tasks | Responsibility |
|---|---|---|
| `frontend/src/components/items/ItemRouter.svelte` | 1 | `{#key item.id}` around the branch chain |
| `frontend/src/stores/quizDrafts.svelte.ts` (new) | 1 | unsubmitted answers per item and owner; unload warning |
| `frontend/src/stores/currentCourse.svelte.ts` | 1 | `recordQuizAttempt` |
| `frontend/src/components/items/QuizItem.svelte` | 1 | draft mirror, `recordQuizAttempt`, `holdsAnswers` |
| `frontend/src/lib/auth.svelte.ts` | 1 | drafts cleared on logout, dropped for a different user |
| `frontend/src/lib/routeClick.ts` (new) | 2 | `routeClick` |
| `frontend/src/lib/router.svelte.ts` | 8 | `landingLabel` |
| `frontend/src/lib/linkRouter.ts` (new) | 2 | the app-wide link handler |
| `frontend/src/App.svelte` | 2 | installs the link router |
| link sites (CourseCard, SequenceLink, AppHeader, SequencePlayer, MiniProjectDetailPage, TeachingCrumbs, TeacherRunListPage, RunListPage, RunDetailPage, VersionEditPage, VersionsPage) | 2 | adopt `routeClick` |
| `frontend/src/lib/askInPlace.svelte.ts` | 3 | `canHoldFocus`, `repairFocus` |
| `frontend/src/lib/focusFirst.ts` | 3 | rewritten on `usable` |
| `frontend/src/lib/pressRecorder.ts` (new) | 3 | last pressed control (F13) |
| `frontend/src/components/ui/FocusTrap.svelte` | 3 | usable autofocus (F5), opener record (F13) |
| `frontend/src/components/ui/Modal.svelte` | 3 | `isTopModal`, `<body>` key backstop |
| `frontend/src/components/editor/ItemEditorModal.svelte` | 3 | footer blocked/busy, ⌘S from `<body>`, F6 |
| quiz modals (`NewQuestionModal`, `QuestionTextModal`, `ExplanationModal`) | 3 | `isTopModal` clause in ⌘S |
| F-sites (VersionsPage, BlockAccordion, VersionEditPage, NewItemModal, VersionSettingsModal, RunOverviewTab, RunRosterTab, DashboardSidePanel, RosterImportModal, AssetSidebar) | 4 | F1, F2, F4, F7–F12 |
| `frontend/src/styles/theme-default.css` and the C1/C3/C5 files | 5 | banners, Cancel border, invalid fields, code chip, prompt colour |
| `frontend/src/styles/content.css`, `MiniProjectDetailPage.svelte` | 6 | loose lists; crumb hover, header, drop label, members, window drop |
| teacher tables, RunAssetsTab, NewRunModal, Progress/Submissions, the five loading screens | 7 | C4, long words, wrappers, 0 uses, strip, Skeleton, C17 |
| VersionsPage, CourseList, the offline sites, InlineName, RunRosterTab, NotFound, C18 files | 8 | §Behaviour and C18 (frontend) |
| `backend/mathion/api/assets.py`, `api/run_assets.py`, `notifications/templates.py`, `api/runs.py`, `schemas.py`, `markdown.py` | 9 | D84/C12, C9, C10, C11 |

---

### Task 1: Each item its own instance, the attempt count, quiz drafts (C13, D83, C14)

**Files:**
- Modify: `frontend/src/components/items/ItemRouter.svelte`, `frontend/src/components/items/QuizItem.svelte:17-110`, `frontend/src/stores/currentCourse.svelte.ts:103`, `frontend/src/lib/auth.svelte.ts:40, :49` and `bootstrapSession`
- Create: `frontend/src/stores/quizDrafts.svelte.ts`, `frontend/src/tests/quizDrafts.svelte.test.ts`, `docs/backlog/polish3-minors-debt.md`
- Test: `frontend/src/tests/ItemRouter.svelte.test.ts`, `frontend/src/tests/QuizItem.svelte.test.ts`, `frontend/src/tests/currentCourse.recordQuizAttempt.test.ts` (new), and the auth cases in `quizDrafts.svelte.test.ts`

**Interfaces:**
- Produces, in `stores/quizDrafts.svelte.ts`:
  - `type Draft = Record<string, number[] | string>`;
  - `holdsAnswers(a: number[] | string | undefined): boolean`: a non-empty array or a non-blank string;
  - `getDraft(itemId: number): Draft | undefined`: a copy, or `undefined`;
  - `setDraft(itemId: number, answers: Draft): void`: a no-op while `session.user` is null. It stores the answers with `owner = session.user.id`, or deletes the entry when no value `holdsAnswers`;
  - `clearDraft(itemId: number): void`;
  - `clearAllDrafts(): void`;
  - `dropDraftsNotOwnedBy(userId: number): void`;
  - `hasUnsavedDrafts(): boolean`.
- Produces, in `stores/currentCourse.svelte.ts`: `recordQuizAttempt(res: QuizSubmitResponse): void` (P118).

- [ ] **Step 0: Baseline.** Run vitest, svelte-check and the gate on the untouched tree. Record the test count, the warning count and `2405` in `$SDD/progress.md` (create it with a header naming the plan and spec).

- [ ] **Step 1: Write the failing store tests** in `tests/quizDrafts.svelte.test.ts` (set `session.user = { id: 7, … }` in `beforeEach`; call `clearAllDrafts()` in `afterEach`):

```ts
test('holdsAnswers', () => {
  expect(holdsAnswers([2])).toBe(true); expect(holdsAnswers([])).toBe(false);
  expect(holdsAnswers(' x ')).toBe(true); expect(holdsAnswers('  ')).toBe(false);
  expect(holdsAnswers(undefined)).toBe(false);
});
test('a draft is kept per item and returned as a copy', ...);           // getDraft(5) toEqual {'11':[2]}; mutating it does not change the store
test('nothing is stored while signed out', ...);                       // session.user = null; setDraft → getDraft undefined
test('text typed and erased drops the draft', ...);                    // setDraft(5,{'11':'a'}) then {'11':''} → undefined, hasUnsavedDrafts false
test('an emptied multi-choice answer drops the draft and the unload warning', ...); // {'11':[1]} then {'11':[]} → undefined; beforeunload not prevented
test('beforeunload warns only while a draft holds answers', ...);      // new Event('beforeunload',{cancelable:true}) → defaultPrevented true, then false after clearDraft
test('dropDraftsNotOwnedBy keeps the owner and drops the rest', ...);
test('logout clears every draft', ...);                                // mock api.post; await logout(); hasUnsavedDrafts false
test('verifyPin as another user drops drafts; the same user keeps them', ...);
```

- [ ] **Step 2: Run it:** `TZ=Europe/Copenhagen npx vitest run src/tests/quizDrafts.svelte.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `stores/quizDrafts.svelte.ts`** to the interface above, with P119's single listener. Wire `lib/auth.svelte.ts`:
  - `logout()` calls `clearAllDrafts()` in its `finally`, beside `clearCourse()`;
  - `verifyPin` calls `dropDraftsNotOwnedBy(user.id)` after `session.user = user`;
  - `bootstrapSession` does the same after `session.user = u`.

  Do NOT touch `clearSession()` or the 401 handler in `main.ts` (C14).

- [ ] **Step 4: Run it.** Expected: PASS.

- [ ] **Step 5: Write the failing instance and attempt tests.**
  - `tests/currentCourse.recordQuizAttempt.test.ts`: `recordQuizAttempt sets attempt_count, max_attempts, last_score and is_covered`. Seed a course with item `'5'` at `attempt_count: 0`, call it with `{item_id:5, attempt_count:2, max_attempts:3, score_correct:1, score_total:2, can_retry:true}`, and assert the entry fields. A missing item is a no-op.
  - `tests/ItemRouter.svelte.test.ts`: `quiz → quiz remounts: B opens unanswered and unlocked, and B's submit sends only B's question ids`. Mount with a `$state` props object holding quiz A, answer and submit through the mocked `api.post`, then set `props.item = quizB` and `flushSync()`. Assert no `.locked`/result element, the inputs are empty, and the second `api.post` body's `answers` keys equal B's question ids.
  - `tests/QuizItem.svelte.test.ts`:
    - `submit on the last attempt, unmount, remount: the reveal shows`: store max 3, `attempt_count` 2. Submit returns `attempt_count: 3`, `recordQuizAttempt` runs, unmount, mount fresh, and assert the reveal GET was called and no Submit button shows.
    - `submit with attempts left, unmount, remount: an empty form and the right number left`: assert the "attempts left" text names 1, not 2.
    - `a remount restores the draft` (session user set; answer one question; unmount; mount; the input shows the answer).
    - `a successful submit clears the draft but keeps the shown answers`.

- [ ] **Step 6: Run them.** Expected: FAIL on the remount, the attempt count and the draft (the existing tests stay green).

- [ ] **Step 7: Implement.**
  - `ItemRouter.svelte`: wrap the whole `{#if}` chain in `{#key item.id}…{/key}`. Leave `SequencePlayer` untouched; its AST pin allows no `KeyBlock` (spec C13).
  - `QuizItem.svelte`:
    - `answers` starts from `getDraft(item.id) ?? {}`;
    - `setAnswer` writes the answer, then `setDraft(item.id, $state.snapshot(answers))`;
    - `allAnswered` uses `holdsAnswers`;
    - on success, `submit()` calls `recordQuizAttempt(res)` (replacing `markItemCovered(res.item_id)`) and `clearDraft(res.item_id)`. Never read `item` after the `await`;
    - "Try again" keeps today's behaviour: an empty `answers` and no draft write until the student answers.
  - `currentCourse.svelte.ts`: `recordQuizAttempt` beside `markItemCovered`, by deep mutation like it.

- [ ] **Step 8: Run the touched files, then the full suite.** Expected: PASS. The existing `QuizItem.svelte.test.ts:565, 583` item-change tests stay green. If one asserted the old carry-over, it flips; ledger it.

- [ ] **Step 9: Gate.** In section `(ao)` (create it before the summary line, P124), add a `src_count` row: ItemRouter has exactly one `{#key item.id}`. Run the gate. SequencePlayer's AST/SIG rows (~`:1381`, ~`:1540-1553`) and the ItemRouter grep rows (~`:1171`) must stay green unchanged. Set `EXPECTED_CHECKS`.

- [ ] **Step 10: Look check.** Shoot the player quiz at 1280 and 400. Type an answer (client-only), go Next, then Previous, and shoot it again with the answer still there. The guard blocks the track POST. Do not submit.

- [ ] **Step 11: Review loop, then the commits.** The docs commit:
  - creates `docs/backlog/polish3-minors-debt.md`;
  - closes the stale entries of spec §Backlog lifecycle (`git rm docs/backlog/not-found-page-unstyled.md`; delete the named bullets; reword `flex-1-titles-may-collapse-to-zero-width.md`);
  - closes the four §Narrow screens entries.

  The code commit: `feat(polish3): each player item its own instance; quiz answers kept per quiz; attempt count recorded (C13, D83, C14)`.

### Task 2: In-app links (C6) and the course crumb

**Files:**
- Modify: `frontend/src/lib/router.svelte.ts`, `frontend/src/App.svelte`, `frontend/src/pages/editor/VersionsPage.svelte:311-313, :471`, `frontend/src/pages/MiniProjectDetailPage.svelte:477-483`
- Modify (adopt `routeClick`): `components/course/CourseCard.svelte:34, 37, 53, 64, 69, 77`, `components/course/SequenceLink.svelte:20`, `components/chrome/AppHeader.svelte:24, 33, 38`, `pages/SequencePlayer.svelte:164`, `pages/MiniProjectDetailPage.svelte:478`, `components/runs/TeachingCrumbs.svelte`, `pages/teaching/TeacherRunListPage.svelte:88`, `pages/runs/RunListPage.svelte:98`, `pages/runs/RunDetailPage.svelte:392`, `pages/editor/VersionEditPage.svelte:551`
- Create: `frontend/src/lib/linkRouter.ts`, `frontend/src/tests/linkRouter.svelte.test.ts`
- Test: `frontend/src/tests/router.test.ts`, each site's existing test file (or `tests/routeClickSites.svelte.test.ts` for a site without one), `tests/VersionsPage.slots.svelte.test.ts:530`, the MiniProjectDetailPage test file

**Interfaces:**
- Produces, in `lib/routeClick.ts` (executor's ruling: a module of its own, so a test's `vi.mock` of `navigate` in `router.svelte` still applies): `routeClick(e: MouseEvent, href: string): void`.
  - On a modifier (`metaKey`, `ctrlKey`, `shiftKey`, `altKey`) or `e.button !== 0` it returns without `preventDefault`.
  - Otherwise it calls `e.preventDefault()`. Then, if `(e.target as Element).closest('a, button')` has `aria-disabled="true"`, it returns; else `void navigate(href)`. It reads the target, not `e.currentTarget`, so delegated events cannot fool it.
- Produces, in `lib/linkRouter.ts`: `installLinkRouter(): () => void` (P121, ref-counted; the teardown removes the listener when the count reaches 0).
- Changes, in `lib/router.svelte.ts` (Task 2 review): `navigate(…): Promise<boolean>`, true only when that call moved the route. The handler scrolls on it.

- [ ] **Step 1: Write the failing tests.**
  - `router.test.ts`:
    - `routeClick navigates on a plain click`;
    - `routeClick leaves meta/ctrl/shift/alt and middle clicks to the browser` (not `defaultPrevented`, `navigate` not called);
    - `routeClick on an aria-disabled anchor prevents the default and does not navigate`.
  - `linkRouter.svelte.test.ts` (install in `beforeEach`, tear down in `afterEach`; append anchors to `document.body` and dispatch `new MouseEvent('click', {bubbles:true, cancelable:true, button:0})`):
    - `a content link to a Mathion page routes, defaultPrevented, no reload`;
    - `routes a click on a child of the link and an Enter-activated click` (`<a><strong>` and `detail: 0`);
    - `an /assets/ link, an /api/ link, a download link and a target=_blank link are left alone`;
    - `a modifier click is left alone`;
    - `a link already defaultPrevented by its own handler is left alone`;
    - `a same-page #anchor is left alone; a same-path link without a fragment routes`;
    - `a link to / routes; a same-origin /version link is left alone`;
    - `a malformed % path is left to the browser`;
    - `a link to the current address neither reloads nor scrolls`;
    - `after a real move the window scrolls to the top; after a DirtyGuard Cancel it does not` (register a guard that returns false; spy `window.scrollTo`);
    - `the mini-project row and a Coming deadlines link route` (mount `MiniProjectLink` and `CourseDeadlines` with fixtures);
    - `install is idempotent across two App mounts` (two installs, one click → one navigate).
  - Each click-helper site: `a plain click navigates and a ⌘-click does not preventDefault`.
  - VersionsPage: `the row title is a link; while busy it is aria-disabled and a plain click does nothing`. Update `VersionsPage.slots.svelte.test.ts:530`.
  - MiniProjectDetailPage: `the course crumb and its separator render only when the loaded course is this one` (course store null → no link; a different slug → no link; the same slug → the link with the name).

- [ ] **Step 2: Run them.** Expected: FAIL (`routeClick` and `linkRouter` missing; the sites prevent ⌘-clicks; the crumb renders empty).

- [ ] **Step 3: Implement `routeClick`** and swap every listed site to `onclick={(e) => routeClick(e, href)}`. Delete VersionEditPage's local modifier check and the three local `go(e, href)` helpers. Then grep for more:

  ```
  grep -rnE 'preventDefault\(\);?' src --include='*.svelte' | grep -n navigate
  ```

  Swap any site it finds and list it in the ledger.

- [ ] **Step 4: Implement `lib/linkRouter.ts`** to spec §In-app links point 2. Its document `click` listener is bubble-phase; its rules come in this order:
  1. a plain primary click, not `defaultPrevented`;
  2. `closest('a[href]')`, with no `download` and a target that is `''` or `_self`;
  3. `!opensInNewTab(href)`;
  4. same origin, and `matchRoute(routes, pathname)` (inside a `try`) or pathname `/`;
  5. not a same-page fragment link.

  Then:
  - `preventDefault`;
  - `const moved = await navigate(u.pathname + u.search + u.hash)`;
  - `window.scrollTo(0, 0)` only if `moved` (the address is not compared: the player rewrites it on mount).

  Call it from `App.svelte` as `$effect(() => installLinkRouter())`.

- [ ] **Step 5: VersionsPage row title.**
  - It becomes `<a class="vtitle" href={…edit/v/{id}} aria-disabled={busy ? 'true' : undefined} onclick={(e) => routeClick(e, href)}>`.
  - `.vtitle:disabled` becomes `.vtitle[aria-disabled='true']`; `.vtitle` gains `text-decoration: none`.
  - `firstUsable(#v-{id}-title)` (`:222`) stays.

- [ ] **Step 6: MiniProjectDetailPage crumb.** The course link and the separator after it render inside `{#if currentCourse.value?.slug === courseSlug}`.

- [ ] **Step 7: Run the touched files, then the full suite.** Expected: PASS.

- [ ] **Step 8: Gate.**
  - Update the `.vtitle` row (~`:3830`) to the anchor form (`[aria-disabled=true]` as the minifier emits it, plus `text-decoration:none`). Run the gate red against the old dist first.
  - Add P125's source-scan row to `(ao)`. Leave the MiniProjectLink SIG row as it is (P120).
  - Set `EXPECTED_CHECKS`.

- [ ] **Step 9: Look check.**
  - The Versions page at 1280: the row title looks as before.
  - The mini-project page at 1280 and 400: the crumb.
  - In the player, click an in-app content link and confirm no reload. Check the guard first; the link click is client-side. Use `agent-browser eval` to read `performance.getEntriesByType('navigation').length` before and after.

- [ ] **Step 10: Review loop, then the commits.** Code commit: `feat(polish3): in-app links stay in the app and let modifier clicks through (C6); the course crumb waits for its course`.

### Task 3: The focus primitives (C7 points 1–6, F3, F5, F6, F13)

**Files:**
- Modify: `frontend/src/lib/askInPlace.svelte.ts:44-70`, `frontend/src/lib/focusFirst.ts`, `frontend/src/components/ui/FocusTrap.svelte:46-78`, `frontend/src/components/ui/Modal.svelte:1-7, :85-99`, `frontend/src/components/editor/ItemEditorModal.svelte:91, :242, :318, :344-346, :376-396`, `components/editor/quiz/NewQuestionModal.svelte`, `QuestionTextModal.svelte`, `ExplanationModal.svelte` (their ⌘S tests)
- Create: `frontend/src/lib/pressRecorder.ts`
- Test: `tests/askInPlace.svelte.test.ts`, `tests/focusFirst.test.ts`, `tests/FocusTrap.svelte.test.ts`, `tests/Modal.svelte.test.ts`, `tests/ItemEditorModal.svelte.test.ts`, the three quiz-modal test files

**Interfaces:**
- Produces, in `lib/askInPlace.svelte.ts`:
  - `canHoldFocus(el: Element | null | undefined): el is HTMLElement`: connected, not natively disabled, not inside `[inert]`. It accepts `aria-disabled`;
  - `repairFocus(...chain: (Element | null | undefined)[]): Promise<boolean>`. It awaits `tick()`, then acts only if `document.activeElement` is null, `document.body`, or matches `section.modal-panel` (P123). It focuses the first element of the chain that `canHoldFocus` and verifies that focus took, moving down the chain otherwise. It returns whether it focused.
- Produces, in `lib/pressRecorder.ts`:
  - `ensurePressRecorder(): void`: a capture-phase `pointerdown` that records `target.closest('button, a[href], [role=button][tabindex]')` for a primary press (`button === 0`), or null otherwise. A capture-phase `keydown` clears the record. Called once from FocusTrap's module script (on import), so the press that opens the first trap is seen (Task 3 ruling);
  - `lastPressed(): HTMLElement | null`.
- Produces, in Modal's module script: `export function isTopModal(panel: Element | null | undefined): boolean`.
- `focusFirst(candidates)` keeps its signature and returns `boolean`.

- [ ] **Step 1: Write the failing tests.**
  - `askInPlace`:
    - `canHoldFocus accepts aria-disabled and rejects disabled, disconnected and inert`;
    - `repairFocus focuses the first holder when focus is on body`;
    - `repairFocus acts when focus is on the modal panel`;
    - `repairFocus never moves focus the user put elsewhere` (focus an input during the tick, which the test awaits with a microtask hook);
    - `repairFocus skips a target whose focus() does not take`.
  - `focusFirst`: `skips a candidate inside [inert]`. The existing cases stay.
  - `FocusTrap`:
    - `autofocus skips a disabled match and falls through to the next, then the first [tabindex=-1]` (F5);
    - `a trap opened after a pointerdown on a button, with focus on body, returns focus to that button on close` (F13; focus `<body>`, dispatch `pointerdown` on the opener, mount, unmount);
    - `the same when focus sits on an ancestor of the pressed control`;
    - `a keydown after the press clears the record` (focus `<body>`, press, keydown, mount, unmount: focus not on the pressed button);
    - `a press on a non-control resets the record`.
  - `Modal`:
    - `isTopModal is true only for the top panel`;
    - `a key pressed with focus on body moves focus to the top panel`.
  - `ItemEditorModal`:
    - `⌘S with focus on body saves once and is defaultPrevented` (dispatch on `document.body`);
    - `a successful Save leaves focus on Save` (focus Save, save, settle);
    - `a clean Save and Discard are aria-disabled, not disabled, and clicking them does nothing`;
    - `while saving, Save shows loading and is not natively disabled` (flip the existing native-disabled assertions; ledger each flip);
    - `a ⌘S with focus on Discard repairs focus to Save once the save settles` (Discard turns natively disabled while frozen, which drops focus);
    - `F6: a 403 reload that disables the header ✓ moves focus off it first`.
  - Each quiz modal: `⌘S with focus on body saves once`.

- [ ] **Step 2: Run them.** Expected: FAIL. Confirm each is red for the right reason; record the red line per test in the ledger.

- [ ] **Step 3: Implement the lib pieces.**
  - `canHoldFocus` and `repairFocus` sit next to `usable`.
  - `focusFirst` iterates `usable(el)`, focuses, and verifies, as today; this adds the `inert` check. It stays in `src/lib/focusFirst.ts` (the gate's `LIB_6A` names it).
  - Create `pressRecorder.ts`.

- [ ] **Step 4: Implement FocusTrap.**
  - At mount: if `document.activeElement` is body or null, or contains `lastPressed()`, and `canHoldFocus(lastPressed())`, take `lastPressed()` as `previousFocus`.
  - The autofocus loop skips matches that are not `canHoldFocus`, in both the priority and the DOM-order branches. Then fall back to `containerEl.querySelector('[tabindex="-1"]')`.

- [ ] **Step 5: Implement Modal.**
  - Export `isTopModal` from the module script; it reads `stack`.
  - In `onKeydown`: when this modal is top and `document.activeElement === document.body` (or null), focus `panelEl` first, then continue as today.

- [ ] **Step 6: Implement ItemEditorModal.**
  - Save: `loading={saving}`; `aria-disabled` when clean or blocked (not saving); native `disabled` only while `frozen` for a reason other than saving.
  - Discard: `aria-disabled` when clean; `discard()` returns at once when clean; it stays natively disabled while `frozen`.
  - `save()`'s `finally`: `if (alive) void repairFocus(saveBtn, titleEl, closeBtn)`.
  - ⌘S test: the target is inside the panel, OR the target is body or `documentElement` and `isTopModal(panelEl)`.
  - F6: the header ✓ takes `InlineInput.svelte:31-35`'s `$effect.pre` move-before-disable.
  - The three quiz modals gain the same `isTopModal` clause.

- [ ] **Step 7: Run the touched files, then the full suite.** Expected: PASS. If the F13 tests are flaky or the record misses a case, switch to P122's fallback and ledger it.

- [ ] **Step 8: Gate.** No row pins these `disabled={…}` expressions (spec). Run the gate: unchanged N, unless the Button/IconButton look rows need the busy primary look pinned. C16 is a look change; add a row only if the look check shows the busy Save renders other than `.btn.primary` with the spinner.

- [ ] **Step 9: Look check** at 1280, in the editor:
  - the item modal with a busy Save, mocked by holding the PUT with `agent-browser network route` and a delay; it shows primary with the spinner (C16);
  - a clean Save;
  - focus after a mouse Save.

- [ ] **Step 10: Review loop, then the commits.** Code commit: `feat(polish3): focus stays put after an action — repairFocus, usable autofocus, the opener after a Safari click, ⌘S from <body> (C7)`.

### Task 4: The focus sites F1, F2, F4, F7–F12

**Files:**
- Modify:
  - `pages/editor/VersionsPage.svelte:35, :53-63, :97-102, :127-128, :253-254, :280-281, :342-345`;
  - `components/editor/BlockAccordion.svelte:398`, `pages/editor/VersionEditPage.svelte:686`;
  - `components/editor/NewItemModal.svelte:124`, `components/editor/VersionSettingsModal.svelte:136-137`;
  - `components/runs/RunOverviewTab.svelte:171-198, :366-378`;
  - `components/runs/RunRosterTab.svelte:120, :534-563, :639, :650, :826`;
  - `components/runs/DashboardSidePanel.svelte:195-218, :911-919`;
  - `components/runs/RosterImportModal.svelte:184-204, :261`;
  - `components/editor/AssetSidebar.svelte:67-71`.
- Test: `tests/VersionsPage.duplicate.svelte.test.ts`, `tests/VersionsPage.slots.svelte.test.ts`, and the existing test file of each other component

**Interfaces:**
- Consumes from Task 3: `repairFocus(...chain)`, `canHoldFocus`, `focusFirst`.

- [ ] **Step 1: Write the failing tests,** one per site. Each disables or unmounts the focused control the way the real flow does and asserts `document.activeElement`:
  - F1:
    - `Duplicate Cancel returns focus to the row's Duplicate, else the h1`;
    - `Enter in the busy label input keeps focus (readonly, not disabled)`;
    - `Create copy and Create stay focusable while busy and show loading`;
    - `Enter twice in the create form sends one POST`;
    - `Enter twice in the duplicate form sends one POST`.
  - F2: `a failed create from a clicked ✓ keeps focus on the ✓ (aria-disabled while busy)`, for BlockAccordion and VersionEditPage.
  - F4:
    - `NewItemModal: a failed Create keeps focus on Create`;
    - `a 409 moves focus to the title field`;
    - `VersionSettingsModal: a failed Save keeps focus on Save`.
  - F7: `a failed Publish that reveals a violation leaves focus on Publish, else the readiness heading`.
  - F8:
    - `the row group select keeps focus after the request settles`;
    - `a draft flip that unmounts the open add row moves focus to the + toggle, else the search`.
  - F9: `the first thread load moves focus to the Evaluation heading, else ×`.
  - F10: `Done at the summary keeps × enabled (closing leaves closeDisabled)`.
  - F11: `a failed list reload moves focus to the drop zone, else the panel`.
  - F12:
    - `a course switch focuses the new h1 once loaded`;
    - `a course switch dismisses the create question, resets the form and closes it` (the next course's form opens with an empty label).

- [ ] **Step 2: Run them.** Expected: FAIL, each red for its own reason (ledger the red lines).

- [ ] **Step 3: Implement** to spec point 1 and the chains in point 3. In particular:
  - `createVersion` and `duplicateVersion` start with `if (busy) return;`; each keeps its own busy flag for `loading`, with `aria-disabled` while another action holds `busy`, and repairs focus to its button after a failure (review r1);
  - busy buttons use `loading`, not `disabled`;
  - the add rows' ✓ is `aria-disabled={createBusy}`, with the re-entry guard staying in the form's `onsubmit`;
  - F10 removes `closing` from `closeDisabled`;
  - F12's `courseSlug` effect runs `createAsk.dismiss()`, `resetCreateForm()`, `creating = false` and `duplicatingId = null` inside `untrack`. A separate effect focuses the `<h1>` once the new course has loaded after a real switch, if focus is on `<body>`.
  - Review r1–r3: F2's failures repair to the ✓ (then the field), F4's to Create (then Title) and Save; F9 repairs only on a form → card swap; F8's draft flip is an `$effect.pre` that also covers the toolbar's buttons and the empty roster's links, and the select repairs as soon as its PATCH lands (its `finally` skips while a newer change of the same select runs); F11's failed reload closes an idle question.

  Replace a scattered `document.activeElement === document.body` check in these files with `repairFocus`.

- [ ] **Step 4: Run the touched files, then the full suite.** Expected: PASS. Flipped native-disabled assertions are ledgered.

- [ ] **Step 5: Gate.** No row changes; confirm the N is unchanged.

- [ ] **Step 6: Look check** at 1280: Versions with a busy Create copy (mock the POST with a delay), the editor's add row with a busy ✓, and the run Overview's Publish. These are teaching and authoring screens, so no 400px shots.

- [ ] **Step 7: Review loop, then the commits.** The docs commit deletes the F-site backlog bullets. Code commit: `feat(polish3): focus stays on the control after a busy or failed action at the remaining sites (F1, F2, F4, F7–F12)`.

### Task 5: The look, token level (C1, C2, C3, C5, the code chip)

**Files:**
- Modify:
  - `styles/theme-default.css:84` (`--cancel-border`);
  - the seven banner rules (spec §The look, row 1): `RunOverviewTab .ov-err`, `DashboardSidePanel .sp-error` (`:974-978`), `RosterImportModal .ri-banner` (`:489-497`), `MiniProjectModal .mpm-banner` (`:755-764`), `RunMiniProjectsTab .mp-banner-err` (`:393-395`), `RunAssetsTab .banner-error`, `NewRunModal .nr-banner` (`:202-210`);
  - `VersionEditPage.svelte:676`, `BlockAccordion.svelte:388`, `AccordionHeader.svelte:194`;
  - `InlineConfirm.svelte:109`;
  - `components/editor/quiz/QuestionCard.svelte:146`;
  - `frontend/scripts/visual-refresh-gate.sh`.

- [ ] **Step 1: Compute the `--cancel-border` value.** Write `$SDD/probe/contrast.py` (WCAG relative luminance). Pick the lightest grey of the theme's hue that reaches ≥3:1 against `--surface`, `--focus-2`, `--danger-panel-bg` and every other ground a Cancel sits on (grep the two users' parents). Record the ratios; they go in the token's comment.

- [ ] **Step 2: Write the gate rows first,** then run the gate. Expected: red on every new or changed row, against the old dist.
  - the six banner rows (~4872 `.mp-banner-err`, ~4891 `.banner-error`, ~4960 `.nr-banner`, ~4985 `.ri-banner`, ~5003 `.mpm-banner`, ~5057 `.ov-err`) pin `background:var(--danger-panel-bg)` and `color:var(--danger-panel-fg)`. `.ri-failed` ~4983 stays;
  - a new `.sp-error` row in `(ao)`;
  - the `:root` hash in `WANT_FULL`;
  - `.add-input[aria-invalid=true]` (VersionEditPage and BlockAccordion) and `.title-input[aria-invalid=true]` (AccordionHeader), each `border:1.5px solid var(--danger)`, as qualified rows next to the existing `.add-input` ~3903 and `.title-input` ~3959 rows, which stay;
  - the InlineConfirm code chip: `background:var(--surface-2)`;
  - `.qtext` ~4508: `color:var(--text-2)`.

- [ ] **Step 3: Implement** the CSS to spec §The look rows 1–3, 5 and 10. Use the scoped selectors as written; a bare `[aria-invalid]` loses to the focus rule.
  - Review r1: the three fields set `aria-invalid` only for a title error (VersionEditPage and BlockAccordion drop `createGlobalError` from it; AccordionHeader keeps `errorIsTitle` via `mapCreateError`); `.qsrc` takes `--text-2` with a new `(ao)` row (N 2427).

- [ ] **Step 4: Run the gate (green), vitest and svelte-check.** Expected: PASS.

- [ ] **Step 5: Look check** at 1280:
  - a banner beside a danger panel (mock a failing endpoint with `network route`);
  - a Cancel on white and on a danger panel;
  - each of the three invalid fields, focused (type an empty title with the guard live, then Enter; the guard blocks the write and the client-side validation shows);
  - a quiz card prompt;
  - a code chip in a row question.

- [ ] **Step 6: Review loop, then the commits.** Code commit: `style(polish3): one pink for error banners, a visible Cancel border, red invalid fields, the prompt and code chip colours (C1–C3, C5)`.

### Task 6: The look and behaviour on student and content screens (D85, the mini-project page)

**Files:**
- Modify: `frontend/src/styles/content.css:22-37`, `frontend/src/pages/MiniProjectDetailPage.svelte` (`.breadcrumb a`, `header`, `.drop:has(input:disabled)` / `.drop-label`, `.members`, the window drop cancel, the dead `data.can_submit !== null` conjunct), `frontend/scripts/visual-refresh-gate.sh`
- Test: the MiniProjectDetailPage test file
- Remove: `docs/backlog/mp-can-submit-null-guard-is-dead.md` (`git rm`)

- [ ] **Step 1: Write the gate rows first,** then run the gate. Expected: red.
  - content.css `WANT_FULL` / `WANT_ORDER` (~521-590) gains four rules:
    - `.prose :where(ul,ol):has(>li>p)>li>p:not(:last-child)`, `margin-bottom:var(--space-2)`;
    - its `li+li` partner, `var(--space-3)`;
    - the two compact rules in full: `.prose.compact :where(ul,ol):has(>li>p)>li>p:not(:last-child)` and `…>li+li`.

    Update the "49 rules" comment.
  - In `(ao)`:
    - the crumb hover (`color:var(--text)`, `text-decoration:underline`);
    - the header bottom space;
    - `.drop:has(input:disabled) .drop-label` `color:var(--faint)`, replacing the ~3704 `.drop:has(input:disabled)` colour row;
    - `.members` `overflow-wrap:anywhere`.

- [ ] **Step 2: Write the failing jsdom tests:**
  - `a file dropped beside the zone is defaultPrevented`;
  - `a drop on the zone still picks the file`;
  - `a drop on the disabled zone while submitting does nothing`;
  - `the window listeners are removed on unmount`.

- [ ] **Step 3: Run them.** Expected: FAIL on the first and the last.

- [ ] **Step 4: Implement.**
  - The CSS goes to spec §The look rows "Loose lists", "Crumb hover", "Mini-project header" and "Long words" (`.members`). The compact values (e.g. `--space-1` / `--space-2`) are proposed at the look check. Extend the header comment at `content.css:22-28` with one sentence on the list rules.
  - The window `dragover` / `drop` cancel runs while the page is mounted, for drags whose `dataTransfer.types` includes `Files`.
  - Drop the dead `data.can_submit !== null` conjunct.
  - Review r1 (user): the inside-an-item rule covers every block (`:where(p, ul, ol, pre, blockquote, hr, div.math)`), not only `p`; the window `dragover` sets `dropEffect = 'none'` beside the zone.
  - Review r2: a heading in a loose item keeps its em margins (ruling); while submitting `handleDragOver` returns before `preventDefault`, so the window shows the no-drop cursor over the disabled zone too (test: "the disabled zone while submitting shows no drop cursor"); a loose list with no `<p>` goes to the backlog.

- [ ] **Step 5: Run the gate, vitest and svelte-check.** Expected: PASS.

- [ ] **Step 6: Look check** at 1280 and 400 (student screens):
  - the mini-project page with the crumb hovered and a long member name, injected with `eval` into the live page, read-only;
  - a loose list at page scale and compact scale, using an injected backend-rendered fixture as in Polish 2 (P107). The user picks the compact values here.

- [ ] **Step 7: Review loop, then the commits.** Code commit: `style(polish3): loose lists group by item (D85); mini-project page crumb, header, drop label, member wrap and a drop beside the zone`.

### Task 7: Teacher screens — tables, columns, 0 uses, the New run strip, loading (C4, D86, D87, C17)

**Files:**
- Modify:
  - `components/runs/RunProgressTab.svelte` (`.name-box`, the Group column, `:372` loading);
  - `components/runs/RunSubmissionTab.svelte` (Group column wrapper, `.table-scroll` `scroll-padding-right`, `:232-234` loading);
  - `components/runs/RunGroupsTab.svelte` (`.g-name`), `components/runs/RunRosterTab.svelte` (`.ro-err`);
  - `components/runs/RunMiniProjectsTab.svelte:400`, `components/runs/RunAssetsTab.svelte:773-777, :916, :933`;
  - `pages/teaching/TeacherRunListPage.svelte:141`, `pages/runs/RunListPage.svelte:218`, `pages/runs/RunDetailPage.svelte`;
  - `components/runs/NewRunModal.svelte:193`;
  - `frontend/scripts/visual-refresh-gate.sh`.
- Delete: `components/ui/LoadingPlaceholder.svelte`, `tests/LoadingPlaceholder.svelte.test.ts`
- Test: `tests/RunProgressTab.svelte.test.ts:476-479`, `tests/RunSubmissionTab.svelte.test.ts:441-443, :467`, `tests/RunAssetsTab.svelte.test.ts:2353, :2441`, `tests/TeacherRunListPage.svelte.test.ts`, and the RunListPage / RunDetailPage test files

**Interfaces:**
- Consumes from Task 3: `repairFocus` (for the 0-uses chip that turns into a label under focus).

- [ ] **Step 1: Write the gate rows first,** then run the gate. Expected: red.
  - four table wrappers (`overflow-x:auto`, the outer border and radius), each in its owner's `own` / `uniq1` block (~4713, ~4723, ~4861, ~4882). Each table: `border-collapse:separate`, `border-spacing:0`; the first body row drops `border-top` on `.mp-table` and `.assets-table`;
  - the Group-column wrappers in Progress and Submissions (`calc(6rem - 25px)` / `calc(12rem - 25px)`, `overflow-wrap:anywhere`);
  - `.g-name` and `.ro-err`: `overflow-wrap:anywhere`;
  - `.uses-off`: `cursor:default`, `display:inline-block`. `.uses-chip` ~4888 stays;
  - `.nr-strip-val` wrap in the no-version branch;
  - the Submissions `.table-scroll`: `scroll-padding-right:4px`.

- [ ] **Step 2: Write the failing jsdom tests:**
  - `0 uses renders a span, not a button, with no panel`;
  - `a focused chip that drops to 0 on reload repairs focus to the row's next control, else the heading`;
  - `the first load shows the Skeleton` on each of the five screens;
  - `a Refresh over data keeps the rows and shows "Refreshing…", with no Skeleton` (Progress, Submissions; query the text);
  - `the status element stays mounted and empty between refreshes`.

  Update the listed existing assertions.

- [ ] **Step 3: Run them.** Expected: FAIL.

- [ ] **Step 4: Implement** to spec §The look rows "Group column", "Long words" (`.g-name`, `.ro-err`), "Table corners", "0 uses", "Loading" and "New run strip", plus C18's scroll padding.
  - Move RunAssetsTab's drag-over `outline` and `.teach-table`'s `margin-top: 14px` to the wrappers.
  - The Skeleton row count suits each surface: 6 for the grids, 3 for the lists.
  - Delete `LoadingPlaceholder`.

- [ ] **Step 5: Run the gate, vitest and svelte-check.** Expected: PASS.

- [ ] **Step 6: Look check** at 1280:
  - the four tables, zoomed on a corner;
  - a long group name in Progress and Submissions, injected;
  - the 0-uses label;
  - the New run strip with no version (open New run on a course with no published version, or mock the versions GET);
  - the teacher screens loading (throttle with a delayed `network route`);
  - a Refresh over data, with "Refreshing…" shown.

  These are teaching screens, so no 400px shots.

- [ ] **Step 7: Review loop, then the commits.** Code commit: `style(polish3): teacher tables keep their corners and scroll, capped Group columns, a 0-uses label, one skeleton loading look (C4, D86, D87, C17)`.
  - Look check (user OK): the legend on Progress moving aside while "Refreshing…" shows is accepted. Rulings: a change of run clears `data` in Progress and Submissions; the 0-uses `$effect.pre` drops the open panel id; the table-wrapper gate rows sit in their owners' blocks, new selectors in (ao), new declarations on pinned selectors (`.uses-off`, `.ro-err`) extend those rows.

### Task 8: Frontend behaviour (C8, §Behaviour, C18)

**Files:**
- Modify:
  - `pages/editor/VersionsPage.svelte:104-147`;
  - `pages/CourseList.svelte`;
  - the offline sites: `RunOverviewTab.svelte:156-158`, `RunDetailPage.svelte:323, :349`, `RunTeachersTab.svelte:44, :75`, `RunGroupsTab.svelte:117`, `RunRosterTab.svelte:486-488, :526, :550`;
  - `components/ui/InlineName.svelte:54-57`;
  - `RunRosterTab.svelte` (~`:309` bulk refetch; `:445, :464` add error);
  - `lib/router.svelte.ts` and `pages/NotFound.svelte:11-13`;
  - `NewRunModal.svelte:65-72`;
  - `components/editor/item/AppBody.svelte:66-67`;
  - `DashboardSidePanel.svelte` (the prefill effect);
  - `components/runs/MiniProjectModal.svelte` (Discard while uploading);
  - `lib/normalizeVideoUrl.ts`, `components/editor/NewItemModal.svelte:49, :87`, `components/editor/item/VideoBody.svelte:72`;
  - `pages/teaching/TeacherRunListPage.svelte:19`.
- Remove: `docs/backlog/courselist-empty-api-error-detail-shows-empty-state.md` (`git rm`)
- Test: each component's existing test file, plus a new `tests/VersionsPage.realNavigate.svelte.test.ts` (no router mock)

**Interfaces:**
- Produces, in `lib/router.svelte.ts`: `landingLabel(path: string): string`, beside `defaultLandingPath`. It returns `'Back to teaching'` for `/teaching` and `'Back to courses'` otherwise (today's wording, `NotFound.svelte:12`). NotFound keeps its own `'Sign in'` branch for a signed-out visitor.
- Consumes from Task 1: nothing. From Task 4: VersionsPage's `resetCreateForm()` and the `busy` guard.

- [ ] **Step 1: Write the failing tests.**
  - VersionsPage C8:
    - `Cancel on a dirty create form asks DISCARD_ASK; on a clean one it closes`;
    - `an in-app navigation with a dirty create form asks`;
    - in the real-navigate file: `a successful Create changes the route with no question open`.
  - CourseList: `an ApiError with detail '' shows the server message with Retry, not the empty state`; `a rejected TypeError shows "Check your connection and try again."`.
  - Offline: at each listed site, `a rejected TypeError shows a toast` (or `…the inline error` for the two add forms).
  - InlineName:
    - `a TypeError shows "Could not save."`;
    - `an ApiError with detail '' shows "Could not save."`;
    - `a plain Error shows its message`.
  - RunRosterTab:
    - `a bulk move whose refetch fails still settles the banner with Dismiss and unlocks`;
    - `the add error clears on typing`.
  - NotFound: `the label comes from landingLabel for each landing path`.
  - NewRunModal: `a new submit clears the old server banner before validation`; `a start date change that fixes the range clears the end-date error`.
  - AppBody: `a title Save makes no second /assets GET`.
  - DashboardSidePanel: `a refresh during an edit keeps the text and the focus; a new evaluation id re-fills`.
  - MiniProjectModal: `Discard waits while an upload runs (UPLOAD_WAIT)`.
  - normalizeVideoUrl:
    - `youtu.be/x and www.youtube.com/watch?v=x and player.vimeo.com/video/1 gain https://`;
    - `HTTPS://example.com/v.mp4 returns https://example.com/v.mp4 and leaves the rest as typed`;
    - `an unknown scheme-less host is returned as typed`.
  - NewItemModal: `a scheme-less YouTube URL is accepted and sent normalised` (click Create, not `requestSubmit()`).
  - VideoBody: `validate() checks the normalised value`.
  - TeacherRunListPage: `the status pill is kept in ?status= and restored from it`.

- [ ] **Step 2: Run them.** Expected: FAIL.

- [ ] **Step 3: Implement** to spec §Behaviour and C18, item by item.
  - VersionsPage: on a successful Create, reset the form and set `creating = false` before `navigate()`.
  - VersionsPage mounts `<DirtyGuard isDirty={() => creating && createDirty()} …>` with the question in `createAsk`.
  - CourseList holds `{ status, message } | null`.
  - `normalizeVideoUrl` gains its two steps (the scheme-less retry for its known hosts; the lowercase `^https?://` prefix on every return path, never `u.href`). NewItemModal's check drops its `/i`.

- [ ] **Step 4: Run the touched files, then the full suite.** Expected: PASS.

- [ ] **Step 5: Gate.** No row changes unless a touched rule is pinned; run it and confirm N.

- [ ] **Step 6: Look check.**
  - The course list offline: route the courses GET to fail, at 1280 and 400.
  - The 404 at 400.
  - Teaching at 1280: filter, open a run, Back.
  - The Versions create form: Cancel when dirty.

- [ ] **Step 7: Review loop, then the commits.** Code commit: `fix(polish3): the create form asks before discarding, errors say what failed, offline failures show, and the C18 extras`.

  Done 2026-11-01 (spec rev 12): the create form's guard skips Create's own request; one offline message (`OFFLINE_MESSAGE`); a quiet bulk refetch failure; New item's form is `novalidate`; the Teaching pill is a writable `$derived` of `?status=`. The look check needed a fresh sign-in (dev rows: PIN 42, session 43).

### Task 9: Backend — course files, staff e-mails, run dates, explicit nulls, stripped links (D84, C9–C12)

**Files:**
- Modify: `backend/mathion/api/assets.py:189`, `backend/mathion/api/run_assets.py:289-294`, `backend/mathion/notifications/templates.py:33-35`, `backend/mathion/api/runs.py:91-93`, `backend/mathion/schemas.py:333-338, :454-458` (and `OptionUpdate`), `backend/mathion/markdown.py` (`render_markdown`)
- Test: `backend/tests/test_assets_api.py`, `test_run_assets.py`, `test_notifications_templates.py:44, :58`, `test_runs.py`, `test_questions_api.py`, `test_concurrency_options.py` (or wherever `OptionUpdate` is exercised), `test_markdown.py`

**Interfaces:**
- Produces, in `api/runs.py`: `_short_date(d: date) -> str`. It returns e.g. `"31 Mar 2026"` from a fixed English month tuple, not `strftime('%b')`.

- [ ] **Step 1: Write the failing tests.**
  - Assets:
    - `test_inline_types_are_inline`: parametrised over `application/pdf`, `image/png`, `image/jpeg` and `image/gif`. Assert `Content-Disposition` starts with `inline;` and carries the filename;
    - `test_csv_and_js_download` (`attachment`);
    - `test_pdf_with_uppercase_extension_is_inline`;
    - `test_asset_file_response_has_nosniff`.
  - Run assets: `test_run_asset_file_response_has_nosniff`.
  - Templates: the staff URL is `/teaching/{slug}/runs/{id}` (update `:44, :58`).
  - Runs:
    - `test_patch_start_after_existing_end_is_422` (message: `"Start date must be on or before the end date (31 Mar 2026). To move the run later, change the end date first."`);
    - `test_patch_end_before_existing_start_is_422` (the mirrored message);
    - `test_patch_both_dates_inverted_gives_the_end_date_message`;
    - `test_patch_same_day_start_and_end_is_allowed`;
    - `test_patch_start_date_null_is_422_not_500`;
    - one each for `title`, `end_date` and `groups_enabled` null → 422.
  - Questions: `text_md: null` → 422; `test_explanation_md_null_still_clears_the_explanation` (200, cleared).
  - Options: `text: null` and `is_correct: null` → 422.
  - Markdown:
    - `test_bare_urls_nh3_strips_stay_plain_text`, parametrised over `https://a.b:99999999`, `https://%zz.org`, `https:///` and `https://[::1]/x`. Assert no `<a` in the output and the text present;
    - `test_authored_link_with_a_bad_href_stays_plain_text` (`[t](https://%zz.org)` and `<https://%zz.org>`).

- [ ] **Step 2: Run them:** `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q tests/test_assets_api.py tests/test_run_assets.py tests/test_notifications_templates.py tests/test_runs.py tests/test_questions_api.py tests/test_markdown.py`. Expected: FAIL on the new cases.

- [ ] **Step 3: Implement.**
  - **Assets:**
    - `INLINE_MIME = frozenset({"application/pdf", "image/png", "image/jpeg", "image/gif"})`;
    - `FileResponse(..., filename=filename, content_disposition_type="inline" if asset.mime_type in INLINE_MIME else "attachment", headers={"X-Content-Type-Options": "nosniff"})`;
    - the run-file response gains the same header.
  - **Templates:** `_staff_url` returns `f"{ctx.base_url}/teaching/{ctx.course_slug}/runs/{ctx.run.id}"`.
  - **Runs:** compare the new end with `updates.get("start_date", run.start_date)`, and the new start with `updates.get("end_date", run.end_date)`. The end date's message wins when both are sent.
  - **Schemas:** a field-scoped `field_validator(..., mode="before")` rejects an explicit `None` on exactly the fields the spec lists.
  - **Markdown:** after `nh3.clean`, unwrap every `<a>` without `href`, keeping its inner text. Use a regex on nh3's normalised output, which is safe because nh3 emits canonical tags; no new package.

- [ ] **Step 4: Run the full backend suite.** Expected: PASS.

- [ ] **Step 5: Frontend check.** Run vitest (an e-mail URL or date message may be asserted in a frontend test) and the gate, unchanged N.

- [ ] **Step 6: Look check.**
  - Open a linked course PDF and a PNG from the player at 1280 (they open in the tab); a CSV downloads. Use a read-only GET.
  - Take a screenshot of the run Overview's date error at 1280. The PATCH that would write is mocked with `network route` to return the new 422 body; show the field message.

- [ ] **Step 7: Review loop, then the commits.** Code commit: `fix(polish3): course PDFs and images open in the tab with nosniff, staff links to /teaching, run dates checked both ways, explicit nulls 422 where a field cannot be empty, stripped links stay text (D84, C9–C12)`.

  Done 2026-11-01 (spec rev 13): the run date messages pad the day ("01 Jan 2026"), as `formatShortDate` does; the stripped-link check is a markdown-it core rule that asks nh3 whether it keeps each `href`, not a regex over nh3's output (nh3 leaves `<` and `>` unescaped in attribute values); the range is checked only when a date is sent (review r1); the locale test sets `de_DE.UTF-8` when the machine has it. The look check needed a fresh sign-in and three uploads (dev rows: PIN 43, session 44, assets 12–14 on Draft v15), deleted at slice end.

### After Task 9

- [ ] Whole-branch review, `71dd8cc..HEAD`: one fresh Opus and one fresh Fable lane. Fix every Critical and Important, re-running both after every fix.
- [ ] The Safari pass, one step at a time, from spec §Carried to the Safari pass. No VoiceOver steps (they go to the beta list).
- [ ] Delete the dev rows `login_pins` 39 and `sessions` 40 (and any rows later sign-ins add; note their ids when they happen). Close agent-browser session `p3-admin` and stop the two dev servers.
- [ ] Update memory (`project_polish3_resume`, `project_visual_refresh`).
