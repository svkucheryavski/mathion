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
  it('renders the Skeleton before fetch resolves', () => {
    let resolve!: (v: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolve = r; })));
    mountTab();
    expect(host.querySelector('.skeleton')).toBeTruthy();
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
    const cellsByText = (t: string) => Array.from(host.querySelectorAll('td.cell')).find((td) => td.textContent?.trim() === t) as HTMLElement;
    expect(cellsByText('2/4').getAttribute('style')).toMatch(/--cell-bg:\s*var\(--heat-2\)/);
    expect(cellsByText('4/4').getAttribute('style')).toMatch(/--cell-bg:\s*var\(--heat-4\)/);
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

  // T15 – Cell click opens side panel (real DashboardSidePanel)
  it('cell click: opens DashboardSidePanel (role=dialog) with progress target', async () => {
    // First fetch: progress dashboard; subsequent fetch: getSequenceItemState drilldown
    const drilldownBody = {
      sequence: { sequence_id: 10, sequence_title: 'S1', sequence_order: 1, block_id: 5, block_title: 'B1' },
      student: { user_id: 100, full_name: 'Alice', email: 'a@x' },
      items: [{ item_id: 1, item_order: 1, item_title: 'Item 1', item_type: 'static_page', is_covered: true, last_score: null, last_visited_at: null }],
    };
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(progressMock()), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValue(new Response(JSON.stringify(drilldownBody), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    mountTab();
    await settle();
    const cellBtn = host.querySelector('.cell-btn') as HTMLButtonElement;
    expect(cellBtn).toBeTruthy();
    cellBtn.click();
    flushSync();
    await settle();
    // Real panel is mounted — check for dialog role
    const panel = host.querySelector('[role="dialog"]');
    expect(panel).toBeTruthy();
    // Named by its <h2>: the student once the drill-down has loaded (6c §Progress variant).
    expect(document.getElementById(panel!.getAttribute('aria-labelledby')!)?.textContent).toBe('Alice');
  });

  // T16 – Disabled user
  it('the Student cell holds its name and chip in a fixed-width box (sticky Group never covers a long name)', async () => {
    const body = progressMock({
      students: [
        { user_id: 100, full_name: null, email: 's123456@student.university.example', user_is_disabled: true,
          group_id: 1, group_name: 'G1', group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 2, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: 1, total: 2 }] },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    const th = host.querySelector('tbody th.sticky-name') as HTMLElement;
    const box = th.querySelector(':scope > .name-box') as HTMLElement;
    expect(th.children).toHaveLength(1);
    expect(box.querySelector('.pg-name')?.textContent).toBe('s123456@student.university.example');
    expect(box.querySelector('.chip-disabled')?.textContent?.trim()).toBe('disabled');
  });

  it('disabled user: italic muted name + "disabled" chip after the name; no opacity row class', async () => {
    const body = progressMock({
      students: [
        { user_id: 100, full_name: 'Alice', email: 'a@x', user_is_disabled: true,
          group_id: 1, group_name: 'G1', group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 2, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: 1, total: 2 }] },
        { user_id: 101, full_name: 'Bob', email: 'b@x', user_is_disabled: false,
          group_id: 2, group_name: 'G2', group_is_disabled: true,
          coverage: [{ sequence_id: 10, covered: 2, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: 1, total: 2 }] },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    expect(host.querySelector('tr.disabled-row')).toBeNull();
    const [alice, bob] = Array.from(host.querySelectorAll('tbody tr'));
    expect(alice!.querySelector('th .pg-name')?.classList.contains('off')).toBe(true);
    expect(alice!.querySelector('th .chip-disabled')?.textContent?.trim()).toBe('disabled');
    expect(alice!.querySelector('td.sticky-group .chip-disabled')).toBeNull();
    expect(bob!.querySelector('th .pg-name')?.classList.contains('off')).toBe(true);
    expect(bob!.querySelector('th .chip-disabled')).toBeNull();
    expect(bob!.querySelector('td.sticky-group .chip-disabled')?.textContent?.trim()).toBe('disabled');
  });

  // T17 – Disabled version
  it('disabled version: one muted line with only the tab\'s own clause (R7)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock({ run: { id: 1, title: 'R', groups_enabled: true, version_is_disabled: true } })));
    mountTab();
    await settle();
    expect(host.querySelector('p.pg-note')?.textContent?.trim()).toBe('Coverage data reflects last-known state.');
    expect(host.textContent).not.toContain('course version is disabled');
  });

  it('enabled version: no note', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    expect(host.querySelector('p.pg-note')).toBeNull();
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
    // "Refreshing…" shows, no Skeleton (C17)
    expect(host.textContent).toContain('Refreshing…');
    expect(host.querySelector('.skeleton')).toBeNull();
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

  // T22b – CSV download: percent columns (2 per sequence) formatted to one decimal
  it('CSV body emits coverage_pct + quiz_pct (2 cols per seq, one decimal, empty when undefined)', async () => {
    const body = progressMock({
      students: [
        { user_id: 1, full_name: 'Alice', email: 'a@x', group_id: null, group_name: null, user_is_disabled: false, group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 2, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: 1, total: 2 }] },
        { user_id: 2, full_name: 'Bob', email: 'b@x', group_id: null, group_name: null, user_is_disabled: false, group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 0, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: null, total: null }] },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    let capturedCsv = '';
    vi.stubGlobal('Blob', class {
      size: number;
      type: string;
      constructor(parts: string[], opts?: { type?: string }) {
        capturedCsv = parts.join('');
        this.size = capturedCsv.length;
        this.type = opts?.type ?? '';
      }
    } as unknown as typeof Blob);
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
    vi.spyOn(document.body, 'appendChild').mockImplementation((el) => {
      if ((el as HTMLElement).tagName === 'A') (el as HTMLAnchorElement).click();
      return el;
    });
    vi.spyOn(document.body, 'removeChild').mockImplementation((el) => el);
    mountTab();
    await settle();
    (host.querySelector('[data-action="download-csv"]') as HTMLButtonElement).click();
    flushSync();
    // Header row: only coverage_pct + quiz_pct per sequence (no _covered/_total/_correct cols)
    expect(capturedCsv).toContain('coverage_pct');
    expect(capturedCsv).toContain('quiz_pct');
    expect(capturedCsv).not.toContain('coverage_covered');
    expect(capturedCsv).not.toContain('quiz_correct');
    // Alice: 2/4 covered → 50.0, 1/2 correct → 50.0
    expect(capturedCsv).toMatch(/Alice.*50\.0.*50\.0/);
    // Bob: 0/4 covered → 0.0, quiz total null → empty (no quiz_pct emitted between the trailing commas)
    expect(capturedCsv).toMatch(/Bob.*0\.0,(\r\n|,|$)/);
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
    const drilldownBody = {
      sequence: { sequence_id: 10, sequence_title: 'S1', sequence_order: 1, block_id: 5, block_title: 'B1' },
      student: { user_id: 100, full_name: 'Alice', email: 'a@x' },
      items: [],
    };
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(progressMock()), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValue(new Response(JSON.stringify(drilldownBody), { status: 200, headers: { 'Content-Type': 'application/json' } })));
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
    await settle();
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
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
    expect(host.querySelector('[role="dialog"]')).toBeFalsy();
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

  it('heat steps: 0 → --surface-muted, no data → no fill; text keeps its value', async () => {
    const body = progressMock({
      students: [
        { user_id: 100, full_name: 'Alice', email: 'a@x', user_is_disabled: false,
          group_id: 1, group_name: 'G1', group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 0, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: null, total: null }] },
        { user_id: 101, full_name: 'Bob', email: 'b@x', user_is_disabled: false,
          group_id: 1, group_name: 'G1', group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 0, total: 0 }],
          quizzes: [{ sequence_id: 10, correct: 0, total: 0 }] },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    const [a, b] = Array.from(host.querySelectorAll('td.cell')) as HTMLElement[];
    expect(a!.getAttribute('style')).toMatch(/--cell-bg:\s*var\(--surface-muted\)/);
    expect(a!.textContent?.trim()).toBe('0/4');
    expect(b!.getAttribute('style') ?? '').not.toContain('--cell-bg');
    expect(b!.textContent?.trim()).toBe('—');
  });

  it('the legend: 0%, five swatches in order, 100%; its name follows the mode', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    const legend = host.querySelector('.heat-legend') as HTMLElement;
    expect(legend.getAttribute('role')).toBe('img');
    expect(legend.getAttribute('aria-label')).toBe('Coverage scale, 0 to 100 percent');
    expect(Array.from(legend.querySelectorAll('.hl-sw')).map((s) => s.className.match(/\bs\d\b/)?.[0]))
      .toEqual(['s0', 's1', 's2', 's3', 's4']);
    expect(legend.textContent?.replace(/\s+/g, ' ').trim()).toBe('0% 100%');
    (Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Quiz') as HTMLButtonElement).click();
    flushSync();
    expect(legend.getAttribute('aria-label')).toBe('Score scale, 0 to 100 percent');
  });

  it('headers number blocks by position in `blocks` and sequences within their block (R13)', async () => {
    const body = progressMock({
      sequences: [
        { sequence_id: 10, sequence_title: 'Vectors', sequence_order: 1, block_id: 5, block_order: 1, block_title: 'Vectors',
          total_items: 4, has_quiz_items: true },
        { sequence_id: 11, sequence_title: 'Spaces', sequence_order: 4, block_id: 5, block_order: 1, block_title: 'Vectors',
          total_items: 4, has_quiz_items: true },
        { sequence_id: 12, sequence_title: 'As a map', sequence_order: 2, block_id: 7, block_order: 3, block_title: 'Matrices',
          total_items: 4, has_quiz_items: true },
      ],
      students: [],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab(1, { blocks: [
      { id: 5, version_id: 1, title: 'Vectors', slug: 'v', order: 1, info: '', info_html: '' },
      { id: 7, version_id: 1, title: 'Matrices', slug: 'm', order: 3, info: '', info_html: '' },
    ] });
    await settle();
    expect(Array.from(host.querySelectorAll('th.block-header')).map((th) => th.textContent?.trim()))
      .toEqual(['B1 · Vectors', 'B2 · Matrices']);
    expect(Array.from(host.querySelectorAll('th.seq-header')).map((th) => th.textContent?.replace(/\s+/g, ' ').trim()))
      .toEqual(['S1 Vectors', 'S2 Spaces', 'S1 As a map']);
  });

  // D79 (user): a compact table -- the headers read "B1" and "S1"; the full
  // names stay in the accessible text (visually hidden) and show in a tooltip
  // on hover and on keyboard focus, rendered outside the scroll box.
  describe('compact headers (D79)', () => {
    const twoBlocks = () => progressMock({
      sequences: [
        { sequence_id: 10, sequence_title: 'Vectors', sequence_order: 1, block_id: 5, block_order: 1, block_title: 'Vectors',
          total_items: 4, has_quiz_items: true },
        { sequence_id: 11, sequence_title: 'Spaces', sequence_order: 4, block_id: 5, block_order: 1, block_title: 'Vectors',
          total_items: 4, has_quiz_items: true },
        { sequence_id: 12, sequence_title: 'As a map', sequence_order: 2, block_id: 7, block_order: 3, block_title: 'Matrices',
          total_items: 4, has_quiz_items: true },
      ],
      students: [],
    });
    const blocks = [
      { id: 5, version_id: 1, title: 'Vectors', slug: 'v', order: 1, info: '', info_html: '' },
      { id: 7, version_id: 1, title: 'Matrices', slug: 'm', order: 3, info: '', info_html: '' },
    ];
    // The text a sighted user sees: everything outside .sr-only.
    const visible = (el: Element) => {
      const c = el.cloneNode(true) as Element;
      c.querySelectorAll('.sr-only').forEach((n) => n.remove());
      return c.textContent!.replace(/\s+/g, ' ').trim();
    };
    const tip = () => document.querySelector('.pg-tip') as HTMLElement | null;
    const seqBtn = (i: number) => host.querySelectorAll('th.seq-header button')[i] as HTMLButtonElement;
    async function mountCompact() {
      vi.stubGlobal('fetch', mockFetch(200, twoBlocks()));
      mountTab(1, { blocks });
      await settle();
    }

    it('shows short labels; the full names stay in the accessible text', async () => {
      await mountCompact();
      const bh = Array.from(host.querySelectorAll('th.block-header'));
      expect(bh.map(visible)).toEqual(['B1', 'B2']);
      expect(bh.map((th) => th.textContent!.trim())).toEqual(['B1 · Vectors', 'B2 · Matrices']);
      const sh = Array.from(host.querySelectorAll('th.seq-header button'));
      expect(sh.map(visible)).toEqual(['S1', 'S2', 'S1']);
      expect(sh.map((b) => b.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['S1 Vectors', 'S2 Spaces', 'S1 As a map']);
    });

    it('a sequence header shows its block and title in a tooltip on hover, outside the scroll box', async () => {
      await mountCompact();
      expect(tip()).toBeNull();
      seqBtn(2).dispatchEvent(new MouseEvent('mouseenter'));
      flushSync();
      expect(tip()!.textContent).toBe('B2 · Matrices — S1 · As a map');
      expect(tip()!.getAttribute('aria-hidden')).toBe('true');
      expect(host.querySelector('.table-scroll .pg-tip')).toBeNull();
      seqBtn(2).dispatchEvent(new MouseEvent('mouseleave'));
      flushSync();
      expect(tip()).toBeNull();
    });

    it('keyboard focus shows the tooltip; blur and Escape hide it', async () => {
      await mountCompact();
      seqBtn(1).dispatchEvent(new FocusEvent('focus'));
      flushSync();
      expect(tip()!.textContent).toBe('B1 · Vectors — S2 · Spaces');
      seqBtn(1).dispatchEvent(new FocusEvent('blur'));
      flushSync();
      expect(tip()).toBeNull();
      seqBtn(0).dispatchEvent(new FocusEvent('focus'));
      flushSync();
      expect(tip()).not.toBeNull();
      seqBtn(0).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      flushSync();
      expect(tip()).toBeNull();
    });

    it('a block header shows its full name in the tooltip on hover', async () => {
      await mountCompact();
      const bh = host.querySelectorAll('th.block-header')[1] as HTMLElement;
      bh.dispatchEvent(new MouseEvent('mouseenter'));
      flushSync();
      expect(tip()!.textContent).toBe('B2 · Matrices');
      bh.dispatchEvent(new MouseEvent('mouseleave'));
      flushSync();
      expect(tip()).toBeNull();
    });

    // Round-1 review (both lanes): the tip sits on the VISIBLE part of its header
    // (right of the pinned Student + Group columns, inside the scroll box), at
    // least 8px from the window edges, and below the header near the top.
    const rect = (left: number, right: number, top = 300, bottom = 330) =>
      ({ left, right, top, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    function place(el: Element, r: DOMRect) { (el as HTMLElement).getBoundingClientRect = () => r; }
    async function mountPlaced(header: DOMRect) {
      await mountCompact();
      place(host.querySelector('.table-scroll')!, rect(0, 1000, 280, 400));
      place(host.querySelector('thead .sticky-group')!, rect(200, 300, 280, 340));
      place(seqBtn(0), header);
      seqBtn(0).dispatchEvent(new MouseEvent('mouseenter'));
      flushSync();
      return tip()!;
    }

    it('on the window\'s left half the tip starts at the header\'s visible left edge', async () => {
      const t = await mountPlaced(rect(250, 380));   // half under the pinned columns
      expect(t.style.left).toBe('300px');
      expect(t.style.right).toBe('');
      expect(t.style.top).toBe('294px');
      expect(t.classList.contains('below')).toBe(false);
    });

    it('on the right half it ends at the visible right edge, clipped by the scroll box', async () => {
      const t = await mountPlaced(rect(700, 1300));  // runs past the scroll box (right 1000)
      expect(t.style.right).toBe(`${window.innerWidth - 1000}px`);
      expect(t.style.left).toBe('');
    });

    it('keeps at least 8px from the window edge', async () => {
      await mountCompact();
      place(host.querySelector('.table-scroll')!, rect(-50, window.innerWidth + 50, 280, 400));
      place(host.querySelector('thead .sticky-group')!, rect(-100, -40, 280, 340));
      place(seqBtn(0), rect(window.innerWidth - 60, window.innerWidth + 40));
      seqBtn(0).dispatchEvent(new MouseEvent('mouseenter'));
      flushSync();
      expect(tip()!.style.right).toBe('8px');
    });

    it('near the top of the window the tip flips below the header', async () => {
      const t = await mountPlaced(rect(400, 480, 20, 50));
      expect(t.classList.contains('below')).toBe(true);
      expect(t.style.top).toBe('56px');
    });

    it('Escape anywhere hides a hover tip; a page scroll hides it too', async () => {
      await mountCompact();
      seqBtn(0).dispatchEvent(new MouseEvent('mouseenter'));
      flushSync();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      flushSync();
      expect(tip()).toBeNull();
      seqBtn(0).dispatchEvent(new MouseEvent('mouseenter'));
      flushSync();
      window.dispatchEvent(new Event('scroll'));
      flushSync();
      expect(tip()).toBeNull();
    });

    it('a block missing from `blocks` keeps its title and shows no tip', async () => {
      vi.stubGlobal('fetch', mockFetch(200, twoBlocks()));
      mountTab(1, { blocks: [blocks[0]] });
      await settle();
      const bh = host.querySelectorAll('th.block-header')[1] as HTMLElement;
      expect(bh.textContent!.trim()).toBe('Matrices');
      bh.dispatchEvent(new MouseEvent('mouseenter'));
      flushSync();
      expect(tip()).toBeNull();
    });

    it('scrolling the table hides the tooltip', async () => {
      await mountCompact();
      seqBtn(0).dispatchEvent(new MouseEvent('mouseenter'));
      flushSync();
      expect(tip()).not.toBeNull();
      host.querySelector('.table-scroll')!.dispatchEvent(new Event('scroll'));
      flushSync();
      expect(tip()).toBeNull();
    });

    // Round-2 review (both lanes): focusing a header that is out of view scrolls
    // it in, and that scroll fires after the focus. A focus tip follows its
    // header through a scroll; a hover tip still hides.
    it('a focus tip survives the scroll its focus causes, at the header\'s new place', async () => {
      await mountCompact();
      place(host.querySelector('.table-scroll')!, rect(0, 1000, 280, 400));
      place(host.querySelector('thead .sticky-group')!, rect(200, 300, 280, 340));
      place(seqBtn(0), rect(1100, 1180));            // off the scroll box's right edge
      seqBtn(0).focus();
      flushSync();
      place(seqBtn(0), rect(400, 480));              // scrolled into view
      host.querySelector('.table-scroll')!.dispatchEvent(new Event('scroll'));
      flushSync();
      expect(tip()!.style.left).toBe('400px');
      window.dispatchEvent(new Event('scroll'));
      flushSync();
      expect(tip()).not.toBeNull();
      seqBtn(0).blur();
      flushSync();
      expect(tip()).toBeNull();
    });

    it('a focus tip hides once a scroll leaves its header under the pinned columns', async () => {
      await mountCompact();
      place(host.querySelector('.table-scroll')!, rect(0, 1000, 280, 400));
      place(host.querySelector('thead .sticky-group')!, rect(200, 300, 280, 340));
      place(seqBtn(0), rect(400, 480));
      seqBtn(0).focus();
      flushSync();
      expect(tip()).not.toBeNull();
      place(seqBtn(0), rect(210, 290));              // wholly behind Student + Group
      host.querySelector('.table-scroll')!.dispatchEvent(new Event('scroll'));
      flushSync();
      expect(tip()).toBeNull();
    });

    // Round-3 review (minors): the focused header's tip is the one that stays.
    it('a mouse-out returns the tip to the header that has keyboard focus', async () => {
      await mountCompact();
      seqBtn(0).focus();
      flushSync();
      const focusText = tip()!.textContent;
      seqBtn(2).dispatchEvent(new MouseEvent('mouseenter'));
      flushSync();
      expect(tip()!.textContent).not.toBe(focusText);
      seqBtn(2).dispatchEvent(new MouseEvent('mouseleave'));
      flushSync();
      expect(tip()!.textContent).toBe(focusText);
    });

    it('a resize re-places a focus tip; Escape keeps it dismissed through a scroll or resize', async () => {
      await mountCompact();
      place(host.querySelector('.table-scroll')!, rect(0, 1000, 280, 400));
      place(host.querySelector('thead .sticky-group')!, rect(200, 300, 280, 340));
      place(seqBtn(0), rect(400, 480));
      seqBtn(0).focus();
      flushSync();
      place(seqBtn(0), rect(420, 500));
      window.dispatchEvent(new Event('resize'));
      flushSync();
      expect(tip()!.style.left).toBe('420px');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      flushSync();
      expect(tip()).toBeNull();
      host.querySelector('.table-scroll')!.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
      flushSync();
      expect(tip()).toBeNull();
    });

    // Round-4 review (Fable): Chrome and Firefox focus a button on click (a sort),
    // without :focus-visible. That tip is a hover tip: a mouse-out hides it.
    it('a click focus (not :focus-visible) does not keep the tip after a mouse-out', async () => {
      await mountCompact();
      const b = seqBtn(1);
      const m = b.matches.bind(b);
      b.matches = (sel: string) => (sel === ':focus-visible' ? false : m(sel));
      b.dispatchEvent(new MouseEvent('mouseenter'));
      b.focus();
      flushSync();
      expect(tip()).not.toBeNull();
      b.dispatchEvent(new MouseEvent('mouseleave'));
      flushSync();
      expect(tip()).toBeNull();
    });
  });

  it('a block missing from `blocks` shows its title without "B{n} · "', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    expect(host.querySelector('th.block-header')?.textContent?.trim()).toBe('B1');
  });

  it('the active sort column shows a SortMark, not a glyph character', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    const student = host.querySelector('th.sticky-name') as HTMLElement;
    expect(student.querySelector('svg.sort-mark')?.getAttribute('data-dir')).toBe('asc');
    expect(host.querySelector('thead')?.textContent).not.toMatch(/[▲▼]/);
  });

  it('toolbar: Coverage / Quiz segmented, refresh icon button, Download CSV secondary', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    const seg = host.querySelector('.seg') as HTMLElement;
    expect(Array.from(seg.querySelectorAll('button')).map((b) => [b.textContent?.trim(), b.getAttribute('aria-pressed')]))
      .toEqual([['Coverage', 'true'], ['Quiz', 'false']]);
    const refresh = host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement;
    expect(refresh.getAttribute('data-glyph')).toBe('refresh');
    const csv = host.querySelector('button[data-action="download-csv"]') as HTMLButtonElement;
    expect(csv.getAttribute('data-variant')).toBe('secondary');
    expect(csv.textContent?.trim()).toBe('Download CSV');
  });
});

// ---- Polish 3 Task 7 — one loading look (D86, C17) ----

const refreshingEl = () => Array.from(host.querySelectorAll('[role="status"]')).find((e) => !e.closest('.skeleton')) ?? null;

describe('RunProgressTab (Polish 3 — loading)', () => {
  it('the first load shows the Skeleton', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    mountTab();
    flushSync();
    const sk = host.querySelector('.skeleton');
    expect(sk).not.toBeNull();
    expect(sk!.getAttribute('role')).toBe('status');
    expect(sk!.querySelectorAll('.row')).toHaveLength(6);
    expect(sk!.textContent).toContain('Loading…');
  });

  it('a Refresh over data keeps the rows and shows "Refreshing…", with no Skeleton', async () => {
    let resolveRefresh!: (v: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(progressMock()), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((r) => { resolveRefresh = r; }));
    vi.stubGlobal('fetch', fetchMock);
    mountTab();
    await settle();
    (host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement).click();
    flushSync();
    expect(host.querySelector('.skeleton')).toBeNull();
    expect(host.textContent).toContain('Alice');
    expect(host.textContent).toContain('Refreshing…');
    resolveRefresh(new Response(JSON.stringify(progressMock()), { status: 200 }));
    await settle();
    expect(host.textContent).not.toContain('Refreshing…');
  });

  it('the status element stays mounted and empty between refreshes', async () => {
    let resolveRefresh!: (v: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(progressMock()), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((r) => { resolveRefresh = r; }));
    vi.stubGlobal('fetch', fetchMock);
    mountTab();
    await settle();
    const status = refreshingEl();
    expect(status).not.toBeNull();
    expect(status!.textContent).toBe('');
    (host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement).click();
    flushSync();
    expect(refreshingEl()).toBe(status);
    expect(status!.textContent).toBe('Refreshing…');
    resolveRefresh(new Response(JSON.stringify(progressMock()), { status: 200 }));
    await settle();
    expect(refreshingEl()).toBe(status);
    expect(status!.textContent).toBe('');
  });

  it('a change of run shows the Skeleton, not "Refreshing…" over the old run\'s rows (rev 11)', async () => {
    let resolveNext!: (v: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(progressMock()), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((r) => { resolveNext = r; }));
    vi.stubGlobal('fetch', fetchMock);
    const props = $state({ runId: 1 });
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(RunProgressTab, { target: host, props });
    await settle();
    expect(host.textContent).toContain('Alice');
    props.runId = 2;
    flushSync();
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/runs/2/dashboard/progress');   // run 2 is asked for
    expect(host.querySelector('.skeleton')).not.toBeNull();
    expect(host.textContent).not.toContain('Alice');
    expect(host.textContent).not.toContain('Refreshing…');
    resolveNext(new Response(JSON.stringify(progressMock()), { status: 200 }));
    await settle();
    expect(host.querySelector('.skeleton')).toBeNull();
    expect(host.textContent).toContain('Alice');           // the new run's rows
    expect(host.textContent).not.toContain('Refreshing…');
  });
});
