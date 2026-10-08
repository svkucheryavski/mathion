import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// Mock the currentCourse store wrapper. Keep the real `currentCourse`
// reactive store + `__test__setSlots` so the test can drive the store with
// fixture data; stub only `loadCourse` to skip the network fan-out (the page
// fires it on mount inside an $effect — without this stub the page stays in
// the loading branch and never renders the BlockGroup tree).
vi.mock('../stores/currentCourse.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../stores/currentCourse.svelte')>();
  return {
    ...real,
    loadCourse: vi.fn().mockResolvedValue(undefined),
  };
});

import { __test__setSlots, loadCourse, markItemCovered } from '../stores/currentCourse.svelte';
import { ApiError } from '../lib/api';
import CourseView from '../pages/CourseView.svelte';
import type { StudentMiniProjectListItem } from '../lib/types';

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  __test__setSlots(null);
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (target.parentNode) target.parentNode.removeChild(target);
  __test__setSlots(null);
});

// 12-tick settle: CourseView fires loadCourse() inside an $effect, then waits
// for the .catch(...).finally(() => { loading = false; }) chain — a multi-tick
// promise chain. A bare `await Promise.resolve()` would leave `loading=true`
// and the page would render the Skeleton branch without the BlockGroup tree.
// Copied verbatim from tests/RunDetailPage.svelte.test.ts:83-86.
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

describe('CourseView — mpByBlockId pass-through to BlockGroup (E2)', () => {
  it('renders MiniProjectLink for the block when the snapshot has a matching mp item', async () => {
    const mpItem: StudentMiniProjectListItem = {
      mp_id: 7,
      block_id: 42,
      block_slug: 'intro',
      block_order: 0,
      block_title: 'Intro Project',
      hard_deadline: null,
      soft_deadline: null,
      resubmission_deadline: null,
      latest_status: 'not_submitted',
    };

    __test__setSlots({
      slug: 'course-x',
      versionId: 1,
      course: { id: 1, slug: 'course-x', name: 'Course X' },
      version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
      blocks: [
        {
          id: 42,
          title: 'Intro',
          slug: 'intro',
          order: 1,
          info: '',
          info_html: '',
          sequences: [],
        },
      ],
      state: { version_id: 1, items: {} },
      miniProjectsByBlockId: { '42': mpItem },
    });

    component = mount(CourseView, {
      target,
      props: { courseSlug: 'course-x' },
    });
    await settle();
    flushSync();

    const link = target.querySelector<HTMLAnchorElement>(
      'a[href="/courses/course-x/blocks/intro/mini-project"]',
    );
    if (!link) throw new Error('expected MiniProjectLink anchor to be present');
    expect(link.textContent).toContain('Intro Project');
    // ...and actually VISIBLE. Before T8a a collapsed BlockGroup removed this
    // anchor from the DOM outright, so finding it proved it was showing. T8a
    // renders the panel in BOTH states and hides it with `hidden`, and both
    // `querySelector` and `textContent` read straight through that — so presence
    // alone can no longer tell "visible" from "permanently hidden". Nothing is
    // unguarded (BlockGroup's own test pins `panel.hidden`), but an assertion
    // that READS as a visibility check and is not one is worse than none, so it
    // is strengthened here rather than left to look like something it isn't.
    // Since 2026-10-08 a block with no items starts collapsed (only the first
    // unfinished block opens on load), so open it the way a student would.
    const region = link.closest('[role="region"]') as HTMLElement | null;
    expect(region).not.toBeNull();
    expect(region!.hidden).toBe(true);
    (target.querySelector('.all-toggle button') as HTMLButtonElement).click();
    flushSync();
    expect(region!.hidden).toBe(false);
  });
});

