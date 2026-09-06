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

import { __test__setSlots, loadCourse } from '../stores/currentCourse.svelte';
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
    const region = link.closest('[role="region"]') as HTMLElement | null;
    expect(region).not.toBeNull();
    expect(region!.hidden).toBe(false);
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
