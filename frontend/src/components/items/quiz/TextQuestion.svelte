<script lang="ts">
  import type { TextQuestion } from '../../../lib/types';

  let { question, value, onanswer }: {
    question: TextQuestion;
    value: number[] | string | undefined;
    onanswer: (ans: string) => void;
  } = $props();

  const text = $derived(typeof value === 'string' ? value : '');
</script>

<div class="row">
  <div class="text">{@html question.text_html}</div>
  <input
    type="text"
    value={text}
    oninput={(e) => onanswer((e.currentTarget as HTMLInputElement).value)}
  />
</div>

<style>
  .row { margin-bottom: var(--space-3); }
  .text :global(p) { margin: 0 0 var(--space-2) 0; }
  input { padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius); width: 100%; max-width: 480px; }
</style>
