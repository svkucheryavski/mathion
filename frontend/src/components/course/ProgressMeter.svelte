<script lang="ts">
  import type { Progress } from '../../lib/progress';

  // The bar + quiz chip pair (user, 2026-10-08), shared by a sequence row and a
  // block header so their columns are one design. Two sibling cells, no
  // wrapper: they sit directly in the parent's flex row. Both aria-hidden — the
  // parent states the same facts in words (progressPhrase).
  //
  // `onStrip`: the chip's fill on a tinted header strip, where the row tint
  // (`--surface-2`) would vanish. BlockGroup passes it only for an OPEN block;
  // a closed header is near-white (D76), where the row tint reads instead.
  // CourseView's phone row (D78) passes it too: it sits on the page ground.
  let { p, onStrip = false }: { p: Progress; onStrip?: boolean } = $props();
</script>

<!-- The ONE inline style here: the fill's width is per-row data (CourseCard's
     bar uses the same pinned form). -->
<span class="progress" aria-hidden="true">
  <span class="track"><span class="fill" class:done={p.done} style="width:{p.barPct}%"></span></span>
  <span class="pct mono">{p.pct}%</span>
</span>
<!-- Always rendered, even with no quizzes, so the columns line up row to row. -->
<span class="quiz-chip" class:on-strip={onStrip} class:none={p.hasQuiz && p.quizPct === null} class:empty={!p.hasQuiz} aria-hidden="true">
  {#if p.quizPct !== null}
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,8.6 6.4,12 13,4.6" /></svg>
    Quiz {p.quizPct}%
  {:else if p.hasQuiz}
    Quiz –
  {/if}
</span>

<style>
  /* A fixed column, so every bar lines up down the list (layout A). D91: a
     width, not a flex-basis: Safari sizes a shrink-to-fit parent (CourseView's
     `.cv-meter`, in the phone row) from its items' widths and ignores a basis,
     so the chip ran over the collapse-all chevron. */
  .progress {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    width: 150px;
  }
  .track {
    flex: 1 1 auto;
    height: 6px;
    border-radius: var(--radius-pill);
    /* `--border`, one step darker than CourseCard's `--border-soft` track: rows
       turn `--row-hover` on hover (D77), where the softer track vanishes. */
    background: var(--border);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: var(--radius-pill);
    background: var(--primary);
  }
  /* A finished set turns green. */
  .fill.done {
    background: var(--success);
  }
  /* 11.5px: a progress ratio, like CourseCard's `.count`. Fixed width so
     "100%" doesn't shift the bar left of its neighbours. */
  .pct {
    width: 34px;
    text-align: right;
    font-size: 11.5px;
    /* Explicit: inside a block header button it would inherit 600. */
    font-weight: 400;
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
    flex: none;
    width: 86px;
    padding: 2px 7px;
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    font-size: 11.5px;
    font-weight: 500;
    color: var(--muted);
    white-space: nowrap;
  }
  .quiz-chip.on-strip {
    background: var(--surface);
  }
  /* "Quiz –" and the empty slot carry no chip fill: nothing to report. */
  .quiz-chip.none,
  .quiz-chip.empty {
    background: none;
  }
  @media (max-width: 560px) {
    .progress { width: 80px; }
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
