// TeacherRunListPage tests — slice A T8. Uses the project's established
// `mount/unmount/flushSync` pattern (see InlineConfirm.svelte.test.ts and
// AppHeader.svelte.test.ts). We intentionally do NOT use
// @testing-library/svelte: it is not a project dependency and CLAUDE.md /
// MEMORY.md forbid adding new JS deps.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TeacherRunListPage from '../pages/teaching/TeacherRunListPage.svelte';
import * as router from '../lib/router.svelte';
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
});

describe('TeacherRunListPage', () => {
  it('shows loading state before fetch resolves, then renders table', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({})]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    // BEFORE settle: loading branch should be visible (the fetch promise
    // has not resolved yet). This locks the `{#if loading} <LoadingPlaceholder/>`
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
    expect(buttonByText(target, /^Ended \(0\)$/)).not.toBeNull();
    expect(buttonByText(target, /^Draft \(1\)$/)).not.toBeNull();
    expect(buttonByText(target, /^All \(2\)$/)).not.toBeNull();
    // Switch to Draft pill; counts must remain stable (not recomputed from
    // the visible bucket). Spec §6.2 bullet: counts derived from full response.
    buttonByText(target, /^Draft \(1\)$/)!.click();
    flushSync();
    expect(buttonByText(target, /^Active \(1\)$/)).not.toBeNull();
    expect(buttonByText(target, /^Upcoming \(0\)$/)).not.toBeNull();
    expect(buttonByText(target, /^Ended \(0\)$/)).not.toBeNull();
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
    expect(pageTextContains(target, /You're not assigned to any runs yet/)).toBe(true);
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

  it('cell-anchor href points to /courses/:slug/runs/:rid', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({
      run: makeRun({ id: 42, title: 'Spring' }),
      course_slug: 'calc',
    })]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    const link = linkByText(target, 'Spring');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/courses/calc/runs/42');
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
    buttonByText(target, /^Ended/)!.click();
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

  it('Status column renders title-cased badge label', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({})]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    // The badge span has class badge-active and text "Active" (title-cased).
    const badge = target.querySelector('span.badge-active');
    expect(badge).not.toBeNull();
    expect((badge?.textContent ?? '').trim()).toBe('Active');
  });

  it('with 0 active + other groups non-empty, default pill stays Active and shows cross-counts', async () => {
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
    // Cross-counts message visible.
    expect(pageTextContains(target, /No Active runs\./)).toBe(true);
    expect(pageTextContains(target, /0 active/)).toBe(true);
    expect(pageTextContains(target, /1 ended/)).toBe(true);
    expect(pageTextContains(target, /1 draft/)).toBe(true);
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

  it('switching to a non-default empty pill renders inline empty-filter with cross-counts', async () => {
    // Single active row; user clicks Draft → inline empty-filter copy + cross-counts.
    vi.stubGlobal('fetch', mockFetch(200, [row({})]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    buttonByText(target, /^Draft/)!.click();
    flushSync();
    expect(pageTextContains(target, /No Draft runs\./)).toBe(true);
    expect(pageTextContains(target, /1 active/)).toBe(true);
    expect(pageTextContains(target, /0 upcoming/)).toBe(true);
    expect(pageTextContains(target, /0 ended/)).toBe(true);
    expect(pageTextContains(target, /0 draft/)).toBe(true);
    expect(target.querySelector('tbody tr')).toBeNull();
  });

  it('cell-anchor click calls navigate with the run URL and prevents default', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({
      run: makeRun({ id: 42, title: 'Spring' }),
      course_slug: 'calc',
    })]));
    const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve());
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    const link = linkByText(target, 'Spring');
    expect(link).not.toBeNull();
    // Dispatch a cancelable click event so we can observe defaultPrevented.
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    link!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(navSpy).toHaveBeenCalledWith('/courses/calc/runs/42');
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
});
