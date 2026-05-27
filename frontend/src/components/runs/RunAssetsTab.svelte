<script lang="ts">
  import type {
    Course,
    MiniProjectResponse,
    RunAssetResponse,
  } from '../../lib/types';
  import { formatFileSize } from '../../lib/format';
  import { formatLocalWithTz } from '../../lib/datetime';
  import { extractAssetRefs } from '../../lib/extractAssetRefs';
  import {
    ALLOWED_EXTENSIONS,
    MAX_FILE_SIZE_BYTES,
    uploadRunAsset,
    replaceRunAsset,
    deleteRunAsset,
  } from '../../lib/runAssets';

  let {
    runId,
    assets,
    miniProjects,
    course,
    versionIsDisabled,
    onRefetchAssets,
    onRefetchMiniProjects,
    onEditMiniProject,
    onReloadRun,
  }: {
    runId: number;
    assets: RunAssetResponse[];
    miniProjects: MiniProjectResponse[] | null;
    course: Course;
    versionIsDisabled: boolean;
    onRefetchAssets: () => Promise<void>;
    onRefetchMiniProjects: () => Promise<void>;
    onEditMiniProject: (mp: MiniProjectResponse) => void;
    onReloadRun: () => Promise<void>;
  } = $props();

  type FilterPill = 'all' | 'orphan' | 'referenced';
  type SortField = 'filename' | 'size' | 'uploaded';
  type SortDir = 'ascending' | 'descending' | 'none';

  let activeFilter = $state<FilterPill>('all');
  let sortField = $state<SortField>('filename');
  let sortDir = $state<SortDir>('ascending');
  let openSubPanelAssetId = $state<number | null>(null);

  let uploadInputEl: HTMLInputElement | null = $state(null);
  let uploadProgress = $state<{ current: number; total: number } | null>(null);
  let dragOver = $state(false);

  // Single banner slot (spec line 138): newer banners replace older. All
  // upload + replace + (future) delete + bulk error paths write to this.
  let banner = $state<string | null>(null);

  // Shared confirm slot (spec line 150): mutual exclusion across replace,
  // delete, and bulk-delete confirms. T11 will add `bulk-delete`.
  type OpenConfirm =
    | { kind: 'replace'; assetId: number; file: File }
    | { kind: 'delete'; assetId: number; isReferenced: boolean; checkboxChecked: boolean };
  let openConfirm = $state<OpenConfirm | null>(null);

  // Plain let (not $state): only read inside async callbacks + $effect cleanup,
  // never in reactive/template positions.
  let mounted = true;
  // Single-upload / single-replace design: each entry point creates its own
  // controller; the active one is tracked so $effect cleanup can abort.
  let activeUploadController: AbortController | null = null;
  let activeReplaceController: AbortController | null = null;

  // Unmount + runId-change cleanup. Svelte 5 footgun: cleanup runs on a tracked
  // dep change OR on unmount, but only if the dep is READ inside the effect.
  // Aborts every in-flight controller and clears UI state so navigating between
  // runs (tab stays mounted) doesn't leave stale confirms/banners visible.
  // Declared BEFORE the mounted-only effect so on unmount its cleanup fires
  // first: state clears run while `mounted` is still true, then `mounted` flips.
  $effect(() => {
    runId;
    return () => {
      activeUploadController?.abort();
      activeUploadController = null;
      activeReplaceController?.abort();
      activeReplaceController = null;
      openConfirm = null;
      banner = null;
      uploadProgress = null;
      pendingReplaceAssetId = null;
      dragOver = false;
    };
  });

  // Unmount-only cleanup: pins `mounted` to false so post-await state writes
  // are skipped. No tracked deps → only runs on component teardown.
  $effect(() => () => {
    mounted = false;
  });

  function isExtensionAllowed(name: string): boolean {
    const idx = name.lastIndexOf('.');
    const ext = idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
    return ALLOWED_EXTENSIONS.has(ext);
  }

  function validateFile(f: File): string | null {
    if (f.size > MAX_FILE_SIZE_BYTES) return `${f.name}: file too large.`;
    if (!isExtensionAllowed(f.name)) return `${f.name}: extension not allowed.`;
    return null;
  }

  async function performUpload(files: File[]): Promise<void> {
    if (versionIsDisabled) return;
    banner = null;
    for (const f of files) {
      const err = validateFile(f);
      if (err) { banner = err; return; }
    }
    uploadProgress = { current: 0, total: files.length };
    const controller = new AbortController();
    activeUploadController = controller;
    try {
      for (let i = 0; i < files.length; i++) {
        if (!mounted) return;
        try {
          await uploadRunAsset(runId, files[i]!, controller.signal);
          if (!mounted) return;
          uploadProgress = { current: i + 1, total: files.length };
        } catch (e: unknown) {
          const err = e as { name?: string; status?: number } | null;
          if (err?.name === 'AbortError' || !mounted) return;
          if (err?.status === 409) {
            banner = `An asset named '${files[i]!.name}' already exists. Use Replace on the existing row, or rename your file.`;
            return;
          }
          throw e;
        }
      }
      if (mounted) await onRefetchAssets();
    } finally {
      if (activeUploadController === controller) activeUploadController = null;
      if (mounted) uploadProgress = null;
    }
  }

  function handleUploadPicker(): void {
    uploadInputEl?.click();
  }

  async function onUploadInputChange(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    await performUpload(files);
  }

  let replaceInputEl: HTMLInputElement | null = $state(null);
  let pendingReplaceAssetId = $state<number | null>(null);

  function fileExt(name: string): string {
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
  }

  function handleReplaceClick(assetId: number): void {
    if (versionIsDisabled) return;
    pendingReplaceAssetId = assetId;
    banner = null;
    openConfirm = null;
    replaceInputEl?.click();
  }

  function onReplaceInputChange(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    const aid = pendingReplaceAssetId;
    pendingReplaceAssetId = null;
    if (!file || aid == null) return;
    const asset = assets.find((a) => a.id === aid);
    if (!asset) { banner = 'This asset is no longer in the list.'; return; }
    if (fileExt(file.name) !== fileExt(asset.filename)) {
      banner = `New file must have the same extension as the original (.${fileExt(asset.filename)}).`;
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      banner = `${file.name}: file too large.`;
      return;
    }
    openConfirm = { kind: 'replace', assetId: aid, file };
  }

  function onReplaceCancel(): void {
    pendingReplaceAssetId = null;
    openConfirm = null;
  }

  function handleDeleteClick(assetId: number, isReferenced: boolean): void {
    if (versionIsDisabled) return;
    banner = null;
    openConfirm = { kind: 'delete', assetId, isReferenced, checkboxChecked: false };
  }

  function cancelDelete(): void {
    openConfirm = null;
  }

  async function performDelete(): Promise<void> {
    if (openConfirm?.kind !== 'delete') return;
    const { assetId, isReferenced } = openConfirm;
    const force = isReferenced;
    // Clear the confirm slot BEFORE awaiting so the user can't double-submit
    // and a slow request can't clobber state set by newer interactions.
    openConfirm = null;
    // Snapshot the banner: on success we only clear it if no newer banner
    // (e.g., from an in-flight upload validation) replaced ours during await.
    const bannerAtStart = banner;
    try {
      await deleteRunAsset(runId, assetId, { force });
    } catch (e: unknown) {
      const err = e as { name?: string; status?: number; message?: string } | null;
      if (err?.name === 'AbortError' || !mounted) return;
      if (err?.status === 403) {
        banner = 'You no longer have permission to force-delete. Refresh and retry.';
        await onReloadRun();
      } else if (err?.status === 404) {
        banner = 'This asset was deleted by another user.';
        await onRefetchAssets();
      } else {
        banner = err?.message ?? 'Delete failed.';
      }
      return;
    }
    if (!mounted) return;
    if (banner === bannerAtStart) banner = null;
    if (force) {
      await Promise.all([onRefetchAssets(), onRefetchMiniProjects()]);
    } else {
      await onRefetchAssets();
    }
  }

  async function performReplace(): Promise<void> {
    if (openConfirm?.kind !== 'replace') return;
    const { assetId, file } = openConfirm;
    // Clear the confirm slot BEFORE awaiting so the user can't double-submit
    // and a slow request can't clobber state set by newer interactions.
    openConfirm = null;
    // Snapshot the banner: on success we only clear it if no newer banner
    // (e.g., from an in-flight upload validation) replaced ours during await.
    const bannerAtStart = banner;
    const controller = new AbortController();
    activeReplaceController = controller;
    try {
      await replaceRunAsset(runId, assetId, file, controller.signal);
    } catch (e: unknown) {
      const err = e as { name?: string; status?: number; message?: string } | null;
      if (err?.name === 'AbortError' || !mounted) return;
      if (err?.status === 404) {
        banner = 'This asset was deleted by another user.';
        await onRefetchAssets();
      } else if (err?.status === 422) {
        banner = 'New file must have the same extension as the original.';
      } else if (err?.status === 413) {
        banner = "Replacing would exceed this run's storage quota.";
      } else {
        banner = err?.message ?? 'Replace failed.';
      }
      return;
    } finally {
      if (activeReplaceController === controller) activeReplaceController = null;
    }
    if (!mounted) return;
    if (banner === bannerAtStart) banner = null;
    await onRefetchAssets();
  }

  // Map { mpId -> Set<filename refs> }. Empty when miniProjects is null.
  const refsByMp = $derived.by(() => {
    const m = new Map<number, Set<string>>();
    if (miniProjects == null) return m;
    for (const mp of miniProjects) {
      m.set(mp.id, extractAssetRefs(mp.assignment_md ?? ''));
    }
    return m;
  });

  function referencingMpIds(asset: RunAssetResponse): number[] {
    const ids: number[] = [];
    for (const [mpId, refs] of refsByMp.entries()) {
      if (refs.has(asset.filename)) ids.push(mpId);
    }
    return ids;
  }

  const counts = $derived.by(() => {
    let orphan = 0;
    let referenced = 0;
    for (const a of assets) {
      if (referencingMpIds(a).length === 0) orphan++;
      else referenced++;
    }
    return { all: assets.length, orphan, referenced };
  });

  const filteredAssets = $derived.by(() => {
    if (activeFilter === 'all') return assets;
    return assets.filter((a) => {
      const isOrphan = referencingMpIds(a).length === 0;
      return activeFilter === 'orphan' ? isOrphan : !isOrphan;
    });
  });

  const sortedAssets = $derived.by(() => {
    const out = filteredAssets.slice();
    if (sortDir === 'none') return out;
    const dir = sortDir === 'ascending' ? 1 : -1;
    out.sort((a, b) => {
      const ka = sortKey(a, sortField);
      const kb = sortKey(b, sortField);
      if (ka < kb) return -1 * dir;
      if (ka > kb) return 1 * dir;
      return 0;
    });
    return out;
  });

  function sortKey(a: RunAssetResponse, field: SortField): string | number {
    if (field === 'filename') return a.filename;
    if (field === 'size') return a.file_size;
    return a.uploaded_at;
  }

  function cycleSort(field: SortField): void {
    if (sortField !== field) {
      sortField = field;
      sortDir = 'ascending';
      return;
    }
    if (sortDir === 'ascending') sortDir = 'descending';
    else if (sortDir === 'descending') sortDir = 'none';
    else sortDir = 'ascending';
  }

  function toggleSubPanel(assetId: number): void {
    openSubPanelAssetId = openSubPanelAssetId === assetId ? null : assetId;
  }

  function mpById(id: number): MiniProjectResponse | undefined {
    if (miniProjects == null) return undefined;
    return miniProjects.find((m) => m.id === id);
  }

  function serveUrl(filename: string): string {
    return `/api/runs/${runId}/assets/${encodeURIComponent(filename)}`;
  }
