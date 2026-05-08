// Test helper: subscribes a reactive effect to `t.isDirty` and pushes every
// observed value into an array. Lets tests verify that reactive consumers
// (Save button, DirtyGuard) actually rerun when isDirty changes — not just
// that the getter returns the right answer on direct read. Wraps setup in
// `flushSync` so the initial effect run completes synchronously; callers
// invoke `flushSync()` (no arg) after each mutation to drain pending effects.

import { flushSync } from 'svelte';
import type { DirtyTracker } from '../lib/dirty.svelte';

export function observeIsDirty<T extends Record<string, string | number | null>>(
  t: DirtyTracker<T>,
): { observed: boolean[]; cleanup: () => void } {
  const observed: boolean[] = [];
  let cleanup: () => void = () => {};
  flushSync(() => {
    cleanup = $effect.root(() => {
      $effect(() => {
        observed.push(t.isDirty);
      });
    });
  });
  return { observed, cleanup };
}
