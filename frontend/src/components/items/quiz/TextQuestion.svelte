<script lang="ts">
  import type { TextQuestion } from '../../../lib/types';

  let { question, value, onanswer, disabled = false, correctValue = null }: {
    question: TextQuestion;
    value: number[] | string | undefined;
    onanswer: (ans: string) => void;
    disabled?: boolean;
    correctValue?: string | null;
  } = $props();

  const text = $derived(typeof value === 'string' ? value : '');
</script>

<div class="row">
  <div class="text">{@html question.text_html}</div>
  <input
    type="text"
    value={text}
    {disabled}
    oninput={(e) => onanswer((e.currentTarget as HTMLInputElement).value)}
  />
  {#if correctValue !== null}
    <p class="correct-line">Correct answer: <strong>{correctValue}</strong></p>
  {/if}
</div>

<style>
  .row { margin-bottom: var(--space-3); }
  .text :global(p) { margin: 0 0 var(--space-2) 0; }
  input { padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius); width: 100%; max-width: 480px; }
  .correct-line { margin: var(--space-1) 0 0 0; color: var(--success); font-size: 0.9rem; }
</style>
