// Set up D3, D3a: what every step does when it opens, in one place. Its
// unsaved changes register with the page's dirty registry (the leave
// questions, Discard); a failed move's sentence, the newest, clears the
// step's own errors; the page learns once what holds the card; and typed
// values keep the link alive until the step closes. Called while the step's
// component starts (it uses context, effects and onDestroy).
import { getContext, onDestroy, untrack } from 'svelte';
import { DIRTY_REGISTRY_KEY, type DirtyRegistry } from './dirtyRegistry.svelte';
import type { SetupStore } from './setupStore.svelte';

export type StepGuards = {
  /** The step's setup and onHold props (StepProps), read when the step opens. */
  setup: () => SetupStore;
  onHold: (held: () => boolean) => void;
  /** The step's moveError prop, read live. */
  moveError: () => string | null;
  /** The step's values differ from what was loaded. */
  dirty: () => boolean;
  /** Discard: put the loaded values back. */
  discard: () => void;
  /** Something besides typed values holds the card: an error, a note. */
  held: () => boolean;
  /** Drop the step's own errors. */
  clearErrors: () => void;
};

export function useStepGuards(g: StepGuards): void {
  const tracker = {
    get isDirty() { return g.dirty(); },
    discard: () => g.discard(),
  };
  const registry = getContext<DirtyRegistry | undefined>(DIRTY_REGISTRY_KEY);
  $effect(() => {
    registry?.register(tracker);
    return () => registry?.unregister(tracker);
  });
  $effect(() => {
    if (g.moveError() !== null) untrack(() => g.clearErrors());
  });
  untrack(() => g.onHold(() => g.held() || g.dirty()));
  const stop = untrack(() => g.setup().keepAlive(() => g.dirty()));
  onDestroy(stop);
}
