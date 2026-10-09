<script lang="ts">
  // The add-question type picker (Slice-5b §5.5): 5a's ItemTypePicker cards,
  // with the 5d chip names and no glyphs (Constraint 3).
  import type { QuestionType } from '../../lib/quizAuthoring';
  import { TYPE_LABEL } from '../../lib/quizFormat';
  let { value = $bindable(), disabled = false }: { value: QuestionType; disabled?: boolean } = $props();
  // Slice-5d: the same four names as the card chips (lib/quizFormat TYPE_LABEL).
  const TYPES: { value: QuestionType; label: string }[] =
    (['single_choice', 'multiple_choice', 'numeric_answer', 'text_answer'] as const)
      .map((value) => ({ value, label: TYPE_LABEL[value] }));
</script>

<fieldset class="qtype-picker" {disabled}>
  <legend>Question type</legend>
  <div class="cards">
    {#each TYPES as t (t.value)}
      <label class:selected={value === t.value}>
        <input type="radio" name="question-type" value={t.value} bind:group={value} {disabled} />
        <span>{t.label}</span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  .qtype-picker { border: 0; padding: 0; margin: 0; min-width: 0; }
  legend { padding: 0; margin-bottom: 4px; /* the 4px label/field step */ font-size: 12.5px; color: var(--muted); }
  .cards { display: flex; flex-wrap: wrap; gap: 8px; /* the 8px create-form gap (5a spec §4) */ }
  /* position: relative anchors the visually-hidden radio inside its card. */
  label {
    position: relative;
    display: flex;
    align-items: center;
    padding: 6px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
  }
  label.selected { border-color: var(--primary); background: var(--primary-soft); }
  /* The ItemTypePicker sr-only-radio focus idiom. */
  label:has(input:focus-visible) { box-shadow: inset 0 0 0 2px var(--primary); }
  /* Constraint 2: the sr-only idiom for a still-focusable radio, not a dim. */
  label input { position: absolute; opacity: 0; pointer-events: none; }
  /* Disabled recedes via the disabled-control tokens (IconButton's), never opacity. */
  .qtype-picker:disabled label { border-color: var(--border-faint); background: var(--bg); color: var(--faint); cursor: not-allowed; }
  @media (forced-colors: active) {
    label.selected { border: 2px solid Highlight; }
    label:has(input:focus-visible) { outline: 2px solid Highlight; outline-offset: -2px; }
  }
</style>
