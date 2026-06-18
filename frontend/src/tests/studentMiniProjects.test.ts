import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchListSwallow403,
  fetchDetail,
  submit,
  rewriteExternalLinks,
} from '../lib/studentMiniProjects';
import { ApiError } from '../lib/api';
import * as events from '../lib/events';
import type { StudentMiniProjectListItem, StudentMiniProjectDetail } from '../lib/types';

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

function makeListItem(over: Partial<StudentMiniProjectListItem> = {}): StudentMiniProjectListItem {
  return {
    mp_id: 1,
    block_id: 10,
    block_slug: 'intro',
    block_order: 0,
    block_title: 'Intro',
    hard_deadline: null,
    soft_deadline: null,
    resubmission_deadline: null,
    latest_status: 'not_submitted',
    ...over,
  };
}

function makeDetail(over: Partial<StudentMiniProjectDetail> = {}): StudentMiniProjectDetail {
  return {
    mp_id: 1,
    run_id: 5,
    block_id: 10,
    block_slug: 'intro',
    block_title: 'Intro',
    assignment_html: '<p>do it</p>',
    soft_deadline: null,
    hard_deadline: null,
    resubmission_deadline: null,
    group: null,
    submission_history: [],
    latest_status: 'not_submitted',
    can_submit: true,
    can_submit_reason_if_not: null,
    ...over,
  };
}

