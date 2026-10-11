<script lang="ts">
  import { onMount } from 'svelte';

  // `takeFocus` (Slice-6a): Cancel takes focus when the confirm opens, so Esc
  // reaches it, and Esc on either button cancels. Callers that pass it return
  // focus to their opener in onCancel. The confirm is a group named by its
  // warning (or by `label` when there is none), so a screen reader landing
  // on Cancel hears the question first.
  let {
    confirmLabel = 'Confirm',
    confirmDataAction,
    warning,
    onConfirm,
    onCancel,
    takeFocus = false,
    label,
  }: {
    confirmLabel?: string;
    confirmDataAction?: string;
    warning?: string;
    onConfirm: () => void;
    onCancel?: () => void;
    takeFocus?: boolean;
    label?: string;
  } = $props();

  const uid = $props.id();
  const warnId = `${uid}-warn`;
  const named = $derived(Boolean(label || warning));

  let cancelEl = $state<HTMLButtonElement>();
  onMount(() => { if (takeFocus) cancelEl?.focus(); });

  function onKeydown(e: KeyboardEvent) {
    if (!takeFocus || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onCancel?.();
  }
</script>

<div class="inline-confirm" role={named ? 'group' : undefined} aria-label={label}
     aria-labelledby={!label && warning ? warnId : undefined}>
  {#if warning}<div class="warning" id={warnId}>{warning}</div>{/if}
  <div class="actions">
    <button type="button" class="confirm" data-action={confirmDataAction} onclick={onConfirm} onkeydown={onKeydown}>{confirmLabel}</button>
    <button type="button" class="cancel" bind:this={cancelEl} onclick={() => onCancel?.()} onkeydown={onKeydown}>Cancel</button>
  </div>
</div>

<style>
  .inline-confirm { display: inline-flex; flex-direction: column; gap: 4px; }
  .warning { color: var(--muted); font-size: 0.85em; }
  .actions { display: inline-flex; gap: 6px; }
  /* Destructive confirm uses the danger-TEXT convention (never a red fill). */
  .confirm { color: var(--danger); }
</style>
