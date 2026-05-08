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
});
