<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { ApiError } from '../../lib/api';
  import {
    listAssets,
    uploadAsset,
    deleteAsset,
    type AssetResponse,
  } from '../../lib/assets';

  type UploadProgress = { current: number; total: number; filename: string } | null;
  type UploadError = { detail: string; stoppedAt?: { n: number; m: number } } | null;

  let {
    versionId,
    onInsert,
    refreshKey = 0,
    cursorReady = false,
    uploading = $bindable<boolean>(false),
    uploadProgress = $bindable<UploadProgress>(null),
    uploadError = $bindable<UploadError>(null),
  }: {
    versionId: number;
    onInsert: (filename: string, mimeType: string) => void;
    refreshKey?: number;
    cursorReady?: boolean;
    uploading?: boolean;
    uploadProgress?: UploadProgress;
    uploadError?: UploadError;
  } = $props();

  let assets = $state<AssetResponse[]>([]);
  let listError = $state<string | null>(null);
  let loading = $state(true);
  let fileInputEl = $state<HTMLInputElement | null>(null);
  let mountDone = false;
  let confirmId = $state<number | null>(null);
  let deleteErrorMsg = $state<string | null>(null);
  const deletingIds = new SvelteSet<number>();

  async function fetchAssets() {
    loading = true;
    listError = null;
    try {
      assets = await listAssets(versionId);
    } catch (e) {
      listError = e instanceof ApiError ? e.displayMessage : 'Could not load assets.';
    } finally {
      loading = false;
    }
  }

  $effect(() => { void refreshKey; if (mountDone) void fetchAssets(); });
  onMount(() => { mountDone = true; void fetchAssets(); });

  function askDelete(id: number) { confirmId = id; }
  function cancelDelete() { confirmId = null; }
  async function confirmDelete(id: number) {
    if (deletingIds.has(id)) return;
    deletingIds.add(id);
    deleteErrorMsg = null;
    try {
      await deleteAsset(id);
    } catch (e) {
      deleteErrorMsg = e instanceof ApiError ? e.displayMessage : 'Delete failed';
    } finally {
      if (confirmId === id) confirmId = null;
      deletingIds.delete(id);
      await fetchAssets();
    }
  }

  function pickFile() { fileInputEl?.click(); }

  async function runUpload(files: File[]) {
    if (uploading) return;
    uploading = true;
    uploadError = null;
    let i = 0;
    try {
      for (; i < files.length; i++) {
        uploadProgress = { current: i + 1, total: files.length, filename: files[i].name };
        await uploadAsset(versionId, files[i]);
        await fetchAssets();
      }
    } catch (e) {
      const detail = e instanceof ApiError ? e.displayMessage : 'Upload failed';
      uploadError = {
        detail,
        stoppedAt: files.length > 1 ? { n: i + 1, m: files.length } : undefined,
      };
    } finally {
      uploading = false;
      uploadProgress = null;
    }
  }

  function handleDropZone(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    void runUpload(files);
  }

  function handleAsideRootDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    void runUpload(files);
  }

  function handleDragOver(e: DragEvent) { e.preventDefault(); e.stopPropagation(); }

  function handleFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    void runUpload(files);
  }

  function imgSrc(a: AssetResponse) {
    return `/assets/${a.version_id}/${a.filename}`;
  }
  function extChip(a: AssetResponse): string {
    const dot = a.filename.lastIndexOf('.');
    return dot === -1 ? '?' : a.filename.slice(dot + 1).toUpperCase();
  }
  function isImage(mime: string) {
    return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif';
  }
</script>

<aside
  class="sidebar"
  data-testid="asset-sidebar"
  ondragover={handleDragOver}
  ondrop={handleAsideRootDrop}
