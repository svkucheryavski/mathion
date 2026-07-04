<!-- frontend/src/components/runs/SubmissionThreadEntry.svelte -->
<!-- Read-only historical submission entry for the DashboardSidePanel thread.
     Newest entry is rendered by the panel itself; this renders thread[1..]. -->
<script lang="ts">
  import { type ThreadSubmission, resultToStatus } from '../../lib/dashboards';
  import StatusBadge from '../ui/StatusBadge.svelte';
  import { formatLocalWithTz } from '../../lib/datetime';
  import { formatFileSize } from '../../lib/format';

  let { submission, expanded, onToggle }: {
    submission: ThreadSubmission;
    expanded: boolean;
    onToggle: () => void;
  } = $props();

  const evaluation = $derived(submission.evaluation);
  const summaryDate = $derived(
    submission.submitted_at ? formatLocalWithTz(submission.submitted_at) : '—',
  );
</script>

<div class="thread-entry" data-test="thread-entry" data-submission-id={submission.id}>
  <button
    type="button"
    class="thread-entry-summary"
    data-test="thread-entry-toggle"
    aria-expanded={expanded}
    onclick={onToggle}
  >
    <span>Submission {submission.submission_number}</span>
    <span aria-hidden="true">·</span>
    <span>{summaryDate}</span>
    <span aria-hidden="true">·</span>
    <StatusBadge status={resultToStatus(evaluation?.result ?? null)} />
  </button>

  {#if expanded}
    <section class="submission-block">
      <h4>Submission</h4>
      <p>Number: {submission.submission_number}</p>
      <p>Submitted at: {submission.submitted_at ? formatLocalWithTz(submission.submitted_at) : '—'}</p>
      <p>Submitted by: {submission.submitted_by?.full_name ?? submission.submitted_by?.user_id ?? '—'}</p>
      <p>Late: {submission.is_late ? 'Yes' : 'No'}</p>
      <p>Resubmission: {submission.is_resubmission ? 'Yes' : 'No'}</p>
      <p>File size: {formatFileSize(submission.file_size)}</p>
      <a class="download-link" href={`/api/submissions/${submission.id}/file`} download>Download submission</a>
    </section>

    {#if submission.is_resubmission}
      <div role="status" class="banner-info">
        Auto-accepted on resubmission. No manual evaluation needed.
      </div>
    {/if}

    {#if evaluation}
      <section class="evaluation-block">
        <h4>Evaluation</h4>
        <p>Evaluated at: {evaluation.evaluated_at ? formatLocalWithTz(evaluation.evaluated_at) : '—'}</p>
        <p>Evaluated by: {evaluation.evaluated_by?.full_name ?? evaluation.evaluated_by?.user_id ?? '—'}</p>
        <p>Result: {evaluation.result}</p>
        <p>Score: {evaluation.score ?? '—'}</p>
        <p>Feedback: {evaluation.feedback_text ?? '—'}</p>
        {#if evaluation.has_feedback_file}
          <a class="download-link" href={`/api/evaluations/${evaluation.id}/feedback-file`} download>Download feedback file</a>
        {/if}
      </section>
    {:else}
      <p>Awaiting evaluation</p>
    {/if}
  {/if}
</div>

<style>
  .thread-entry-summary {
    display: flex; align-items: center; gap: 0.5rem;
    width: 100%; text-align: left; background: none; border: none;
    padding: 0.5rem 0; cursor: pointer; font: inherit;
  }
  .banner-info {
    padding: 0.75rem 1rem; border-radius: 4px;
    background: #e0f2f8; color: #044d6c; border-left: 4px solid #0a7ea4;
    margin-bottom: 1rem;
  }
</style>
