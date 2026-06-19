import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  currentCourse,
  clearCourse,
  loadCourse,
  markItemCovered,
  recordItemVisit,
  __test__setSlots,
} from '../stores/currentCourse.svelte';
import { ApiError } from '../lib/api';

// 12-tick microtask drainer — mirrors tests/RunDetailPage.svelte.test.ts:83-86.
// `api.get` internally chains await fetch → await response.json → return body,
// so the queued Promise.all in loadCourse needs several microtasks to fan out.
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

// Local typed deferred helper for ordered-resolution tests. We do NOT use
// `Promise.withResolvers()` — it's not in this project's TS lib types and
// would fail svelte-check. The `!` definite-assignment is the TS-idiomatic
// Promise-constructor-IIFE pattern; it's NOT a test assertion.
type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}

// Minimal `Response` shim — same shape as the `jres` helper used in
// RunDetailPage.publish.svelte.test.ts:13-20. `api.ts` only touches `ok`,
// `status`, `json()`, and `statusText`.
function jres(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    statusText: status === 500 ? 'Internal Server Error' : 'OK',
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response;
}

describe('stores/currentCourse', () => {
  beforeEach(() => {
    clearCourse();
  });

  it('starts as null', () => {
    expect(currentCourse.value).toBeNull();
  });

  it('clearCourse resets to null', () => {
    __test__setSlots({
      slug: 's',
      versionId: 1,
      course: { id: 1, slug: 's', name: 'T' },
      version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
      blocks: [],
      state: { version_id: 1, items: {} },
      miniProjectsByBlockId: {},
    });
    expect(currentCourse.value).not.toBeNull();
    clearCourse();
    expect(currentCourse.value).toBeNull();
  });

  it('markItemCovered mutates state.items[itemId].is_covered in place', () => {
    __test__setSlots({
      slug: 's',
      versionId: 1,
      course: { id: 1, slug: 's', name: 'T' },
      version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
      blocks: [],
      state: {
        version_id: 1,
        items: {
          '42': { is_covered: false, time_spent_seconds: 0, last_visited_at: null, last_answers: null, attempt_count: 0, score_correct: null, score_total: null },
        },
      },
      miniProjectsByBlockId: {},
    });
    markItemCovered(42);
    expect(currentCourse.value!.state.items['42'].is_covered).toBe(true);
  });

  it('recordItemVisit updates last_visited_at to now', () => {
    __test__setSlots({
      slug: 's',
      versionId: 1,
      course: { id: 1, slug: 's', name: 'T' },
      version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
      blocks: [],
      state: {
        version_id: 1,
        items: {
          '42': { is_covered: false, time_spent_seconds: 0, last_visited_at: null, last_answers: null, attempt_count: 0, score_correct: null, score_total: null },
        },
      },
      miniProjectsByBlockId: {},
    });
    recordItemVisit(42);
    expect(currentCourse.value!.state.items['42'].last_visited_at).not.toBeNull();
  });

  it('markItemCovered no-ops if itemId not in state.items', () => {
    __test__setSlots({
      slug: 's',
      versionId: 1,
      course: { id: 1, slug: 's', name: 'T' },
      version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
      blocks: [],
      state: { version_id: 1, items: {} },
      miniProjectsByBlockId: {},
    });
    expect(() => markItemCovered(999)).not.toThrow();
  });
});

// --- Fixtures shared across loadCourse tests ---

const MY_VERSION_FIXTURE = {
  course_slug: 'algebra',
  course_id: 1,
  version_id: 99,
  is_active: true,
};

const CONTENT_FIXTURE = {
  course: { name: 'Algebra', slug: 'algebra' },
  version: { id: 99, state: 'published' as const, info_html: '', max_quiz_attempts: 3 },
  blocks: [],
};

const STATE_FIXTURE = { version_id: 99, items: {} };

const MP_ITEM_FIXTURE = {
  mp_id: 7,
  block_id: 42,
  block_slug: 'final-project',
  block_order: 3,
  block_title: 'Final Project',
  hard_deadline: null,
  soft_deadline: null,
  resubmission_deadline: null,
  latest_status: 'not_submitted' as const,
};

