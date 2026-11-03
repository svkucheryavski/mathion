<script lang="ts">
  // A panel page's heading, with its page action beside it ("New course").
  // Each page renders its own, so the action can live in the page that owns it.
  import type { Snippet } from 'svelte';

  let { title, actions }: { title: string; actions?: Snippet } = $props();
</script>

<div class="panel-head">
  <h1>{title}</h1>
  {#if actions}{@render actions()}{/if}
</div>

<style>
  /* The teaching list's heading; the action sits at the row's end. */
  .panel-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin: 0 0 14px; }
  h1 { margin: 0; font-size: 22px; font-weight: 600; color: var(--text); }
</style>
