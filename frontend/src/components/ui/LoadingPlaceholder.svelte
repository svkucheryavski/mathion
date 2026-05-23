<script lang="ts">
  let { label = 'Loading…' }: { label?: string } = $props();
</script>

<div class="loading-placeholder">{label}</div>

<style>
  .loading-placeholder { color: var(--text-muted, #777); padding: 8px 0; font-style: italic; }
</style>