>
  <h3>Assets</h3>

  {#if !cursorReady}
    <p class="banner" data-testid="cursor-banner">
      Click in the editor to position the cursor, or new assets will be appended to the end.
    </p>
  {/if}

  {#if uploadError}
    <div class="error" data-testid="upload-error">
      <span>
        {#if uploadError.stoppedAt}
          Upload stopped at file {uploadError.stoppedAt.n} of {uploadError.stoppedAt.m}: {uploadError.detail}
        {:else}
          {uploadError.detail}
        {/if}
      </span>
      <button
        type="button"
        aria-label="Dismiss error"
        data-testid="upload-error-dismiss"
        onclick={() => (uploadError = null)}
      >×</button>
    </div>
  {/if}

  {#if uploadProgress}
    <div class="progress" data-testid="upload-progress">
      {#if uploadProgress.total > 1}
        Uploading file {uploadProgress.current} of {uploadProgress.total}: {uploadProgress.filename}…
      {:else}
        Uploading {uploadProgress.filename}…
      {/if}
    </div>
  {/if}

  {#if deleteErrorMsg}
    <div class="error" data-testid="delete-error">
      <span>{deleteErrorMsg}</span>
      <button
        type="button"
        aria-label="Dismiss error"
        onclick={() => (deleteErrorMsg = null)}
      >×</button>
    </div>
  {/if}

  {#if loading}
    <p class="muted" data-testid="loading-indicator">Loading…</p>
  {:else if listError}
    <p class="error-inline">{listError}</p>
  {:else if assets.length === 0}
    <p class="muted">No assets yet. Drop a file in the zone below or click it to pick.</p>
  {:else}
    <ul class="list">
      {#each assets as a (a.id)}
        <li class="row" data-testid={`asset-row-${a.id}`}>
          <button type="button" class="row-click" onclick={() => onInsert(a.filename, a.mime_type)}>
            <span class="thumb">
              {#if isImage(a.mime_type)}
                <img loading="lazy" src={imgSrc(a)} alt="" />
              {:else}
                <span class="chip">{extChip(a)}</span>
              {/if}
            </span>
            <span class="meta">
              <span class="name">{a.filename}</span>
              <span class="size">{a.file_size} B</span>
            </span>
          </button>
          {#if a.is_referenced}
            <span
              class="used"
              data-testid="used-badge"
              title="Remove this reference from content and save to enable delete."
            >used</span>
          {:else if confirmId === a.id}
            <span class="confirm-pair">
              <button
                type="button"
                data-testid="delete-confirm"
                disabled={deletingIds.has(a.id)}
                onclick={(e) => { e.stopPropagation(); void confirmDelete(a.id); }}
              >Confirm</button>
              <button
                type="button"
                data-testid="delete-cancel"
                onclick={(e) => { e.stopPropagation(); cancelDelete(); }}
              >Cancel</button>
            </span>
          {:else}
            <button
              type="button"
              class="trash"
              data-testid="delete-trash"
              aria-label={`Delete ${a.filename}`}
              onclick={(e) => { e.stopPropagation(); askDelete(a.id); }}
            >🗑</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <div
    class="drop-zone"
    data-testid="drop-zone"
    ondragover={handleDragOver}
    ondrop={handleDropZone}
    role="button"
    tabindex="0"
    onclick={pickFile}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile(); } }}
    class:disabled={uploading}
  >
    Drop here or click to pick
  </div>
  <input
    type="file"
    hidden
    data-testid="file-picker"
    bind:this={fileInputEl}
    disabled={uploading}
    onchange={handleFileInput}
  />
</aside>

<style>
  .sidebar { flex: 0 0 280px; padding: var(--space-3); border-left: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-2); }
  h3 { margin: 0 0 var(--space-2) 0; }
  .banner { background: #fff8e1; border-left: 3px solid #f9a825; padding: var(--space-2); font-size: 0.85rem; color: #5d4037; }
  .error { display: flex; gap: var(--space-2); align-items: flex-start; background: #fdecea; border-left: 3px solid #c62828; padding: var(--space-2); color: #7c1f1f; font-size: 0.85rem; }
  .error button { background: none; border: 0; color: inherit; cursor: pointer; font-size: 1.2em; line-height: 1; }
  .progress { background: #e3f2fd; border-left: 3px solid #1976d2; padding: var(--space-2); color: #0d47a1; font-size: 0.85rem; }
  .muted { color: var(--muted, #666); font-size: 0.85rem; }
  .error-inline { color: #a33; font-size: 0.85rem; }
  .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-1); }
  .row { display: flex; align-items: center; cursor: pointer; border: 1px solid transparent; border-radius: var(--radius); }
  .row:hover { background: #f5f5f5; }
  .row-click { flex: 1; display: flex; gap: var(--space-2); align-items: center; padding: var(--space-2); background: none; border: 0; cursor: pointer; text-align: left; }
  .thumb { width: 32px; height: 32px; flex: 0 0 32px; display: flex; align-items: center; justify-content: center; background: #eee; border-radius: 4px; overflow: hidden; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .chip { font-size: 0.65rem; font-weight: 600; color: #555; }
  .meta { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .name { font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .size { font-size: 0.7rem; color: var(--muted, #666); }
  .used { font-size: 0.65rem; padding: 2px 6px; background: #c8e6c9; color: #1b5e20; border-radius: 999px; }
  .drop-zone { margin-top: var(--space-2); padding: var(--space-3); border: 2px dashed var(--border); border-radius: var(--radius); text-align: center; color: var(--muted, #666); cursor: pointer; font-size: 0.85rem; }
  .drop-zone:hover { background: #fafafa; }
  .drop-zone.disabled { opacity: 0.5; cursor: not-allowed; }
  .confirm-pair { display: flex; gap: var(--space-1); }
  .confirm-pair button { font-size: 0.7rem; padding: 2px 6px; cursor: pointer; }
  .trash { background: none; border: 0; cursor: pointer; opacity: 0; transition: opacity 80ms; font-size: 0.9rem; }
  .row:hover .trash { opacity: 0.7; }
  .trash:hover { opacity: 1; }
</style>
