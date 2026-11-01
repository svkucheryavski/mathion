<script lang="ts">
  // Video body (3e). Implements ItemBodyApi (§2). The URL is normalised to its
  // iframe-embed form on save (the student player iframes it verbatim) and the
  // server's echo is written back, so a pasted watch URL saves clean (D10).
  import { onDestroy, untrack } from 'svelte';
  import VideoFrame from '../../items/VideoFrame.svelte';
  import { makeDirtyTracker } from '../../../lib/dirty.svelte';
  import { normalizeVideoUrl } from '../../../lib/normalizeVideoUrl';
  import { safeIframeUrl } from '../../../lib/safeIframeUrl';
  import { patchItem, reportSaveFailure, type SaveOutcome } from '../../../lib/itemBody';
  import type { AdminTreeItem } from '../../../lib/types';

  let {
    item, vid, editable, frozen, stillOnVid,
    saveDirty = $bindable(false), guardDirty = $bindable(false),
  }: {
    item: AdminTreeItem; vid: number; editable: boolean; frozen: boolean;
    stillOnVid: (v: number) => boolean;
    saveDirty?: boolean; guardDirty?: boolean;
  } = $props();

  const uid = $props.id();
  const hintId = `${uid}-hint`;
  const errId = `${uid}-err`;

  // Seeded once per mount ({#key item.id} upstream); tree reloads never re-seed.
  let saved = untrack(() => item.video_url ?? '');
  const tracker = makeDirtyTracker({ video_url: saved });
  let urlError = $state<string | null>(null);
  let urlEl = $state<HTMLInputElement>();
  let alive = true;
  onDestroy(() => { alive = false; });

  $effect(() => { saveDirty = tracker.isDirty; });
  $effect(() => { guardDirty = tracker.isDirty; });

  // Live preview: 500ms after the last keystroke (re-rendering the iframe per
  // keystroke would thrash the player). The initial value shows at once.
  let previewUrl = $state<string | null>(untrack(() => safeIframeUrl(normalizeVideoUrl(saved))));
  $effect(() => {
    const raw = tracker.current.video_url;
    const handle = setTimeout(() => { previewUrl = safeIframeUrl(normalizeVideoUrl(raw)); }, 500);
    return () => clearTimeout(handle);
  });

  // D13: the provider only (no duration data). `previewUrl` already passed
  // safeIframeUrl, so it parses.
  function providerOf(url: string): string {
    const host = new URL(url).hostname.toLowerCase();
    if (/(^|\.)youtube(-nocookie)?\.com$/.test(host) || host === 'youtu.be') return 'youtube';
    if (/(^|\.)vimeo\.com$/.test(host)) return 'vimeo';
    return 'embed';
  }
  const provider = $derived(previewUrl ? providerOf(previewUrl) : null);

  // D10: only what this Save would send. The server requires a non-empty URL,
  // an exact http(s):// prefix and at most 500 characters; Polish 3 checks the
  // normalised value Save sends, so a rejection shows here, not only as a toast.
  function urlProblem(raw: string): string | null {
    if (raw.trim() === '') return 'Video URL is required';
    const sent = normalizeVideoUrl(raw);
    if (!/^https?:\/\//.test(sent)) return 'URL must start with http:// or https://';
    if (sent.length > 500) return 'URL must be at most 500 characters';
    return null;
  }
  export function validate(): boolean {
    urlError = tracker.isDirty ? urlProblem(tracker.current.video_url) : null;
    if (urlError) urlEl?.focus();
    return urlError === null;
  }
  export function discard(): void {
    tracker.reset({ video_url: saved });
    urlError = null;
  }
  export function discardAll(): void { discard(); }

  export async function save(titleDraft: string | undefined): Promise<SaveOutcome> {
    const savedVid = vid;
    const body: Record<string, unknown> = {};
    if (titleDraft !== undefined) body.title = titleDraft;
    if (tracker.isDirty) body.video_url = normalizeVideoUrl(tracker.current.video_url);
    if (Object.keys(body).length === 0) return { outcome: 'ok' };
    try {
      const echo = await patchItem(item.id, body);
      if (alive && 'video_url' in body) {
        saved = echo.video_url ?? '';
        tracker.reset({ video_url: saved });
      }
      return { outcome: 'ok', savedTitle: 'title' in body ? echo.title : undefined };
    } catch (e) {
      reportSaveFailure(e, savedVid, stillOnVid);
      return { outcome: 'failed' };
    }
  }
</script>

<div class="field-row">
  <span class="field-label">Video URL</span>
  {#if editable}
    <div class="field">
      <input
        bind:this={urlEl}
        class="plain-input mono"
        type="url"
        aria-label="Video URL"
        required
        placeholder="https://…"
        readonly={frozen}
        aria-invalid={urlError ? 'true' : undefined}
        aria-describedby={urlError ? `${errId} ${hintId}` : hintId}
        bind:value={tracker.current.video_url}
        oninput={() => { if (urlError) urlError = null; }}
      />
      {#if urlError}<p class="field-err" id={errId}>{urlError}</p>{/if}
      <p class="field-hint" id={hintId}>Paste any YouTube or Vimeo URL — it is converted to embed form on save.</p>
    </div>
  {:else}
    <span class="ro-value mono">{item.video_url || 'No video URL'}</span>
  {/if}
</div>

<div class="video-preview">
  <div class="preview-head">
    <span class="preview-title">Preview</span>
    {#if provider}<span class="mono preview-meta">{provider}</span>{/if}
  </div>
  <div class="preview-area">
    {#if previewUrl}
      <VideoFrame src={previewUrl} title={item.title || 'Video preview'} height={296} />
    {:else}
      <p class="preview-empty">No preview</p>
    {/if}
  </div>
  <div class="preview-foot">
    {#if previewUrl}
      <span class="mono preview-status">embed resolved</span>
      <a class="open-link" href={previewUrl} target="_blank" rel="noopener noreferrer">Open in new tab</a>
    {:else}
      <span class="mono preview-status">no embed — paste a YouTube or Vimeo link</span>
    {/if}
  </div>
</div>

<style>
  /* The hint (and an error) always sit under the input, so centring would put the
     label below the control. Baseline lines it up with the input's text — or the
     read-only URL's first line (T3c review). */
  .field-row {
    display: grid;
    grid-template-columns: 132px 1fr; /* ref 1808 — D2 drops the 54px pencil slot */
    align-items: baseline;
    gap: 12px;
  }
  .field-label { font-size: 12.5px; color: var(--muted); }
  .field { display: flex; flex-direction: column; gap: 4px; /* the 4px step */ min-width: 0; }
  /* D12, as ItemEditorModal's Title input; the URL is mono (global .mono). */
  .plain-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .plain-input:focus-visible {
    outline: none;
    border: 1.5px solid var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft);
  }
  .plain-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .field-err { margin: 0; font-size: 12px; color: var(--danger); }
  .field-hint { margin: 0; font-size: 12px; color: var(--muted); /* §4 */ }
  .ro-value { font-size: 13px; color: var(--text); overflow-wrap: anywhere; }
  .video-preview { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; /* ref 1813 */ }
  .preview-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border); /* ref 1814 — #E9EBEF → --border */
  }
  .preview-title { flex: 1; font-size: 12.5px; font-weight: 600; color: var(--text); /* ref 1815 */ }
  .preview-meta { font-size: 11.5px; color: var(--muted); /* ref 1816 */ }
  .preview-area { height: 296px; background: var(--surface-2); /* ref 1818 — D13 */ }
  .preview-empty {
    margin: 0;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: var(--muted); /* D13 */
  }
  .preview-foot {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-top: 1px solid var(--border-soft);
    background: var(--surface-3); /* ref 1821 — #F0F1F4 → --border-soft */
  }
  .preview-status { font-size: 11.5px; color: var(--muted); /* ref 1822 */ }
  .open-link { margin-left: auto; font-size: 12.5px; color: var(--primary); /* ref 1823 */ }
</style>
