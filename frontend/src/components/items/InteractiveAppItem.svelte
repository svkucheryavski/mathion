<script lang="ts">
  import { untrack } from 'svelte';
  import type { InteractiveAppItem } from '../../lib/types';
  import { fetchAssetSource } from '../../lib/assets';
  import { createCoverageTracker } from '../../lib/coverage.svelte';
  import { markItemCovered, currentCourse } from '../../stores/currentCourse.svelte';
  import InteractiveFrame from './InteractiveFrame.svelte';

  let { item, isCovered }: { item: InteractiveAppItem; isCovered: boolean } = $props();

  let source = $state<string | null>(null);
  let status = $state<'empty' | 'loading' | 'ready' | 'error'>('empty');
  // Which item id already had cover STARTED. Guards against a fast script_url
  // change starting a second markCovered() while the isCovered prop still lags
  // at false (a redundant /track POST for the same item).
  let coverStartedForId: number | null = null;

  // The source loads asynchronously, so auto-coverage moves into the fetch-
  // SUCCESS continuation (NOT synchronous mount). The effect reads item.id,
  // script_url, and versionId reactively so navigation/replace tears down the
  // prior run; an AbortController + `stale` guard stop a late-resolving fetch
  // (after teardown, navigation, or a script_url change mid-flight) from
  // starting a tracker or covering. Coverage is credited on a SUCCESSFUL source
  // fetch only — never on unset script_url or on fetch failure. Capture `id`
  // once so the post-await store write can't target the wrong item. Two guards
  // protect the cover: `coverStartedForId` makes cover fire at most once per
  // item id (no double /track on a fast script_url change while isCovered lags);
  // and the `stale` check re-tested inside the markCovered() continuation stops
  // a /track that resolves AFTER teardown from writing coverage into the global
  // store post-unmount. The isCovered read via untrack keeps the once-only prop
  // read outside this effect's synchronous dependency tracking (markItemCovered's
  // store flip cannot re-run this effect).
  $effect(() => {
    const id = item.id;
    const filename = item.script_url;
    const versionId = currentCourse.value?.versionId;

    if (!filename) { status = 'empty'; source = null; return; }
    if (versionId == null) { status = 'loading'; source = null; return; }

    status = 'loading';
    source = null;
    const controller = new AbortController();
    let stale = false;
    let tracker: ReturnType<typeof createCoverageTracker> | null = null;

    void fetchAssetSource(versionId, filename, controller.signal)
      .then((text) => {
        if (stale) return;
        source = text;
        status = 'ready';
        tracker = createCoverageTracker(id);
        tracker.start();
        if (!untrack(() => isCovered) && coverStartedForId !== id) {
          coverStartedForId = id;
          void tracker.markCovered().then(() => { if (!stale) markItemCovered(id); });
        }
      })
      .catch((e: unknown) => {
        if (stale || (e as { name?: string })?.name === 'AbortError') return;
        status = 'error';
        source = null;
      });

    return () => {
      stale = true;
      controller.abort();
      if (tracker) void tracker.stop();
    };
  });
</script>

<article class="interactive-app">
  <h2>{item.title}</h2>
  {#if status === 'ready' && source !== null}
    <div class="app-card">
      <InteractiveFrame scriptSource={source} title={item.title || 'Interactive app'} />
    </div>
    <!-- ref 10h/1047. Ready-state ONLY: coverage is credited in the
         fetch-success continuation, so promising "marked covered once opened"
         beside "couldn't be loaded" would be false. Placement deviates from
         ref 10h/1046, which puts this line in the player footer — that footer
         is SequencePlayer's shared chrome, rendered for every item type, and
         threading an item-specific string up through ItemRouter would be
         cross-component behavioural plumbing in a restyle slice. -->
    <p class="cover-hint">Marked covered once opened.</p>
  {:else if status === 'error'}
    <p class="notice">This app couldn't be loaded.</p>
  {:else if status === 'empty'}
    <p class="notice">No app uploaded yet.</p>
  {/if}
</article>

<style>
  /* §2 article rhythm — the gap is the sole vertical-rhythm owner. */
  .interactive-app {
    display: flex;
    flex-direction: column;
    gap: 16px; /* ref 2120 */
    align-items: stretch;
    padding: 0;
  }
  .interactive-app h2 { font-size: 16px; /* ref 2122 */ font-weight: 600; color: var(--text); }
  /* Twin of VideoItem's .video-card. InteractiveFrame is shared with the
     editor preview and is NOT restyled; its root's `margin-bottom:
     var(--space-3)` (InteractiveFrame.svelte:35) is zeroed through the
     ANCESTOR-SCOPED form — a bare top-level `:global(.frame)` is forbidden,
     it would reach the deferred editor previews. Its fixed 600px stays. */
  .app-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .app-card :global(.frame) { margin-bottom: 0; }
  /* A named class, not a bare <p>, so the size/colour is grep-able by the gate. */
  .cover-hint { font-size: 12.5px; color: var(--muted); margin: 0; }
  /* font-style:italic dropped — the --muted token carries the recede on its
     own, and italic is not a device this design system uses elsewhere. */
  .notice { color: var(--muted); margin: 0; }
</style>
