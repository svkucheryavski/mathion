<!-- frontend/src/components/editor/OptionRow.svelte
     One answer option (3f, ref 1913/1919). Presentational: it owns NO state
     (§4.1). The text input binds the accordion-owned draft, and the correct
     mark is the accordion's draft too (Slice-5b §5.2, D25); the row only
     emits callbacks. -->
<script lang="ts">
  import type { AuthoringOption, QuestionType } from '../../lib/quizAuthoring';
  import type { VersionPermissions } from '../../lib/versionPermissions';
  import IconButton from '../ui/IconButton.svelte';

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
  // D16 / R12: a disabled arrow states its boundary; R14: C2's reason on the trash.
  const upTitle = $derived(index <= 1 ? 'Move up — already first' : 'Move up');
  const downTitle = $derived(index >= count ? 'Move down — already last' : 'Move down');
  const deleteTitle = $derived(
    canDelete ? 'Delete option' : "Can't delete the only correct option — mark another one correct and save first",
  );
</script>

<div class="option" class:correct data-testid="option-row">
  {#if questionType === 'single_choice'}
    <input class="mark" type="radio" name={`correct-${option.question_id}`} checked={correct}
           disabled={markDisabled} onchange={() => onMark(true)}
           aria-label={`Mark option ${index} correct`} />
  {:else if questionType === 'multiple_choice'}
    <input class="mark" type="checkbox" checked={correct}
           disabled={markDisabled} onchange={(e) => onMark(e.currentTarget.checked)}
           aria-label={`Mark option ${index} correct`} />
  {/if}
  <input class="opt-input" data-testid="option-text" data-option-id={option.id} bind:value={draft}
         readonly={textReadOnly} aria-label={`Option ${index} text`} aria-invalid={lenInvalid} maxlength="500" />
  {#if lenInvalid}<span class="mono len-warn" role="alert" data-testid="option-len-warn">1–500 chars</span>{/if}
  {#if correct}<span class="correct-badge" data-testid="option-correct">correct</span>{/if}
  {#if perms.canEditStructure}
    <span class="actions">
      <IconButton size="sm" glyph="up" title={upTitle} aria-label="Move option up"
                  disabled={structureDisabled || index <= 1} onclick={onMoveUp} />
      <IconButton size="sm" glyph="down" title={downTitle} aria-label="Move option down"
                  disabled={structureDisabled || index >= count} onclick={onMoveDown} />
      <IconButton size="sm" glyph="trash" danger title={deleteTitle} aria-label="Delete option"
                  disabled={structureDisabled || !canDelete} onclick={onDelete} />
    </span>
  {/if}
</div>

<style>
  /* ref 1913 — #E9EBEF → --border (5a precedent), #fff → --surface. */
  .option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 9px;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: var(--radius);
  }
  /* ref 1919 — follows the DRAFT mark (D25). */
  .option.correct { border-color: var(--primary); background: var(--primary-soft); }
  /* ref 1914: a 15px mark; the native control takes the primary accent. */
  .mark { flex: 0 0 auto; width: 15px; height: 15px; margin: 0; accent-color: var(--primary); }
  /* D12 metrics, borderless until focus, so the row reads like 3f's text but stays editable. */
  .opt-input {
    box-sizing: border-box;
    flex: 1;
    min-width: 0;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .opt-input:focus-visible {
    outline: none;
    border: 1.5px solid var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft); /* D12 — InlineField's open editor */
    background: var(--surface);
  }
  .opt-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .len-warn { font-size: 12px; color: var(--danger); /* D12 */ }
  /* ref 1919 — #065F46 / #D1FAE5 → the accepted status pair. */
  .correct-badge {
    padding: 2px 7px;
    border-radius: 3px;
    background: var(--status-accepted-bg);
    color: var(--status-accepted-fg);
    font-size: 11px;
    font-weight: 500;
  }
  .actions { display: flex; align-items: center; gap: 6px; /* ref 1895 */ }
</style>
