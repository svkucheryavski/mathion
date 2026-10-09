<script lang="ts">
  // The Number / Text answer line (spec §Number, §Text).
  import { decimalsText, formatNumber, toleranceText } from '../../../lib/quizFormat';
  import type { AuthoringQuestion } from '../../../lib/quizAuthoring';
  let { q }: { q: AuthoringQuestion; n: number } = $props();

  const shown = $derived(
    q.type === 'numeric_answer'
      ? (q.correct_numeric == null ? null : formatNumber(q.correct_numeric))
      : q.correct_text,
  );
  const tail = $derived(
    q.type !== 'numeric_answer' ? ''
      : q.precision == null ? ' · decimals not set'
        : ` · ${decimalsText(q.precision)} (${toleranceText(q.precision)})`,
  );
</script>

<p class="key-line">
  {#if shown == null}Answer not set{:else}Answer <strong class="key-value">{shown}</strong>{tail}{/if}
</p>

<style>
  .key-line { margin: 0; font-size: 13.5px; color: var(--text-2); overflow-wrap: anywhere; }
  .key-value { font-weight: 600; color: var(--text); }
</style>
