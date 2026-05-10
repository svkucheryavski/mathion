<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api, ApiError } from '../../lib/api';

  // Default value to '' so a parent that forgets to bind doesn't send
  // content_md=undefined (which JSON.stringify drops, producing a 422 from
  // the backend's required str field) and the typing isn't a runtime lie.
  let { versionId, value = $bindable<string>('') }: { versionId: number; value: string } = $props();
  let mode = $state<'edit' | 'preview'>('edit');
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
    mode = m;
    if (m === 'preview') loadPreview();
  }

  onDestroy(() => { latestReq++; });
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
