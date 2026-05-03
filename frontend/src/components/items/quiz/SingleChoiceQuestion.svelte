<script lang="ts">
  import type { SingleChoiceQuestion } from '../../../lib/types';

  let { question, value, onanswer }: {
    question: SingleChoiceQuestion;
    value: number[] | string | undefined;
    onanswer: (ans: number[]) => void;
  } = $props();

  const selected = $derived(Array.isArray(value) && value.length === 1 ? value[0] : null);
</script>

<fieldset>
  <legend><div class="text">{@html question.text_html}</div></legend>
  {#each question.options as opt (opt.id)}
    <label class="opt">
      <input
        type="radio"
        name={`q-${question.id}`}
        value={opt.id}
        checked={selected === opt.id}
        onchange={() => onanswer([opt.id])}
      />
      {opt.text}
    </label>
  {/each}
</fieldset>

<style>
  fieldset { border: 0; padding: 0; margin: 0 0 var(--space-3) 0; }
  legend { font-weight: 500; }
  .text :global(p) { margin: 0 0 var(--space-2) 0; }
  .opt { display: block; padding: var(--space-1) 0; }
</style>
