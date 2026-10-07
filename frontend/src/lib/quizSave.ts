// The quiz body's one-Save orchestration (Slice-5b §5.1). Each QuestionAccordion
// registers a save contributor on QUIZ_SAVE_KEY; QuizEditor validates the dirty
// ones and saves them in display order after the title (§5.3). QUIZ_GUARD_KEY
// carries a second dirty registry for the typed add-question / add-option
// forms (§5.4): they make closing the modal prompt (guardDirty), but the footer
// and Save ignore them (D5).

export const QUIZ_SAVE_KEY = Symbol('quizSave');
export const QUIZ_GUARD_KEY = Symbol('quizGuard');

export type QuizContributor = {
  readonly questionId: number;
  // Display position (1-based); QuizEditor sorts by it.
  order(): number;
  readonly isDirty: boolean;
  // An option add / delete / reorder, or an editor upload, is in flight (blocks Save).
  locked(): boolean;
  // D20: a numeric or text answer, or a correct mark, differs from saved.
  keyChanged(): boolean;
  // D10: dirty-scoped. Shows the inline errors; never moves focus.
  validate(): boolean;
  // Focuses the first invalid field (after the body expands, if collapsed).
  focusFirstInvalid(): void;
  // §5.3 order; stops at the first failure. Never throws. 'partial' when a
  // PATCH of this question had landed before the failure (D10: reload).
  save(): Promise<'ok' | 'partial' | 'failed'>;
  discard(): void;
  // R4: the failed part's server message, for QuizEditor's toast.
  readonly lastError: string | null;
  // The header text, for confirms and messages.
  title(): string;
};

export type QuizSaveHub = {
  register(c: QuizContributor): void;
  unregister(c: QuizContributor): void;
};
