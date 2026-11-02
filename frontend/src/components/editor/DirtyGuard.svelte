<script lang="ts">
  // Mounts a guard that intercepts in-app navigation AND browser unload while
  // the parent has unsaved changes. `isDirty` is a callback (not a boolean)
  // so the navigation-guard closure dereferences the parent's $state on every
  // check; capturing a boolean prop here would freeze the value at the moment
  // of registration — Svelte 5 $props() ARE reactive on prop changes, but the
  // closure passed to registerNavigationGuard is built once inside onMount
  // and never re-runs, so it would hold a stale capture of the old boolean.
  import { onMount, untrack } from 'svelte';
  import { currentRoute, registerNavigationGuard } from '../../lib/router.svelte';
  import type { GuardAsk } from '../../lib/askInPlace.svelte';

  // Polish 1 (D37): `ask` opens the owner's question in place and resolves
  // true on Discard. `onDiscard` (Slice-5a D3) then runs once — never on
  // beforeunload, which leaves the page anyway.
  let { isDirty, ask, onDiscard = undefined }: {
    isDirty: () => boolean;
    ask: () => GuardAsk;
    onDiscard?: () => void;
  } = $props();

  // R47: while a question is open, every further guarded navigation joins it:
  // no second question, and focus goes back to its Cancel.
  let pending: GuardAsk | null = null;
  // R55: the address (path + search, not the hash) the question was asked from.
  let pendingAt = $state<string | null>(null);
  const address = () => currentRoute.path + currentRoute.search;

  // R55: a route change while asking (a forced navigate, the 401 flow, a
  // stale-id fallback) withdraws the question, which resolves false.
  $effect(() => {
    const at = pendingAt;
    if (at !== null && address() !== at) untrack(() => pending?.dismiss());
  });

  onMount(() => {
    const dispose = registerNavigationGuard(() => {
      if (pending) {
        pending.focusCancel();
        return pending.promise;
      }
      if (!isDirty()) return true;
      const q = ask();
      const joined: GuardAsk = {
        ...q,
        promise: q.promise.then((ok) => {
          if (pending === joined) { pending = null; pendingAt = null; }
          if (ok) onDiscard?.();
          return ok;
        }),
      };
      pending = joined;
      pendingAt = address();
      return joined.promise;
    });
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      dispose();
      window.removeEventListener('beforeunload', onUnload);
      pending?.dismiss();
    };
  });
</script>
