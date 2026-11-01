# Polish 3 (the reviewers' minors) — deferred minors

Minors the review lanes raised and the user did not take into the slice, by task.
Spec: `docs/superpowers/specs/2026-10-31-visual-refresh-polish3-minors-design.md`.
Plan: `docs/superpowers/plans/2026-10-31-visual-refresh-polish3-minors.md`.

## Task 1 — each item its own instance, the attempt count, quiz drafts

- **A submit in flight keeps its draft.** The draft is cleared only when the response arrives (`QuizItem.svelte` `submit()`). Two effects:
  - leaving the quiz and coming back before then shows a filled, unlocked form, so the same answers can be submitted twice. The late response then drops the draft while the remounted form still shows the answers (harmless: those answers were sent). Since D89 the return should show the result card; the draft present at mount keeps the open form instead. Fix: clear the draft when the request is sent and put it back if it fails, which also lets D89's card show (D89 r1, Opus M1);
  - an answer changed during the request is written to the draft and then dropped on success, while the locked form still shows it. Fix: lock the questions while `inflight`.

  (both lanes, r1; Opus r2)
- **Two submits answered out of order can write the lower attempt count.** `recordQuizAttempt` takes the response's count as is, and after Try again QuizItem's `lastAttempt` memo can hide a newer, higher store count, so the attempts line shows one more than is left. Both need the double in-flight submit above. Fix: take the larger count in both places (Opus r1 M1, r3 m1).
- **A submit refused with 409** ("max attempts reached", e.g. another tab used the attempts) keeps its draft, and the page warns on a reload or tab close (a confirmed reload then drops it). A 409 updates no store count, so Next/Previous or a sequence move restores the draft and reopens the form. The draft goes only when the course state reloads (the course page loads it again) and the remount auto-reveals, or on a full page reload. Fix: clear the draft on that 409 and record the exhausted count (Opus r1 M3; corrected by both lanes, r2).
- **The gate row for C13 counts the text `{#key item.id}` only.** A copy in a comment, or a key that wraps part of the branch chain, would still pass. An AST or markup-scanner row would pin the key as the outermost block (Opus r1 M5).
- `setAnswer` snapshots `answers` and `setDraft` snapshots again: one snapshot is enough (Fable r1).
- `currentCourse.recordQuizAttempt.test.ts`: `warn.mockRestore()` is not in a `finally` or `afterEach`, so a failing field assertion would leak the `console.warn` spy into the next test (harmless pass-through; both lanes, r5).

## Task 2 — in-app links and the course crumb

- **A content link to another sequence with a non-member `#item=` opens an empty player** ("Item 0 of 1", no item body). This includes an empty `#item=`. Before C6 the link reloaded the app, and a fresh load resolved to an item. On the reused player instance, the re-resolve skips any address with `#item=`, because `SequencePlayer.svelte.test.ts` pins that a stale non-member hash shows no item (flatIndex −1). It only happens after an authoring mistake. Fix: drop the hash clause from the re-resolve and re-decide that pin (both lanes, r3).

## Task 3 — the focus primitives

- **"Focus is nowhere" has two definitions.** The ⌘S clause (ItemEditorModal and the three level-3 quiz modals) counts `<body>` and `document.documentElement`. Modal's key backstop, `repairFocus` and FocusTrap's `opener()` count only null and `<body>`. `documentElement` as `activeElement` is practically unreachable, so this is harmless today. Fix: one shared `focusIsLoose()` helper (both lanes, r1).
- **The press record only knows `button, a[href], [role=button]`.** A modal opened from a `[role=switch]`, `<summary>` or a checkbox/radio by mouse in Safari would still return focus to `<body>`. No current F13 opener is one; all are `<button>`s. Fix: widen the selector when such an opener appears (Fable r1).
- `FocusTrap.svelte.test.ts`: "a keydown after the press clears the record" and "a press on a non-control resets the record" assert `.not.toBe(b)`; `toBe(document.body)` would also catch focus going somewhere else. "focus already on the opener is kept as is" focuses a different control than the pressed one; rename it to "focus already on a real control is kept" (Opus r3).

## Task 4 — the focus sites

- **Two row group selects changed in quick succession: the first to settle takes focus.** Row A's request is in flight (A disabled, focus on `<body>`); the user changes row B (B disabled too). A settles first, and `repairFocus(selA, search)` focuses A, not the control last used; B's repair then sees focus on A and does nothing. Fix: remember the last changed select and repair to it (Opus r1 M5).
- **A failed groups refetch frees a newer change of the same row.** `onGroupChange` awaits `onRefetchGroupsOnly()` inside the PATCH's `try`, so a rejected refetch runs the `catch`, which deletes the row's `pendingGroupId` entry, by then the entry of a newer change still in flight. The select is enabled again during that PATCH and shows the previous choice, so a third change can race it; an `ApiError` from the refetch also toasts after a change that succeeded, and since Polish 3 Task 8 a `TypeError` from it toasts the offline message. Focus stays right. Older than Polish 3, but the F8 at-land repair makes the window reachable from the keyboard. Fix: move the refetch out of the PATCH's `try` with its own catch (and decide what a failed refetch says), or keep a per-row request token (both lanes, r4).
- **A busy asset question that outlives a failed reload comes back with `takeFocus`.** The failed reload closes only an idle question; a busy one (its DELETE in flight) stays in `confirmId` while the rows are gone. If an outside reload succeeds before the DELETE settles, the row and its question remount and `InlineConfirm` takes focus. Very rare (a failed reload and a second reload inside one DELETE). Fix: keep the busy question's focus intent, or skip `takeFocus` on a remount (Opus r2 m4).

## Task 7 — teacher screens

