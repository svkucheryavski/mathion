<script lang="ts">
  import type { Item, VersionState } from '../../lib/types';
  import { assertNever } from '../../lib/types';
  import PageItem from './PageItem.svelte';
  import VideoItem from './VideoItem.svelte';
  import UnsupportedItem from './UnsupportedItem.svelte';

  let { item, state: vstate }: { item: Item; state: VersionState } = $props();
  const isCovered = $derived(vstate.items[String(item.id)]?.is_covered ?? false);
</script>

{#if item.type === 'static_page'}
  <PageItem {item} />
{:else if item.type === 'video'}
  <VideoItem {item} {isCovered} />
{:else if item.type === 'quiz'}
  <UnsupportedItem type="quiz" />
{:else if item.type === 'mini_project'}
  <UnsupportedItem type="mini_project" />
{:else if item.type === 'interactive_app'}
  <UnsupportedItem type="interactive_app" />
{:else}
  {@const _x = assertNever(item)}
  {String(_x)}
  <UnsupportedItem type={(item as { type: string }).type} />
{/if}
