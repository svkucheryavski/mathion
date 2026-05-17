<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { formatRef } from '../../lib/assets';
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

  onMount(() => { if (readOnly) void loadPreview(); });
  onDestroy(() => { latestReq++; });
</script>

<div class="editor">
  {#if !readOnly}
    <div class="tabs">
      <button type="button" aria-pressed={mode === 'edit'} onclick={() => setMode('edit')}>Edit</button>
      <button type="button" aria-pressed={mode === 'preview'} onclick={() => setMode('preview')}>Preview</button>
    </div>
  {/if}
  {#if mode === 'edit' && !readOnly}
    <div class="edit-content">
      <textarea
        bind:this={textareaEl}
        bind:value
        rows="14"
        spellcheck="false"
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
</style>
