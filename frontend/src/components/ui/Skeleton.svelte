<script lang="ts">
  // Skeleton — static loading placeholder (artboard 9d, ref 1345-1350).
  // "Loading — skeleton rows, never a spinner" (ref 1345): a placeholder that
  // holds row height, no animation, no shimmer. Presentational only.
  //
  // The three artboard rows, ref 1347/1348/1349, cycling for rows > 3.
  const W: ReadonlyArray<readonly [number, number, number]> = [[180, 90, 64], [220, 70, 64], [150, 110, 64]];
  let { rows = 3, label = 'Loading…' }: { rows?: number; label?: string } = $props();
</script>

<div class="skeleton" role="status" aria-live="polite">
  <span class="sr-only">{label}</span>
  {#each { length: rows }, i}
    <div class="row" aria-hidden="true">
      <span class="bar" style:width="{W[i % 3][0]}px"></span>
      <span class="bar" style:width="{W[i % 3][1]}px"></span>
      <span class="bar end" style:width="{W[i % 3][2]}px"></span>
    </div>
  {/each}
</div>

<style>
  .skeleton {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 12px; /* ref 1346 */
    display: flex;
    flex-direction: column;
    gap: 9px; /* ref 1346 */
  }
  .row { display: flex; align-items: center; gap: 12px; /* ref 1347 */ }
  .bar {
    display: block;
    height: 13px; /* ref 1347 */
    border-radius: 3px; /* ref 1347 — a literal, deliberately NOT var(--radius-pill): that token names status badges, and a placeholder bar is not a badge */
    background: var(--border-faint); /* #EDEFF2 exact — a border token used as a fill: the bar IS a placeholder stroke (spec substitution table) */
  }
  .end { margin-left: auto; }
  /* Visually hidden, reachable by screen readers — the repo 1px-box idiom (MiniProjectDetailPage.svelte .sr-only). */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
