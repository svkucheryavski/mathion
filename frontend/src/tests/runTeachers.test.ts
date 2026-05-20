import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { listRunTeachers, addRunTeacher, removeRunTeacher } from '../lib/runTeachers';
import { ApiError } from '../lib/api';
import type { RunTeacherResponse } from '../lib/types';

const t: RunTeacherResponse = {
  id: 1, run_id: 1, user_id: 5, user_email: 't@x.com', user_full_name: 'T', created_at: 'z',
};

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({ ok: status < 400, status, statusText: '', json: async () => body }));
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('runTeachers', () => {
  it('listRunTeachers GETs /api/runs/{rid}/teachers', async () => {
    const f = mockFetch(200, [t]); vi.stubGlobal('fetch', f);
    await expect(listRunTeachers(1)).resolves.toEqual([t]);
    expect((f.mock.calls as unknown[][])[0][0]).toBe('/api/runs/1/teachers');
  });
  it('addRunTeacher POSTs {email}', async () => {
    const f = mockFetch(201, t); vi.stubGlobal('fetch', f);
    await addRunTeacher(1, 't@x.com');
    expect(JSON.parse(((f.mock.calls as unknown[][])[0][1] as RequestInit).body as string)).toEqual({ email: 't@x.com' });
  });
  it('addRunTeacher 409 throws ApiError', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { detail: 'Already assigned' }));
    await expect(addRunTeacher(1, 't@x.com')).rejects.toBeInstanceOf(ApiError);
  });
  it('removeRunTeacher DELETEs /api/runs/{rid}/teachers/{uid}', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 204, statusText: '', json: async () => ({}) }));
    vi.stubGlobal('fetch', f);
    await removeRunTeacher(1, 5);
    expect((f.mock.calls as unknown[][])[0][0]).toBe('/api/runs/1/teachers/5');
    expect(((f.mock.calls as unknown[][])[0][1] as RequestInit).method).toBe('DELETE');
  });
});
