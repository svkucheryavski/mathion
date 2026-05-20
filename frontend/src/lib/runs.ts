import { api } from './api';
import type {
  RunResponse, RunCreateRequest, RunUpdateRequest, Version,
} from './types';

export function listRuns(courseId: number): Promise<RunResponse[]> {
  return api.get<RunResponse[]>(`/api/courses/${courseId}/runs`);
}

export function listVersions(courseId: number): Promise<Version[]> {
  return api.get<Version[]>(`/api/courses/${courseId}/versions`);
}

export function createRun(courseId: number, body: RunCreateRequest): Promise<RunResponse> {
  return api.post<RunResponse>(`/api/courses/${courseId}/runs`, body);
}

export function getRun(runId: number): Promise<RunResponse> {
  return api.get<RunResponse>(`/api/runs/${runId}`);
}

export function updateRun(runId: number, body: RunUpdateRequest): Promise<RunResponse> {
  return api.patch<RunResponse>(`/api/runs/${runId}`, body);
}

export function deleteRun(runId: number): Promise<void> {
  return api.delete(`/api/runs/${runId}`);
}

export function publishRun(runId: number): Promise<RunResponse> {
  return api.post<RunResponse>(`/api/runs/${runId}/publish`);
}

export function unpublishRun(runId: number): Promise<RunResponse> {
  return api.post<RunResponse>(`/api/runs/${runId}/unpublish`);
}
