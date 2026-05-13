<script lang="ts">
  import { labelFor } from '../../lib/labelFor';

  type Props = {
    headerId: string;
    panelId: string;
    level: 'block' | 'sequence';
    title: string | null;
    slug: string | null;
    index: number;
    expanded: boolean;
    dirty: boolean;
    busy: boolean;
    canReorderUp: boolean;
    canReorderDown: boolean;
    onToggle: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
  };

  let {
    headerId,
    panelId,
    level,
    title,
    slug,
    index,
    expanded,
    dirty,
    busy,
    canReorderUp,
    canReorderDown,
    onToggle,
    onMoveUp,
    onMoveDown,
  }: Props = $props();

  const ariaName = $derived(labelFor(title, slug, `${level} ${index}`));
</script>

<div class="accordion-row">
  <button
    id={headerId}
    aria-expanded={expanded}
    aria-controls={panelId}
    aria-label={ariaName}
    onclick={onToggle}
    class="toggle"
  >
    <span class="title">{title?.trim() || slug?.trim() || `(${level} ${index})`}</span>
    {#if title?.trim() && slug?.trim()}
      <span class="slug" aria-hidden="true">/{slug}</span>
    {/if}
  </button>
  <button
    aria-label={`Move ${level} up: ${ariaName}`}
    onclick={onMoveUp}
    disabled={!canReorderUp || dirty || busy}
    title={dirty ? 'Save or discard changes first' : ''}
  >↑</button>
  <button
    aria-label={`Move ${level} down: ${ariaName}`}
    onclick={onMoveDown}
    disabled={!canReorderDown || dirty || busy}
    title={dirty ? 'Save or discard changes first' : ''}
  >↓</button>
</div>

<style>
  .accordion-row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); border-bottom: 1px solid var(--border); }
  .toggle { flex: 1; display: flex; align-items: center; gap: var(--space-2); background: transparent; border: 0; cursor: pointer; text-align: left; font-size: 1rem; padding: var(--space-1) var(--space-2); }
  .toggle:hover { background: var(--surface-hover, #f5f5f5); }
  .title { font-weight: 600; }
  .slug { color: var(--muted); font-size: 0.85rem; }
</style>
