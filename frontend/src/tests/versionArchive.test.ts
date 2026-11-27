import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/api')>();
  return { ...real, api: { ...real.api, get: vi.fn() } };
});

import { api, ApiError } from '../lib/api';
import { archiveUrl, checkArchive, startDownload } from '../lib/versionArchive';

afterEach(() => vi.restoreAllMocks());

describe('versionArchive', () => {
  it('archiveUrl is the version\'s archive address', () => {
    expect(archiveUrl(7)).toBe('/api/versions/7/archive');
  });

  it('startDownload clicks one download link and leaves nothing behind', () => {
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    startDownload('/x');
    expect(clicked).toHaveLength(1);
    expect(clicked[0].getAttribute('href')).toBe('/x');
    expect(clicked[0].hasAttribute('download')).toBe(true);
    expect(document.body.querySelector('a[download]')).toBeNull();
  });

  it('checkArchive asks the check address', async () => {
    vi.mocked(api.get).mockResolvedValue({ filename: 'c-v7.tar.gz' });
    await checkArchive(7);
    expect(api.get).toHaveBeenCalledWith('/api/versions/7/archive/check');
  });

  it('checkArchive passes the server\'s refusal on', async () => {
    const refusal = new ApiError(409, 'no');
    vi.mocked(api.get).mockRejectedValue(refusal);
    await expect(checkArchive(7)).rejects.toBe(refusal);
  });
});
