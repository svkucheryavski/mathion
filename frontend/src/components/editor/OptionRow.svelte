<!-- frontend/src/components/editor/OptionRow.svelte
     One answer option. Presentational — owns NO registered state (§4.1). The
     text input binds an accordion-owned draft (§7.1); the row only emits
     callbacks. The correctness control is added in T5c. -->
<script lang="ts">
  import type { AuthoringOption, QuestionType } from '../../lib/quizAuthoring';
  import type { VersionPermissions } from '../../lib/versionPermissions';

  let {
    option, index, count, questionType, perms, draft = $bindable(''),
    optionsLocked, canDelete, correctnessEpoch = 0,
    onToggleCorrect, onCommitText, onDelete, onMoveUp, onMoveDown,
  }: {
    option: AuthoringOption; index: number; count: number; questionType: QuestionType;
    perms: VersionPermissions; draft: string; optionsLocked: boolean; canDelete: boolean;
    correctnessEpoch?: number;
    onToggleCorrect: (next: boolean) => void;
    onCommitText: () => void; onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
  } = $props();

  const textReadOnly = $derived(!perms.canEditTextFields || optionsLocked);
  const structureDisabled = $derived(optionsLocked || !perms.canEditStructure);
  const correctnessDisabled = $derived(optionsLocked || !perms.canEditTextFields);
  // Over-length / whitespace-only counter feedback (the commit itself is blocked
  // in the accordion; here we only flag it visibly). DB String(500), min_length=1.
  const lenInvalid = $derived(draft.trim().length < 1 || draft.length > 500);
</script>

<div class="option" data-testid="option-row">
  {#key correctnessEpoch}
    {#if questionType === 'single_choice'}
      <input type="radio" name={`correct-${option.question_id}`} checked={option.is_correct}
             disabled={correctnessDisabled} onclick={() => onToggleCorrect(true)} aria-label={`Mark option ${index} correct`} />
    {:else if questionType === 'multiple_choice'}
      <input type="checkbox" checked={option.is_correct}
             disabled={correctnessDisabled} onchange={(e) => onToggleCorrect(e.currentTarget.checked)} aria-label={`Mark option ${index} correct`} />
    {/if}
  {/key}
  <span class="opt-num">{index}.</span>
  <input class="opt-input" data-testid="option-text" data-option-id={option.id} bind:value={draft}
         readonly={textReadOnly} onblur={() => onCommitText()}
         aria-label={`Option ${index} text`} aria-invalid={lenInvalid} maxlength="500" />
  {#if lenInvalid}<span class="len-warn" role="alert" data-testid="option-len-warn">1–500 chars</span>{/if}
  {#if option.is_correct}
    <span class="correct-marker" data-testid="option-correct">✓ correct</span>
  {/if}
  {#if perms.canEditStructure}
    <button type="button" aria-label="Move option up" disabled={structureDisabled || index <= 1} onclick={onMoveUp}>↑</button>
    <button type="button" aria-label="Move option down" disabled={structureDisabled || index >= count} onclick={onMoveDown}>↓</button>
    <button type="button" aria-label="Delete option" disabled={structureDisabled || !canDelete} onclick={onDelete}>🗑</button>
  {/if}
</div>

<style>
  .option { display: flex; align-items: center; gap: var(--space-2); }
  .opt-num { color: var(--text-muted, #666); }
  .opt-input { flex: 1; }
  .correct-marker { font-size: 0.85em; color: var(--success, #2a7); }
  .len-warn { font-size: 0.8em; color: var(--danger, #c00); }
</style>
