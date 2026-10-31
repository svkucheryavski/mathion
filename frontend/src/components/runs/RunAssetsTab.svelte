<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type {
    BlockResponse,
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
  import { blockPositions } from '../../lib/blockNumbers';
  import { focusFirst } from '../../lib/focusFirst';
  import Button from '../ui/Button.svelte';
  import DangerConfirm from '../ui/DangerConfirm.svelte';
  import FilterPills from '../ui/FilterPills.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import SortMark from '../ui/SortMark.svelte';

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
    blocks = [],
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
    blocks?: BlockResponse[];
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
  // delete, and bulk-delete confirms.
  type OpenConfirm =
    | { kind: 'replace'; assetId: number; file: File }
    | { kind: 'delete'; assetId: number; isReferenced: boolean }
    | { kind: 'bulk-delete'; orphanCount: number; referencedCount: number };
  let openConfirm = $state<OpenConfirm | null>(null);

  const VERSION_OFF = "This run's course version is disabled.";
  let headingEl = $state<HTMLElement>();
  let uploadEl = $state<HTMLButtonElement>();
  let bulkBtnEl = $state<HTMLButtonElement>();
  const trashEls: Record<number, HTMLButtonElement | undefined> = $state({});
  const replaceEls: Record<number, HTMLButtonElement | undefined> = $state({});

  // The replace or single-delete confirm open on this row, if any.
  function confirmFor(assetId: number) {
    const c = openConfirm;
    return c && c.kind !== 'bulk-delete' && c.assetId === assetId ? c : null;
  }

  async function focusRow(els: Record<number, HTMLButtonElement | undefined>, assetId: number) {
    await tick();
    focusFirst([els[assetId], uploadEl, headingEl]);
  }

  // A refetch that removed or moved the focused row drops focus to <body> (§Focus).
  async function rescueFocus(first?: HTMLElement) {
    await tick();
    if (document.activeElement === document.body) focusFirst([first, uploadEl, headingEl]);
  }

  // Bulk selection (filter-aware). Filter changes clear it; single source of
  // truth for the action strip + bulk-delete loop.
  let selectedIds = $state<Set<number>>(new Set());
  // Bulk summary banner (informational; separate from the single `banner`
  // error slot so a partial-fail summary persists alongside any newer error).
  let summaryBanner = $state<string | null>(null);
  let bulkController: AbortController | null = null;

  // 404 storm coalescer (spec L213): first 404 starts a 500ms timer;
  // subsequent 404s within the window are coalesced into ONE banner +
  // ONE refetch on flush.
  let storm404Timer: ReturnType<typeof setTimeout> | null = null;
  let storm404Seen = 0;

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
      bulkController?.abort();
      bulkController = null;
      if (storm404Timer != null) {
        clearTimeout(storm404Timer);
        storm404Timer = null;
        storm404Seen = 0;
      }
      openConfirm = null;
      banner = null;
      summaryBanner = null;
      uploadProgress = null;
      pendingReplaceAssetId = null;
      dragOver = false;
      selectedIds = new Set();
    };
  });

  // Filter change clears the selection (spec L179: "simplest invariant").
  // Only `activeFilter` is tracked; the openConfirm read is wrapped in
  // untrack() so opening a bulk-confirm doesn't re-fire this effect and
  // clobber its own state.
  $effect(() => {
    activeFilter;
    untrack(() => {
      selectedIds = new Set();
      if (openConfirm?.kind === 'bulk-delete') openConfirm = null;
      banner = null;
      summaryBanner = null;
    });
  });

  // Auto-dismiss banners after 30s so transient errors / summaries don't
  // linger forever when the user moves on. Each banner has its own effect
  // so setting one doesn't reset the other's timer.
  $effect(() => {
    if (!banner) return;
    const t = setTimeout(() => { if (mounted) banner = null; }, 30_000);
    return () => clearTimeout(t);
  });
  $effect(() => {
    if (!summaryBanner) return;
    const t = setTimeout(() => { if (mounted) summaryBanner = null; }, 30_000);
    return () => clearTimeout(t);
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
    const bannerAtStart = banner;
    let anySuccess = false;
    try {
      for (let i = 0; i < files.length; i++) {
        if (!mounted) return;
        try {
          await uploadRunAsset(runId, files[i]!, controller.signal);
          if (!mounted) return;
          anySuccess = true;
          uploadProgress = { current: i + 1, total: files.length };
        } catch (e: unknown) {
          const err = e as { name?: string; status?: number; message?: string } | null;
          if (!mounted) return;
          if (err?.name === 'AbortError') {
            if (anySuccess) await onRefetchAssets();
            return;
          }
          if (err?.status === 409) {
            banner = `An asset named '${files[i]!.name}' already exists. Use Replace on the existing row, or rename your file.`;
          } else if (err?.status === 413) {
            banner = `Uploading '${files[i]!.name}' would exceed this run's storage quota.`;
          } else {
            banner = err?.message ?? `Failed to upload '${files[i]!.name}'.`;
          }
          if (anySuccess && mounted) await onRefetchAssets();
          return;
        }
      }
      if (mounted) await onRefetchAssets();
      if (mounted && banner === bannerAtStart) banner = null;
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
    // One panel under a row (R14): the replace confirm closes "used by".
    if (openSubPanelAssetId === aid) openSubPanelAssetId = null;
    openConfirm = { kind: 'replace', assetId: aid, file };
  }

  function onReplaceCancel(assetId: number): void {
    pendingReplaceAssetId = null;
    openConfirm = null;
    void focusRow(replaceEls, assetId);
  }

  function toggleSelectAll(): void {
    if (versionIsDisabled) return;
    const visible = sortedAssets;
    if (visible.length === 0) return;
    const allSelected = visible.every((a) => selectedIds.has(a.id));
    selectedIds = allSelected ? new Set() : new Set(visible.map((a) => a.id));
  }

  function toggleRow(id: number): void {
    if (versionIsDisabled) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds = next;
  }

  function openBulkConfirm(): void {
    if (versionIsDisabled || selectedIds.size === 0) return;
    let orphanCount = 0;
    let referencedCount = 0;
    for (const a of assets) {
      if (!selectedIds.has(a.id)) continue;
      if (a.is_referenced) referencedCount++;
      else orphanCount++;
    }
    banner = null;
    openConfirm = { kind: 'bulk-delete', orphanCount, referencedCount };
  }

  async function cancelBulk(): Promise<void> {
    if (openConfirm?.kind !== 'bulk-delete') return;
    openConfirm = null;
    await tick();
    bulkBtnEl?.focus();
  }

  // Storm coalescer (spec L213). Idempotent across single-delete + bulk-loop
  // 404s. First 404 schedules the 500ms timer; subsequent 404s in the window
  // increment the counter. On flush: one banner + one onRefetchAssets().
  function note404(): void {
    storm404Seen++;
    if (storm404Timer != null) return;
    storm404Timer = setTimeout(async () => {
      const seen = storm404Seen;
      storm404Timer = null;
      storm404Seen = 0;
      if (!mounted) return;
      banner = seen > 1
        ? 'Some assets were deleted by another user.'
        : 'This asset was deleted by another user.';
      await onRefetchAssets();
      await rescueFocus();
    }, 500);
  }

  async function performBulkDelete(): Promise<void> {
    if (openConfirm?.kind !== 'bulk-delete' || selectedIds.size === 0) return;
    const myRunId = runId;
    const ids = Array.from(selectedIds);
    const bannerAtStart = banner;
    openConfirm = null;
    // The confirm unmounts under the focus: wait on the strip button.
    void tick().then(() => focusFirst([bulkBtnEl, uploadEl, headingEl]));
    const controller = new AbortController();
    bulkController = controller;
    const failed: string[] = [];
    let done = 0;
    let had404 = false;
    const total = ids.length;
    try {
      for (const aid of ids) {
        if (!mounted || runId !== myRunId) {
          controller.abort();
          if (mounted) await onRefetchAssets();
          return;
        }
        const asset = assets.find((x) => x.id === aid);
        if (!asset) { failed.push(`#${aid}`); continue; }
        try {
          await deleteRunAsset(runId, aid, {
            force: asset.is_referenced,
            signal: controller.signal,
          });
          done++;
        } catch (e: unknown) {
          const err = e as { name?: string; status?: number } | null;
          if (err?.name === 'AbortError') {
            if (mounted) await onRefetchAssets();
            return;
          }
          if (err?.status === 404) {
            note404();
            had404 = true;
            done++;
            continue;
          }
          failed.push(asset.filename);
        }
      }
      if (!mounted) return;
      if (banner === bannerAtStart) banner = null;
      // Spec L213: if any 404 fired note404(), the storm timer owns the assets
      // refetch — skip the bulk's own to avoid a duplicate. miniProjects is
      // never refetched by the storm coalescer, so it still runs when needed.
      const anyReferenced = ids.some((id) => assets.find((a) => a.id === id)?.is_referenced);
      if (had404) {
        if (anyReferenced) await onRefetchMiniProjects();
      } else if (anyReferenced) {
        await Promise.all([onRefetchAssets(), onRefetchMiniProjects()]);
      } else {
        await onRefetchAssets();
      }
      summaryBanner = failed.length === 0
        ? `Deleted ${done} of ${total}.`
        : `Deleted ${done} of ${total}. Failed: ${failed.join(', ')}.`;
      selectedIds = new Set();
      await tick();
      focusFirst([uploadEl, headingEl]);
    } finally {
      // Identity guard: only clear if no newer bulk has reassigned.
      if (bulkController === controller) bulkController = null;
    }
  }

  function handleDeleteClick(assetId: number, isReferenced: boolean): void {
    if (versionIsDisabled) return;
    banner = null;
    // One panel under a row (R14): either delete confirm closes "used by".
    if (openSubPanelAssetId === assetId) openSubPanelAssetId = null;
    openConfirm = { kind: 'delete', assetId, isReferenced };
  }

  function cancelDelete(assetId: number): void {
    openConfirm = null;
    void focusRow(trashEls, assetId);
  }

  async function performDelete(): Promise<void> {
    if (openConfirm?.kind !== 'delete') return;
    const { assetId, isReferenced } = openConfirm;
    const force = isReferenced;
    const idx = sortedAssets.findIndex((a) => a.id === assetId);
    // Clear the confirm slot BEFORE awaiting so the user can't double-submit
    // and a slow request can't clobber state set by newer interactions.
    openConfirm = null;
    void focusRow(trashEls, assetId);
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
        // Route through the storm coalescer (spec L212/213) — banner +
        // refetch happen at the 500ms flush.
        note404();
      } else {
        banner = err?.message ?? 'Delete failed.';
      }
      await focusRow(trashEls, assetId);
      return;
    }
    if (!mounted) return;
    if (banner === bannerAtStart) banner = null;
    if (force) {
      await Promise.all([onRefetchAssets(), onRefetchMiniProjects()]);
    } else {
      await onRefetchAssets();
    }
    // §Focus: the next row's Delete, the previous row's, + Upload, the h2.
    await tick();
    const next = sortedAssets[idx];
    const prev = idx > 0 ? sortedAssets[idx - 1] : undefined;
    focusFirst([next && trashEls[next.id], prev && trashEls[prev.id], uploadEl, headingEl]);
  }

  async function performReplace(): Promise<void> {
    if (openConfirm?.kind !== 'replace') return;
    const { assetId, file } = openConfirm;
    // Clear the confirm slot BEFORE awaiting so the user can't double-submit
    // and a slow request can't clobber state set by newer interactions.
    openConfirm = null;
    void focusRow(replaceEls, assetId);
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
        await rescueFocus();
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
    // A new size or date can move the row under that sort, which blurs its ↻.
    await rescueFocus(replaceEls[assetId]);
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
    const opening = openSubPanelAssetId !== assetId;
    openSubPanelAssetId = opening ? assetId : null;
    const c = confirmFor(assetId);
    // One panel under a row (R14): "used by" closes either delete confirm and
    // the replace confirm.
    if (opening && c?.kind === 'delete') openConfirm = null;
    if (opening && c?.kind === 'replace') { openConfirm = null; pendingReplaceAssetId = null; }
  }

  function mpById(id: number): MiniProjectResponse | undefined {
    if (miniProjects == null) return undefined;
    return miniProjects.find((m) => m.id === id);
  }

  const positions = $derived(blockPositions(blocks));
  function mpLabel(mp: MiniProjectResponse): string {
    const n = positions.get(mp.block_id);
    const block = blocks.find((b) => b.id === mp.block_id);
    return n !== undefined && block ? `Block ${n} — ${block.title}` : mp.title;
  }

  function serveUrl(filename: string): string {
    return `/api/runs/${runId}/assets/${encodeURIComponent(filename)}`;
  }
