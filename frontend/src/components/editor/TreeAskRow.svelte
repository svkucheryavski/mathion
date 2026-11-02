<script lang="ts">
  // Polish 1 (#3, #4, #5): the course tree's question, under the node that
  // asked. One InPlaceAsk serves the whole tree (R53); each node draws it only
  // for its own key. It goes quietly when the node leaves the focus (`live`
  // false: a route change, whose own focus applies), and when the node goes
  // (R49): then focus that was in it moves to `fallback`.
  import { untrack } from 'svelte';
  import AskSlot from '../ui/AskSlot.svelte';
  import { focusAfter, focusIsFree, type InPlaceAsk } from '../../lib/askInPlace.svelte';

  type Props = {
    ask: InPlaceAsk;
    askKey: string;
    live?: boolean;
    fallback?: () => Element | null | undefined;
  };
  let { ask, askKey, live = true, fallback }: Props = $props();

  // Kept past unmount: the teardown asks whether focus was inside it.
  let wrap: HTMLElement | null = null;
  const mine = () => ask.current?.key === askKey;

  $effect(() => {
    if (!live) untrack(() => { if (mine()) ask.dismiss(); });
  });
  $effect(() => {
    const [a, k, fb] = untrack(() => [ask, askKey, fallback] as const);
    return () => {
      if (a.current?.key !== k) return;
      const free = focusIsFree(wrap);
      a.dismiss();
      if (free && fb) void focusAfter(fb);
    };
  });
</script>

{#if mine()}
  <div class="tree-ask" {@attach (el) => { wrap = el; }}><AskSlot {ask} /></div>
{/if}

<style>
  /* The cards clip (overflow: hidden): the padding keeps the focus ring inside. */
  .tree-ask { padding: 6px 12px; }
</style>
