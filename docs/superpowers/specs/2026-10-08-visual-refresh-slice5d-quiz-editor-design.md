# Visual refresh — Slice 5d: a calm quiz editor (overview + small editing modals)

**Status:** draft, rev 2. Written 2026-10-08 for the user's review. Rev 2 folds in three independent spec reviews (two Opus, one Fable) and the user's decision D12.
**Branch:** `feat/visual-refresh-slice5-authoring`. It stays local: no push, no merge. 5d lands on top of 5c (tip `2511015`).

**Authority:**
- The decisions below were made with the user on 2026-10-08.
- The approved mockup is `.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/mockups/quiz-modal-5d.html` ("Nice!"). Its "± 0.01" Number line is stale; §Number below is the rule.
- The approved design summary is `.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/5d-design.html` ("ok").
- For the quiz item, this spec replaces the 5b quiz sections (one footer Save, drafts, the question accordion, the typed add forms). Where it is silent, 5b and 5c still hold.

## Why

The user, on the 5b/5c quiz modal: "The form is huge and very messy."

What the screen shows today:
- The modal is about 600px tall at a 900px window, and everything scrolls inside it.
- An open question stacks two full Markdown editors (Question, Explanation), each with its own "Course assets" sidebar. One question is about 1,100px tall, and its answer options sit at the very bottom.
- Questions still carry "Q1/Q2" codes and mono "single choice / 1 correct" labels, which 5c removed everywhere else.
- Reading and editing are mixed: you cannot see the quiz as a whole while editing any part of it.

## Decisions