</script>

<!-- T6-T7 props that T8-T12 will progressively wire are referenced here so
     svelte-check accepts the file (noUnusedLocals: true). Each line is
     removed as the corresponding task lands its real usage. Svelte
     dead-strips {#if false}. -->
{#if false}
  <span aria-hidden="true">
    {course.name} {versionIsDisabled}
    <button onclick={() => onRefetchMiniProjects()}>x</button>
    <button onclick={() => onReloadRun()}>x</button>
  </span>
{/if}

<section
  class="run-assets-tab"
  class:drag-over={dragOver}
  aria-label="Run assets"
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={() => (dragOver = false)}
  ondrop={async (e) => {
    e.preventDefault();
    dragOver = false;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) await performUpload(files);
  }}
>
  <div class="toolbar">
    <div class="filter-pills" role="group" aria-label="Filter assets">
      <button
        type="button"
        aria-pressed={activeFilter === 'all'}
        onclick={() => (activeFilter = 'all')}
      >All ({counts.all})</button>
      <button
        type="button"
        aria-pressed={activeFilter === 'orphan'}
        onclick={() => (activeFilter = 'orphan')}
      >Orphan ({counts.orphan})</button>
      <button
        type="button"
        aria-pressed={activeFilter === 'referenced'}
        onclick={() => (activeFilter = 'referenced')}
      >Referenced ({counts.referenced})</button>
    </div>
    <div class="upload-area">
      <button
        type="button"
        disabled={versionIsDisabled}
        onclick={handleUploadPicker}
      >+ Upload</button>
      <input
        type="file"
        multiple
        bind:this={uploadInputEl}
        onchange={onUploadInputChange}
        style="display:none"
        aria-hidden="true"
      />
      <input
        type="file"
        data-role="replace"
        bind:this={replaceInputEl}
        oncancel={() => { pendingReplaceAssetId = null; }}
        onchange={onReplaceInputChange}
        style="display:none"
        aria-hidden="true"
      />
    </div>
  </div>

  {#if banner}
    <div role="status" class="banner banner-error">{banner}</div>
  {/if}
  {#if uploadProgress}
    <div role="status" aria-live="polite" class="upload-progress">
      Uploading {uploadProgress.current} of {uploadProgress.total}…
    </div>
  {/if}

  {#if assets.length === 0}
    <div class="empty-state">
      <p>No assets yet. Drop files here or click + Upload.</p>
    </div>
  {:else if sortedAssets.length === 0}
    <div class="empty-state">
      <p>No {activeFilter} assets.</p>
    </div>
  {:else}
    <table class="assets-table">
      <thead>
        <tr>
          <th scope="col"><input type="checkbox" disabled aria-label="Select all" /></th>
          <th scope="col" aria-sort={sortField === 'filename' ? sortDir : 'none'}>
            <button type="button" class="sort-btn" onclick={() => cycleSort('filename')}>Filename</button>
          </th>
          <th scope="col" aria-sort={sortField === 'size' ? sortDir : 'none'}>
            <button type="button" class="sort-btn" onclick={() => cycleSort('size')}>Size</button>
          </th>
          <th scope="col" aria-sort={sortField === 'uploaded' ? sortDir : 'none'}>
            <button type="button" class="sort-btn" onclick={() => cycleSort('uploaded')}>Uploaded</button>
          </th>
          <th scope="col">Uploaded by</th>
          <th scope="col">Uses</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each sortedAssets as a (a.id)}
          <tr data-asset-id={a.id}>
            <td><input type="checkbox" aria-label="Select {a.filename}" /></td>
            <td>
              <a href={serveUrl(a.filename)} target="_blank" rel="noopener noreferrer">
                {a.filename}
              </a>
            </td>
            <td>{formatFileSize(a.file_size)}</td>
            <td>{formatLocalWithTz(a.uploaded_at)}</td>
            <td>{a.uploaded_by_email ?? '—'}</td>
            <td>
              {#if miniProjects == null}
                —
              {:else}
                {@const refIds = referencingMpIds(a)}
                {@const isOpen = openSubPanelAssetId === a.id}
                <button
                  type="button"
                  class="uses-badge"
                  aria-expanded={isOpen}
                  aria-controls="uses-{a.id}"
                  onclick={() => toggleSubPanel(a.id)}
                  onkeydown={(e) => {
                    if (e.key === 'Escape' && isOpen) openSubPanelAssetId = null;
                  }}
                >{refIds.length} use{refIds.length === 1 ? '' : 's'}</button>
              {/if}
            </td>
            <td class="actions-cell">
              {#if openConfirm?.kind === 'replace' && openConfirm.assetId === a.id}
                {@const refCount = miniProjects == null ? 0 : referencingMpIds(a).length}
                <div class="inline-confirm">
                  <p>
                    Replace <code>{a.filename}</code> (new size: {formatFileSize(openConfirm.file.size)})?
                    The current content will be overwritten and cannot be recovered.
                    {#if refCount > 0}
                      {refCount} mini-project{refCount === 1 ? '' : 's'} that reference this file will continue to point at the new content.
                    {/if}
                  </p>
                  <button type="button" onclick={performReplace}>Confirm</button>
                  <button type="button" onclick={onReplaceCancel}>Cancel</button>
                </div>
              {/if}
              {#if openConfirm?.kind === 'delete' && openConfirm.assetId === a.id}
                {@const refCount = miniProjects == null ? 0 : referencingMpIds(a).length}
                <div class="inline-confirm">
                  {#if !openConfirm.isReferenced}
                    <p>Delete this asset?</p>
                    <button type="button" onclick={performDelete}>Confirm</button>
                    <button type="button" onclick={cancelDelete}>Cancel</button>
                  {:else}
                    <p id="warn-{a.id}">
                      {#if miniProjects == null}
                        This asset is referenced by other mini-projects.
                      {:else}
                        This asset is referenced by {refCount} mini-project{refCount === 1 ? '' : 's'}.
                      {/if}
                      Deleting it will leave their <code>![ref]</code> markdown broken. This cannot be undone.
                    </p>
                    <label>
                      <input
                        type="checkbox"
                        data-role="force-confirm"
                        checked={openConfirm.checkboxChecked}
                        onchange={(e) => {
                          if (openConfirm?.kind === 'delete') {
                            openConfirm.checkboxChecked = (e.currentTarget as HTMLInputElement).checked;
                          }
                        }}
                      />
                      I understand
                    </label>
                    <button
                      type="button"
                      class="danger"
                      aria-describedby="warn-{a.id}"
                      disabled={!openConfirm.checkboxChecked || !course.is_admin}
                      title={!course.is_admin ? 'Only course admins can force-delete a referenced asset.' : ''}
                      onclick={performDelete}
                    >Force delete</button>
                    <button type="button" onclick={cancelDelete}>Cancel</button>
                  {/if}
                </div>
              {/if}
              <button
                type="button"
                disabled={versionIsDisabled}
                title={versionIsDisabled ? "This run's course version is disabled." : ''}
                onclick={() => handleReplaceClick(a.id)}
              >↻ Replace</button>
              <button
                type="button"
                disabled={versionIsDisabled}
                aria-label="Delete {a.filename}"
                title={versionIsDisabled ? "This run's course version is disabled." : ''}
                onclick={() => handleDeleteClick(a.id, a.is_referenced)}
              >×</button>
            </td>
          </tr>
          {#if openSubPanelAssetId === a.id && miniProjects != null}
            {@const refIds = referencingMpIds(a)}
            <tr id="uses-{a.id}" class="sub-panel-row">
              <td colspan="7">
                <ul class="sub-panel">
                  {#each refIds as mpId (mpId)}
                    {@const mp = mpById(mpId)}
                    {#if mp}
                      <li>
                        <strong>{mp.title}</strong>
                        <button
                          type="button"
                          onclick={() => {
                            openSubPanelAssetId = null;
                            onEditMiniProject(mp);
                          }}
                        >Edit</button>
                      </li>
                    {/if}
                  {/each}
                </ul>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .run-assets-tab {
    padding: 1rem 0;
  }
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
    gap: 1rem;
  }
  .upload-area {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .upload-area button {
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    border: 1px solid #1976d2;
    background: #1976d2;
    color: #fff;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .upload-area button[disabled] {
    background: #ccc;
    border-color: #ccc;
    cursor: not-allowed;
  }
  .upload-progress {
    font-size: 0.85rem;
    color: #555;
    padding: 0.25rem 0.5rem;
  }
  .banner {
    padding: 0.5rem 0.75rem;
    margin: 0.5rem 0;
    border-radius: 4px;
  }
  .banner-error {
    background: #fdecea;
    color: #b71c1c;
    border: 1px solid #f5c6cb;
  }
  .run-assets-tab.drag-over .assets-table,
  .run-assets-tab.drag-over .empty-state {
    outline: 2px dashed #1976d2;
    outline-offset: -2px;
  }
  .filter-pills {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0;
  }
  .filter-pills button {
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    border: 1px solid #ddd;
    background: #fff;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .filter-pills button[aria-pressed='true'] {
    background: #e3f2fd;
    color: #0d47a1;
    border-color: #90caf9;
  }
  .empty-state {
    padding: 2rem;
    text-align: center;
    color: #666;
  }
  .assets-table {
    width: 100%;
    border-collapse: collapse;
  }
  .assets-table th,
  .assets-table td {
    text-align: left;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #eee;
  }
  .assets-table th {
    background: #fafafa;
    font-weight: 600;
  }
  .sort-btn {
    background: none;
    border: none;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
  }
  .uses-badge {
    background: #e8f5e9;
    color: #1b5e20;
    border: 1px solid #c8e6c9;
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
    cursor: pointer;
    font-size: 0.8rem;
  }
  .uses-badge[aria-expanded='true'] {
    background: #c8e6c9;
  }
  .sub-panel-row td {
    background: #fafafa;
  }
  .sub-panel {
    margin: 0;
    padding: 0.5rem 1rem;
    list-style: none;
  }
  .sub-panel li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.25rem 0;
  }
  .actions-cell {
    white-space: nowrap;
  }
  .actions-cell button {
    margin-left: 0.25rem;
    padding: 0.15rem 0.5rem;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .inline-confirm {
    background: #fff3e0;
    border: 1px solid #ffe0b2;
    padding: 0.5rem;
    border-radius: 4px;
    margin-bottom: 0.5rem;
    white-space: normal;
  }
  .inline-confirm p {
    margin: 0 0 0.5rem 0;
    font-size: 0.85rem;
  }
  .inline-confirm code {
    background: #fff;
    padding: 0 0.25rem;
    border-radius: 2px;
  }
  .inline-confirm label {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    margin-right: 0.5rem;
    font-size: 0.85rem;
  }
  button.danger {
    background: #c62828;
    color: #fff;
    border: 1px solid #c62828;
  }
  button.danger:disabled {
    background: #ef9a9a;
    border-color: #ef9a9a;
    cursor: not-allowed;
  }
</style>
