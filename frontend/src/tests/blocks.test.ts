import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listBlocks } from '../lib/blocks';
import type { BlockResponse } from '../lib/types';

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

describe('listBlocks', () => {
  it('GETs /api/versions/{vid}/blocks and returns the list', async () => {
    const blocks: BlockResponse[] = [
      { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 0, info: '', info_html: '' },
      { id: 2, version_id: 7, title: 'Theory', slug: 'theory', order: 1, info: '', info_html: '' },
    ];
    fetchSpy.mockImplementation(() => jres(blocks));
    const result = await listBlocks(7);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/versions/7/blocks'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual(blocks);
  });
});
