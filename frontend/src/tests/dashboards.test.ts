import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  getProgressDashboard,
  getMiniProjectsDashboard,
  getSequenceItemState,
  getSubmissionThread,
  resultToStatus,
  STATUS_LABEL,
  STATUS_PRIORITY,
} from '../lib/dashboards';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({ ok: status < 400, status, statusText: '', json: async () => body }));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('wire URL + signal threading', () => {
  it('getProgressDashboard fetches the correct URL with signal', async () => {
    const f = mockFetch(200, { run: {}, sequences: [], students: [] });
    vi.stubGlobal('fetch', f);
    const ctrl = new AbortController();
    await getProgressDashboard(42, { signal: ctrl.signal });
    const url = (f.mock.calls as unknown[][])[0][0] as string;
    const init = (f.mock.calls as unknown[][])[0][1] as RequestInit;
    expect(url).toContain('/api/runs/42/dashboard/progress');
    expect(init.method).toBe('GET');
    expect(init.signal).toBe(ctrl.signal);
  });

  it('getMiniProjectsDashboard fetches the correct URL with signal', async () => {
    const f = mockFetch(200, { run: {}, mini_projects: [] });
    vi.stubGlobal('fetch', f);
    const ctrl = new AbortController();
    await getMiniProjectsDashboard(7, { signal: ctrl.signal });
    const url = (f.mock.calls as unknown[][])[0][0] as string;
    const init = (f.mock.calls as unknown[][])[0][1] as RequestInit;
    expect(url).toContain('/api/runs/7/dashboard/mini-projects');
    expect(init.method).toBe('GET');
    expect(init.signal).toBe(ctrl.signal);
  });

  it('getSequenceItemState fetches the correct URL with signal', async () => {
    const f = mockFetch(200, { sequence: {}, student: {}, items: [] });
    vi.stubGlobal('fetch', f);
    const ctrl = new AbortController();
    await getSequenceItemState(3, 14, 99, { signal: ctrl.signal });
    const url = (f.mock.calls as unknown[][])[0][0] as string;
    const init = (f.mock.calls as unknown[][])[0][1] as RequestInit;
    expect(url).toContain('/api/runs/3/students/14/sequences/99/items');
    expect(init.method).toBe('GET');
    expect(init.signal).toBe(ctrl.signal);
  });
});

