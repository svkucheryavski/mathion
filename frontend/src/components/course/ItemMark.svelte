<script lang="ts">
  import type { ItemMarkState, ItemMarkType } from '../../lib/types';

  // Presentational only (D5): a 22px square carrying an 11px type mark, in one
  // of three completion states. It takes no `class` and no other props — a
  // consumer needing its own styling wraps it in a span it owns.
  //
  // `state` defaults so a consumer with no state to give — MiniProjectLink's
  // single flag (T7) — need not supply one.
  // `inStrip` (D62): the player's item strip look; only ItemIcon passes it.
  let { type, state = 'not-yet', inStrip = false }: { type: ItemMarkType; state?: ItemMarkState; inStrip?: boolean } = $props();

  // Item-type marks are transcribed verbatim from the "Item types" card of the
  // visual-system reference (docs/design/visual-refresh/reference-screens.dc.html).
  // All share viewBox 0 0 16 16, stroke-width 1.6 EXCEPT the quiz check (1.9).
  // Filled shapes keep their per-element fill="currentColor" stroke="none" so the
  // play triangle / slider knobs / flag render solid; the mark colour follows the
  // square's `color` via currentColor, which each state rule sets.
</script>

<!-- aria-hidden with NO text node: every consumer names the thing elsewhere —
     ItemIcon's `aria-label`, the course rows' `aria-label` ("Sequence: …, 2 of 3
     items completed"). A label here would be a second, unlabelled reading of
     the same fact. -->
<span class="item-mark {state}" class:in-strip={inStrip} aria-hidden="true">
  <svg
    width="11"
    height="11"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width={type === 'quiz' ? '1.9' : '1.6'}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {#if type === 'static_page'}
      <line x1="3" y1="4" x2="13" y2="4" /><line x1="3" y1="8" x2="13" y2="8" /><line x1="3" y1="12" x2="9" y2="12" />
    {:else if type === 'video'}
      <polygon points="5,3.4 13,8 5,12.6" fill="currentColor" stroke="none" />
    {:else if type === 'quiz'}
      <polyline points="3,8.6 6.4,12 13,4.6" />
    {:else if type === 'interactive_app'}
      <line x1="4" y1="2.6" x2="4" y2="13.4" /><line x1="8" y1="2.6" x2="8" y2="13.4" /><line x1="12" y1="2.6" x2="12" y2="13.4" /><circle cx="4" cy="10" r="1.9" fill="currentColor" stroke="none" /><circle cx="8" cy="5.4" r="1.9" fill="currentColor" stroke="none" /><circle cx="12" cy="8.6" r="1.9" fill="currentColor" stroke="none" />
    {:else if type === 'mini_project'}
      <line x1="4.2" y1="2.4" x2="4.2" y2="13.6" /><polygon points="4.2,3.2 12.4,5.8 4.2,8.4" fill="currentColor" stroke="none" />
    {:else if type === 'sequence'}
      <!-- Not an item type: the open book on a sequence's row (user, 2026-10-08). -->
      <path d="M8 4.6C6.4 3.5 4.6 3.1 2.6 3.3V12.7C4.6 12.5 6.4 12.9 8 14C9.6 12.9 11.4 12.5 13.4 12.7V3.3C11.4 3.1 9.6 3.5 8 4.6Z" /><line x1="8" y1="4.6" x2="8" y2="14" />
    {/if}
  </svg>
</span>

<style>
  /* The 22px square, moved here off ItemIcon's `.icon` (which is now a bare
     wrapper — leaving the box there would nest one bordered square inside
     another and render a visible double ring).

     `box-sizing` keeps the square fixed across states whose borders differ
     (1px vs the current-state 1.5px). `flex: 0 0 auto` keeps the locked 22px
     wherever a mark lands as a flex child (the default `flex-shrink: 1` would
     compress it on a tight line); both reference tiles carry it. It is inert in
     the single-child `.icon` / `.row-glyph` / `.seq-glyph` wrappers.

     No `color` here on purpose — the mark colour belongs to the state rules
     below, and `state` defaults to `not-yet`, so one of them always applies. */
  /* box geometry: ref 2113; the 1px not-yet hairline: ref 1438 / ref 2116;
     the current state's 1.5px ring: ref 1040 / ref 2115. (The earlier form of
     this comment cited 1439, a bare `</div>`, and 1039, a row of COVERED
     marks — both off by one, and 2113 is covered, not a hairline.) */
  .item-mark {
    box-sizing: border-box;
    width: 22px;
    height: 22px;
    flex: 0 0 auto; /* ref 2113 */
    border-radius: var(--radius);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  /* covered = done: solid primary fill, white mark. */
  .item-mark.covered {
    background: var(--primary);
    color: var(--primary-text);
    border-color: var(--primary);
  }
  /* current = in progress: soft primary fill, primary mark, 1.5px primary ring. */
  .item-mark.current {
    background: var(--primary-soft);
    color: var(--primary);
    border: 1.5px solid var(--primary);
  }
  /* not-yet = not started: surface fill, muted mark, strong hairline. No opacity. */
  .item-mark.not-yet {
    background: var(--surface);
    color: var(--muted);
    border-color: var(--border-strong);
  }

  /* The three states above differ ONLY by colour, and Windows High Contrast
     forces background-color, color, border-COLOR and the SVG's stroke/fill to
     system colours — so `covered` and `not-yet` collapse into one appearance and
     a sighted high-contrast user loses per-item completion entirely. Nothing
     else carries it: the mark is aria-hidden by design, and ItemIcon's `title` /
     `aria-label` give the item's TITLE, not its state — and in the sequence
     player's strip these marks ARE the per-item completion signal.

     border-WIDTH and border-STYLE are NOT forced, so each state is restated with
     a distinction that survives even a monochrome theme:
       covered = inverted SOLID FILL      current = 2px ring      not-yet = DASHED
     System-colour keywords inside a forced-colors block are the required a11y
     treatment rather than a Constraint-1 token violation (spec:255), and this is
     the same idiom Login and all four question components already use. */
  @media (forced-colors: active) {
    .item-mark.covered {
      background: CanvasText;
      color: Canvas;
      border: 1px solid CanvasText;
    }
    .item-mark.current {
      background: Canvas;
      color: Highlight;
      border: 2px solid Highlight;
    }
    .item-mark.not-yet {
      background: Canvas;
      color: GrayText;
      border: 1px dashed GrayText;
    }
  }
  /* D62: the player's strip. The current item is a wider tab whose 2px border
     runs on three sides; ItemIcon's margin lays it over the sheet's 2px top
     edge, so tab and sheet read as one shape (SequencePlayer lifts the strip
     above the sheet). The spacing lives on ItemIcon's button, not here: a
     margin on this span would grow the inline-flex button and pull its focus
     ring off the mark. */
  .item-mark.in-strip.current {
    width: 32px;
    height: 31px;
    border-width: 2px 2px 0;
    border-radius: var(--radius) var(--radius) 0 0;
    padding-bottom: 2px;
  }
  /* Done is pale gray, not done is steel blue, like the main buttons (the
     reverse of the shared look, which the teacher breakdown keeps). The colours
     sit under forced-colors:none: these rules out-specify the High Contrast
     block above and would otherwise replace its solid done fill. */
  @media (forced-colors: none) {
    .item-mark.in-strip.covered {
      background: var(--border);
      color: var(--muted);
      border-color: var(--border-strong);
    }
    .item-mark.in-strip.not-yet {
      background: var(--primary);
      color: var(--primary-text);
      border-color: var(--primary);
    }
    .item-mark.in-strip.current {
      background: var(--surface);
      color: var(--primary);
      border-color: var(--border);
    }
  }
</style>
