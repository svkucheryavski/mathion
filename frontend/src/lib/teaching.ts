import { api } from './api';
import type { RunResponse } from './types';

export interface TeachingRunRow {
  run: RunResponse;
  course_id: number;
  course_name: string;
  course_slug: string;
  student_count: number;
}

export function listTeachingRuns(): Promise<TeachingRunRow[]> {
  return api.get<TeachingRunRow[]>('/api/teaching/runs');
}
