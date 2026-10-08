# Visual refresh — Slice 5d: a calm quiz editor (overview + small editing modals)

**Status:** draft, rev 1. Written 2026-10-08 for the user's review.
**Branch:** `feat/visual-refresh-slice5-authoring`. It stays local: no push, no merge. 5d lands on top of 5c (tip `2511015`).

**Authority:**
- The decisions below were made with the user on 2026-10-08.
- The approved mockup is `.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/mockups/quiz-modal-5d.html` ("Nice!").
- The approved design summary is `.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/5d-design.html` ("ok").
- For the quiz item, this spec replaces the 5b quiz sections (one footer Save, drafts, the question accordion). Where it is silent, 5b and 5c still hold.

## Why

The user, on the 5b/5c quiz modal: "The form is huge and very messy."

What the screen shows today:
- The modal is about 600px tall at a 900px window, and everything scrolls inside it.
- An open question stacks two full Markdown editors (Question, Explanation), each with its own "Course assets" sidebar. One question is about 1,100px tall, and its answer options sit at the very bottom.
- Questions still carry "Q1/Q2" codes and mono "single choice / 1 correct" labels, which 5c removed everywhere else.
- Reading and editing are mixed: you cannot see the quiz as a whole while editing any part of it.

## Decisions (the user's, 2026-10-08)

