<script lang="ts">
  // A one-line name editor (handoff §4 Inline field editing): the field, then
  // Cancel and Save icons. Enter / Save stores the trimmed value, Esc / Cancel
  // closes. An unchanged value cancels without a request; an empty one keeps
  // Save disabled. A failed
  // save keeps the field open with the error under it. Nothing saves on blur.
  import { onMount, untrack, type Snippet } from 'svelte';
  import { ApiError, OFFLINE_MESSAGE } from '../../lib/api';
  import IconButton from './IconButton.svelte';

  let {
    label,
    value = '',
    maxlength = undefined,
    onSave,
    onCancel,
    saveTitle = 'Save',
    aside = undefined,
    subject = undefined,
    type = 'text',
    emptyTitle = undefined,
    wait = null,
  }: {
    label: string;
    value?: string;
    maxlength?: number;
    onSave: (value: string) => Promise<void>;
    onCancel: () => void;
    saveTitle?: string;
    aside?: Snippet;
    // What the field renames ("Group A"): × and ✓ name it for a screen reader.
    subject?: string;
    // Slice-6c R31: the run's Start / End are date fields.
    type?: 'text' | 'date';
    // ✓'s title while the field is empty ("Choose a date"); else saveTitle.
    emptyTitle?: string;
    // While set, ✓ and Enter send nothing and show it as a muted hint (call 16).
    wait?: string | null;
  } = $props();

  const uid = $props.id();
  const errId = `${uid}-err`;
  const hintId = `${uid}-hint`;
  let text = $state(untrack(() => value));
  let saving = $state(false);
  let error = $state<string | null>(null);
  let inputEl = $state<HTMLInputElement>();
  const trimmed = $derived(text.trim());
  // A save tried during the wait; resets whenever `wait` changes, so the hint goes once it ends.
  let waited = $derived.by(() => { void wait; return false; });
  const hint = $derived(waited && wait ? wait : null);
  onMount(() => inputEl?.focus());

  async function save() {
    if (saving || !trimmed) return;
    if (trimmed === value.trim()) { onCancel(); return; }
    if (wait) { waited = true; error = null; return; }
    saving = true;
    error = null;
    try {
      await onSave(trimmed);
    } catch (e) {
      // Polish 3: only a caller's own plain Error speaks; offline says OFFLINE_MESSAGE
      // (call 13), a 422 list its first msg, and an empty message never shows.
      error = e instanceof ApiError ? e.validationErrors()?.[0]?.msg?.replace(/^Value error, /, '') || e.displayMessage || 'Could not save.'
        : e instanceof TypeError ? OFFLINE_MESSAGE
        : e instanceof Error && e.constructor === Error && e.message ? e.message
        : 'Could not save.';
      inputEl?.focus();
    } finally {
      saving = false;
    }
  }

  function cancel() {
    if (!saving) onCancel();
  }

  function onKeydown(e: KeyboardEvent) {
    // A key that ends an IME composition is neither a save nor a cancel (Safari: keyCode 229).
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }
</script>

<div class="inline-name">
  <div class="in-row">
    <input
      class="in-input"
      {type}
      aria-label={label}
      {maxlength}
      readonly={saving}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={error ? errId : hint ? hintId : undefined}
      bind:this={inputEl}
      bind:value={text}
      oninput={() => { error = null; waited = false; }}
      onkeydown={onKeydown}
    />
    {@render aside?.()}
    <IconButton glyph="close" size="sm" title="Cancel" cancel disabled={saving} onclick={cancel}
                aria-label={subject ? `Cancel renaming ${subject}` : undefined} />
    <IconButton glyph="check" size="sm" primary title={saving ? 'Saving…' : !trimmed ? (emptyTitle ?? saveTitle) : saveTitle}
                aria-label={subject ? `${saving ? 'Saving' : saveTitle} ${subject}` : undefined}
                disabled={!trimmed || saving} onclick={() => void save()} />
  </div>
  {#if error}<p class="in-err" id={errId} role="alert">{error}</p>
  {:else if hint}<p class="in-hint" id={hintId} role="status">{hint}</p>{/if}
</div>

<style>
  .inline-name { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 auto; }
  .in-row { display: flex; align-items: center; gap: 4px; }
  .in-input {
    flex: 1 1 auto;
    min-width: 0;
    box-sizing: border-box;
    height: var(--control-h-sm);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .in-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .in-input[aria-invalid='true'] { border: 1.5px solid var(--danger); }
  .in-err { margin: 0; font-size: 12px; color: var(--danger); }
  .in-hint { margin: 0; font-size: 12px; color: var(--muted); }
</style>
