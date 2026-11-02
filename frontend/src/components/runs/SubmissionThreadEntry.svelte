<!-- frontend/src/components/runs/SubmissionThreadEntry.svelte -->
<!-- One earlier submission in the side panel's "Earlier submissions" card (9b):
     a disclosure row, and when open the read-only content indented under it.
     The newest submission is the panel's own "Latest submission" card. -->
<script lang="ts">
  import { type ThreadSubmission, resultToStatus, STATUS_SHORT_LABEL } from '../../lib/dashboards';
  import StatusBadge from '../ui/StatusBadge.svelte';
  import { formatLocalShortDate } from '../../lib/datetime';
  import { submissionChips, submissionContent, evaluationContent, evaluatedLine } from './SubmissionCards.svelte';

  let { submission, expanded, onToggle }: {
    submission: ThreadSubmission;
    expanded: boolean;
    onToggle: () => void;
  } = $props();

  const evaluation = $derived(submission.evaluation);
  const status = $derived(resultToStatus(evaluation?.result ?? null));
</script>

<div class="te-entry" data-test="thread-entry" data-submission-id={submission.id}>
  <button
    type="button"
    class="te-toggle"
    data-test="thread-entry-toggle"
    aria-expanded={expanded}
    onclick={onToggle}
  >
    <svg class="te-chev" class:open={expanded} width="12" height="12" viewBox="0 0 16 16" fill="none"
         stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="6.6,4.6 10,8 6.6,11.4" />
    </svg>
    <span class="te-name">Submission {submission.submission_number}</span>
    <span class="te-date">{submission.submitted_at ? formatLocalShortDate(submission.submitted_at) : '—'}</span>
    <span class="te-badge"><StatusBadge {status} label={STATUS_SHORT_LABEL[status]} /></span>
  </button>

  {#if expanded}
    <div class="te-body">
      {#if submission.is_resubmission || submission.is_late}
        <div class="te-chips">{@render submissionChips(submission)}</div>
      {/if}
      {@render submissionContent(submission)}
      {#if submission.is_resubmission}
        <p class="te-info banner-info" role="status">Auto-accepted on resubmission. No manual evaluation needed.</p>
      {/if}
      {#if evaluation}
        <h4 class="te-h">Evaluation</h4>
        {@render evaluationContent(evaluation, evaluatedLine(evaluation))}
      {:else}
        <p class="te-muted" data-test="awaiting-evaluation-placeholder">Awaiting evaluation</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .te-entry { border-bottom: 1px solid var(--border-soft); }
  .te-entry:last-child { border-bottom: 0; }
  .te-toggle {
    display: flex;
    align-items: center;
    gap: 9px;
    box-sizing: border-box;
    width: 100%;
    padding: 9px 12px;
    border: 0;
    background: transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .te-chev { flex: 0 0 auto; color: var(--muted); }
  .te-chev.open { transform: rotate(90deg); }
  .te-name { font-size: 13px; color: var(--text); }
  .te-date {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--muted);
  }
  .te-badge { margin-left: auto; }
  /* Indented under the row's name (12px padding + 12px chevron + 9px gap). */
  .te-body { display: flex; flex-direction: column; gap: 8px; padding: 0 12px 12px 33px; }
  .te-chips { display: flex; gap: 6px; }
  .te-info {
    margin: 0;
    padding: 8px 12px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--text-2);
  }
  .te-h { margin: 4px 0 0; font-size: 12.5px; font-weight: 600; color: var(--text); }
  .te-muted { margin: 0; font-size: 13px; color: var(--muted); }
</style>
