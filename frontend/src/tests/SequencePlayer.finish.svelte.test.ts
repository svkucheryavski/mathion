import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// The Finish-nav assertion observes the ROUTE path, which navigate() only
// commits after `await runGuards()` — flushSync flushes Svelte's effect queue,
// not the JS microtask queue, so a post-click read would race. Partial-mock
// the router (keeping the real `currentRoute` for the seed) and assert
// `vi.mocked(navigate)`. This MUST be its own file: `vi.mock` is
// module-hoisted and file-wide, and the main SequencePlayer recipes depend on
// the REAL navigate.
vi.mock('../lib/router.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/router.svelte')>();
  return { ...real, navigate: vi.fn() };
});

vi.mock('../stores/currentCourse.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../stores/currentCourse.svelte')>();
  return { ...real, loadCourse: vi.fn().mockResolvedValue(undefined) };
});

import { __test__setSlots } from '../stores/currentCourse.svelte';
import { currentRoute, navigate } from '../lib/router.svelte';
import SequencePlayer from '../pages/SequencePlayer.svelte';
import type { Item } from '../lib/types';

const SLUG = 'algebra';

function page(id: number, seqId: number, title: string): Item {
  return {
    id,
    sequence_id: seqId,
    title,
    slug: `s-${id}`,
    order: 1,
    type: 'static_page',
    content_md: '',
    content_html: '<p>body</p>',
  };
}

function seed(): void {
  __test__setSlots({
    slug: SLUG,
    versionId: 1,
    course: { id: 1, slug: SLUG, name: 'Linear Algebra' },
    version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
    blocks: [
      {
        id: 10,
        title: 'Vectors',
        slug: 'vectors',
        order: 1,
        info: '',
        info_html: '',
        sequences: [
          { id: 100, title: 'What a vector is', slug: 'what', order: 1, items: [page(1001, 100, 'Intro to vectors'), page(1002, 100, 'Vector notation')] },
          { id: 200, title: 'Vector operations', slug: 'ops', order: 2, items: [page(1003, 200, 'Adding vectors')] },
        ],
      },
    ],
    state: { version_id: 1, items: {} },
    miniProjectsByBlockId: {},
  });
}

function seedRoute(seqId: number, hash: string): void {
  history.replaceState(null, '', `/courses/${SLUG}/seq/${seqId}`);
  currentRoute.path = `/courses/${SLUG}/seq/${seqId}`;
  currentRoute.search = '';
  currentRoute.hash = hash;
}

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
  __test__setSlots(null);
  currentRoute.hash = '';
  vi.mocked(navigate).mockClear();
});

describe('SequencePlayer Finish (T1 / D4)', () => {
  it('renders "Finish sequence" at the course-flat end and navigates to the course', () => {
    seed();
    seedRoute(200, '#item=1003'); // i3 — the last course-flat item, in seq s200
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(SequencePlayer, { target: host, props: { courseSlug: SLUG, sequenceId: '200' } });
    flushSync();

    const primary = host.querySelector('footer button[data-variant="primary"]') as HTMLButtonElement;
    expect(primary).not.toBeNull();
    expect(primary.textContent).toContain('Finish sequence');
    expect(primary.disabled).toBe(false);

    primary.click();
    flushSync();

    expect(vi.mocked(navigate)).toHaveBeenLastCalledWith(`/courses/${SLUG}`);
  });
});
