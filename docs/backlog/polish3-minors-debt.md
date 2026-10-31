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
