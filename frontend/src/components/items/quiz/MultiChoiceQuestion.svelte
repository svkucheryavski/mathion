<script lang="ts">
  import type { MultipleChoiceQuestion } from '../../../lib/types';

  let { question, value, onanswer }: {
    question: MultipleChoiceQuestion;
    value: number[] | string | undefined;
    onanswer: (ans: number[]) => void;
  } = $props();

  const selected = $derived<Set<number>>(new Set(Array.isArray(value) ? value : []));

  function toggle(id: number): void {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onanswer([...next].sort((a, b) => a - b));
  }
</script>

<fieldset>
  <legend><div class="text">{@html question.text_html}</div></legend>
  {#each question.options as opt (opt.id)}
    <label class="opt">
      <input
        type="checkbox"
        checked={selected.has(opt.id)}
        onchange={() => toggle(opt.id)}
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
