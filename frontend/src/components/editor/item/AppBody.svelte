<script lang="ts">
  // Interactive-app body (D4; no artboard, so it borrows 3e). Implements
  // ItemBodyApi (§2). The App script row acts immediately (files, not drafts);
  // the footer Save sends only the title. Previews the stored app in the real
  // strict-sandboxed frame (fetch → inline). NEVER renders a stored filename as
  // a link (security §6/§9).
  import { onDestroy } from 'svelte';
  import InteractiveFrame from '../../items/InteractiveFrame.svelte';
  import Button from '../../ui/Button.svelte';
  import { fetchAssetSource, uploadAsset, deleteAsset, type AssetResponse } from '../../../lib/assets';
  import { scanAppSource } from '../../../lib/appSourceScan';
  import { api, ApiError } from '../../../lib/api';
  import { patchItem, reportSaveFailure, type SaveOutcome } from '../../../lib/itemBody';
  import { loadAdminTree } from '../../../stores/currentEditorVersion.svelte';
  import { pushToast } from '../../../stores/toasts.svelte';
  import type { AdminTreeItem } from '../../../lib/types';

  // `item` tolerates undefined: if a tree reload drops the item, a dying branch
  // may re-run this component's effect once with the new prop before teardown.
  let {
    item, vid, editable, versionDisabled, frozen, stillOnVid, busy = $bindable(false),
  }: {
    item: AdminTreeItem | undefined; vid: number; editable: boolean; versionDisabled: boolean;
    frozen: boolean; stillOnVid: (v: number) => boolean; busy?: boolean;
  } = $props();

  let alive = true;
  onDestroy(() => { alive = false; });

  let source = $state<string | null>(null);
  let status = $state<'empty' | 'loading' | 'ready' | 'error'>('empty');

  // Re-previews on Replace/Remove (the item prop follows the reloaded tree).
  // AbortController + `stale` stop an out-of-order fetch flashing old source.
  // D6/R5: a disabled version fetches nothing (the asset route is a 403).
  $effect(() => {
    const filename = item?.script_url ?? null;
    if (versionDisabled || !filename) { status = 'empty'; source = null; return; }
    status = 'loading';
    source = null;
    const controller = new AbortController();
    let stale = false;
    void fetchAssetSource(vid, filename, controller.signal)
      .then((text) => { if (!stale) { source = text; status = 'ready'; } })
      .catch((e: unknown) => {
        if (stale || (e as { name?: string })?.name === 'AbortError') return;
        status = 'error';
        source = null;
      });
    return () => { stale = true; controller.abort(); };
  });

  let uploadBusy = $state(false);
  let warnings = $state<string[]>([]);
  let uploadError = $state<string | null>(null);
  let fileEl = $state<HTMLInputElement>();
  $effect(() => { busy = uploadBusy; });

  // FileReader, not File.prototype.text(): this project's jsdom lacks text().
  function readText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  async function onFileChosen(e: Event) {
    if (uploadBusy || frozen || !item) return;
    // Pin before any await: `item` is live and `vid` can change under us.
    const itemId = item.id;
    const savedVid = vid;
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-choosing the same filename
    if (!file) return;
    uploadError = null;
    warnings = [];
    uploadBusy = true;
    // uploadAsset commits the Asset independently of the PATCH that references
    // it, so a failed PATCH would strand an orphan that also blocks a retry
    // with a 409. On failure BEFORE linking, delete it. A reload failure AFTER
    // the link is not an orphan, so clean-up is gated on `linked`.
    let uploaded: AssetResponse | null = null;
    let linked = false;
    try {
      const text = await readText(file);
      if (text.trim() === '') {
        if (alive) uploadError = 'The file is empty — choose a non-empty .js file.';
        return;
      }
      if (alive) warnings = scanAppSource(text); // advisory, non-blocking
      uploaded = await uploadAsset(savedVid, file);
      await api.patch(`/api/items/${itemId}`, { script_url: uploaded.filename });
      linked = true;
      if (stillOnVid(savedVid)) await loadAdminTree(savedVid, { force: true });
      pushToast('App uploaded', 'success');
    } catch (err) {
      if (uploaded && !linked) {
        // Best-effort: a failed clean-up leaves the orphan removable in the
        // asset manager; never surface a clean-up error.
        try { await deleteAsset(uploaded.id); } catch { /* ignore */ }
      }
      if (!alive) return;
      if (err instanceof ApiError && err.status === 409) {
        uploadError = 'A file with that name already exists. Rename it or remove the old one first.';
      } else {
        uploadError = err instanceof ApiError ? err.displayMessage : 'Upload failed.';
      }
    } finally {
      if (alive) uploadBusy = false;
    }
  }

  async function removeApp() {
    if (uploadBusy || frozen || !item) return;
    if (!confirm('Remove the app script? Students will see an empty app.')) return;
    const itemId = item.id;
    const savedVid = vid;
    uploadBusy = true;
    uploadError = null;
    try {
      await api.patch(`/api/items/${itemId}`, { script_url: null });
      if (stillOnVid(savedVid)) await loadAdminTree(savedVid, { force: true });
      if (alive) warnings = [];
      pushToast('App removed', 'success');
    } catch (err) {
      if (alive) uploadError = err instanceof ApiError ? err.displayMessage : 'Remove failed.';
    } finally {
      if (alive) uploadBusy = false;
    }
  }

  // ---- ItemBodyApi. No drafts here: the title is the modal's. ----
  export function validate(): boolean { return true; }
  export function discard(): void {}
  export function discardAll(): void {}
  export async function save(titleDraft: string | undefined): Promise<SaveOutcome> {
    if (titleDraft === undefined) return { outcome: 'ok' };
    if (!item) return { outcome: 'failed' };
    const savedVid = vid;
    try {
      const echo = await patchItem(item.id, { title: titleDraft });
      return { outcome: 'ok', savedTitle: echo.title };
    } catch (e) {
      reportSaveFailure(e, savedVid, stillOnVid);
      return { outcome: 'failed' };
    }
  }