</script>

{#snippet sortTh(field: SortField, label: string)}
  <th scope="col" aria-sort={sortField === field ? sortDir : 'none'}>
    <button type="button" class="sort-btn" onclick={() => cycleSort(field)}>{label}{#if sortField === field && sortDir !== 'none'}<SortMark dir={sortDir === 'ascending' ? 'asc' : 'desc'} />{/if}</button>
  </th>
{/snippet}

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
  <div class="sec-head">
    <h2 tabindex="-1" bind:this={headingEl}>Assets <span class="sec-count">{assets.length}</span></h2>
    <div class="upload-area">
      <Button variant="primary" data-action="upload" disabled={versionIsDisabled}
              title={versionIsDisabled ? VERSION_OFF : undefined} bind:element={uploadEl}
              onclick={handleUploadPicker}>+ Upload</Button>
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
    <div role="alert" class="banner banner-error">{banner}</div>
  {/if}
  {#if summaryBanner}
    <div role="status" class="banner banner-info">{summaryBanner}</div>
  {/if}

  <FilterPills
    label="Filter assets"
    value={activeFilter}
    onchange={(k) => (activeFilter = k as FilterPill)}
    options={[
      { key: 'all', label: 'All', count: counts.all },
      { key: 'orphan', label: 'Orphan', count: counts.orphan },
      { key: 'referenced', label: 'Referenced', count: counts.referenced },
    ]}
  />

  {#if selectedIds.size > 0}
    <div class="bulk-strip">
      <span class="bulk-n">{selectedIds.size} selected</span>
      {#if openConfirm?.kind === 'bulk-delete'}
        {@const bc = openConfirm}
        {@const total = bc.orphanCount + bc.referencedCount}
        {#if bc.referencedCount > 0}
          {#snippet bulkMessage()}
            Delete {total} selected ({bc.orphanCount} orphan, {bc.referencedCount} referenced)?
            This will break <code>![ref]</code> markdown in {bc.referencedCount} mini-project{bc.referencedCount === 1 ? '' : 's'}.
            This cannot be undone.
          {/snippet}
          <div class="bulk-panel">
            <DangerConfirm
              message={bulkMessage}
              disabledReason={course.is_admin ? undefined : 'Only course admins can force-delete a referenced asset.'}
              onConfirm={performBulkDelete}
              onCancel={() => void cancelBulk()}
            />
          </div>
        {:else}
          <InlineConfirm takeFocus warning="Delete {total} selected ({bc.orphanCount} orphan, {bc.referencedCount} referenced)?"
                         confirmLabel="Delete" onConfirm={performBulkDelete} onCancel={() => void cancelBulk()} />
        {/if}
      {:else}
        <Button variant="danger" disabled={versionIsDisabled} title={versionIsDisabled ? VERSION_OFF : undefined}
                bind:element={bulkBtnEl} onclick={openBulkConfirm}>Delete {selectedIds.size} selected</Button>
      {/if}
    </div>
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
          <th scope="col" class="col-check">
            <input
              type="checkbox"
              aria-label="Select all"
              checked={sortedAssets.length > 0 && sortedAssets.every((a) => selectedIds.has(a.id))}
              disabled={versionIsDisabled}
              onclick={toggleSelectAll}
            />
          </th>
          {@render sortTh('filename', 'Filename')}
          {@render sortTh('size', 'Size')}
          {@render sortTh('uploaded', 'Uploaded')}
          <th scope="col">Uploaded by</th>
          <th scope="col">Uses</th>
          <th scope="col"><span class="vh">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {#each sortedAssets as a (a.id)}
          {@const refIds = miniProjects == null ? [] : referencingMpIds(a)}
          {@const subOpen = openSubPanelAssetId === a.id && miniProjects != null}
          {@const rc = confirmFor(a.id)}
          <tr data-asset-id={a.id}>
            <td class="col-check">
              <input
                type="checkbox"
                aria-label="Select {a.filename}"
                checked={selectedIds.has(a.id)}
                disabled={versionIsDisabled}
                onclick={() => toggleRow(a.id)}
              />
            </td>
            <td class="a-name">
              <a href={serveUrl(a.filename)} target="_blank" rel="noopener noreferrer">{a.filename}</a>
            </td>
            <td class="num">{formatFileSize(a.file_size)}</td>
            <td class="num">{formatLocalWithTz(a.uploaded_at)}</td>
            <td class="num">{a.uploaded_by_email ?? '—'}</td>
            <td>
              {#if miniProjects == null}
                —
              {:else}
                <button
                  type="button"
                  class="uses-chip"
                  class:uses-on={refIds.length > 0}
                  class:uses-off={refIds.length === 0}
                  aria-expanded={subOpen}
                  aria-controls="uses-{a.id}"
                  onclick={() => toggleSubPanel(a.id)}
                  onkeydown={(e) => {
                    if (e.key === 'Escape' && subOpen) openSubPanelAssetId = null;
                  }}
                >{refIds.length} use{refIds.length === 1 ? '' : 's'}</button>
              {/if}
            </td>
            <td class="actions-cell">
              <span class="row-icons">
                <IconButton glyph="refresh" size="sm" aria-label="Replace {a.filename}"
                            title={versionIsDisabled ? VERSION_OFF : 'Replace'} disabled={versionIsDisabled}
                            data-action="replace" bind:element={replaceEls[a.id]}
                            onclick={() => handleReplaceClick(a.id)} />
                <IconButton glyph="trash" size="sm" danger aria-label="Delete {a.filename}"
                            title={versionIsDisabled ? VERSION_OFF : 'Delete'} disabled={versionIsDisabled}
                            data-action="delete-asset" bind:element={trashEls[a.id]}
                            onclick={() => handleDeleteClick(a.id, a.is_referenced)} />
              </span>
            </td>
          </tr>
          {#if rc?.kind === 'delete' && !rc.isReferenced}
            <!-- A one-line full-width row under its row, like the replace confirm
                 and the danger panel (Safari pass). -->
            <tr class="delete-row">
              <td colspan="7">
                <InlineConfirm row align="end" takeFocus warning="Delete this asset?" confirmLabel="Delete" onConfirm={performDelete} onCancel={() => cancelDelete(a.id)} />
              </td>
            </tr>
          {/if}
          {#if rc?.kind === 'replace'}
            <tr class="replace-row">
              <td colspan="7">
                <!-- A full-width row under its row (browser pass): in the 1%-wide
                     actions cell the text squeezed to a narrow column. -->
                {#snippet replaceMessage()}
                  Replace <code>{a.filename}</code> (new size: {formatFileSize(rc.file.size)})?
                  The current content will be overwritten and cannot be recovered.
                  {#if refIds.length > 0}
                    {refIds.length} mini-project{refIds.length === 1 ? '' : 's'} that reference this file will continue to point at the new content.
                  {/if}
                {/snippet}
                <InlineConfirm takeFocus layout="column" label="Replace {a.filename}?" message={replaceMessage}
                               confirmLabel="Replace" onConfirm={performReplace} onCancel={() => onReplaceCancel(a.id)} />
              </td>
            </tr>
          {/if}
          {#if rc?.kind === 'delete' && rc.isReferenced}
            {#snippet rowMessage()}
              {#if miniProjects == null}
                This asset is referenced by other mini-projects.
              {:else}
                This asset is referenced by {refIds.length} mini-project{refIds.length === 1 ? '' : 's'}.
              {/if}
              Deleting it will leave their <code>![ref]</code> markdown broken. This cannot be undone.
            {/snippet}
            <tr class="danger-row">
              <td colspan="7">
                <DangerConfirm
                  message={rowMessage}
                  disabledReason={course.is_admin ? undefined : 'Only course admins can force-delete a referenced asset.'}
                  onConfirm={performDelete}
                  onCancel={() => cancelDelete(a.id)}
                />
              </td>
            </tr>
          {:else if subOpen}
            <tr id="uses-{a.id}" class="sub-panel-row">
              <td colspan="7">
                <div class="sub-panel">
                  <p class="sp-head"><code>{a.filename}</code> — used by</p>
                  <ul>
                    {#each refIds as mpId (mpId)}
                      {@const mp = mpById(mpId)}
                      {#if mp}
                        <li>
                          <span class="sp-mp">{mpLabel(mp)}</span>
                          <button
                            type="button"
                            class="linklike"
                            onclick={() => {
                              openSubPanelAssetId = null;
                              onEditMiniProject(mp);
                            }}
                          >Edit</button>
                        </li>
                      {/if}
                    {/each}
                  </ul>
                </div>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .run-assets-tab { display: flex; flex-direction: column; gap: 10px; }
  .run-assets-tab.drag-over .assets-table,
  .run-assets-tab.drag-over .empty-state { outline: 2px dashed var(--primary); outline-offset: 2px; }

  .banner { margin: 0; padding: 8px 12px; border-left: 3px solid; border-radius: var(--radius); font-size: 13px; }
  .banner-error { background: var(--danger-panel-bg); border-left-color: var(--danger); color: var(--danger-panel-fg); }
  .banner-info { background: var(--surface-2); border-left-color: var(--primary); color: var(--text-2); }

  .sec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .sec-head h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .sec-head h2:focus { outline: none; }
  .sec-count { font-family: var(--font-mono); font-size: 12px; font-weight: 400; color: var(--muted); }
  .upload-area { display: flex; align-items: center; gap: 8px; }
  .upload-progress { font-family: var(--font-mono); font-size: 12px; color: var(--muted); }

  .bulk-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 8px 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .bulk-n { font-family: var(--font-mono); font-size: 12.5px; color: var(--text-2); }
  .bulk-panel { flex: 1 1 100%; }

  .empty-state {
    padding: 24px 12px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius);
    text-align: center;
    font-size: 13px;
    color: var(--muted);
  }
  .empty-state p { margin: 0; }

  .assets-table { width: 100%; border-collapse: collapse; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); font-size: 13px; }
  .assets-table th {
    padding: 8px 10px;
    text-align: left;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-3);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .assets-table td { padding: 6px 10px; border-top: 1px solid var(--border-soft); color: var(--text); vertical-align: middle; }
  .col-check { width: 1%; }
  .sort-btn { display: inline-flex; align-items: center; gap: 4px; padding: 0; background: none; border: 0; font: inherit; color: inherit; cursor: pointer; }
  .a-name a { color: var(--primary); text-decoration: none; }
  .a-name a:hover { text-decoration: underline; }
  .num { font-family: var(--font-mono); font-size: 12px; color: var(--text-2); white-space: nowrap; }

  .uses-chip { padding: 1px 8px; border: 0; border-radius: var(--radius-pill); font-family: var(--font-mono); font-size: 11.5px; white-space: nowrap; cursor: pointer; }
  .uses-on { background: var(--status-accepted-bg); color: var(--status-accepted-fg); }
  .uses-off { background: var(--status-not-submitted-bg); color: var(--status-not-submitted-fg); }
  .uses-chip[aria-expanded='true'] { box-shadow: 0 0 0 1px var(--border-strong); }

  .actions-cell { width: 1%; white-space: nowrap; text-align: right; }
  .row-icons { display: inline-flex; gap: 4px; }
  .sp-head code { font-family: var(--font-mono); }

  .danger-row td, .sub-panel-row td, .replace-row td, .delete-row td { padding: 0 10px 10px; border-top: 0; }
  .sub-panel { padding: 8px 12px; background: var(--surface-2); border-radius: var(--radius); }
  .sp-head { margin: 0 0 6px; font-size: 12px; color: var(--muted); }
  .sub-panel ul { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
  .sub-panel li { display: flex; align-items: center; gap: 10px; font-size: 13px; }
  .linklike { background: none; border: 0; padding: 0; font: inherit; color: var(--primary); text-decoration: underline; cursor: pointer; }
  .vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
