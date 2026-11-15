# Visual-Refresh Backlog Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every item left in the visual-refresh backlog files after the walk of 2026-11-14 (`89ff71b`): 74 REAL items, plus the 18 OPEN items the user decided (2 of the 20 are closed without a change). Delete each bullet in the commit that fixes it.

**Architecture:** Nine tasks, one per screen area. Each task changes only the files its bullets name and writes a failing test per bullet first. Each removes its bullets from `docs/backlog/*-debt.md` in its own commit, and `git rm`s a file once it is empty. The user's calls and the copy are fixed below and are used verbatim.

**Tech Stack:** Svelte 5 runes + TypeScript (vitest, jsdom), FastAPI + markdown-it-py (pytest), Postgres 17.

**Spec:** the bullets themselves (each one names its fix) in `docs/backlog/slice5a-…`, `slice5b-…`, `slice5c-…`, `slice5d-…`, `slice6a-…`, `slice6b-…`, `slice6c-…`, `polish1-…`, `polish2-…`, `polish3-…-debt.md` and `format-progress-helper-now-unused.md`. The user's calls are in `.superpowers/sdd/2026-11-13-vr-backlog-walk/calls.md` and are copied below. Design context: the visual-refresh specs in `docs/superpowers/specs/` (slices 5a–6c, Polish 1–3).

## Global Constraints

