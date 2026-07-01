<script lang="ts">
  // Editor-side interactive_app surface: previews the stored app in the real
  // strict-sandboxed frame (fetch → inline). The upload/Remove UX is added in a
  // follow-up task. NEVER renders a stored filename as a link (security §6/§9).
  import type { AdminTreeItem } from '../../lib/types';
  import { fetchAssetSource } from '../../lib/assets';
  import InteractiveFrame from './InteractiveFrame.svelte';

  let { item, versionId, editable }: {
    item: AdminTreeItem; versionId: number; editable: boolean;
  } = $props();

  let source = $state<string | null>(null);
  let status = $state<'empty' | 'loading' | 'ready' | 'error'>('empty');

  // Reactive on item.script_url so Replace/Remove re-previews. AbortController +
  // `stale` guard prevent an out-of-order fetch from flashing old source. No
  // coverage here (editor preview only).
  $effect(() => {
    const filename = item.script_url;
    if (!filename) { status = 'empty'; source = null; return; }
    status = 'loading';
    source = null;
    const controller = new AbortController();
    let stale = false;
    void fetchAssetSource(versionId, filename, controller.signal)
      .then((text) => { if (!stale) { source = text; status = 'ready'; } })
      .catch((e: unknown) => {
        if (stale || (e as { name?: string })?.name === 'AbortError') return;
        status = 'error';
        source = null;
      });
    return () => { stale = true; controller.abort(); };
  });
</script>

<section class="app-editor">
  <h3>{item.title}</h3>
  {#if status === 'ready' && source !== null}
    <InteractiveFrame scriptSource={source} title={item.title || 'Interactive app'} />
  {:else if status === 'error'}
    <p class="notice">This app couldn't be loaded.</p>
  {:else if status === 'empty'}
    <p class="notice">{editable ? 'No app uploaded yet. Choose a `.js` file to upload.' : 'No app.'}</p>
  {/if}
</section>

<style>
  .app-editor { margin: var(--space-4) 0; }
  .notice { color: var(--muted, #666); font-style: italic; }
</style>
