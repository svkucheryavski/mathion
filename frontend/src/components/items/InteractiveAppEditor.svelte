<script lang="ts">
  // Editor-side interactive_app surface: previews the stored app in the real
  // strict-sandboxed frame (fetch → inline) and provides the upload / Replace /
  // Remove UX. NEVER renders a stored filename as a link (security §6/§9).
  import type { AdminTreeItem } from '../../lib/types';
  import { fetchAssetSource, uploadAsset } from '../../lib/assets';
  import { scanAppSource } from '../../lib/appSourceScan';
  import { api, ApiError } from '../../lib/api';
  import { loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import InteractiveFrame from './InteractiveFrame.svelte';
  import Button from '../ui/Button.svelte';

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

  let uploadBusy = $state(false);
  let warnings = $state<string[]>([]);
  let uploadError = $state<string | null>(null);

  // Read the file as text for the heuristic scan + non-empty gate. FileReader,
  // not File.prototype.text(): this project's jsdom does not implement text().
  function readText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  async function onFileChosen(e: Event) {
    if (uploadBusy) return;
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-choosing the same filename
    if (!file) return;
    uploadError = null;
    warnings = [];
    uploadBusy = true;
    try {
      const text = await readText(file);
      if (text.trim() === '') { uploadError = 'The file is empty — choose a non-empty .js file.'; return; }
      warnings = scanAppSource(text); // advisory, non-blocking
      const asset = await uploadAsset(versionId, file);
      await api.patch(`/api/items/${item.id}`, { script_url: asset.filename });
      await loadAdminTree(versionId, { force: true });
      pushToast('App uploaded', 'success');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        uploadError = 'A file with that name already exists. Rename it or remove the old one first.';
      } else {
        uploadError = err instanceof ApiError ? err.displayMessage : 'Upload failed.';
      }
    } finally {
      uploadBusy = false;
    }
  }

  async function removeApp() {
    uploadBusy = true;
    uploadError = null;
    try {
      await api.patch(`/api/items/${item.id}`, { script_url: null });
      await loadAdminTree(versionId, { force: true });
      warnings = [];
      pushToast('App removed', 'success');
    } catch (err) {
      uploadError = err instanceof ApiError ? err.displayMessage : 'Remove failed.';
    } finally {
      uploadBusy = false;
    }
  }
</script>

<section class="app-editor">
  <h3>{item.title}</h3>
  {#if status === 'ready' && source !== null}
    <InteractiveFrame scriptSource={source} title={item.title || 'Interactive app'} />
  {:else if status === 'error'}
    <p class="notice">This app couldn't be loaded.</p>
  {:else if status === 'empty'}
    <p class="notice">{editable ? 'No app uploaded yet. Choose a .js file to upload.' : 'No app.'}</p>
  {/if}
  {#if editable}
    <div class="upload">
      <label class="file">
        {item.script_url ? 'Replace app' : 'Upload app'}
        <input type="file" accept=".js,application/javascript" onchange={onFileChosen} disabled={uploadBusy} />
      </label>
      {#if item.script_url}
        <Button variant="ghost" onclick={removeApp} disabled={uploadBusy}>Remove</Button>
      {/if}
    </div>
    {#if uploadError}<p class="form-err" role="alert">{uploadError}</p>{/if}
    {#if warnings.length}
      <ul class="warnings">
        {#each warnings as w}<li>{w}</li>{/each}
      </ul>
    {/if}
    {#if status === 'ready'}
      <!-- Spec §8/§10: we can't detect a blank preview from JS (opaque-origin
           iframe), so surface a static hint alongside a rendered preview. Gated
           on 'ready' so it does NOT show under the error/empty states (a 404 is
           not a blank render). `status` is in scope from the preview effect. -->
      <small class="hint">Blank preview? The most common cause is an ES-module build instead of a single classic/IIFE bundle — see the tutorial.</small>
    {/if}
  {/if}
</section>

<style>
  .app-editor { margin: var(--space-4) 0; }
  .notice { color: var(--muted, #666); font-style: italic; }
  .upload { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); }
  .warnings { color: #8a6d00; background: #fff8e1; border-radius: var(--radius); padding: var(--space-2) var(--space-3); margin: var(--space-2) 0; }
  .form-err { color: #a33; }
  .hint { display: block; margin-top: var(--space-2); color: var(--muted, #666); font-size: 0.85rem; }
</style>