**Rules (the user's):**
- Branch `feat/vr-backlog-round` off `main` (`89ff71b`). No push or merge without the user. Stage exact paths, never `git add -A`. Never stage `logo.png` or `favicon.svg`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, with no session line.
- Stay inside the repo and use absolute `cd`. Probes, logs and shots go in `$SDD` = `.superpowers/sdd/2026-11-14-vr-backlog-round/` (`probe`, `tmp`, `shots`).
- Run Python, pytest and alembic only via `backend/.venv`, with one pytest process at a time.
- No new npm or pip packages. Use theme tokens only and Svelte 5 runes. Test with mount/unmount/flushSync, not testing-library.
- Copy: plain words, they/them. Comments carry decision tags (e.g. `VR-B7`), never provenance.
- Laptop-only screens (authoring, teaching) need no 400px check. Student screens do (course page, player).

**Per-task loop:**
1. Write the RED tests and watch them fail.
2. Implement.
3. Run the suites.
4. Take shots when something visible changes (agterm overlay, `--size-percent 60`, base64 images).
5. Get reviews on the UNCOMMITTED diff from Opus (general-purpose, effort high; it runs suites and mutations and restores files) and from Fable (read-only). Never edit while a review runs. Fix all findings, minors too, and re-run both after every fix.
6. Commit only on the user's OK. Then update the ledger and memory, and wait for "go".

**Suites (green = all of these):**
- backend: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q > $SDD/tmp/pytest.log 2>&1; echo $?` gives 0. Run it for Task 2, and also wherever a task touches `backend/`.
- frontend: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TMPDIR=$SDD/tmp npm test > $SDD/tmp/vitest.log 2>&1; echo $?` gives 0, AND `grep -cE "^ *Errors +[0-9]|Unhandled (Rejection|Error)" $SDD/tmp/vitest.log` gives 0. 3479 tests today.
- svelte-check: 0 errors (11 warnings today).
- gate: `TMPDIR=$SDD/tmp zsh scripts/visual-refresh-gate.sh` from `frontend/` gives 3029 or more, with 0 failures. When a pinned rule changes on purpose, change its gate row in the same task.
- Svelte autofixer on each touched `.svelte` file: `npx @sveltejs/mcp svelte-autofixer <path>`. Notes must match HEAD's or be fixed.

**The user's calls (2026-11-14), numbered as in `calls.md`:**
1. The quiz chip rounds DOWN (`Math.floor`): 199/200 shows `Quiz 99%`.
2. Hide the ✓ beside the quiz chip at 0% (ProgressMeter and CourseProgress).
3. A block with no items shows no progress meter and no progress card.
4. ~~Mini-project-only block collapsed~~: left as designed. Delete the bullet in Task 1.
5. A read-only Version settings modal shows a muted line: `Only a created version can change its info` (the `metaReason` sentence).
6. Versions page: when a list error withdraws an open navigation question, the navigation counts as confirmed.
7. AssetSidebar: while a row's question is open, Escape anywhere on that row cancels it, and the item editor stays open.
8. Item editor header: trash and × sit 6px apart. Modal gets a header-actions spot beside ×.
9. Quiz editor: a choice answer row keeps its height while its field is open.
10. A ✕ "Cancel" IconButton beside a ✓ rings gray. Chevrons, `+ add` lines and card footer links stay steel-blue.
11. `&amp;` in a bare URL: leave it (markdown-it parity), and pin it with a test.
12. Stored `content_html`: from the beta on, each renderer change that affects stored content ships an Alembic data migration that re-renders it. Write this policy down in `backend/mathion/markdown.py`'s header. No migration in this round: it is pre-beta, and the Polish 3 spec says "no backfill before the beta".
13. Run Overview: offline (a fetch `TypeError`), InlineName and the run Delete say `Could not reach server. Check your connection.` (`OFFLINE_MESSAGE`). Other failures keep their own wording.
14. New run: `End date must be on or after the start date.` The Overview's 422 keeps its date and its tip.
15. Progress: remove the inert `position: sticky` rule from `.block-header, .seq-header`.
16. Overview: `Wait for the current change to save` under an open field becomes a neutral muted hint. It does not set `aria-invalid`, and it clears when the switch's save ends.
17. Roster: during a bulk operation, each row's 🗑, its group select and Add are disabled, with the title `Wait for the current change to finish` (`BUSY_TITLE`).
18. Grading side panel: × while the discard question shows re-arms the question with source `close`, so that Discard then closes the panel.
19. Grading side panel, Edit: Save's disabled title is `Without a feedback file the result can only be Accepted.` (`LOCK_TEXT`).
20. ~~The toast covers the panel's badge~~: left as is. Delete the bullet in Task 8.

**Copy re-used from the app (no new sentences):**
- A write that succeeded but whose refresh failed: `<Done> (refresh failed — reload to see latest)` as an `'info'` toast, as in `MiniProjectModal.svelte:506`. `<Done>` is `Added`, `Created`, `Uploaded`, `Removed` or `Saved`.
- A secondary reload failure: `'info'`, never a second `'error'` (QuizBody resync).
- A network failure on a load or refresh: `Check your connection and try again.` (`CourseList.svelte:34`).
- A network failure on a write: `OFFLINE_MESSAGE` (`lib/api.ts:35`).
- Wait titles stay per area: `Wait for the save to finish` (quiz, `WAIT_TITLE`), `Wait for the current change to save` (Overview `WAIT`), and `Wait for the current change to finish` (Roster `BUSY_TITLE`).

**One sentence the user has NOT seen yet; confirm it at plan review:**
- (T3.2) When a version goes read-only under an open, edited title: the toast `Editing closed — this version is no longer editable`, as an `'info'`. This is the old InlineField's sentence.

**Calls made by the planner (marked "my call" where used):**
- Root-relative content links (`/courses`) are skipped as asset references, and also protocol-relative ones (`//host/x`). A click on a root-relative link routes in-app, the same way C6 routes a same-origin full address.
- A loose list gets a renderer-side class `loose` on its `<ul>`/`<ol>`. `content.css` keeps the `:has(> li > p)` rule, so HTML stored before the change still works (call 12: no backfill pre-beta).
- InlineName's 422 with a list detail shows the first item's `msg`, not "Please correct the highlighted fields.".
- The closed-form create toast with a mixed 422 shows the field message, then the unmapped part, joined by a space.
- The Teaching crumb carries the last `?status=` through a small module store (`lib/teachingFilter.svelte.ts`), set by the Teaching page and read by `TeachingCrumbs`.
- The CJK IME guard (`e.isComposing || e.keyCode === 229`) goes on every Enter handler named in 5c. This is low priority (user, 2026-10-10), but it is one line each.

## Review Focus

- **The quiz draft cleared at send must come back on every failure path.** Network `TypeError`, 5xx, 422 and 409 each have their own expectation: a 409 records the exhausted count and drops the draft (T1). A test for each, and the leave-page warning after each.
- **Root-relative links reach the save path, not only the preview.** `extract_asset_filenames` feeds both preview and save/publish. A test saves an item whose body links `/courses` and checks that publish passes (T2).
- **"Disabled during X" flags must clear on every exit.** Roster bulk ops (T9), create posting (T3/T4) and side-panel saves (T8): each has a test where the request rejects and the control works again afterwards.
- **Focus repairs must never steal focus.** Every new `repairFocus`/`focus()` in T3, T5, T7–T9 runs only when focus is on `<body>` or inside the removed element. Each gets a test where the user has moved focus elsewhere first.
- **The gray ring is only for ✕ Cancel.** A test mounts an IconButton with the new prop and one without it, and checks that `--ring` differs (T3).

---

### Task 1: Student player and course page

**Files:**
- Modify: `frontend/src/components/items/QuizItem.svelte` (`submit()`, `lastAttempt`), `frontend/src/stores/` course state (`recordQuizAttempt`)
- Modify: `frontend/src/components/SequencePlayer.svelte` (re-resolve, ← / →, Finish)
- Modify: `frontend/src/lib/progress.ts` (`quizPct`), `frontend/src/components/course/ProgressMeter.svelte`, `CourseProgress.svelte`, `BlockGroup.svelte`, `CourseView.svelte`
- Delete: `formatProgress` from `frontend/src/lib/format.ts`, and its tests in `frontend/src/tests/format.test.ts`
- Test: `QuizItem.svelte.test.ts`, `SequencePlayer.svelte.test.ts`, `progress.test.ts`, `CourseView.svelte.test.ts`, `ProgressMeter` tests; gate rows for the chip
- Backlog: polish3 §Task 1 (3 bullets), §Task 2, §Safari "Keyboard focus drops…"; slice5c §Student-view follow-up (2 [open]), §follow-up 2 ([open]), §Collapse/expand all (both bullets, the [open] one deleted per call 4); `git rm` `format-progress-helper-now-unused.md`.

**Interfaces:**
- Produces: `recordQuizAttempt` ignores a write whose attempt count is lower than the stored one.

- [ ] **Step 1: RED tests**
  1. `a submit clears the draft when sent and restores it on failure`: hold `submitQuiz`; the draft store is empty while it is in flight. Reject it with a `TypeError`, then a 500, then a 422: the draft is back each time, and the form is unlocked with the answers.
  2. `the questions are locked while a submit is in flight`: every input is `disabled` (or the fieldset is) until it settles.
  3. `a return mid-submit shows an empty form, and a late result does not lock over typed answers`: remount during the held submit, type, then resolve. The form keeps the typed answer and stays open. The draft holds the typed answer.
  4. `a lower attempt count never overwrites a higher one`: two submits resolve out of order (count 2, then count 1). The store keeps 2 with attempt 2's score and answers, and `lastAttempt` shows 2.
  5. `a 409 drops the draft and records the exhausted count`: after the 409, Next then Previous shows the result/exhausted state, not the form. No leave-page warning.
  6. `a link to another sequence with a non-member #item= opens its first item`: also an empty `#item=`. Re-decide the old pin "stale non-member hash shows no item": the new expectation is the first item (flatIndex 0), never "Item 0 of 1".
  7. `← on the first item keeps focus`: Enter on ← that lands on item 1 leaves focus on ←, which is `aria-disabled="true"`; a second Enter does nothing. `→ onto the last item moves focus to Finish`.
  8. `quizPct rounds down`: 199/200 → 99; 200/200 → 100; 1/3 → 33.
  9. `the quiz chip hides ✓ at 0%`: in ProgressMeter and CourseProgress, `quizPct === 0` renders `Quiz 0%` with no ✓, and 1% renders the ✓.
  10. `a block with no items shows no meter and no card`: BlockGroup has no meter, and CourseView has no progress card for it. A block with items is unchanged.
  11. `an aborted course load does not touch open or loading`: slug A → B with A resolving after the switch. `loading` stays true until B settles, and `open` is B's.
- [ ] **Step 2: Run; each fails for its own reason.**
- [ ] **Step 3: Implement**
  - QuizItem: clear the draft at send, and put it back in the `catch` for every non-409 failure. A 409 calls `recordQuizAttempt` with the exhausted count and drops the draft. Lock the questions while `inflight`. The stored-result card locks only when the live answers are empty.
  - `recordQuizAttempt` and `lastAttempt`: take the larger count, and skip the whole store write when the count is lower.
  - SequencePlayer: drop the `#item=` clause from the re-resolve. ← gets `aria-disabled` plus a guard in `previous()` (the C7 way). After a → that reaches the last item, `repairFocus` to Finish.
  - `quizPct`: `Math.floor`. Hide the ✓ when `quizPct === 0`. Gate the meter and card on `total > 0`.
  - CourseView: a `cancelled` flag set by the effect cleanup, checked in `.then` and `.finally`.
  - Delete `formatProgress` and its two tests.
- [ ] **Step 4: Suites green.**
- [ ] **Step 5: Shots**: the course page at 1280 and 400px (chip at 0% and at 99%, an empty block); the player at its first and last item with the focus visible.
- [ ] **Step 6: Reviews** (Opus + Fable), fix, re-review until clean.
- [ ] **Step 7: Commit on the user's OK**: `fix(student): quiz drafts, player ends and course-page progress from the backlog`.

### Task 2: Content renderer

**Files:**
- Modify: `backend/mathion/markdown.py` (`extract_asset_filenames`, `_glues`, the D66 seam, list class, the header comment on the backfill policy)
- Modify: `frontend/src/styles/content.css` (`.prose ul.loose, .prose ol.loose` beside the `:has` rule)
- Modify: the in-app link handler that C6 added (`frontend/src/lib/externalLinks.ts` or wherever C6 routes same-origin links), so that it routes a root-relative href
- Test: `backend/tests/test_markdown*.py`, `backend/tests/` item save/publish test; `frontend/src/tests/externalLinks.test.ts`; gate row for `.loose`
- Backlog: polish3 §Safari "A root-relative content link…"; polish2 §Task 3 (loose list), §Task 6 ([open] `&amp;`, per call 11), §Whole-branch review (D66 seam; empty `text` token) and the [open] backfill bullet (per call 12).

- [ ] **Step 1: RED tests**
  1. `test_root_relative_link_is_not_an_asset`: `[All courses](/courses)` and `[x](//host/a)` give no asset names. `test_item_with_root_relative_link_saves_and_publishes`: an item whose body links `/courses` saves and publishes (Review Focus).
  2. `test_loose_list_gets_class`: a blank-line-separated list whose items are only code blocks gets `<ul class="loose">`, and a tight list gets no class.
  3. `test_bare_url_trimmed_boundary_links`: `(https://x.org)*note*` links `https://x.org`, and `See https://x.org.**Note** that` links `https://x.org`. Rows that D66 pins as plain stay plain.
  4. `test_bare_url_skips_empty_text_token`: `*https://x.org/caf*__é__` does not link `https://x.org/caf`.
  5. `test_bare_url_entity_ends_link` (call 11): `https://x.org/?a=1&amp;b=2` links `https://x.org/?a=1` only (pins today's behaviour).
  6. Frontend `a root-relative content link routes in-app`: a click on `<a href="/courses">` inside `.prose` calls the router and does not reload the page.
- [ ] **Step 2: Run; 1–4 and 6 fail. 5 passes: it is a pin, so record that in the ledger.**
- [ ] **Step 3: Implement**
  - Skip targets starting with `/`.
  - Add the loose-list class through markdown-it's token `hidden` flags on `paragraph_open` within the list.
  - D66: trim first, and glue only when nothing (or a word character) was trimmed.
  - `_glues`: skip empty `text` tokens.
  - Header comment with the call-12 policy (tag `VR-B12`).
  - CSS: add the `.loose` selector to the D85 rule.
- [ ] **Step 4: Suites green** (backend and frontend).
- [ ] **Step 5: Shots**: a page item with a loose code-block list.
- [ ] **Step 6: Reviews**, fix, re-review until clean.
- [ ] **Step 7: Commit on the user's OK**: `fix(content): root-relative links, loose lists and bare-URL seams`.

### Task 3: Constructor — headers, renames, add rows, ✕ ring

**Files:**
- Modify: `frontend/src/components/editor/AccordionHeader.svelte`, `BlockAccordion.svelte`, `SequenceAccordion.svelte`, `frontend/src/pages/editor/VersionEditPage.svelte`
- Modify: `frontend/src/components/ui/IconButton.svelte` (a `cancel` prop → gray `--ring`), and its ✕ Cancel call sites: `InlineName.svelte`, `AccordionHeader.svelte`, `BlockAccordion.svelte`, `ItemEditorModal.svelte`, KeyAnswer (quiz)
- Test: `AccordionHeader`, `BlockAccordion`, `SequenceAccordion`, `VersionEditPage`, `IconButton` tests; gate rows (add-row centring, gray ring)
- Backlog: slice5c §T2 (4 bullets), §T3, §Whole-branch review; polish3 §Safari "The create rows' ✓ and ×…"; polish2 §Task 1 [open] (call 10); polish2 is then empty → `git rm`.

- [ ] **Step 1: RED tests**
  1. `Enter mid-IME does not commit a title`: a keydown Enter with `isComposing: false, keyCode: 229` leaves the field open.
  2. `a read-only flip under an edited title toasts and refocuses the row`: the toast is `Editing closed — this version is no longer editable` (info), and focus goes to the row header, not `<body>`.
  3. `a rename 403/409 reloads the tree`: `loadAdminTree` is called with `{ force: true }`, for both block and sequence.
  4. `✎ is disabled while a closed rename still saves`.
  5. `the leave guard does not ask while a rename is saving`.
  6. `Enter on + Add right after a create opens the form`: the POST resolves, the reload is still held, and Enter opens the add row.
  7. `the add rows centre ✓ and × on the field`: a gate row checks the 30px flex wrapper, as the rename row has.
  8. `a ✕ Cancel rings gray`: an IconButton with `cancel` sets the gray ring token. Without it, the ring is steel-blue (Review Focus).
- [ ] **Step 2: Run; each fails.**
- [ ] **Step 3: Implement**
  - Add the IME guard.
  - On the `!canEditTitle` flip while dirty: show the toast, then `repairFocus` to the header.
  - On 403/409, call `loadAdminTree(…, { force: true })`.
  - ✎: `disabled={busy || saving}`.
  - The guard: `renaming && !saving && dirty`.
  - Add a `posting` flag, separate from `createBusy`. `openAdd` checks `posting` only.
  - Wrap the add-row buttons in a span.
  - Add an IconButton `cancel` prop and pass it at each ✕ Cancel site.
- [ ] **Step 4: Suites green.**
- [ ] **Step 5: Shots**: an add row beside a rename row; a ✕ Cancel with keyboard focus.
- [ ] **Step 6: Reviews**, fix, re-review until clean.
- [ ] **Step 7: Commit on the user's OK**: `fix(constructor): header renames, add rows and the ✕ ring from the backlog`.

### Task 4: Version settings, New item, Versions page, create errors

**Files:**
- Modify: `frontend/src/components/editor/VersionSettingsModal.svelte`, the New item modal (`NewItemModal.svelte`), `frontend/src/pages/editor/VersionsPage.svelte`, `frontend/src/lib/formErrors.ts`, the closed-form create toast in the accordion bodies (5a T5b)
- Test: the matching `*.svelte.test.ts`, `formErrors.test.ts`
- Backlog: slice5c §T4 (3), §T5 (Back+discard, stale permissions, IME, [open] reason per call 5), §Mandatory version label (slice5c is then empty → `git rm`); slice5a (its one bullet; the file is then empty → `git rm`); polish3 §Task 8 "A failed list reload…" and [open] (call 6).

- [ ] **Step 1: RED tests**
  1. `the type picker is frozen while posting, and a 422 maps against the sent type`.
  2. `discard during an in-flight create neither opens the item nor blurs`: the late success toasts `Item created` and stays put.
  3. `the title is sent trimmed`: `"  Dot "` is sent as `Dot`, and the heading is `# Dot`.
  4. `Back + discard while saving does not save`: the guard does not ask while `saving`.
  5. `a Save 403/409 reloads the tree and the modal turns read-only`.
  6. `Enter mid-IME does not save`: `keyCode: 229`.
  7. `a read-only modal shows the reason`: the muted line is `Only a created version can change its info`.
  8. `blank label and bad attempts show both errors on one Save`.
  9. `a network failure on create says OFFLINE_MESSAGE`: `formErrors` maps a `TypeError` to `OFFLINE_MESSAGE`. The mixed 422 toast shows field + unmapped (my call).
  10. `a failed list reload moves a free focus to Back to courses`.
  11. `a list error under an open navigation question lets the navigation go` (call 6).
- [ ] **Step 2: Run; each fails.**
- [ ] **Step 3: Implement** as each bullet says: `sentType` snapshot plus a disabled fieldset; `const open = creating`; `title.trim()`; `isDirty: dirty && !saving`; force reload on 403/409; IME guard in `onEnter`; set both field errors; the reason line from `metaReason`; `formErrors` offline; the VersionsPage error effect repairs focus and settles the question as confirmed.
- [ ] **Step 4: Suites green.**
- [ ] **Step 5: Shots**: the read-only Version settings modal.
- [ ] **Step 6: Reviews**, fix, re-review until clean.
- [ ] **Step 7: Commit on the user's OK**: `fix(authoring): version settings, new item and versions page from the backlog`.

### Task 5: Item editor

**Files:**
- Modify: `frontend/src/components/editor/ItemEditorModal.svelte`, `frontend/src/components/ui/Modal.svelte` (header-actions snippet beside ×; keydown ignores modifier-only keys), `frontend/src/components/editor/AssetSidebar.svelte`, `frontend/src/components/editor/item/AppBody.svelte`, `frontend/src/pages/editor/VersionEditPage.svelte` (`deleteOpenItem`)
- Test: `ItemEditorModal`, `Modal`, `AssetSidebar`, `AppBody`, `VersionEditPage` tests; gate rows (header gap 6px, disabled row colour, AppBody error column)
- Backlog: slice5b §T2 (disabled rows, [open] Esc per call 7), §T3a [open] (call 8), §T3b (3), §T4 (3), §Final (2); polish3 §Task 4 "A busy asset question…", §WBR "Modal focuses its panel…"; polish1 §Task 2.

- [ ] **Step 1: RED tests**
  1. `disabled asset rows use --faint`: a gate row.
  2. `Escape on a row with an open question cancels it`: focus on the insert button, Escape → the question is closed and the modal is still open.
  3. `a busy question remounted after a failed reload does not take focus`.
  4. `trash and × sit 6px apart`: a gate row on the new header-actions spot.
  5. `a late DELETE success does not steal focus`: focus sits in the New item field, and the DELETE resolves; focus stays.
  6. `B's trash is disabled while A's DELETE runs`, with a reason title.
  7. `a DELETE that lands after a version switch still toasts Item deleted`.
  8. `a 409 on the link PATCH after upload is not the duplicate-name message, and reloads the tree`.
  9. `App uploaded with a failed refresh toasts the refresh-failed info`.
  10. `the AppBody error sits under the value`.
  11. `a busy trash and × give the wait reason`: their titles are `Wait for the save to finish`.
  12. `Shift alone does not focus the modal panel`.
  13. `trash while the page question shows focuses its Cancel` (R53).
- [ ] **Step 2: Run; each fails.**
- [ ] **Step 3: Implement** as the bullets say. Modal gains an optional `headActions` snippet rendered beside × inside a 6px group. ItemEditorModal moves the trash into it.
- [ ] **Step 4: Suites green.**
- [ ] **Step 5: Shots**: the item editor header; an asset row disabled; the AppBody error.
- [ ] **Step 6: Reviews**, fix, re-review until clean.
- [ ] **Step 7: Commit on the user's OK**: `fix(item-editor): header, assets and delete races from the backlog`.

### Task 6: Quiz editor

**Files:**
- Modify: `frontend/src/components/editor/quiz/QuizBody.svelte`, `QuizHeader` (title), `KeyAnswer.svelte`, `ChoiceAnswers.svelte`, `ChoiceRow.svelte` / `InlineInput.svelte`, `frontend/src/lib/quizEdits.svelte.ts` (`ownOpen`)
- Test: the matching tests; a gate row for the steady row height
- Backlog: slice5b §T6 (slice5b is then empty → `git rm`); slice5d (3 bullets incl. [open] per call 9; the file is then empty → `git rm`); polish1 §Task 5, §Task 6, §Whole-branch review (the file is then empty → `git rm` once Task 5 has taken §Task 2).

- [ ] **Step 1: RED tests**
  1. `the resync failure toast is info`.
  2. `a tree reload while the title is open is applied on Cancel`.
  3. `Number key 5.0 over a stored 5 is unchanged`: numeric compare, so no D10 prompt.
  4. `an answer row keeps its height when its field opens`: a gate row (heights equal).
  5. `marking C with the key question open refocuses it before asking D10`.
  6. `Delete after a dirty edit opened elsewhere asks D10`.
  7. `× with an inline question open focuses that question`: only one question on screen.
- [ ] **Step 2: Run; each fails.**
- [ ] **Step 3: Implement** as the bullets say.
- [ ] **Step 4: Suites green.**
- [ ] **Step 5: Shots**: an answer row closed vs open.
- [ ] **Step 6: Reviews**, fix, re-review until clean.
- [ ] **Step 7: Commit on the user's OK**: `fix(quiz-editor): keys, answer rows and questions from the backlog`.

### Task 7: Run Overview, run delete, lists and crumb

**Files:**
- Modify: `frontend/src/components/ui/InlineName.svelte` (offline sentence, 422 list → first msg, a neutral hint path), `frontend/src/components/ui/InlineConfirm.svelte` (in-flight guard, disabled reason), `frontend/src/components/runs/RunOverviewTab.svelte`, `frontend/src/components/runs/NewRunModal.svelte`, `frontend/src/pages/runs/RunDetailPage.svelte` (`onDeleteRun`), `frontend/src/components/runs/TeachingCrumbs.svelte`, the Teaching page, new `frontend/src/lib/teachingFilter.svelte.ts`
- Test: the matching tests
- Backlog: polish3 §Task 8 "The Teaching crumb…", §WBR [open] ×2 (calls 13, 14); slice6a §T3, §T6; slice6c §Task 1, §Task 2 (2), §Task 1 [open] (call 16), §WBR (3).

- [ ] **Step 1: RED tests**
  1. `InlineName offline says OFFLINE_MESSAGE`, and `the run Delete offline says OFFLINE_MESSAGE` (call 13).
  2. `InlineName 422 list shows the first msg`.
  3. `the wait line is a neutral hint`: no `aria-invalid`, no error class, and it clears when the switch settles (call 16).
  4. `New run date sentence`: `End date must be on or after the start date.` (call 14).
  5. `a double click on Confirm Delete sends one request`.
  6. `the Unpublish confirm's button gives the wait reason during a field save`.
  7. `🗑 does not close the panel while a write runs`.
  8. `a failed forced delete after leaving the Overview toasts`.
  9. `a delete that lands after moving to another run does not navigate`.
  10. `a delete that 404s takes the Run deleted path`.
  11. `the Teaching crumb keeps the status filter`: filter Upcoming, open a run; the crumb href is `/teaching?status=upcoming`.
- [ ] **Step 2: Run; each fails.**
- [ ] **Step 3: Implement** as the bullets and calls say.
- [ ] **Step 4: Suites green.**
- [ ] **Step 5: Shots**: the Overview with the wait hint.
- [ ] **Step 6: Reviews**, fix, re-review until clean.
- [ ] **Step 7: Commit on the user's OK**: `fix(teaching): run overview, delete and crumb from the backlog`.

### Task 8: Run tabs — Progress, Submissions, Assets, Mini-projects, Groups, Teachers, side panel

**Files:**
- Modify: `frontend/src/components/runs/RunProgressTab.svelte`, `RunSubmissionTab.svelte`, `RunAssetsTab.svelte`, the Mini-projects tab and its "used by" panel, `RunGroupsTab.svelte`, `RunTeachersTab.svelte`, `DashboardSidePanel.svelte`
- Test: the matching tests; a gate row for the sticky removal
- Backlog: slice6a §T7 [open] (call 15), §T9 (2), §T10 (2), §Final (2); polish3 §Task 7, §WBR "A failed Refresh…", and the Teachers half of "An offline Roster or Teachers add…"; slice6c §Task 5 [open] (call 18), §Task 6 [open] (call 19), the toast [open] deleted per call 20. The slice6a file is then empty → `git rm`.

- [ ] **Step 1: RED tests**
  1. `the Progress headers carry no sticky rule`: a gate row.
  2. `a failed Refresh says Check your connection and try again.`: on Progress and on Submissions.
  3. `a failed force delete focuses the panel's checkbox`.
  4. `an admin's 409 on a still-unlocked row toasts the server message`.
  5. `an Assets 403 on force delete toasts and refetches the course only`: the page stays, and focus stays.
  6. `Delete N selected is disabled while a bulk delete runs`.
  7. `the used-by panel keeps focus when only its entry goes`: focus moves to the next Edit, else to the chip.
  8. `addGroup: a failed refetch after create clears the field and toasts Created (refresh failed — reload to see latest)`.
  9. `Teachers add returns focus only if it is still free`.
  10. `an offline Teachers add leaves the field unmarked`.
  11. `× during the discard question, then Discard, closes the panel` (call 18).
  12. `Save's title in a locked edit is the lock sentence` (call 19).
- [ ] **Step 2: Run; each fails.**
- [ ] **Step 3: Implement** as the bullets and calls say.
- [ ] **Step 4: Suites green.**
- [ ] **Step 5: Shots**: none expected (no visible layout change). If the sticky removal changes anything visible, take a Progress shot.
- [ ] **Step 6: Reviews**, fix, re-review until clean.
- [ ] **Step 7: Commit on the user's OK**: `fix(teaching): run tabs and the grading panel from the backlog`.

### Task 9: Roster, Import and Publish conflicts

**Files:**
- Modify: `frontend/src/components/runs/RunRosterTab.svelte`, `RosterImportModal.svelte`, `PublishConflictsModal.svelte`, `frontend/src/lib/csv.ts`
- Test: `RunRosterTab*.svelte.test.ts`, `RosterImportModal`, `PublishConflictsModal`, `csv.test.ts`
- Backlog: polish3 §Task 4 (2 select bullets), the Roster half of §WBR "An offline Roster…" (then the bullet goes), and polish3 is then empty → `git rm`; slice6b (4; the file is then empty → `git rm`); slice6c §Task 3 (2), §Task 4 (4), §Task 4 [open] (call 17). The slice6c file is then empty → `git rm`.

- [ ] **Step 1: RED tests**
  1. `two quick group selects: focus repairs to the last changed`.
  2. `a failed groups refetch does not free a newer change`: row B's second change is still pending, so the select stays disabled. The refetch failure toasts `Saved (refresh failed — reload to see latest)`.
  3. `an offline add leaves the e-mail field unmarked`.
  4. `close requests during an add give the wait reason`: × and Cancel are `aria-disabled` with `BUSY_TITLE`.
  5. `an add whose refetch fails toasts Added (refresh failed — reload to see latest)`: there is no error under the row.
  6. `a stale pendingDelete is cleared when the student leaves the roster`.
  7. `Cancel during a slow Remove keeps focus on that row's 🗑`, and the confirm shows busy.
  8. `other rows' 🗑 give the wait reason while a remove runs`.
  9. `the strip drops a selected student a refresh removed`.
  10. `row 🗑, group selects and Add are disabled during a bulk op` (call 17), and they work again after the bulk op rejects (Review Focus).
  11. `single-student publish conflict e-mails are mono`; `re-bucketed e-mails are mono` with the `+N more` cut kept.
  12. `copied failed rows match the Detail column`.
  13. `csv`: these three cases parse as described in the bullet:
      - `\tG1` / `b@x.com\tG2` stays e-mail-first;
      - a lone `,` line is skipped;
      - `a@x.com\t\tG1` keeps G1.
- [ ] **Step 2: Run; each fails.**
- [ ] **Step 3: Implement** as the bullets and call 17 say.
- [ ] **Step 4: Suites green.**
- [ ] **Step 5: Shots**: the Import counts line with mono e-mails; a publish-conflicts single-student sentence.
- [ ] **Step 6: Reviews**, fix, re-review until clean.
- [ ] **Step 7: Commit on the user's OK**: `fix(teaching): roster, import and publish conflicts from the backlog`.

---

## After Task 9

1. Whole-branch review: fresh Opus + Fable, then Codex.
2. Safari pass, one step at a time.
3. Cleanup.
4. Merge only on the user's word.

`docs/backlog/` should then hold only `beta-voiceover-pass.md`, `beta-browser-pass.md` and the files from outside this round.
