import { api } from './api';
import type { RunTeacherResponse } from './types';

export function listRunTeachers(runId: number): Promise<RunTeacherResponse[]> {
  return api.get<RunTeacherResponse[]>(`/api/runs/${runId}/teachers`);
}

export function addRunTeacher(runId: number, email: string): Promise<RunTeacherResponse> {
  return api.post<RunTeacherResponse>(`/api/runs/${runId}/teachers`, { email });
}

export function removeRunTeacher(runId: number, userId: number): Promise<void> {
  return api.delete(`/api/runs/${runId}/teachers/${userId}`);
}
