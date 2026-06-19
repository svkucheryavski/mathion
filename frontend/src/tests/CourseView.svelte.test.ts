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

import { __test__setSlots } from '../stores/currentCourse.svelte';
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
// and the page would render the Spinner branch without the BlockGroup tree.
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
  });
});
