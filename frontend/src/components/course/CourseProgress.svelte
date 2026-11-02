<script lang="ts">
  import { progressPhrase, type Progress } from '../../lib/progress';

  // The course-wide summary card beside the course info (user, 2026-10-08):
  // the same Progress a sequence row and a block header show, over every item
  // in the course. The figures are aria-hidden; one sentence states them.
  let { p }: { p: Progress } = $props();
</script>

<div class="summary">
  <p class="sl" aria-hidden="true">Your progress</p>
  <!-- The ONE inline style here: the fill's width is data (ProgressMeter's form). -->
  <div class="sb" aria-hidden="true">
    <span class="track"><span class="fill" class:done={p.done} style="width:{p.barPct}%"></span></span>
    <span class="sp">{p.pct}%</span>
  </div>
  {#if p.hasQuiz}
    <p class="sq" aria-hidden="true">
      <!-- No check beside a dash (ProgressMeter's "Quiz –" carries none either). -->
      {#if p.quizPct !== null}
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,8.6 6.4,12 13,4.6" /></svg>
      {/if}
      Quiz score <b>{p.quizPct === null ? '–' : `${p.quizPct}%`}</b>
    </p>
  {/if}
  <p class="sr-only">Your progress: {progressPhrase(p)}.</p>
</div>

<style>
  /* A small card. D78: it fills the cell the course page gives it -- the 300px
     right-hand column, or the full width on a phone -- so it sets no width. */
  .summary {
    box-sizing: border-box;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  .sl {
    margin: 0 0 6px;
    font-size: 11.5px;
    color: var(--muted);
  }
  .sb {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  /* The row bar (ProgressMeter), one step taller: the course total. */
  .track {
    flex: 1 1 auto;
    height: 8px;
    border-radius: var(--radius-pill);
    background: var(--border);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: var(--radius-pill);
    background: var(--primary);
  }
  .fill.done {
    background: var(--success);
  }
  .sp {
    font-size: 15px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .sq {
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 8px 0 0;
    font-size: 12.5px;
    color: var(--muted);
  }
  .sq b {
    font-weight: 600;
    color: var(--text);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
  @media (forced-colors: active) {
    .track { border: 1px solid CanvasText; }
    .fill,
    .fill.done { forced-color-adjust: none; background: CanvasText; }
  }
</style>
