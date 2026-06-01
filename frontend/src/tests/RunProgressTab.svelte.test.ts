import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';

import RunProgressTab from '../components/runs/RunProgressTab.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function mockFetch(status: number, body: unknown) {
  return vi.fn(() => Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  ));
}

function mountTab(runId = 1, extraProps: Record<string, unknown> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(RunProgressTab, { target: host, props: { runId, ...extraProps } });
  flushSync();
  return host;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

function progressMock(overrides: Record<string, unknown> = {}) {
  return {
    run: { id: 1, title: 'R', groups_enabled: true, version_is_disabled: false },
    sequences: [
      { sequence_id: 10, sequence_title: 'S1', sequence_order: 1, block_id: 5, block_title: 'B1',
        total_items: 4, has_quiz_items: true },
    ],
    students: [
      { user_id: 100, full_name: 'Alice', email: 'a@x', user_is_disabled: false,
        group_id: 1, group_name: 'G1', group_is_disabled: false,
        coverage: [{ sequence_id: 10, covered: 2, total: 4 }],
        quizzes: [{ sequence_id: 10, correct: 1, total: 2 }] },
      { user_id: 101, full_name: 'Bob', email: 'b@x', user_is_disabled: false,
        group_id: null, group_name: null, group_is_disabled: false,
        coverage: [{ sequence_id: 10, covered: 4, total: 4 }],
        quizzes: [{ sequence_id: 10, correct: 2, total: 2 }] },
    ],
    ...overrides,
  };
}

async function settle() {
  await tick(); await tick(); await tick();
  flushSync();
}

describe('RunProgressTab', () => {
  // T1 – Loading state
  it('renders LoadingPlaceholder before fetch resolves', () => {
    let resolve!: (v: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolve = r; })));
    mountTab();
    expect(host.querySelector('[role="status"], .loading-placeholder')).toBeTruthy();
    resolve(new Response(JSON.stringify(progressMock()), { status: 200 }));
  });

  // T2 – Error state
  it('renders error banner with Retry on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('boom'))));
    mountTab();
    await settle();
    expect(host.querySelector('.banner-error, [role="alert"]')).toBeTruthy();
    expect(host.textContent?.toLowerCase()).toContain('retry');
  });

  // T3 – Empty students
  it('empty-students state renders placeholder text', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock({ students: [] })));
    mountTab();
    await settle();
    expect(host.textContent).toContain('No students enrolled in this run.');
  });

  // T4 – Empty sequences
  it('empty-sequences state renders placeholder text', async () => {
    const body = progressMock({
      sequences: [],
      students: [
        { user_id: 100, full_name: 'Alice', email: 'a@x', user_is_disabled: false,
          group_id: 1, group_name: 'G1', group_is_disabled: false,
          coverage: [], quizzes: [] },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    // Per spec §13 line 1635: placeholder renders; table is NOT rendered
    expect(host.textContent).toContain('No sequences in this run.');
    expect(host.querySelector('table.progress-grid')).toBeNull();
  });

  // T5 – Coverage mode cells
  it('coverage mode: cells render {covered}/{total} text', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    const cells = host.querySelectorAll('td.cell');
    expect(cells.length).toBeGreaterThan(0);
    expect(host.textContent).toContain('2/4');
    expect(host.textContent).toContain('4/4');
    // Per spec §13 line 1636: inline --cell-bg style set per ratio
    const cellWithStyle = host.querySelector('td.cell') as HTMLElement;
    expect(cellWithStyle.getAttribute('style')).toMatch(/--cell-bg:\s*hsl\(/);
  });

  // T6 – Quiz mode cells
  it('quiz mode: cells render {correct}/{total}; null quiz cells render —', async () => {
    const body = progressMock({
      students: [
        { user_id: 100, full_name: 'Alice', email: 'a@x', user_is_disabled: false,
          group_id: 1, group_name: 'G1', group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 2, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: 1, total: 2 }] },
        { user_id: 101, full_name: 'Bob', email: 'b@x', user_is_disabled: false,
          group_id: null, group_name: null, group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 0, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: null, total: null }] },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    // Switch to quiz mode
    const quizBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Quiz');
    quizBtn!.click();
    flushSync();
    expect(host.textContent).toContain('1/2');
    expect(host.textContent).toContain('—');
  });

  // T7 – Mode toggle
  it('mode toggle: switching mode updates rendered cells', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    // Default: coverage mode shows 2/4
    expect(host.textContent).toContain('2/4');
    // Switch to quiz
    const quizBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Quiz');
    quizBtn!.click();
    flushSync();
    // Now shows quiz data: Alice 1/2, Bob 2/2
    expect(host.textContent).toContain('1/2');
    expect(host.textContent).toContain('2/2');
    expect(host.textContent).not.toContain('2/4');
  });

  // T8 – Filter by group
  it('filter by group dropdown narrows visible rows', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    const select = host.querySelector('select[aria-label="Filter by group"]') as HTMLSelectElement;
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    flushSync();
    expect(host.textContent).toContain('Alice');
    expect(host.textContent).not.toContain('Bob');
  });

  // T9 – Filter by ungrouped
  it('filter by "ungrouped": only group_id:null students visible', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    const select = host.querySelector('select[aria-label="Filter by group"]') as HTMLSelectElement;
    select.value = 'ungrouped';
    select.dispatchEvent(new Event('change'));
    flushSync();
    expect(host.textContent).toContain('Bob');
    expect(host.textContent).not.toContain('Alice');
  });

  // T10 – Search by name
  it('search by name: input narrows rows (matches full_name AND email)', async () => {
    const body = progressMock({
      students: [
        { user_id: 100, full_name: 'Alice Smith', email: 'alice@example.com',
          user_is_disabled: false, group_id: 1, group_name: 'G1', group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 2, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: 1, total: 2 }] },
        { user_id: 101, full_name: null, email: 'bob.jones@example.com',
          user_is_disabled: false, group_id: null, group_name: null, group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 4, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: 2, total: 2 }] },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    const input = host.querySelector('input[aria-label="Search student"]') as HTMLInputElement;
    // Search by name substring
    input.value = 'alice';
    input.dispatchEvent(new Event('input'));
    flushSync();
    expect(host.textContent).toContain('Alice Smith');
    expect(host.textContent).not.toContain('bob.jones');
    // Search by email substring
    input.value = 'jones';
    input.dispatchEvent(new Event('input'));
    flushSync();
    expect(host.textContent).toContain('bob.jones');
    expect(host.textContent).not.toContain('Alice Smith');
  });

  // T11 – Sort by name
  it('sort by name: click Student header toggles direction; aria-sort updates', async () => {
    const body = progressMock({
      students: [
        { user_id: 100, full_name: 'Zed', email: 'z@x', user_is_disabled: false,
          group_id: 1, group_name: 'G1', group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 2, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: 1, total: 2 }] },
        { user_id: 101, full_name: 'Anna', email: 'a@x', user_is_disabled: false,
          group_id: 1, group_name: 'G1', group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 4, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: 2, total: 2 }] },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    // Default asc: Anna first
    const rows = host.querySelectorAll('tbody tr:not(.empty-row)');
    expect(rows[0].textContent).toContain('Anna');
    // Default sort is 'name' asc — Student header aria-sort should be 'ascending'
    const studentHeader = host.querySelector('th.sticky-name') as HTMLElement;
    expect(studentHeader.getAttribute('aria-sort')).toBe('ascending');
    // Click Student header to toggle to desc
    const studentBtn = Array.from(host.querySelectorAll('thead button')).find((b) => b.textContent?.includes('Student')) as HTMLElement | undefined;
    studentBtn!.click();
    flushSync();
    const rowsDesc = host.querySelectorAll('tbody tr:not(.empty-row)');
    expect(rowsDesc[0].textContent).toContain('Zed');
    // After toggle aria-sort should be 'descending'
    expect(studentHeader.getAttribute('aria-sort')).toBe('descending');
  });

  // T12 – Sort by group
  it('sort by group: click Group header toggles direction', async () => {
    const body = progressMock({
      students: [
        { user_id: 100, full_name: 'Alice', email: 'a@x', user_is_disabled: false,
          group_id: 2, group_name: 'ZGroup', group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 2, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: 1, total: 2 }] },
        { user_id: 101, full_name: 'Bob', email: 'b@x', user_is_disabled: false,
          group_id: 1, group_name: 'AGroup', group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 4, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: 2, total: 2 }] },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    // Click Group header (sorts asc by group name)
    const groupBtn = Array.from(host.querySelectorAll('thead button')).find((b) => b.textContent?.includes('Group')) as HTMLElement | undefined;
    groupBtn!.click();
    flushSync();
    const rows = host.querySelectorAll('tbody tr');
    // AGroup first (Bob)
    expect(rows[0].textContent).toContain('Bob');
    // After first click to 'group' key → aria-sort should be 'ascending'
    const groupHeader = host.querySelector('th.sticky-group') as HTMLElement;
    expect(groupHeader.getAttribute('aria-sort')).toBe('ascending');
    // Toggle to desc
    groupBtn!.click();
    flushSync();
    const rowsDesc = host.querySelectorAll('tbody tr');
    expect(rowsDesc[0].textContent).toContain('Alice');
    // After second click → aria-sort should be 'descending'
    expect(groupHeader.getAttribute('aria-sort')).toBe('descending');
  });

  // T13 – Sort by sequence column
  it('sort by sequence column: rows reorder; null cells sink to bottom regardless of direction', async () => {
    const body = progressMock({
      students: [
        { user_id: 100, full_name: 'Alice', email: 'a@x', user_is_disabled: false,
          group_id: 1, group_name: 'G1', group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 1, total: 4 }],  // ratio: 0.25
          quizzes: [{ sequence_id: 10, correct: 1, total: 4 }] },
        { user_id: 101, full_name: 'Bob', email: 'b@x', user_is_disabled: false,
          group_id: null, group_name: null, group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 4, total: 4 }],  // ratio: 1.0
          quizzes: [{ sequence_id: 10, correct: 4, total: 4 }] },
        { user_id: 102, full_name: 'Carol', email: 'c@x', user_is_disabled: false,
          group_id: null, group_name: null, group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 0, total: 0 }],  // null ratio → sinks
          quizzes: [{ sequence_id: 10, correct: null, total: null }] },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    // Click seq header S1
    const seqBtn = Array.from(host.querySelectorAll('thead button')).find((b) => b.textContent?.includes('S1')) as HTMLElement | undefined;
    seqBtn!.click();
    flushSync();
    const rowsAsc = host.querySelectorAll('tbody tr:not(:has(.empty))');
    // Asc: Alice (0.25), Bob (1.0), Carol (null → sink)
    expect(rowsAsc[0].textContent).toContain('Alice');
    expect(rowsAsc[1].textContent).toContain('Bob');
    expect(rowsAsc[2].textContent).toContain('Carol');
    // Toggle to desc
    seqBtn!.click();
    flushSync();
    const rowsDesc = host.querySelectorAll('tbody tr:not(:has(.empty))');
    // Desc: Bob (1.0), Alice (0.25), Carol (null → still sink)
    expect(rowsDesc[0].textContent).toContain('Bob');
    expect(rowsDesc[1].textContent).toContain('Alice');
    expect(rowsDesc[2].textContent).toContain('Carol');
  });

  // T14 – Sort persistence across mode toggle
  it('sort persistence across mode toggle: sort key preserved; values update', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    // Click seq header
    const seqBtn = Array.from(host.querySelectorAll('thead button')).find((b) => b.textContent?.includes('S1')) as HTMLElement | undefined;
    seqBtn!.click();
    flushSync();
    // Confirm aria-sort is set on seq header
    const seqTh = host.querySelector('th[aria-sort="ascending"]');
    expect(seqTh).toBeTruthy();
    // Switch to quiz mode
    const quizBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Quiz');
    quizBtn!.click();
    flushSync();
    // aria-sort should still be set on the same sequence column
    const seqThAfter = host.querySelector('th[aria-sort="ascending"]');
    expect(seqThAfter).toBeTruthy();
    // Values should show quiz data now
    expect(host.textContent).toContain('1/2');
  });

  // T15 – Cell click opens side panel
  it('cell click: opens side panel placeholder with correct target shape', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    const cellBtn = host.querySelector('.cell-btn') as HTMLButtonElement;
    expect(cellBtn).toBeTruthy();
    cellBtn.click();
    flushSync();
    const panel = host.querySelector('.panel-placeholder');
    expect(panel).toBeTruthy();
    expect(panel!.getAttribute('data-panel-kind')).toBe('progress');
    const parsed = JSON.parse(panel!.getAttribute('data-panel-target')!);
    expect(parsed.kind).toBe('progress');
    expect(parsed.runId).toBe(1);
    expect(typeof parsed.user_id).toBe('number');
    expect(typeof parsed.sequence_id).toBe('number');
  });

  // T16 – Disabled user
  it('disabled user: row has "disabled" badge; row has disabled-row class', async () => {
    const body = progressMock({
      students: [
        { user_id: 100, full_name: 'Alice', email: 'a@x', user_is_disabled: true,
          group_id: 1, group_name: 'G1', group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 2, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: 1, total: 2 }] },
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

  // T17 – Disabled version
  it('disabled version: warning banner renders at top', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock({ run: { id: 1, title: 'R', groups_enabled: true, version_is_disabled: true } })));
    mountTab();
    await settle();
    const banner = host.querySelector('.banner-warning, [role="status"]');
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain('disabled');
  });

  // T18 – Sticky CSS classes
  it('sticky first column CSS classes applied', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    expect(host.querySelector('.sticky-name')).toBeTruthy();
    expect(host.querySelector('.sticky-group')).toBeTruthy();
  });

  // T19 – Refresh button
  it('refresh button: click triggers refetch', async () => {
    const fetchMock = mockFetch(200, progressMock());
    vi.stubGlobal('fetch', fetchMock);
    mountTab();
    await settle();
    const callCount = fetchMock.mock.calls.length;
    const refreshBtn = host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement;
    refreshBtn.click();
    await settle();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callCount);
  });

  // T20 – Stale-while-revalidate
  it('stale-while-revalidate: table stays visible during Refresh (data not reset)', async () => {
    let resolveRefresh!: (v: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(progressMock()), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((r) => { resolveRefresh = r; }));
    vi.stubGlobal('fetch', fetchMock);
    mountTab();
    await settle();
    // Table is populated
    expect(host.textContent).toContain('Alice');
    // Click Refresh — keeps fetch in-flight
    const refreshBtn = host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement;
    refreshBtn.click();
    flushSync();
    // LoadingPlaceholder shows
    expect(host.querySelector('.loading-placeholder, [role="status"]')).toBeTruthy();
    // Table rows still visible (stale data not cleared)
    expect(host.textContent).toContain('Alice');
    // Cleanup
    resolveRefresh(new Response(JSON.stringify(progressMock()), { status: 200 }));
    await settle();
  });

  // T21 – Retry-after-error
  it('retry-after-error: error banner → Retry → error clears → table populates', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(new Response(JSON.stringify(progressMock()), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    mountTab();
    await settle();
    expect(host.querySelector('.banner-error, [role="alert"]')).toBeTruthy();
    // Click Retry
    const retryBtn = Array.from(host.querySelectorAll('button')).find((b) => /retry/i.test(b.textContent ?? ''));
    retryBtn!.click();
    await settle();
    // Error banner gone, table populated
    expect(host.querySelector('.banner-error, [role="alert"]')).toBeFalsy();
    expect(host.textContent).toContain('Alice');
  });

  // T22 – CSV download
  it('CSV download: calls URL.createObjectURL; filename contains sanitized title + date', async () => {
    const body = progressMock({
      run: { id: 1, title: 'My Run/2026 Test', groups_enabled: true, version_is_disabled: false },
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    const createObjectURL = vi.fn(() => 'blob:mock');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((el) => {
      if ((el as HTMLElement).tagName === 'A') (el as HTMLAnchorElement).click();
      return el;
    });
    vi.spyOn(document.body, 'removeChild').mockImplementation((el) => el);
    mountTab();
    await settle();
    const csvBtn = host.querySelector('[data-action="download-csv"]') as HTMLButtonElement;
    csvBtn.click();
    flushSync();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    // Check that the anchor's download attribute contains the sanitized title
    const anchorCall = appendSpy.mock.calls.find(([el]) => (el as HTMLElement).tagName === 'A');
    expect(anchorCall).toBeTruthy();
    const anchor = anchorCall![0] as HTMLAnchorElement;
    expect(anchor.download).toMatch(/^progress-My_Run_2026_Test-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  // T23 – AbortController: rapid runId change cancels first fetch
  it('rapid runId change cancels in-flight fetch (signal.aborted)', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => { /* never resolves */ }));
    vi.stubGlobal('fetch', fetchMock);
    const box = $state({ runId: 1 });
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(RunProgressTab, { target: host, props: box });
    flushSync();
    // Capture signal from first call
    const firstSignal = (fetchMock.mock.calls[0] as unknown[][])[1] as RequestInit;
    const signal = (firstSignal as RequestInit).signal;
    expect(signal?.aborted).toBe(false);
    // Change runId — triggers new $effect, should abort previous
    box.runId = 2;
    flushSync();
    expect(signal?.aborted).toBe(true);
  });

  // T24 – RunId change resets local state
  it('runId change resets groupFilter, nameQuery, panelOpen, panelTarget', async () => {
    const fetchMock = mockFetch(200, progressMock());
    vi.stubGlobal('fetch', fetchMock);
    const box = $state({ runId: 1 });
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(RunProgressTab, { target: host, props: box });
    flushSync();
    await settle();
    // Open panel first (before filtering)
    const cellBtn = host.querySelector('.cell-btn') as HTMLButtonElement;
    cellBtn.click();
    flushSync();
    expect(host.querySelector('.panel-placeholder')).toBeTruthy();
    // Set groupFilter
    const select = host.querySelector('select[aria-label="Filter by group"]') as HTMLSelectElement;
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    flushSync();
    // Set nameQuery
    const input = host.querySelector('input[aria-label="Search student"]') as HTMLInputElement;
    input.value = 'foo';
    input.dispatchEvent(new Event('input'));
    flushSync();
    // Change runId — mock returns data for new run
    const fetchMock2 = mockFetch(200, progressMock({ run: { id: 2, title: 'R2', groups_enabled: true, version_is_disabled: false } }));
    vi.stubGlobal('fetch', fetchMock2);
    box.runId = 2;
    flushSync();
    await settle();
    // State should be reset: no panel, no filter applied, no search query
    expect(host.querySelector('.panel-placeholder')).toBeFalsy();
    // groupFilter reset to 'all' — both students visible again
    expect(host.textContent).toContain('Alice');
    expect(host.textContent).toContain('Bob');
    // nameQuery reset — search input is empty
    const inputAfter = host.querySelector('input[aria-label="Search student"]') as HTMLInputElement;
    expect(inputAfter.value).toBe('');
  });

  // T25 – Unmount-after-refresh aborts refresh controller
  it('unmount after refresh() aborts the refresh-created controller', async () => {
    let resolveRefresh!: (v: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(progressMock()), { status: 200 }))
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
    resolveRefresh(new Response(JSON.stringify(progressMock()), { status: 200 }));
  });

  // T26 – (Ungrouped) absent
  it('(Ungrouped) option is absent when no students have group_id null', async () => {
    const body = progressMock({
      students: [
        { user_id: 100, full_name: 'Alice', email: 'a@x', user_is_disabled: false,
          group_id: 1, group_name: 'G1', group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 1, total: 1 }],
          quizzes: [{ sequence_id: 10, correct: 0, total: 0 }] },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    const select = host.querySelector('select[aria-label="Filter by group"]') as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).not.toContain('ungrouped');
  });

  // T27 – (Ungrouped) present
  it('(Ungrouped) option is present when at least one student has group_id null', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    const select = host.querySelector('select[aria-label="Filter by group"]') as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toContain('ungrouped');
  });
});
