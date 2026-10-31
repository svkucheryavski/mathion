# Slice 5d — quiz editor: deferred minors

Collected from the per-task review lanes (T1–T8). Each line: what, where, why it was deferred.

## Carried to the browser pass (spec §Carried to the browser pass)
- Safari pass with the user (2026-10-09/10) — done. OK: stacked level-3 modal (dimmed, centred, not clipped;
  Esc closes only the top one), the New question modal, narrow-window wrapping of the card actions, student
  block numbers, phone width (empty quiz-chip space kept by decision), no freeze after closing an item, the
  Video URL label, focus after a mouse Save/Create. Not done: D8's always-shown answer controls on a real
  touch device (no device test), and Japanese/Chinese input (not planned).
- **VoiceOver (Safari) does not speak "Saved" after an inline save** — found in the Safari pass 2026-10-09.
  The save itself succeeds (PATCH 200). "Answer moved to position 2 of 2" IS spoken, so the live region works;
  "Saved" is missed even on a fresh quiz modal (not only on a repeat). Likely cause: the save closes the field
  (the focused input is removed) and focus jumps back to the answer button in the same moment, and VoiceOver
  reads the new focus at length and drops the polite message. Candidate fix: announce "Saved" after the
  focus move has settled (a short delay, or `role="status"` with the update in a later task), then re-test
  with VoiceOver. Also still unverified: whether a repeated identical message is re-read (`say()` clears and
  sets it in a microtask, likely coalesced by WebKit) (T2, Fable M3). User: not a priority now.

## Minors
<!-- one bullet per deferred review minor, added task by task -->
- Plan review (Fable M6): the arrow-key marker test, the T4 ⌘S test and the "structure controls absent" tests pin
  against future code; they are not evidence of current behaviour. Kept as pins.
- Plan review (Fable M-D): `locked()` awaits `reload()` after every failure, including 422 validation errors —
  one extra GET per validation error; harmless (rows keyed by id, the field keeps its text).
- Plan review (Opus round 3, mA/mB): a SUCCESS after the modal stopped being live but stayed mounted (only if it
  outlives a vid change, which `{#key it.id}` prevents today) leaves level-3 / create `saving` true, and an
  InlineEdit open with a value that looks unsaved. Harden if the modal ever outlives a version change.
  (T7 and T8 since unlock level 3 and New question on a stale success; InlineEdit is still open.)
- Plan review (Fable M7): the T3 Step 10 microtask fallback for `newTabLinks` is insurance only; `{@attach}` already
  runs after the `{@html}` block on create and update.

### T1 — backend
- Commit-then-refresh returns 500 when a concurrent request deletes the row right after the commit (all
  endpoints). Rare; same class as before 5d.
- The version state can change between an answer create and a publish (a check-then-act gap). Pre-existing,
  not widened by 5d.
- `delete_option` can leave a single-choice question with no correct answer. Pre-existing; publish validation
  blocks publishing it.
- A PATCH with an explicit `{"is_correct": null}` or `{"text": null}` returns a 500 (IntegrityError) instead of
  a 422. Pre-existing.
- No test pins the SQL order "the question's lock SELECT comes before any answer-row write".
- Closed, not deferred: item / sequence / block / version / course deletes no longer cascade answer rows before
  the question — `passive_deletes=True` on `Question.options` lets Postgres cascade after the question row is
  locked (test_item_delete_waits_for_the_question_before_its_answer_rows). No per-question lock ordering needed.

### T2 — quizFormat, QuizEdits
- `toleranceText` builds its string by hand; an exact-string test would pin it (Opus M4).
- `cutName` can split a surrogate pair at the cut (Opus M5).
- The nested-modal test could be made RED with an outer-focus listener (Opus M6).
- No `$effect.root` test pins `edits.dirty` / `edits.locked` reactivity; T5 covers it implicitly (Opus M7).
- Keys with 16–17 significant digits display rounded, so saving them unchanged sends a no-op PATCH and, when
  published, asks the key confirm (Fable M4).

### T3 — the overview
- `QuizBody.load()` and `ChoiceAnswers.load()` guard their writes by token only, not `live()`; unreachable
  today (Opus M2 / Fable M5).
- Cosmetic: the wording of the (ai) emoji row's label ("all Slice-5d quiz files carry no emoji or decorative
  glyphs") (Opus M4).

### T4 — the quiz header
- A tree reload that lands while the title field is open is not applied on Cancel: the header keeps the
  pre-rename title until `item.title` changes again (a `pendingTitle` fix) (Opus M1 / Fable M1).
- The title error renders as the modal body's first line, not literally after the h2 (user approved; Opus M4).

### T5 — choice answers
- `reload()` restores focus only to a button, not to an open field's input; needs a concurrent server reorder
  to reach (N1).
- The "Edit answer" title repeats the button's accessible name for screen readers.
- An answer row grows about 6px while its field is open (user not asked to change it).

### T6 — Number and Text keys
- Number's `same` compares trimmed strings, so "5.0" over a stored 5 counts as changed and raises the D10
  prompt, although Enter closes it without a request.
- No KeyAnswer test for a stale echo after a version change (a Fable probe passed).

### T7 — level-3 modals
- The R10 focus repair in QuestionTextModal, ExplanationModal and NewQuestionModal also moves focus from an
  already-focused Cancel to the text field when a 403/409 takes the right away. Harmless: focus stays in the
  modal on an enabled control (Opus nit).
- `DISCARD_PROMPT` (quizEdits) and DirtyGuard hold the prompt as two literals (NewItemModal and
  VersionSettingsModal hold more copies). The gate now requires the first two to be equal; having DirtyGuard
  import `DISCARD_PROMPT` would remove the duplication (T9 review, Opus M4) — and then change the gate's
  DISCARD_PROMPT/DirtyGuard row to assert the import instead, or it fails on the missing literal.

### T8 — structure
- Move and delete do not bump `loadToken`, so in theory a re-fetch left in flight by a failed create could
  overwrite a later move or delete. Not reachable in practice: the New question modal stays on top until the
  author closes it (Opus nit).

### Whole-branch review (29737f4..1ab391e, 2026-10-09)
- `QuestionTextModal` compares the raw text, so a whitespace-only change (e.g. a trailing newline) sends a
  PATCH and announces "Saved". Consistent with its dirty check; a no-op request (Opus).
