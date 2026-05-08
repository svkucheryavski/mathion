<script lang="ts">
  // Mounts a guard that intercepts in-app navigation AND browser unload while
  // the parent has unsaved changes. `isDirty` is passed as a callback (not a
  // value) so the parent's reactive $state reads through it on every check
  // — passing the value directly would freeze the dirty state at mount time
  // because component props don't re-evaluate without rerunning the script.
  import { onMount } from 'svelte';
  import { registerNavigationGuard } from '../../lib/router.svelte';

  let { isDirty }: { isDirty: () => boolean } = $props();

  function confirmDiscard(): boolean {
    return window.confirm('Discard unsaved changes?');
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
