import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  listMiniProjects,
  getMiniProject,
  createMiniProject,
  updateMiniProject,
  publishMiniProject,
  deleteMiniProject,
} from '../lib/miniProjects';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

describe('miniProjects wrappers', () => {
  it('listMiniProjects GETs /api/runs/{rid}/mini-projects', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    await listMiniProjects(10);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/10/mini-projects'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('getMiniProject GETs /api/mini-projects/{mpId}', async () => {
    fetchSpy.mockImplementation(() => jres({}));
    await getMiniProject(99);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/mini-projects/99'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('createMiniProject POSTs to /api/runs/{rid}/mini-projects with the exact body shape', async () => {
    fetchSpy.mockImplementation(() => jres({}));
    const body = {
      block_id: 1,
      assignment_md: 'x',
      soft_deadline: null,
      hard_deadline: null,
      resubmission_deadline: null,
    };
    await createMiniProject(10, body);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/10/mini-projects'),
      expect.objectContaining({ method: 'POST' }),
    );
    // Lock the wire body — a regression that drops or reshapes fields must fail here.
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it('updateMiniProject PATCHes /api/mini-projects/{mpId} with the partial body', async () => {
    fetchSpy.mockImplementation(() => jres({}));
    await updateMiniProject(99, { assignment_md: 'y' });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/mini-projects/99'),
      expect.objectContaining({ method: 'PATCH' }),
    );
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ assignment_md: 'y' });
  });

  it('publishMiniProject POSTs /api/mini-projects/{mpId}/publish with no body and returns the response', async () => {
    const responseBody = { id: 99, run_id: 10, is_published: true };
    fetchSpy.mockImplementation(() => jres(responseBody));
    const result = await publishMiniProject(99);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/mini-projects/99/publish'),
      expect.objectContaining({ method: 'POST' }),
    );
    // api.post sends body: undefined when none provided (lib/api.ts:54) — lock that.
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
    // Response is returned to the caller unchanged.
    expect(result).toMatchObject(responseBody);
  });

  it('deleteMiniProject DELETEs /api/mini-projects/{mpId} (no force by default)', async () => {
    fetchSpy.mockImplementation(() => jres('', 204));
    await deleteMiniProject(99);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/mini-projects\/99(?!.*force=true)/),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('deleteMiniProject with force=true appends ?force=true', async () => {
    fetchSpy.mockImplementation(() => jres('', 204));
    await deleteMiniProject(99, { force: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/mini-projects/99?force=true'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('throws ApiError on 409 (locked, no force)', async () => {
    fetchSpy.mockImplementation(() =>
      jres({ detail: 'Mini-project is locked (has submissions); use ?force=true' }, 409),
    );
    await expect(deleteMiniProject(99)).rejects.toThrowError(/locked/i);
  });
});
