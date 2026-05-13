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
    // Gates whether reorder ↑/↓ render at all. When false (e.g., on a
    // published or archived version, or a disabled one), the buttons are
    // omitted from the DOM entirely — matching ItemRow's pattern and the
    // old BlockEditPage's `{#if perms.canEditStructure}` wrapper. The raw
    // native <button disabled> form has no `:disabled` CSS rule here, so
    // a greyed-out button would look indistinguishable from an active one
    // and the user can't tell why nothing happens on click.
    canStructure: boolean;
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
    canStructure,
    canReorderUp,
    canReorderDown,
    onToggle,
    onMoveUp,
    onMoveDown,
  }: Props = $props();

  // Placeholder text when both title and slug are missing. Visible form
  // wraps it in parens to mark "this is a placeholder, not a real name";
  // aria-label uses the plain form so screen readers don't announce stray
  // punctuation.
  const placeholder = $derived(`${level} ${index}`);
  const ariaName = $derived(labelFor(title, slug, placeholder));
  const visibleTitle = $derived(title?.trim() || slug?.trim() || `(${placeholder})`);
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
    <span class="title">{visibleTitle}</span>
    {#if title?.trim() && slug?.trim()}
      <span class="slug" aria-hidden="true">/{slug}</span>
    {/if}
  </button>
  {#if canStructure}
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
  {/if}
</div>

<style>
  .accordion-row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); border-bottom: 1px solid var(--border); }
  .toggle { flex: 1; display: flex; align-items: center; gap: var(--space-2); background: transparent; border: 0; cursor: pointer; text-align: left; font-size: 1rem; padding: var(--space-1) var(--space-2); }
  .toggle:hover { background: var(--surface-hover, #f5f5f5); }
  .title { font-weight: 600; }
  .slug { color: var(--muted); font-size: 0.85rem; }
</style>
