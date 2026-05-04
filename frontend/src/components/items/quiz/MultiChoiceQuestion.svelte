<script lang="ts">
  import type { MultipleChoiceQuestion } from '../../../lib/types';

  let { question, value, onanswer, disabled = false, correctOptionIds = null }: {
    question: MultipleChoiceQuestion;
    value: number[] | string | undefined;
    onanswer: (ans: number[]) => void;
    disabled?: boolean;
    correctOptionIds?: number[] | null;
  } = $props();

  const selected = $derived<Set<number>>(new Set(Array.isArray(value) ? value : []));
  const correctSet = $derived(new Set(correctOptionIds ?? []));

  function toggle(id: number): void {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onanswer([...next].sort((a, b) => a - b));
  }
</script>

<fieldset>
  <legend><div class="text">{@html question.text_html}</div></legend>
  {#each question.options as opt (opt.id)}
    {@const isCorrect = correctOptionIds !== null && correctSet.has(opt.id)}
    {@const isWrongPick = correctOptionIds !== null && selected.has(opt.id) && !correctSet.has(opt.id)}
    <label class="opt" class:correct={isCorrect} class:wrong={isWrongPick}>
      <input
        type="checkbox"
        checked={selected.has(opt.id)}
        {disabled}
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
  .opt {
    display: block;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius);
    border: 1px solid transparent;
  }
  .opt.correct { background: color-mix(in srgb, var(--success) 18%, transparent); border-color: var(--success); }
  .opt.wrong { background: color-mix(in srgb, var(--danger) 14%, transparent); border-color: var(--danger); }
</style>