- **D1 — Three levels.** *(The user's idea.)*
  - Level 1 is the constructor page (unchanged).
  - Level 2 is the quiz modal: a compact overview of the whole quiz.
  - Level 3 is a small modal on top of it for each heavy edit.
- **D2 — The overview is a list of question cards, not tabs.** The user offered one tab per question with a "+" tab. Tabs were declined: they show one question at a time (the overview this redesign exists for), overflow at 10–20 questions, and make reordering awkward.
- **D3 — Every edit saves itself.** There is no Save/Discard footer on the quiz modal (the user chose this over one Save for the whole quiz).
- **D4 — Question text is edited in a level-3 modal** with the full Markdown editor (Edit/Preview, course assets).
- **D5 — Answers are edited in place** on the card.
- **D6 — The explanation is edited in a small level-3 modal:** Markdown with preview, but no images or files.
- **D7 — The overview shows rendered text.** Question text and explanation appear as the server renders them, the same HTML students get.

Decisions made in the design and approved with it (marked ◆ in the design summary):
- **D8 — Per-answer ↑ ↓ and delete appear on hover or keyboard focus** of the answer row, to keep cards compact.
- **D9 — Light hints on choice questions** that cannot be answered correctly yet: "No answers yet", "No correct answer". They inform; nothing is blocked.
- **D10 — One inline edit at a time.** Starting another inline edit while one holds unsaved changes asks to discard them first.
- **D11 — The Markdown editor gains a "no assets" mode** for the explanation.

## Level 2 — the quiz modal

The modal shell, its header (type icon, title, context line "Vectors › Linear combination · item 3 of 4", delete, close) and its stacking stay as in 5b/5c.

- **Title.** It sits in the header with a ✎. Clicking ✎ turns it into an inline field with the 5c D8 rules: Enter or ✓ saves (one PATCH), Esc or ✕ cancels without a request, an error shows under the field, moving focus away leaves it open, and an open field with changes counts as unsaved.
- **No footer.** For a quiz, the item modal renders no Save/Discard footer and no ⌘S binding. Page, Video and App items keep their footer exactly as today.
- **Questions row.** "Questions" + the count, and a primary "+ Add question" button on the right (§Adding a question).
- **The list.** One card per question, in order. The list scrolls inside the modal body. An empty quiz shows a short empty state: "No questions yet."

### A question card

From top to bottom:
1. **Head row:**
   - a light ordinal "1." (`--ordinal`, aria-hidden, like the 5c block numbers);
   - the question text, rendered (`text_html`);
   - a small type chip: "Single choice", "Multiple choice", "Number", "Text" (sans, not mono);
   - actions: ✎ (edit text, opens level 3), ↑, ↓, delete.
2. **Answers** (by type, §Answers).
3. **Explanation:**
   - present: a small muted panel, "Explanation" + the rendered `explanation_html`, with ✎ (opens level 3);
   - absent: a quiet "+ Add explanation" link (opens level 3).
4. **Hints (D9), choice questions only,** next to the type chip:
   - "No answers yet" when it has no answers;
   - "No correct answer" when it has answers but none is correct.

The card's accessible structure: the card is a list item; the question text is its label for the action buttons ("Edit question 1 text", "Move question 1 up", …). The ordinal is in those names, since it is aria-hidden on screen.

**Formulas.** The app does not typeset formulas anywhere today: the server wraps `$…$` in `<span class="math">`, and no client code draws them, so students see LaTeX source. The cards show the same. Typesetting formulas is a separate, later change and out of scope here.

## Answers, edited in place

### Single and multiple choice

- Each answer is a compact row: a marker (radio for single choice, checkbox for multiple choice) and the answer text. A correct answer is tinted green with its marker filled and a small "correct" tag.
- **Edit the text:** click the text (or focus it and press Enter). It becomes an inline field: Enter or ✓ saves, Esc or ✕ cancels, an error shows under it. The text is plain (1–500 characters, the API rule).
- **Correct:** click the marker.
  - Multiple choice toggles that answer.
  - Single choice moves the one correct mark to the clicked answer. The write order must never leave the question with two correct answers, even briefly or after a failure (the 5b "two-correct key" lesson).
- **Order and delete (D8):** ↑ ↓ and delete show on the row's hover and when focus is inside the row.
- **"+ Add answer":** opens an inline row in place: type the text, Enter creates it (not correct), Esc cancels.

### Number

- Reads: "Answer **5** · 2 decimals (± 0.005)". The tolerance follows today's rule, `± 5·10^-(decimals+1)`.
- ✎ opens an inline editor with two fields (value, decimals), today's `validateNumericAnswer` and the 0–10 decimals rule. Enter or ✓ saves, Esc or ✕ cancels.

### Text

- Reads: "Answer **unit vector**".
- ✎ opens an inline field (1–500 characters). Enter or ✓ saves, Esc or ✕ cancels.

## Level 3 — the small modals

All three stack on top of the quiz modal through the existing modal stack (focus trapped in the top modal, Esc closes the top one only).

- **Question text.** Title "Question N", subtitle the type. Body: the Markdown editor with Edit/Preview and the course-assets sidebar, as today. Footer: Cancel, Save. The text is required (the API's `min_length=1`); an empty Save shows an inline error and sends nothing.
- **Explanation.** Title "Explanation · question N", the line "Shown to students after they answer." Body: the Markdown editor in its no-assets mode (D11): Edit/Preview, no sidebar, no drop zone, no upload; the note "Markdown and formulas. No images or files." Footer: "Remove explanation" (danger, left; only when one exists; confirms, then saves `explanation_md: null`), Cancel, Save. Saving empty text removes the explanation.
- **New question** (§Adding a question).

Closing a level-3 modal with changes (Cancel, ×, Esc) asks "Discard changes?". Without changes it just closes.

## Adding a question

1. "+ Add question" opens the existing type picker.
2. Picking a type opens the **New question** modal (level 3): the question text editor, and for Number the value + decimals fields, for Text the answer field. Footer: Cancel, "Add question".
3. "Add question" creates the question in one request with all its fields. Cancel creates nothing, so no empty question ever exists.
4. The new card appears at the end of the list and scrolls into view. A choice question then gets its answers in place (it shows "No answers yet" until it has some).

## Saving and errors

- Every write is one request against the existing endpoints (`updateQuestion`, `createQuestion`, `deleteQuestion`, `reorderQuestions`, `createOption`, `updateOption`, `deleteOption`, `reorderOptions`, `renameItem`). **No backend change.**
- While a write runs, its control shows busy and does not accept a second click.
- On failure: a toast says what failed; an inline edit or level-3 modal stays open with the typed text; a structure change (move, add, delete) reloads the quiz from the server, as today's `resync()` does.
- After a write that changes what the constructor shows (question count, title), the version tree is refreshed (as today, `loadAdminTree(..., { force: true })`).
- **Unsaved work** can exist only inside an open inline edit or level-3 modal. Closing the quiz modal (×, Esc, the backdrop, navigating away) while an inline edit holds changes asks "Discard changes?" through the page's DirtyRegistry, as other modals do. Otherwise closing never asks.

## Version states (rules kept from today)

- **Created:** everything editable.
- **Published:**
  - Texts stay editable: title, question text, explanation, answer texts.
  - Structure is locked: "+ Add question", "+ Add answer", ↑ ↓ and delete of questions and answers are disabled, each with its reason in the tooltip (today's `structureReason`).
  - Changing the answer key asks today's confirmation, once per change: the correct marker, the Number value or decimals, the Text answer. The text: "This quiz is published. Changing the answer key does not re-score students who already attempted — their recorded scores keep the old key. To re-grade everyone, create a new version instead. Continue?". Cancel sends nothing and restores the previous state.
- **Archived, or disabled:** read-only. All edit controls are disabled with their reason (today's `textReason` / `structureReason`); the cards still show everything.

## Code changes

**New** (names indicative; the plan fixes them):
- the quiz overview body (the list, the Questions row, the empty state);
- the question card;
- the inline answer row (choice) and the inline Number / Text answer editors;
- the Question text, Explanation and New question modals;
- the inline title edit in the item modal header, for quizzes.

**Removed:**
- the question accordion (`QuestionAccordion.svelte`) and `OptionRow.svelte`, as far as nothing else uses them;
- the quiz draft / one-Save machinery: `QuizSaveHub`, the contributors, the quiz branch of the footer Save and ⌘S, the typed add forms and their guard shim.

**Kept:**
- the modal shell and its stacking;
- `MarkdownEditor` (plus the no-assets mode, D11);
- `QuestionTypePicker`;
- the quiz API helpers in `lib/quizAuthoring.ts` and `validateNumericAnswer`;
- the DirtyRegistry for the remaining unsaved-work prompts.

## Process

The 5c process holds:
- Test-first per task (vitest + svelte-check + the gate).
- **The user judges the look:** every task that changes the screen ends with agent-browser screenshots in an overlay, and needs the user's OK. Screenshots use the demo course in a draft version; nothing is saved into the user's own draft without asking.
- Two review lanes (Opus and Fable) on the uncommitted diff until both are clean; minors to a 5d backlog.
- One commit per task, exact paths, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**The gate.** The 5b quiz sections (the accordion, option rows, footer quiz save) are rewritten for the new components. New checks keep only the cross-codebase quality rules (tokens instead of literals, no emoji, no rem font sizes, forced-colors scope, focus rings) and the markup shape of the new components, the way 5c did. No pixel pins for their own sake.

## Testing

- **Cards:** rendered text and explanation; ordinal and type chip; D9 hints; actions present per version state, disabled with reasons when published/archived/disabled.
- **Choice answers:** inline edit save / cancel / error; marker toggles (multiple) and moves (single) the correct mark, never leaving two correct on success or failure; add row; ↑ ↓ delete revealed on hover and focus.
- **Number / Text answers:** inline edit, validation, save, cancel.
- **Level-3 modals:** save, cancel, discard prompt only with changes, required question text, explanation remove and empty-save-removes, no assets in the explanation editor.
- **Adding:** type picker → New question → one create request with all fields; Cancel creates nothing.
- **Published:** answer-key confirm per change (and Cancel restores); structure controls disabled; text edits still save.
- **Unsaved work:** closing the quiz modal with an open, changed inline edit prompts; without one it does not; D10 one-at-a-time.
- **Removed code:** no quiz Save/Discard footer and no ⌘S for quizzes; Page/Video/App footers unchanged (their existing tests keep passing).
- **Every existing behaviour test that still applies keeps passing.**

## Out of scope

- Formula typesetting (KaTeX or similar) anywhere in the app.
- Changing a question's type after creation (the API has no such field; delete and re-add, as today).
- Any backend or API change.
- The student quiz view.

## Carried to the browser pass

The 5d screens join the 5b/5c Safari pass with the user, together with the 5b carry-overs and the 5c phone-width backlog item.
