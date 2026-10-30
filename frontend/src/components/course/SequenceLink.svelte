<script lang="ts">
  import type { SequenceContent, VersionState } from '../../lib/types';
  import { navigate } from '../../lib/router.svelte';
  import { progressOf, progressPhrase } from '../../lib/progress';
  import ItemMark from './ItemMark.svelte';
  import ProgressMeter from './ProgressMeter.svelte';

  let { courseSlug, sequence, state }: { courseSlug: string; sequence: SequenceContent; state: VersionState } = $props();

  // `$derived`, not plain `const`s: those read `$props()` once at init, so a
  // parent swapping the sequence kept the old figures and link. The rules
  // (rounded-down share, 2% visible minimum, quiz score over the quizzes tried)
  // live in lib/progress, shared with the block header and the course summary.
  const p = $derived(progressOf(sequence.items, state));
  const href = $derived(`/courses/${courseSlug}/seq/${sequence.id}`);
  // The bar and chip are aria-hidden, so this is the only reading of both.
  const label = $derived(`Sequence: ${sequence.title}, ${progressPhrase(p)}`);
</script>

<a class="row" {href} aria-label={label} onclick={(e) => { e.preventDefault(); navigate(href); }}>
  <!-- The open book replaces the `S{order}` badge (user, 2026-10-08). Always the
       not-yet outline: completion is the bar's job, as with the mini-project flag. -->
  <span class="seq-glyph" aria-hidden="true"><ItemMark type="sequence" /></span>
  <span class="row-title">{sequence.title}</span>
  <!-- Replaces the per-item mark chain, which stopped scaling at ~20 items. -->
  <ProgressMeter {p} />
</a>

<style>
  /* Row geometry is ref 1572, the 3b authoring sequence-row strip: edge-flush
     inside BlockGroup's `overflow:hidden` card, hairline separators
     (`--border-soft` = separators inside a card). `color: var(--text)` is
     load-bearing: without it the row inherits the global link colour. */
  .row {
    display: flex;
    align-items: center;
    gap: 10px; /* ref 1572 */
    /* 35px on the right = 12px + the block header's chevron (13px) and its
       gap (10px), so the bar and chip columns line up with the header's. */
    padding: 8px 35px 8px 12px;
    border-bottom: 1px solid var(--border-soft);
    color: var(--text);
  }
  /* `text-decoration:none` suppresses the global `a:hover` underline. */
  .row:hover {
    background: var(--row-hover); /* D77: lighter than --primary-soft */
    text-decoration: none;
  }
  /* An INSET ring. The global outline would be clipped by the card's
     `overflow:hidden` and paint over the neighbouring rows, so it is dropped. */
  .row:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--primary);
  }
  /* Forced colors drop box-shadow. This offset keeps the global forced-colors
     outline (base.css) inside the row. */
  @media (forced-colors: active) {
    .row:focus-visible { outline: 2px solid Highlight; outline-offset: -2px; }
  }
  /* The twin of MiniProjectLink's `.row-glyph` (renamed: that class is its
     unique gate anchor). The two row kinds are siblings in one BlockGroup list
     and must read as one list. */
  .seq-glyph {
    display: inline-flex;
    flex: 0 0 auto;
  }
  /* `flex: 1 1 auto`, not `flex: 1` (basis 0): with an auto basis the title
     shares the shrink instead of collapsing to zero width on a tight row.
     14.5px regular (user, 2026-10-08): the admin sequence-title size; not
     bold, so the block headers carry the outline and the bars the emphasis. */
  .row-title {
    flex: 1 1 auto;
    min-width: 0;
    /* A long unbroken word wraps instead of painting over the meter/pill. */
    overflow-wrap: anywhere;
    font-size: 14.5px;
    font-weight: 400;
    color: var(--text);
  }
</style>
