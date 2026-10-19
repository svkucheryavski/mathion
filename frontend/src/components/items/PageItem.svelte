<script lang="ts">
  import type { StaticPageItem } from '../../lib/types';
  import { createCoverageTracker } from '../../lib/coverage.svelte';
  import { markItemCovered } from '../../stores/currentCourse.svelte';
  import { externalLinks } from '../../lib/externalLinks';

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
  <div class="content prose" {@attach externalLinks(item.content_html)}>{@html item.content_html}</div>
</article>

<style>
  /* §2 article rhythm. `padding:0` (was var(--space-3)) is what lets the
     652px measure below be the TEXT measure directly: with padding it needed
     `calc(652px + 2 * var(--space-3))` to compensate, and the prose then
     started 16px right of where .quiz's does. Zeroing the padding makes the
     two articles share an EDGE as well as a measure. */
  .page-item {
    display: flex;
    flex-direction: column;
    gap: 16px; /* ref 2120 */
    align-items: stretch;
    padding: 0;
    /* The same 652px QuizItem takes — ref 2120's measure at the reference
       document's 16px root; derivation on SequencePlayer's .content. Kept a px
       literal on purpose: re-expressing it as `68ch` re-introduces the
       14px-vs-16px shrink this value exists to correct. */
    max-width: 652px;
  }
  .page-item h2 { font-size: 16px; /* ref 2122 */ font-weight: 600; color: var(--text); }

  /* The {@html} body is styled by content.css (`.prose`, Polish 2 D51). The
     box keeps the page's text metrics, so lists, quotes and headings inherit
     them. overflow-wrap is the reflow guard (WCAG 1.4.10): one long
     unbreakable URL gave 433px of page-level horizontal scroll at a 320px
     viewport, because the overflow escapes .page-item and .page and neither
     clips. `.prose` sets it too; the box keeps its own, which the gate pins. */
  .content { overflow-wrap: anywhere; color: var(--text-2); line-height: 1.6; }
</style>
