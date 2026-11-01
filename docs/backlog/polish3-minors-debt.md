# Polish 3 (the reviewers' minors) — deferred minors

Minors the review lanes raised and the user did not take into the slice, by task.
Spec: `docs/superpowers/specs/2026-10-31-visual-refresh-polish3-minors-design.md`.
Plan: `docs/superpowers/plans/2026-10-31-visual-refresh-polish3-minors.md`.

## Task 1 — each item its own instance, the attempt count, quiz drafts

- **A submit in flight keeps its draft.** The draft is cleared only when the response arrives (`QuizItem.svelte` `submit()`). Two effects:
  - leaving the quiz and coming back before then shows a filled, unlocked form, so the same answers can be submitted twice. The late response then drops the draft while the remounted form still shows the answers (harmless: those answers were sent). Fix: clear the draft when the request is sent and put it back if it fails;
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
