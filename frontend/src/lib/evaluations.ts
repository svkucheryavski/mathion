import { api, ApiError } from './api';
import { emitUnauthorized } from './events';

export const MAX_FEEDBACK_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export type EvaluationResult = 'rejected' | 'major_revision' | 'minor_revision' | 'accepted';

export interface Evaluation {
  id: number;
  submission_id: number;
  result: EvaluationResult;
  score: number | null;
  feedback_text: string | null;
  has_feedback_file: boolean;
  evaluated_at: string;
  evaluated_by: number;
}

export interface EvaluationCreateInput {
  submission_id: number;
  result: EvaluationResult;
  score?: number | null;
  feedback_text?: string | null;
  feedback_file?: File | null;
}

export interface EvaluationUpdateInput {
  result?: EvaluationResult;
  score?: number | null;
  feedback_text?: string | null;
}

export async function createEvaluation(
  input: EvaluationCreateInput,
  opts?: { signal?: AbortSignal },
): Promise<Evaluation> {
  const fd = new FormData();
  fd.append('result', input.result);
  if (input.score != null) fd.append('score', String(input.score));
  if (input.feedback_text != null) fd.append('feedback_text', input.feedback_text);
  if (input.feedback_file) fd.append('file', input.feedback_file);

  let r: Response;
  try {
    r = await fetch(`/api/submissions/${input.submission_id}/evaluation`, {
      method: 'POST',
      body: fd,
      credentials: 'include',
      headers: { 'X-Requested-With': 'mathion' },
      signal: opts?.signal,
    });
  } catch (e: unknown) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    throw new ApiError(0, 'Connection error');
  }
  if (r.status === 401) {
    emitUnauthorized(location.pathname + location.search + location.hash);
    throw new ApiError(401, 'Not authenticated');
  }
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new ApiError(r.status, body?.detail ?? 'Upload failed', body?.error_code);
  }
  return r.json();
}

export async function patchEvaluation(
  eid: number,
  input: EvaluationUpdateInput,
  opts?: { signal?: AbortSignal },
): Promise<Evaluation> {
  return api.patch<Evaluation>(`/api/evaluations/${eid}`, input, { signal: opts?.signal });
}
