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
  let uploadError = $state<string | null>(null);
  let dragOver = $state(false);
  // Plain let (not $state): only read inside async callbacks + $effect cleanup,
  // never in reactive/template positions.
  let mounted = true;
  // Single-upload design: `performUpload` is the only entry point and runs
  // sequentially. If concurrency is ever introduced, this needs to become a Set.
  let activeUploadController: AbortController | null = null;
  $effect(() => () => {
    mounted = false;
    activeUploadController?.abort();
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
    uploadError = null;
    for (const f of files) {
      const err = validateFile(f);
      if (err) { uploadError = err; return; }
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
            uploadError = `An asset named '${files[i]!.name}' already exists. Use Replace on the existing row, or rename your file.`;
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
    </div>
  </div>

  {#if uploadError}
    <div role="alert" class="banner banner-error">{uploadError}</div>
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
            <td>—</td>
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
</style>
