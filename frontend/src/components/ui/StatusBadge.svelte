<!-- frontend/src/components/ui/StatusBadge.svelte -->
<script lang="ts">
  import { STATUS_LABEL, type MpGroupStatus } from '../../lib/dashboards';

  // `label` overrides the text only (Slice-6a Submissions passes the short label).
  let { status, label = undefined }: { status: MpGroupStatus; label?: string } = $props();

  // Map status enum to CSS variable name (underscores → dashes).
  const cssKey = $derived(status.replace(/_/g, '-'));
</script>

<span
  class="status-badge"
  data-status={status}
  style="--badge-bg: var(--status-{cssKey}-bg); --badge-fg: var(--status-{cssKey}-fg);"
>{label ?? STATUS_LABEL[status]}</span>

<style>
  /* Reference visual-system badge metrics (§5): 11px / 500 / 3px 8px / pill
     radius. Label only — no decorative status glyph (§5 #8). */
  .status-badge {
    display: inline-flex;
    align-items: center;
    padding: 3px 8px;
    border-radius: var(--radius-pill);
    background-color: var(--badge-bg);
    color: var(--badge-fg);
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }
</style>
