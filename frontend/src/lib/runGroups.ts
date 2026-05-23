import { api } from './api';
import type { GroupResponse } from './types';

export function listGroups(runId: number): Promise<GroupResponse[]> {
  return api.get<GroupResponse[]>(`/api/runs/${runId}/groups`);
}

export function createGroup(runId: number, name: string): Promise<GroupResponse> {
  return api.post<GroupResponse>(`/api/runs/${runId}/groups`, { name });
}

export function updateGroup(
  groupId: number,
  body: { name?: string; is_disabled?: boolean },
): Promise<GroupResponse> {
  return api.patch<GroupResponse>(`/api/groups/${groupId}`, body);
}

export function deleteGroup(groupId: number): Promise<void> {
  return api.delete(`/api/groups/${groupId}`);
}

export type CapacityClass = 'empty' | 'ok' | 'warn' | 'full';

export function getCapacityClass(count: number): CapacityClass {
  if (!Number.isFinite(count) || count <= 0) return 'empty';
  if (count <= 7) return 'ok';
  if (count <= 9) return 'warn';
  return 'full';
}
