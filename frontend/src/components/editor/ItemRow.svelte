<script lang="ts">
  // One item in a sequence body (3b, ref 1588-1606): a non-interactive type
  // mark, the title, the mono slug, a quiz's question count, and four fixed
  // icon slots — ↑ ↓ open delete (§4 keep the slot count fixed).
  import { labelFor } from '../../lib/labelFor';
  import ItemMark from '../course/ItemMark.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import type { AdminTreeItem } from '../../lib/types';

  type Props = {
    item: AdminTreeItem;
    index: number;
    // Non-null when the version forbids structure changes; disables the
    // arrows and Delete with this reason as their title.
    structureReason: string | null;
    // "Not at the boundary in that direction" — the arrows always render.
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
    structureReason,
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

  // Title precedence (as AccordionHeader): structure reason → boundary → normal.
  const upTitle = $derived(structureReason ?? (canReorderUp ? 'Move up' : 'Move up — already first'));
  const downTitle = $derived(structureReason ?? (canReorderDown ? 'Move down' : 'Move down — already last'));
</script>

<div class="item-row">
  <ItemMark type={item.type} state="not-yet" />
  <span class="item-title">{visibleTitle}</span>
  {#if item.title.trim() && item.slug.trim()}
    <span class="mono item-slug" aria-hidden="true">/{item.slug}</span>
  {/if}
  {#if item.type === 'quiz'}
    <span class="sep" aria-hidden="true">·</span>
    <span class="mono q-count" data-testid="item-question-count">{item.questions_count} {item.questions_count === 1 ? 'question' : 'questions'}</span>
  {/if}
  <span class="actions">
    <IconButton
      size="sm"
      glyph="up"
      title={upTitle}
      aria-label={`Move item up: ${ariaName}`}
      disabled={busy || !!structureReason || !canReorderUp}
      onclick={onMoveUp}
    />
    <IconButton
      size="sm"
      glyph="down"
      title={downTitle}
      aria-label={`Move item down: ${ariaName}`}
      disabled={busy || !!structureReason || !canReorderDown}
      onclick={onMoveDown}
    />
    <!-- id: the item modal's close falls back here (Slice-5b D18). -->
    <IconButton id={`item-${item.id}-open`} size="sm" glyph="pencil" title="Open" aria-label={`Open ${ariaName}`} disabled={busy} onclick={onOpen} />
    <IconButton
      size="sm"
      glyph="trash"
      danger
      title={structureReason ?? 'Delete'}
      aria-label={`Delete ${ariaName}`}
      disabled={busy || !!structureReason}
      onclick={onDelete}
    />
  </span>
</div>

<style>
  .item-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border-soft); /* ref 1588 */
  }
  .item-title { min-width: 0; font-size: 13px; font-weight: 600; color: var(--text); overflow-wrap: anywhere; /* ref 1590 */ }
  .item-slug { font-size: 12px; color: var(--muted); /* ref 1591 */ }
  .sep { color: var(--faint); /* ref 1606 — the separator use of --faint */ }
  .q-count { font-size: 12px; color: var(--muted); /* ref 1606 */ }
  .actions { margin-left: auto; display: flex; align-items: center; gap: 6px; /* ref 1593 */ }
</style>
