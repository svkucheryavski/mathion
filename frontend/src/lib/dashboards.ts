// frontend/src/lib/dashboards.ts
// Spec: docs/superpowers/specs/2026-05-31-teacher-dashboards-design.md §6.1, §6.2

import { api } from './api';  // existing project-wide fetch helper

// --- Status enum ---

export type MpGroupStatus =
  | 'not_submitted'
  | 'awaiting_eval'
  | 'needs_revision'
  | 'accepted'
  | 'rejected';

export const STATUS_LABEL: Record<MpGroupStatus, string> = {
  not_submitted: 'Not submitted',
  awaiting_eval: 'Awaiting evaluation',
  needs_revision: 'Needs revision',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

export const STATUS_ICON: Record<MpGroupStatus, string> = {
  not_submitted: '○',
  awaiting_eval: '…',
  needs_revision: '↻',
  accepted: '✓',
  rejected: '✗',
};

// Teacher-action-priority sort order (asc puts most-attention-needed first).
export const STATUS_PRIORITY: Record<MpGroupStatus, number> = {
  needs_revision: 0,
  rejected: 1,
  awaiting_eval: 2,
  not_submitted: 3,
  accepted: 4,
};

// Maps an evaluation result to the grid status badge. Mirrors backend
// _derive_status (dashboard.py:229-241) for the case where a submission
// EXISTS (a thread entry always has a submission, so 'not_submitted' is
// unreachable here). Param is `string` because ThreadEvaluation.result is
// `string`; unknown values fall through to awaiting_eval (backend's defensive
// default).
export function resultToStatus(result: string | null): MpGroupStatus {
  if (result === null) return 'awaiting_eval';
  if (result === 'major_revision' || result === 'minor_revision') return 'needs_revision';
  if (result === 'accepted') return 'accepted';
  if (result === 'rejected') return 'rejected';
  return 'awaiting_eval';
}

// ---- Progress dashboard ----

export interface DashboardSequence {
  block_id: number;
  block_order: number;
  block_title: string;
  sequence_id: number;
  sequence_order: number;
  sequence_title: string;
  total_items: number;
  has_quiz_items: boolean;
}

export interface DashboardCoverageCell { sequence_id: number; covered: number; total: number; }
export interface DashboardQuizCell { sequence_id: number; correct: number | null; total: number | null; }

export interface DashboardStudent {
  user_id: number;
  email: string;
  full_name: string | null;
  user_is_disabled: boolean;
  group_id: number | null;
  group_name: string | null;
  group_is_disabled: boolean;
  coverage: DashboardCoverageCell[];   // positionally aligned with `sequences[]` by index
  quizzes: DashboardQuizCell[];        // positionally aligned with `sequences[]` by index
}

export interface DashboardProgressResponse {
  run: { id: number; title: string; groups_enabled: boolean; version_is_disabled: boolean };
  sequences: DashboardSequence[];
  students: DashboardStudent[];
}

// ---- Mini-projects dashboard ----

export interface ThreadSubmissionBase {
  id: number;
  submission_number: number;
  submitted_at: string | null;
  submitted_by: { user_id: number; full_name: string | null } | null;
  is_late: boolean;
  is_resubmission: boolean;
  file_size: number;
}

export interface ThreadEvaluation {
  id: number;
  evaluated_at: string | null;
  evaluated_by: { user_id: number; full_name: string | null } | null;
  result: string;
  score: number | null;
  feedback_text: string | null;
  has_feedback_file: boolean;
}

export type ThreadSubmission = ThreadSubmissionBase & { evaluation: ThreadEvaluation | null };

export interface SubmissionThreadResponse {
  submissions: ThreadSubmission[];
}

export interface DashboardMpGroupEntry {
  group_id: number;
  group_name: string;
  group_is_disabled: boolean;
  status: MpGroupStatus;
  latest_submission: ThreadSubmissionBase | null;
  latest_evaluation: ThreadEvaluation | null;
}

export interface DashboardMpRow {
  id: number;
  title: string;
  block_id: number;
  block_order: number;
  block_title: string;
  is_published: boolean;
  first_submitted_at: string | null;
  soft_deadline: string | null;
  hard_deadline: string | null;
  resubmission_deadline: string | null;
  counts: {
    total_groups: number;
    not_submitted: number;
    awaiting_eval: number;
    needs_revision: number;
    accepted: number;
    rejected: number;
  };
  groups: DashboardMpGroupEntry[];
}

export interface DashboardMiniProjectsResponse {
  run: { id: number; title: string; groups_enabled: boolean };
  mini_projects: DashboardMpRow[];
}

// ---- Item drilldown ----

export interface SequenceItemScore { correct: number; total: number; }

export interface SequenceItemState {
  item_id: number;
  item_order: number;
  item_title: string;
  item_type: string;
  is_covered: boolean;
  last_score: SequenceItemScore | null;
  last_visited_at: string | null;
}

export interface SequenceItemStateResponse {
  sequence: { sequence_id: number; sequence_title: string; block_id: number; block_title: string };
  student: { user_id: number; full_name: string | null; email: string };
  items: SequenceItemState[];
}

// ---- Wire functions ----

export async function getProgressDashboard(
  runId: number,
  opts?: { signal?: AbortSignal },
): Promise<DashboardProgressResponse> {
  return api.get<DashboardProgressResponse>(`/api/runs/${runId}/dashboard/progress`, opts);
}

export async function getMiniProjectsDashboard(
  runId: number,
  opts?: { signal?: AbortSignal },
): Promise<DashboardMiniProjectsResponse> {
  return api.get<DashboardMiniProjectsResponse>(`/api/runs/${runId}/dashboard/mini-projects`, opts);
}

export async function getSequenceItemState(
  runId: number,
  userId: number,
  sequenceId: number,
  opts?: { signal?: AbortSignal },
): Promise<SequenceItemStateResponse> {
  return api.get<SequenceItemStateResponse>(
    `/api/runs/${runId}/students/${userId}/sequences/${sequenceId}/items`,
    opts,
  );
}

export async function getSubmissionThread(
  runId: number,
  mpId: number,
  groupId: number,
  opts?: { signal?: AbortSignal },
): Promise<SubmissionThreadResponse> {
  return api.get<SubmissionThreadResponse>(
    `/api/runs/${runId}/dashboard/mini-projects/${mpId}/groups/${groupId}/submissions`,
    opts,
  );
}
