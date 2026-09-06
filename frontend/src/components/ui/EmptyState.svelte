<script lang="ts">
  // EmptyState — titled empty card (artboard 9d, ref 1353-1357). Title-only by
  // decision D2: hint / icon tile / action are added by the first slice that
  // consumes them (Authoring, "No versions yet"). Presentational only.
  let { title }: { title: string } = $props();
</script>

<div class="empty-state"><p class="title">{title}</p></div>

<style>
  .empty-state {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 34px 20px; /* ref 1355 */
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 9px; /* ref 1355 — inert with one child today; kept so the hint/action land in place later */
    text-align: center;
  }
  .title { font-size: 14px; font-weight: 600; /* ref 1357 */ color: var(--text); margin: 0; }
</style>