- **Focus in the "used by" panel drops to `<body>` when only its own entry goes.** A reload that removes the focused mini-project's line from an open panel, while the chip keeps other uses, unmounts the focused Edit button; the D87 repair runs only when the chip drops to 0. Older than Polish 3. Fix: in the same `$effect.pre`, repair a focused panel button whose mini-project left the list to the panel's next Edit, else the chip (Fable r2 m1).
- **An empty load error leaves Progress and Submissions blank, with no Retry.** When the dashboard GET fails with no `detail` and an empty status text (HTTP/2 through a proxy 502, a plain-text 500), `ApiError.message` is `''`, so `error = ''` is falsy: no ErrorState, no Skeleton, no data, and the Refresh control is never drawn. Older than Polish 3 (`LoadingPlaceholder` was blank the same way). Fix: a non-empty fallback in `api.ts` (~:60) or in the tabs' catch, with a test that a `''` message still shows the error with Retry (Opus r3 m1).

## Task 8 — behaviour

- **The Teaching crumb on a run page drops the status filter.** `TeachingCrumbs.svelte:15` links to the bare `/teaching`, so a teacher who filtered to Upcoming or Finished and goes back through the crumb lands on Active; the browser's Back keeps `?status=` (C18). Fix: carry the last `?status=` into the crumb's link, or have the crumb go back in history when the previous entry is `/teaching?…` (Opus r1 m4).
- **A failed list reload leaves focus on `<body>`.** When a row action's reload fails, the page ErrorState replaces the frame; a focus parked on the `<h1>` (R54) or in the create form goes with it. Older than C8. Fix: in VersionsPage's error effect, repair a free focus to the ErrorState's "Back to courses" (Fable r2 M2).
- **A list error refuses the navigation whose question it withdraws.** The author clicked a link, the navigation question opened, and the reload failed: the form and its input are dropped, but that link resolves `false` (R55), so the author lands on "Couldn't load" and clicks again. A one-request window. Fix, if wanted: let the error effect settle an open navigation question as confirmed (Opus r2 m4).
- **The offline wording is one string by copy only.** `OFFLINE_MESSAGE` lives in `lib/api.ts`, but `lib/assets.ts:57, 99`, `lib/runAssets.ts:47, 93` and `lib/evaluations.ts:64` throw the same text as literals, so a wording change must touch six places. Fix: import the constant when those files are next touched (Fable r3 nit).

## Task 9 — backend

- **Submission and evaluation PDFs carry no `nosniff`.** C12 covered the two asset endpoints; `api/submissions.py` and `api/evaluations.py` serve their PDFs through `FileResponse` without `X-Content-Type-Options: nosniff`. The files are PDF-checked on upload, so the risk is small. Fix: the same `headers=` line on both (Fable r1).
- **An explicit `null` still misbehaves on a few other Update models.** C10 covered runs, questions and options. Probed live (Opus r3): Course `name: null` is a 500 (NOT NULL); Group `name: null` and `is_disabled: null` both answer a misleading 409 "Group name already exists in this run" (`api/groups.py:58-61` catches every `IntegrityError`); MiniProject `assignment_md: null` is a 500 (NOT NULL at autoflush). Already fine: Block / Sequence / Item `title` 422 in their handlers (`api/blocks.py:147`, `api/items.py:135`); `User.full_name` is nullable (200). Read but not probed: Course `description`, Block `info`, Evaluation `result` (Fable r3). Fix: `_reject_null` on each field whose column is NOT NULL (Course `description` and Block `info` may be empty, but not null), with a test each.

## Whole-branch review (71dd8cc..8bc9497)

- **Three offline sentences on one run page.** An offline title or date save on the Overview shows InlineName's "Could not save." (`InlineName.svelte:58-60`), while the groups switch and Publish/Unpublish toast `OFFLINE_MESSAGE`, and Delete says "Could not delete the run.". Spec rev 12 ("every offline write says the same thing") and its InlineName bullet disagree. Fix: InlineName maps a `TypeError` to `OFFLINE_MESSAGE` (Opus m1, Fable m2).
- **A failed Refresh shows the browser's raw text.** On Progress and Submissions (`RunProgressTab.svelte:63, 83`, `RunSubmissionTab.svelte:68, 88`) a failed Refresh shows "Failed to fetch" / "Load failed"; since C17 keeps the table, it sits above the still-visible rows. Older than Polish 3. Fix: map a non-API error to "Check your connection and try again." as CourseList does (Opus m2).
- **An offline Roster or Teachers add paints the e-mail field red.** `RunRosterTab.svelte:681` and `RunTeachersTab.svelte:97` set `aria-invalid` whenever `addError` is set, so `OFFLINE_MESSAGE` shows under a red field, the look C3 removed elsewhere for network failures. Fix: mark the field invalid only for an `ApiError` about the address (Fable m1).
- **Two wordings for the date rule.** `NewRunModal.svelte:22` says "End date must be on or after start date"; the Overview's 422 says "End date must be on or after the start date (01 Sep 2026). …" (Opus m3, nit).
- **A routed same-path content link without `#item=` drops the hash.** `SequencePlayer.svelte:74-82`: the player stays on its item, but the address loses `#item=…`, so a reload opens the sequence's first item (Fable m3).
- **`href="#"` in authored content appends a bare `#`** to the player address through `linkRouter` (spec rev 6 accepts it) (Fable m4).
- **Modal focuses its panel on every loose keydown, modifier-only included** (`Modal.svelte:95`). Cosmetic: a focus ring can flash on Shift or ⌘ alone (Fable m5).
- **The run-date 422 names the stored opposite date on a run the old check left inverted** (`api/runs.py:107`), so the message can name a date that is itself wrong. Only legacy rows (Fable m6, note).