</script>

{#if item}
  <div class="field-row">
    <span class="field-label">App script</span>
    <div class="script-row">
      <span class="mono script-name" class:none={!item.script_url}>{item.script_url ?? 'No script'}</span>
      {#if editable}
        <input
          bind:this={fileEl}
          type="file"
          accept=".js,application/javascript"
          hidden
          disabled={uploadBusy || frozen}
          onchange={onFileChosen}
        />
        <Button variant="secondary" disabled={uploadBusy || frozen} onclick={() => fileEl?.click()}>
          {item.script_url ? 'Replace' : 'Upload'}
        </Button>
        {#if item.script_url}
          <Button variant="ghost" disabled={uploadBusy || frozen} onclick={() => void removeApp()}>Remove</Button>
        {/if}
      {/if}
    </div>
  </div>
  {#if editable && uploadError}<p class="field-err" role="alert">{uploadError}</p>{/if}
  {#if editable && warnings.length}
    <ul class="warnings">
      {#each warnings as w}<li>{w}</li>{/each}
    </ul>
  {/if}

  {#if !versionDisabled}
    <div class="app-preview">
      <div class="preview-head">
        <span class="preview-title">Preview</span>
        <span class="mono preview-meta">interactive app</span>
      </div>
      {#if status === 'ready' && source !== null}
        <div class="preview-area">
          <InteractiveFrame scriptSource={source} title={item.title || 'Interactive app'} height={360} />
        </div>
        {#if editable}
          <!-- Spec §8/§10: a blank render can't be detected from JS (opaque
               origin), so a static hint sits beside a rendered preview only. -->
          <div class="preview-foot">
            <span class="blank-hint">Blank preview? The most common cause is an ES-module build instead of a single classic/IIFE bundle — see the tutorial.</span>
          </div>
        {/if}
      {:else if status === 'loading'}
        <div class="preview-area" aria-busy="true"></div>
      {:else if status === 'error'}
        <p class="app-hint">This app couldn't be loaded.</p>
      {:else}
        <p class="app-hint">{editable ? 'No app uploaded yet. Choose a .js file to upload.' : 'No app.'}</p>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .field-row {
    display: grid;
    grid-template-columns: 132px 1fr; /* ref 1808 — D4 borrows 3e's row; D2 drops the pencil slot */
    align-items: center;
    gap: 12px;
  }
  .field-label { font-size: 12.5px; color: var(--muted); }
  .script-row { display: flex; align-items: center; gap: 9px; min-width: 0; /* ref 1750 — the dense button gap */ }
  .script-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    color: var(--text); /* ref 1810 — the mono value */
  }
  .script-name.none { color: var(--muted); }
  .field-err { margin: 0; font-size: 12px; color: var(--danger); /* D12 */ }
  /* D11: the information-banner colour treatment at sidebar size. */
  .warnings {
    margin: 0;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    font-size: 11.5px;
    color: var(--text-3);
  }
  .app-preview { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; /* ref 1813 */ }
  .preview-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border); /* ref 1814 — #E9EBEF → --border */
  }
  .preview-title { flex: 1; font-size: 12.5px; font-weight: 600; color: var(--text); /* ref 1815 */ }
  .preview-meta { font-size: 11.5px; color: var(--muted); /* ref 1816 */ }
  .preview-area { height: 360px; background: var(--surface-2); /* D14 */ }
  .app-hint {
    margin: 0;
    padding: 8px 10px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    font-size: 11.5px;
    color: var(--text-3); /* D11 — was .notice */
  }
  .preview-foot {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-top: 1px solid var(--border-soft);
    background: var(--surface-3); /* ref 1821 — #F0F1F4 → --border-soft */
  }
  .blank-hint { font-size: 12px; color: var(--muted); }
</style>
