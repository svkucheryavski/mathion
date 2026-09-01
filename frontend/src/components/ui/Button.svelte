<script lang="ts">
  type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-off';
  let {
    variant = 'primary' as Variant,
    type = 'button' as 'button' | 'submit',
    disabled = false,
    loading = false,
    title = undefined as string | undefined,
    // Forward aria-label so icon-only buttons (reorder ↑/↓) can announce
    // their purpose to screen readers. Visible glyph stays for sighted
    // users; the title attribute also supplies a tooltip.
    'aria-label': ariaLabel = undefined as string | undefined,
    onclick = undefined as (() => void) | undefined,
    full = false,
    children,
  } = $props();
</script>

<button
  {type}
  class="btn {variant}"
  class:full={full}
  data-variant={variant}
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
    background: var(--bg);
    color: var(--faint);
    border-color: var(--border-faint);
    cursor: not-allowed;
  }
  /* Full-width form primary (e.g. Login §2a "Sign in", ref 2010) — scoped CSS in
     a page can't reach a child component root, so this lives on the Button.
     `flex:1` is inert outside a flex parent and exact inside `.actions` (ref 2010). */
  .btn.full { flex: 1; width: 100%; justify-content: center; }
  .primary { background: var(--primary); color: var(--primary-text); }
  .secondary { background: var(--surface); color: var(--text-3); border-color: var(--border-strong); }
  .ghost { padding: var(--btn-pad-sm); background: transparent; color: var(--muted); }
  /* Danger is a text treatment, never a red fill. */
  .danger { background: transparent; color: var(--danger); }
  /* Danger-off = an unarmed Force delete: keeps the red family, drops saturation. */
  .danger-off {
    background: var(--danger-off-bg);
    color: var(--danger-off-text);
    border-color: var(--danger-off-border);
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