The user's (2026-10-08):
- **D1 — Three levels.** *(The user's idea.)* Level 1 is the constructor page (unchanged). Level 2 is the quiz modal: a compact overview of the whole quiz. Level 3 is a small modal on top of it for each heavy edit.
- **D2 — Cards, not tabs.** The user offered one tab per question with a "+" tab. Declined: tabs show one question at a time (the overview this redesign exists for), overflow at 10–20 questions, and make reordering awkward.
- **D3 — Every edit saves itself.** No Save/Discard footer on the quiz modal (chosen over one Save for the whole quiz).
- **D4 — Question text is edited in a level-3 modal** with the full Markdown editor (Edit/Preview, course assets).
- **D5 — Answers are edited in place** on the card.
- **D6 — The explanation is edited in a small level-3 modal:** Markdown with preview, no images or files.
- **D7 — The overview shows rendered text** (the HTML students get), except in disabled versions (§Version states).
- **D12 — One small backend fix** (chosen over keeping 5b's two requests): marking an answer correct on a single-choice question clears the other correct answer in the same transaction (§Backend change). It is the only backend change in 5d.

Made in the design and approved with it:
- **D8 — Per-answer ↑ ↓ and delete appear on hover or keyboard focus** of the answer row. On devices without hover (`@media (hover: none)`) they are always shown.
- **D9 — Light hints on choice questions** (§A question card). They inform; nothing is blocked.
- **D10 — One inline edit at a time** (§Unsaved work).
- **D11 — The Markdown editor gains a "no assets" mode** for the explanation (§Level 3).

Made in rev 2 from the reviews, following existing rules:
- **D13 — Hide what the version forbids** (the 5c rule). Controls the version state does not allow are not rendered. Disabled-with-reason is only for momentary or local blocks: a write in flight, a first/last arrow, the only correct answer, the last correct mark.
- **D14 — Kept from 5b:** the first answer added to an empty single-choice question is created correct (5b §8.4); the only correct answer cannot be deleted (5b C2); a question delete asks for confirmation; an answer delete does not.

## Level 2 — the quiz modal

The modal shell, its header (type icon, title, context line "Vectors › Linear combination · item 3 of 4", delete, close), its stacking and its focus trap stay as in 5b/5c. The backdrop does not close it (unchanged).

### Header and title

- The title is an `h2`, the dialog's `aria-labelledby` target, with a ✎ beside it (only when the version allows text edits).
- ✎ turns the title into an inline field **inside the same `h2`**, so the dialog keeps its label. The 5c D8 rules apply: Enter or ✓ saves (one PATCH via `renameItem`), Esc or ✕ cancels without a request, an error shows under the field, moving focus away leaves it open.
- For quizzes only, the body's "Title" form row is removed. Page, Video and App keep it.

### No footer, and ⌘S

- For a quiz, the item modal renders no Save/Discard footer. Page, Video and App keep theirs exactly as today.
- ⌘S / Ctrl+S: in a level-3 modal it means Save. Anywhere else in the quiz modal it is swallowed (`preventDefault`), so the browser's own Save dialog never opens.

### The header trash (delete item)

- Disabled while any quiz write is in flight, and while an edit holds unsaved changes. Tooltip in the second case: "Delete this item — finish or discard the open edit first".

### First focus

- On open, focus goes to the title's ✎. When the version allows no text edits, it goes to the first card (or the close button if the quiz is empty).

### The body

- **Questions row:** "Questions" + the count; on the right a primary "+ Add question" (only when the version allows structure edits). This top-right primary button is a deliberate exception to 5c D9's quiet "+ Add" lines: in the quiz overview, adding a question is the main action.
- **Loading:** while the questions load, a skeleton. On failure: "Couldn't load the questions" + Retry.
- **Empty:** "No questions yet."
- **The list:** one card per question, in order, scrolling inside the modal body.

### A question card

The card is a list item, labelled by its rendered question text (`aria-labelledby`). From top to bottom:

1. **Head row**
   - a light ordinal "1." (`--ordinal`, aria-hidden, like the 5c block numbers);
   - the question text, rendered (`text_html`);
   - a type chip: "Single choice", "Multiple choice", "Number", "Text" (sans, not mono; the New-question type picker uses the same four labels);
   - D9 hints, if any, next to the chip;
   - actions: ✎ "Edit question 1" (opens level 3), ↑ "Move question 1 up", ↓ "Move question 1 down", delete "Delete question 1". The structure actions only when the version allows them (D13).
   - Below 560px the chip, hints and actions wrap onto a second line under the text.
2. **Answers** (§Answers).
3. **Explanation**
   - Present when `explanation_md` is non-empty after trimming: a small muted panel, "Explanation" + the rendered `explanation_html`, with ✎ "Edit explanation for question 1".
   - Absent: a quiet "+ Add explanation" link. Hidden when the version allows no text edits.

Rendered text in cards: images are capped at the card width; headings inside question text and explanations render at body size (no large headings in a card); links are live. Clicking the text does not edit it; only ✎ does.

**D9 hints** (choice questions, shown only once the answers have loaded):
- "No answers yet": no answers;
- "Add at least 2 answers": exactly one answer (publishing requires two, `versions.py`);
- "No correct answer": answers but none correct (possible for multiple choice, whose new answers start not correct).

**Number hint:** "Decimals not set" when `precision` is null (older data; such a question marks every answer wrong).

**Formulas.** The app does not typeset formulas anywhere today: the server wraps `$…$` in `<span class="math">`, and no client code draws them, so students see LaTeX source. The cards show the same. Typesetting is a separate, later change, out of scope.

## Answers, edited in place

### Loading

- Each card loads its own answers (`listOptions`; the question list does not include them).
- While loading: "Loading answers…". On failure: "Couldn't load answers" + Retry. Hints and "+ Add answer" appear only once loaded.

### Single and multiple choice

- Each answer is a compact row: a correct-marker and the answer text. A correct answer is tinted green with its marker filled and a small "correct" tag.
- **The marker is a button,** not a native radio or checkbox: `aria-pressed` = correct, accessible name `Correct answer: "11"`. Click, Enter or Space changes the key. Arrow keys do not.
- **Edit the text:** the text is a button; click it or press Enter on it. It becomes an inline field (plain text, 1–500 characters, trimmed). Enter or ✓ saves, Esc or ✕ cancels, an error shows under the field.
- **Correct, single choice:** clicking a not-correct answer makes it the one correct answer: one PATCH `is_correct: true`, and the server clears the old one in the same transaction (D12). Clicking the already-correct answer does nothing.
- **Correct, multiple choice:** clicking toggles that answer. The last correct marker cannot be cleared (the server rejects it with 422): it is disabled with the tooltip "At least one answer must stay correct".
- **Order and delete (D8):** ↑ ↓ and delete per row. Delete sends at once (no confirmation, as today). The only correct answer's delete is disabled with "Mark another answer correct first" (D14).
- **"+ Add answer":** opens an inline row in place. Enter creates the answer and keeps the row open, empty and focused, for the next one; Esc or ✕ closes it. The first answer of an empty single-choice question is created correct (D14); every other new answer starts not correct.

### Number

- Reads: "Answer **5** · 2 decimals (± 0.005)". The value prints as stored (the canonical string, never exponent notation). Singular "1 decimal". The tolerance is `5·10^-(decimals+1)`, printed with `toFixed(decimals + 1)` (so 6 decimals reads "± 0.0000005", not "5e-7").
- ✎ opens an inline editor: value and decimals (0–10), today's `validateNumericAnswer`. Enter or ✓ saves both in one PATCH, Esc or ✕ cancels.

### Text

- Reads: "Answer **unit vector**". ✎ opens an inline field (1–500 characters, trimmed). Enter or ✓ saves, Esc or ✕ cancels.

## Level 3 — the small modals

All three are separate modals stacked on top of the quiz modal through the existing modal stack: focus is trapped in the top modal, Esc closes the top one only, and on close focus returns to the control that opened it.

Shared rules:
- Close (Cancel, ×, Esc) with changes asks the DirtyGuard prompt (§Unsaved work); without changes it just closes.
- While Save runs: the editor is read-only, Save shows busy, and Cancel / × / Esc are disabled. Save is also disabled while an upload is running (the 5b rule).
- On failure: the modal stays open with the text and shows the error inside it.

The three modals:
- **Question text** (760px wide). Title "Question N", subtitle the type. Body: the Markdown editor with Edit/Preview and the course-assets sidebar, as today. Footer: Cancel, Save. Empty after trimming → an inline error, nothing sent.
- **Explanation** (560px wide). Title "Explanation · question N", the line "Shown to students after they answer." Body: the Markdown editor in its no-assets mode (D11): Edit/Preview, no sidebar, no drop zone, no paste or drop upload. Preview still renders through the server. Note under it: "Markdown and formulas. Images already in an explanation keep working; new ones cannot be added here." Footer: "Remove explanation" (danger, left; only when one exists; confirms), Cancel, Save. Saving text that is empty after trimming also removes it. Removal sends `explanation_md: null`.
- **New question** (760px wide), §Adding a question.

## Adding a question

1. "+ Add question" opens the **New question** modal directly.
2. Its first row is the type picker (the existing `QuestionTypePicker`, labels as the chips), defaulting to Single choice. Changing the type only switches the fields below it; it opens nothing.
3. Below: the question text editor (with assets, as in the Question text modal); for Number also value + decimals; for Text also the answer. The defaults and validity rules are today's add-form rules.
4. Footer: Cancel, "Add question" (disabled until valid). "Add question" creates the question in one request with all its fields. Cancel creates nothing. Files uploaded before Cancel stay in the course's assets (as with any upload today).
5. The new card appears at the end of the list and scrolls into view. For a choice question its "+ Add answer" row opens with focus in it; otherwise focus goes to the new card's ✎.

## Backend change (D12)

In `update_option` (`backend/mathion/api/questions.py`):
- When the update sets `is_correct: true` and the question is `single_choice`, every other option of that question is set to `is_correct: false` in the same transaction. The question's option rows are locked first (`SELECT … FOR UPDATE`), so two concurrent clicks end with exactly one correct answer.
- `create_option` applies the same rule when it creates a correct option on a single-choice question.
- Unchanged: the response shape (the updated option), the 422 for clearing the last correct answer, the published-version field rules (`is_correct` stays editable there), the multiple-choice behaviour.
- Tests: the move clears the old mark; one correct answer after two moves in a row; create-correct clears the old one; multiple choice unaffected; published version allowed; disabled 403 and archived 409 unchanged.

The frontend sends one request per key change and, on success, clears the other marks locally.

## Saving, concurrency and errors

- **One request per change**, against the existing endpoints (`renameItem`, `createQuestion`, `updateQuestion`, `deleteQuestion`, `reorderQuestions`, `createOption`, `updateOption`, `deleteOption`, `reorderOptions`). Number value + decimals are one PATCH.
- **Two locks** (as today's `questionsLocked` / `optionsLocked`):
  - per quiz: one question add / move / delete at a time;
  - per question: one answer write at a time (add, move, delete, marker, Number or Text save). Its other answer controls are disabled meanwhile.
  - Text-only saves (question text, explanation, an answer's text, the title) do not take a lock.
- **Stale responses** are ignored after the modal closed or the version changed (today's `alive && vid === savedVid` guard). A write already sent still completes on the server.
- **Errors:**
  - an edit with a field (inline field, level-3 modal): the error shows inside it, the field stays open with the typed text, no toast;
  - an action without a field (marker, move, delete, add answer row's create, question delete): a toast with the server's message;
  - after a failed answer write: that question's answers are re-fetched; after a failed question structure write: the question list is re-fetched (today's `resync`);
  - 403 or 409: also reload the version tree (`loadAdminTree(…, { force: true })`) so permissions re-derive; controls the new state forbids disappear (D13), and an open edit that can no longer save shows the error and can only be cancelled.
- After a write that changes what the constructor shows (question count, title), the version tree is refreshed, as today.
- **Announcements (new):** one polite live region in the quiz modal announces moves ("Moved question 2 up", "Moved answer 3 down") and successful saves ("Saved").

## Unsaved work

Unsaved work can exist only in an open edit:
- an inline field whose value differs from the saved one (title, answer text, Number, Text, the "+ Add answer" row with typed text);
- a level-3 modal whose content differs from what it opened with.

Rules:
- Every such edit reports to the page's DirtyRegistry (through the item modal's `guardDirty`), so closing the quiz modal, browser Back and in-app navigation all ask the existing DirtyGuard prompt: "Discard unsaved changes and continue?". The same text is used for every discard prompt in 5d.
- **D10, one inline edit at a time:** while an inline edit holds changes, any other action in the quiz modal first asks the prompt: another inline edit, a ✎ that opens level 3, a marker, a structure button, "+ Add question", the title ✎, deleting the question or answer that holds it. Confirm discards the edit and continues the action; Cancel keeps the edit open. An open inline edit without changes closes silently when another action starts.
- Esc inside an inline field cancels that field only (`preventDefault`, so the modal stays open).

## Focus after each action

- Inline save or cancel: back to the control that opened it (the answer text button, the Number/Text ✎, the title ✎).
- Level-3 close: back to the ✎ or link that opened it.
- Move: focus stays on the moved row's same arrow; if that arrow is now disabled (first/last), on the other arrow.
- Delete an answer: the next answer's text button, else the previous one's, else "+ Add answer".
- Delete a question: the next card's ✎, else the previous card's, else "+ Add question".
- Add answer: the add row stays open and focused (§Answers).
- New question: §Adding a question, step 5.

## Version states

- **Created:** everything editable.
- **Published:**
  - Text stays editable: the title, question text, explanation, answer texts.
  - Structure is locked: "+ Add question", "+ Add answer", ↑ ↓ and delete of questions and answers are not rendered (D13).
  - The answer key stays editable but each change asks today's confirmation first: the marker, the Number value or decimals, the Text answer. Text: "This quiz is published. Changing the answer key does not re-score students who already attempted — their recorded scores keep the old key. To re-grade everyone, create a new version instead. Continue?". Cancel sends nothing; a marker stays as it was, an inline Number/Text edit stays open with the typed value.
- **Archived:** read-only. No edit controls are rendered; cards show rendered text.
- **Disabled:** read-only, as archived, and cards show the plain Markdown source (`text_md`, `explanation_md`) under today's note "Preview is unavailable…", because the version's assets return 403 (5b D6).

## Code changes

**New** (names indicative; the plan fixes them): the quiz overview body; the question card; the inline answer row (choice) and the inline Number / Text editors; the Question text, Explanation and New question modals; the inline title in the item modal header, for quizzes.

**Removed:** `QuestionAccordion.svelte`, `OptionRow.svelte` and `lib/quizSave` (used only by the quiz editor and its tests); the quiz draft / one-Save machinery (`QUIZ_SAVE_KEY` / `QUIZ_GUARD_KEY`, the `QuizSaveHub` and its contributors, the quiz branch of the footer Save and ⌘S, the typed add forms and their guard shim); the quiz body's own DirtyRegistry, replaced by reporting to the page's registry through `guardDirty`.

**Kept:** the modal shell, stacking and focus trap; `MarkdownEditor` (plus D11); `QuestionTypePicker`; the API helpers in `lib/quizAuthoring.ts` and `validateNumericAnswer`; the page DirtyRegistry and DirtyGuard.

**Backend:** `update_option` / `create_option` (D12) and their tests.

## Process

The 5c process holds:
- Test-first per task: vitest (green = exit 0 and no "Errors"/"Unhandled" line), svelte-check (0 errors), the gate; backend tasks through `backend/.venv` pytest.
- **The user judges the look:** every task that changes the screen ends with agent-browser screenshots in an overlay and needs the user's OK. Screenshots use a demo-course draft; nothing is saved into the user's own draft without asking.
- Review lanes on the uncommitted diff until clean (Opus and Fable; Codex on selected steps, per the user); minors to a 5d backlog.
- One commit per task, exact paths, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**The gate.** The 5b quiz sections (accordion, option rows, footer quiz save) are rewritten for the new components. New checks keep the cross-codebase quality rules (tokens instead of literals, no emoji, no rem font sizes, forced-colors scope, focus rings) and the markup shape of the new components, as 5c did. No pixel pins for their own sake.

## Testing

- **Backend (D12):** the six cases in §Backend change.
- **Cards:** rendered text and explanation (present by `explanation_md` trim); ordinal, chip, hints (only after load); the Number "Decimals not set" hint; structure controls absent when published/archived/disabled; plain source when disabled.
- **Loading:** question list and per-card answers: loading, failure, Retry.
- **Choice answers:** inline edit save / cancel / error; marker is a button (`aria-pressed`, no arrow-key changes); single choice one PATCH and local clear; already-correct click is a no-op; multiple-choice last mark disabled with reason; add row stays open, first single-choice answer correct; ↑ ↓ delete revealed on hover and focus and always under `hover: none`; only-correct delete disabled.
- **Number / Text:** display formats (precision 0, 1, 6; null), inline edit, validation, save, cancel.
- **Level-3 modals:** save, cancel, prompt only with changes, busy freeze, upload blocks Save, required text, explanation remove / empty-save-removes as `null`, no assets in the explanation editor (no sidebar, no drop, no paste upload).
- **Nested modals:** Tab and Shift+Tab stay in the top modal, Esc closes only it, focus returns to the opener.
- **Adding:** New question opens directly; type change switches fields only; one create request with all fields; Cancel creates nothing; focus after add.
- **Concurrency:** the two locks; stale responses after close ignored; 403/409 reload the tree.
- **Published:** key confirm per change and Cancel behaviour; structure controls absent; text edits save.
- **Unsaved work:** each edit kind reports dirty; DirtyGuard on close/Back; D10 prompt and the silent close of unchanged edits; Esc in a field keeps the modal open.
- **Focus:** each rule in §Focus after each action.
- **Header:** title inline edit keeps the `h2` label; first focus; trash gating; ⌘S swallowed / Save in level 3.
- **Removed code:** no quiz footer; Page/Video/App footers, Title row and ⌘S unchanged (their tests keep passing).
- Every existing behaviour test that still applies keeps passing.

## Out of scope

- Formula typesetting anywhere in the app.
- Changing a question's type after creation (the API has no such field; delete and re-add, as today).
- Any backend change beyond D12.
- The student quiz view.

## Carried to the browser pass

The 5d screens join the 5b/5c Safari pass with the user, together with the 5b carry-overs and the 5c phone-width backlog item (D8's always-shown answer controls on touch screens included).
