import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InteractiveAppItem from '../components/items/InteractiveAppItem.svelte';
import { __test__setSlots } from '../stores/currentCourse.svelte';
import type { InteractiveAppItem as IAItem } from '../lib/types';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}
// 12 microtask drains is enough ONLY because lib/api is already module-warm:
// this file statically imports `__test__setSlots` from currentCourse.svelte,
// which statically imports lib/api — so the tracker's `await import('./api')`
// resolves synchronously-ish (already-evaluated module) and the fetch+json
// settle within 12 microtasks. Do NOT remove the currentCourse import to
// "clean up"; against a COLD lib/api this loop drains 0 POSTs (the first
// dynamic import needs a macrotask), and bumping the count would not help.
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

const appItem = (over: Partial<IAItem> = {}): IAItem => ({
  id: 7, sequence_id: 3, title: 'Sandbox', slug: 'sandbox', order: 1,
  type: 'interactive_app', script_url: 'https://example.com/app', ...over,
});

let cleanup: (() => void) | null = null;
beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(() => jres({}));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => {
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  __test__setSlots(null);
});

function mountItem(props: { item: IAItem; isCovered: boolean }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  // $state() must initialize a variable, not be a call argument (runes rule).
  const sprops = $state(props);
  const cmp = mount(InteractiveAppItem, { target, props: sprops });
  cleanup = () => unmount(cmp);
  flushSync();
  return target;
}
const trackCalls = () =>
  fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/api/items/7/track'));

it('renders the iframe and auto-marks coverage once when not covered', async () => {
  const target = mountItem({ item: appItem(), isCovered: false });
  expect(target.querySelector('iframe')).not.toBeNull();
  await settle();
  expect(trackCalls().length).toBe(1);
  const body = JSON.parse((trackCalls()[0][1] as RequestInit).body as string);
  expect(body.is_covered).toBe(true);
});

it('does NOT mark coverage when already covered', async () => {
  mountItem({ item: appItem(), isCovered: true });
  await settle();
  expect(trackCalls().length).toBe(0);
});

it('shows a notice and skips iframe + coverage on an unsafe URL', async () => {
  const target = mountItem({ item: appItem({ script_url: 'javascript:alert(1)' }), isCovered: false });
  expect(target.querySelector('iframe')).toBeNull();
  expect(target.textContent).toContain("can't be displayed");
  await settle();
  expect(trackCalls().length).toBe(0);
});

it('falls back to a generic iframe title when item.title is empty', () => {
  const target = mountItem({ item: appItem({ title: '' }), isCovered: true });
  expect(target.querySelector('iframe')?.getAttribute('title')).toBe('Interactive app');
});

it('does not re-run coverage when isCovered flips after the first POST (guards untrack)', async () => {
  // Discriminates the `untrack(() => isCovered)` in InteractiveAppItem: in production
  // markItemCovered flips the store feeding isCovered AFTER the first coverage POST.
  // Reading isCovered via untrack means that flip must NOT re-invalidate the effect.
  // The component creates createCoverageTracker(id) with no opts, so it uses the real
  // performance.now clock — stub it to accrue >=1s of active time, making a regression
  // observable: without untrack, the flip re-runs the effect and the prior tracker's
  // cleanup stop() flushes a second {time_spent:1} POST.
  let nowValue = 0;
  const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowValue);
  try {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const sprops = $state({ item: appItem(), isCovered: false });
    const cmp = mount(InteractiveAppItem, { target, props: sprops });
    cleanup = () => unmount(cmp);
    flushSync();

    // First view → markCovered() posts {time_spent:0, is_covered:true} exactly once.
    await settle();
    expect(trackCalls().length).toBe(1);

    // Accrue >=1s of active time, then flip isCovered as the coverage store would.
    nowValue = 1500;
    sprops.isCovered = true;
    flushSync();
    await settle();

    // untrack present → flip is inert → still exactly 1 POST. If untrack were removed,
    // the effect re-runs and the prior tracker's stop() flushes a 2nd {time_spent:1} POST.
    expect(trackCalls().length).toBe(1);

    // Deterministic teardown: unmount while the clock is still stubbed, reset it
    // below 1s so the tracker's final stop()->flush() accrues 0 whole seconds (no
    // stray /track POST), and clear cleanup so afterEach doesn't double-unmount.
    // Without this, restoring the real (process-relative, large) performance.now()
    // before the afterEach unmount lets stop() see now() against lastSampleMs=0 and
    // emit a nondeterministic time POST.
    nowValue = 0;
    cleanup?.();
    cleanup = null;
  } finally {
    nowSpy.mockRestore();
  }
});
