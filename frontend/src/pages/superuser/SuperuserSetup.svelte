<script lang="ts">
  // Set up D1, D3: the wizard's page. The state is the shell's one copy (D13).
  // A first read that failed shows the panel's error state in the step card's
  // place (D2).
  import PanelHead from '../../components/superuser/PanelHead.svelte';
  import ErrorState from '../../components/ui/ErrorState.svelte';
  import type { SetupStore } from '../../lib/setupStore.svelte';

  let { setup }: { setup: SetupStore } = $props();
</script>

<div class="w-page">
  <PanelHead title="Set up your site" />
  {#if setup.failed}
    <ErrorState title="Could not load set up." message={setup.error ?? undefined}
      onretry={() => void setup.read()} retryLabel="Try again" />
  {/if}
</div>
