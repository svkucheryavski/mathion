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

  let { isDirty }: { isDirty: () => boolean } = $props();

  function confirmDiscard(): boolean {
    return window.confirm('Discard unsaved changes and continue?');
  }

  onMount(() => {
    const dispose = registerNavigationGuard(() => {
      if (!isDirty()) return true;
      return confirmDiscard();
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
