import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEvaluation, patchEvaluation, MAX_FEEDBACK_FILE_SIZE_BYTES } from '../lib/evaluations';
import * as events from '../lib/events';

function jsonResp(status: number, body: unknown, statusText = ''): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

function nonJsonResp(status: number, statusText = ''): Response {
  return new Response('<html>Error</html>', {
    status,
    statusText,
    headers: { 'Content-Type': 'text/html' },
  });
}

describe('createEvaluation (multipart POST)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('WT1: builds FormData with all fields + credentials + X-Requested-With', async () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'fb.pdf', { type: 'application/pdf' });
    fetchMock.mockResolvedValue(jsonResp(201, {
      id: 1, submission_id: 7, result: 'major_revision', score: 80, feedback_text: 'Fix',
      has_feedback_file: true, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1,
    }));
    await createEvaluation({
      submission_id: 7, result: 'major_revision', score: 80, feedback_text: 'Fix', feedback_file: pdf,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/submissions/7/evaluation');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('mathion');
    const fd = init.body as FormData;
    expect(fd.get('result')).toBe('major_revision');
    expect(fd.get('score')).toBe('80');
    expect(fd.get('feedback_text')).toBe('Fix');
    expect(fd.get('file')).toBe(pdf);
    expect([...fd.keys()].sort()).toEqual(['feedback_text', 'file', 'result', 'score']);
  });

  it('WT2: omits null/undefined fields', async () => {
    fetchMock.mockResolvedValue(jsonResp(201, {
      id: 1, submission_id: 7, result: 'accepted', score: null, feedback_text: null,
      has_feedback_file: false, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1,
    }));
    await createEvaluation({ submission_id: 7, result: 'accepted' });
    const fd = fetchMock.mock.calls[0][1].body as FormData;
    expect([...fd.keys()]).toEqual(['result']);
    expect(fd.get('result')).toBe('accepted');
  });

  it('WT3: AbortSignal re-throws AbortError (NOT ApiError(0))', async () => {
    const controller = new AbortController();
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValue(abortErr);
    controller.abort();
    await expect(
      createEvaluation({ submission_id: 7, result: 'accepted' }, { signal: controller.signal }),
    ).rejects.toBe(abortErr);
  });

  it('WT4a: throws ApiError(422) with JSON detail', async () => {
    fetchMock.mockResolvedValue(jsonResp(422, { detail: 'feedback_file required for non-accepted result' }));
    await expect(createEvaluation({ submission_id: 7, result: 'major_revision' })).rejects.toMatchObject({
      status: 422,
      detail: 'feedback_file required for non-accepted result',
    });
  });

  it('WT4b: throws ApiError(500) with "Upload failed" fallback on non-JSON body', async () => {
    fetchMock.mockResolvedValue(nonJsonResp(500, 'Internal Server Error'));
    await expect(createEvaluation({ submission_id: 7, result: 'accepted' })).rejects.toMatchObject({
      status: 500,
      detail: 'Upload failed',
    });
  });

  it('WT7: on 401 calls emitUnauthorized(return-path) + throws ApiError(401, "Not authenticated")', async () => {
    // jsdom 25 makes window.location non-configurable; use history.pushState to
    // change the URL so location.pathname/search/hash reflect the desired path.
    window.history.pushState({}, '', '/runs/42?tab=submission#focus');
    const spy = vi.spyOn(events, 'emitUnauthorized').mockImplementation(() => {});
    fetchMock.mockResolvedValue(jsonResp(401, { detail: 'no session' }));
    await expect(createEvaluation({ submission_id: 7, result: 'accepted' })).rejects.toMatchObject({
      status: 401,
      detail: 'Not authenticated',
    });
    expect(spy).toHaveBeenCalledWith('/runs/42?tab=submission#focus');
  });
});

describe('patchEvaluation (JSON PATCH)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('WT5: sends JSON body, no file key, correct URL', async () => {
    fetchMock.mockResolvedValue(jsonResp(200, {
      id: 42, submission_id: 7, result: 'accepted', score: 95, feedback_text: 'Good',
      has_feedback_file: true, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1,
    }));
    await patchEvaluation(42, { result: 'accepted', score: 95, feedback_text: 'Good' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/evaluations/42');
    expect(init.method).toBe('PATCH');
    // api.patch routes through lib/api.ts request() which wraps headers via
    // `new Headers(callerHeaders ?? {})` (frontend/src/lib/api.ts:34).
    // Headers instances are NOT plain objects — read with .get().
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Requested-With')).toBe('mathion');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ result: 'accepted', score: 95, feedback_text: 'Good' });
    expect('file' in body).toBe(false);
  });

  it('WT6: propagates ApiError on 4xx', async () => {
    fetchMock.mockResolvedValue(jsonResp(422, { detail: 'Cannot transition' }));
    await expect(patchEvaluation(42, { result: 'minor_revision' })).rejects.toMatchObject({
      status: 422,
      detail: 'Cannot transition',
    });
  });
});

describe('Constants', () => {
  it('WC1: MAX_FEEDBACK_FILE_SIZE_BYTES matches backend default (20 MB)', () => {
    expect(MAX_FEEDBACK_FILE_SIZE_BYTES).toBe(20 * 1024 * 1024);
  });
});
