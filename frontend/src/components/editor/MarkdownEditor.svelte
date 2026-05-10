<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api';

  // Default value to '' so a parent that forgets to bind doesn't send
  // content_md=undefined (which JSON.stringify drops, producing a 422 from
  // the backend's required str field) and the typing isn't a runtime lie.
  // `readOnly` flips the editor into preview-only mode for disabled versions:
  // spec §11 item 7 requires the user to see the rendered HTML (or the 403
  // inline error) without an Edit tab — backend /render still 403s on a
  // disabled version, and the existing error path surfaces that inline.
  let {
    versionId,
    value = $bindable<string>(''),
    readOnly = false,
  }: { versionId: number; value?: string; readOnly?: boolean } = $props();
  // `mode` is local UI state. In readOnly mode the Edit tab is hidden so the
  // user can never flip mode back to 'edit'; we still keep it as $state so
  // editable-mode tab toggling works. Effective mode is derived to honor
  // readOnly even if a future caller flips the prop at runtime.
  let _mode = $state<'edit' | 'preview'>('edit');
  const mode = $derived<'edit' | 'preview'>(readOnly ? 'preview' : _mode);
  let html = $state<string | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // Monotonic request id. Rapid Edit→Preview toggles or a slow render
  // followed by a fast retry can land response N before response N-1 and
  // overwrite the newer html with stale content. Each loadPreview captures
  // a fresh reqId; only the most recent reqId is allowed to write state.
  // onDestroy bumps latestReq so any in-flight response after unmount
  // becomes stale and discards its writes (no leak into a dead component).
  let latestReq = 0;

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

  // In readOnly mode there's no Edit tab to click — auto-load the preview
  // on mount so the user sees rendered HTML (or the 403 inline error) right
  // away. Skipped in editable mode: preview is opt-in there.
  onMount(() => { if (readOnly) void loadPreview(); });

  onDestroy(() => { latestReq++; });
</script>

<div class="editor">
  <!-- Plain toggle buttons rather than role="tablist". The full WAI-ARIA
       tablist contract (arrow-key navigation, aria-controls, tabindex
       cycling) is overkill for a two-state Edit/Preview switch. aria-pressed
       communicates the active state to screen readers. In readOnly mode the
       Edit tab is hidden — there's nothing to switch to. -->
  {#if !readOnly}
    <div class="tabs">
      <button type="button" aria-pressed={mode === 'edit'} onclick={() => setMode('edit')}>Edit</button>
      <button type="button" aria-pressed={mode === 'preview'} onclick={() => setMode('preview')}>Preview</button>
    </div>
  {/if}
  {#if mode === 'edit' && !readOnly}
    <textarea bind:value rows="14" spellcheck="false"></textarea>
  {:else if loading}
    <div class="preview"><em>Rendering…</em></div>
  {:else if error}
    <div class="preview err">{error}</div>
  {:else}
    <!-- {@html} is safe here only because the backend's /render endpoint
         (Task 8) sanitizes the output server-side. The frontend MUST NOT
         render markdown locally without that round-trip. -->
    <div class="preview">{@html html ?? ''}</div>
  {/if}
</div>

<style>
  .editor { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .tabs { display: flex; border-bottom: 1px solid var(--border); }
  .tabs button { background: none; border: 0; padding: var(--space-2) var(--space-3); cursor: pointer; }
  .tabs button[aria-pressed="true"] { background: var(--surface, #f7f7f7); font-weight: 600; }
  textarea { width: 100%; border: 0; padding: var(--space-3); font-family: ui-monospace, monospace; }
  .preview { padding: var(--space-3); min-height: 200px; }
  .preview.err { color: #a33; }
</style>
