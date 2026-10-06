<script lang="ts">
  // Block / sequence accordion header (3b, ref 1564-1568 block, 1572-1576
  // sequence). The accessible toggle is the title button inside the section
  // heading; the chevron at the far right is a pointer convenience only (D14).
  import type { Snippet } from 'svelte';
  import { labelFor } from '../../lib/labelFor';
  import IconButton from '../ui/IconButton.svelte';

  type Props = {
    headerId: string;
    panelId: string;
    level: 'block' | 'sequence';
    // Code badge: 'B1' / 'S1' (ref 1565).
    badge: string;
    title: string | null;
    slug: string | null;
    index: number;
    expanded: boolean;
    busy: boolean;
    // Non-null when the version forbids structure changes; disables the
    // arrows with this reason as their title.
    structureReason: string | null;
    // "Not at the boundary in that direction". The arrows ALWAYS render
    // (§4 keep the slot count fixed); a boundary arrow is disabled with a
    // reason instead of omitted.
    canReorderUp: boolean;
    canReorderDown: boolean;
    onToggle: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    // Extra right-group control before the chevron (the block's `+`).
    extra?: Snippet;
  };

  let {
    headerId,
    panelId,
    level,
    badge,
    title,
    slug,
    index,
    expanded,
    busy,
    structureReason,
    canReorderUp,
    canReorderDown,
    onToggle,
    onMoveUp,
    onMoveDown,
    extra,
  }: Props = $props();

  // Placeholder text when both title and slug are missing. Visible form
  // wraps it in parens to mark "this is a placeholder, not a real name";
  // aria-label uses the plain form so screen readers don't announce stray
  // punctuation.
  const placeholder = $derived(`${level} ${index}`);
  const ariaName = $derived(labelFor(title, slug, placeholder));
  const visibleTitle = $derived(title?.trim() || slug?.trim() || `(${placeholder})`);

  // Title precedence: structure reason → boundary → normal.
  const upTitle = $derived(structureReason ?? (canReorderUp ? 'Move up' : 'Move up — already first'));
  const downTitle = $derived(structureReason ?? (canReorderDown ? 'Move down' : 'Move down — already last'));
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
    <span class="mono code">{badge}</span>
    <span class="title">{visibleTitle}</span>
    {#if title?.trim() && slug?.trim()}
      <span class="mono slug" aria-hidden="true">/{slug}</span>
    {/if}
  </button>
{/snippet}

<div class="acc-row" class:block={level === 'block'} class:seq={level === 'sequence'} class:open={expanded}>
  {#if level === 'block'}
    <h3 class="hd">{@render toggle()}</h3>
  {:else}
    <h4 class="hd">{@render toggle()}</h4>
  {/if}
  <span class="actions">
    <IconButton
      size="sm"
      glyph="up"
      title={upTitle}
      aria-label={`Move ${level} up: ${ariaName}`}
      disabled={busy || !!structureReason || !canReorderUp}
      onclick={onMoveUp}
    />
    <IconButton
      size="sm"
      glyph="down"
      title={downTitle}
      aria-label={`Move ${level} down: ${ariaName}`}
      disabled={busy || !!structureReason || !canReorderDown}
      onclick={onMoveDown}
    />
    {@render extra?.()}
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
  </span>
</div>

<style>
  .acc-row { display: flex; align-items: center; gap: 10px; /* ref 1564 */ }
  .block { padding: 9px 12px; background: var(--surface-2); /* ref 1564 */ }
  .block.open { border-bottom: 1px solid var(--border); /* ref 1564 vs 1630 */ }
  /* D10: the sequence header has no border; its body supplies the top rule. */
  .seq { padding: 8px 12px; background: var(--surface); /* ref 1572 */ }
  .hd { margin: 0; flex: 1 1 auto; min-width: 0; font: inherit; }
  /* No hover background — the strip tint is the affordance. */
  .toggle {
    display: flex;
    align-items: center;
    gap: 10px; /* ref 1564 */
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .code {
    font-size: 11px;
    font-weight: 500;
    color: var(--primary);
    background: var(--primary-soft);
    padding: 2px 6px;
    border-radius: 3px; /* ref 1565 */
  }
  .title { font-size: 14px; font-weight: 600; min-width: 0; overflow-wrap: anywhere; /* ref 1566 */ }
  .seq .title { font-size: 13.5px; /* D11 — visual-spec :265-266 over ref 1574's 13px */ }
  .slug { font-size: 12px; color: var(--muted); /* ref 1567 */ }
  .actions { display: flex; align-items: center; gap: 6px; /* ref 1568 */ }
</style>
