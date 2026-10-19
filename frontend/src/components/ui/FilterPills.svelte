<script lang="ts">
  // Filter pills (handoff §4): a labelled group of toggle buttons. Selected:
  // --primary-soft fill and --primary text; the others a --surface pill with
  // a --border-strong ring. Counts are mono.
  let { label, options, value, onchange }: {
    label: string;
    options: { key: string; label: string; count?: number }[];
    value: string;
    onchange: (key: string) => void;
  } = $props();
</script>

<div class="filter-pills" role="group" aria-label={label}>
  {#each options as o (o.key)}
    <button type="button" class="fp" aria-pressed={value === o.key} onclick={() => onchange(o.key)}>
      {o.label}{#if o.count !== undefined}{' '}<span class="fp-n">({o.count})</span>{/if}
    </button>
  {/each}
</div>

<style>
  .filter-pills { display: flex; flex-wrap: wrap; gap: 6px; }
  .fp {
    height: var(--control-h-sm);
    padding: 0 10px;
    border-radius: var(--radius-pill);
    background: var(--surface);
    color: var(--text-2);
    border: 1px solid var(--border-strong);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }
  .fp:hover { color: var(--text); }
  .fp[aria-pressed='true'] { background: var(--primary-soft); color: var(--primary); border-color: var(--primary); }
  .fp-n { font-family: var(--font-mono); }
</style>
