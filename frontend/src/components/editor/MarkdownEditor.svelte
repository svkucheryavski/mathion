<script lang="ts">
  import { api, ApiError } from '../../lib/api';

  let { versionId, value = $bindable() }: { versionId: number; value: string } = $props();
  let mode = $state<'edit' | 'preview'>('edit');
  let html = $state<string | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function loadPreview() {
    loading = true;
    error = null;
    try {
      const res = await api.post<{ html: string }>(`/api/versions/${versionId}/render`, { content_md: value });
      html = res.html;
    } catch (e) {
      error = e instanceof ApiError ? e.displayMessage : 'Could not render preview.';
    } finally {
      loading = false;
    }
  }

  function setMode(m: 'edit' | 'preview') {
    mode = m;
    if (m === 'preview') loadPreview();
  }
</script>

<div class="editor">
  <div role="tablist" class="tabs">
    <button type="button" role="tab" aria-selected={mode === 'edit'} onclick={() => setMode('edit')}>Edit</button>
    <button type="button" role="tab" aria-selected={mode === 'preview'} onclick={() => setMode('preview')}>Preview</button>
  </div>
  {#if mode === 'edit'}
    <textarea role="tabpanel" bind:value rows="14" spellcheck="false"></textarea>
  {:else if loading}
    <div role="tabpanel" class="preview"><em>Rendering…</em></div>
  {:else if error}
    <div role="tabpanel" class="preview err">{error}</div>
  {:else}
    <!-- {@html} is safe here only because the backend's /render endpoint
         (Task 8) sanitizes the output server-side. The frontend MUST NOT
         render markdown locally without that round-trip. -->
    <div role="tabpanel" class="preview">{@html html ?? ''}</div>
  {/if}
</div>

<style>
  .editor { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .tabs { display: flex; border-bottom: 1px solid var(--border); }
  .tabs button { background: none; border: 0; padding: var(--space-2) var(--space-3); cursor: pointer; }
  .tabs button[aria-selected="true"] { background: var(--surface, #f7f7f7); font-weight: 600; }
  textarea { width: 100%; border: 0; padding: var(--space-3); font-family: ui-monospace, monospace; }
  .preview { padding: var(--space-3); min-height: 200px; }
  .preview.err { color: #a33; }
</style>
