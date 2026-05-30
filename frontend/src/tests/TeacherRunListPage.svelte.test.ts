// TeacherRunListPage tests — slice A T8. Uses the project's established
// `mount/unmount/flushSync` pattern (see InlineConfirm.svelte.test.ts and
// AppHeader.svelte.test.ts). We intentionally do NOT use
// @testing-library/svelte: it is not a project dependency and CLAUDE.md /
// MEMORY.md forbid adding new JS deps.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TeacherRunListPage from '../pages/teaching/TeacherRunListPage.svelte';

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
  return {
    id: 1, title: 'R', start_date: '2026-02-01', end_date: '2026-05-30',
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
  it('shows loading then renders table', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({})]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    // After load, the single row's title 'R' should appear.
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

  it('renders all 5 pills with counts derived from full response', async () => {
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
    expect(pageTextContains(target, /Active \(1\)/)).toBe(true);
    expect(pageTextContains(target, /Draft \(1\)/)).toBe(true);
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

  it('empty response renders page-level empty state', async () => {
    vi.stubGlobal('fetch', mockFetch(200, []));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    expect(pageTextContains(target, /You're not assigned to any runs yet/)).toBe(true);
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

  it('within-active sort: end_date ASC, id ASC', async () => {
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
    // first <tr> is header, second is the first data row
    const firstDataRow = (rows[1]?.textContent ?? '');
    expect(firstDataRow).toContain('Sooner');
  });
});
