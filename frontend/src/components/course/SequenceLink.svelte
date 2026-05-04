<script lang="ts">
  import type { SequenceContent, VersionState } from '../../lib/types';
  import { formatProgress } from '../../lib/format';
  import { navigate } from '../../lib/router.svelte';

  let { courseSlug, sequence, state }: { courseSlug: string; sequence: SequenceContent; state: VersionState } = $props();

  const total = sequence.items.length;
  const covered = $derived(
    sequence.items.filter((it) => state.items[String(it.id)]?.is_covered).length,
  );
  const href = `/courses/${courseSlug}/seq/${sequence.id}`;
</script>

<a class="row" {href} onclick={(e) => { e.preventDefault(); navigate(href); }}>
  <span class="title">S{sequence.order}. {sequence.title}</span>
  <span class="progress">
    {formatProgress(covered, total)}
    {#if covered === total && total > 0}<span class="check">✓</span>{/if}
  </span>
</a>

<style>
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius);
    color: var(--text);
  }
  .row:hover { background: var(--border); }
  .progress { color: var(--muted); font-size: 0.875rem; }
  .check { color: var(--success); margin-left: var(--space-1); }
</style>
