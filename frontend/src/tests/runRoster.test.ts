import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listRunStudents, addRunStudent, updateRunStudent, removeRunStudent,
  batchAddRunStudents, bulkMoveRunStudents, bulkDeleteRunStudents,
} from '../lib/runRoster';
import { ApiError } from '../lib/api';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({ ok: status < 400, status, statusText: '', json: async () => body }));
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('roster CRUD', () => {
  it('listRunStudents GETs /api/runs/{rid}/students', async () => {
    const f = mockFetch(200, []); vi.stubGlobal('fetch', f);
    await listRunStudents(1);
    expect((f.mock.calls as unknown[][])[0][0]).toBe('/api/runs/1/students');
  });
  it('addRunStudent POSTs {email, group_id: null} for Unassigned (not omitted)', async () => {
    const f = mockFetch(201, {}); vi.stubGlobal('fetch', f);
    await addRunStudent(1, 'a@x.com', null);
    const body = JSON.parse(((f.mock.calls as unknown[][])[0][1] as RequestInit).body as string);
    expect(body).toEqual({ email: 'a@x.com', group_id: null });
    expect('group_id' in body).toBe(true);
  });
  it('updateRunStudent PATCHes {group_id}', async () => {
    const f = mockFetch(200, {}); vi.stubGlobal('fetch', f);
    await updateRunStudent(1, 5, 3);
    expect((f.mock.calls as unknown[][])[0][0]).toBe('/api/runs/1/students/5');
    expect(JSON.parse(((f.mock.calls as unknown[][])[0][1] as RequestInit).body as string)).toEqual({ group_id: 3 });
  });
  it('removeRunStudent DELETEs /api/runs/{rid}/students/{uid}', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 204, statusText: '', json: async () => ({}) }));
    vi.stubGlobal('fetch', f);
    await removeRunStudent(1, 5);
    expect(((f.mock.calls as unknown[][])[0][1] as RequestInit).method).toBe('DELETE');
  });
});

describe('batch', () => {
  it('batchAddRunStudents POSTs {rows} and returns {results}', async () => {
    const f = mockFetch(207, { results: [] }); vi.stubGlobal('fetch', f);
    await batchAddRunStudents(1, [{ email: 'a@x.com' }]);
    expect(JSON.parse(((f.mock.calls as unknown[][])[0][1] as RequestInit).body as string)).toEqual({ rows: [{ email: 'a@x.com' }] });
  });
});

describe('bulk validation', () => {
  it('bulkMoveRunStudents rejects empty user_ids', async () => {
    await expect(bulkMoveRunStudents(1, [], null)).rejects.toBeInstanceOf(ApiError);
  });
  it('bulkMoveRunStudents rejects >200 user_ids', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => i + 1);
    await expect(bulkMoveRunStudents(1, ids, null)).rejects.toBeInstanceOf(ApiError);
  });
  it('bulkMoveRunStudents rejects duplicate user_ids', async () => {
    await expect(bulkMoveRunStudents(1, [1, 2, 1], null)).rejects.toBeInstanceOf(ApiError);
  });
  it('bulkMoveRunStudents accepts exactly 200 user_ids', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => i + 1);
    vi.stubGlobal('fetch', mockFetch(207, { results: [], summary: { total: 200, ok: 200, error: 0 } }));
    await expect(bulkMoveRunStudents(1, ids, null)).resolves.toBeDefined();
  });
  it('bulkDeleteRunStudents enforces same validation', async () => {
    await expect(bulkDeleteRunStudents(1, [])).rejects.toBeInstanceOf(ApiError);
    await expect(bulkDeleteRunStudents(1, [1, 1])).rejects.toBeInstanceOf(ApiError);
  });
  it('bulkMoveRunStudents sends {user_ids, group_id} body', async () => {
    const f = mockFetch(207, { results: [], summary: { total: 1, ok: 1, error: 0 } });
    vi.stubGlobal('fetch', f);
    await bulkMoveRunStudents(1, [5], 3);
    expect(JSON.parse(((f.mock.calls as unknown[][])[0][1] as RequestInit).body as string)).toEqual({ user_ids: [5], group_id: 3 });
  });
});
