<script lang="ts">
  // Set up D5: the end. "Your site is set up." when every step is done;
  // otherwise the steps left, which the Dashboard lists until they're done.
  // One button, to the Dashboard.
  import Button from '../../ui/Button.svelte';
  import { navigate } from '../../../lib/router.svelte';
  import { STEP_LABELS, type PanelSetup } from '../../../lib/setup';

  let { state, token }: { state: PanelSetup; token: string } = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const left = $derived(STEP_LABELS.filter((_, i) => !state.steps[i].done));
  // D3: focus moves to the heading when the card opens.
  const focusOnOpen = (el: HTMLElement) => { el.focus(); };
</script>

<section class="as-card" aria-labelledby={titleId}>
  <h2 id={titleId} class="as-title" tabindex="-1" {@attach focusOnOpen}>All set</h2>
  {#if left.length === 0}
    <p class="as-text">Your site is set up.</p>
  {:else}
    <p class="as-text">Set up is over. These steps are left, and the Dashboard lists them until they're done:</p>
    <ul class="as-left">
      {#each left as label (label)}<li>{label}</li>{/each}
    </ul>
  {/if}
  <div class="as-foot">
    <Button variant="primary" onclick={() => void navigate(`/superuser/${token}`)}>Go to the Dashboard</Button>
  </div>
</section>

<style>
  .as-card {
    box-sizing: border-box;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  .as-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .as-title:focus { outline: none; }
  .as-text { margin: 8px 0 0; font-size: 13px; color: var(--text); }
  .as-left { margin: 6px 0 0; padding-left: 18px; list-style: disc; font-size: 13px; color: var(--text); }
  .as-foot { display: flex; justify-content: flex-end; margin: 14px 0 0; }
</style>
