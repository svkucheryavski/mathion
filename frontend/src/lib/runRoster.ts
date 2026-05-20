import { api, ApiError } from './api';
import type {
  RunStudentResponse, RunStudentBatchRow, RunStudentBatchResultRow,
  BulkMoveResponse, BulkDeleteResponse,
} from './types';

export function listRunStudents(runId: number): Promise<RunStudentResponse[]> {
  return api.get<RunStudentResponse[]>(`/api/runs/${runId}/students`);
}

export function addRunStudent(
  runId: number, email: string, groupId: number | null,
): Promise<RunStudentResponse> {
  return api.post<RunStudentResponse>(`/api/runs/${runId}/students`, { email, group_id: groupId });
}

export function updateRunStudent(
  runId: number, userId: number, groupId: number | null,
): Promise<RunStudentResponse> {
  return api.patch<RunStudentResponse>(`/api/runs/${runId}/students/${userId}`, { group_id: groupId });
}

export function removeRunStudent(runId: number, userId: number): Promise<void> {
  return api.delete(`/api/runs/${runId}/students/${userId}`);
}

export function batchAddRunStudents(
  runId: number, rows: RunStudentBatchRow[],
): Promise<{ results: RunStudentBatchResultRow[] }> {
  return api.post<{ results: RunStudentBatchResultRow[] }>(
    `/api/runs/${runId}/students/batch`, { rows },
  );
}

function validateBulkIds(userIds: number[]): void {
  if (userIds.length < 1) {
    throw new ApiError(0, 'bulkUserIds: must contain at least one user_id');
  }
  if (userIds.length > 200) {
    throw new ApiError(0, 'bulkUserIds: max 200 per chunk (callers must chunk)');
  }
  if (new Set(userIds).size !== userIds.length) {
    throw new ApiError(0, 'bulkUserIds: duplicate user_ids');
  }
}

export async function bulkMoveRunStudents(
  runId: number, userIds: number[], groupId: number | null,
): Promise<BulkMoveResponse> {
  validateBulkIds(userIds);
  return api.post<BulkMoveResponse>(
    `/api/runs/${runId}/students/bulk-move`, { user_ids: userIds, group_id: groupId },
  );
}

export async function bulkDeleteRunStudents(
  runId: number, userIds: number[],
): Promise<BulkDeleteResponse> {
  validateBulkIds(userIds);
  return api.post<BulkDeleteResponse>(
    `/api/runs/${runId}/students/bulk-delete`, { user_ids: userIds },
  );
}
