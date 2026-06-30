<script lang="ts">
  import { untrack } from 'svelte';
  import type { InteractiveAppItem } from '../../lib/types';
  import { safeAppUrl } from '../../lib/safeAppUrl';
  import { createCoverageTracker } from '../../lib/coverage.svelte';
  import { markItemCovered } from '../../stores/currentCourse.svelte';
  import InteractiveFrame from './InteractiveFrame.svelte';

  let { item, isCovered }: { item: InteractiveAppItem; isCovered: boolean } = $props();

  const safe = $derived(safeAppUrl(item.script_url));

  // Coverage + time-on-task. Keyed on item.id (ItemRouter is NOT {#key}-ed, so
  // navigating between two interactive_app items reuses this instance). Capture
  // `id` once so the post-await store write can't target the wrong item after a
  // fast navigation. Read isCovered via untrack: markItemCovered flips the
  // store that feeds the isCovered prop, and without untrack that write would
  // re-invalidate this effect — untrack makes the once-only guarantee hold.
  $effect(() => {
    const id = item.id;
    if (safe === null) return; // unrenderable URL: no tracker, no coverage
    const tracker = createCoverageTracker(id);
    tracker.start();
    if (!untrack(() => isCovered)) {
      void tracker.markCovered().then(() => markItemCovered(id));
    }
    return () => { void tracker.stop(); };
  });
</script>

<article class="interactive-app">
  <h2>{item.title}</h2>
  {#if safe === null}
    <p class="notice">This interactive app can't be displayed.</p>
  {:else}
    <InteractiveFrame src={safe} title={item.title || 'Interactive app'} />
  {/if}
</article>

<style>
  .interactive-app { padding: var(--space-3); }
  .notice { color: var(--muted); font-style: italic; }
</style>
