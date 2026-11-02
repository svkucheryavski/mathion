<script lang="ts">
  // The markup of one inline text edit (spec §Saving): the field, the check
  // and cancel buttons, and the error or hint under it. A question at the edit
  // (Polish 1) stands in place of ✓ and ✕ (row), or of the message (column).
  // The owner creates the InlineEdit; this takes the edit slot while mounted
  // and focuses the field.
  import { untrack } from 'svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import AskSlot from '../../ui/AskSlot.svelte';
  import { FORBIDDEN_TITLE, type InlineEdit } from '../../../lib/quizEdits.svelte';

  let { edit, label, saveTitle = 'Save', maxlength = 500, hint = undefined }: {
    edit: InlineEdit<string>; label: string; saveTitle?: string; maxlength?: number; hint?: string;
  } = $props();
  const uid = $props.id();
  const msgId = `${uid}-msg`;
  // The owner nulls its edit on close, and bind:value re-reads one tick after
  // an input: the field's binding reads and writes through a null check (T4).
  let inputEl = $state<HTMLInputElement>();
  let rowEl = $state<HTMLElement>();
  const attach = (el: HTMLInputElement) => {
    el.focus();
    return untrack(() => edit.attach(el));
  };
  // Where the edit's question asks: a row question (D10) in place of ✓ and ✕,
  // a column question (the key, R52) in the message slot.
  const asksInRow = $derived(!!edit.asking.current && edit.asking.current.layout === 'row');
  const asksInMsg = $derived(!!edit.asking.current && edit.asking.current.layout !== 'row');
  // A 403/409 reload can take the right to save away while ✓ holds focus (R10).
  // Before the DOM disables it, focus moves to the field the author must cancel.
  $effect.pre(() => {
    if (edit && !edit.canSave && document.activeElement?.closest('[data-glyph="check"]') && rowEl?.contains(document.activeElement)) {
      inputEl?.focus();
    }
  });
</script>

<span class="inline-field">
  <span class="inline-row" bind:this={rowEl}>
    <input
      class="inline-input"
      type="text"
      aria-label={label}
      {maxlength}
      readonly={edit.saving || edit.asking.open}
      aria-invalid={edit.error ? 'true' : undefined}
      aria-describedby={(edit.error || hint) && !asksInMsg ? msgId : undefined}
      bind:this={inputEl}
      bind:value={() => edit?.value ?? '', (v) => { if (edit) edit.value = v; }}
      onkeydown={(e) => edit.keydown(e)}
      oninput={() => { edit.error = null; }}
      {@attach attach}
    />
    {#if asksInRow}
      <AskSlot ask={edit.asking} />
    {:else}
      <IconButton glyph="check" size="sm" title={edit.saving ? 'Saving…' : edit.canSave ? saveTitle : FORBIDDEN_TITLE}
                  disabled={!edit.canSave} onclick={() => void edit.commit()} />
      <IconButton glyph="close" size="sm" title="Cancel" disabled={edit.saving} onclick={() => edit.cancel()} />
    {/if}
  </span>
  {#if asksInMsg}
    <AskSlot ask={edit.asking} />
  {:else if edit.error}
    <span class="inline-err" id={msgId} role="alert">{edit.error}</span>
  {:else if hint}
    <span class="inline-hint" id={msgId}>{hint}</span>
  {/if}
</span>

<style>
  .inline-field { display: flex; flex-direction: column; gap: 4px; flex: 1 1 auto; min-width: 0; }
  .inline-row { display: flex; align-items: center; gap: 6px; }
  .inline-input {
    flex: 1 1 auto;
    min-width: 0;
    box-sizing: border-box;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .inline-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  @media (forced-colors: active) { .inline-input:focus-visible { outline: 2px solid Highlight; outline-offset: -2px; } }
  .inline-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .inline-err { font-size: 12px; color: var(--danger); }
  .inline-hint { font-size: 12px; color: var(--muted); }
</style>
