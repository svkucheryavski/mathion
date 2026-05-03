<script lang="ts">
  import type { StaticPageItem } from '../../lib/types';
  import { createCoverageTracker } from '../../lib/coverage.svelte';
  import { markItemCovered } from '../../stores/currentCourse.svelte';

  let { item }: { item: StaticPageItem } = $props();

  // Trust boundary: content_html is sanitized server-side at write-time via
  // mathion/markdown.py (nh3). Any future content source MUST pass through
  // the same sanitiser before being rendered with @html.
  $effect(() => {
    const tracker = createCoverageTracker(item.id);
    let coveredAt = 0;
    let interval: ReturnType<typeof setInterval> | null = null;
    tracker.start();
    // Set covered after 30 s of *active* time. We poll every 1 s; tracker
    // accrues real visible time internally. We stop polling once covered.
    interval = setInterval(() => {
      coveredAt += 1000;
      if (coveredAt >= 30_000) {
        void tracker.markCovered();
        markItemCovered(item.id);
        if (interval !== null) { clearInterval(interval); interval = null; }
      }
    }, 1000);
    return () => {
      if (interval !== null) clearInterval(interval);
      void tracker.stop();
    };
  });
</script>

<article class="page-item">
  <h2>{item.title}</h2>
  <div class="content">{@html item.content_html}</div>
</article>

<style>
  .page-item { padding: var(--space-3); }
  .content :global(p) { margin-bottom: var(--space-3); line-height: 1.6; }
  .content :global(h1), .content :global(h2), .content :global(h3) { margin: var(--space-4) 0 var(--space-2); }
  .content :global(ul), .content :global(ol) { padding-left: var(--space-4); margin-bottom: var(--space-3); }
  .content :global(li) { list-style: disc; }
</style>
