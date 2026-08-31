<script lang="ts">
  let { label = 'Loading…' }: { label?: string } = $props();
</script>

<div class="loading-placeholder" role="status" aria-live="polite">{label}</div>

<style>
  .loading-placeholder { color: var(--muted); padding: 8px 0; font-style: italic; }
</style>
