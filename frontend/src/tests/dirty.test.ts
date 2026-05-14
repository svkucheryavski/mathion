import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import { makeDirtyTracker } from '../lib/dirty.svelte';
import { observeIsDirty } from './observeIsDirty.svelte';

describe('makeDirtyTracker', () => {
  it('starts clean and turns dirty on change', () => {
    const t = makeDirtyTracker({ title: 'a', max: 3 });
    expect(t.isDirty).toBe(false);
    t.current.title = 'b';
    expect(t.isDirty).toBe(true);
  });

  it('reset to a new snapshot clears dirty', () => {
    const t = makeDirtyTracker({ title: 'a' });
    t.current.title = 'b';
    expect(t.isDirty).toBe(true);
    t.reset({ title: 'b' });
    expect(t.isDirty).toBe(false);
    expect(t.current.title).toBe('b');
  });

  it('discard via reset to original snapshot reverts', () => {
    const t = makeDirtyTracker({ title: 'a' });
    t.current.title = 'b';
    t.reset({ title: 'a' });
    expect(t.current.title).toBe('a');
    expect(t.isDirty).toBe(false);
  });

  it('handles number fields', () => {
    const t = makeDirtyTracker({ count: 3 });
    expect(t.isDirty).toBe(false);
    t.current.count = 5;
    expect(t.isDirty).toBe(true);
    t.reset({ count: 5 });
    expect(t.isDirty).toBe(false);
  });

  it('handles nullable string fields (e.g., video_url, content_md)', () => {
    const t = makeDirtyTracker<{ video_url: string | null }>({ video_url: null });
    expect(t.isDirty).toBe(false);
    t.current.video_url = 'https://x';
    expect(t.isDirty).toBe(true);
    t.reset({ video_url: 'https://x' });
    expect(t.isDirty).toBe(false);
    t.current.video_url = null;
    expect(t.isDirty).toBe(true);
  });

  it('same-value reassignment stays clean (no spurious dirty)', () => {
    const t = makeDirtyTracker({ title: 'a' });
    expect(t.isDirty).toBe(false);
    t.current.title = 'a'; // same as initial
    expect(t.isDirty).toBe(false);
  });

  it('multi-field: only one dirty flips isDirty; reverting clears it', () => {
    const t = makeDirtyTracker({ title: 'a', slug: 's' });
    expect(t.isDirty).toBe(false);
    t.current.title = 'b';
    expect(t.isDirty).toBe(true);
    t.current.title = 'a'; // revert to original
    expect(t.isDirty).toBe(false);
  });

  it('reset clears dirty (value-level) even when current already equals the new value', () => {
    // Value-level repro of the codex-flagged Critical scenario: user types 'b',
    // clicks Save, server confirms with 'b'. Page calls reset({ title: 'b' }).
    // Direct read of t.isDirty must return false. The reactive-consumer
    // counterpart is verified by the next test.
    const t = makeDirtyTracker({ title: 'a' });
    t.current.title = 'b';
    expect(t.isDirty).toBe(true);
    t.reset({ title: 'b' });
    expect(t.isDirty).toBe(false);
  });

  it('reactive consumer reruns when reset() makes current a same-value write', () => {
    // Discriminating repro of the codex Round 1 Critical: subscribe a $effect
    // to t.isDirty and verify it reruns after the post-save reset. With the
    // old closure-variable snapshot, snapshot reassignment would not notify
    // and current[k] = 'b' would be a same-value write Svelte 5 skips — so
    // the effect would NOT rerun and observed would stay at [false, true].
    // With the $state snapshot, snapshot[k] going 'a' → 'b' notifies the
    // effect, and observed reaches [false, true, false].
    const t = makeDirtyTracker({ title: 'a' });
    const { observed, cleanup } = observeIsDirty(t);
    expect(observed).toEqual([false]);

    t.current.title = 'b';
    flushSync();
    expect(observed).toEqual([false, true]);

    t.reset({ title: 'b' });
    flushSync();
    expect(observed).toEqual([false, true, false]);
    cleanup();
  });

  // C-I2: isDirty must consider the UNION of keys in snapshot and current.
  // If a caller mutates a key not in the initial snapshot, the dirty getter
  // must still flip true. Iterating over snapshot keys only would silently
  // miss this case and leave Save / DirtyGuard unresponsive.
  it('detects dirty when current has a key not present in initial snapshot', () => {
    const t = makeDirtyTracker<Record<string, string>>({ a: '1' });
    expect(t.isDirty).toBe(false);
    t.current.b = 'x'; // key not in snapshot
    expect(t.isDirty).toBe(true);
  });
});
