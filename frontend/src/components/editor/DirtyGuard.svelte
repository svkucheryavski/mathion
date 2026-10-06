<script lang="ts">
  // Mounts a guard that intercepts in-app navigation AND browser unload while
  // the parent has unsaved changes. `isDirty` is a callback (not a boolean)
  // so the navigation-guard closure dereferences the parent's $state on every
  // check; capturing a boolean prop here would freeze the value at the moment
  // of registration — Svelte 5 $props() ARE reactive on prop changes, but the
  // closure passed to registerNavigationGuard is built once inside onMount
  // and never re-runs, so it would hold a stale capture of the old boolean.
  import { onMount } from 'svelte';
  import { registerNavigationGuard } from '../../lib/router.svelte';

  // `onDiscard` (Slice-5a D3) runs after the user CONFIRMS the in-app prompt —
  // never on beforeunload, which leaves the page anyway.
  let { isDirty, onDiscard = undefined }: { isDirty: () => boolean; onDiscard?: () => void } = $props();

  function confirmDiscard(): boolean {
    return window.confirm('Discard unsaved changes and continue?');
  }

  onMount(() => {
    const dispose = registerNavigationGuard(() => {
      if (!isDirty()) return true;
      const ok = confirmDiscard();
      if (ok) onDiscard?.();
      return ok;
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
    };
  });
</script>
