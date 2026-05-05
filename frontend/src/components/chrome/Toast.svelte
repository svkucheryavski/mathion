<script lang="ts">
  import type { Toast } from '../../lib/types';
  let { toast }: { toast: Toast } = $props();
</script>

<div class="toast {toast.kind}" role="status">{toast.message}</div>

<style>
  .toast {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius);
    background: var(--text);
    color: var(--bg);
    margin-bottom: var(--space-2);
    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
    max-width: 360px;
  }
  .error { background: var(--danger); }
  .success { background: var(--success); }
</style>
