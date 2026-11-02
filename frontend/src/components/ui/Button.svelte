<script lang="ts">
  type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-off';
  let {
    variant = 'primary' as Variant,
    type = 'button' as 'button' | 'submit',
    disabled = false,
    loading = false,
    title = undefined as string | undefined,
    // Forward aria-label so icon-only buttons (reorder up/down) can announce
    // their purpose to screen readers. Visible glyph stays for sighted
    // users; the title attribute also supplies a tooltip.
    'aria-label': ariaLabel = undefined as string | undefined,
    // Slice-6a: a test and gate hook, and a ref for callers that return focus.
    'data-action': dataAction = undefined as string | undefined,
    // Slice-6b R17: a footer button submits the form it sits outside of through
    // `form`; `data-autofocus` lets ui/Modal pick it on open. P1: the import's
    // Done is described by its summary.
    form = undefined as string | undefined,
    'data-autofocus': dataAutofocus = false,
    'aria-describedby': ariaDescribedby = undefined as string | undefined,
    // Slice-6c R44: a control that must not act right now but keeps focus (a
    // busy Publish run). onclick still fires, so the caller returns at once.
    'aria-disabled': ariaDisabled = false,
    // Slice-6c P48: a test hook (the side panel's Edit and Cancel).
    'data-test': dataTest = undefined as string | undefined,
    element = $bindable(undefined as HTMLButtonElement | undefined),
    onclick = undefined as (() => void) | undefined,
    full = false,
    children,
  } = $props();
</script>

<button
  bind:this={element}
  {type}
  class="btn {variant}"
  class:full={full}
  class:blocked={ariaDisabled && !loading}
  data-variant={variant}
  data-action={dataAction}
  data-test={dataTest}
  data-autofocus={dataAutofocus ? '' : undefined}
  {form}
  aria-describedby={ariaDescribedby}
  aria-disabled={ariaDisabled ? 'true' : undefined}
  aria-busy={loading ? 'true' : undefined}
  {disabled}
  {title}
  aria-label={ariaLabel}
  {onclick}
>
  {#if loading}<span class="spinner"></span>{/if}
  {@render children?.()}
</button>

<style>
  .btn {
    padding: var(--btn-pad);
    border-radius: var(--radius);
    border: 1px solid transparent;
    font-size: 13px;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  /* Disabled: recede via tokens, never opacity (opacity would composite the
     whole button — glyphs included — against the page). Keep the tooltip. */
  .btn:disabled {
    background: var(--disabled-bg);
    color: var(--faint);
    border-color: var(--border-faint);
    cursor: not-allowed;
  }
  /* P23: blocked (aria-disabled, not busy) looks disabled but keeps focus. A
     busy button keeps its variant look and its spinner. */
  .btn.blocked {
    background: var(--disabled-bg);
    color: var(--faint);
    border-color: var(--border-faint);
    cursor: not-allowed;
  }
  /* Full-width form primary (e.g. Login §2a "Sign in", ref 2010) — scoped CSS in
     a page can't reach a child component root, so this lives on the Button.
     `flex:1` is inert outside a flex parent and exact inside `.actions` (ref 2010). */
  .btn.full { flex: 1; width: 100%; justify-content: center; }
  .primary { background: var(--primary); color: var(--primary-text); }
  /* D44: the confirm's primary action at page size — outlined at rest, filled
     on hover (pointer devices) and on keyboard focus, darker while pressed.
     Disabled, blocked and busy keep their looks. Kept apart from the .danger
     rules: the minifier merges adjacent identical rules (the two rings). */
  .secondary { background: var(--surface); color: var(--primary); border-color: var(--primary); }
  @media (hover: hover) {
    .secondary:not(:disabled):not(.blocked):not([aria-busy="true"]):hover { background: var(--primary); color: var(--primary-text); }
  }
  .secondary:not(:disabled):not(.blocked):not([aria-busy="true"]):focus-visible { background: var(--primary); color: var(--primary-text); }
  .secondary:not(:disabled):not(.blocked):not([aria-busy="true"]):active { background: var(--primary-press); border-color: var(--primary-press); color: var(--primary-text); }
  .secondary:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; box-shadow: none; }
  .ghost { padding: var(--btn-pad-sm); background: transparent; color: var(--muted); --ring: var(--muted); }
  /* Disabled ghost stays transparent: its enabled look has no fill, so a
     --disabled-bg tile would make the disabled one look raised. (0,4,0) beats
     .btn:disabled and .btn.blocked. */
  .btn.ghost:disabled { background: transparent; border-color: transparent; }
  .btn.ghost.blocked { background: transparent; border-color: transparent; }
  /* D31: outlined at rest, filled on hover (pointer devices) and on keyboard
     focus, darker while pressed. Disabled, blocked and busy keep their looks. */
  .danger { background: var(--surface); color: var(--danger); border-color: var(--danger); --ring: var(--danger); }
  @media (hover: hover) {
    .danger:not(:disabled):not(.blocked):not([aria-busy="true"]):hover { background: var(--danger); color: var(--primary-text); }
  }
  .danger:not(:disabled):not(.blocked):not([aria-busy="true"]):focus-visible { background: var(--danger); color: var(--primary-text); }
  .danger:not(:disabled):not(.blocked):not([aria-busy="true"]):active { background: var(--danger-press); border-color: var(--danger-press); color: var(--primary-text); }
  .danger:focus-visible { outline: 2px solid var(--ring, var(--primary)); outline-offset: 2px; box-shadow: none; }
  /* Danger-off = an unarmed Force delete: keeps the red family, drops saturation. */
  .danger-off {
    background: var(--danger-off-bg);
    color: var(--danger-off-text);
    border-color: var(--danger-off-border);
    --ring: var(--danger);
  }
  /* A natively-disabled Force delete stays recognisably destructive (spec §4 /
     base.css): re-assert the danger-off tokens so the higher-specificity generic
     `.btn:disabled` (0,2,0) does not grey out `.danger-off` (0,1,0). This rule
     is (0,3,0), so it wins. */
  .btn.danger-off:disabled {
    background: var(--danger-off-bg);
    color: var(--danger-off-text);
    border-color: var(--danger-off-border);
    cursor: not-allowed;
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
