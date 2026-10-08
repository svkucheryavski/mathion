<script lang="ts">
  // One item in a sequence body (3b, ref 1588-1606): a non-interactive type
  // mark, the title, a quiz's question count, then the actions — open always,
  // the arrows and delete only when the version allows structure changes
  // (Slice-5c: hidden, not disabled).
  import { labelFor } from '../../lib/labelFor';
  import ItemMark from '../course/ItemMark.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import type { AdminTreeItem } from '../../lib/types';

  type Props = {
    item: AdminTreeItem;
    index: number;
    // False when the version forbids structure changes (published, archived):
    // the arrows and Delete are not rendered.
    canStructure: boolean;
    // "Not at the boundary in that direction"; at an end the arrow stays, disabled.
    canReorderUp: boolean;
    canReorderDown: boolean;
    busy: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onOpen: () => void;
    onDelete: () => void;
  };

  let {
    item,
    index,
    canStructure,
    canReorderUp,
    canReorderDown,
    busy,
    onMoveUp,
    onMoveDown,
    onOpen,
    onDelete,
  }: Props = $props();

  // Placeholder text when both title and slug are missing. Visible form
  // wraps it in parens to mark "this is a placeholder, not a real name";
  // aria-label uses the plain form so screen readers don't announce stray
  // punctuation. Same convention as AccordionHeader.
  const placeholder = $derived(`item ${index}`);
  const ariaName = $derived(labelFor(item.title, item.slug, placeholder));
  const visibleTitle = $derived(item.title.trim() || item.slug.trim() || `(${placeholder})`);

  const upTitle = $derived(canReorderUp ? 'Move up' : 'Move up — already first');
  const downTitle = $derived(canReorderDown ? 'Move down' : 'Move down — already last');
</script>

<div class="item-row">
  <ItemMark type={item.type} state="not-yet" />
  <span class="item-title">{visibleTitle}</span>
  {#if item.type === 'quiz'}
    <span class="sep" aria-hidden="true">·</span>
    <span class="mono q-count" data-testid="item-question-count">{item.questions_count} {item.questions_count === 1 ? 'question' : 'questions'}</span>
  {/if}
  <span class="actions">
    {#if canStructure}
      <IconButton size="sm" glyph="up" title={upTitle} aria-label={`Move item up: ${ariaName}`}
        disabled={busy || !canReorderUp} onclick={onMoveUp} />
      <IconButton size="sm" glyph="down" title={downTitle} aria-label={`Move item down: ${ariaName}`}
        disabled={busy || !canReorderDown} onclick={onMoveDown} />
    {/if}
    <!-- id: the item modal's close falls back here (Slice-5b D18). -->
    <IconButton id={`item-${item.id}-open`} size="sm" glyph="pencil" title="Open" aria-label={`Open ${ariaName}`} disabled={busy} onclick={onOpen} />
    {#if canStructure}
      <IconButton size="sm" glyph="trash" danger title="Delete" aria-label={`Delete ${ariaName}`} disabled={busy} onclick={onDelete} />
    {/if}
  </span>
</div>

<style>
  /* Slice-5c: each row is its own box on the focus panel (constructor-v3). */
  .item-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border: 1px solid var(--focus-line);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .item-title { min-width: 0; font-size: 13px; font-weight: 600; color: var(--text); overflow-wrap: anywhere; /* ref 1590 */ }
  .sep { color: var(--faint); /* ref 1606 — the separator use of --faint */ }
  .q-count { font-size: 12px; color: var(--muted); /* ref 1606 */ }
  .actions { margin-left: auto; display: flex; align-items: center; gap: 6px; /* ref 1593 */ }
</style>
