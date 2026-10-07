<script lang="ts">
  // Static-page body (3c): the markdown card. Implements ItemBodyApi (§2).
  import { onDestroy, untrack } from 'svelte';
  import MarkdownEditor from '../MarkdownEditor.svelte';
  import { makeDirtyTracker } from '../../../lib/dirty.svelte';
  import { patchItem, reportSaveFailure, type SaveOutcome } from '../../../lib/itemBody';
  import type { AdminTreeItem } from '../../../lib/types';
  import type { AssetContext } from '../../../lib/assetContext';

  let {
    item, vid, assetContext, editable, versionDisabled, frozen, stillOnVid,
    saveDirty = $bindable(false), guardDirty = $bindable(false), busy = $bindable(false),
  }: {
    item: AdminTreeItem; vid: number; assetContext: AssetContext; editable: boolean;
    versionDisabled: boolean; frozen: boolean; stillOnVid: (v: number) => boolean;
    saveDirty?: boolean; guardDirty?: boolean; busy?: boolean;
  } = $props();

  // Seeded once per mount ({#key item.id} upstream); tree reloads never re-seed.
  let saved = untrack(() => item.content_md ?? '');
  const tracker = makeDirtyTracker({ content_md: saved });
  let refreshKey = $state(0);
  let uploading = $state(false);
  let alive = true;
  onDestroy(() => { alive = false; });

  $effect(() => { saveDirty = tracker.isDirty; });
  $effect(() => { guardDirty = tracker.isDirty; });
  $effect(() => { busy = uploading; });

  export function validate(): boolean { return true; }
  export function discard(): void { tracker.reset({ content_md: saved }); }
  export function discardAll(): void { discard(); }

  export async function save(titleDraft: string | undefined): Promise<SaveOutcome> {
    const savedVid = vid;
    const body: Record<string, unknown> = {};
    if (titleDraft !== undefined) body.title = titleDraft;
    if (tracker.isDirty) body.content_md = tracker.current.content_md;
    if (Object.keys(body).length === 0) return { outcome: 'ok' };
    try {
      const echo = await patchItem(item.id, body);
      // D10 per-field write-back: inputs were frozen while the request was out.
      if (alive && 'content_md' in body) {
        saved = echo.content_md ?? '';
        tracker.reset({ content_md: saved });
        refreshKey++; // the sidebar's `used` badges follow the saved content
      }
      return { outcome: 'ok', savedTitle: 'title' in body ? echo.title : undefined };
    } catch (e) {
      reportSaveFailure(e, savedVid, stillOnVid);
      return { outcome: 'failed' };
    }
  }
</script>

{#if versionDisabled}
  <MarkdownEditor {assetContext} value={item.content_md ?? ''} plain />
{:else if !editable}
  <MarkdownEditor {assetContext} value={item.content_md ?? ''} readOnly />
{:else}
  <MarkdownEditor
    {assetContext}
    ariaLabel="Content"
    {frozen}
    bind:value={tracker.current.content_md}
    bind:refreshKey
    bind:uploading
  />
{/if}
