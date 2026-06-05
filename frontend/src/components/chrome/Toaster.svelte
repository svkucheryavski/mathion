<script lang="ts">
  import { toasts } from '../../stores/toasts.svelte';
  import Toast from './Toast.svelte';
</script>

<div class="toaster" aria-live="polite">
  {#each toasts.list as t (t.id)}
    <Toast toast={t} />
  {/each}
</div>

<style>
  .toaster {
    position: fixed;
    top: var(--space-3);
    right: var(--space-3);
    z-index: 9999;
    display: flex;
    flex-direction: column;
  }
</style>
