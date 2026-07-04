import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';

// Mock csvWrite so we can capture what text is passed to downloadCSV.
// toCSV and sanitizeTitle still use real implementations.
vi.mock('../lib/csvWrite', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/csvWrite')>();
  return {
    ...real,
    downloadCSV: vi.fn(),
  };
});

import { downloadCSV } from '../lib/csvWrite';
import { STATUS_LABEL, STATUS_ICON } from '../lib/dashboards';
import RunSubmissionTab from '../components/runs/RunSubmissionTab.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function mockFetch(status: number, body: unknown) {
  return vi.fn(() => Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  ));
}

// Serves dashboard GETs and thread GETs from independent ordered lists (last entry sticks).
function routedTabFetch(dashboards: unknown[], threads: unknown[]) {
  let di = 0, ti = 0;
  return vi.fn((url: string, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && u.includes('/groups/') && u.endsWith('/submissions')) {
      const t = threads[Math.min(ti, threads.length - 1)] ?? { submissions: [] };
      ti += 1;
      return Promise.resolve(new Response(JSON.stringify(t), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    const d = dashboards[Math.min(di, dashboards.length - 1)];
    di += 1;
    return Promise.resolve(new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });
}

function mountTab(runId = 1) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(RunSubmissionTab, { target: host, props: { runId } });
  flushSync();
  return host;
}

beforeEach(() => { vi.restoreAllMocks(); });

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

async function settle() {
  await tick(); await tick(); await tick();
  flushSync();
}

function submissionMock(overrides: Record<string, unknown> = {}) {
  return {
    run: { id: 1, title: 'R', groups_enabled: true },
    mini_projects: [
      {
        id: 1, block_id: 5, block_order: 1, block_title: 'B1', title: 'Mini project for Block 1',
        is_published: true, first_submitted_at: null, soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
        groups: [
          { group_id: 1, group_name: 'G1', group_is_disabled: false, status: 'not_submitted', latest_submission: null, latest_evaluation: null },
          { group_id: 2, group_name: 'G2', group_is_disabled: false, status: 'accepted', latest_submission: null, latest_evaluation: null },
        ],
        counts: { total_groups: 2, not_submitted: 1, awaiting_eval: 0, needs_revision: 0, accepted: 1, rejected: 0 },
      },
      {
        id: 2, block_id: 6, block_order: 2, block_title: 'B2', title: 'Mini project for Block 2',
        is_published: true, first_submitted_at: null, soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
        groups: [
          { group_id: 1, group_name: 'G1', group_is_disabled: false, status: 'needs_revision', latest_submission: null, latest_evaluation: null },
          { group_id: 2, group_name: 'G2', group_is_disabled: false, status: 'awaiting_eval', latest_submission: null, latest_evaluation: null },
        ],
        counts: { total_groups: 2, not_submitted: 0, awaiting_eval: 1, needs_revision: 1, accepted: 0, rejected: 0 },
      },
    ],
    ...overrides,
  };
}

describe('RunSubmissionTab', () => {

  // T1 – Loading state
  it('renders LoadingPlaceholder before fetch resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    mountTab();
    expect(host.querySelector('.loading-placeholder, [role="status"]')).toBeTruthy();
  });

  // T2 – Status grid renders when data loads
  it('renders status grid when data loads', async () => {
    vi.stubGlobal('fetch', mockFetch(200, submissionMock()));
    mountTab();
    await settle();
    const grid = host.querySelector('table.submission-grid');
    expect(grid).toBeTruthy();
    expect(host.textContent).toContain('G1');
    expect(host.textContent).toContain('G2');
    expect(host.textContent).toContain('Mini project for Block 1');
  });

  // T3 – Error state
  it('renders error banner with Retry on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('boom'))));
    mountTab();
    await settle();
    expect(host.querySelector('.banner-error, [role="alert"]')).toBeTruthy();
    expect(host.textContent?.toLowerCase()).toContain('retry');
  });

  // T4 – Empty-MP placeholder
  it('empty-MP placeholder: renders text and no table when mini_projects is empty', async () => {
    const body = submissionMock({ mini_projects: [] });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    expect(host.querySelector('table.submission-grid')).toBeFalsy();
    expect(host.textContent).toContain('No mini-projects in this run.');
  });

  // T5 – groups_enabled: false placeholder
  it('shows placeholder when groups_enabled: false', async () => {
    const body = submissionMock({
      run: { id: 1, title: 'R', groups_enabled: false },
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    expect(host.querySelector('table.submission-grid')).toBeFalsy();
    expect(host.textContent?.toLowerCase()).toContain('groups disabled');
  });

  // T6 – Status badge rendering (all 5 statuses)
  it('status badge rendering: each of 5 statuses appears correctly in the grid', async () => {
    const body = submissionMock({
      mini_projects: [
        {
          id: 1, block_id: 5, block_order: 1, block_title: 'B1', title: 'MP1',
          is_published: true, first_submitted_at: null, soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
          groups: [
            { group_id: 1, group_name: 'G1', group_is_disabled: false, status: 'not_submitted', latest_submission: null, latest_evaluation: null },
            { group_id: 2, group_name: 'G2', group_is_disabled: false, status: 'awaiting_eval', latest_submission: null, latest_evaluation: null },
            { group_id: 3, group_name: 'G3', group_is_disabled: false, status: 'needs_revision', latest_submission: null, latest_evaluation: null },
            { group_id: 4, group_name: 'G4', group_is_disabled: false, status: 'accepted', latest_submission: null, latest_evaluation: null },
            { group_id: 5, group_name: 'G5', group_is_disabled: false, status: 'rejected', latest_submission: null, latest_evaluation: null },
          ],
          counts: { total_groups: 5, not_submitted: 1, awaiting_eval: 1, needs_revision: 1, accepted: 1, rejected: 1 },
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    const badges = host.querySelectorAll('[data-status]');
    const statuses = Array.from(badges).map((b) => b.getAttribute('data-status'));
    expect(statuses).toContain('not_submitted');
    expect(statuses).toContain('awaiting_eval');
    expect(statuses).toContain('needs_revision');
    expect(statuses).toContain('accepted');
    expect(statuses).toContain('rejected');
    // Each badge must also show the label text and icon character (spec §13 line 1666)
    for (const status of ['not_submitted', 'awaiting_eval', 'needs_revision', 'accepted', 'rejected'] as const) {
      const badge = Array.from(badges).find((b) => b.getAttribute('data-status') === status)!;
      expect(badge.textContent).toContain(STATUS_LABEL[status]);
      expect(badge.textContent).toContain(STATUS_ICON[status]);
    }
  });

  // T7 – Sort by group: click toggles direction, aria-sort updates
  it('sort by group: click Group header toggles direction; aria-sort updates', async () => {
    const body = submissionMock({
      mini_projects: [
        {
          id: 1, block_id: 5, block_order: 1, block_title: 'B1', title: 'MP1',
          is_published: true, first_submitted_at: null, soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
          groups: [
            { group_id: 1, group_name: 'ZGroup', group_is_disabled: false, status: 'accepted', latest_submission: null, latest_evaluation: null },
            { group_id: 2, group_name: 'AGroup', group_is_disabled: false, status: 'accepted', latest_submission: null, latest_evaluation: null },
          ],
          counts: { total_groups: 2, not_submitted: 0, awaiting_eval: 0, needs_revision: 0, accepted: 2, rejected: 0 },
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    const groupTh = host.querySelector('tr.mp-titles-row th.sticky-group') as HTMLElement;
    expect(groupTh).toBeTruthy();
    // Default: sortKey='group', sortDir='asc' → aria-sort=ascending
    expect(groupTh.getAttribute('aria-sort')).toBe('ascending');
    // Click group header → toggle to desc
    const groupBtn = groupTh.querySelector('button') as HTMLButtonElement;
    groupBtn.click();
    flushSync();
    expect(groupTh.getAttribute('aria-sort')).toBe('descending');
    // ZGroup should now be first (desc)
    const rows = host.querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('ZGroup');
    // Click again → back to asc
    groupBtn.click();
    flushSync();
    expect(groupTh.getAttribute('aria-sort')).toBe('ascending');
    const rowsAsc = host.querySelectorAll('tbody tr');
    expect(rowsAsc[0].textContent).toContain('AGroup');
  });

  // T8 – Sort by MP column: priority order (needs_revision first asc, accepted first desc)
  it('sort by MP column uses priority order (needs_revision first asc, accepted first desc)', async () => {
    // Use a mock with 3 groups: G1=needs_revision, G2=awaiting_eval, G3=accepted on MP2
    const body = submissionMock({
      mini_projects: [
        {
          id: 1, block_id: 5, block_order: 1, block_title: 'B1', title: 'Mini project for Block 1',
          is_published: true, first_submitted_at: null, soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
          groups: [
            { group_id: 1, group_name: 'G1', group_is_disabled: false, status: 'not_submitted', latest_submission: null, latest_evaluation: null },
            { group_id: 2, group_name: 'G2', group_is_disabled: false, status: 'accepted', latest_submission: null, latest_evaluation: null },
            { group_id: 3, group_name: 'G3', group_is_disabled: false, status: 'not_submitted', latest_submission: null, latest_evaluation: null },
          ],
          counts: { total_groups: 3, not_submitted: 2, awaiting_eval: 0, needs_revision: 0, accepted: 1, rejected: 0 },
        },
        {
          id: 2, block_id: 6, block_order: 2, block_title: 'B2', title: 'Mini project for Block 2',
          is_published: true, first_submitted_at: null, soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
          groups: [
            { group_id: 1, group_name: 'G1', group_is_disabled: false, status: 'needs_revision', latest_submission: null, latest_evaluation: null },
            { group_id: 2, group_name: 'G2', group_is_disabled: false, status: 'awaiting_eval', latest_submission: null, latest_evaluation: null },
            { group_id: 3, group_name: 'G3', group_is_disabled: false, status: 'accepted', latest_submission: null, latest_evaluation: null },
          ],
          counts: { total_groups: 3, not_submitted: 0, awaiting_eval: 1, needs_revision: 1, accepted: 1, rejected: 0 },
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    // Click "Mini project for Block 2" column header to sort asc
    const headerBtn = Array.from(host.querySelectorAll('th button'))
      .find((b) => b.textContent?.includes('Block 2')) as HTMLButtonElement;
    headerBtn.click();
    flushSync();
    const rowsAsc = Array.from(host.querySelectorAll('tbody tr'));
    // G1 has needs_revision on MP2 (priority 0) → should be first in asc
    expect(rowsAsc[0].textContent).toContain('G1');
    // Toggle to desc: accepted(priority 4) is highest → G3 should be first
    headerBtn.click();
    flushSync();
    const rowsDesc = Array.from(host.querySelectorAll('tbody tr'));
    // G3 has accepted on MP2 (priority 4) → highest in desc
    expect(rowsDesc[0].textContent).toContain('G3');
  });

  // T9 – Filter by group dropdown narrows rows
  it('filter by group dropdown narrows visible rows', async () => {
    vi.stubGlobal('fetch', mockFetch(200, submissionMock()));
    mountTab();
    await settle();
    const select = host.querySelector('select') as HTMLSelectElement;
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    flushSync();
    // Check tbody rows — G1 row visible, G2 row absent
    const tbodyRows = host.querySelectorAll('tbody tr');
    expect(tbodyRows.length).toBe(1);
    expect(tbodyRows[0].textContent).toContain('G1');
    expect(Array.from(tbodyRows).some((r) => r.textContent?.includes('G2'))).toBe(false);
  });

  // T10 – Per-MP counts row
  it('per-MP counts row renders formatCountsLine output (skip-zero rule)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, submissionMock()));
    mountTab();
    await settle();
    // MP2 counts: { total_groups: 2, awaiting_eval: 1, needs_revision: 1, rejected: 0 }
    // Expected: "2 groups · 1 awaiting · 1 revision" (rejected skipped as 0)
    expect(host.textContent).toMatch(/2 groups.*1 awaiting.*1 revision/);
    // rejected=0 should not appear in that line (no "0 rejected")
    expect(host.textContent).not.toContain('0 rejected');
  });

  // T11 – Cell click: opens DashboardSidePanel (submission variant)
  it('cell click: opens DashboardSidePanel (role=dialog) with submission target', async () => {
    vi.stubGlobal('fetch', mockFetch(200, submissionMock()));
    mountTab();
    await settle();
    const cellBtn = host.querySelector('.status-cell-btn') as HTMLButtonElement;
    expect(cellBtn).toBeTruthy();
    cellBtn.click();
    flushSync();
    // Real panel mounted for submission variant (no fetch needed — data in props)
    const panel = host.querySelector('[role="dialog"]');
    expect(panel).toBeTruthy();
    expect(panel!.getAttribute('aria-label')).toBe('Submission details');
    // mp.title and group_name from submissionMock should appear in the panel
    expect(panel!.textContent).toContain('Mini project for Block 1');
    expect(panel!.textContent).toContain('G1');
  });

  // T12 – Disabled group rendering
  it('disabled group: row has disabled-row class and badge-muted "disabled" label', async () => {
    const body = submissionMock({
      mini_projects: [
        {
          id: 1, block_id: 5, block_order: 1, block_title: 'B1', title: 'MP1',
          is_published: true, first_submitted_at: null, soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
          groups: [
            { group_id: 1, group_name: 'DisabledGroup', group_is_disabled: true, status: 'not_submitted', latest_submission: null, latest_evaluation: null },
          ],
          counts: { total_groups: 1, not_submitted: 1, awaiting_eval: 0, needs_revision: 0, accepted: 0, rejected: 0 },
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    const row = host.querySelector('tr.disabled-row');
    expect(row).toBeTruthy();
    expect(host.querySelector('.badge-muted')).toBeTruthy();
    expect(host.querySelector('.badge-muted')!.textContent?.trim()).toBe('disabled');
  });

  // T13 – Refresh button triggers refetch
  it('refresh button: click triggers refetch', async () => {
    const fetchMock = mockFetch(200, submissionMock());
    vi.stubGlobal('fetch', fetchMock);
    mountTab();
    await settle();
    const callCount = fetchMock.mock.calls.length;
    const refreshBtn = host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement;
    refreshBtn.click();
    await settle();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callCount);
  });

  // T14 – Group-filter derives options from mini_projects[i].groups[]
  it('group-filter dropdown derives options from data.mini_projects[i].groups[]', async () => {
    vi.stubGlobal('fetch', mockFetch(200, submissionMock()));
    mountTab();
    await settle();
    const select = host.querySelector('select') as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toContain('all');
    expect(opts).toContain('1');
    expect(opts).toContain('2');
    expect(opts).not.toContain('ungrouped');
    // Options appear in group_id ascending order (1, 2)
    const numOpts = opts.filter((o) => o !== 'all');
    expect(numOpts[0]).toBe('1');
    expect(numOpts[1]).toBe('2');
  });

  // T15 – Stale-while-revalidate
  it('stale-while-revalidate: table stays visible during Refresh (data not reset)', async () => {
    let resolveRefresh!: (v: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(submissionMock()), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((r) => { resolveRefresh = r; }));
    vi.stubGlobal('fetch', fetchMock);
    mountTab();
    await settle();
    // Table is populated
    expect(host.querySelector('table.submission-grid')).toBeTruthy();
    expect(host.textContent).toContain('G1');
    // Click Refresh — keeps fetch in-flight
    const refreshBtn = host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement;
    refreshBtn.click();
    flushSync();
    // LoadingPlaceholder shows
    expect(host.querySelector('.loading-placeholder, [role="status"]')).toBeTruthy();
    // Table rows still visible (stale data not cleared)
    expect(host.textContent).toContain('G1');
    // Cleanup
    resolveRefresh(new Response(JSON.stringify(submissionMock()), { status: 200 }));
    await settle();
  });

  // T16 – Retry-after-error
  it('retry-after-error: error banner → Retry → error clears + loading flips on → grid populates', async () => {
    // Deferred resolver so we can assert intermediate state
    let resolveRetry!: (v: Response) => void;
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockImplementationOnce(() => new Promise<Response>((r) => { resolveRetry = r; }));
    vi.stubGlobal('fetch', fetchMock);
    mountTab();
    await settle();
    expect(host.querySelector('.banner-error, [role="alert"]')).toBeTruthy();
    // Click Retry — second fetch is deferred (not yet resolved)
    const retryBtn = Array.from(host.querySelectorAll('button')).find((b) => /retry/i.test(b.textContent ?? ''));
    retryBtn!.click();
    flushSync();
    // INTERMEDIATE STATE: error cleared, loading is showing (spec §13 line 1676)
    expect(host.querySelector('.banner-error, [role="alert"]')).toBeFalsy();
    expect(host.querySelector('.loading-placeholder, [aria-busy="true"]')).toBeTruthy();
    // Resolve the retry fetch with success data
    resolveRetry(new Response(JSON.stringify(submissionMock()), { status: 200 }));
    await settle();
    // Error banner gone, grid populated
    expect(host.querySelector('.banner-error, [role="alert"]')).toBeFalsy();
    expect(host.querySelector('table.submission-grid')).toBeTruthy();
  });

  // T17 – CSV download: long format, 15 columns, RFC 4180 quoting
  it('CSV download: long format with all 15 columns, one row per (group, MP); filename sanitized', async () => {
    const body = submissionMock({
      run: { id: 1, title: 'My Run/Test', groups_enabled: true },
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    vi.mocked(downloadCSV).mockClear();
    mountTab();
    await settle();
    const csvBtn = host.querySelector('[data-action="download-csv"]') as HTMLButtonElement;
    csvBtn.click();
    flushSync();
    expect(vi.mocked(downloadCSV)).toHaveBeenCalledTimes(1);
    const [csvText, filename] = vi.mocked(downloadCSV).mock.calls[0] as [string, string];
    // Filename uses sanitized title
    expect(filename).toMatch(/^submissions-My_Run_Test-\d{4}-\d{2}-\d{2}\.csv$/);
    // Check header has all 15 columns
    const lines = csvText.replace(/^﻿/, '').split('\r\n');
    const headers = lines[0].split(',');
    expect(headers).toContain('group_name');
    expect(headers).toContain('mp_title');
    expect(headers).toContain('mp_block_title');
    expect(headers).toContain('status');
    expect(headers).toContain('latest_submission_number');
    expect(headers).toContain('latest_submission_at');
    expect(headers).toContain('latest_submission_by');
    expect(headers).toContain('is_late');
    expect(headers).toContain('is_resubmission');
    expect(headers).toContain('file_size');
    expect(headers).toContain('latest_evaluation_at');
    expect(headers).toContain('latest_evaluation_by');
    expect(headers).toContain('evaluation_result');
    expect(headers).toContain('evaluation_score');
    expect(headers).toContain('has_feedback_file');
    expect(headers.length).toBe(15);
    // 2 groups × 2 MPs = 4 data rows
    expect(lines.filter((l) => l.length > 0).length).toBe(5); // header + 4 rows
  });

  // T17b – RFC 4180 quoting for embedded comma in group_name
  it('CSV download: RFC 4180 quoting applied when group_name contains a comma', async () => {
    const body = submissionMock({
      mini_projects: [
        {
          id: 1, block_id: 5, block_order: 1, block_title: 'B1', title: 'MP1',
          is_published: true, first_submitted_at: null, soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
          groups: [
            { group_id: 1, group_name: 'Smith, John', group_is_disabled: false, status: 'accepted', latest_submission: null, latest_evaluation: null },
          ],
          counts: { total_groups: 1, not_submitted: 0, awaiting_eval: 0, needs_revision: 0, accepted: 1, rejected: 0 },
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    vi.mocked(downloadCSV).mockClear();
    mountTab();
    await settle();
    const csvBtn = host.querySelector('[data-action="download-csv"]') as HTMLButtonElement;
    csvBtn.click();
    flushSync();
    expect(vi.mocked(downloadCSV)).toHaveBeenCalledTimes(1);
    const [csvText] = vi.mocked(downloadCSV).mock.calls[0] as [string, string];
    // group_name "Smith, John" should be RFC 4180 quoted in CSV
    expect(csvText).toContain('"Smith, John"');
  });

  // T17c – CSV populated values: booleans as literal true/false + raw enum for evaluation_result
  it('CSV download: populated row has literal boolean strings and raw evaluation_result enum', async () => {
    const body = submissionMock({
      mini_projects: [
        {
          id: 1, block_id: 5, block_order: 1, block_title: 'B1', title: 'MP1',
          is_published: true, first_submitted_at: null, soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
          groups: [
            {
              group_id: 1, group_name: 'G1', group_is_disabled: false, status: 'needs_revision',
              latest_submission: {
                submission_number: 2,
                submitted_at: '2026-01-10T12:00:00Z',
                submitted_by: { full_name: 'Alice' },
                is_late: true,
                is_resubmission: false,
                file_size: 12345,
              },
              latest_evaluation: {
                evaluated_at: '2026-01-11T10:00:00Z',
                evaluated_by: { full_name: 'Prof B' },
                result: 'major_revision',
                score: 85,
                has_feedback_file: true,
              },
            },
          ],
          counts: { total_groups: 1, not_submitted: 0, awaiting_eval: 0, needs_revision: 1, accepted: 0, rejected: 0 },
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    vi.mocked(downloadCSV).mockClear();
    mountTab();
    await settle();
    const csvBtn = host.querySelector('[data-action="download-csv"]') as HTMLButtonElement;
    csvBtn.click();
    flushSync();
    expect(vi.mocked(downloadCSV)).toHaveBeenCalledTimes(1);
    const [csvText] = vi.mocked(downloadCSV).mock.calls[0] as [string, string];
    const lines = csvText.replace(/^﻿/, '').split('\r\n').filter((l) => l.length > 0);
    // There is 1 data row (1 group × 1 MP)
    expect(lines.length).toBe(2); // header + 1 row
    const headers = lines[0].split(',');
    const values = lines[1].split(',');
    // is_late should be literal 'true' (not empty, not 1, not "Yes")
    const isLateIdx = headers.indexOf('is_late');
    expect(values[isLateIdx]).toBe('true');
    // is_resubmission should be literal 'false'
    const isResubIdx = headers.indexOf('is_resubmission');
    expect(values[isResubIdx]).toBe('false');
    // has_feedback_file should be literal 'true'
    const hasFbIdx = headers.indexOf('has_feedback_file');
    expect(values[hasFbIdx]).toBe('true');
    // evaluation_result should be raw enum value, NOT human label (spec lines 1271)
    const evalResIdx = headers.indexOf('evaluation_result');
    expect(values[evalResIdx]).toBe('major_revision');
    // Sanity: human label 'Major revision' must NOT appear in that cell
    expect(values[evalResIdx]).not.toBe('Major revision');
  });

  // T18 – AbortController on rapid runId change
  it('rapid runId change cancels in-flight fetch (signal.aborted)', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => { /* never resolves */ }));
    vi.stubGlobal('fetch', fetchMock);
    const box = $state({ runId: 1 });
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(RunSubmissionTab, { target: host, props: box });
    flushSync();
    // Capture signal from first call
    const firstCallInit = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    const signal = firstCallInit.signal;
    expect(signal?.aborted).toBe(false);
    // Change runId — triggers new $effect, should abort previous
    box.runId = 2;
    flushSync();
    expect(signal?.aborted).toBe(true);
  });

  // T18b – AbortController on Refresh-triggered refetch aborts the previous in-flight fetch
  it('AbortController on Refresh-triggered refetch aborts the previous in-flight fetch', async () => {
    // Load initial data, then set up a slow second fetch so we can abort it via a second Refresh
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(submissionMock()), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>(() => { /* never resolves — in-flight */ }));
    vi.stubGlobal('fetch', fetchMock);
    mountTab();
    await settle();
    // Click Refresh once — starts in-flight slow fetch (call index 1)
    const refreshBtn = host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement;
    refreshBtn.click();
    flushSync();
    // Capture signal from the in-flight refresh fetch
    const inFlightInit = (fetchMock.mock.calls[1] as unknown[])[1] as RequestInit;
    const inFlightSignal = inFlightInit.signal;
    expect(inFlightSignal?.aborted).toBe(false);
    // Click Refresh again — should abort the previous in-flight fetch
    refreshBtn.click();
    flushSync();
    // The first Refresh's signal should now be aborted (spec §13 line 1678)
    expect(inFlightSignal?.aborted).toBe(true);
  });

  // T19 – RunId change resets local state (no nameQuery; sortKey/sortDir preserved)
  it('runId change resets groupFilter, panelOpen, panelTarget (NOT sortKey/sortDir)', async () => {
    // Both runs share MP id=2 so we can assert aria-sort persistence after the swap
    const fetchMock = mockFetch(200, submissionMock());
    vi.stubGlobal('fetch', fetchMock);
    const box = $state({ runId: 1 });
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(RunSubmissionTab, { target: host, props: box });
    flushSync();
    await settle();
    // Click the MP id=2 column header to set sortKey='mp:2', sortDir='asc'
    const mpBtn = Array.from(host.querySelectorAll('th button'))
      .find((b) => b.textContent?.includes('Block 2')) as HTMLButtonElement;
    mpBtn.click();
    flushSync();
    // BEFORE runId change: verify aria-sort='ascending' on the MP2 header (spec line 1082)
    const mpTh = mpBtn.closest('th') as HTMLElement;
    expect(mpTh.getAttribute('aria-sort')).toBe('ascending');
    // Set groupFilter
    const select = host.querySelector('select') as HTMLSelectElement;
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    flushSync();
    // Open side panel
    const cellBtn = host.querySelector('.status-cell-btn') as HTMLButtonElement;
    cellBtn.click();
    flushSync();
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    // Change runId — new run also contains MP id=2 (same id), so aria-sort should persist
    const fetchMock2 = mockFetch(200, submissionMock({ run: { id: 2, title: 'R2', groups_enabled: true } }));
    vi.stubGlobal('fetch', fetchMock2);
    box.runId = 2;
    flushSync();
    await settle();
    // Panel closed, groupFilter reset
    expect(host.querySelector('[role="dialog"]')).toBeFalsy();
    // groupFilter reset to 'all' → both groups visible
    expect(host.textContent).toContain('G1');
    expect(host.textContent).toContain('G2');
    // sortKey/sortDir NOT reset: MP2 header still has aria-sort='ascending' (spec line 1082)
    const mpTh2 = Array.from(host.querySelectorAll('th.mp-title-header'))
      .find((th) => th.querySelector('button')?.textContent?.includes('Block 2')) as HTMLElement;
    expect(mpTh2.getAttribute('aria-sort')).toBe('ascending');
  });

  // T19b – Stale mp:<id> sortKey on runId change is a no-op until user re-clicks
  it('stale mp:<id> sortKey is a no-op (rows in group_id asc order) when MP absent from new run', async () => {
    // Run 1: has MP id=1
    const run1Body = submissionMock({
      mini_projects: [
        {
          id: 1, block_id: 5, block_order: 1, block_title: 'B1', title: 'MP1',
          is_published: true, first_submitted_at: null, soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
          groups: [
            { group_id: 1, group_name: 'G1', group_is_disabled: false, status: 'needs_revision', latest_submission: null, latest_evaluation: null },
            { group_id: 2, group_name: 'G2', group_is_disabled: false, status: 'awaiting_eval', latest_submission: null, latest_evaluation: null },
            { group_id: 3, group_name: 'G3', group_is_disabled: false, status: 'accepted', latest_submission: null, latest_evaluation: null },
          ],
          counts: { total_groups: 3, not_submitted: 0, awaiting_eval: 1, needs_revision: 1, accepted: 1, rejected: 0 },
        },
      ],
    });
    // Run 2: only has MP id=99 (NOT id=1 — so mp:1 is stale)
    // Group names are intentionally NOT in group_id-asc alphabetical order:
    //   id=1 → 'A', id=2 → 'C', id=3 → 'B'
    // So group_id-asc order produces A, C, B; group_name-asc order would produce A, B, C.
    // This makes the test distinguish the fixed behavior (return 0 → stable group_id order → A, C, B)
    // from the original bug (tiebreakByGroupName → A, B, C).
    const run2Body = {
      run: { id: 2, title: 'R2', groups_enabled: true },
      mini_projects: [
        {
          id: 99, block_id: 9, block_order: 1, block_title: 'B99', title: 'MP99',
          is_published: true, first_submitted_at: null, soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
          groups: [
            { group_id: 1, group_name: 'A', group_is_disabled: false, status: 'accepted', latest_submission: null, latest_evaluation: null },
            { group_id: 2, group_name: 'C', group_is_disabled: false, status: 'needs_revision', latest_submission: null, latest_evaluation: null },
            { group_id: 3, group_name: 'B', group_is_disabled: false, status: 'awaiting_eval', latest_submission: null, latest_evaluation: null },
          ],
          counts: { total_groups: 3, not_submitted: 0, awaiting_eval: 1, needs_revision: 1, accepted: 1, rejected: 0 },
        },
      ],
    };
    const fetchMock1 = mockFetch(200, run1Body);
    vi.stubGlobal('fetch', fetchMock1);
    const box = $state({ runId: 1 });
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(RunSubmissionTab, { target: host, props: box });
    flushSync();
    await settle();
    // Click MP id=1 header to sort by it (asc)
    const mpBtn = Array.from(host.querySelectorAll('th button'))
      .find((b) => b.textContent?.includes('MP1')) as HTMLButtonElement;
    mpBtn.click();
    flushSync();
    // Swap to run 2 (MP id=1 no longer exists — stale sortKey)
    vi.stubGlobal('fetch', mockFetch(200, run2Body));
    box.runId = 2;
    flushSync();
    await settle();
    // With stale mp:1, compareGroups returns 0 for all pairs → rows stay in uniqueGroups order
    // uniqueGroups is sorted by group_id asc → id=1('A'), id=2('C'), id=3('B') → visible: A, C, B
    // Under the original bug (tiebreakByGroupName), visible order would be A, B, C — caught by assertion below.
    const rows = Array.from(host.querySelectorAll('tbody tr'));
    expect(rows[0].textContent).toContain('A');
    expect(rows[1].textContent).toContain('C');
    expect(rows[2].textContent).toContain('B');
    // The MP99 header must NOT have aria-sort set to the old stale state
    const mp99Th = Array.from(host.querySelectorAll('th.mp-title-header'))
      .find((th) => th.querySelector('button')?.textContent?.includes('MP99')) as HTMLElement;
    expect(mp99Th.getAttribute('aria-sort')).toBe('none');
  });

  // TS1 – panelTarget updates after refresh()
  it('TS1: selectedIds-derived panelTarget updates after refresh()', async () => {
    const v1 = submissionMock({
      mini_projects: [
        {
          id: 1, block_id: 5, block_order: 1, block_title: 'B1', title: 'MP1',
          is_published: true, first_submitted_at: null, soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
          groups: [
            {
              group_id: 1, group_name: 'G1', group_is_disabled: false, status: 'awaiting_eval',
              latest_submission: { id: 50, submission_number: 1, submitted_at: '2026-06-01T10:00:00Z', submitted_by: { user_id: 5, full_name: 'Alice' }, is_late: false, is_resubmission: false, file_size: 1024 },
              latest_evaluation: null,
            },
          ],
          counts: { total_groups: 1, not_submitted: 0, awaiting_eval: 1, needs_revision: 0, accepted: 0, rejected: 0 },
        },
      ],
    });
    const v2 = submissionMock({
      mini_projects: [
        {
          id: 1, block_id: 5, block_order: 1, block_title: 'B1', title: 'MP1',
          is_published: true, first_submitted_at: null, soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
          groups: [
            {
              group_id: 1, group_name: 'G1', group_is_disabled: false, status: 'accepted',
              latest_submission: { id: 50, submission_number: 1, submitted_at: '2026-06-01T10:00:00Z', submitted_by: { user_id: 5, full_name: 'Alice' }, is_late: false, is_resubmission: false, file_size: 1024 },
              latest_evaluation: {
                id: 42, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' },
                result: 'accepted', score: 90, feedback_text: 'Good', has_feedback_file: true,
              },
            },
          ],
          counts: { total_groups: 1, not_submitted: 0, awaiting_eval: 0, needs_revision: 0, accepted: 1, rejected: 0 },
        },
      ],
    });
    // submissionMock's return type is dominated by its default (latest_submission: null),
    // so the static type here is `null` even though the runtime value is the override's real
    // submission object; cast to read the runtime shape without changing behaviour.
    const g1v1 = v1.mini_projects[0].groups[0] as unknown as { latest_submission: Record<string, unknown>; latest_evaluation: unknown };
    const g1v2 = v2.mini_projects[0].groups[0] as unknown as { latest_submission: Record<string, unknown>; latest_evaluation: unknown };
    const openThread = { submissions: [{ ...g1v1.latest_submission, evaluation: null }] };
    const refreshedThread = { submissions: [{ ...g1v2.latest_submission, evaluation: g1v2.latest_evaluation }] };
    vi.stubGlobal('fetch', routedTabFetch([v1, v2], [openThread, refreshedThread]));
    mountTab(1);
    await settle();
    const cellBtn = host.querySelector('.status-cell-btn') as HTMLButtonElement;
    cellBtn.click();
    flushSync();
    let panel = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.textContent).not.toContain('90');
    const refreshBtn = host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement;
    refreshBtn.click();
    await settle();
    await settle(); // dashboard resolve → effect refire → thread GET#2 resolve → render
    panel = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('90');
    expect(panel.textContent).toContain('Good');
  });

  // TS2 – row-gone after refresh auto-closes the panel
  it('TS2: row-gone after refresh auto-closes the panel', async () => {
    const v1 = submissionMock();
    const v2 = submissionMock({ mini_projects: [] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(v1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(v2), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    mountTab(1);
    await settle();
    const cellBtn = host.querySelector('.status-cell-btn') as HTMLButtonElement;
    cellBtn.click();
    flushSync();
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    const refreshBtn = host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement;
    refreshBtn.click();
    await settle();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  // TS3 – runId change resets selectedIds
  it('TS3: runId change resets selectedIds (panel closes)', async () => {
    const fetchMock = mockFetch(200, submissionMock());
    vi.stubGlobal('fetch', fetchMock);
    const box = $state({ runId: 1 });
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(RunSubmissionTab, { target: host, props: box });
    flushSync();
    await settle();
    const cellBtn = host.querySelector('.status-cell-btn') as HTMLButtonElement;
    cellBtn.click();
    flushSync();
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    vi.stubGlobal('fetch', mockFetch(200, submissionMock({ run: { id: 2, title: 'R2', groups_enabled: true } })));
    box.runId = 2;
    flushSync();
    await settle();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  // T20 – Unmount after refresh() aborts the refresh-created controller
  it('unmount after refresh() aborts the refresh-created controller', async () => {
    let resolveRefresh!: (v: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(submissionMock()), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((r) => { resolveRefresh = r; }));
    vi.stubGlobal('fetch', fetchMock);
    mountTab();
    await settle();
    // Click Refresh — starts in-flight fetch
    const refreshBtn = host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement;
    refreshBtn.click();
    flushSync();
    // Capture signal from second fetch call (the refresh)
    const refreshCallInit = (fetchMock.mock.calls[1] as unknown[])[1] as RequestInit;
    const refreshSignal = refreshCallInit.signal;
    expect(refreshSignal?.aborted).toBe(false);
    // Unmount — should trigger unmount-only $effect cleanup
    unmount(component!);
    component = null;
    expect(refreshSignal?.aborted).toBe(true);
    // Cleanup
    resolveRefresh(new Response(JSON.stringify(submissionMock()), { status: 200 }));
  });

});
