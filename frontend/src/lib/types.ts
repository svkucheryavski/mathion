// TypeScript mirrors of backend Pydantic shapes.
// If a backend response shape changes, every consumer breaks at `svelte-check` time.

// ---- Auth ----
export type User = {
  id: number;
  email: string;
  full_name: string | null;
  is_superuser: boolean;
  is_disabled: boolean;
  photo_url: string | null;
};

// ---- Course list ----
export type CourseListItem = {
  course: { id: number; slug: string; name: string; description: string };
  version_id: number;
  version_state: 'created' | 'published' | 'archived';
  covered_items: number;
  total_items: number;
  is_active: boolean;
};

// ---- Course tree (`/api/versions/:id/content`) ----
export type VersionContent = {
  course: { name: string; slug: string };
  version: {
    id: number;
    state: 'created' | 'published' | 'archived';
    info_html: string;
    max_quiz_attempts: number;
  };
  blocks: BlockContent[];
};

export type BlockContent = {
  id: number;
  title: string;
  slug: string;
  order: number;
  info: string;
  info_html: string;
  sequences: SequenceContent[];
};

export type SequenceContent = {
  id: number;
  title: string;
  slug: string;
  order: number;
  items: Item[];
};

// ---- Items: discriminated union over backend Item.type ----
export type Item =
  | StaticPageItem
  | VideoItem
  | QuizItem
  | MiniProjectItem
  | InteractiveAppItem;

type ItemBase = {
  id: number;
  sequence_id: number;
  title: string;
  slug: string;
  order: number;
};

export type StaticPageItem = ItemBase & {
  type: 'static_page';
  content_md: string;
  content_html: string;
};

export type VideoItem = ItemBase & {
  type: 'video';
  video_url: string;
};

export type QuizItem = ItemBase & {
  type: 'quiz';
  questions: Question[];
};

export type MiniProjectItem = ItemBase & {
  type: 'mini_project';
};

export type InteractiveAppItem = ItemBase & {
  type: 'interactive_app';
  script_url: string;
};

// ---- Questions: discriminated union ----
export type Question =
  | SingleChoiceQuestion
  | MultipleChoiceQuestion
  | NumericQuestion
  | TextQuestion;

type QuestionBase = {
  id: number;
  text_md: string;
  text_html: string;
  order: number;
};

export type SingleChoiceQuestion = QuestionBase & {
  type: 'single_choice';
  options: { id: number; text: string }[];
};

export type MultipleChoiceQuestion = QuestionBase & {
  type: 'multiple_choice';
  options: { id: number; text: string }[];
};

export type NumericQuestion = QuestionBase & {
  type: 'numeric_answer';
};

export type TextQuestion = QuestionBase & {
  type: 'text_answer';
};

// ---- State (`/api/versions/:id/state`) ----
export type VersionState = {
  version_id: number;
  items: Record<string, ItemStateEntry>; // key is item_id as string
};

export type ItemStateEntry = {
  is_covered: boolean;
  time_spent_seconds: number;
  last_visited_at: string | null; // ISO datetime
  last_answers: Record<string, number[] | string> | null;
  attempt_count: number;
  score_correct: number | null;
  score_total: number | null;
};

// ---- Quiz submit ----
export type QuizSubmitRequest = {
  answers: Record<string, number[] | string>;
};

export type QuizSubmitResponse = {
  item_id: number;
  attempt_count: number;
  max_attempts: number;
  score_correct: number;
  score_total: number;
  can_retry: boolean;
};

// ---- Quiz reveal ----
export type QuestionReveal = {
  id: number;
  type: Question['type'];
  text_html: string;
  explanation_html: string | null;
  correct_option_ids: number[];
  correct_numeric: number | null;
  correct_text: string | null;
  student_answer: number[] | string | null;
};

export type QuizRevealResponse = {
  item_id: number;
  attempt_count: number;
  score_correct: number;
  score_total: number;
  questions: QuestionReveal[];
};

// ---- Toasts ----
export type Toast = {
  id: number;
  message: string;
  kind: 'info' | 'error' | 'success';
};

// ---- Validation errors (FastAPI 422) ----
export type ValidationErrorDetail = {
  loc: (string | number)[];
  msg: string;
  type: string;
};

// ---- Exhaustiveness helper ----
export function assertNever(x: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(x)}`);
}
