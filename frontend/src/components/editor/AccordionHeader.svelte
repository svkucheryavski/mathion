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
    // canReorderUp / canReorderDown gate **visibility** of each arrow.
    // The parent passes `canStructure && index > 1` and
    // `canStructure && index < count` respectively, so each flag is
    // false in two cases: (a) the version is not structurally editable
    // (published/archived/disabled — both arrows disappear), and (b)
    // the row is at the boundary in that direction (first row has no
    // up arrow; last row has no down arrow). Either case is "no
    // recovery action available", so the user gets the cleaner read by
    // omitting the control entirely. Dirty/busy disable — both cases
    // have a recovery action (save, or wait) — keep the button visible
    // and use the disabled attribute + tooltip instead (smoke item 22).
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
  {#if canReorderUp}
    <button
      aria-label={`Move ${level} up: ${ariaName}`}
      onclick={onMoveUp}
      disabled={dirty || busy}
      title={dirty ? 'Save or discard changes first' : ''}
    >↑</button>
  {/if}
  {#if canReorderDown}
    <button
      aria-label={`Move ${level} down: ${ariaName}`}
      onclick={onMoveDown}
      disabled={dirty || busy}
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
