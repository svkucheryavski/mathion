<script lang="ts">
  import type { NumericQuestion } from '../../../lib/types';

  let { question, value, onanswer }: {
    question: NumericQuestion;
    value: number[] | string | undefined;
    onanswer: (ans: string) => void;
  } = $props();

  const text = $derived(typeof value === 'string' ? value : '');
</script>

<div class="row">
  <div class="text">{@html question.text_html}</div>
  <input
    type="text"
    inputmode="decimal"
    value={text}
    oninput={(e) => onanswer((e.currentTarget as HTMLInputElement).value)}
  />
</div>

<style>
  .row { margin-bottom: var(--space-3); }
  .text :global(p) { margin: 0 0 var(--space-2) 0; }
  input { padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius); width: 160px; }
</style>
