<script lang="ts">
  // The danger panel (handoff §4 Confirm-then-act): the consequence, an
  // "I understand" box, Force delete and Cancel. Unarmed, Force delete keeps
  // its slot in the muted red family and does nothing; ticking arms it. A
  // missing right (disabledReason) disables it natively, with the reason.
  // The box un-ticks when onConfirm settles, so a failure has to be re-armed.
  import { onMount, tick, type Snippet } from 'svelte';

  let {
    message,
    confirmLabel = 'Force delete',
    busy = false,
    disabledReason = undefined,
    onConfirm,
    onCancel,
  }: {
    message: Snippet;
    confirmLabel?: string;
    busy?: boolean;
    disabledReason?: string;
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
  } = $props();

  const uid = $props.id();
  const msgId = `${uid}-msg`;
  let armed = $state(false);
  // A second click while onConfirm runs must not send the action twice.
  let pending = false;
  let boxEl = $state<HTMLInputElement>();
  let forceEl = $state<HTMLButtonElement>();
  onMount(() => boxEl?.focus());

  const blocked = $derived(busy || disabledReason !== undefined);
  const forceTitle = $derived(disabledReason ?? (armed ? undefined : 'Tick “I understand” first'));

  // R45: `busy` disabled the box and Force delete, which leaves focus on
  // <body> or on the disabled button; after the request it goes back to the box.
  let busySeen = false;
  $effect(() => {
    if (busy) busySeen = true;
  });

  async function force() {
    if (!armed || blocked || pending) return;
    pending = true;
    busySeen = busy;
    try {
      await onConfirm();
    } catch {
      // The caller reports its own failure (banner, toast); the box re-arms.
    } finally {
      armed = false;
      pending = false;
    }
    await tick();
    const active = document.activeElement;
    if (busySeen && boxEl?.isConnected && (active === null || active === document.body || active === forceEl)) {
      boxEl.focus();
    }
  }

  // Esc anywhere in the panel = Cancel. stopPropagation so an enclosing modal
  // or panel does not close as well.
  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (!busy) onCancel();
  }
</script>

<div class="danger-confirm" role="group" aria-label={confirmLabel} aria-describedby={msgId}>
  <p class="dc-msg" id={msgId}>{@render message()}</p>
  <label class="dc-ack">
    <input type="checkbox" data-role="danger-ack" bind:this={boxEl} bind:checked={armed} disabled={busy} onkeydown={onKeydown} />
    I understand
  </label>
  <div class="dc-actions">
    <button
      type="button"
      class="dc-btn dc-force"
      bind:this={forceEl}
      class:armed={armed && disabledReason === undefined}
      data-action="force-delete"
      disabled={blocked}
      aria-disabled={!armed && !blocked ? 'true' : undefined}
      aria-busy={busy ? 'true' : undefined}
      title={forceTitle}
      onclick={force}
      onkeydown={onKeydown}
    >{#if busy}<span class="dc-spin" aria-hidden="true"></span>{/if}{confirmLabel}</button>
    <button type="button" class="dc-btn dc-cancel" disabled={busy} onclick={onCancel} onkeydown={onKeydown}>Cancel</button>
  </div>
</div>

<style>
  .danger-confirm {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    background: var(--danger-panel-bg);
    border-left: 3px solid var(--danger);
    border-radius: var(--radius);
  }
  .dc-msg { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--danger-panel-fg); }
  .dc-msg :global(code) { font-family: var(--font-mono); background: var(--surface); padding: 0 4px; border-radius: var(--radius-pill); }
  .dc-ack { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-2); }
  .dc-actions { display: flex; gap: 6px; }
  /* D34: InlineConfirm's small button geometry. */
  .dc-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 9px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
  }
  /* Unarmed (and natively disabled): the muted red family, never grey, no fills. */
  .dc-force {
    background: var(--danger-off-bg);
    color: var(--danger-off-text);
    border: 1px solid var(--danger-off-border);
    cursor: not-allowed;
    --ring: var(--danger);
  }
  /* Armed: the red action at rest (D31). Busy keeps this look with the spinner. */
  .dc-force.armed {
    background: var(--surface);
    color: var(--danger);
    border-color: var(--danger);
    cursor: pointer;
  }
  .dc-force.armed[aria-busy="true"] { cursor: progress; }
  .dc-cancel {
    background: var(--surface);
    color: var(--text-3);
    border: 1px solid var(--cancel-border);
    cursor: pointer;
    --ring: var(--muted);
  }
  @media (hover: hover) {
    .dc-force.armed:not(:disabled):hover { background: var(--danger); color: var(--primary-text); }
    .dc-cancel:not(:disabled):hover { background: var(--cancel-hover); }
  }
  .dc-force.armed:not(:disabled):focus-visible { background: var(--danger); color: var(--primary-text); }
  .dc-cancel:not(:disabled):focus-visible { background: var(--cancel-hover); }
  .dc-force.armed:not(:disabled):active { background: var(--danger-press); border-color: var(--danger-press); color: var(--primary-text); }
  .dc-cancel:not(:disabled):active { background: var(--cancel-press); }
  /* Armed or not, a focused button shows the ring (P57), in its own colour (D60). */
  .dc-btn:focus-visible { outline: 2px solid var(--ring, var(--primary)); outline-offset: 2px; box-shadow: none; }
  .dc-cancel:disabled {
    background: var(--bg);
    color: var(--faint);
    border-color: var(--border-faint);
    cursor: not-allowed;
  }
  @media (pointer: coarse) {
    .dc-btn { min-height: 28px; }
  }
  .dc-spin {
    width: 10px;
    height: 10px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: dc-spin 0.6s linear infinite;
  }
  @keyframes dc-spin { to { transform: rotate(360deg); } }
</style>
