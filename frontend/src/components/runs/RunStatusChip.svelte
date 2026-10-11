<script lang="ts">
  // One chip for a run's status (spec §Run status chip): the run frame and
  // both runs lists. The label is in the text, so colour is never the only signal.
  import { RUN_STATUS_LABEL, type RunStatus } from '../../lib/runStatus';

  let { status }: { status: RunStatus } = $props();
</script>

<span class="run-chip run-chip-{status}" data-status={status}>{RUN_STATUS_LABEL[status]}</span>

<style>
  .run-chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    font-size: 11px;
    font-weight: 500;
    line-height: 1.4;
    white-space: nowrap;
  }
  .run-chip-active { background: var(--status-awaiting-eval-bg); color: var(--status-awaiting-eval-fg); }
  .run-chip-upcoming { background: var(--primary-soft); color: var(--primary); }
  .run-chip-ended { background: var(--state-archived-bg); color: var(--state-archived-fg); }
  .run-chip-draft { background: var(--state-created-bg); color: var(--state-created-fg); }
</style>