describe('fetchListSwallow403', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns map keyed by String(block_id) on 200', async () => {
    const items = [
      makeListItem({ mp_id: 1, block_id: 10 }),
      makeListItem({ mp_id: 2, block_id: 25, block_slug: 'finale', block_title: 'Finale' }),
    ];
    fetchMock.mockResolvedValue(jsonResp(200, items));
    const result = await fetchListSwallow403('algebra-101');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/courses/algebra-101/mini-projects');
    expect(result).toEqual({
      '10': items[0],
      '25': items[1],
    });
  });

  it('returns {} on 403 without calling emitUnauthorized', async () => {
    const spy = vi.spyOn(events, 'emitUnauthorized').mockImplementation(() => {});
    fetchMock.mockResolvedValue(jsonResp(403, { detail: 'no active run' }));
    const result = await fetchListSwallow403('algebra-101');
    expect(result).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  it('propagates 401 and calls emitUnauthorized once', async () => {
    window.history.pushState({}, '', '/courses/algebra-101');
    const spy = vi.spyOn(events, 'emitUnauthorized').mockImplementation(() => {});
    fetchMock.mockResolvedValue(jsonResp(401, { detail: 'no session' }));
    await expect(fetchListSwallow403('algebra-101')).rejects.toMatchObject({
      status: 401,
      detail: 'Not authenticated',
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('propagates 500 (F16: no swallow)', async () => {
    fetchMock.mockResolvedValue(nonJsonResp(500, 'Internal Server Error'));
    await expect(fetchListSwallow403('algebra-101')).rejects.toBeInstanceOf(ApiError);
    await expect(fetchListSwallow403('algebra-101')).rejects.toMatchObject({ status: 500 });
  });

  it('propagates AbortError (DOMException name="AbortError")', async () => {
    const controller = new AbortController();
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValue(abortErr);
    controller.abort();
    await expect(fetchListSwallow403('algebra-101', controller.signal)).rejects.toBe(abortErr);
  });

  it('encodes the slug', async () => {
    fetchMock.mockResolvedValue(jsonResp(200, []));
    await fetchListSwallow403('a/b c');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/courses/a%2Fb%20c/mini-projects');
  });
});

describe('fetchDetail', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('builds URL with encodeURIComponent on BOTH slugs + returns parsed body', async () => {
    const detail = makeDetail();
    fetchMock.mockResolvedValue(jsonResp(200, detail));
    const result = await fetchDetail('a/b', 'intro slug');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/courses/a%2Fb/blocks/intro%20slug/mini-project');
    expect(result).toEqual(detail);
  });

  it('401 → emitUnauthorized called once + ApiError(401) thrown', async () => {
    window.history.pushState({}, '', '/courses/c/blocks/b/mini-project');
    const spy = vi.spyOn(events, 'emitUnauthorized').mockImplementation(() => {});
    fetchMock.mockResolvedValue(jsonResp(401, { detail: 'no session' }));
    await expect(fetchDetail('c', 'b')).rejects.toMatchObject({
      status: 401,
      detail: 'Not authenticated',
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('403 → ApiError(403) thrown', async () => {
    fetchMock.mockResolvedValue(jsonResp(403, { detail: 'no active run' }));
    await expect(fetchDetail('c', 'b')).rejects.toMatchObject({ status: 403 });
  });

  it('404 → ApiError(404) thrown', async () => {
    fetchMock.mockResolvedValue(jsonResp(404, { detail: 'not found' }));
    await expect(fetchDetail('c', 'b')).rejects.toMatchObject({ status: 404 });
  });

  it('network failure propagates (rejected fetch)', async () => {
    const netErr = new TypeError('network down');
    fetchMock.mockRejectedValue(netErr);
    await expect(fetchDetail('c', 'b')).rejects.toBe(netErr);
  });
});

describe('submit', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('builds multipart POST to correct URL and resolves on 201', async () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 's.pdf', {
      type: 'application/pdf',
    });
    fetchMock.mockResolvedValue(jsonResp(201, { id: 99 }));
    await submit(42, pdf);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/mini-projects/42/submissions');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('mathion');
    const fd = init.body as FormData;
    expect(fd.get('file')).toBe(pdf);
    expect([...fd.keys()]).toEqual(['file']);
  });

  it('401 → emitUnauthorized + ApiError thrown', async () => {
    window.history.pushState({}, '', '/courses/c/blocks/b/mini-project');
    const spy = vi.spyOn(events, 'emitUnauthorized').mockImplementation(() => {});
    const pdf = new File([new Uint8Array([0x25])], 's.pdf', { type: 'application/pdf' });
    fetchMock.mockResolvedValue(jsonResp(401, { detail: 'no session' }));
    await expect(submit(42, pdf)).rejects.toMatchObject({
      status: 401,
      detail: 'Not authenticated',
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('409 → ApiError preserved with detail', async () => {
    const pdf = new File([new Uint8Array([0x25])], 's.pdf', { type: 'application/pdf' });
    fetchMock.mockResolvedValue(jsonResp(409, { detail: 'Already accepted; no further submission' }));
    await expect(submit(42, pdf)).rejects.toMatchObject({
      status: 409,
      detail: 'Already accepted; no further submission',
    });
  });

  it('503 → ApiError preserved', async () => {
    const pdf = new File([new Uint8Array([0x25])], 's.pdf', { type: 'application/pdf' });
    fetchMock.mockResolvedValue(nonJsonResp(503, 'Service Unavailable'));
    await expect(submit(42, pdf)).rejects.toBeInstanceOf(ApiError);
    await expect(submit(42, pdf)).rejects.toMatchObject({ status: 503 });
  });
});

describe('rewriteExternalLinks', () => {
  it('adds target=_blank rel=noopener noreferrer to https:// links', () => {
    const container = document.createElement('div');
    container.innerHTML = '<a href="https://example.com">x</a>';
    rewriteExternalLinks(container);
    const a = container.querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('adds target/rel to http:// links', () => {
    const container = document.createElement('div');
    container.innerHTML = '<a href="http://example.com">x</a>';
    rewriteExternalLinks(container);
    const a = container.querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('rewrites protocol-relative // links', () => {
    const container = document.createElement('div');
    container.innerHTML = '<a href="//cdn.example.com/x">x</a>';
    rewriteExternalLinks(container);
    const a = container.querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('leaves /api/runs/... same-origin asset links unchanged', () => {
    const container = document.createElement('div');
    container.innerHTML = '<a href="/api/runs/1/assets/x.png">asset</a>';
    rewriteExternalLinks(container);
    const a = container.querySelector('a')!;
    expect(a.hasAttribute('target')).toBe(false);
    expect(a.hasAttribute('rel')).toBe(false);
  });

  it('leaves mailto: links unchanged', () => {
    const container = document.createElement('div');
    container.innerHTML = '<a href="mailto:t@x.com">mail</a>';
    rewriteExternalLinks(container);
    const a = container.querySelector('a')!;
    expect(a.hasAttribute('target')).toBe(false);
    expect(a.hasAttribute('rel')).toBe(false);
  });

  it('leaves tel: links unchanged', () => {
    const container = document.createElement('div');
    container.innerHTML = '<a href="tel:+15551234">phone</a>';
    rewriteExternalLinks(container);
    const a = container.querySelector('a')!;
    expect(a.hasAttribute('target')).toBe(false);
    expect(a.hasAttribute('rel')).toBe(false);
  });
});
