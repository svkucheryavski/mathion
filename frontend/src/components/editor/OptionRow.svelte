<!-- frontend/src/components/editor/OptionRow.svelte
     One answer option. Presentational: it owns NO state (§4.1). The text input
     binds the accordion-owned draft, and the correct mark is the accordion's
     draft too (Slice-5b §5.2, D25); the row only emits callbacks. -->
<script lang="ts">
  import type { AuthoringOption, QuestionType } from '../../lib/quizAuthoring';
  import type { VersionPermissions } from '../../lib/versionPermissions';

  let {
    option, index, count, questionType, perms, draft = $bindable(''), correct,
    frozen, optionsLocked, canDelete, mutating,
    onMark, onDelete, onMoveUp, onMoveDown,
  }: {
    option: AuthoringOption; index: number; count: number; questionType: QuestionType;
    perms: VersionPermissions; draft: string;
    // D25: the DRAFT mark, so the row shows what Save will send.
    correct: boolean;
    // D10/D9: a Save or an item delete is in flight.
    frozen: boolean;
    // Option structure is locked: a mutation in flight, or a frozen modal.
    optionsLocked: boolean;
    canDelete: boolean;
    // An option mutation is in flight: the clicked structure button stays
    // natively enabled (no blur); the accordion's handlers guard re-entry.
    mutating: boolean;
    onMark: (next: boolean) => void;
    onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
  } = $props();

  const textReadOnly = $derived(!perms.canEditTextFields || frozen);
  // Checkables ignore `readonly`, so a frozen mark is `disabled` (D10).
  const markDisabled = $derived(!perms.canEditTextFields || frozen);
  const structureDisabled = $derived(optionsLocked && !mutating);
  // DB String(500), min_length=1. Flagged live; the footer Save's validate() blocks it.
  const lenInvalid = $derived(draft.trim().length < 1 || draft.length > 500);
</script>

<div class="option" class:correct data-testid="option-row">
  {#if questionType === 'single_choice'}
    <input type="radio" name={`correct-${option.question_id}`} checked={correct}
           disabled={markDisabled} onchange={() => onMark(true)}
           aria-label={`Mark option ${index} correct`} />
  {:else if questionType === 'multiple_choice'}
    <input type="checkbox" checked={correct}
           disabled={markDisabled} onchange={(e) => onMark(e.currentTarget.checked)}
           aria-label={`Mark option ${index} correct`} />
  {/if}
  <span class="opt-num">{index}.</span>
  <input class="opt-input" data-testid="option-text" data-option-id={option.id} bind:value={draft}
         readonly={textReadOnly} aria-label={`Option ${index} text`} aria-invalid={lenInvalid} maxlength="500" />
  {#if lenInvalid}<span class="len-warn" role="alert" data-testid="option-len-warn">1–500 chars</span>{/if}
  {#if correct}<span class="correct-marker" data-testid="option-correct">correct</span>{/if}
  {#if perms.canEditStructure}
    <button type="button" aria-label="Move option up" disabled={structureDisabled || index <= 1} onclick={onMoveUp}>↑</button>
    <button type="button" aria-label="Move option down" disabled={structureDisabled || index >= count} onclick={onMoveDown}>↓</button>
    <button type="button" aria-label="Delete option" disabled={structureDisabled || !canDelete} onclick={onDelete}>🗑</button>
  {/if}
</div>

<style>
  .option { display: flex; align-items: center; gap: var(--space-2); }
  .opt-num { color: var(--muted); }
  .opt-input { flex: 1; }
  .correct-marker { font-size: 0.85em; color: var(--status-accepted-fg); }
  .len-warn { font-size: 0.8em; color: var(--danger); }
</style>
