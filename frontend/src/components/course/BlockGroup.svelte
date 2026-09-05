<script lang="ts">
  import type { BlockContent, VersionState, StudentMiniProjectListItem } from '../../lib/types';
  import SequenceLink from './SequenceLink.svelte';
  import MiniProjectLink from './MiniProjectLink.svelte';

  let {
    courseSlug,
    block,
    state: vstate,
    mpByBlockId,
  }: {
    courseSlug: string;
    block: BlockContent;
    state: VersionState;
    mpByBlockId?: Record<string, StudentMiniProjectListItem>;
  } = $props();

  let expanded = $state(true);

  // `$derived`, not plain `const`s: a parent re-keying its {#each} swaps `block`,
  // and captured ids would leave `aria-controls` pointing at another card's panel.
  // It is also what keeps this task from trading its two removed a11y warnings for
  // two new `state_referenced_locally` ones.
  const btnId = $derived(`block-${block.id}-acc`);
  const panelId = $derived(`block-${block.id}-panel`);
</script>

<section class="block">
  <header>
    <!-- A real <button>, not the former `<header onclick>`: that form was not
         focusable or keyboard-operable and raised both of this file's a11y
         warnings. The pattern is the one editor/AccordionHeader.svelte:59-71
         already uses — id + aria-expanded + aria-controls, no `type` attribute,
         matching that precedent. -->
    <h2>
      <button
        id={btnId}
        class="acc"
        aria-expanded={expanded}
        aria-controls={panelId}
        onclick={() => (expanded = !expanded)}
      >
        <!-- `B{order}` is a badge (ref 1565), not a prefix: the header used to
             render one combined `B{order}. {title}` string. No trailing period —
             the visible copy becomes `B1 Vectors`. Mono via the GLOBAL `.mono`
             utility (base.css:10), the twin of SequenceLink's S-badge. -->
        <span class="badge mono">B{block.order}</span>
        <span class="acc-title">{block.title}</span>
        <!-- One down-chevron, rotated when collapsed. A STATIC icon would drop the
             only visible collapsed cue, because `{expanded ? '▾' : '▸'}` encoded
             the state as direction and `aria-expanded` alone is invisible.

             13x13, not 16: Constraint 3 pins every new decorative SVG at ~11-14px,
             and the chevron carrying these exact points is 13x13 at BOTH refs the
             spec cites — ref 1559 (the "Collapse" control beside the Blocks
             heading) and the last SVG on ref 1576. The 12x12 SVGs on refs
             1568/1576 are the move-up/move-down arrows and carry DIFFERENT points
             (`4.4,7.2 8,3.6 11.6,7.2`), so they are not this glyph.

             `fill="none"` is load-bearing, not boilerplate: a <polyline> has an
             implicit closing segment for fill purposes and SVG initial fill is
             BLACK, so dropping it turns the hairline into a solid black triangle —
             and `.acc .chev { color: var(--muted) }` cannot correct that, because
             `fill` does not resolve to currentColor. Pinned by the chevron test. -->
        <svg
          class="chev"
          class:collapsed={!expanded}
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="4.6,6.6 8,10 11.4,6.6" /><!-- ref 1559 -->
        </svg>
      </button>
    </h2>
  </header>
  <!-- The panel and ITS CONTENTS are always rendered; only `hidden` gates
       visibility. The former outer `{#if expanded}` is gone entirely, which is
       what keeps `aria-controls` from dangling in the collapsed state. The inner
       `{#if block.info_html}` is RETAINED — without it the padded `.info` would
       draw an empty strip above the first row of every block with no info. -->
  <div id={panelId} role="region" aria-labelledby={btnId} hidden={!expanded}>
    {#if block.info_html}
      <div class="info">{@html block.info_html}</div>
    {/if}
    <ul>
      {#each block.sequences as s (s.id)}
        <li><SequenceLink {courseSlug} sequence={s} state={vstate} /></li>
      {/each}
      {#if mpByBlockId?.[String(block.id)]}
        <li><MiniProjectLink {courseSlug} item={mpByBlockId[String(block.id)]} /></li>
      {/if}
    </ul>
  </div>
</section>

<style>
  /* Ref 3b's block card, stated in full rather than as a delta: the old rule
     bundled `padding` with the load-bearing `margin-bottom`, and that
     `margin-bottom` is the ONLY inter-card gap (CourseView has no wrapper flex
     gap), re-pinned from var(--space-3) (16px) to 10px — do not "restore" 16px.

     `padding: 0` + `overflow: hidden` are what let the rows sit edge-flush so
     their `--border-soft` separators reach the card edge; `background:
     var(--surface)` is load-bearing, not decorative — `CourseView.svelte:63`'s
     `.page` sets no background, so without it the card inherits `--bg` (#FBFBFC)
     and both the `--surface-2` header strip and the row separators lose their
     tint step. */
  .block {
    padding: 0;
    overflow: hidden;
    margin-bottom: 10px; /* ref 1563 */
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  /* The header STRIP. `--border` (not `--border-soft`) because this is the
     card/section edge, not a row separator inside it — the role split recorded
     for ref 1564/1572's shared #E9EBEF. The old `justify-content: space-between`
     and `cursor: pointer` are gone: the button owns both the click and the
     layout now. */
  header {
    background: var(--surface-2);
    padding: 9px 12px; /* ref 1564 */
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
  }
  /* Load-bearing: the default `flex: 0 1 auto` shrink-wraps the <h2> to its
     max-content, so `.acc { width: 100% }` would resolve against a content-width
     box — the chevron could not reach the card edge and the click target would
     shrink to the title. Its siblings here are none, so a zero basis is safe. */
  header h2 {
    flex: 1;
    min-width: 0;
  }
  /* 14px explicitly: base.css:17 sets h2 to 15px, and the title inherits from
     here (ref 1566). The badge overrides back down to 11px/500 below. */
  .acc {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px; /* ref 1564, badge↔title */
    text-align: left;
    font-size: 14px;
    font-weight: 600;
  }
  /* ref 1565 — the twin of SequenceLink's `S{order}` badge (ref 1573). */
  .badge {
    font-size: 11px;
    font-weight: 500;
    color: var(--primary);
    background: var(--primary-soft);
    padding: 2px 6px;
    border-radius: var(--radius-pill);
  }
  /* `color` is load-bearing: deleting the old `.toggle { color: var(--muted) }`
     and leaving this unstyled lets it inherit `--text` through reset.css:7's
     `button { color: inherit }`, against mathion-visual-spec.md:176 / ref 1559. */
  .acc .chev {
    color: var(--muted);
    margin-left: auto;
  }
  /* no ref — Constraint 5(b) geometry literal: the reference ships a separate
     right-pointing glyph, and rotating the one down-chevron is what keeps the two
     states a single source of truth. -90deg points it left-to-right. */
  .acc .chev.collapsed {
    transform: rotate(-90deg);
  }
  /* Padding lives here, not on the panel: the panel carries none so the rows stay
     flush to the card edge. `margin: 0` zeroes the old `var(--space-2) 0`. */
  .info {
    color: var(--muted);
    padding: var(--space-2) var(--space-3);
    margin: 0;
  }
  /* The rows carry `border-bottom: 1px solid var(--border-soft)` and `.block`
     carries its own `--border`, so the last row would draw a hairline directly
     above the card edge. The ancestor-scoped `:global()` form is the one §Scope
     sanctions; it reaches the `.row` rules T7 authors, which is why T7 precedes
     T8a — landed the other way round this selector would be inert. */
  ul li:last-child :global(.row) {
    border-bottom: 0;
  }
</style>
