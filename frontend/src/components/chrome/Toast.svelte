<script lang="ts">
  import type { Toast } from '../../lib/types';
  let { toast }: { toast: Toast } = $props();
  // role="alert" is the assertive ARIA live-region: screen readers interrupt
  // current speech to announce errors. role="status" is polite — used for
  // success/info confirmations that shouldn't barge in. Keeping all three
  // kinds on role="status" understated errors; this matches the WAI-ARIA
  // recommendations for transient feedback.
  const role = $derived(toast.kind === 'error' ? 'alert' : 'status');
</script>

<div class="toast {toast.kind}" {role}>{toast.message}</div>

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
  /* Distinct teal/blue for "info" kind — visually separates "Saved (refresh
     failed — reload to see latest)" from a plain success or error. Reads
     against white text the same way --primary does. */
  .info { background: #0a7ea4; }
</style>
