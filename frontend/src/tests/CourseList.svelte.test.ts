import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import CourseList from '../pages/CourseList.svelte';
import type { CourseListItem } from '../lib/types';

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve([]),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});

let target: HTMLDivElement | null = null;
let cmp: unknown = null;
afterEach(() => {
  if (cmp) { unmount(cmp); cmp = null; }
  if (target) { target.remove(); target = null; }
});

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

function courseStub(id: number, over: Partial<CourseListItem> = {}): CourseListItem {
  const isAdmin = over.is_admin ?? false;
  return {
    course: { id, slug: `c${id}`, name: `Course ${id}`, description: '', is_admin: isAdmin },
    version_id: id, version_state: 'published',
    covered_items: 0, total_items: 10, is_active: true, is_admin: isAdmin,
    ...over,
  };
}
function seed(rows: CourseListItem[]): HTMLDivElement {
  fetchSpy.mockResolvedValue({
    ok: true, status: 200,
    json: () => Promise.resolve(rows),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
  const host = document.createElement('div'); document.body.appendChild(host);
  target = host; cmp = mount(CourseList, { target: host });
  return host;
}

describe('CourseList header (mp-followup #2)', () => {
  it('renders the h1 heading and no inline user/logout cluster (AppHeader covers it globally)', async () => {
    target = document.createElement('div');
    document.body.appendChild(target);
    cmp = mount(CourseList, { target });
    await settle();

    const h1 = target.querySelector('h1');
    if (!h1) throw new Error('h1 not found');
    expect(h1.textContent).toBe('Your courses');

    expect(target.textContent ?? '').not.toContain('Sign out');
    expect(target.querySelector('.user')).toBeNull();
  });
});

describe('CourseCard §2b (rendered through CourseList)', () => {
  it('§2b pure-student: progress bar + mono count + honest footer, no nested anchor', async () => {
    const t = seed([courseStub(1, { covered_items: 14, total_items: 22 })]);
    await settle();
    const bar = t.querySelector('.bar-fill') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.width).toBe('64%');
    expect((t.querySelector('.count') as HTMLElement).textContent?.trim()).toBe('14/22 items');
    expect((t.querySelector('.footer-status') as HTMLElement).textContent?.trim()).toBe('Enrolled');
    expect(t.querySelectorAll('a a').length).toBe(0);              // no anchor nested in the card link
  });

  it('§2b pure-student empty + inactive: "No items" count + honest "Past enrolment" footer', async () => {
    const t = seed([courseStub(5, { total_items: 0, is_active: false })]);
    await settle();
    expect((t.querySelector('.count') as HTMLElement).textContent?.trim()).toBe('No items');
    expect((t.querySelector('.footer-status') as HTMLElement).textContent?.trim()).toBe('Past enrolment');
  });

  it('§2b pure-student: a barely-started huge course floors the bar to a visible 2% (not 0)', async () => {
    // 1/220 → 0.45% rounds to 0; without the floor the started course renders an empty bar.
    const t = seed([courseStub(6, { covered_items: 1, total_items: 220 })]);
    await settle();
    expect((t.querySelector('.bar-fill') as HTMLElement).style.width).toBe('2%');
    expect((t.querySelector('.count') as HTMLElement).textContent?.trim()).toBe('1/220 items');   // count stays honest
  });

  it('§2b mixed-admin (published): bar + ADMIN badge + Continue is a real anchor', async () => {
    const t = seed([courseStub(2, { is_admin: true, covered_items: 3, total_items: 12 })]);
    await settle();
    expect(t.querySelector('.bar-fill')).not.toBeNull();
    expect((t.querySelector('.badge-admin') as HTMLElement).textContent?.trim()).toBe('ADMIN');
    const cta = t.querySelector('.cta') as HTMLAnchorElement;
    expect(cta.tagName).toBe('A');
    expect(cta.getAttribute('href')).toBe('/courses/c2');
    expect(cta.textContent?.trim()).toBe('Continue →');
    expect(t.querySelector('.footer a[aria-label="Edit Course 2"]')).not.toBeNull();
  });

  it('§2b mixed-admin (draft): DRAFT badge + "Not started" when created & unstarted', async () => {
    const t = seed([courseStub(3, { is_admin: true, version_state: 'created', covered_items: 0, total_items: 8 })]);
    await settle();
    expect((t.querySelector('.badge-draft') as HTMLElement).textContent?.trim()).toBe('DRAFT');
    expect(t.querySelector('.badge-admin')).toBeNull();
    expect((t.querySelector('.count') as HTMLElement).textContent?.trim()).toBe('Not started');
    expect((t.querySelector('.cta') as HTMLElement).textContent?.trim()).toBe('Start →');
  });

  it('§2b admin-only (version_id null): no bar, ADMIN badge, honest "No active enrolment"', async () => {
    const t = seed([courseStub(4, { is_admin: true, version_id: null, version_state: null, total_items: 0, is_active: false })]);
    await settle();
    expect(t.querySelector('.bar')).toBeNull();
    expect(t.textContent).not.toContain('No published version');
    expect((t.querySelector('.hint') as HTMLElement).textContent?.trim()).toBe('No active enrolment');
    expect((t.querySelector('.badge-admin') as HTMLElement).textContent?.trim()).toBe('ADMIN');
    expect(t.querySelector('.footer a[href="/courses/c4/edit"]')).not.toBeNull();
  });
  it('the Runs link points to /teaching/:slug (6a D3)', async () => {
    const t = seed([courseStub(2, { is_admin: true })]);
    await settle();
    expect((t.querySelector('a[aria-label="Runs for Course 2"]') as HTMLAnchorElement).getAttribute('href')).toBe('/teaching/c2');
  });

});

describe('CourseList §2b header enrolled-count', () => {
  it('§2b: mono enrolled-count = current enrolments (excludes admin-only + past)', async () => {
    const t = seed([
      courseStub(1), courseStub(2), courseStub(3),
      courseStub(9, { is_admin: true, version_id: null, version_state: null, total_items: 0, is_active: false }),
      courseStub(8, { is_active: false }),   // past enrolment (has a version_id, but inactive)
      // admin-only but is_active:true — pins the `version_id !== null` clause independently:
      // dropping it would count this row and yield '4 enrolled'. (dropping `is_active` counts
      // row 8 → also '4', so both exclusion clauses are separately guarded.)
      courseStub(7, { is_admin: true, version_id: null, version_state: null, total_items: 0 }),
    ]);
    await settle();
    expect((t.querySelector('.enrolled') as HTMLElement).textContent?.trim()).toBe('3 enrolled');   // 3 current, not 6 rows
    expect(Array.from(t.querySelectorAll('.footer-status')).map((n) => n.textContent?.trim()))
      .toContain('Past enrolment');                                                                   // is_active:false footer
  });
});

describe('CourseList 9d states (Slice-4 T2)', () => {
  it('loading: renders the Skeleton (3 rows), not a spinner', () => {
    fetchSpy.mockReturnValue(new Promise(() => {}));   // never settles
    target = document.createElement('div'); document.body.appendChild(target);
    cmp = mount(CourseList, { target });
    flushSync();
    expect(target.querySelector('.skeleton')).not.toBeNull();
    expect(target.querySelectorAll('.skeleton .row').length).toBe(3);
    expect(target.querySelector('.spinner')).toBeNull();
  });

  it('empty: EmptyState carries the enrolment copy verbatim', async () => {
    const t = seed([]);
    await settle();
    const title = t.querySelector('.empty-state .title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe("You're not enrolled in any courses yet — ask your teacher for an invite.");
    expect(t.querySelector('.grid')).toBeNull();
  });

  it('error: inline ErrorState with the backend detail; Retry re-fetches with a clean error and shows the grid', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: false, status: 500,
        json: () => Promise.resolve({ detail: 'Database is asleep.' }),
        headers: new Headers({ 'content-type': 'application/json' }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve([courseStub(1)]),
        headers: new Headers({ 'content-type': 'application/json' }),
      } as unknown as Response);
    target = document.createElement('div'); document.body.appendChild(target);
    cmp = mount(CourseList, { target });
    await settle();

    const err = target.querySelector('.error-state.inline');
    expect(err).not.toBeNull();
    expect(err!.querySelector('.title')!.textContent).toBe("Couldn't load courses");
    expect(err!.querySelector('.message')!.textContent).toBe('Database is asleep.');
    const retry = err!.querySelector<HTMLButtonElement>('.btn');
    expect(retry).not.toBeNull();
    expect(retry!.textContent?.trim()).toBe('Retry');

    retry!.click();
    flushSync();
    // Retry re-enters the loading branch with the error cleared (enumerated (A)2).
    expect(target.querySelector('.skeleton')).not.toBeNull();
    expect(target.querySelector('.error-state')).toBeNull();
    await settle();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(target.querySelector('.error-state')).toBeNull();
    expect(target.querySelectorAll('.grid a').length).toBeGreaterThan(0);
  });
});
