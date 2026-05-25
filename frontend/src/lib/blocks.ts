import { api } from './api';
import type { BlockResponse } from './types';

export function listBlocks(versionId: number): Promise<BlockResponse[]> {
  return api.get<BlockResponse[]>(`/api/versions/${versionId}/blocks`);
}
