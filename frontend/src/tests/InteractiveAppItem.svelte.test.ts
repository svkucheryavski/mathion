import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InteractiveAppItem from '../components/items/InteractiveAppItem.svelte';
import { __test__setSlots, currentCourse } from '../stores/currentCourse.svelte';
import type { InteractiveAppItem as IAItem } from '../lib/types';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;

function tres(text: string, status = 200) {
  return Promise.resolve({ ok: status < 400, status, statusText: 'x', text: () => Promise.resolve(text) } as unknown as Response);
}
function jres(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body), headers: new Headers({ 'content-type': 'application/json' }) } as unknown as Response);
}
// Branch by URL so both the source fetch and the coverage POST settle.
function routed(sourceOrStatus: string | number = "getElementById('app-root')") {
  return (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes('/assets/')) return typeof sourceOrStatus === 'number' ? tres('', sourceOrStatus) : tres(sourceOrStatus);
    if (u.includes('/track')) return jres({ item_id: 7, is_covered: true, time_spent: 0 });
    return jres({});
  };
}
// 12 microtask drains suffice ONLY because lib/api is module-warm: this file
// statically imports __test__setSlots from currentCourse.svelte, which imports
// lib/api, so the tracker's `await import('./api')` resolves without a macrotask.
// The added fetchAssetSource fetch→text() hops still settle within 12. Do NOT
// drop the currentCourse import to "clean up".
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

const appItem = (over: Partial<IAItem> = {}): IAItem => ({
  id: 7, sequence_id: 3, title: 'Sandbox', slug: 'sandbox', order: 1,
  type: 'interactive_app', script_url: 'app.js', ...over,
});

function seedCourse() {
  __test__setSlots({
    slug: 'c', versionId: 5,
    course: { id: 1, slug: 'c', name: 'C' },
    version: { id: 5 } as never,
    blocks: [],
    state: { version_id: 5, current_item_id: null, items: { '7': { is_covered: false, time_spent_seconds: 0, last_visited_at: null, last_answers: null, attempt_count: 0, score_correct: null, score_total: null } } } as never,
    miniProjectsByBlockId: {},
  });
}

let cleanup: (() => void) | null = null;
beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(routed());
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  seedCourse();
});
afterEach(() => {
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  __test__setSlots(null);
});

function mountItem(props: { item: IAItem; isCovered: boolean }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const sprops = $state(props);
  const cmp = mount(InteractiveAppItem, { target, props: sprops });
  cleanup = () => unmount(cmp);
  flushSync();
  return target;
}
const trackCalls = () => fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/api/items/7/track'));

it('fetches the source, renders the frame, and auto-covers once on success', async () => {
  const target = mountItem({ item: appItem(), isCovered: false });
  await settle();
  const f = target.querySelector('iframe');
  expect(f).not.toBeNull();
  expect(f?.getAttribute('srcdoc')).toContain("getElementById('app-root')");
  expect(trackCalls().length).toBe(1);
  expect(JSON.parse((trackCalls()[0][1] as RequestInit).body as string).is_covered).toBe(true);
});

it('does NOT cover when already covered', async () => {
  mountItem({ item: appItem(), isCovered: true });
  await settle();
  expect(trackCalls().length).toBe(0);
});

it('shows "couldn\'t be loaded" and does NOT cover on fetch failure', async () => {
  fetchSpy.mockImplementation(routed(404));
  const target = mountItem({ item: appItem(), isCovered: false });
  await settle();
  expect(target.querySelector('iframe')).toBeNull();
  expect(target.textContent).toContain("couldn't be loaded");
  expect(trackCalls().length).toBe(0);
});

it('shows "No app uploaded yet." and does NOT cover when script_url is null', async () => {
  const target = mountItem({ item: appItem({ script_url: null }), isCovered: false });
  await settle();
  expect(target.querySelector('iframe')).toBeNull();
  expect(target.textContent).toContain('No app uploaded yet.');
  expect(trackCalls().length).toBe(0);
});

it('a late fetch after unmount neither starts a tracker nor covers (stale guard)', async () => {
  let resolveSrc: (v: Response) => void = () => {};
  fetchSpy.mockImplementation((input: RequestInfo | URL) => {
    if (String(input).includes('/assets/')) return new Promise<Response>((r) => { resolveSrc = r; });
    if (String(input).includes('/track')) return jres({});
    return jres({});
  });
  const target = mountItem({ item: appItem(), isCovered: false });
  flushSync();
  cleanup?.(); cleanup = null;            // unmount BEFORE the source resolves
  resolveSrc({ ok: true, status: 200, statusText: 'x', text: () => Promise.resolve("app-root") } as unknown as Response);
  await settle();
  expect(trackCalls().length).toBe(0);    // stale guard: no cover after teardown
  void target;
});

