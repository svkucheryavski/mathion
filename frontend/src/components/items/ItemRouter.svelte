<script lang="ts">
  import type { Item, VersionState } from '../../lib/types';
  import { assertNever } from '../../lib/types';
  import PageItem from './PageItem.svelte';
  import VideoItem from './VideoItem.svelte';
  import InteractiveAppItem from './InteractiveAppItem.svelte';
  import QuizItem from './QuizItem.svelte';
  import UnsupportedItem from './UnsupportedItem.svelte';

  let { item, state: vstate }: { item: Item; state: VersionState } = $props();
  const isCovered = $derived(vstate.items[String(item.id)]?.is_covered ?? false);
</script>

<!-- C13: each item gets its own component instance, so quiz → quiz never
     carries the first quiz's answers and result over. -->
{#key item.id}
{#if item.type === 'static_page'}
  <PageItem {item} />
{:else if item.type === 'video'}
  <VideoItem {item} {isCovered} />
{:else if item.type === 'quiz'}
  <QuizItem {item} />
{:else if item.type === 'mini_project'}
  <UnsupportedItem />
{:else if item.type === 'interactive_app'}
  <InteractiveAppItem {item} {isCovered} />
{:else}
  {@const _x = assertNever(item)}
  {String(_x)}
  <UnsupportedItem />
{/if}
{/key}
