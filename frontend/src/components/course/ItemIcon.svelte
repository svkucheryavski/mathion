<script lang="ts">
  import type { Item, ItemMarkState } from '../../lib/types';
  import ItemMark from './ItemMark.svelte';

  // The local `type State` union moved to `types.ts` as `ItemMarkState`, shared
  // with the ItemMark this now composes.
  let { item, state: istate, onclick }: { item: Item; state: ItemMarkState; onclick: () => void } = $props();
</script>

<button
  class="icon {istate}"
  data-type={item.type}
  {onclick}
  title={item.title}
  aria-label={item.title}
>
  <!-- `state` MUST be forwarded: the visual state now lives on the child, so
       dropping it here would leave the button's own state class intact while
       every mark rendered as the default `not-yet`. -->
  <ItemMark type={item.type} state={istate} />
</button>

<style>
  /* A bare wrapper. The 22px bordered square and all three state treatments
     moved to ItemMark — keeping them here as well would nest one bordered
     square inside another and render a visible double ring.

     What remains is only what the global button reset (reset.css:8, which
     already zeroes padding/border/background and sets cursor) does NOT give:
     `display:inline-flex` so the button shrink-wraps its mark, and
     `border-radius` so the global focus ring (base.css) stays
     rounded on the now-bare button.

     The state class stays in the class attribute — ItemIcon's own tests pin it
     there — but it deliberately carries no rule of its own any more. */
  .icon {
    display: inline-flex;
    border-radius: var(--radius);
  }
</style>
