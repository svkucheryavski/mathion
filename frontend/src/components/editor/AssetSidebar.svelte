<script lang="ts">
  import { onMount, tick } from 'svelte';
  import IconButton from '../ui/IconButton.svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { ApiError } from '../../lib/api';
  import { formatRef } from '../../lib/assets';
  import type { AssetContext, AssetItem } from '../../lib/assetContext';
  import { MAX_FILE_SIZE_BYTES, ALLOWED_EXTENSIONS } from '../../lib/runAssets';
  import { formatFileSize } from '../../lib/format';

  type UploadProgress = { current: number; total: number; filename: string } | null;
  type UploadError = { detail: string; stoppedAt?: { n: number; m: number } } | null;

  let {
    assetContext,
    disabled = false,
    refreshKey = 0,
    cursorReady = false,
    onInsert,
    onUploadFile,
    uploading = $bindable<boolean>(false),
    uploadProgress = $bindable<UploadProgress>(null),
    uploadError = $bindable<UploadError>(null),
  }: {
    assetContext: AssetContext;
    disabled?: boolean;
    refreshKey?: number;
    cursorReady?: boolean;
    onInsert: (snippet: string) => void;
    onUploadFile: (file: File, batch?: { current: number; total: number }) => Promise<AssetItem | null>;
    uploading?: boolean;
    uploadProgress?: UploadProgress;
    uploadError?: UploadError;
  } = $props();

  let assets = $state<AssetItem[]>([]);
  let listError = $state<string | null>(null);
  let loading = $state(true);
  let fileInputEl = $state<HTMLInputElement | null>(null);
  let asideEl = $state<HTMLElement | null>(null);
  let dropZoneEl = $state<HTMLElement | null>(null);
  // Plain `let`, NOT $state — used as a gate inside $effect to skip the
  // pre-mount tick. Making it reactive would cause the $effect to re-run
  // when onMount flips it, triggering a spurious second fetchAssets.
  let mountDone = false;
  let confirmId = $state<number | null>(null);
  let deleteErrorMsg = $state<string | null>(null);
  const deletingIds = new SvelteSet<number>();

  // Plain `let`, NOT $state — fetchAssets is called from a $effect and a
  // reactive token would re-trigger that effect on every increment,
  // creating a refetch loop.
  let loadToken = 0;

  async function fetchAssets() {
    loadToken += 1;
    const myToken = loadToken;
    loading = true;
    listError = null;
    try {
      const list = await assetContext.list();
      if (myToken === loadToken) assets = list;
    } catch (e) {
      if (myToken === loadToken) {
        listError = e instanceof ApiError ? e.displayMessage : 'Could not load assets.';
      }
    } finally {
      if (myToken === loadToken) loading = false;
    }
  }

  // Refetch on either signal: external refreshKey bump (post-upload sync from
  // MarkdownEditor / parent) OR a fresh assetContext identity (same-page
  // version/run swap by the router — codex T5a finding). Both reads are
  // unguarded so $effect tracks them as dependencies; mountDone gate skips
  // the pre-onMount tick.
  $effect(() => {
    void refreshKey;
    void assetContext;
    if (mountDone) void fetchAssets();
  });
  onMount(() => { mountDone = true; void fetchAssets(); });

  // R2: `is_referenced` counts references across the whole version (course) or
  // the whole run, never one item — the reason says so.
  const inUseReason = $derived(
    assetContext.kind === 'run'
      ? 'Remove asset — referenced by a mini-project'
      : 'Remove asset — still referenced in this version',
  );
  // R7: the inline confirm takes focus on Cancel so Escape reaches it, and
  // gives it back to the row's trash when it closes.
  const trashEls = $state<Record<number, HTMLButtonElement | undefined>>({});
  const cancelEls = $state<Record<number, HTMLButtonElement | undefined>>({});
  async function askDelete(id: number) {
    if (disabled) return;
    confirmId = id;
    await tick();
    cancelEls[id]?.focus();
  }
  async function cancelDelete() {
    const id = confirmId;
    confirmId = null;
    await tick();
    if (id !== null) trashEls[id]?.focus();
  }
  // Escape = Cancel. preventDefault so an enclosing modal does not close (§1).
  function onConfirmKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    void cancelDelete();
  }
  async function confirmDelete(id: number) {
    if (disabled) return;
    if (deletingIds.has(id)) return;
    deletingIds.add(id);
    deleteErrorMsg = null;
    try {
      await assetContext.remove(id);
    } catch (e) {
      deleteErrorMsg = e instanceof ApiError ? e.displayMessage : 'Delete failed';
    } finally {
      const closing = confirmId === id;
      if (closing) confirmId = null;
      deletingIds.delete(id);
      const idx = assets.findIndex((a) => a.id === id);
      await fetchAssets();
      if (closing) await refocusAfterDelete(id, idx);
    }
  }
  // R7, the Confirm path: the confirm pair is gone (and the list re-rendered),
  // so focus would fall to <body>. Land on this row's trash (failed delete),
  // else the trash now at its position, the one before it, else the drop zone.
  // Leave focus alone if the author moved it elsewhere or opened another confirm.
  async function refocusAfterDelete(id: number, idx: number) {
    await tick();
    const active = document.activeElement;
    if (confirmId !== null || (active && active !== document.body && !asideEl?.contains(active))) return;
    const near = [trashEls[id], trashEls[assets[idx]?.id ?? -1], trashEls[assets[idx - 1]?.id ?? -1]];
    const target = near.find((el) => el?.isConnected && !el.disabled) ?? dropZoneEl;
    target?.focus();
  }

  function pickFile() { if (disabled || uploading) return; fileInputEl?.click(); }

  function validateFile(file: File): string | null {
    if (file.size > MAX_FILE_SIZE_BYTES) return `${file.name} (file exceeds 20MB)`;
    const dot = file.name.lastIndexOf('.');
    const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
    if (!ALLOWED_EXTENSIONS.has(ext)) return `${file.name} (extension not allowed)`;
    return null;
  }

  // Stop-on-any-invalid pre-pass: validate ALL files BEFORE invoking onUploadFile.
  // If any file fails, write a single uploadError summarizing them and call
  // nothing. Rationale: uploadOne clears uploadError at its start, so per-file
  // validation messages would get wiped by the next file's upload start.
  async function handleDrop(files: File[]) {
    if (disabled || uploading) return;
    const invalid: string[] = [];
    for (const f of files) {
      const err = validateFile(f);
      if (err) invalid.push(err);
    }
    if (invalid.length > 0) {
      uploadError = {
        detail: invalid.length === 1
          ? `Cannot upload: ${invalid[0]}`
          : `Cannot upload ${invalid.length} files: ${invalid.join(', ')}`,
      };
      return;
    }
    for (let i = 0; i < files.length; i++) {
      const result = await onUploadFile(files[i], { current: i + 1, total: files.length });
      if (result === null) break;
      await fetchAssets();
    }
  }

  function handleDropZone(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    void handleDrop(files);
  }

  function handleAsideRootDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    void handleDrop(files);
  }

  function handleDragOver(e: DragEvent) { e.preventDefault(); e.stopPropagation(); }

  function handleFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    void handleDrop(files);
  }

  function extChip(a: AssetItem): string {
    const dot = a.filename.lastIndexOf('.');
    return dot === -1 ? '?' : a.filename.slice(dot + 1).toUpperCase();
  }
  function isImage(mime: string) {
    return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif';
  }
  function displayName(filename: string): string {
    const MAX = 24;
    if (filename.length <= MAX) return filename;
    const dot = filename.lastIndexOf('.');
    if (dot <= 0) return filename.slice(0, MAX - 3) + '...';
    const ext = filename.slice(dot);
    const stem = filename.slice(0, dot);
    const reserve = 3 + 1 + ext.length;
    if (reserve >= MAX) return filename.slice(0, MAX - 3) + '...';
    const prefixLen = MAX - reserve;
    return stem.slice(0, prefixLen) + '...' + stem.slice(-1) + ext;
  }