describe('response-shape conformance', () => {
  it('getProgressDashboard extracts run/sequences/students keys', async () => {
    const mockBody = {
      run: { id: 1, title: 'R', groups_enabled: true, version_is_disabled: false },
      sequences: [{
        block_id: 5, block_order: 1, block_title: 'B',
        sequence_id: 10, sequence_order: 1, sequence_title: 'S',
        total_items: 4, has_quiz_items: true,
      }],
      students: [{
        user_id: 100, email: 'a@x', full_name: 'A', user_is_disabled: false,
        group_id: 1, group_name: 'G1', group_is_disabled: false,
        coverage: [{ sequence_id: 10, covered: 2, total: 4 }],
        quizzes: [{ sequence_id: 10, correct: 1, total: 2 }],
      }],
    };
    vi.stubGlobal('fetch', mockFetch(200, mockBody));
    const res = await getProgressDashboard(1);
    expect(res.run.groups_enabled).toBe(true);
    expect(res.sequences[0].sequence_id).toBe(10);
    expect(res.sequences[0].has_quiz_items).toBe(true);
    expect(res.students[0].user_id).toBe(100);
    expect(res.students[0].coverage[0].covered).toBe(2);
    expect(res.students[0].quizzes[0].correct).toBe(1);
  });

  it('getMiniProjectsDashboard extracts run/mini_projects keys including title', async () => {
    const mockBody = {
      run: { id: 1, title: 'R', groups_enabled: true },
      mini_projects: [{
        id: 1, title: 'Mini project for Block 1',
        block_id: 5, block_order: 1, block_title: 'B',
        is_published: true,
        first_submitted_at: null, soft_deadline: null,
        hard_deadline: null, resubmission_deadline: null,
        counts: {
          total_groups: 1, not_submitted: 1, awaiting_eval: 0,
          needs_revision: 0, accepted: 0, rejected: 0,
        },
        groups: [{
          group_id: 1, group_name: 'G1', group_is_disabled: false,
          status: 'not_submitted',
          latest_submission: null,
          latest_evaluation: null,
        }],
      }],
    };
    vi.stubGlobal('fetch', mockFetch(200, mockBody));
    const res = await getMiniProjectsDashboard(1);
    expect(res.mini_projects[0].title).toBe('Mini project for Block 1');
    expect(res.mini_projects[0].counts.total_groups).toBe(1);
    expect(res.mini_projects[0].groups[0].status).toBe('not_submitted');
    expect(res.mini_projects[0].groups[0].latest_submission).toBeNull();
  });

  it('getSequenceItemState extracts sequence/student/items', async () => {
    const mockBody = {
      sequence: { sequence_id: 10, sequence_title: 'S', block_id: 5, block_title: 'B' },
      student: { user_id: 100, full_name: 'A', email: 'a@x' },
      items: [
        {
          item_id: 1, item_order: 1, item_title: 'I1', item_type: 'static_page',
          is_covered: true, last_score: null, last_visited_at: '2026-05-31T12:00:00Z',
        },
        {
          item_id: 2, item_order: 2, item_title: 'I2', item_type: 'quiz',
          is_covered: true,
          last_score: { correct: 3, total: 5 },
          last_visited_at: '2026-05-31T12:05:00Z',
        },
      ],
    };
    vi.stubGlobal('fetch', mockFetch(200, mockBody));
    const res = await getSequenceItemState(1, 100, 10);
    expect(res.items[1].last_score?.correct).toBe(3);
    expect(res.items[1].last_score?.total).toBe(5);
    expect(res.items[0].last_score).toBeNull();
    expect(res.items[1].last_visited_at).toBe('2026-05-31T12:05:00Z');
  });
});

describe('exported constants', () => {
  it('STATUS_LABEL covers all 5 status enum values', () => {
    expect(Object.keys(STATUS_LABEL).sort()).toEqual(
      ['accepted', 'awaiting_eval', 'needs_revision', 'not_submitted', 'rejected'],
    );
  });

  it('STATUS_PRIORITY puts needs_revision first', () => {
    expect(STATUS_PRIORITY.needs_revision).toBeLessThan(STATUS_PRIORITY.accepted);
    expect(STATUS_PRIORITY.needs_revision).toBeLessThan(STATUS_PRIORITY.not_submitted);
  });
});

describe('resultToStatus (mirrors backend _derive_status)', () => {
  it('null → awaiting_eval', () => expect(resultToStatus(null)).toBe('awaiting_eval'));
  it('major_revision → needs_revision', () => expect(resultToStatus('major_revision')).toBe('needs_revision'));
  it('minor_revision → needs_revision', () => expect(resultToStatus('minor_revision')).toBe('needs_revision'));
  it('accepted → accepted', () => expect(resultToStatus('accepted')).toBe('accepted'));
  it('rejected → rejected', () => expect(resultToStatus('rejected')).toBe('rejected'));
  it('unknown → awaiting_eval (defensive)', () => expect(resultToStatus('weird')).toBe('awaiting_eval'));
});

describe('getSubmissionThread wire', () => {
  it('fetches correct URL with signal', async () => {
    const f = mockFetch(200, { submissions: [] });
    vi.stubGlobal('fetch', f);
    const ctrl = new AbortController();
    await getSubmissionThread(5, 12, 99, { signal: ctrl.signal });
    const url = (f.mock.calls as unknown[][])[0][0] as string;
    const init = (f.mock.calls as unknown[][])[0][1] as RequestInit;
    expect(url).toBe('/api/runs/5/dashboard/mini-projects/12/groups/99/submissions');
    expect(init.method).toBe('GET');
    expect(init.signal).toBe(ctrl.signal);
  });
});
