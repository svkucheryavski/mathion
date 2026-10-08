<script lang="ts">
  import type { SequenceContent, VersionState } from '../../lib/types';
  import { navigate } from '../../lib/router.svelte';
  import ItemMark from './ItemMark.svelte';

  let { courseSlug, sequence, state }: { courseSlug: string; sequence: SequenceContent; state: VersionState } = $props();

  // Everything is `$derived`: as plain `const`s they read `$props()` once at
  // init and captured only the initial value, so a parent swapping the
  // sequence kept the old count and link.
  const total = $derived(sequence.items.length);
  const covered = $derived(
    sequence.items.filter((it) => state.items[String(it.id)]?.is_covered).length,
  );
  // Rounded DOWN, so "100%" only appears once every item is done (199 of 200
  // reads 99%). An empty sequence reads 0% and is not done.
  const pct = $derived(total ? Math.floor((covered / total) * 100) : 0);
  const done = $derived(total > 0 && covered === total);
  // The fill alone gets CourseCard's visible minimum: a started sequence whose
  // share rounds to 0% (1 of 220) still draws a 2% sliver, never an empty bar.
  const barPct = $derived(covered > 0 ? Math.max(pct, 2) : 0);

  // Quiz score (user, 2026-10-08): points earned ÷ points possible over the
  // quizzes TRIED so far, each at its latest attempt. An untried quiz is left
  // out rather than counted as 0 — students aren't sent its point total, and
  // the bar already says how much is left. A zero-point quiz is skipped.
  const hasQuiz = $derived(sequence.items.some((it) => it.type === 'quiz'));
  const quizPct = $derived.by(() => {
    let got = 0;
    let max = 0;
    for (const it of sequence.items) {
      if (it.type !== 'quiz') continue;
      const ls = state.items[String(it.id)]?.last_score;
      if (!ls || ls.total <= 0) continue;
      got += ls.correct;
      max += ls.total;
    }
    return max > 0 ? Math.round((got / max) * 100) : null;
  });
  const href = $derived(`/courses/${courseSlug}/seq/${sequence.id}`);

  // The row's accessible name. The bar and the chip are aria-hidden, so this is
  // the only reading of both, in words.
  const label = $derived(
    `Sequence: ${sequence.title}, ` +
      `${covered} of ${total} ${total === 1 ? 'item' : 'items'} completed` +
      (quizPct !== null ? `, quiz score ${quizPct}%` : hasQuiz ? ', no quizzes tried yet' : ''),
  );
</script>

<a class="row" {href} aria-label={label} onclick={(e) => { e.preventDefault(); navigate(href); }}>
  <!-- The open book replaces the `S{order}` badge (user, 2026-10-08). Always the
       not-yet outline: completion is the bar's job, as with the mini-project flag. -->
  <span class="seq-glyph" aria-hidden="true"><ItemMark type="sequence" /></span>
  <span class="row-title">{sequence.title}</span>
  <!-- Replaces the per-item mark chain, which stopped scaling at ~20 items. The
       ONE inline style in this component: the fill's width is per-row data
       (CourseCard's bar uses the same pinned form). -->
  <span class="progress" aria-hidden="true">
    <span class="track"><span class="fill" class:done style="width:{barPct}%"></span></span>
    <span class="pct mono">{pct}%</span>
  </span>
  <!-- Always rendered, even with no quizzes, so the bars line up row to row. -->
  <span class="quiz-chip" class:none={hasQuiz && quizPct === null} class:empty={!hasQuiz} aria-hidden="true">
    {#if quizPct !== null}
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,8.6 6.4,12 13,4.6" /></svg>
      Quiz {quizPct}%
    {:else if hasQuiz}
      Quiz –
    {/if}
  </span>
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
    padding: 8px 12px; /* ref 1572 */
    border-bottom: 1px solid var(--border-soft);
    color: var(--text);
  }
  /* `text-decoration:none` suppresses the global `a:hover` underline. */
  .row:hover {
    background: var(--primary-soft);
    text-decoration: none;
  }
  /* An INSET ring: the global outset ring is clipped by the card's
     `overflow:hidden`. 2px `--primary` because `--primary-soft` is ~1.15:1. */
  .row:focus-visible {
    box-shadow: inset 0 0 0 2px var(--primary);
  }
  /* Forced colors drop box-shadow while the global `outline:none` still applies,
     so without this the row has no focus indicator in that mode. */
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
     shares the shrink instead of collapsing to zero width on a tight row. */
  .row-title {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text);
  }
  /* A fixed column, so every row's bar lines up and a long course scans at a
     glance (layout A, user 2026-10-08). */
  .progress {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 150px;
  }
  .track {
    flex: 1 1 auto;
    height: 6px;
    border-radius: var(--radius-pill);
    /* `--border`, one step darker than CourseCard's `--border-soft` track: this
       row turns `--primary-soft` on hover, where the softer track vanishes. */
    background: var(--border);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: var(--radius-pill);
    background: var(--primary);
  }
  /* A finished sequence turns green. */
  .fill.done {
    background: var(--success);
  }
  /* 11.5px: a progress ratio, like CourseCard's `.count`. Fixed width so
     "100%" doesn't shift the bar left of its neighbours. */
  .pct {
    width: 34px;
    text-align: right;
    font-size: 11.5px;
    color: var(--muted);
  }
  /* A small tinted chip (`--surface-2`, the block header strip's tint). Fixed
     width for the same alignment reason as the bar. */
  .quiz-chip {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex: 0 0 86px;
    padding: 2px 7px;
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    font-size: 11.5px;
    font-weight: 500;
    color: var(--muted);
    white-space: nowrap;
  }
  /* "Quiz –" and the empty slot carry no chip fill: nothing to report. */
  .quiz-chip.none,
  .quiz-chip.empty {
    background: none;
  }
  @media (max-width: 560px) {
    .progress { flex-basis: 80px; }
  }
  /* Forced colors repaint backgrounds, so the bar would vanish: outline the
     track and paint the fill in the text colour. `.fill.done` is named too —
     its green out-specifies a bare `.fill` and would survive with adjustment off. */
  @media (forced-colors: active) {
    .track { border: 1px solid CanvasText; }
    .fill,
    .fill.done { forced-color-adjust: none; background: CanvasText; }
  }
</style>
