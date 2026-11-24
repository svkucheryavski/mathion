<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { InteractiveAppItem } from '../../lib/types';
  import { fetchAssetSource } from '../../lib/assets';
  import { createCoverageTracker } from '../../lib/coverage.svelte';
  import { markItemCovered, currentCourse } from '../../stores/currentCourse.svelte';
  import InteractiveFrame from './InteractiveFrame.svelte';
  import { APP_WIDTH_SLACK, MIN_APP_WIDTH } from '../../lib/interactiveHost';

  let { item, isCovered }: { item: InteractiveAppItem; isCovered: boolean } = $props();

  let source = $state<string | null>(null);
  let status = $state<'empty' | 'loading' | 'narrow' | 'ready' | 'error'>('empty');
  // Set by the first non-zero measure of the article's width.
  let measured = $state(false);
  let wide = $state(false);
  // The store write after /track may outlive a narrow swap, not the component.
  let alive = true;
  onDestroy(() => { alive = false; });
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
  // and `alive`, tested in the markCovered() continuation, stops a /track that
  // resolves after UNMOUNT from writing coverage into the global store (a narrow
  // swap still writes it: same item, the server has credited it). The isCovered
  // read via untrack keeps the once-only prop read outside this effect's
  // synchronous dependency tracking (markItemCovered's store flip cannot re-run
  // this effect).
  $effect(() => {
    const id = item.id;
    const filename = item.script_url;
    const versionId = currentCourse.value?.versionId;

    if (!filename) { status = 'empty'; source = null; return; }
    if (!wide) { status = measured ? 'narrow' : 'loading'; source = null; return; }
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
          void tracker.markCovered().then(() => { if (alive) markItemCovered(id); });
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

  function measure(el: HTMLElement) {
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      if (w === 0) return; // hidden: keep the last state
      measured = true;
      // Hysteresis, so a scrollbar appearing with the app cannot swap it straight back.
      wide = w >= (wide ? MIN_APP_WIDTH - APP_WIDTH_SLACK : MIN_APP_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }
</script>

<article class="interactive-app" {@attach measure}>
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
  {:else if status === 'narrow'}
    <div class="app-card narrow">
      <p class="notice">This app needs a larger screen. Open this page on a laptop or desktop computer.</p>
    </div>
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
  /* Twin of VideoItem's .video-card; the frame inside fills it. */
  .app-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    /* 16:9, as wide as the window height allows (300px = the page's own chrome), at least 800px */
    aspect-ratio: 16 / 9;
    width: min(100%, max(800px, (calc(100vh / var(--app-zoom, 1)) - 300px) * 16 / 9));
    margin-inline: auto;
  }
  .app-card.narrow { aspect-ratio: auto; width: auto; margin-inline: 0; padding: var(--space-3); }
  /* A named class, not a bare <p>, so the size/colour is grep-able by the gate. */
  .cover-hint { font-size: 12.5px; color: var(--muted); margin: 0; }
  /* font-style:italic dropped — the --muted token carries the recede on its
     own, and italic is not a device this design system uses elsewhere. */
  .notice { color: var(--muted); margin: 0; }
</style>