it('a /track that resolves after unmount does NOT flip is_covered in the store (post-teardown write guard)', async () => {
  let resolveTrack: (v: Response) => void = () => {};
  fetchSpy.mockImplementation((input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes('/assets/')) return tres("app-root");           // source resolves eagerly
    if (u.includes('/track')) return new Promise<Response>((r) => { resolveTrack = r; });
    return jres({});
  });
  const target = mountItem({ item: appItem(), isCovered: false });
  await settle();                          // source resolves → markCovered()/track POST fires (pending)
  expect(trackCalls().length).toBe(1);     // sanity: the /track POST was issued while mounted
  expect(currentCourse.value?.state.items['7'].is_covered).toBe(false);

  cleanup?.(); cleanup = null;             // UNMOUNT before the deferred /track resolves
  resolveTrack({ ok: true, status: 200, json: () => Promise.resolve({ item_id: 7, is_covered: true, time_spent: 0 }) } as unknown as Response);
  await settle();                          // let the .then(markItemCovered) continuation run

  // Post-teardown store write guard: the resolved /track must NOT flip coverage.
  expect(currentCourse.value?.state.items['7'].is_covered).toBe(false);
  void target;
});

// --- T5: the ready-only coverage hint (enumerated (B)16) --------------------
// Ref 10h/1047 shows this line, and it describes real behaviour: coverage is
// credited in the fetch-success continuation. It is rendered in the READY state
// only — a "marked covered once opened" promise shown beside "couldn't be
// loaded" would be a lie, which is why each failure branch asserts its absence
// rather than relying on one positive case.
it('renders the cover hint in the ready state', async () => {
  const target = mountItem({ item: appItem(), isCovered: false });
  await settle();
  const hint = target.querySelector('.cover-hint');
  expect(hint).not.toBeNull();
  expect(hint?.tagName).toBe('P');
  expect(hint?.textContent).toBe('Marked covered once opened.');
});

it('does NOT render the cover hint on fetch failure', async () => {
  fetchSpy.mockImplementation(routed(404));
  const target = mountItem({ item: appItem(), isCovered: false });
  await settle();
  expect(target.textContent).toContain("couldn't be loaded");
  expect(target.querySelector('.cover-hint')).toBeNull();
});

it('does NOT render the cover hint when no app is uploaded', async () => {
  const target = mountItem({ item: appItem({ script_url: null }), isCovered: false });
  await settle();
  expect(target.textContent).toContain('No app uploaded yet.');
  expect(target.querySelector('.cover-hint')).toBeNull();
});

it('does NOT render the cover hint while still loading', () => {
  // No settle(): the source fetch is still in flight, so status is neither
  // ready nor a failure branch. flushSync() alone renders the initial state.
  const target = mountItem({ item: appItem(), isCovered: false });
  expect(target.querySelector('iframe')).toBeNull();
  expect(target.querySelector('.cover-hint')).toBeNull();
});

it('puts the fetch-failure copy inside .notice (the class the gate anchors on)', async () => {
  // Structural presence ONLY. This test used to assert
  // `getComputedStyle(notice).fontStyle !== 'italic'`, which was vacuous:
  // vite.config.ts sets no `css: true` for the test environment, so a
  // component's <style> never reaches jsdom — re-adding `font-style: italic`
  // to `.notice` left all of these green. Same trap the repo documents at
  // MiniProjectModal.create-edit.svelte.test.ts:548-551. The dropped italic is
  // guarded where it IS observable — in the built CSS, by the slice's per-task
  // dist gate (spec:197, T5 targets): a negative `font-style:italic` assertion
  // hash-coupled to the `.interactive-app` anchor. (Until Slice 5b the editor
  // authored a `.notice` too; its AppBody successor renamed it `.app-hint`.)
  fetchSpy.mockImplementation(routed(404));
  const target = mountItem({ item: appItem(), isCovered: false });
  await settle();
  const notice = target.querySelector('.notice');
  expect(notice).not.toBeNull();
  // Binds the BRANCH to the CLASS, which is the one fact neither the 404 test
  // above nor the dist gate can see: the gate proves a `.notice` rule exists
  // and compiles, and the 404 test proves the copy renders — but `.notice`
  // could sit on the "No app uploaded yet" branch alone with this one a bare
  // <p>, and both would still pass.
  expect(notice!.textContent).toContain("couldn't be loaded");
});
