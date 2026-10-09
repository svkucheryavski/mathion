<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { formatRef } from '../../lib/assets';
  import type { AssetContext, AssetItem } from '../../lib/assetContext';
  import AssetSidebar from './AssetSidebar.svelte';

  type UploadProgress = { current: number; total: number; filename: string } | null;
  type UploadError = { detail: string; stoppedAt?: { n: number; m: number } } | null;

  let {
    assetContext,
    value = $bindable<string>(''),
    readOnly = false,
    disabled = false,
    refreshKey = $bindable<number>(0),
    uploading = $bindable<boolean>(false),
    uploadProgress = $bindable<UploadProgress>(null),
    uploadError = $bindable<UploadError>(null),
    uploadAbortController = $bindable<AbortController | null>(null),
    ariaDescribedby = undefined,
    ariaLabel = undefined,
    plain = false,
    frozen = false,
    noAssets = false,
  }: {
    assetContext: AssetContext;
    value?: string;
    readOnly?: boolean;
    disabled?: boolean;
    refreshKey?: number;
    uploading?: boolean;
    uploadProgress?: UploadProgress;
    uploadError?: UploadError;
    uploadAbortController?: AbortController | null;
    ariaDescribedby?: string;
    // Slice-5b R10: the textarea's accessible name. The editor used to sit
    // inside a <label>; the modal's bodies have none (PageBody: "Content").
    ariaLabel?: string;
    // Slice-5b D6: read-only source text — no tabs, no sidebar, no /render call
    // (a disabled version's /render is a deliberate 403). Wins over readOnly.
    plain?: boolean;
    // Slice-5b D10/D9: a Save or a delete is in flight. The textarea turns
    // readonly WITHOUT blurring (disabled would blur, readOnly would unmount it),
    // and drops / sidebar inserts / uploads are blocked. Tabs stay usable.
    frozen?: boolean;
    // Slice-5d D11: the explanation editor. Edit/Preview stay; there is no
    // sidebar and no upload path. The window file-drop guard still runs.
    noAssets?: boolean;
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

  // editorMounted gates post-await writes inside uploadOne so a fetch that
  // resolves after the modal closes does not write to dead $state.
  let editorMounted = $state(false);

  $effect(() => { if (!cursorReady) lastOffset = value.length; });

  function onTextareaFocus() { cursorReady = true; updateLastOffset(); }
  function onTextareaBlur() { updateLastOffset(); }
  function onTextareaSelectionChange() { updateLastOffset(); }
  function updateLastOffset() {
    if (textareaEl) lastOffset = textareaEl.selectionStart ?? lastOffset;
  }

  function insertAtCursor(text: string, atOffset?: number) {
    // §7.2: while the editor is frozen (`disabled`, or `frozen` while a save is
    // in flight and an upload resolves late), no programmatic insert may
    // mutate the markdown. The old readOnly path unmounted the textarea so a
    // late drop/sidebar upload no-op'd on `!textareaEl`; now the textarea stays
    // mounted, so this guard is what preserves the freeze. Central here so it
    // covers every caller (textarea drop + sidebar insert).
    if (!textareaEl || disabled || frozen) return;
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

  // Single shared upload helper. Textarea drop, wrapper drop, AND the sidebar's
  // drop/file-picker all route through this so the AbortController, single-
  // flight guard, and overlay state are owned in ONE place. Without this
  // single path, sidebar-initiated and textarea/wrapper-drop uploads can race
  // and clear each other's controllers.
  async function uploadOne(
    file: File,
    batch?: { current: number; total: number },
  ): Promise<AssetItem | null> {
    if (frozen || noAssets) return null;
    if (uploading) { flashOverlay(); return null; }
    const controller = new AbortController();
    uploadAbortController = controller;
    uploading = true;
    uploadError = null;
    uploadProgress = {
      current: batch?.current ?? 1,
      total: batch?.total ?? 1,
      filename: file.name,
    };
    try {
      const item = await assetContext.upload(file, controller.signal);
      if (!editorMounted) return null;
      return item;
    } catch (e: unknown) {
      if (!editorMounted) return null;
      // jsdom DOMException doesn't extend Error — duck-check .name.
      const name = typeof e === 'object' && e !== null ? (e as { name?: string }).name : undefined;
      if (name === 'AbortError') return null;
      // Spec line 260: String(e?.detail ?? e?.message ?? e). ApiError uses
      // displayMessage (the validation-aware accessor); everything else
      // walks the .detail → .message → String(e) chain so plain objects
      // like { detail: '...' } or { message: '...' } are surfaced too.
      let baseDetail: string;
      if (e instanceof ApiError) {
        baseDetail = e.displayMessage;
      } else {
        const eo = e as { detail?: unknown; message?: unknown } | null | undefined;
        baseDetail = String(eo?.detail ?? eo?.message ?? e);
      }
      const renameHint = e instanceof ApiError && e.status === 409
        ? ' Rename the file on disk and re-upload.'
        : '';
      uploadError = {
        detail: baseDetail + renameHint,
        stoppedAt: batch && batch.total > 1 ? { n: batch.current, m: batch.total } : undefined,
      };
      return null;
    } finally {
      // compare-before-clear so a later upload's controller isn't nuked by
      // this upload's finally (single-flight prevents concurrent in-flight,
      // but the mounted guard protects post-destroy writes).
      if (editorMounted && uploadAbortController === controller) {
        uploadAbortController = null;
      }
      if (editorMounted) {
        uploading = false;
        uploadProgress = null;
      }
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
  async function handleTextareaDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || frozen || noAssets) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    let offset = dropOffsetFromPoint(e);
    for (let i = 0; i < files.length; i++) {
      const result = await uploadOne(files[i], { current: i + 1, total: files.length });
      if (result === null) break;
      const ref = formatRef(result.filename, result.mime_type);
      insertAtCursor(ref, offset);
      offset += ref.length;
      cursorReady = true;
      refreshKey++;
    }
  }

  function handleWrapperDragOver(e: DragEvent) {
    e.preventDefault();
  }
  async function handleWrapperDrop(e: DragEvent) {
    e.preventDefault();
    if (disabled || frozen || noAssets) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const result = await uploadOne(files[i], { current: i + 1, total: files.length });
      if (result === null) break;
      refreshKey++;
    }
  }

  function handleSidebarInsert(snippet: string) {
    cursorReady = true;
    insertAtCursor(snippet);
  }

  async function loadPreview() {
    const reqId = ++latestReq;
    loading = true;
    error = null;
    try {
      const res = await assetContext.renderPreview(value);
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
    if (disabled) return;
    _mode = m;
    if (m === 'preview') loadPreview();
  }

  onMount(() => {
    editorMounted = true;
    if (readOnly && !plain) void loadPreview();
    window.addEventListener('dragover', guardFileDropNavigation);
    window.addEventListener('drop', guardFileDropNavigation);
  });
  onDestroy(() => {
    editorMounted = false;
    latestReq++;
    if (flashTimer !== null) clearTimeout(flashTimer);
    window.removeEventListener('dragover', guardFileDropNavigation);
    window.removeEventListener('drop', guardFileDropNavigation);
  });
</script>

<div class="md-card">
  {#if plain}
    <pre class="plain-src" data-testid="markdown-plain">{value}</pre>
  {:else}
    {#if !readOnly}
      <div class="tabs">
        <button type="button" data-action="edit" aria-pressed={mode === 'edit'} disabled={disabled} onclick={() => setMode('edit')}>Edit</button>
        <button type="button" data-action="preview" aria-pressed={mode === 'preview'} disabled={disabled} onclick={() => setMode('preview')}>Preview</button>
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
          disabled={disabled}
          readonly={frozen}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedby}
          ondragover={handleTextareaDragOver}
          ondrop={handleTextareaDrop}
          onfocus={onTextareaFocus}
          onblur={onTextareaBlur}
          onselectionchange={onTextareaSelectionChange}
        ></textarea>
        {#if !noAssets}
          <AssetSidebar
            {assetContext}
            disabled={disabled || frozen}
            onInsert={handleSidebarInsert}
            onUploadFile={uploadOne}
            {refreshKey}
            {cursorReady}
            bind:uploading
            bind:uploadProgress
            bind:uploadError
          />
        {/if}
      </div>
    {:else if loading}
      <div class="preview"><em>Rendering…</em></div>
    {:else if error}
      <div class="preview err">{error}</div>
    {:else}
      <div class="preview">{@html html ?? ''}</div>
    {/if}
  {/if}
</div>

<style>
  .md-card {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface); /* ref 1702 */
  }
  .tabs { display: flex; border-bottom: 1px solid var(--border); /* ref 1703 */ }
  .tabs button {
    padding: 8px 14px;
    border: 0;
    background: none;
    font-size: 13px;
    font-weight: 400;
    color: var(--muted);
    cursor: pointer; /* ref 1705 */
  }
  .tabs button[aria-pressed="true"] { background: var(--surface-2); font-weight: 600; color: var(--text); /* ref 1704 */ }
  .tabs button:disabled { color: var(--faint); cursor: not-allowed; }
  .edit-content { display: flex; flex-direction: row; align-items: stretch; min-height: 0; /* ref 1707 */ }
  /* Spec (mini-projects-frontend §"Layout") mandates the textarea + asset
     sidebar collapse to a single column below 880px (50%-split-screen on
     1920px + small-laptop split scenarios). The split lives here, NOT in
     MiniProjectModal's `.body` (codex T6a r1 catch). */
  @media (max-width: 880px) {
    .edit-content { flex-direction: column; }
  }
  textarea {
    flex: 1 1 0;
    min-width: 0;
    min-height: 230px;
    padding: 12px 14px;
    border: 0;
    background: var(--surface);
    font: 13px/1.7 var(--font-mono);
    color: var(--text-2);
    caret-color: var(--primary);
    resize: vertical; /* ref 1708 */
  }
  .preview { min-height: 200px; padding: 12px 14px; font-size: 13px; color: var(--text); /* ref 1708 */ }
  .preview.err { color: var(--danger); }
  .plain-src {
    margin: 0;
    padding: 12px 14px;
    font: 13px/1.7 var(--font-mono);
    color: var(--text-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere; /* ref 1708 — the pane, read-only */
  }
  .edit-content.flash { box-shadow: inset 0 0 0 2px var(--danger); }
</style>
