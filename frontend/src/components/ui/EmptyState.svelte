<script lang="ts">
  // EmptyState — titled empty card (artboard 9d, ref 1353-1360). Title-only
  // callers are unchanged; Slice-5a adds the optional icon tile, hint and action
  // its first consumer ("No versions yet") needs. Presentational only.
  import type { Snippet } from 'svelte';
  let {
    title,
    icon = undefined,
    hint = undefined,
    action = undefined,
  }: { title: string; icon?: 'list'; hint?: string; action?: Snippet } = $props();
</script>

<div class="empty-state">
  {#if icon === 'list'}
    <span class="tile" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="3" y1="4" x2="13" y2="4" /><line x1="3" y1="8" x2="13" y2="8" /><line x1="3" y1="12" x2="9" y2="12" />
      </svg>
    </span>
  {/if}
  <p class="title">{title}</p>
  {#if hint}<p class="hint">{hint}</p>{/if}
  {#if action}<div class="action">{@render action()}</div>{/if}
</div>

<style>
  .empty-state {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 34px 20px; /* ref 1355 */
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 9px; /* ref 1355 */
    text-align: center;
  }
  .title { font-size: 14px; font-weight: 600; /* ref 1357 */ color: var(--text); margin: 0; }
  /* #E9EBEF tile edge → --border (Slice-3 role split); #8B919E glyph → --muted
     (Slice-4 pre-ruling: no token has that hex; --faint is disabled-only). */
  .tile {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 38px;
    height: 38px; /* ref 1356 */
    border-radius: 8px; /* ref 1356 */
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--muted);
  }
  .tile svg { width: 18px; height: 18px; /* ref 1356 */ }
  .hint {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    max-width: 44ch; /* ref 1358 */
    text-wrap: pretty;
    color: var(--muted);
  }
  .action { margin-top: 4px; /* ref 1359 */ }
</style>
