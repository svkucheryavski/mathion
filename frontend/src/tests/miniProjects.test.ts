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

  it('createMiniProject POSTs to /api/runs/{rid}/mini-projects with body', async () => {
    fetchSpy.mockImplementation(() => jres({}));
    await createMiniProject(10, {
      block_id: 1,
      assignment_md: 'x',
      soft_deadline: null,
      hard_deadline: null,
      resubmission_deadline: null,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/10/mini-projects'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('updateMiniProject PATCHes /api/mini-projects/{mpId}', async () => {
    fetchSpy.mockImplementation(() => jres({}));
    await updateMiniProject(99, { assignment_md: 'y' });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/mini-projects/99'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('publishMiniProject POSTs /api/mini-projects/{mpId}/publish', async () => {
    fetchSpy.mockImplementation(() => jres({}));
    await publishMiniProject(99);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/mini-projects/99/publish'),
      expect.objectContaining({ method: 'POST' }),
    );
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
