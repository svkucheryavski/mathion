<script lang="ts">
  import type { Item } from '../../lib/types';

  type State = 'covered' | 'current' | 'not-yet';
  let { item, state: istate, onclick }: { item: Item; state: State; onclick: () => void } = $props();

  // Item-type marks are transcribed verbatim from the "Item types" card of the
  // visual-system reference (docs/design/visual-refresh/reference-screens.dc.html).
  // All share viewBox 0 0 16 16, stroke-width 1.6 EXCEPT the quiz check (1.9).
  // Filled shapes keep their per-element fill="currentColor" stroke="none" so the
  // play triangle / slider knobs / flag render solid; the mark colour follows the
  // button's `color` via currentColor, which each state sets.
</script>

<button
  class="icon {istate}"
  data-type={item.type}
  {onclick}
  title={item.title}
  aria-label={item.title}
>
  <svg
    width="11"
    height="11"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width={item.type === 'quiz' ? '1.9' : '1.6'}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {#if item.type === 'static_page'}
      <line x1="3" y1="4" x2="13" y2="4" /><line x1="3" y1="8" x2="13" y2="8" /><line x1="3" y1="12" x2="9" y2="12" />
    {:else if item.type === 'video'}
      <polygon points="5,3.4 13,8 5,12.6" fill="currentColor" stroke="none" />
    {:else if item.type === 'quiz'}
      <polyline points="3,8.6 6.4,12 13,4.6" />
    {:else if item.type === 'interactive_app'}
      <line x1="4" y1="2.6" x2="4" y2="13.4" /><line x1="8" y1="2.6" x2="8" y2="13.4" /><line x1="12" y1="2.6" x2="12" y2="13.4" /><circle cx="4" cy="10" r="1.9" fill="currentColor" stroke="none" /><circle cx="8" cy="5.4" r="1.9" fill="currentColor" stroke="none" /><circle cx="12" cy="8.6" r="1.9" fill="currentColor" stroke="none" />
    {:else if item.type === 'mini_project'}
      <line x1="4.2" y1="2.4" x2="4.2" y2="13.6" /><polygon points="4.2,3.2 12.4,5.8 4.2,8.4" fill="currentColor" stroke="none" />
    {/if}
  </svg>
</button>

<style>
  /* 22px rounded square carrying an 11px mark. box-sizing keeps the square fixed
     across states whose borders differ (1px vs the current-state 1.5px). Base is
     the not-yet treatment; states override background / colour / border. The mark
     inherits `color` via currentColor. */
  .icon {
    box-sizing: border-box;
    width: 22px;
    height: 22px;
    border-radius: var(--radius);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  /* covered = done: solid primary fill, white mark. */
  .covered {
    background: var(--primary);
    color: var(--primary-text);
    border-color: var(--primary);
  }
  /* current = in progress: soft primary fill, primary mark, 1.5px primary ring. */
  .current {
    background: var(--primary-soft);
    color: var(--primary);
    border: 1.5px solid var(--primary);
  }
  /* not-yet = not started: surface fill, muted mark, strong hairline. No opacity. */
  .not-yet {
    background: var(--surface);
    color: var(--muted);
    border-color: var(--border-strong);
  }
</style>
