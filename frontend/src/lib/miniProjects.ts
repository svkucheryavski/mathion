import { api } from './api';
import type { MiniProjectResponse, MiniProjectCreate, MiniProjectUpdate } from './types';

export function listMiniProjects(runId: number): Promise<MiniProjectResponse[]> {
  return api.get(`/api/runs/${runId}/mini-projects`);
}

export function getMiniProject(mpId: number): Promise<MiniProjectResponse> {
  return api.get(`/api/mini-projects/${mpId}`);
}

export function createMiniProject(
  runId: number,
  body: MiniProjectCreate,
): Promise<MiniProjectResponse> {
  return api.post(`/api/runs/${runId}/mini-projects`, body);
}

export function updateMiniProject(
  mpId: number,
  body: MiniProjectUpdate,
): Promise<MiniProjectResponse> {
  return api.patch(`/api/mini-projects/${mpId}`, body);
}

export function publishMiniProject(mpId: number): Promise<MiniProjectResponse> {
  return api.post(`/api/mini-projects/${mpId}/publish`);
}

export function deleteMiniProject(mpId: number, opts?: { force?: boolean }): Promise<void> {
  const qs = opts?.force ? '?force=true' : '';
  return api.delete(`/api/mini-projects/${mpId}${qs}`);
}
