<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { formatRef, uploadAsset, type AssetResponse } from '../../lib/assets';
  import AssetSidebar from './AssetSidebar.svelte';

  type UploadProgress = { current: number; total: number; filename: string } | null;
  type UploadError = { detail: string; stoppedAt?: { n: number; m: number } } | null;

  let {
    versionId,
    value = $bindable<string>(''),
    readOnly = false,
    refreshKey = $bindable<number>(0),
  }: {
    versionId: number;
    value?: string;
    readOnly?: boolean;
    refreshKey?: number;
  } = $props();

  let _mode = $state<'edit' | 'preview'>('edit');
  const mode = $derived<'edit' | 'preview'>(readOnly ? 'preview' : _mode);
  let html = $state<string | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let latestReq = 0;

  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let lastOffset = $state(0);
  let cursorReady = $state(false);
  let uploading = $state(false);
  let uploadProgress = $state<UploadProgress>(null);
  let uploadError = $state<UploadError>(null);

  $effect(() => { if (!cursorReady) lastOffset = value.length; });

  function onTextareaFocus() { cursorReady = true; updateLastOffset(); }
  function onTextareaBlur() { updateLastOffset(); }
  function onTextareaSelectionChange() { updateLastOffset(); }
  function updateLastOffset() {
    if (textareaEl) lastOffset = textareaEl.selectionStart ?? lastOffset;
  }

  function insertAtCursor(text: string, atOffset?: number) {
    if (!textareaEl) return;
    const offset = atOffset ?? lastOffset;
    const before = value.slice(0, offset);
    const after = value.slice(offset);
    value = before + text + after;
    const newPos = offset + text.length;
    queueMicrotask(() => {
      if (!textareaEl) return;
      textareaEl.focus();
      textareaEl.setSelectionRange(newPos, newPos);
      lastOffset = newPos;
    });
  }

  let flashUntil = $state(0);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  // Page-level drop navigation guard. While the editor is mounted, any file
  // drop that ISN'T caught by our dedicated handlers (textarea, wrapper,
  // sidebar) would otherwise navigate the browser away to display the file,
  // destroying any unsaved textarea content. Suppress that by calling
  // preventDefault on window-level dragover and drop, but ONLY for file
  // drags. Non-file drags (URL drags, internal text drags) pass through.
  function guardFileDropNavigation(e: DragEvent) {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
    }
  }

  function flashOverlay() {
    flashUntil = Date.now() + 1500;
    if (flashTimer !== null) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashUntil = 0; flashTimer = null; }, 1500);
  }

  async function runMarkdownEditorUpload(
    files: File[],
    onEachSuccess: (asset: AssetResponse, index: number) => void,
  ): Promise<void> {
    if (uploading) { flashOverlay(); return; }
    uploading = true;
    uploadError = null;
    let i = 0;
    try {
      for (; i < files.length; i++) {
        uploadProgress = { current: i + 1, total: files.length, filename: files[i].name };
        const asset = await uploadAsset(versionId, files[i]);
        onEachSuccess(asset, i);
        refreshKey++;
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

  function dropOffsetFromPoint(e: DragEvent): number {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = document as any;
    if (typeof doc.caretPositionFromPoint === 'function') {
      const pos = doc.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos && typeof pos.offset === 'number') return pos.offset;
    }
    if (typeof doc.caretRangeFromPoint === 'function') {
      const r = doc.caretRangeFromPoint(e.clientX, e.clientY);
      if (r && typeof r.startOffset === 'number') return r.startOffset;
    }
    return lastOffset;
  }

  function handleTextareaDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }
  function handleTextareaDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    let offset = dropOffsetFromPoint(e);
    void runMarkdownEditorUpload(files, (asset) => {
      const ref = formatRef(asset.filename, asset.mime_type);
      insertAtCursor(ref, offset);
      offset += ref.length;
      cursorReady = true;
    });
  }

  function handleWrapperDragOver(e: DragEvent) {
    e.preventDefault();
  }
  function handleWrapperDrop(e: DragEvent) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    void runMarkdownEditorUpload(files, () => { /* no insert */ });
  }

  function handleSidebarInsert(filename: string, mimeType: string) {
    cursorReady = true;
    insertAtCursor(formatRef(filename, mimeType));
  }

  async function loadPreview() {
    const reqId = ++latestReq;
    loading = true;
    error = null;
    try {
      const res = await api.post<{ html: string }>(`/api/versions/${versionId}/render`, { content_md: value });
      if (reqId !== latestReq) return;
      html = res.html;
    } catch (e) {
      if (reqId !== latestReq) return;
      error = e instanceof ApiError ? e.displayMessage : 'Could not render preview.';
    } finally {
      if (reqId === latestReq) loading = false;
    }
  }

  function setMode(m: 'edit' | 'preview') {
    _mode = m;
    if (m === 'preview') loadPreview();
  }

  onMount(() => {
    if (readOnly) void loadPreview();
    window.addEventListener('dragover', guardFileDropNavigation);
    window.addEventListener('drop', guardFileDropNavigation);
  });
  onDestroy(() => {
    latestReq++;
    if (flashTimer !== null) clearTimeout(flashTimer);
    window.removeEventListener('dragover', guardFileDropNavigation);
    window.removeEventListener('drop', guardFileDropNavigation);
  });
</script>

<div class="editor">
  {#if !readOnly}
    <div class="tabs">
      <button type="button" aria-pressed={mode === 'edit'} onclick={() => setMode('edit')}>Edit</button>
      <button type="button" aria-pressed={mode === 'preview'} onclick={() => setMode('preview')}>Preview</button>
    </div>
  {/if}
  {#if mode === 'edit' && !readOnly}
    <div
      class="edit-content"
      role="region"
      aria-label="Markdown editor"
      ondragover={handleWrapperDragOver}
      ondrop={handleWrapperDrop}
      class:flash={flashUntil > 0}
    >
      <textarea
        bind:this={textareaEl}
        bind:value
        rows="14"
        spellcheck="false"
        ondragover={handleTextareaDragOver}
        ondrop={handleTextareaDrop}
        onfocus={onTextareaFocus}
        onblur={onTextareaBlur}
        onselectionchange={onTextareaSelectionChange}
      ></textarea>
      <AssetSidebar
        {versionId}
        onInsert={handleSidebarInsert}
        {refreshKey}
        {cursorReady}
        bind:uploading
        bind:uploadProgress
        bind:uploadError
      />
    </div>
  {:else if loading}
    <div class="preview"><em>Rendering…</em></div>
  {:else if error}
    <div class="preview err">{error}</div>
  {:else}
    <div class="preview">{@html html ?? ''}</div>
  {/if}
</div>

<style>
  .editor { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; display: flex; flex-direction: column; }
  .tabs { display: flex; border-bottom: 1px solid var(--border); }
  .tabs button { background: none; border: 0; padding: var(--space-2) var(--space-3); cursor: pointer; }
  .tabs button[aria-pressed="true"] { background: var(--surface, #f7f7f7); font-weight: 600; }
  .edit-content { display: flex; flex-direction: row; min-height: 0; }
  textarea { flex: 1 1 0; min-width: 0; border: 0; padding: var(--space-3); font-family: ui-monospace, monospace; }
  .preview { padding: var(--space-3); min-height: 200px; }
  .preview.err { color: #a33; }
  .edit-content.flash { box-shadow: inset 0 0 0 2px #c62828; }
</style>
