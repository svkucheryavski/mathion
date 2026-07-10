import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as apiModule from '../lib/api';
import { ApiError } from '../lib/api';
import { loadVersionsPage, versionsPageState, resetVersionsPageState } from '../lib/versionsPageLoader.svelte';
import type { Course, Version } from '../lib/types';

const course = (slug: string, id: number): Course => ({
  id,
  slug,
  name: `Course ${slug}`,
  description: '',
  is_admin: true,
});

const version = (id: number, courseId: number): Version => ({
  id,
  course_id: courseId,
  state: 'created',
  is_disabled: false,
  info_md: '',
  info_html: '',
  max_quiz_attempts: 3,
  label: '',
  created_at: '',
  published_at: null,
  archived_at: null,
});

describe('versionsPageLoader', () => {
  beforeEach(() => resetVersionsPageState());
  afterEach(() => vi.restoreAllMocks());

  it('loads course + versions and stores them', async () => {
    vi.spyOn(apiModule.api, 'get').mockImplementation((path: string) => {
      if (path.endsWith('/by-slug/calc')) return Promise.resolve(course('calc', 1)) as unknown as Promise<unknown>;
      if (path === '/api/courses/1/versions') return Promise.resolve([version(10, 1)]) as unknown as Promise<unknown>;
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });
    await loadVersionsPage('calc');
    expect(versionsPageState.course?.slug).toBe('calc');
    expect(versionsPageState.versions.map((v) => v.id)).toEqual([10]);
    expect(versionsPageState.loading).toBe(false);
    expect(versionsPageState.error).toBe(null);
  });

  // Core C-1 repro: a slow load for slug 'a' must not clobber a fast load for
  // slug 'b' that landed first. Mocks are matched in CALL order; both loads
  // start in parallel so calls 1+2 fire concurrently for both A's first GET
  // and B's first GET. We dispatch on the URL to keep the wiring obvious.
  it('stale-guard: slow response for an older slug does not overwrite', async () => {
    let resolveCourseA!: (v: Course) => void;
    const slowCourseA = new Promise<Course>((r) => { resolveCourseA = r; });

    vi.spyOn(apiModule.api, 'get').mockImplementation((path: string) => {
      if (path.endsWith('/by-slug/a')) return slowCourseA as unknown as Promise<unknown>;
      if (path.endsWith('/by-slug/b')) return Promise.resolve(course('b', 2)) as unknown as Promise<unknown>;
      if (path === '/api/courses/2/versions') return Promise.resolve([version(20, 2)]) as unknown as Promise<unknown>;
      if (path === '/api/courses/1/versions') return Promise.resolve([version(99, 1)]) as unknown as Promise<unknown>;
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });

    const pA = loadVersionsPage('a');
    const pB = loadVersionsPage('b');
    await pB;
    expect(versionsPageState.course?.slug).toBe('b');
    expect(versionsPageState.versions.map((v) => v.id)).toEqual([20]);

    // Now let the stale 'a' load resolve and verify it does NOT overwrite 'b'.
    resolveCourseA(course('a', 1));
    await pA;

    expect(versionsPageState.course?.slug).toBe('b');
    expect(versionsPageState.versions.map((v) => v.id)).toEqual([20]);
    // loading must be false. Without the stale-guard on `finally`, a stale
    // generation's finally clobbering loading=false at the wrong moment would
    // leave a follow-up load's spinner stuck.
    expect(versionsPageState.loading).toBe(false);
    expect(versionsPageState.error).toBe(null);
  });

  it('stale-guard: stale error does not overwrite a successful newer load', async () => {
    let rejectA!: (e: unknown) => void;
    const slowA = new Promise<Course>((_r, rj) => { rejectA = rj; });
    vi.spyOn(apiModule.api, 'get').mockImplementation((path: string) => {
      if (path.endsWith('/by-slug/a')) return slowA as unknown as Promise<unknown>;
      if (path.endsWith('/by-slug/b')) return Promise.resolve(course('b', 2)) as unknown as Promise<unknown>;
      if (path === '/api/courses/2/versions') return Promise.resolve([version(20, 2)]) as unknown as Promise<unknown>;
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });

    const pA = loadVersionsPage('a');
    const pB = loadVersionsPage('b');
    await pB;
    expect(versionsPageState.course?.slug).toBe('b');

    rejectA(new ApiError(500, 'boom'));
    await pA;
    // Stale error must not overwrite the fresh course/versions or set error.
    expect(versionsPageState.course?.slug).toBe('b');
    expect(versionsPageState.error).toBe(null);
    expect(versionsPageState.loading).toBe(false);
  });

  it('error path: ApiError uses displayMessage; non-ApiError uses generic', async () => {
    vi.spyOn(apiModule.api, 'get').mockRejectedValueOnce(new ApiError(404, 'no such'));
    await loadVersionsPage('x');
    expect(versionsPageState.error).toEqual({ status: 404, message: 'no such' });
    expect(versionsPageState.loading).toBe(false);

    resetVersionsPageState();
    vi.spyOn(apiModule.api, 'get').mockRejectedValueOnce(new Error('network'));
    await loadVersionsPage('y');
    expect(versionsPageState.error?.message).toBe('Could not load.');
  });
});
