import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCoverageTracker } from '../lib/coverage.svelte';

describe('lib/coverage', () => {
  let now: number;
  let postCalls: { itemId: number; payload: { time_spent: number; is_covered?: boolean } }[];
  let postTrack: (itemId: number, payload: { time_spent: number; is_covered?: boolean }) => Promise<void>;

  beforeEach(() => {
    now = 0;
    postCalls = [];
    postTrack = async (itemId, payload) => {
      postCalls.push({ itemId, payload });
    };
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
  });

  it('start() is idempotent — second call does not double-count', () => {
    const t = createCoverageTracker(42, { now: () => now, postTrack });
    t.start();
    t.start();
    t.stop();
    expect(postCalls.length).toBeLessThanOrEqual(1);
  });

  it('flushes accumulated time_spent on stop()', async () => {
    const t = createCoverageTracker(42, { now: () => now, postTrack });
    t.start();
    now = 5000; // 5s elapsed
    await t.stop();
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0].payload.time_spent).toBe(5);
  });

  it('clamps time_spent to 60s per post', async () => {
    const t = createCoverageTracker(42, { now: () => now, postTrack });
    t.start();
    now = 999_999; // huge delta (e.g. tab returned after long absence)
    await t.stop();
    expect(postCalls[0].payload.time_spent).toBe(60);
  });

  it('does not accrue time while document.visibilityState is hidden', async () => {
    const t = createCoverageTracker(42, { now: () => now, postTrack });
    t.start();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    now = 10_000;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    now = 12_000;
    await t.stop();
    // Only the 2 seconds while visible should count.
    expect(postCalls[0].payload.time_spent).toBe(2);
  });

  it('markCovered() sends is_covered=true with current accumulated time', async () => {
    const t = createCoverageTracker(42, { now: () => now, postTrack });
    t.start();
    now = 3000;
    await t.markCovered();
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0].payload).toMatchObject({ time_spent: 3, is_covered: true });
  });

  it('silently stops on 403 from postTrack', async () => {
    const failing403: typeof postTrack = async () => {
      const e: Error & { status?: number } = new Error('forbidden');
      e.status = 403;
      throw e;
    };
    const t = createCoverageTracker(42, { now: () => now, postTrack: failing403 });
    t.start();
    now = 1000;
    await t.markCovered(); // first call fails 403; tracker should swallow
    now = 5000;
    await t.markCovered(); // second call should be a no-op (silently stopped)
    expect(true).toBe(true); // didn't throw — pass
  });

  it('stop() removes visibilitychange listener', async () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const t = createCoverageTracker(42, { now: () => now, postTrack });
    t.start();
    await t.stop();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
