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
         warnings. The pattern is the one editor/AccordionHeader.svelte:67-82
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
             utility (base.css:10). (Its old twin, SequenceLink's S-badge, became an
             open-book icon on 2026-10-08; block badges stay.) -->
        <span class="badge mono">B{block.order}</span>
        <span class="acc-title">{block.title}</span>
        <!-- One down-chevron, rotated when collapsed. A STATIC icon would drop the
             only visible collapsed cue, because `{expanded ? '▾' : '▸'}` encoded
             the state as direction and `aria-expanded` alone is invisible.

             13x13, not 16: Constraint 3 pins every new decorative SVG at ~11-14px,
             and the glyph carrying these exact points is 13x13 in every place it
             appears — ref 1559, the "Collapse" control beside the Blocks heading,
             and the LAST SVG on each of the two refs the spec cites, 1568 and
             1576. The 12x12 SVGs on those same two lines are the move-up /
             move-down arrows and carry DIFFERENT points (`4.4,7.2 8,3.6
             11.6,7.2`), which is the confusion to avoid: the spec cites 1568/1576
             for the POINTS, and the size at those refs is 13, not the 12 of the
             arrows beside them.

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
       visibility (keeps `aria-controls` valid when collapsed). Block info is
       not shown (Slice-5c D7; the data stays). -->
  <div id={panelId} role="region" aria-labelledby={btnId} hidden={!expanded}>
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
  /* The header STRIP. It draws NO bottom border — that separator lives on the
     panel below, for the reason recorded there. The old `justify-content:
     space-between` and `cursor: pointer` are gone: the button owns both the click
     and the layout now. */
  header {
    background: var(--surface-2);
    padding: 9px 12px; /* ref 1564 */
    display: flex;
    align-items: center;
  }
  /* The header/panel separator, and it lives on the PANEL deliberately. Carried
     on the header it was drawn unconditionally, so a COLLAPSED card — whose panel
     is `hidden`, i.e. `display: none` — put this 1px line directly on top of
     `.block`'s own 1px border with zero gap between them, and the collapsed card's
     bottom edge rendered at twice the weight of its other three sides. The
     reference is explicit about the two states: ref 1630, the collapsed B2 card,
     omits the header border entirely, while ref 1564's expanded header carries it.
     Owning it here reproduces both states from one rule — no state class, no
     `:has()` — and expanded rendering is unchanged: same 1px, same token, same y.
     This is the same defect class as the last-row double hairline that
     `li:last-child` fixes at the end of this block, in the state T8a introduces.

     `--border` (not `--border-soft`) because this is a card/section edge, not a
     row separator inside a card — the role split recorded for ref 1564/1572's
     shared #E9EBEF. */
  [role='region'] {
    border-top: 1px solid var(--border);
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
    /* So the global :focus-visible halo (base.css:21-25) follows the card corner
       instead of drawing square. Exactly what D5 added to ItemIcon's button, and
       this is the more prominent keyboard target of the two. */
    border-radius: var(--radius);
  }
  /* The title, and the half of the long-title fix that lives on it. Without
     `min-width: 0` a flex item keeps an automatic minimum of its MIN-CONTENT, so
     one unbroken word longer than the card pushes `.acc` past its own width,
     `margin-left: auto` is left with no free space, and the chevron is carried
     outside the card where `.block { overflow: hidden }` clips it. Measured in a
     browser on a 340px card with a 43-character word: the chevron ended 51px
     outside the card edge at 0px wide, and 111px outside at 280px. With this and
     the `.chev` rule below it sits correctly at 13px in every case, and both are
     exact no-ops at ordinary title lengths — the short-title measurements are
     identical with and without them. The mirror image of the fix T7 needed on
     SequenceLink's `.row-title`, where the title collapsed instead. */
  .acc-title {
    min-width: 0;
  }
  /* ref 1565. Its old twin, SequenceLink's `S{order}` badge, is gone (2026-10-08). */
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
    /* The other half: a flex item shrinks by default, and this one has no text to
       floor it, so under the overflow above it went to ZERO width — the glyph
       vanished before it was clipped. Ref 1559 carries `flex:0 0 auto` on the
       chevron wrapper for the same reason, as does `.item-mark` per codex-r20-I3. */
    flex: 0 0 auto;
  }
  /* no ref — Constraint 5(b) geometry literal: the reference ships a separate
     right-pointing glyph, and rotating the one down-chevron is what keeps the two
     states a single source of truth. -90deg points it left-to-right. */
  .acc .chev.collapsed {
    transform: rotate(-90deg);
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
