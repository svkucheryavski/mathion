# Polish 1 (confirms) — deferred minors

Walked 2026-11-14 against main `1c904f9`: done and code-only items were dropped, screen-reader items moved to `beta-voiceover-pass.md`, by-hand browser checks to `beta-browser-pass.md`. What is left goes into one fix round; **[open]** marks an item that needs the user's call first.

## Task 2

- **ItemEditorModal trash while the page question is drawn there** returns silently (`if (trashDisabled || asking) return;`) instead of R53's "refuse the same way" (focus to that question's Cancel); the trash is aria-disabled with "Answer the question first". (Fable lane)

## Task 5

- **ChoiceAnswers `mark`: the R53 check (`ctx.published && markAsk.open` → `focusCancel`) runs after the D10 question**: with the key question open for answer A and another answer's text edit dirty, clicking marker C asks D10 first; after Discard the mark only refocuses the open key question, so the draft went for an action that never runs. Fix: move the check above `request()`. (Opus lane)

## Task 6

- **QuizBody `remove`: the post-question re-check never re-asks D10**: open the delete question on one card, then open and change an answer edit on another, then Delete — the delete runs with a dirty edit open elsewhere (the old synchronous `confirm()` could not interleave). Consider `edits.active?.dirty` in the re-check, or re-running `requestStructure()`. (Fable lane)

## Whole-branch review

- **Two questions on screen in the quiz item modal**: with an inline edit's own question open (D10 at an answer row, or the key question), × or Back draws the page question in the body-top row; the inline one sits inert beneath it. Cancel brings it back; nothing is lost. Fix: `ownOpen()` also reports the open edit's question, so the guard refuses and focuses it (R53). (Fable)
