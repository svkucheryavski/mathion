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
  course: { id: number; slug: string; name: string; description: string; is_admin: boolean };
  version_id: number | null;
  version_state: 'created' | 'published' | 'archived' | null;
  covered_items: number;
  total_items: number;
  is_active: boolean;
  is_admin: boolean;
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

// ---- Admin tree (`/api/versions/:id/admin-tree`) ----
// CourseResponse — single-course payload from /api/courses/by-slug/{slug}.
export type Course = {
  id: number;
  slug: string;
  name: string;
  description: string;
  is_admin: boolean;
};

// VersionResponse — list/detail payload from /api/courses/{cid}/versions and
// /api/versions/{vid}. AdminTreeVersion adds `content_updated_at` for the
// admin-tree response only; do not conflate the two.
export type Version = {
  id: number;
  course_id: number;
  state: 'created' | 'published' | 'archived';
  is_disabled: boolean;
  info_md: string;
  info_html: string;
  max_quiz_attempts: number;
  created_at: string;
  published_at: string | null;
  archived_at: string | null;
};

export type AdminTreeVersion = Version & {
  content_updated_at: string;
};

export type AdminTreeItem = {
  id: number;
  sequence_id: number;
  title: string;
  slug: string;
  order: number;
  type: 'static_page' | 'video' | 'quiz' | 'interactive_app';
  content_md: string | null;
  content_html: string | null;
  video_url: string | null;
  script_url: string | null;
  questions_count: number;
};

export type AdminTreeSequence = {
  id: number;
  block_id: number;
  title: string;
  slug: string;
  order: number;
  items: AdminTreeItem[];
};

export type AdminTreeBlock = {
  id: number;
  version_id: number;
  title: string;
  slug: string;
  order: number;
  info: string;
  info_html: string;
  sequences: AdminTreeSequence[];
};

export type AdminTree = {
  course: { id: number; name: string; slug: string };
  version: AdminTreeVersion;
  blocks: AdminTreeBlock[];
};

// ---- Run management (Phase 8 frontend) ----
// Backend mirrors from backend/mathion/schemas.py. Course and Version are
// already defined above; do not redefine.

export type RunResponse = {
  id: number;
  version_id: number;
  title: string;
  start_date: string;     // YYYY-MM-DD
  end_date: string;       // YYYY-MM-DD
  groups_enabled: boolean;
  is_published: boolean;
  created_at: string;     // ISO timestamp
};

export type RunCreateRequest = {
  title: string;
  start_date: string;
  end_date: string;
  groups_enabled?: boolean;
};

export type RunUpdateRequest = {
  title?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  groups_enabled?: boolean | null;
};

export type RunTeacherResponse = {
  id: number;
  run_id: number;
  user_id: number;
  user_email: string;
  user_full_name: string | null;
  created_at: string;
};

export type GroupResponse = {
  id: number;
  run_id: number;
  name: string;
  is_disabled: boolean;
  student_count: number;
};

export type RunStudentResponse = {
  id: number;
  run_id: number;
  user_id: number;
  user_email: string;
  user_full_name: string | null;
  group_id: number | null;
  created_at: string;
};

export type RunStudentBatchRow = {
  name?: string | null;
  email: string;
  group?: string | null;
};

export type RunStudentBatchResultRow = {
  email: string;
  status: 'added' | 'error';
  group_id?: number | null;
  detail?: string | null;
};

export type BulkRosterErrorCode =
  | 'not_in_run'
  | 'capacity_reached'
  | 'internal_error';

export type BulkOpSummary = { total: number; ok: number; error: number };

export type BulkMoveResultRow = {
  user_id: number;
  status: 'ok' | 'error';
  group_id?: number | null;
  detail?: string | null;
  error_code?: BulkRosterErrorCode | null;
};

export type BulkDeleteResultRow = {
  user_id: number;
  status: 'ok' | 'error';
  detail?: string | null;
  error_code?: BulkRosterErrorCode | null;
};

export type BulkMoveResponse = {
  results: BulkMoveResultRow[];
  summary: BulkOpSummary;
};

export type BulkDeleteResponse = {
  results: BulkDeleteResultRow[];
  summary: BulkOpSummary;
};

// (No shared ChecklistRow type added in T1 — the readiness checklist row shape
// lives locally in T8's RunDetailPage.svelte, where the $derived computes it
// from teachers/groups/students/run. T10 consumes the same prop. Centralizing
// the type here would create drift if either side adds a field.)

// ---- Exhaustiveness helper ----
export function assertNever(x: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(x)}`);
}
