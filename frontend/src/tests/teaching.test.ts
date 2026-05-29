import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listTeachingRuns } from '../lib/teaching';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }));
}

describe('listTeachingRuns', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('calls GET /api/teaching/runs and returns the parsed array', async () => {
    const fixture = [
      {
        run: {
          id: 1, version_id: 1, title: 'R',
          start_date: '2026-01-01', end_date: '2026-12-31',
          groups_enabled: false, is_published: true,
          created_at: '2026-01-01T00:00:00Z',
        },
        course_id: 10, course_name: 'C', course_slug: 'c', student_count: 0,
      },
    ];
    const f = mockFetch(200, fixture);
    vi.stubGlobal('fetch', f);
    const out = await listTeachingRuns();
    expect(out).toEqual(fixture);
    expect(f).toHaveBeenCalledWith(
      '/api/teaching/runs',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
