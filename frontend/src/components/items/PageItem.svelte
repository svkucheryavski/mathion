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

  /* ---- {@html} content styles -------------------------------------------
     RETAINED, not rewritten: these are load-bearing against reset.css:4, which
     zeroes ul/ol padding AND their markers, so deleting them strips page
     content of indentation and bullets entirely. Only re-tokened/retargeted.
     Every rule stays ANCESTOR-SCOPED under `.content` — a bare top-level
     `:global(p)` would leak page-content typography app-wide. */
  /* overflow-wrap: `.content` renders UNBOUNDED teacher markdown through
     `{@html}` (see the trust-boundary note above). This is the LARGEST such
     surface in the app. It was described here as "the only one T2/T3 left
     unprotected", which was WRONG and is corrected: the whole-branch review
     measured the same failure on both choice questions' prompt `.text` and on
     QuizItem's `.exp`, all three now fixed. What was true is that this is the
     largest such surface. The identical rule sits on the
     identical rule sits on TextQuestion's and NumericQuestion's `.text` and on
     both choice questions' `.opt` (cited by selector, not by line — the line
     form of this citation has gone stale three times in this slice as comment
     blocks landed above it). Measured in Chromium at a 320px
     viewport, one long unbreakable URL in a paragraph gave documentElement
     scrollWidth 753 vs clientWidth 320 — 433px of PAGE-level horizontal
     scroll, because the overflow escapes .page-item (max-width:652px) and
     .page (max-width:960px) and neither clips (WCAG 1.4.10 reflow). Inherited
     by the descendant rules below, and inert on <pre>, which keeps its own
     overflow-x:auto. */
  .content { overflow-wrap: anywhere; color: var(--text-2); }
  .content :global(p) { margin-bottom: var(--space-3); line-height: 1.6; }
  .content :global(h1), .content :global(h2), .content :global(h3) { margin: var(--space-4) 0 var(--space-2); }
  .content :global(h1) { font-size: 21px; font-weight: 600; color: var(--text); }
  .content :global(h2) { font-size: 16px; font-weight: 600; color: var(--text); }
  .content :global(h3) { font-size: 14px; font-weight: 600; color: var(--text); }
  .content :global(a) { color: var(--primary); }
  .content :global(ul), .content :global(ol) { padding-left: var(--space-4); margin-bottom: var(--space-3); }
  /* SPLIT by list type, replacing a blanket `:global(li){list-style:disc}`.
     reset.css:4 zeroes all markers, so the blanket rule forced BULLETS onto
     <ol> — ordered lists rendered as bullets instead of 1. 2. 3., a real
     rendering bug in student content.
     The `> li` MUST stay INSIDE :global(...): a trailing scoped `li`
     (`.content :global(ul) li`) is a hard compile error
     (css_global_invalid_placement — :global can start or end a sequence, not
     sit in the middle) AND would carry the scope hash, which the {@html}-
     injected <li> nodes do not have. The direct-child form also handles nested
     mixed lists — an <ol> inside a <ul> takes decimal for its own items and
     the outer keeps disc, with no source-order dependence. */
  .content :global(ul > li) { list-style: disc; }
  .content :global(ol > li) { list-style: decimal; }
  /* Inline code: tint + tight inline padding, NO block padding (it must not
     disturb line boxes). */
  .content :global(code) {
    background: var(--surface-2);
    padding: 2px 4px;
    border-radius: var(--radius);
    font-family: var(--font-mono);
  }
  /* Block code: the tokenised textarea/markdown-code-block padding
     (theme-default.css:49 = 8px 10px) rather than the literal. overflow-x
     because a code block requires two-dimensional layout — WCAG 1.4.10 excepts
     it, and wrapping would shred alignment and indentation. */
  .content :global(pre) {
    background: var(--surface-2);
    padding: var(--control-pad-textarea);
    border-radius: var(--radius);
    overflow-x: auto;
  }
  .content :global(pre code) { padding: 0; background: none; }
</style>
