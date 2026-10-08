<script module lang="ts">
  // Where a block / sequence header sits relative to the focus (Slice-5c D4):
  // a row inside the focus container, a row outside it, the open node that IS
  // the focus, or the open node above it (the block of an open sequence).
  export type HeaderMode = 'row-focus' | 'row-outside' | 'open-focus' | 'open-parent';
</script>

<script lang="ts">
  // Block / sequence header (Slice-5c). What it shows depends on where it sits
  // relative to the focus (D4): a row in the focus container carries the
  // move arrows; a row outside it is the title only; the open node that IS the
  // focus carries edit-title, the arrows and delete (D6, D8); the open node
  // above the focus shows its title. Version
  // permissions HIDE what the state doesn't allow; a state-blocked control
  // stays visible, disabled, with its reason as the title. The accessible
  // toggle is the title button inside the section heading; the chevron is a
  // pointer convenience only (5a D14).
  import { getContext, onDestroy, tick } from 'svelte';
  import { labelFor } from '../../lib/labelFor';
  import { ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import IconButton from '../ui/IconButton.svelte';

  type Props = {
    headerId: string;
    panelId: string;
    level: 'block' | 'sequence';
    mode: HeaderMode;
    title: string | null;
    // Only for the accessible-name fallback; never shown (D5).
    slug: string | null;
    index: number;
    expanded: boolean;
    busy: boolean;
    canStructure: boolean;
    canEditTitle: boolean;
    // "Not at the boundary in that direction": a boundary arrow is disabled
    // with a reason instead of omitted.
    canReorderUp: boolean;
    canReorderDown: boolean;
    // Non-null: the trash is disabled with this title (children remain, …).
    deleteBlockedReason: string | null;
    onToggle: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onDelete: () => void;
    // Resolves on success and THROWS on failure (the parent owns the PATCH).
    onRename: (title: string) => Promise<void>;
  };

  let {
    headerId, panelId, level, mode, title, slug, index, expanded, busy,
    canStructure, canEditTitle, canReorderUp, canReorderDown, deleteBlockedReason,
    onToggle, onMoveUp, onMoveDown, onDelete, onRename,
  }: Props = $props();

  const uid = $props.id();
  const errId = `${uid}-err`;

  // Placeholder text when both title and slug are missing. Visible form
  // wraps it in parens to mark "this is a placeholder, not a real name";
  // aria-label uses the plain form so screen readers don't announce stray
  // punctuation.
  const placeholder = $derived(`${level} ${index}`);
  const ariaName = $derived(labelFor(title, slug, placeholder));
  const visibleTitle = $derived(title?.trim() || slug?.trim() || `(${placeholder})`);
  const Level = $derived(level === 'block' ? 'Block' : 'Sequence');

  const showArrows = $derived(canStructure && (mode === 'open-focus' || mode === 'row-focus'));
  const isFocus = $derived(mode === 'open-focus');
  const upTitle = $derived(canReorderUp ? 'Move up' : 'Move up — already first');
  const downTitle = $derived(canReorderDown ? 'Move down' : 'Move down — already last');

  // ---- D8: the inline title ----
  let renaming = $state(false);
  let draft = $state('');
  let error = $state<string | null>(null);
  let saving = $state(false);
  let inputEl = $state<HTMLInputElement>();
  let pencilEl = $state<HTMLButtonElement>();
  let alive = true;
  onDestroy(() => { alive = false; });

  function msg(e: unknown): string {
    return e instanceof ApiError ? (e.validationErrors()?.[0]?.msg ?? e.displayMessage) : 'Save failed';
  }

  async function startRename() {
    if (!canEditTitle || busy || saving) return;
    draft = title ?? '';
    error = null;
    renaming = true;
    await tick();
    if (!alive) return;
    inputEl?.focus();
    inputEl?.select();
  }

  async function cancelRename() {
    renaming = false;
    error = null;
    await tick();
    if (alive) pencilEl?.focus();
  }

  async function commitRename() {
    if (saving) return;
    const next = draft.trim();
    if (next === '') { error = 'Title is required'; return; }
    if (next === (title ?? '').trim()) { await cancelRename(); return; }
    saving = true;
    try {
      await onRename(next);
    } catch (e) {
      saving = false;
      // The field closed meanwhile (Back, a permission flip): nowhere to
      // show the error inline.
      if (!alive || !renaming) { pushToast(msg(e), 'error'); return; }
      error = msg(e);
      await tick();
      if (alive) inputEl?.focus();
      return;
    }
    saving = false;
    if (!alive || !renaming) return;
    await cancelRename();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // an enclosing handler (a modal, a guard) must not see it
      if (!saving) void cancelRename();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void commitRename();
  }

  // Unsaved registration: optional outside the editor.
  const registry = getContext<DirtyRegistry | undefined>(DIRTY_REGISTRY_KEY);
  const tracker: RegisteredTracker = {
    get isDirty() { return renaming && draft.trim() !== (title ?? '').trim(); },
    discard() { renaming = false; error = null; },
  };
  $effect(() => {
    if (!registry || !renaming) return;
    registry.register(tracker);
    return () => registry.unregister(tracker);
  });

  // Leaving the focus or losing the permission closes the field — a dirty one
  // was already confirmed by the guard, or the version went read-only. Even
  // mid-save: a late failure then toasts (commitRename) instead of vanishing.
  $effect(() => {
    if (renaming && (mode !== 'open-focus' || !canEditTitle)) { renaming = false; error = null; }
  });
</script>

{#snippet toggle()}
  <button
    id={headerId}
    class="toggle"
    aria-expanded={expanded}
    aria-controls={panelId}
    aria-label={ariaName}
    onclick={onToggle}
  >
    <span class="title">{visibleTitle}</span>
  </button>
{/snippet}

<div class="acc-row" class:block={level === 'block'} class:seq={level === 'sequence'}>
  {#if renaming}
    <div class="rename">
      <input
        bind:this={inputEl}
        class="title-input"
        value={draft}
        maxlength={200}
        readonly={saving}
        aria-label={`${Level} title`}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errId : undefined}
        oninput={(e) => { draft = e.currentTarget.value; error = null; }}
        onkeydown={onKeydown}
      />
      {#if error}<p class="err" role="alert" id={errId}>{error}</p>{/if}
    </div>
    <span class="actions">
      <IconButton size="sm" glyph="check" primary title="Save" aria-label={`Save the ${level} title`} disabled={saving} onclick={() => void commitRename()} />
      <IconButton size="sm" glyph="close" title="Cancel" aria-label={`Cancel editing the ${level} title`} disabled={saving} onclick={() => void cancelRename()} />
    </span>
  {:else}
    {#if level === 'block'}
      <h3 class="hd">{@render toggle()}</h3>
    {:else}
      <h4 class="hd">{@render toggle()}</h4>
    {/if}
    <span class="actions">
      {#if isFocus && canEditTitle}
        <IconButton
          size="sm"
          glyph="pencil"
          title={`Edit the ${level} title`}
          aria-label={`Edit the ${level} title`}
          disabled={busy}
          bind:element={pencilEl}
          onclick={() => void startRename()}
        />
      {/if}
      {#if showArrows}
        <IconButton
          size="sm"
          glyph="up"
          title={upTitle}
          aria-label={`Move ${level} up: ${ariaName}`}
          disabled={busy || !canReorderUp}
          onclick={onMoveUp}
        />
        <IconButton
          size="sm"
          glyph="down"
          title={downTitle}
          aria-label={`Move ${level} down: ${ariaName}`}
          disabled={busy || !canReorderDown}
          onclick={onMoveDown}
        />
      {/if}
      {#if isFocus && canStructure}
        <IconButton
          size="sm"
          glyph="trash"
          danger
          title={deleteBlockedReason ?? `Delete this ${level}`}
          aria-label={`Delete ${level} ${ariaName}`}
          disabled={busy || deleteBlockedReason !== null}
          onclick={onDelete}
        />
      {/if}
      {#if mode !== 'row-outside'}
        <!-- D14: not in the tab order, not announced; mousedown is prevented so a
             click never leaves focus on an aria-hidden element. -->
        <IconButton
          size="sm"
          borderless
          glyph={expanded ? 'chevron' : 'chevron-right'}
          title={expanded ? 'Collapse' : 'Expand'}
          tabindex={-1}
          aria-hidden="true"
          onmousedown={(e) => e.preventDefault()}
          onclick={onToggle}
        />
      {/if}
    </span>
  {/if}
</div>

<style>
  /* 5c: no strip tint — the row takes its panel's shade (D1). */
  .acc-row { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 6px 12px; }
  .hd { margin: 0; flex: 1 1 auto; min-width: 0; font: inherit; }
  .toggle {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 28px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .title { font-size: 15px; font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
  .seq .title { font-size: 14.5px; }
  .actions { display: flex; align-items: center; gap: 6px; }
  .rename { flex: 1 1 auto; min-width: 0; }
  .title-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1.5px solid var(--primary);
    border-radius: var(--radius);
    box-shadow: 0 0 0 3px var(--primary-soft); /* the open-editor ring */
    background: var(--surface);
    color: var(--text);
    font-size: 15px;
    font-weight: 600;
  }
  .seq .title-input { font-size: 14.5px; }
  .err { margin: var(--space-1) 0 0; font-size: 12.5px; color: var(--danger); }
</style>
