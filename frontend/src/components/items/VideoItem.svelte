<script lang="ts">
  import type { VideoItem } from '../../lib/types';
  import { createCoverageTracker } from '../../lib/coverage.svelte';
  import { markItemCovered } from '../../stores/currentCourse.svelte';
  import Button from '../ui/Button.svelte';
  import VideoFrame from './VideoFrame.svelte';

  let { item, isCovered }: { item: VideoItem; isCovered: boolean } = $props();

  let busy = $state(false);
  let tracker: ReturnType<typeof createCoverageTracker> | null = null;

  $effect(() => {
    tracker = createCoverageTracker(item.id);
    tracker.start();
    return () => { void tracker?.stop(); };
  });

  async function markWatched(): Promise<void> {
    if (!tracker) return;
    busy = true;
    try {
      await tracker.markCovered();
      markItemCovered(item.id);
    } finally {
      busy = false;
    }
  }
</script>

<article class="video-item">
  <h2>{item.title}</h2>
  <div class="video-card">
    <VideoFrame src={item.video_url} title={item.title} />
  </div>
  {#if !isCovered}
    <!-- Button's root is inline-flex with no width guard, so under the
         article's `align-items:stretch` it would blockify to the full column.
         The wrapper takes the stretch instead. -->
    <div class="actions">
      <Button onclick={markWatched} loading={busy}>Mark as watched</Button>
    </div>
  {:else}
    <p class="watched">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
        stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="3,8.6 6.4,12 13,4.6" />
      </svg>
      Marked as watched
    </p>
  {/if}
</article>

<style>
  /* §2 article rhythm: the gap is the SOLE vertical-rhythm owner, so every
     surviving child margin is zeroed against it (see `.watched` below). */
  .video-item {
    display: flex;
    flex-direction: column;
    gap: 16px; /* ref 2120 */
    align-items: stretch;
    padding: 0;
  }
  .video-item h2 { font-size: 16px; /* ref 2122 */ font-weight: 600; color: var(--text); }
  /* The card frames the media; VideoFrame itself is NOT restyled (it is shared
     with the editor's preview). `overflow:hidden` clips the iframe to the
     radius. The frame root carries `margin-bottom: var(--space-3)`
     (VideoFrame.svelte:14) which would otherwise add to the article gap — it is
     zeroed through the ANCESTOR-SCOPED form, never a bare top-level
     `:global(.frame)`, which would reach the deferred editor previews too. */
  .video-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .video-card :global(.frame) { margin-bottom: 0; }
  /* `align-items:center` is the load-bearing half: without a flex context the
     bare inline SVG baseline-aligns against the text instead of centring on it.
     The `inline-flex` does NOT make the row hug its content — an earlier
     version of this comment claimed it did, which is false: `.watched` is a
     direct child of the `display:flex` article, so it is a flex item and
     blockifies to `flex` (measured live at 320px: computed display `flex`,
     width 288 = the full column). `inline-flex` is retained because it states
     the intent for a content-width row if this ever moves out of the flex
     parent; today the two render identically. Constraint 5(b) no-ref. */
  .watched {
    display: inline-flex;
    align-items: center;
    gap: 6px; /* Constraint 5(b) no-ref — the tight glyph-to-label step */
    color: var(--status-accepted-fg); /* was --success; identical #065F46, but this is the reserved status token */
    margin: 0;
  }
</style>
