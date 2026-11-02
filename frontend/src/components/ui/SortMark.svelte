<script lang="ts">
  // The sort direction mark in a sortable column header. Decorative: the
  // header cell's aria-sort carries the state (6a P6).
  let { dir }: { dir: 'asc' | 'desc' } = $props();
</script>

<svg class="sort-mark" viewBox="0 0 10 10" aria-hidden="true" focusable="false" data-dir={dir}>
  {#if dir === 'asc'}<polyline points="2,6.5 5,3.5 8,6.5" />{:else}<polyline points="2,3.5 5,6.5 8,3.5" />{/if}
</svg>

<style>
  .sort-mark {
    width: 10px;
    height: 10px;
    margin-left: 4px;
    vertical-align: middle;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
