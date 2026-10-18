<script lang="ts">
  import type { BlockContent, VersionState, StudentMiniProjectListItem } from '../../lib/types';
  import { progressOf, progressPhrase } from '../../lib/progress';
  import SequenceLink from './SequenceLink.svelte';
  import MiniProjectLink from './MiniProjectLink.svelte';
  import ProgressMeter from './ProgressMeter.svelte';

  let {
    courseSlug,
    block,
    n,
    state: vstate,
    mpByBlockId,
    // Bindable (user, 2026-10-08): CourseView decides which blocks start open
    // (the current block) and drives "Collapse all / Expand all". Unbound, a
    // block starts open; the header click toggles it either way.
    expanded = $bindable(true),
  }: {
    courseSlug: string;
    block: BlockContent;
    // The block's place in the course (1-based), as the editor numbers it:
    // `block.order` keeps gaps after a delete (final review, both lanes).
    n: number;
    state: VersionState;
    mpByBlockId?: Record<string, StudentMiniProjectListItem>;
    expanded?: boolean;
  } = $props();

  // `$derived`, not plain `const`s: a parent re-keying its {#each} swaps `block`,
  // and captured ids would leave `aria-controls` pointing at another card's panel.
  // It is also what keeps this task from trading its two removed a11y warnings for
  // two new `state_referenced_locally` ones.
  const btnId = $derived(`block-${block.id}-acc`);
  const panelId = $derived(`block-${block.id}-panel`);
  // The block's totals over every sequence's items (user, 2026-10-08), shown in
  // the header whether the block is open or closed — a subtotal above its rows.
  const p = $derived(progressOf(block.sequences.flatMap((s) => s.items), vstate));
  // The button's name: the title, then the totals in words (the bar and chip
  // are aria-hidden). An aria-label as on SequenceLink, not a visually hidden
  // span: Chrome blockifies an absolutely positioned span and read "Title , …".
  // It starts with the visible "1. Title", so voice control still matches it.
  // The number is in the name although `.num` is aria-hidden (Opus lane): the
  // blocks are sibling sections, not a list, so nothing else states it.
  const label = $derived(`${n}. ${block.title}, ${progressPhrase(p)}`);
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
        aria-label={label}
        onclick={() => (expanded = !expanded)}
      >
        <!-- "1." like the admin editor (user, 2026-10-08): "B1" was the last
             structure code a student saw. A light ordinal, aria-hidden: the
             button's aria-label states "1. Title" in words. -->
        <span class="num" aria-hidden="true">{n}.</span>
        <span class="acc-title">{block.title}</span>
        <ProgressMeter {p} onStrip />
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
  /* 15px, the admin block-title size (user, 2026-10-08; was 14px, ref 1566).
     The meter cells set their own sizes. */
  .acc {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px; /* ref 1564 */
    text-align: left;
    font-size: 15px;
    font-weight: 600;
    /* So the global focus ring (base.css) follows the card corner
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
     SequenceLink's `.row-title`, where the title collapsed instead.
     `flex: 1 1 auto` (2026-10-08): the title takes the free space, so the
     totals sit in the bar/chip columns right before the chevron. */
  .acc-title {
    flex: 1 1 auto;
    min-width: 0;
    /* The totals sit to the right now: a long unbroken word must wrap, not
       paint over the bar and chip (the admin AccordionHeader .title does too). */
    overflow-wrap: anywhere;
  }
  /* The admin `.num` (AccordionHeader): 15px/600 in `--ordinal`, lighter than
     `--muted` on purpose (decorative, aria-hidden). The -4px pulls the title in
     to the admin's 6px spacing from the button's 10px gap. */
  .num {
    flex: none;
    margin-right: -4px;
    color: var(--ordinal);
    font-variant-numeric: tabular-nums;
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
