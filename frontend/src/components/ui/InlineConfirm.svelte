<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  // `takeFocus` (Slice-6a): Cancel takes focus when the confirm opens, so Esc
  // reaches it, and Esc on either button cancels. Callers that pass it return
  // focus to their opener in onCancel. The confirm is a group named by its
  // warning (or by `label` when there is none), so a screen reader landing
  // on Cancel hears the question first. With both, the warning describes the
  // group and both buttons.
  // Polish 1: small real buttons, red or steel blue by `tone` (D31, D33).
  // `busy` keeps the question in place while its action runs: both buttons
  // are aria-disabled and keep focus, and nothing answers (R54). A pointer
  // click in the first 400 ms is ignored, so the double-click that opened the
  // question cannot answer it (R50); keyboard and el.click() have detail 0.
  // `message` (a snippet with markup, R52) and `warning` (plain text) fill the
  // same slot; askInPlace's `Ask` type keeps them exclusive (P62).
  type Props = {
    warning?: string;
    message?: Snippet;
    confirmLabel: string;
    confirmDataAction?: string;
    onConfirm: () => void;
    onCancel?: () => void;
    takeFocus?: boolean;
    label?: string;
    tone?: 'danger' | 'primary';
    layout?: 'row' | 'column';
    // The 6a alias of layout="row" (the question and both buttons on one line).
    row?: boolean;
    // 'end': a question under a row ends under the row's actions (D42).
    align?: 'start' | 'end';
    busy?: boolean;
  };
  let {
    confirmLabel,
    confirmDataAction,
    warning,
    message,
    onConfirm,
    onCancel,
    takeFocus = false,
    label,
    tone = 'danger',
    layout,
    row = false,
    align = 'start',
    busy = false,
  }: Props = $props();

  const WAIT = 'Wait for the request to finish';
  const uid = $props.id();
  const warnId = `${uid}-warn`;
  const hasText = $derived(Boolean(message || warning));
  const named = $derived(Boolean(label || hasText));
  const isRow = $derived(layout ? layout === 'row' : row);
  const describedBy = $derived(label && hasText ? warnId : undefined);

  const openedAt = performance.now();
  let groupEl = $state<HTMLDivElement>();
  let cancelEl = $state<HTMLButtonElement>();
  onMount(() => {
    if (!takeFocus) return;
    groupEl?.scrollIntoView?.({ block: 'nearest' });
    cancelEl?.focus();
  });

  const tooSoon = (e: MouseEvent) => e.detail > 0 && performance.now() - openedAt < 400;
  function confirmClick(e: MouseEvent) {
    if (tooSoon(e) || busy) return;
    onConfirm();
  }
  function cancelClick(e: MouseEvent) {
    if (tooSoon(e) || busy) return;
    onCancel?.();
  }
  function onKeydown(e: KeyboardEvent) {
    if (!takeFocus || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (!busy) onCancel?.();
  }
</script>

<div class="inline-confirm" class:row={isRow} class:end={align === 'end'} bind:this={groupEl} role={named ? 'group' : undefined} aria-label={label}
     aria-labelledby={!label && hasText ? warnId : undefined} aria-describedby={describedBy}>
  {#if message}<div class="warning" id={warnId}>{@render message()}</div>
  {:else if warning}<div class="warning" id={warnId}>{warning}</div>{/if}
  <div class="actions">
    <button type="button" class="ic-btn confirm {tone}" data-action={confirmDataAction}
            aria-disabled={busy ? 'true' : undefined} aria-busy={busy ? 'true' : undefined}
            aria-describedby={describedBy} title={busy ? WAIT : undefined}
            onclick={confirmClick} onkeydown={onKeydown}>{#if busy}<span class="spinner" aria-hidden="true"></span>{/if}{confirmLabel}</button>
    <button type="button" class="ic-btn cancel" bind:this={cancelEl}
            aria-disabled={busy ? 'true' : undefined} aria-describedby={describedBy} title={busy ? WAIT : undefined}
            onclick={cancelClick} onkeydown={onKeydown}>Cancel</button>
  </div>
</div>

<style>
  /* D47: scrolled into view (on open, focusCancel) it keeps some room around it,
     so a taller field beside it (an inline quiz edit) and its row show whole. */
  .inline-confirm { display: inline-flex; flex-direction: column; gap: 4px; scroll-margin-block: 16px; }
  .inline-confirm.row { flex-direction: row; align-items: center; gap: 12px; }
  /* D42: the question takes its whole line and ends under the row's actions. */
  .inline-confirm.end { display: flex; justify-content: flex-end; }
  /* A long title or an unbroken name wraps inside the question, so the
     buttons stay on screen (Review Focus 1). */
  .warning { font-size: 12.5px; line-height: 1.5; color: var(--muted); overflow-wrap: anywhere; }
  .warning :global(code) { font-family: var(--font-mono); background: var(--surface); padding: 0 4px; border-radius: var(--radius-pill); }
  .warning :global(strong) { color: var(--text-2); font-weight: 600; }
  .actions { display: inline-flex; gap: 6px; }
  /* D31, D34: small real buttons. Outlined at rest; filled on hover (pointer
     devices only, R50) and on keyboard focus; darker while pressed. Every
     state rule skips an aria-disabled (busy) button, so its look wins. */
  .ic-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 9px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: var(--surface);
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
  }
  .danger { color: var(--danger); border-color: var(--danger); --ring: var(--danger); }
  .primary { color: var(--primary); border-color: var(--primary); }
  .cancel { color: var(--text-3); border-color: var(--cancel-border); --ring: var(--muted); }
  @media (hover: hover) {
    .danger:not([aria-disabled="true"]):hover { background: var(--danger); color: var(--primary-text); }
    .primary:not([aria-disabled="true"]):hover { background: var(--primary); color: var(--primary-text); }
    .cancel:not([aria-disabled="true"]):hover { background: var(--cancel-hover); }
  }
  .danger:not([aria-disabled="true"]):focus-visible { background: var(--danger); color: var(--primary-text); }
  .primary:not([aria-disabled="true"]):focus-visible { background: var(--primary); color: var(--primary-text); }
  .cancel:not([aria-disabled="true"]):focus-visible { background: var(--cancel-hover); }
  .danger:not([aria-disabled="true"]):active { background: var(--danger-press); border-color: var(--danger-press); color: var(--primary-text); }
  .primary:not([aria-disabled="true"]):active { background: var(--primary-press); border-color: var(--primary-press); color: var(--primary-text); }
  .cancel:not([aria-disabled="true"]):active { background: var(--cancel-press); }
  /* The ring sits outside the button, on the page (P57); its colour follows the button (D60). */
  .ic-btn:focus-visible { outline: 2px solid var(--ring, var(--primary)); outline-offset: 2px; box-shadow: none; }
  /* Busy (6b P23): the confirm keeps its rest look with a spinner; Cancel
     takes the blocked look (Button's .btn.blocked). */
  .confirm[aria-busy="true"] { cursor: progress; }
  .cancel[aria-disabled="true"] { background: var(--bg); color: var(--faint); border-color: var(--border-faint); cursor: not-allowed; }
  @media (pointer: coarse) {
    .ic-btn { min-height: 28px; }
  }
  .spinner {
    display: inline-block;
    width: .75rem;
    height: .75rem;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
