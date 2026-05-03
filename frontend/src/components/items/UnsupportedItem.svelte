<script lang="ts">
  let { type }: { type: string } = $props();
</script>

<div class="unsupported">
  <p>This item type ("{type}") isn't available in this view yet.</p>
</div>

<style>
  .unsupported { padding: var(--space-3); border: 1px dashed var(--border); border-radius: var(--radius); color: var(--muted); }
</style>
