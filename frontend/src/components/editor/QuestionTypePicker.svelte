<script lang="ts">
  import type { QuestionType } from '../../lib/quizAuthoring';
  let { value = $bindable(), disabled = false }: { value: QuestionType; disabled?: boolean } = $props();
  const TYPES: { value: QuestionType; label: string; glyph: string }[] = [
    { value: 'single_choice', label: 'Single choice', glyph: '◉' },
    { value: 'multiple_choice', label: 'Multiple choice', glyph: '☑' },
    { value: 'numeric_answer', label: 'Numeric', glyph: '#' },
    { value: 'text_answer', label: 'Text', glyph: '✎' },
  ];
</script>

<fieldset class="picker" {disabled}>
  <legend>Question type</legend>
  {#each TYPES as t}
    <label class:selected={value === t.value}>
      <input type="radio" name="question-type" value={t.value} bind:group={value} {disabled} />
      <span class="glyph" aria-hidden="true">{t.glyph}</span>
      <span>{t.label}</span>
    </label>
  {/each}
</fieldset>

<style>
  .picker { display: flex; flex-wrap: wrap; gap: var(--space-2); border: none; padding: 0; margin: 0; }
  legend { padding: 0; font-weight: 600; }
  label { display: inline-flex; align-items: center; gap: 4px; padding: var(--space-1) var(--space-2);
          border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; }
  label.selected { border-color: var(--accent, #46c); background: var(--accent-bg, #eef); }
  input { margin: 0; }
  fieldset:disabled label { opacity: 0.5; cursor: not-allowed; }
</style>
