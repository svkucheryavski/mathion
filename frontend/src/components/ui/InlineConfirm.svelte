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
  .warning { color: var(--muted); font-size: 0.85em; }
  .actions { display: inline-flex; gap: 6px; }
  /* Destructive confirm uses the danger-TEXT convention (never a red fill). */
  .confirm { color: var(--danger); }
</style>