// User, 2026-10-08: the round back button (as on the admin versions page) and a
// course-wide progress summary beside the info text.
describe('CourseView header and course summary', () => {
  const it2 = (id: number, type: 'static_page' | 'quiz') =>
    ({ id, title: `I${id}`, slug: `i${id}`, order: id, type }) as never;
  const entry = (covered: boolean, score: [number, number] | null) => ({
    is_covered: covered, time_spent: 0, last_visited_at: null, attempt_count: score ? 1 : 0,
    max_attempts: 3, last_score: score ? { correct: score[0], total: score[1] } : null, last_answers: null,
  });
  function seedCourse(blocks: unknown[], items: Record<string, unknown>, info_html = '<p>Hello</p>') {
    __test__setSlots({
      slug: 'course-x', versionId: 1,
      course: { id: 1, slug: 'course-x', name: 'Course X' },
      version: { id: 1, state: 'published', info_html, max_quiz_attempts: 3 },
      blocks: blocks as never, state: { version_id: 1, items: items as never }, miniProjectsByBlockId: {},
    });
  }
  const twoBlocks = [
    { id: 1, title: 'A', slug: 'a', order: 1, info: '', info_html: '',
      sequences: [{ id: 11, title: 'S', slug: 's', order: 1, items: [it2(1, 'static_page'), it2(2, 'quiz')] }] },
    { id: 2, title: 'B', slug: 'b', order: 2, info: '', info_html: '',
      sequences: [{ id: 21, title: 'T', slug: 't', order: 1, items: [it2(3, 'quiz'), it2(4, 'static_page')] }] },
  ];

  it('the way back is the round back button, not a "← Courses" text link', async () => {
    seedCourse(twoBlocks, {});
    component = mount(CourseView, { target, props: { courseSlug: 'course-x' } });
    await settle();
    const back = target.querySelector('header button.icon-btn.round[data-glyph="back"]') as HTMLButtonElement;
    expect(back).not.toBeNull();
    expect(back.getAttribute('aria-label')).toBe('Back to courses');
    expect(target.querySelector('header')!.textContent).not.toContain('Courses');
  });

  it('summarises the WHOLE course beside the info: items over every block, quiz score over the quizzes tried', async () => {
    // 2 of 4 items → 50%; quizzes (3 + 1) / (4 + 4) = 50%.
    seedCourse(twoBlocks, { '1': entry(true, null), '2': entry(true, [3, 4]), '3': entry(false, [1, 4]) });
    component = mount(CourseView, { target, props: { courseSlug: 'course-x' } });
    await settle();
    const top = target.querySelector('.top') as HTMLElement;
    expect(Array.from(top.children).map((e) => e.className.split(' ')[0])).toEqual(['info', 'summary']);
    const sum = top.querySelector('.summary') as HTMLElement;
    expect((sum.querySelector('.sp') as HTMLElement).textContent).toBe('50%');
    expect((sum.querySelector('.fill') as HTMLElement).style.width).toBe('50%');
    expect((sum.querySelector('.sq') as HTMLElement).textContent!.replace(/\s+/g, ' ').trim()).toBe('Quiz score 50%');
    expect(sum.querySelector('.sq svg polyline')).not.toBeNull();
    // The figures are aria-hidden; one sentence states them for screen readers.
    expect((sum.querySelector('.sr-only') as HTMLElement).textContent)
      .toBe('Your progress: 2 of 4 items completed, quiz score 50%.');
  });

  it('no info text: the summary still shows, alone at the top', async () => {
    seedCourse(twoBlocks, {}, '');
    component = mount(CourseView, { target, props: { courseSlug: 'course-x' } });
    await settle();
    const top = target.querySelector('.top') as HTMLElement;
    expect(Array.from(top.children).map((e) => e.className.split(' ')[0])).toEqual(['summary']);
    expect((top.querySelector('.sq') as HTMLElement).textContent!.replace(/\s+/g, ' ').trim()).toBe('Quiz score –');
    // No check mark beside a dash: the row chip's "Quiz –" carries none either.
    expect(top.querySelector('.sq svg')).toBeNull();
  });

  it('a course with no quizzes shows no quiz line', async () => {
    seedCourse([{ ...twoBlocks[0], sequences: [{ id: 11, title: 'S', slug: 's', order: 1, items: [it2(1, 'static_page')] }] }], {});
    component = mount(CourseView, { target, props: { courseSlug: 'course-x' } });
    await settle();
    expect(target.querySelector('.summary .sq')).toBeNull();
    expect((target.querySelector('.summary .sr-only') as HTMLElement).textContent).toBe('Your progress: 0 of 1 item completed.');
  });

  it('no blocks: no summary (nothing to measure)', async () => {
    seedCourse([], {});
    component = mount(CourseView, { target, props: { courseSlug: 'course-x' } });
    await settle();
    expect(target.querySelector('.summary')).toBeNull();
  });

  // Collapse/expand all + the current block (user, 2026-10-08): with every block
  // open the page read too busy, so only the first unfinished block opens on
  // load and one small button closes or opens them all.
  const panels = () =>
    Array.from(target.querySelectorAll('section.block [role="region"]')).map((e) => !(e as HTMLElement).hidden);
  const toggle = () => target.querySelector('.all-toggle button') as HTMLButtonElement;
  const header = (i: number) => target.querySelectorAll('section.block button.acc')[i] as HTMLButtonElement;
  async function mountWith(items: Record<string, unknown>) {
    seedCourse(twoBlocks, items);
    component = mount(CourseView, { target, props: { courseSlug: 'course-x' } });
    await settle();
  }

  it('opens only the first unfinished block on load', async () => {
    await mountWith({ '1': entry(true, null), '2': entry(true, [3, 4]) }); // block 1 done
    expect(panels()).toEqual([false, true]);
    expect(toggle().textContent!.trim()).toBe('Collapse all');
  });

  it('every block finished: all start collapsed and the button offers "Expand all"', async () => {
    await mountWith({ '1': entry(true, null), '2': entry(true, [3, 4]), '3': entry(true, [1, 4]), '4': entry(true, null) });
    expect(panels()).toEqual([false, false]);
    expect(toggle().textContent!.trim()).toBe('Expand all');
  });

  it('"Collapse all" closes every block, then "Expand all" opens every block', async () => {
    await mountWith({});
    expect(panels()).toEqual([true, false]);
    toggle().click();
    flushSync();
    expect(panels()).toEqual([false, false]);
    expect(toggle().textContent!.trim()).toBe('Expand all');
    toggle().click();
    flushSync();
    expect(panels()).toEqual([true, true]);
    expect(toggle().textContent!.trim()).toBe('Collapse all');
  });

  it('a header still toggles its own block, and the button label follows', async () => {
    await mountWith({});
    header(0).click();
    flushSync();
    expect(panels()).toEqual([false, false]);
    expect(toggle().textContent!.trim()).toBe('Expand all');
    header(1).click();
    flushSync();
    expect(panels()).toEqual([false, true]);
    expect(toggle().textContent!.trim()).toBe('Collapse all');
  });

  it('the default is applied ONCE per load: progress made afterwards never re-opens or closes a block', async () => {
    // Block 1 is current on load. The student closes it, then finishes it (the
    // player marks items covered in the store). Re-applying the default would
    // now open block 2; the open set must stay exactly as the student left it.
    await mountWith({ '1': entry(false, null), '2': entry(false, null) });
    expect(panels()).toEqual([true, false]);
    header(0).click();
    flushSync();
    markItemCovered(1);
    markItemCovered(2);
    flushSync();
    expect(panels()).toEqual([false, false]);
    // ...while the meters DO follow the progress.
    expect((target.querySelector('section.block .acc .pct') as HTMLElement).textContent).toBe('100%');
  });

  it('no blocks: no collapse/expand button', async () => {
    seedCourse([], {});
    component = mount(CourseView, { target, props: { courseSlug: 'course-x' } });
    await settle();
    expect(target.querySelector('.all-toggle')).toBeNull();
  });
});

