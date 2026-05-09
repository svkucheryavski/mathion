<script lang="ts">
  type Variant = 'primary' | 'secondary' | 'ghost';
  let {
    variant = 'primary' as Variant,
    type = 'button' as 'button' | 'submit',
    disabled = false,
    loading = false,
    title = undefined as string | undefined,
    onclick = undefined as (() => void) | undefined,
    children,
  } = $props();
</script>

<button
  {type}
  class="btn {variant}"
  {disabled}
  {title}
  {onclick}
>
  {#if loading}<span class="spinner"></span>{/if}
  {@render children?.()}
</button>

<style>
  .btn {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius);
    border: 1px solid transparent;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .primary { background: var(--primary); color: var(--primary-text); }
  .secondary { background: var(--bg); color: var(--text); border-color: var(--border); }
  .ghost { background: transparent; color: var(--text); }
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
