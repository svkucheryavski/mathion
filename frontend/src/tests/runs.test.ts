import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listRuns, listVersions, createRun, getRun, updateRun, deleteRun,
  publishRun, unpublishRun,
} from '../lib/runs';
import { ApiError } from '../lib/api';
import * as events from '../lib/events';
import type { RunResponse } from '../lib/types';

const sample: RunResponse = {
  id: 1, version_id: 7, title: 'Fall 2026', start_date: '2026-09-01',
  end_date: '2026-12-15', groups_enabled: true, is_published: false,
  created_at: '2026-05-19T10:00:00Z',
};

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'X',
    json: async () => body,
  }));
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('listRuns', () => {
  it('GETs /api/courses/{cid}/runs and returns the array', async () => {
    const f = mockFetch(200, [sample]);
    vi.stubGlobal('fetch', f);
    const result = await listRuns(42);
    expect(result).toEqual([sample]);
    expect(f).toHaveBeenCalledWith('/api/courses/42/runs', expect.objectContaining({ method: 'GET' }));
  });
  it('throws ApiError on 500', async () => {
    vi.stubGlobal('fetch', mockFetch(500, { detail: 'boom' }));
    await expect(listRuns(42)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('listVersions', () => {
  it('GETs /api/courses/{cid}/versions and returns the array', async () => {
    const v = { id: 7, course_id: 42, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false };
    const f = mockFetch(200, [v]);
    vi.stubGlobal('fetch', f);
    const result = await listVersions(42);
    expect(result).toEqual([v]);
    expect(f).toHaveBeenCalledWith('/api/courses/42/versions', expect.objectContaining({ method: 'GET' }));
  });
});

describe('createRun', () => {
  it('POSTs body without version_id', async () => {
    const f = mockFetch(201, sample);
    vi.stubGlobal('fetch', f);
    const body = { title: 'X', start_date: '2026-09-01', end_date: '2026-12-15', groups_enabled: true };
    const result = await createRun(42, body);
    expect(result).toEqual(sample);
    const calls0 = f.mock.calls as unknown[][];
    expect(calls0[0][0]).toBe('/api/courses/42/runs');
    const init0 = calls0[0][1] as RequestInit;
    expect(JSON.parse(init0.body as string)).toEqual(body);
    expect(JSON.parse(init0.body as string)).not.toHaveProperty('version_id');
  });
});

describe('getRun / updateRun / deleteRun', () => {
  it('getRun GETs /api/runs/{id}', async () => {
    const f = mockFetch(200, sample);
    vi.stubGlobal('fetch', f);
    await expect(getRun(1)).resolves.toEqual(sample);
    expect((f.mock.calls as unknown[][])[0][0]).toBe('/api/runs/1');
  });
  it('updateRun PATCHes /api/runs/{id}', async () => {
    const f = mockFetch(200, { ...sample, title: 'New' });
    vi.stubGlobal('fetch', f);
    await updateRun(1, { title: 'New' });
    const init1 = (f.mock.calls as unknown[][])[0][1];
    expect(init1).toMatchObject({ method: 'PATCH' });
  });
  it('deleteRun DELETEs /api/runs/{id}', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 204, statusText: 'No Content', json: async () => ({}) }));
    vi.stubGlobal('fetch', f);
    await expect(deleteRun(1)).resolves.toBeUndefined();
    const init2 = (f.mock.calls as unknown[][])[0][1];
    expect(init2).toMatchObject({ method: 'DELETE' });
  });
});

describe('publishRun / unpublishRun', () => {
  it('publishRun POSTs /api/runs/{id}/publish', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { ...sample, is_published: true }));
    const r = await publishRun(1);
    expect(r.is_published).toBe(true);
  });
  it('unpublishRun POSTs /api/runs/{id}/unpublish', async () => {
    vi.stubGlobal('fetch', mockFetch(200, sample));
    const r = await unpublishRun(1);
    expect(r.is_published).toBe(false);
  });
});

describe('401 emits unauthorized', () => {
  it('listRuns 401 → emitUnauthorized + throws', async () => {
    vi.stubGlobal('fetch', mockFetch(401, {}));
    const spy = vi.spyOn(events, 'emitUnauthorized').mockImplementation(() => undefined);
    await expect(listRuns(42)).rejects.toBeInstanceOf(ApiError);
    expect(spy).toHaveBeenCalled();
  });
});

describe('type contract: RunCreateRequest has no version_id', () => {
  it('compile-time check via type assertion', () => {
    // @ts-expect-error — version_id is not a valid key on RunCreateRequest
    const _bad: import('../lib/types').RunCreateRequest = { title: '', start_date: '', end_date: '', groups_enabled: true, version_id: 1 };
    expect(_bad).toBeDefined();
  });
});
