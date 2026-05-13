<script lang="ts">
  import { labelFor } from '../../lib/labelFor';
  import Button from '../ui/Button.svelte';
  import type { AdminTreeItem } from '../../lib/types';

  type Props = {
    item: AdminTreeItem;
    index: number;
    canStructure: boolean;
    canReorderUp: boolean;
    canReorderDown: boolean;
    parentDirty: boolean;
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
    parentDirty,
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

  const glyph = $derived(
    item.type === 'static_page' ? '📄' :
    item.type === 'video' ? '▶' :
    item.type === 'quiz' ? '?' :
    item.type === 'interactive_app' ? '🧩' :
    '⌘'
  );
</script>

<div class="item-row">
  <span class="glyph" aria-hidden="true">{glyph}</span>
  <span class="item-title">{visibleTitle}</span>
  {#if item.title.trim() && item.slug.trim()}
    <span class="item-slug" aria-hidden="true">/{item.slug}</span>
  {/if}
  <div class="actions">
    {#if canStructure}
      <Button
        variant="ghost"
        aria-label={`Move item up: ${ariaName}`}
        onclick={onMoveUp}
        disabled={!canReorderUp || parentDirty || busy}
        title={parentDirty ? 'Save or discard changes first' : 'Move up'}
      >↑</Button>
      <Button
        variant="ghost"
        aria-label={`Move item down: ${ariaName}`}
        onclick={onMoveDown}
        disabled={!canReorderDown || parentDirty || busy}
        title={parentDirty ? 'Save or discard changes first' : 'Move down'}
      >↓</Button>
    {/if}
    <Button
      aria-label={`Open ${ariaName}`}
      onclick={onOpen}
      disabled={busy}
    >Open</Button>
    {#if canStructure}
      <Button
        variant="ghost"
        aria-label={`Delete ${ariaName}`}
        onclick={onDelete}
        disabled={busy}
      >Delete</Button>
    {/if}
  </div>
</div>

<style>
  .item-row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .glyph { width: 24px; text-align: center; opacity: 0.65; }
  .item-title { font-weight: 600; flex: 1; }
  .item-slug { color: var(--muted); font-size: 0.85rem; }
  .actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
</style>
