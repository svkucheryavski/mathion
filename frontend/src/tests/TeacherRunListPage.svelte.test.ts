// TeacherRunListPage tests — slice A T8. Uses the project's established
// `mount/unmount/flushSync` pattern (see InlineConfirm.svelte.test.ts and
// AppHeader.svelte.test.ts). We intentionally do NOT use
// @testing-library/svelte: it is not a project dependency and CLAUDE.md /
// MEMORY.md forbid adding new JS deps.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TeacherRunListPage from '../pages/teaching/TeacherRunListPage.svelte';
import * as router from '../lib/router.svelte';
import { expectRoutesInApp } from './support/routeClickProbe';
import { runStatus } from '../lib/runStatus';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }));
}

function makeRun(overrides: Partial<{
  id: number; title: string; start_date: string; end_date: string;
  is_published: boolean; created_at: string; groups_enabled: boolean;
  version_id: number; updated_at: string | null;
}>) {
  // Defaults intentionally span a far-past start to a far-future end so
  // runStatus() classifies the default row as 'active' regardless of the
  // wall-clock date this suite runs against. (R1 reviewer flagged date
  // fragility: previously end_date was 2026-05-30 = "today", which would
  // flip the row to 'ended' the next day and silently break tests.)
  return {
    id: 1, title: 'R', start_date: '2020-01-01', end_date: '2099-12-31',
    is_published: true, created_at: '2026-01-01T00:00:00Z',
    groups_enabled: false, version_id: 1, updated_at: null,
    ...overrides,
  };
}

function row(extra: Partial<{
  run: ReturnType<typeof makeRun>; course_id: number;
  course_name: string; course_slug: string; student_count: number;
}>) {
  return {
    run: makeRun({}), course_id: 10, course_name: 'C', course_slug: 'c',
    student_count: 0,
    ...extra,
  };
}

// Drain microtasks so async load() completes, then flush Svelte reactivity.
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
}

function nodeByText(target: HTMLElement, text: string | RegExp): HTMLElement | null {
  const all = Array.from(target.querySelectorAll('*')) as HTMLElement[];
  return all.find((el) => {
    const direct = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => (n.textContent ?? '').trim())
      .join('');
    return typeof text === 'string' ? direct === text : text.test(direct);
  }) ?? null;
}

function buttonByText(target: HTMLElement, text: string | RegExp): HTMLButtonElement | null {
  const buttons = Array.from(target.querySelectorAll('button')) as HTMLButtonElement[];
  return buttons.find((b) => {
    const t = (b.textContent ?? '').trim();
    return typeof text === 'string' ? t === text : text.test(t);
  }) ?? null;
}

function linkByText(target: HTMLElement, text: string): HTMLAnchorElement | null {
  const anchors = Array.from(target.querySelectorAll('a')) as HTMLAnchorElement[];
  return anchors.find((a) => (a.textContent ?? '').trim() === text) ?? null;
}

function pageTextContains(target: HTMLElement, text: string | RegExp): boolean {
  const full = target.textContent ?? '';
  return typeof text === 'string' ? full.includes(text) : text.test(full);
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  if (component) { unmount(component); component = null; }
  document.body.removeChild(target);
  vi.restoreAllMocks();
  // A pill click writes ?status= (Polish 3): the next test starts at a bare address.
  history.replaceState(null, '', '/');
  Object.assign(router.currentRoute, { path: '/', search: '', hash: '' });
});

