import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listGroups, createGroup, updateGroup, deleteGroup, getCapacityClass,
} from '../lib/runGroups';
import { ApiError } from '../lib/api';
import type { GroupResponse } from '../lib/types';

const g: GroupResponse = { id: 1, run_id: 1, name: 'A', is_disabled: false, student_count: 3 };

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({ ok: status < 400, status, statusText: '', json: async () => body }));
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('runGroups CRUD', () => {
  it('listGroups GETs /api/runs/{rid}/groups', async () => {
    const f = mockFetch(200, [g]); vi.stubGlobal('fetch', f);
    await expect(listGroups(1)).resolves.toEqual([g]);
    expect((f.mock.calls as unknown[][])[0][0]).toBe('/api/runs/1/groups');
  });
  it('createGroup POSTs {name}', async () => {
    const f = mockFetch(201, g); vi.stubGlobal('fetch', f);
    await createGroup(1, 'A');
    expect(JSON.parse(((f.mock.calls as unknown[][])[0][1] as RequestInit).body as string)).toEqual({ name: 'A' });
  });
  it('createGroup 409 throws ApiError', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { detail: 'Group exists' }));
    await expect(createGroup(1, 'A')).rejects.toBeInstanceOf(ApiError);
  });
  it('updateGroup PATCHes /api/groups/{gid}', async () => {
    const f = mockFetch(200, g); vi.stubGlobal('fetch', f);
    await updateGroup(1, { name: 'B' });
    expect((f.mock.calls as unknown[][])[0][0]).toBe('/api/groups/1');
    expect(((f.mock.calls as unknown[][])[0][1] as RequestInit).method).toBe('PATCH');
  });
  it('deleteGroup 409 "Group has students" throws ApiError', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { detail: 'Group has students; reassign or remove first' }));
    await expect(deleteGroup(1)).rejects.toBeInstanceOf(ApiError);
  });
  it('deleteGroup 409 "Group has submissions" throws ApiError', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { detail: 'Group has past submissions; disable instead' }));
    await expect(deleteGroup(1)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('getCapacityClass', () => {
  it('0 → empty', () => expect(getCapacityClass(0)).toBe('empty'));
  it('1 → ok', () => expect(getCapacityClass(1)).toBe('ok'));
  it('7 → ok', () => expect(getCapacityClass(7)).toBe('ok'));
  it('8 → warn', () => expect(getCapacityClass(8)).toBe('warn'));
  it('9 → warn', () => expect(getCapacityClass(9)).toBe('warn'));
  it('10 → full', () => expect(getCapacityClass(10)).toBe('full'));
  it('11 → full (defensive over-cap)', () => expect(getCapacityClass(11)).toBe('full'));
  it('-1 → empty (defensive)', () => expect(getCapacityClass(-1)).toBe('empty'));
  it('NaN → empty (defensive)', () => expect(getCapacityClass(NaN)).toBe('empty'));
});
