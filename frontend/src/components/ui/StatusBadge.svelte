<!-- frontend/src/components/ui/StatusBadge.svelte -->
<script lang="ts">
  import { STATUS_LABEL, STATUS_ICON, type MpGroupStatus } from '../../lib/dashboards';

  let { status }: { status: MpGroupStatus } = $props();

  // Map status enum to CSS variable name (underscores → dashes).
  const cssKey = $derived(status.replace(/_/g, '-'));
</script>

<span
  class="status-badge"
  data-status={status}
  style="--badge-bg: var(--status-{cssKey}-bg); --badge-fg: var(--status-{cssKey}-fg);"
>
  <span class="icon" aria-hidden="true">{STATUS_ICON[status]}</span>
  <span class="label">{STATUS_LABEL[status]}</span>
</span>

<style>
  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.5rem;
    border-radius: 2px;
    background-color: var(--badge-bg);
    color: var(--badge-fg);
    font-size: 0.875rem;
    font-weight: 500;
    white-space: nowrap;
  }
  .status-badge .icon {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI Symbol', 'Apple Symbols', 'Noto Sans Symbols', sans-serif;
  }
</style>