describe('stores/currentCourse — loadCourse (E1)', () => {
  beforeEach(() => {
    clearCourse();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('happy path: populates miniProjectsByBlockId from the fetched map', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/my-version')) return Promise.resolve(jres(MY_VERSION_FIXTURE));
      if (url.includes('/content')) return Promise.resolve(jres(CONTENT_FIXTURE));
      if (url.includes('/state')) return Promise.resolve(jres(STATE_FIXTURE));
      if (url.includes('/mini-projects')) return Promise.resolve(jres([MP_ITEM_FIXTURE]));
      return Promise.reject(new Error('unexpected URL: ' + url));
    });
    vi.stubGlobal('fetch', fetchMock);

    await loadCourse('algebra');

    expect(currentCourse.value).not.toBeNull();
    expect(currentCourse.value?.miniProjectsByBlockId).toEqual({ '42': MP_ITEM_FIXTURE });

    // Exactly one call to the mini-projects endpoint with the URL-encoded slug.
    const mpCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/api/courses/algebra/mini-projects'),
    );
    expect(mpCalls).toHaveLength(1);
  });

  it('stale-write guard: a newer loadCourse aborts the prior controller; late A does not overwrite B', async () => {
    // Deferred handles per (slug, endpoint).
    const aMyVersion = defer<Response>();
    const aContent = defer<Response>();
    const aState = defer<Response>();
    const aMiniProjects = defer<Response>();
    const bMyVersion = defer<Response>();
    const bContent = defer<Response>();
    const bState = defer<Response>();
    const bMiniProjects = defer<Response>();

    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/api/courses/A/my-version')) return aMyVersion.promise;
      if (url.includes('/api/versions/100/content')) return aContent.promise;
      if (url.includes('/api/versions/100/state')) return aState.promise;
      if (url.includes('/api/courses/A/mini-projects')) return aMiniProjects.promise;
      if (url.includes('/api/courses/B/my-version')) return bMyVersion.promise;
      if (url.includes('/api/versions/200/content')) return bContent.promise;
      if (url.includes('/api/versions/200/state')) return bState.promise;
      if (url.includes('/api/courses/B/mini-projects')) return bMiniProjects.promise;
      return Promise.reject(new Error('unexpected URL: ' + url));
    });
    vi.stubGlobal('fetch', fetchMock);

    // Fire A — don't await.
    const aPromise = loadCourse('A');

    // Resolve A's /my-version FIRST so loadCourse advances past the sequential
    // await and queues the 3-element Promise.all.
    aMyVersion.resolve(jres({ ...MY_VERSION_FIXTURE, course_slug: 'A', version_id: 100 }));

    // Let the queued Promise.all fan out its 3 fetches.
    await settle();

    // Verify A's mini-projects fetch fired AND capture its RequestInit.signal.
    let mpCallIndex = fetchMock.mock.calls.findIndex((c) =>
      String(c[0]).includes('/api/courses/A/mini-projects'),
    );
    if (mpCallIndex === -1) {
      // Guard against jsdom microtask reordering: drain once more.
      await settle();
      mpCallIndex = fetchMock.mock.calls.findIndex((c) =>
        String(c[0]).includes('/api/courses/A/mini-projects'),
      );
    }
    expect(mpCallIndex).toBeGreaterThanOrEqual(0);

    const aInit = (fetchMock.mock.calls[mpCallIndex] as unknown[])[1] as RequestInit;
    const capturedSignal = aInit.signal;
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    // Fire B — this aborts A's controller and replaces the inflight slot.
    const bPromise = loadCourse('B');

    // Resolve all 4 of B's responses (/my-version first so loadCourse advances).
    bMyVersion.resolve(jres({ ...MY_VERSION_FIXTURE, course_slug: 'B', version_id: 200 }));
    await settle();
    bContent.resolve(jres({
      ...CONTENT_FIXTURE,
      course: { name: 'B Course', slug: 'B' },
      version: { ...CONTENT_FIXTURE.version, id: 200 },
    }));
    bState.resolve(jres({ version_id: 200, items: {} }));
    bMiniProjects.resolve(jres([]));

    await bPromise;
    expect(currentCourse.value).not.toBeNull();
    expect(currentCourse.value?.slug).toBe('B');

    // Capturing the signal confirms A's mini-projects fetch received the same
    // AbortController and that controller was aborted when B started — F17.
    expect(capturedSignal?.aborted).toBe(true);

    // Now resolve A's remaining responses LATE; A's promise must NOT overwrite B.
    aContent.resolve(jres({
      ...CONTENT_FIXTURE,
      course: { name: 'A Course', slug: 'A' },
      version: { ...CONTENT_FIXTURE.version, id: 100 },
    }));
    aState.resolve(jres({ version_id: 100, items: {} }));
    aMiniProjects.resolve(jres([MP_ITEM_FIXTURE]));

    await aPromise;
    expect(currentCourse.value?.slug).toBe('B');
  });

  it('F16: 5xx on /mini-projects rejects loadCourse and leaves snapshot null', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/my-version')) return Promise.resolve(jres(MY_VERSION_FIXTURE));
      if (url.includes('/content')) return Promise.resolve(jres(CONTENT_FIXTURE));
      if (url.includes('/state')) return Promise.resolve(jres(STATE_FIXTURE));
      if (url.includes('/mini-projects')) return Promise.resolve(jres({ detail: 'Server error' }, 500));
      return Promise.reject(new Error('unexpected URL: ' + url));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadCourse('algebra')).rejects.toBeInstanceOf(ApiError);
    expect(currentCourse.value).toBeNull();
  });

  it('F16: 403 on /mini-projects surfaces as empty map; loadCourse resolves successfully', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/my-version')) return Promise.resolve(jres(MY_VERSION_FIXTURE));
      if (url.includes('/content')) return Promise.resolve(jres(CONTENT_FIXTURE));
      if (url.includes('/state')) return Promise.resolve(jres(STATE_FIXTURE));
      if (url.includes('/mini-projects')) return Promise.resolve(jres({ detail: 'Forbidden' }, 403));
      return Promise.reject(new Error('unexpected URL: ' + url));
    });
    vi.stubGlobal('fetch', fetchMock);

    await loadCourse('algebra');

    expect(currentCourse.value).not.toBeNull();
    expect(currentCourse.value?.miniProjectsByBlockId).toEqual({});

    // URL-call assertion: without this the test passes vacuously against the
    // pre-E1 2-element Promise.all (which hardcoded `miniProjectsByBlockId: {}`
    // and never fired the request). Locks the F16/Phase C3 contract end-to-end.
    const mpCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/api/courses/algebra/mini-projects'),
    );
    expect(mpCalls).toHaveLength(1);
  });
});
