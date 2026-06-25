<!-- frontend/src/components/editor/OptionRow.svelte
     One answer option. Presentational — owns NO registered state (§4.1). T5a
     renders display only (text + ✓ marker); editable text, correctness control,
     and ↑/↓/🗑 are added in T5b/T5c. -->
<script lang="ts">
  import type { AuthoringOption, QuestionType } from '../../lib/quizAuthoring';

  let { option, index, count, questionType }: {
    option: AuthoringOption; index: number; count: number; questionType: QuestionType;
  } = $props();
  void count; void questionType;   // consumed by T5b/T5c controls
</script>

<div class="option" data-testid="option-row">
  <span class="opt-num">{index}.</span>
  <input class="opt-input" data-testid="option-text" value={option.text} readonly aria-label="Option text" />
  {#if option.is_correct}
    <span class="correct-marker" data-testid="option-correct">✓ correct</span>
  {/if}
</div>

<style>
  .option { display: flex; align-items: center; gap: var(--space-2); }
  .opt-num { color: var(--text-muted, #666); }
  .opt-input { flex: 1; }
  .correct-marker { font-size: 0.85em; color: var(--success, #2a7); }
</style>
