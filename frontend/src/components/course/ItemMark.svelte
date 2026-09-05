<script lang="ts">
  import type { Item, ItemMarkState } from '../../lib/types';

  // Presentational only (D5): a 22px square carrying an 11px type mark, in one
  // of three completion states. It takes no `class` and no other props — a
  // consumer needing its own styling wraps it in a span it owns.
  //
  // `state` defaults so a consumer with no state to give — MiniProjectLink's
  // single flag (T7) — need not supply one.
  let { type, state = 'not-yet' }: { type: Item['type']; state?: ItemMarkState } = $props();

  // Item-type marks are transcribed verbatim from the "Item types" card of the
  // visual-system reference (docs/design/visual-refresh/reference-screens.dc.html).
  // All share viewBox 0 0 16 16, stroke-width 1.6 EXCEPT the quiz check (1.9).
  // Filled shapes keep their per-element fill="currentColor" stroke="none" so the
  // play triangle / slider knobs / flag render solid; the mark colour follows the
  // square's `color` via currentColor, which each state rule sets.
</script>

<!-- aria-hidden with NO text node: the chain of these in SequenceLink (T7)
     carries no accessible name, because completion reaches assistive tech
     through the sibling mono {covered}/{total} count instead. A label here
     would be a second, unlabelled reading of the same fact. -->
<span class="item-mark {state}" aria-hidden="true">
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
    {/if}
  </svg>
</span>

<style>
  /* The 22px square, moved here off ItemIcon's `.icon` (which is now a bare
     wrapper — leaving the box there would nest one bordered square inside
     another and render a visible double ring).

     `box-sizing` keeps the square fixed across states whose borders differ
     (1px vs the current-state 1.5px). `flex: 0 0 auto` is load-bearing: as a
     direct child of T7's `.chain` flex container the default `flex-shrink: 1`
     would let these compress below the locked 22px on a tight line; both
     reference tiles carry it. It is inert in the single-child `.icon` /
     `.row-glyph` wrappers.

     No `color` here on purpose — the mark colour belongs to the state rules
     below, and `state` defaults to `not-yet`, so one of them always applies. */
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
</style>
