// dirtyRegistry aggregates per-form makeDirtyTracker getters into a single
// page-wide `isAnyDirty()` callable. VersionEditPage provides one instance
// via setContext(DIRTY_REGISTRY_KEY, ...); every form below it registers
// its tracker in an $effect on mount and unregisters on unmount. DirtyGuard
// receives `() => isAnyDirty()` so its closure re-reads the live registry
// on every navigation. SvelteSet (not plain Set) makes membership changes
// reactive, so callers using `$derived(...registry...)` re-evaluate when
// trackers are added/removed.

import { SvelteSet } from 'svelte/reactivity';

// Erased shape — the registry stores trackers across all form shapes.
// The concrete tracker types still flow through their owning form; only
// the registry needs to forget the parameter. `discard` (Slice-5a D3) drops
// the tracker's draft when the user confirms the "Discard unsaved changes?"
// prompt, so a confirmed discard never re-prompts on the next navigation.
export type RegisteredTracker = { readonly isDirty: boolean; discard?: () => void };

export const DIRTY_REGISTRY_KEY = Symbol('dirtyRegistry');

export type DirtyRegistry = {
  register(t: RegisteredTracker): void;
  unregister(t: RegisteredTracker): void;
  isAnyDirty(): boolean;
  discardAll(): void;
};

export function createDirtyRegistry(): DirtyRegistry {
  const registry = new SvelteSet<RegisteredTracker>();
  return {
    register(t)   { registry.add(t); },
    unregister(t) { registry.delete(t); },
    isAnyDirty() {
      for (const t of registry) if (t.isDirty) return true;
      return false;
    },
    discardAll() {
      // Snapshot first: a discard closes its field, and that field's $effect
      // cleanup unregisters the tracker — never mutate the set mid-iteration.
      for (const t of [...registry]) if (t.isDirty) t.discard?.();
    },
  };
}
