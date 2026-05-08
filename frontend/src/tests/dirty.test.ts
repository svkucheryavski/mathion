import { describe, it, expect } from 'vitest';
import { makeDirtyTracker } from '../lib/dirty.svelte';

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
    // Direct read of t.isDirty must return false. NOTE: This test verifies the
    // getter returns the correct value but cannot exercise reactive
    // subscription invalidation — vitest's transform here does not wire up the
    // Svelte 5 effect scheduler for `.svelte.ts` modules, so `$effect.root`
    // does not run. The reactive-consumer path (Save button disabled state,
    // DirtyGuard) is exercised end-to-end in component-level tests / smoke
    // checks once DirtyGuard (Task 15) and the editor pages land. The
    // implementation is structured so snapshot[k] = next[k] notifies even when
    // current[k] = next[k] is a same-value write — see comments in
    // dirty.svelte.ts for the rationale.
    const t = makeDirtyTracker({ title: 'a' });
    t.current.title = 'b';
    expect(t.isDirty).toBe(true);
    t.reset({ title: 'b' });
    expect(t.isDirty).toBe(false);
  });
});