describe('TeacherRunListPage', () => {
  it('shows loading state before fetch resolves, then renders table', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({})]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    // BEFORE settle: loading branch should be visible (the fetch promise
    // has not resolved yet). This locks the `{#if loading} <Skeleton/>`
    // branch — a mutation removing the initial `loading = true` would fail here.
    expect(pageTextContains(target, /Loading runs/)).toBe(true);
    expect(target.querySelector('table')).toBeNull();
    await settle();
    // AFTER settle: loaded state, row visible, loading gone.
    expect(pageTextContains(target, /Loading runs/)).toBe(false);
    expect(pageTextContains(target, 'R')).toBe(true);
  });

  it('error state renders banner with Try again button that re-fetches', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([row({})]), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchSpy);
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    expect(target.querySelector('.error-state.inline')).not.toBeNull();
    expect(target.textContent).toContain('Could not load runs.');
    const tryAgain = buttonByText(target, 'Try again');
    expect(tryAgain).not.toBeNull();
    tryAgain!.click();
    await settle();
    expect(pageTextContains(target, 'R')).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('renders all 5 pills with counts derived from full response, stable across pill switch', async () => {
    const active = row({
      run: makeRun({
        id: 1, title: 'A',
        start_date: '2026-01-01', end_date: '2030-01-01',
        is_published: true,
      }),
    });
    const draft = row({
      run: makeRun({ id: 2, title: 'D', is_published: false }),
    });
    vi.stubGlobal('fetch', mockFetch(200, [active, draft]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    // All five pill labels with full-response-derived counts.
    expect(buttonByText(target, /^Active \(1\)$/)).not.toBeNull();
    expect(buttonByText(target, /^Upcoming \(0\)$/)).not.toBeNull();
    expect(buttonByText(target, /^Finished \(0\)$/)).not.toBeNull();
    expect(buttonByText(target, /^Draft \(1\)$/)).not.toBeNull();
    expect(buttonByText(target, /^All \(2\)$/)).not.toBeNull();
    // Switch to Draft pill; counts must remain stable (not recomputed from
    // the visible bucket). Spec §6.2 bullet: counts derived from full response.
    buttonByText(target, /^Draft \(1\)$/)!.click();
    flushSync();
    expect(buttonByText(target, /^Active \(1\)$/)).not.toBeNull();
    expect(buttonByText(target, /^Upcoming \(0\)$/)).not.toBeNull();
    expect(buttonByText(target, /^Finished \(0\)$/)).not.toBeNull();
    expect(buttonByText(target, /^Draft \(1\)$/)).not.toBeNull();
    expect(buttonByText(target, /^All \(2\)$/)).not.toBeNull();
  });

  it('default selected pill is active with aria-pressed=true', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({})]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    const activePill = buttonByText(target, /^Active/);
    expect(activePill).not.toBeNull();
    expect(activePill!.getAttribute('aria-pressed')).toBe('true');
  });

  it('empty response renders page-level empty state with no pills and no table', async () => {
    vi.stubGlobal('fetch', mockFetch(200, []));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    expect(pageTextContains(target, 'No runs yet. Runs you teach or administer appear here.')).toBe(true);
    // No pill buttons rendered when there are no runs at all.
    expect(buttonByText(target, /^Active/)).toBeNull();
    expect(buttonByText(target, /^All/)).toBeNull();
    // No table at all.
    expect(target.querySelector('table')).toBeNull();
  });

  it('course column renders course_name (not slug)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({ course_name: 'Calc 101', course_slug: 'calc' })]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    expect(pageTextContains(target, 'Calc 101')).toBe(true);
    // The course slug 'calc' may legitimately appear inside hrefs but must
    // NOT appear as visible text. Check that no DOM node has 'calc' as its
    // direct text content.
    expect(nodeByText(target, 'calc')).toBeNull();
  });

  it('cell-anchor href points to /teaching/:slug/runs/:rid', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({
      run: makeRun({ id: 42, title: 'Spring' }),
      course_slug: 'calc',
    })]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    const link = linkByText(target, 'Spring');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/teaching/calc/runs/42');
  });

  it('within-active sort: end_date ASC', async () => {
    const a = row({
      run: makeRun({
        id: 1, title: 'Later',
        start_date: '2026-01-01', end_date: '2030-12-31',
        is_published: true,
      }),
    });
    const b = row({
      run: makeRun({
        id: 2, title: 'Sooner',
        start_date: '2026-01-01', end_date: '2026-12-31',
        is_published: true,
      }),
    });
    vi.stubGlobal('fetch', mockFetch(200, [a, b]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    const rows = Array.from(target.querySelectorAll('tr')) as HTMLTableRowElement[];
    expect(rows[1]?.textContent ?? '').toContain('Sooner');
    expect(rows[2]?.textContent ?? '').toContain('Later');
  });

  it('within-active sort: id ASC tiebreak when end_dates are equal', async () => {
    // Two runs with the SAME end_date — only the id tiebreak distinguishes them.
    // A mutation removing `|| a.row.run.id - b.row.run.id` would let either
    // order pass without this test.
    const second = row({
      run: makeRun({
        id: 7, title: 'Seven',
        start_date: '2026-01-01', end_date: '2027-06-15',
        is_published: true,
      }),
    });
    const first = row({
      run: makeRun({
        id: 3, title: 'Three',
        start_date: '2026-01-01', end_date: '2027-06-15',
        is_published: true,
      }),
    });
    vi.stubGlobal('fetch', mockFetch(200, [second, first]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    const rows = Array.from(target.querySelectorAll('tr')) as HTMLTableRowElement[];
    expect(rows[1]?.textContent ?? '').toContain('Three');
    expect(rows[2]?.textContent ?? '').toContain('Seven');
  });

  it('within-upcoming sort: start_date ASC, id ASC tiebreak', async () => {
    // Both runs are upcoming (start_date > today). Same start_date so id wins.
    const later = row({
      run: makeRun({
        id: 9, title: 'Late upcoming',
        start_date: '2099-06-01', end_date: '2099-12-31',
        is_published: true,
      }),
    });
    const earlier = row({
      run: makeRun({
        id: 4, title: 'Early upcoming',
        start_date: '2099-01-01', end_date: '2099-06-30',
        is_published: true,
      }),
    });
    const tie = row({
      run: makeRun({
        id: 2, title: 'Tie upcoming',
        start_date: '2099-01-01', end_date: '2099-06-30',
        is_published: true,
      }),
    });
    vi.stubGlobal('fetch', mockFetch(200, [later, earlier, tie]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    buttonByText(target, /^Upcoming/)!.click();
    flushSync();
    const rows = Array.from(target.querySelectorAll('tbody tr')) as HTMLTableRowElement[];
    expect(rows[0]?.textContent ?? '').toContain('Tie upcoming');     // id=2, start=2099-01-01
    expect(rows[1]?.textContent ?? '').toContain('Early upcoming');   // id=4, start=2099-01-01
    expect(rows[2]?.textContent ?? '').toContain('Late upcoming');    // id=9, start=2099-06-01
  });

  it('within-ended sort: end_date DESC, id ASC tiebreak', async () => {
    // Both runs are ended (end_date < today). DESC by end_date.
    const earliest = row({
      run: makeRun({
        id: 1, title: 'Oldest ended',
        start_date: '2020-01-01', end_date: '2021-01-01',
        is_published: true,
      }),
    });
    const middle = row({
      run: makeRun({
        id: 2, title: 'Mid ended',
        start_date: '2022-01-01', end_date: '2022-12-31',
        is_published: true,
      }),
    });
    const tie = row({
      run: makeRun({
        id: 5, title: 'Tie ended',
        start_date: '2022-01-01', end_date: '2022-12-31',
        is_published: true,
      }),
    });
    vi.stubGlobal('fetch', mockFetch(200, [earliest, middle, tie]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    buttonByText(target, /^Finished/)!.click();
    flushSync();
    const rows = Array.from(target.querySelectorAll('tbody tr')) as HTMLTableRowElement[];
    expect(rows[0]?.textContent ?? '').toContain('Mid ended');     // id=2, end=2022-12-31
    expect(rows[1]?.textContent ?? '').toContain('Tie ended');     // id=5, end=2022-12-31
    expect(rows[2]?.textContent ?? '').toContain('Oldest ended');  // id=1, end=2021-01-01
  });

  it('within-draft sort: created_at DESC, id ASC tiebreak', async () => {
    const oldest = row({
      run: makeRun({
        id: 1, title: 'Old draft', is_published: false,
        created_at: '2025-01-01T00:00:00Z',
      }),
    });
    const newest = row({
      run: makeRun({
        id: 8, title: 'New draft', is_published: false,
        created_at: '2025-12-01T00:00:00Z',
      }),
    });
    const tie = row({
      run: makeRun({
        id: 3, title: 'Tie draft', is_published: false,
        created_at: '2025-12-01T00:00:00Z',
      }),
    });
    vi.stubGlobal('fetch', mockFetch(200, [oldest, newest, tie]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    buttonByText(target, /^Draft/)!.click();
    flushSync();
    const rows = Array.from(target.querySelectorAll('tbody tr')) as HTMLTableRowElement[];
    expect(rows[0]?.textContent ?? '').toContain('Tie draft');   // id=3, created=2025-12-01
    expect(rows[1]?.textContent ?? '').toContain('New draft');   // id=8, created=2025-12-01
    expect(rows[2]?.textContent ?? '').toContain('Old draft');   // id=1, created=2025-01-01
  });

  it('runStatus classifies a published row spanning today as active', async () => {
    // Contract: runStatus(is_published=true, start_date=yesterday, end_date=tomorrow) => 'active'.
    // This locks the dependency the page relies on for the default pill.
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const toIso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const status = runStatus({
      is_published: true,
      start_date: toIso(yesterday),
      end_date: toIso(tomorrow),
    });
    expect(status).toBe('active');
  });

  it('Status column renders the run status chip (lowercase label)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({})]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    const chip = target.querySelector('tbody .run-chip') as HTMLElement;
    expect(chip.getAttribute('data-status')).toBe('active');
    expect(chip.textContent?.trim()).toBe('active');
  });

  it('with 0 active runs the default pill stays Active and says "No active runs."', async () => {
    // Spec §6.2 bullet 5: when the response has 0 active runs, default pill
    // remains 'active' (selected) and the inline empty-filter message renders
    // with cross-counts derived from the full response.
    const draft = row({
      run: makeRun({ id: 1, title: 'D', is_published: false }),
    });
    const ended = row({
      run: makeRun({
        id: 2, title: 'E',
        start_date: '2020-01-01', end_date: '2021-01-01',
        is_published: true,
      }),
    });
    vi.stubGlobal('fetch', mockFetch(200, [draft, ended]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    // Default pill is still Active even with 0 active rows.
    const activePill = buttonByText(target, /^Active/);
    expect(activePill).not.toBeNull();
    expect(activePill!.getAttribute('aria-pressed')).toBe('true');
    expect(pageTextContains(target, 'No active runs.')).toBe(true);
    expect(pageTextContains(target, /You have/)).toBe(false);
    // Table is not rendered (no rows in current filter).
    expect(target.querySelector('tbody tr')).toBeNull();
  });

  it('switching pills filters table rows with no leak between statuses', async () => {
    const active = row({
      run: makeRun({
        id: 1, title: 'ACTIVE_ROW',
        start_date: '2020-01-01', end_date: '2099-12-31',
        is_published: true,
      }),
    });
    const draft = row({
      run: makeRun({ id: 2, title: 'DRAFT_ROW', is_published: false }),
    });
    vi.stubGlobal('fetch', mockFetch(200, [active, draft]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    // Default Active pill: active row visible, draft row hidden.
    expect(pageTextContains(target, 'ACTIVE_ROW')).toBe(true);
    expect(pageTextContains(target, 'DRAFT_ROW')).toBe(false);
    // Switch to Draft: draft row visible, active row hidden.
    buttonByText(target, /^Draft/)!.click();
    flushSync();
    expect(pageTextContains(target, 'ACTIVE_ROW')).toBe(false);
    expect(pageTextContains(target, 'DRAFT_ROW')).toBe(true);
    // Switch to All: both visible.
    buttonByText(target, /^All/)!.click();
    flushSync();
    expect(pageTextContains(target, 'ACTIVE_ROW')).toBe(true);
    expect(pageTextContains(target, 'DRAFT_ROW')).toBe(true);
  });

  it('an empty non-default pill says "No draft runs."', async () => {
    // Single active row; user clicks Draft → inline empty-filter copy + cross-counts.
    vi.stubGlobal('fetch', mockFetch(200, [row({})]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    buttonByText(target, /^Draft/)!.click();
    flushSync();
    expect(pageTextContains(target, 'No draft runs.')).toBe(true);
    expect(pageTextContains(target, /You have/)).toBe(false);
    expect(target.querySelector('tbody tr')).toBeNull();
  });

  // Polish 3 C18 (slice6a final): Back from a run restores the filter.
  it('the status pill is kept in ?status= and restored from it', async () => {
    const active = row({ run: makeRun({ id: 1, title: 'ACTIVE_ROW' }) });
    const draft = row({ run: makeRun({ id: 2, title: 'DRAFT_ROW', is_published: false }) });
    vi.stubGlobal('fetch', mockFetch(200, [active, draft]));
    await router.navigate('/teaching', { force: true });
    component = mount(TeacherRunListPage, { target });
    await settle();
    buttonByText(target, /^Draft/)!.click();
    flushSync();
    expect(pageTextContains(target, 'DRAFT_ROW')).toBe(true);
    await settle();
    expect(location.pathname + location.search).toBe('/teaching?status=draft');
    // Leave for a run and come Back: a fresh page reads the address.
    unmount(component); component = null;
    await router.navigate('/teaching/c/runs/2');
    const popped = new Promise((r) => window.addEventListener('popstate', r, { once: true }));
    history.back();
    await popped;
    await settle();
    expect(router.currentRoute.search).toBe('?status=draft');
    component = mount(TeacherRunListPage, { target });
    await settle();
    expect(buttonByText(target, /^Draft/)!.getAttribute('aria-pressed')).toBe('true');
    expect(pageTextContains(target, 'DRAFT_ROW')).toBe(true);
    expect(pageTextContains(target, 'ACTIVE_ROW')).toBe(false);
    // The default pill keeps a bare address; an unknown value reads as the default.
    buttonByText(target, /^Active/)!.click();
    await settle();
    expect(location.search).toBe('');
    await router.navigate('/teaching?status=bogus', { force: true });
    await settle();
    expect(buttonByText(target, /^Active/)!.getAttribute('aria-pressed')).toBe('true');
    await router.navigate('/', { force: true });
  });

  it('the run and course cells route in-app; a ⌘-click is left to the browser (C6)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({
      run: makeRun({ id: 42, title: 'Spring' }),
      course_slug: 'calc',
      course_name: 'Calculus',
    })]));
    history.replaceState(null, '', '/teaching');
    Object.assign(router.currentRoute, { path: '/teaching', search: '', hash: '' });
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    await expectRoutesInApp(linkByText(target, 'Spring')!, '/teaching/calc/runs/42');
    await expectRoutesInApp(linkByText(target, 'Calculus')!, '/teaching/calc');
  });

  it('mocked-fetch row uses the exact backend contract key set', () => {
    // Contract test (paired with backend test_teaching_runs_response_key_set):
    // the wire row shape MUST be exactly {run, course_id, course_name,
    // course_slug, student_count} — neither more nor fewer keys.
    const r = row({});
    expect(Object.keys(r).sort()).toEqual(
      ['course_id', 'course_name', 'course_slug', 'run', 'student_count'].sort(),
    );
  });

  it('h1 "Teaching"; columns Title, Course, Status, Students, Start, End', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({
      run: makeRun({ id: 42, title: 'Spring', start_date: '2020-01-01', end_date: '2099-12-31' }),
      course_name: 'Calc 101', course_slug: 'calc', student_count: 12,
    })]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    expect(target.querySelector('h1')?.textContent?.trim()).toBe('Teaching');
    expect(Array.from(target.querySelectorAll('thead th')).map((th) => th.textContent?.trim()))
      .toEqual(['Title', 'Course', 'Status', 'Students', 'Start', 'End']);
    const cells = Array.from(target.querySelectorAll('tbody tr:first-child td')).map((td) => td.textContent?.trim());
    expect(cells).toEqual(['Spring', 'Calc 101', 'active', '12', '01 Jan 2020', '31 Dec 2099']);
  });

  it('the Course column links to /teaching/:slug', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({ course_name: 'Calc 101', course_slug: 'calc' })]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    expect(linkByText(target, 'Calc 101')?.getAttribute('href')).toBe('/teaching/calc');
  });

  it('one link per row cell that links (no whole-row anchors)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({})]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    expect(target.querySelectorAll('tbody tr:first-child a')).toHaveLength(2);
  });
});

// ---- Polish 3 Task 7 — one loading look (D86) ----
describe('TeacherRunListPage (Polish 3 — loading)', () => {
  it('the first load shows the Skeleton', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    const sk = target.querySelector('.skeleton');
    expect(sk).not.toBeNull();
    expect(sk!.getAttribute('role')).toBe('status');
    expect(sk!.querySelectorAll('.row')).toHaveLength(3);
    expect(sk!.textContent).toContain('Loading runs…');
  });
});
