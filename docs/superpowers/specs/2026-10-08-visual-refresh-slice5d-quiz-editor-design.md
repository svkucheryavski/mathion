# Visual refresh — Slice 5d: a calm quiz editor (overview + small editing modals)

**Status:** draft, rev 5. Written 2026-10-08 for the user's review.
- Rev 2 folded in round 1 of the spec review (two Opus, one Fable) and the user's decision D12.
- Rev 3 folded in round 2 (the same three angles, fresh reviewers) and the user's confirmation of D13.
- Rev 4 folded in round 3; rev 5 folds in round 4.

**Branch:** `feat/visual-refresh-slice5-authoring`. It stays local: no push, no merge. 5d lands on top of 5c (tip `2511015`).

**Authority:**
- The decisions below were made with the user on 2026-10-08.
- The approved mockup is `.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/mockups/quiz-modal-5d.html` ("Nice!"). Its "± 0.01" Number line is stale; §Number below is the rule.
- The approved design summary is `.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/5d-design.html` ("ok"). This spec supersedes it on three points:
  - Controls the version forbids are hidden, not disabled (D13; the user confirmed it on 2026-10-08).
  - An error in an edit that has a field shows inside the field, not as a toast.
  - The discard prompt uses the existing DirtyGuard text.
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
- **D12 — One small backend fix** (chosen over keeping 5b's two requests): marking an answer correct on a single-choice question clears the other correct answers in the same transaction (§Backend change). It is the only backend change in 5d.
- **D13 — Hide what the version forbids** (the 5c rule; confirmed over the design summary's "disabled with a reason"). Controls the version state does not allow are not rendered. Disabled-with-reason is kept only for momentary or local blocks: a write in flight, a first/last arrow, the only correct answer, the last correct mark. **Exception:** the header trash (delete item) stays disabled with its reason (5b D9), because that header is shared with Page, Video and App.

Made in the design and approved with it:
- **D8 — Per-answer ↑ ↓ and delete appear on hover or keyboard focus** of the answer row. They are hidden by opacity only: always in the tab order and the accessibility tree. On devices without hover (`@media (hover: none)`) they are always shown.
- **D9 — Light hints on questions** (§A question card). They inform; nothing is blocked.
- **D10 — One inline edit at a time** (§Unsaved work).
- **D11 — The Markdown editor gains a "no assets" mode** for the explanation (§Level 3).

Made from the reviews, following existing rules:
- **D14 — Kept from 5b:**
  - The first answer added to an empty single-choice question is created correct (5b §8.4).
  - The only correct answer cannot be deleted unless it is the question's only answer (5b C2, as implemented).
  - A question delete asks for confirmation; an answer delete does not.

## Level 2 — the quiz modal

The modal shell, its header (type icon, title, context line "Vectors › Linear combination · item 3 of 4", delete, close), its stacking and its focus trap stay as in 5b/5c. The backdrop does not close it (unchanged).

### Header and title

- The title is an `h2`, the dialog's `aria-labelledby` target. A ✎ "Edit title" sits after it, only when the version allows text edits.
- ✎ swaps the title text for an inline field. **Only the field goes inside the `h2`.** ✓, ✕ and any error render after the `h2` and wrap below it, never clipped. The dialog's name therefore stays the title.
- The 5c D8 rules apply:
  - Enter or ✓ saves (one PATCH via `renameItem`). An unchanged value closes silently without a request.
  - Esc or ✕ cancels without a request.
  - An error shows under the field.
  - Moving focus away leaves the field open.
- For quizzes only, the body's "Title" form row is removed. Page, Video and App keep it.

### No footer, and ⌘S

- For a quiz, the item modal renders no Save/Discard footer. Page, Video and App keep theirs exactly as today.
- ⌘S / Ctrl+S: in a level-3 modal it means that modal's Save. Anywhere else in the quiz modal it is swallowed (`preventDefault`), so the browser's own Save dialog never opens.
- The item modal's own ⌘S handler ignores key events coming from a level-3 panel. The rule: it acts only when the nearest `section.modal-panel`'s `aria-labelledby` equals the item modal's own `labelId`.

### The header trash (delete item)

Disabled (D13 exception) in two cases:
- the version forbids it, with today's reason;
- the quiz is **busy**. Each cause has its own tooltip:
  - any quiz request is in flight (structure writes and text saves alike, counted by one in-flight counter): "Delete this item — wait for the save to finish";
  - an edit holds unsaved changes: "Delete this item — finish or discard the open edit first".

  When both causes hold at once, the unsaved-edit tooltip wins, because it is the one the author has to act on.

### First focus

- When the version allows text edits, focus goes to the title's ✎.
- Otherwise it goes to × (the modal default).
- Level-3 modals focus their textarea. The New question modal focuses the checked type radio.

### The body

- **Questions row:** "Questions" + the count. On the right, a primary "+ Add question", only when the version allows structure edits. It is disabled until the list has loaded.
  - This top-right primary button is a deliberate exception to 5c D9's quiet "+ Add" lines: in the quiz overview, adding a question is the main action.
- **Loading:** while the questions load, a skeleton. On failure: "Couldn't load the questions" + Retry.
- **Empty:** "No questions yet."
- **The list:** one card per question, in order, scrolling inside the modal body.
- **The live region** (polite) is always rendered, whatever the list state.

### A question card

The card is a list item, labelled by its rendered question text (`aria-labelledby`). From top to bottom:

1. **Head row**
   - A light ordinal "1." (`--ordinal`, aria-hidden, like the 5c block numbers).
   - The question text, rendered (`text_html`).
   - A type chip: "Single choice", "Multiple choice", "Number" or "Text" (sans, not mono).
   - D9 hints, if any, next to the chip.
   - Actions:
     - ✎ "Edit question 1" (opens level 3);
     - ↑ "Move question 1 up" and ↓ "Move question 1 down";
     - delete "Delete question 1".

     The structure actions are rendered only when the version allows them (D13).
   - Below 560px the chip, hints and actions wrap onto a second line under the text.
2. **Answers** (§Answers).
3. **Explanation**
   - Present when `explanation_md` is non-empty after trimming: a small muted panel, "Explanation" + the rendered `explanation_html`, with ✎ "Edit explanation for question 1".
   - Absent: a quiet "+ Add explanation" **button** (accessible name "Add explanation to question 1"). Hidden when the version allows no text edits.

Rendered text in cards:
- Images are capped at the card width.
- Headings inside question text and explanations render at body size. They keep their tags, because they are the author's content.
- Links open in a new tab, so a click never leaves the editor. The server's sanitiser already adds `rel="noopener noreferrer"` (`markdown.py`). The client adds only `target="_blank"`, through an attachment that runs again whenever the HTML changes.
- Clicking the text does not edit it; only ✎ does.

**D9 hints:**
- Choice questions, shown only once the answers have loaded:
  - "No answers yet": no answers.
  - "Add at least 2 answers": exactly one answer (publishing requires two, `versions.py`).
  - "No correct answer": answers but none correct (possible for multiple choice, whose new answers start not correct).
  - "More than one correct": a single-choice question with two or more correct answers (old data the 5b flow could leave; publishing rejects it).
- Number: "Decimals not set" when `precision` is null (older data; such a question marks every answer wrong).

**Formulas.** The app does not typeset formulas anywhere today. The server wraps `$…$` in `<span class="math">` and no client code draws it, so students see the LaTeX source. The cards show the same. Typesetting is a separate, later change, out of scope.

## Answers, edited in place

### Loading

- Each card loads its own answers (`listOptions`; the question list does not include them).
- While loading: "Loading answers…". On failure: "Couldn't load answers" + Retry.
- Hints and "+ Add answer" appear only once the answers have loaded.

### Single and multiple choice

- **The row.** Each answer is a compact row: a correct-marker and the answer text. A correct answer is tinted green, with its marker filled and a small "correct" tag.
- **The marker** is a button, not a native radio or checkbox.
  - `aria-pressed` = correct.
  - Accessible name `Mark "11" correct`. In the names of the marker, ↑ ↓ and delete, answer text longer than 40 characters is cut with "…".
  - Click, Enter or Space changes the key. Arrow keys do not.
- **Edit the text.**
  - The text is a button whose name is the **full** answer text, with "Edit answer" given as a visually hidden prefix. This way a screen reader can always hear the whole answer. Click it or press Enter on it, and it becomes an inline field (plain text, 1–500 characters, trimmed).
  - Enter or ✓ saves; an unchanged value closes silently. Esc or ✕ cancels. An error shows under the field.
- **Correct, single choice.**
  - Clicking a not-correct answer makes it the one correct answer: one PATCH `is_correct: true`. The server clears every other correct answer in the same transaction (D12).
  - Clicking an already-correct answer does nothing, unless another answer is also correct (old data). Then it sends the same PATCH, which leaves only this one correct.
- **Correct, multiple choice.**
  - Clicking toggles that answer.
  - The last correct marker cannot be cleared (the server rejects it with 422). It is disabled with the tooltip "At least one answer must stay correct".
- **Order and delete (D8).**
  - Per row: ↑ `Move answer "11" up`, ↓ `Move answer "11" down`, delete `Delete answer "11"`.
  - Delete sends at once, with no confirmation (as today).
  - The only correct answer's delete is disabled with "Mark another answer correct first", unless it is the question's only answer (D14).
- **"+ Add answer"** (accessible name "Add answer to question 1") opens an inline row in place.
  - Enter creates the answer and keeps the row open, empty and focused for the next one. Esc or ✕ closes it.
  - The first answer of an empty single-choice question is created correct (D14). Every other new answer starts not correct.

### Number

- **Reads:** "Answer **5** · 2 decimals (± 0.005)".
  - The value is formatted with `Intl.NumberFormat('en-US', { useGrouping: false, maximumSignificantDigits: 15 })`, never in exponent notation.
  - Singular "1 decimal".
  - The tolerance is `5·10^-(decimals+1)`, printed with `toFixed(decimals + 1)`. So 6 decimals reads "± 0.0000005", not "5e-7".
- **Old data:**
  - A null value reads "Answer not set".
  - A null `precision` reads "Answer **5** · decimals not set", and the hint shows.
- **Editing:** ✎ "Edit the answer to question 1" opens an inline editor with two fields, labelled "Answer" and "Decimals" (0–10), checked by today's `validateNumericAnswer`.
  - The fields start from the formatted value, or empty, and from the decimals, or 0.
  - Enter or ✓ saves both in one PATCH. An unchanged pair closes silently. A value is unchanged when `validateNumericAnswer(typed).canonical` equals the canonical form of the stored value, so "5.0" against a stored 5 counts as unchanged. Esc or ✕ cancels.

### Text

- **Reads:** "Answer **unit vector**". A null value reads "Answer not set".
- **Editing:** ✎ "Edit the answer to question 1" (the same name as for Number) opens an inline field labelled "Answer" (1–500 characters, trimmed), with today's muted hint "Case-insensitive, trimmed match.".
  - Enter or ✓ saves; an unchanged value closes silently. Esc or ✕ cancels.

## Level 3 — the small modals

All three are separate modals stacked on top of the quiz modal through the existing modal stack.

**Stacking:**
- Focus is trapped in the top modal only. Today `FocusTrap`'s document-level Tab handler does not check which modal is on top. This slice fixes it:
  - `FocusTrap` gains an optional `active` getter;
  - `Modal` passes its own "am I the top modal" check;
  - without the prop, `FocusTrap` behaves exactly as today. Its other users (the run modals, `DashboardSidePanel`, `VersionEditPage`, and so on) are unchanged.
- Esc closes the top modal only.
- On close, focus returns to the control that opened it. If that control is gone, focus goes to its replacement: ✎ ↔ "+ Add explanation" after an explanation is added or removed. Otherwise the §Focus fallback applies.

**Shared rules:**
- Closing (Cancel, ×, Esc) with changes asks the DirtyGuard prompt (§Unsaved work). Without changes the modal just closes.
- While Save runs:
  - the editor is read-only;
  - Save shows busy;
  - Cancel, × and Esc are disabled.
  - Closing the quiz modal or leaving the page does not prompt for this modal, and a late failure toasts. This is the same rule as a saving inline field (§While a request runs).
- Save is also disabled while an upload is running (the 5b rule).
- On failure, the modal stays open with the text and shows the error inside it.

**Question text** (760px wide)
- Title "Question N", subtitle the type.
- Body: the Markdown editor with Edit/Preview and the course-assets sidebar, as today.
- Footer: Cancel, Save.
- Empty after trimming: an inline error, nothing sent.

**Explanation** (560px wide)
- Title "Explanation · question N", and the line "Shown to students after they answer."
- Body: the Markdown editor in its no-assets mode (D11). Edit/Preview stay. There is no sidebar, no drop zone and no upload path. The editor's window-level file-drop guard stays, so a dropped file never navigates away. Preview still renders through the server.
- Note under the editor: "Markdown. Images already in an explanation keep working; new ones cannot be added here."
- Footer:
  - "Remove explanation" (danger, on the left), shown only when an explanation exists. It confirms with "Remove the explanation for question N?".
  - Cancel, Save.
- Saving text that is empty after trimming also removes the explanation. Removal sends `explanation_md: null`.

**New question** (760px wide): see §Adding a question.

## Adding a question

1. "+ Add question" opens the **New question** modal directly.
2. Its first row is the type picker: the existing `QuestionTypePicker`, relabelled to the chip labels "Single choice", "Multiple choice", "Number" and "Text". It defaults to Single choice.
   - Changing the type only switches the fields below it. It opens nothing, and does not count as a change for the DirtyGuard prompt.
3. Below the picker:
   - the question text editor, with assets, as in the Question text modal;
   - for Number, also "Answer" and "Decimals";
   - for Text, also "Answer".

   The defaults and validity rules are today's add-form rules.
4. Footer: Cancel, and "Add question" (disabled until valid).
   - "Add question" creates the question in one request with all its fields.
   - Cancel creates nothing. Files uploaded before Cancel stay in the course's assets, as with any upload today.
5. The new card appears at the end of the list and scrolls into view.
   - For a choice question, once its answers have loaded, its "+ Add answer" row opens with focus in it. If the load fails, focus goes to the card's ✎.
   - Otherwise focus goes to the new card's ✎.

## Backend change (D12)

In `backend/mathion/api/questions.py`, `update_option` (whenever the update touches `is_correct`) and `create_option` (always) do this:

1. **Lock the parent question row first, before anything is applied.** Use `select(Question).where(Question.id == …).with_for_update().execution_options(populate_existing=True)`, the `mini_projects.py` pattern.
   - This serialises every create and every correctness change on that question, including inserts. Locking only the option rows would not cover inserts.
   - Nothing is written for the option before the lock is held: the lock and the re-read come before today's setattr loop. Writing first would take the answer row's lock before the question's, and two requests could deadlock.
2. **Re-read** the target option and the question's options with `populate_existing=True`, so no stale row is used. If the question or the option is gone under the lock, return 404.
3. **Apply the rule** for a single-choice question when the target becomes correct: clear every other option with one `UPDATE answer_options SET is_correct = false WHERE question_id = :q AND id <> :o`.

The same lock also closes the existing race on the multiple-choice "at least one correct" check (two unticks at once).

**Unchanged:**
- the response shape (the updated or created option);
- the 422 for clearing the last correct answer;
- the published-version field rules (`is_correct` stays editable there);
- multiple-choice behaviour apart from the lock.

**Tests:**
- the move clears the old mark;
- create-correct clears the old mark;
- old data with two correct answers becomes one after a PATCH;
- multiple choice is unaffected;
- a published version is allowed;
- disabled (403) and archived (409) are unchanged;
- **a real concurrency test** with the existing interleave harness (as in `tests/test_concurrency_*.py`).
  - Both endpoints call `advisory.interleave_hook("…")` right after the question-row lock.
  - The call goes through the module attribute, not a name imported directly, so the tests' monkeypatch takes effect.
  - The test cases:
  - two concurrent moves end with exactly one correct answer;
  - two concurrent correct creates on an empty question end with exactly one.

`test_questions_api.py` `test_update_option_is_correct_published` describes the old two-step swap ("temporarily 2 correct"). Update it to assert that the old answer is cleared after the first step.

The frontend sends one request per key change. On success it clears the other marks locally.

## Saving, concurrency and errors

**One request per change**, against the existing endpoints: `renameItem`, `createQuestion`, `updateQuestion`, `deleteQuestion`, `reorderQuestions`, `createOption`, `updateOption`, `deleteOption`, `reorderOptions`. Number value + decimals are one PATCH.

**Two locks** (like today's `questionsLocked` / `optionsLocked`):
- **Per quiz:** one question add, move or delete at a time.
- **Per question:** one answer write at a time: add, move, delete, marker, answer-text save, Number save or Text save.
  - A question's own move and delete also need its per-question lock. They are disabled while one of its answer writes runs.
  - While they run, they hold that lock, so its answer controls are disabled meanwhile.
- The question text, explanation and title saves take no lock. They still count toward **busy** (the header trash).

**While a request runs:**
- The control that started it stays enabled, and re-entry is blocked in its handler, so focus is never dropped. Its inputs become `readonly`, never `disabled`.
- The question's other answer controls are disabled. **Exception:** during its own move, both arrows of the moved answer row or question card stay enabled, despite the per-question and per-quiz locks, with re-entry blocked in the handler. Only the first/last rule disables one of them, so focus can always land on the other arrow.
- **A saving inline field** (and the inline title while it saves):
  - It is read-only, ✓ shows busy and Enter is ignored.
  - ✕ is disabled. Esc is swallowed (`preventDefault`) and does nothing, so it never reaches the modal.
  - It is never closed by another action. Until it settles, the **edit-opening** controls are disabled with the tooltip "Wait for the save to finish". These are:
    - every ✎ (question, explanation, Number, Text, title);
    - the answer text buttons;
    - the markers;
    - the three "+ Add …" controls.

    Moves and deletes follow the locks alone.
  - On success it closes (the focus rules apply). On failure it stays open with the error and the typed text, and becomes an unsaved edit again.
  - Closing the quiz modal or leaving the page during the save does not prompt, because the request is already sent and completes on the server. A late failure then shows as a toast (as `AccordionHeader` does today).
- **Echoes write back only the fields their request carried.** An answer-text save updates only `text`, a marker save only `is_correct` (plus the local clear of the others), a Number save only value and decimals. This keeps a later write's result from being overwritten by an earlier echo (today's per-field write-back).

**Stale responses** make no UI writes into the modal after it has closed or the version has changed (today's `alive && vid === savedVid` guard). One exception: a failed save still pushes the global toast (§While a request runs), unless the version has changed (`stillOnVid`). A write already sent still completes on the server. A failed write's re-fetch is skipped when its question no longer exists.

**Errors:**
- An edit with a field (an inline field, a level-3 modal): the error shows inside it, and the field stays open with the typed text. No toast.
- An action without a field (marker, move, delete, question delete): a toast with the server's message. The server's own texts say "option"; 5d leaves them as they are.
- After a failed answer write, that question's answers are re-fetched. After a failed question structure write, the question list is re-fetched (today's `resync`).
- On a 403 or 409, the version tree is also reloaded (`loadAdminTree(…, { force: true })`) so permissions re-derive. Controls the new state forbids disappear (D13).
  - **An edit that is already open stays mounted whatever the new permissions.** Only its save is blocked: it shows the error and can only be cancelled. Typed text is never lost silently.
- After a write that changes what the constructor shows (question count, title), the version tree is refreshed, as today.

**Announcements** (the polite live region):
- "Question moved to position N of M" and "Answer moved to position N of M" (today's texts);
- "Saved" after a successful save.

## Unsaved work

Unsaved work can exist only in an open edit:
- an inline field whose value differs from the saved one: the title, an answer text, Number, Text, or the "+ Add answer" row with typed text;
- a level-3 modal whose content differs from what it opened with. For New question, any field other than the type that differs from its default counts (text, Answer, Decimals); the type alone does not.

**Who owns it.**
- The quiz body keeps implementing `ItemBodyApi` and owns one **active edit** slot for D10.
- The header's inline title takes the same slot through the item modal. For this, `ItemBodyApi` gains one optional member that the quiz body implements; Page, Video and App leave it out. The plan names it. `discardAll()` (called by the page's discard) closes the active inline edit, any open level-3 modal and the inline title.

**The rules:**
- **Reporting.** Every edit with changes reports to the page's DirtyRegistry (through the item modal's `guardDirty`). So closing the quiz modal, browser Back and in-app navigation all ask the existing DirtyGuard prompt: "Discard unsaved changes and continue?". Every discard prompt in 5d uses this text.
- **D10, one inline edit at a time.** While an inline edit holds changes, any other action in the quiz modal first asks the prompt. That includes:
  - another inline edit;
  - a ✎ that opens level 3;
  - a marker or a structure button;
  - "+ Add question";
  - the title ✎;
  - deleting the question or answer that holds the edit.

  Confirm discards the edit and continues the action; Cancel keeps the edit open. An open inline edit without changes closes silently when another action starts.
- **Order of prompts.** When a published-version key confirm also applies (§Version states), the D10 prompt comes first and the key confirm second.
- **Esc** inside an inline field cancels that field only (`preventDefault`, so the modal stays open).

## Focus after each action

- **Inline save or cancel:** back to the control that opened it: the answer text button, the Number/Text ✎ or the title ✎.
- **Level-3 close:** back to the ✎ or button that opened it, or its replacement (§Level 3).
- **Move:** the move is optimistic, as today. After the local swap and its DOM update (`tick()`), not after the response, focus is set again on the moved row's same arrow and the card is scrolled to `block: 'nearest'`. If that arrow is now disabled (first/last), focus goes to the other arrow.
- **Delete an answer:** the next answer's text button, else the previous one's, else "+ Add answer".
- **Delete a question:** the next card's ✎, else the previous card's, else "+ Add question".
- **Add answer:** the add row stays open and focused (§Answers).
- **New question:** §Adding a question, step 5.
- **Fallback.** Whenever the focused control disappears (Retry succeeded, a 403/409 hid it, its opener is gone), focus goes to that card's ✎, else "+ Add question", else ×.

## Version states

**Created:** everything is editable.

**Published:**
- Text stays editable: the title, question text, explanation and answer texts.
- Structure is locked. "+ Add question", "+ Add answer", and ↑ ↓ and delete of questions and answers are not rendered (D13).
- The answer key stays editable, but each change asks today's confirmation first. This covers the marker, the Number value or decimals, and the Text answer. The text: "This quiz is published. Changing the answer key does not re-score students who already attempted — their recorded scores keep the old key. To re-grade everyone, create a new version instead. Continue?".
  - Cancel sends nothing. A marker stays as it was; an inline Number/Text edit stays open with the typed value.

**Archived:** read-only. No edit controls are rendered, and cards show rendered text.
- The marker is a static mark: no button and no `aria-pressed`, but "correct" is still conveyed in text.
- The answer text is plain text, not an "Edit answer" button.

**Disabled:** read-only, as archived. Cards show the plain Markdown source (`text_md`, `explanation_md`) under today's note "Preview is unavailable…", because the version's assets return 403 (5b D6).

## Code changes

**New** (names indicative; the plan fixes them):
- the quiz overview body;
- the question card;
- the inline answer row (choice) and the inline Number and Text editors;
- the Question text, Explanation and New question modals;
- the inline title in the item modal header, for quizzes.

**Changed:**
- `MarkdownEditor` gains the no-assets mode (D11).
- `QuestionTypePicker` is relabelled; its test is updated.
- `FocusTrap` gains the optional `active` prop, which `Modal` passes.
- `ItemBodyApi` gains the optional active-edit member.
- `ItemEditorModal`:
  - the quiz has no footer and no body Title row;
  - its ⌘S handler ignores level-3 panels;
  - the inline title is added.

**Removed:**
- `QuestionAccordion.svelte`, `OptionRow.svelte` and `lib/quizSave` (used only by the quiz editor, its tests and harness, and gate section (ae)).
- The quiz draft / one-Save machinery: `QUIZ_SAVE_KEY` / `QUIZ_GUARD_KEY`, the `QuizSaveHub` and its contributors, the quiz branch of the footer Save and ⌘S, and the typed add forms and their guard shim.
- The quiz body's own DirtyRegistry, replaced by reporting to the page's registry through `guardDirty`.

**Kept:**
- the modal shell and stacking;
- `MarkdownEditor` (plus D11) and `QuestionTypePicker` (relabelled);
- the API helpers in `lib/quizAuthoring.ts` and `validateNumericAnswer`;
- `ItemBodyApi`;
- the page DirtyRegistry and DirtyGuard.

**Backend:** `update_option` and `create_option` (D12) and their tests.

## Process

The 5c process holds:
- Test-first per task: vitest (green = exit 0 and no "Errors"/"Unhandled" line), svelte-check (0 errors), the gate. Backend tasks run pytest through `backend/.venv`.
- **The user judges the look.** Every task that changes the screen ends with agent-browser screenshots in an overlay and needs the user's OK. Screenshots use a demo-course draft; nothing is saved into the user's own draft without asking.
- Review lanes on the uncommitted diff until clean: Opus and Fable, plus Codex on selected steps, per the user. Minors go to a 5d backlog.
- One commit per task, with exact paths and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**The gate.** The 5b quiz sections (accordion, option rows, footer quiz save; section (ae)) are rewritten for the new components. New checks keep the cross-codebase quality rules (tokens instead of literals, no emoji, no rem font sizes, forced-colors scope, focus rings) and the markup shape of the new components, as 5c did. No pixel pins for their own sake.

## Testing

**Backend (D12):** the cases in §Backend change, including the concurrency test.

**Cards:**
- rendered text and explanation (present when `explanation_md` is non-empty after trimming);
- ordinal, chip, and hints (only after load), including "More than one correct" and "Decimals not set";
- links get `target="_blank"`;
- structure controls absent when published, archived or disabled;
- plain source when disabled.

**Loading:** for the question list and each card's answers: loading, failure, Retry, and "+ Add question" disabled until loaded.

**Choice answers:**
- Inline edit: save, unchanged-close, cancel, error.
- The marker is a button (`aria-pressed`, name `Mark "…" correct`, no arrow-key changes).
- Single choice:
  - one PATCH, then the local clear;
  - an already-correct click is a no-op;
  - with old two-correct data, the click sends the PATCH.
- Multiple choice: the last mark is disabled with its reason.
- Adding: the add row stays open; the first single-choice answer is correct.
- ↑ ↓ and delete:
  - revealed on hover and focus, by opacity only;
  - always shown under `hover: none`;
  - Shift+Tab from the next row's marker reaches this row's delete.
- Delete rules: the only correct answer's delete is disabled, unless it is the only answer.
- Accessible names truncate at 40 characters.

**Number and Text:**
- display formats: precision 0, 1 and 6; null precision; null value; `1e-7` shown without an exponent;
- inline edit pre-fill, validation, save, unchanged-close and cancel.

**Level-3 modals:**
- save, cancel, and the prompt only with changes;
- the busy freeze;
- an upload blocks Save;
- required text;
- explanation: remove (with its confirm), and an empty save also removes, both sent as `null`;
- no assets in the explanation editor: no sidebar, no drop upload, and a window drop does not navigate.

**Nested modals:**
- level 3 mounted inside level 2's DOM;
- Tab and Shift+Tab stay in the top modal;
- Esc closes only it;
- ⌘S saves level 3 only;
- focus returns to the opener or its replacement.

**Adding:**
- New question opens directly, with focus on the checked radio;
- a type change switches fields only and is not dirty;
- one create request with all fields;
- Cancel creates nothing;
- focus after add, including the answer-load failure path.

**Concurrency:**
- the two locks;
- the started control keeps focus (not `disabled`);
- double Enter sends one request;
- a saving field ignores Esc (and the modal stays open), and blocks other edit-opening actions until it settles;
- a saving field reopens with its error on failure, and a close during the save gives a toast on late failure;
- an echo writes only its own fields;
- stale responses after close are ignored;
- a failed write's re-fetch is skipped for a deleted question;
- 403/409 reloads the tree, and an open edit stays mounted.

**Published:**
- the key confirm on each change, and what Cancel does;
- the D10 prompt comes before the key confirm;
- structure controls absent;
- text edits save.

**Unsaved work:**
- each edit kind reports dirty;
- DirtyGuard on close and on Back;
- the D10 prompt, and the silent close of unchanged edits;
- a saving field does not prompt;
- Esc in a field keeps the modal open;
- `discardAll` closes every open edit.

**Focus:** each rule in §Focus after each action, including the fallback.

**Header:**
- the inline title keeps the dialog name (✓ ✕ outside the `h2`);
- first focus;
- trash gating, including a lock-free text save in flight;
- ⌘S swallowed, or Save in level 3.

**Removed code:** no quiz footer. The Page, Video and App footers, Title row and ⌘S are unchanged, and their tests keep passing.

Every existing behaviour test that still applies keeps passing.

## Out of scope

- Formula typesetting anywhere in the app.
- Changing a question's type after creation. The API has no such field; delete and re-add, as today.
- Any backend change beyond D12, including the wording of the server's error messages.
- The student quiz view.

## Carried to the browser pass

The 5d screens join the 5b/5c Safari pass with the user. They go together with the 5b carry-overs and the 5c phone-width backlog item, including D8's always-shown answer controls on touch screens.
