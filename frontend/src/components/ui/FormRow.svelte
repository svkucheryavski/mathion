<script lang="ts">
  let { label = '', error = '', helper = '', children } = $props();
</script>

<div class="form-row">
  {#if label}<label>{label}</label>{/if}
  {@render children?.()}
  {#if error}<div class="error-text">{error}</div>{/if}
  {#if helper && !error}<div class="helper-text">{helper}</div>{/if}
</div>

<style>
  .form-row { display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-3); }
  label { font-weight: 500; font-size: 0.875rem; }
  .error-text { color: var(--danger); font-size: 0.875rem; }
  .helper-text { color: var(--muted); font-size: 0.875rem; }
</style>
