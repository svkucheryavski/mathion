<script lang="ts">
  let {
    confirmLabel = 'Confirm',
    confirmDataAction,
    warning,
    onConfirm,
    onCancel,
  }: {
    confirmLabel?: string;
    confirmDataAction?: string;
    warning?: string;
    onConfirm: () => void;
    onCancel?: () => void;
  } = $props();
</script>

<div class="inline-confirm">
  {#if warning}<div class="warning">{warning}</div>{/if}
  <div class="actions">
    <button type="button" class="confirm" data-action={confirmDataAction} onclick={onConfirm}>{confirmLabel}</button>
    <button type="button" class="cancel" onclick={() => onCancel?.()}>Cancel</button>
  </div>
</div>

<style>
  .inline-confirm { display: inline-flex; flex-direction: column; gap: 4px; }
  .warning { color: var(--text-muted, #666); font-size: 0.85em; }
  .actions { display: inline-flex; gap: 6px; }
</style>