describe('CourseView 9d states (Slice-4 T2)', () => {
  it('loading: Skeleton with 4 rows while loadCourse is in flight', () => {
    vi.mocked(loadCourse).mockReturnValueOnce(new Promise<void>(() => {}));
    component = mount(CourseView, { target, props: { courseSlug: 'course-x' } });
    flushSync();
    expect(target.querySelector('.skeleton')).not.toBeNull();
    expect(target.querySelectorAll('.skeleton .row').length).toBe(4);
  });

  it('empty: EmptyState under the course header when there are no blocks', async () => {
    __test__setSlots({
      slug: 'course-x', versionId: 1,
      course: { id: 1, slug: 'course-x', name: 'Course X' },
      version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
      blocks: [], state: { version_id: 1, items: {} }, miniProjectsByBlockId: {},
    });
    component = mount(CourseView, { target, props: { courseSlug: 'course-x' } });
    await settle();
    expect(target.querySelector('h1')!.textContent).toBe('Course X');
    expect(target.querySelector('.empty-state .title')!.textContent).toBe('This course has no published blocks yet.');
  });

  it.each([
    [404, 'Course not available', "This course isn't available to you. Ask your teacher for an invite link, or check the URL."],
    [403, 'Access denied', "You don't have access to this course."],
    [500, "Couldn't load course", 'Server exploded.'],
  ])('error %i: page ErrorState keeps the <h1> (D9) and the Back action', async (status, title, message) => {
    vi.mocked(loadCourse).mockRejectedValueOnce(new ApiError(status, 'Server exploded.'));
    component = mount(CourseView, { target, props: { courseSlug: 'course-x' } });
    await settle();
    const err = target.querySelector('.error-state.page');
    expect(err).not.toBeNull();
    const h1 = err!.querySelector('h1.title');
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toBe(title);
    expect(err!.querySelector('.message')!.textContent).toBe(message);
    const back = err!.querySelector<HTMLButtonElement>('.action .btn');
    expect(back!.textContent?.trim()).toBe('Back to courses');
    expect(back!.classList.contains('secondary')).toBe(true);
  });
});
