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
  <VideoFrame src={item.video_url} title={item.title} />
  {#if !isCovered}
    <Button onclick={markWatched} loading={busy}>Mark as watched</Button>
  {:else}
    <p class="watched">✓ Marked as watched</p>
  {/if}
</article>

<style>
  .video-item { padding: var(--space-3); }
  .watched { color: var(--success); }
</style>
