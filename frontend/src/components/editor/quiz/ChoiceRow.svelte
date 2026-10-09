<script lang="ts">
  // One answer row (spec §Single and multiple choice). Presentational: the
  // owner (ChoiceAnswers) decides every reason a control is disabled. A null
  // reason means enabled. The marker is a button with aria-pressed, and arrow
  // keys never change the key.
  import IconButton from '../../ui/IconButton.svelte';
  import InlineInput from './InlineInput.svelte';
  import { cutName } from '../../../lib/quizFormat';
  import type { InlineEdit } from '../../../lib/quizEdits.svelte';
  import type { AuthoringOption } from '../../../lib/quizAuthoring';

  let {
    opt, multiple, edit = null, canText, canStruct,
    markReason, textReason, upReason, downReason, deleteReason,
    onMark, onEdit, onMove, onDelete,
  }: {
    opt: AuthoringOption; multiple: boolean;
    edit?: InlineEdit<string> | null;
    canText: boolean; canStruct: boolean;
    markReason: string | null; textReason: string | null;
    upReason: string | null; downReason: string | null; deleteReason: string | null;
    onMark: () => void; onEdit: () => void; onMove: (dir: -1 | 1) => void; onDelete: () => void;
  } = $props();
  const name = $derived(cutName(opt.text));
</script>

<li class="ans-row" class:ok={opt.is_correct} data-a-id={opt.id}>
  {#if canText}
    <button
      type="button"
      class="ans-mark"
      class:multi={multiple}
      class:on={opt.is_correct}
      aria-pressed={opt.is_correct}
      aria-label={`Mark "${name}" correct`}
      title={markReason ?? (opt.is_correct ? 'Correct answer' : 'Mark correct')}
      disabled={markReason !== null}
      onclick={onMark}
    ></button>
  {:else}
    <span class="ans-mark" class:multi={multiple} class:on={opt.is_correct} aria-hidden="true"></span>
  {/if}

  {#if edit}
    <InlineInput {edit} label="Answer text" saveTitle="Save answer" />
  {:else if canText}
    <button type="button" class="ans-text ans-edit" title={textReason ?? 'Edit answer'}
            disabled={textReason !== null} onclick={onEdit}>
      <span class="sr-only">Edit answer</span> {opt.text}
    </button>
  {:else}
    <span class="ans-text">{opt.text}</span>
  {/if}

  {#if opt.is_correct && !edit}<span class="ans-ok">correct</span>{/if}

  {#if canStruct && !edit}
    <!-- D8: revealed by opacity only — always in the tab order and the a11y tree. -->
    <span class="row-acts">
      <IconButton glyph="up" size="sm" borderless title={upReason ?? 'Move up'}
                  aria-label={`Move answer "${name}" up`} disabled={upReason !== null} onclick={() => onMove(-1)} />
      <IconButton glyph="down" size="sm" borderless title={downReason ?? 'Move down'}
                  aria-label={`Move answer "${name}" down`} disabled={downReason !== null} onclick={() => onMove(1)} />
      <IconButton glyph="trash" size="sm" borderless danger title={deleteReason ?? 'Delete answer'}
                  aria-label={`Delete answer "${name}"`} disabled={deleteReason !== null} onclick={onDelete} />
    </span>
  {/if}
</li>

<style>
  .ans-row { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: var(--radius); font-size: 13.5px; color: var(--text-2); }
  .ans-row:not(.ok):hover { background: var(--focus-row); }
  .ans-row.ok { background: var(--status-accepted-bg); color: var(--status-accepted-fg); }
  .ans-mark {
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 15px;
    height: 15px;
    margin: 0;
    padding: 0;
    border: 1.5px solid var(--muted);
    border-radius: 50%;
    background: var(--surface);
  }
  button.ans-mark { cursor: pointer; }
  button.ans-mark:disabled { cursor: default; }
  .ans-mark.multi { border-radius: 3px; }
  .ans-mark.on { border-color: var(--status-accepted-fg); background: var(--status-accepted-fg); }
  .ans-mark:focus-visible, .ans-edit:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .ans-text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .ans-edit { border: 0; padding: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: text; }
  .ans-edit:disabled { cursor: default; }
  .ans-ok { flex: 0 0 auto; font-size: 11px; font-weight: 500; }
  .row-acts { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; margin-left: auto; opacity: 0; }
  .ans-row:hover .row-acts { opacity: 1; }
  .ans-row:focus-within .row-acts { opacity: 1; }
  @media (hover: none) { .row-acts { opacity: 1; } }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