</script>

<aside
  bind:this={asideEl}
  class="asset-sidebar"
  data-testid="asset-sidebar"
  ondragover={handleDragOver}
  ondrop={handleAsideRootDrop}
>
  <h3>{assetContext.kind === 'run' ? 'Run assets — shared across all MPs in this run' : 'Course assets'}</h3>

  {#if !cursorReady}
    <p class="hint" data-testid="cursor-banner">
      Click in the editor to position the cursor, or new assets will be appended to the end.
    </p>
  {/if}

  {#if uploadError}
    <div class="error" data-testid="upload-error">
      <span class="msg">
        {#if uploadError.stoppedAt}
          Upload stopped at file {uploadError.stoppedAt.n} of {uploadError.stoppedAt.m}: {uploadError.detail}
        {:else}
          {uploadError.detail}
        {/if}
      </span>
      <span data-testid="upload-error-dismiss">
        <IconButton glyph="close" size="sm" borderless title="Dismiss error" onclick={() => (uploadError = null)} />
      </span>
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
      <span class="msg">{deleteErrorMsg}</span>
      <IconButton glyph="close" size="sm" borderless title="Dismiss error" onclick={() => (deleteErrorMsg = null)} />
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
          <button
            type="button"
            class="row-click"
            disabled={disabled}
            onclick={() => onInsert(formatRef(a.filename, a.mime_type))}
          >
            <span class="thumb">
              {#if isImage(a.mime_type)}
                <img loading="lazy" src={assetContext.imgSrc(a)} alt="" />
              {:else}
                <span class="chip mono">{extChip(a)}</span>
              {/if}
            </span>
            <span class="meta">
              <span class="name" title={a.filename}>{displayName(a.filename)}</span>
              <span class="size mono">{formatFileSize(a.file_size)}</span>
            </span>
          </button>
          {#if a.is_referenced}
            <span
              class="used"
              data-testid="used-badge"
              title="Remove this reference from content and save to enable delete."
            >used</span>
          {/if}
          {#if confirmId === a.id}
            <span class="confirm-pair">
              <button
                type="button"
                class="confirm"
                data-testid="delete-confirm"
                disabled={disabled || deletingIds.has(a.id)}
                onkeydown={onConfirmKeydown}
                onclick={(e) => { e.stopPropagation(); void confirmDelete(a.id); }}
              >Confirm</button>
              <button
                type="button"
                class="cancel"
                data-testid="delete-cancel"
                bind:this={cancelEls[a.id]}
                onkeydown={onConfirmKeydown}
                onclick={(e) => { e.stopPropagation(); void cancelDelete(); }}
              >Cancel</button>
            </span>
          {:else}
            <span data-testid="delete-trash">
              <IconButton
                glyph="trash"
                size="sm"
                danger
                title={a.is_referenced ? inUseReason : 'Remove asset'}
                aria-label={`Delete ${a.filename}`}
                disabled={disabled || a.is_referenced}
                bind:element={trashEls[a.id]}
                onclick={() => void askDelete(a.id)}
              />
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <div
    bind:this={dropZoneEl}
    class="drop-zone"
    data-testid="drop-zone"
    ondragover={handleDragOver}
    ondrop={handleDropZone}
    role="button"
    tabindex="0"
    onclick={pickFile}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile(); } }}
    class:disabled={disabled || uploading}
  >
    Drop here or click to pick
  </div>
  <input
    type="file"
    hidden
    multiple
    data-testid="file-picker"
    bind:this={fileInputEl}
    disabled={disabled || uploading}
    onchange={handleFileInput}
  />
</aside>

<style>
  .asset-sidebar {
    flex: 0 0 260px;
    min-width: 0;
    padding: 12px;
    border-left: 1px solid var(--border);
    background: var(--surface-3);
    display: flex;
    flex-direction: column;
    gap: 8px; /* ref 1717 */
  }
  /* Stacked under 880px (MarkdownEditor): a full-width block, not a 260px-tall one. */
  @media (max-width: 880px) {
    .asset-sidebar { flex: 0 0 auto; border-left: 0; border-top: 1px solid var(--border); }
  }
  h3 { font-size: 12.5px; font-weight: 600; color: var(--text); /* ref 1718 */ }
  /* D11: the information-banner colour treatment at sidebar size (ref 1719 geometry). */
  .hint {
    margin: 0;
    padding: 8px 10px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--text-3);
  }
  .error {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 8px 10px;
    background: var(--surface-2);
    border-left: 3px solid var(--danger);
    font-size: 11.5px;
    color: var(--danger); /* D11 treatment, error form */
  }
  .msg { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .progress {
    padding: 8px 10px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    font-size: 11.5px;
    color: var(--text-3); /* D11 treatment */
  }
  .muted { margin: 0; font-size: 12px; color: var(--muted); }
  .error-inline { margin: 0; font-size: 12px; color: var(--danger); }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .row { display: flex; align-items: center; gap: 9px; padding: 6px 7px; border-radius: var(--radius); /* ref 1720 */ }
  .row:hover { background: var(--surface-2); }
  .row-click {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 9px; /* ref 1720 */
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row-click:disabled { cursor: not-allowed; }
  .thumb {
    flex: 0 0 32px;
    width: 32px;
    height: 28px;
    border-radius: 4px; /* the 4px tile radius (ref 1721) */
    background: var(--border-soft); /* ref 1721 — no fill token; --border-soft is the same value */
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .chip { font-size: 9.5px; font-weight: 600; color: var(--muted); /* ref 1721 */ }
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; /* ref 1722 */ }
  .name { font-size: 12.5px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; /* ref 1723 */ }
  .size { font-size: 10.5px; color: var(--muted); /* ref 1724 */ }
  .used {
    padding: 3px 8px;
    border-radius: 3px;
    background: var(--status-accepted-bg);
    color: var(--status-accepted-fg);
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap; /* ref 1726 */
  }
  .confirm-pair { display: flex; gap: 4px; /* the 4px step */ }
  .confirm-pair button {
    padding: 2px 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 11.5px;
    cursor: pointer;
  }
  .confirm-pair .confirm { color: var(--danger); }
  .confirm-pair button:disabled { color: var(--faint); border-color: var(--border-faint); cursor: not-allowed; }
  .drop-zone {
    margin-top: 2px;
    padding: 11px 10px;
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius);
    text-align: center;
    font-size: 12px;
    color: var(--muted);
    cursor: pointer; /* ref 1744 */
  }
  .drop-zone:hover { background: var(--surface-2); }
  .drop-zone.disabled { color: var(--faint); border-color: var(--border-faint); cursor: not-allowed; }
</style>
