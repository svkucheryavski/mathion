<script module lang="ts">
  // Read-only submission and evaluation content (9b), shared by the side
  // panel's cards and its earlier-submission rows (6c R43). The caller draws
  // the frame around it: a card, or a row's indented body.
  import IconButton from '../ui/IconButton.svelte';
  import StatusBadge from '../ui/StatusBadge.svelte';
  import {
    resultLabel,
    resultToStatus,
    type ThreadEvaluation,
    type ThreadSubmissionBase,
  } from '../../lib/dashboards';
  import { formatLocalWithTz } from '../../lib/datetime';
  import { formatFileSize } from '../../lib/format';

  // What the Evaluation rows read: a thread evaluation, or the panel's
  // just-saved one (lib/evaluations' Evaluation) before the refetch.
  export type EvaluationView = Pick<ThreadEvaluation, 'id' | 'result' | 'score' | 'feedback_text' | 'has_feedback_file'>;

  // The Evaluated row: "{by} · {when}".
  export function evaluatedLine(ev: ThreadEvaluation): string {
    const by = ev.evaluated_by?.full_name ?? ev.evaluated_by?.user_id ?? '—';
    const when = ev.evaluated_at ? formatLocalWithTz(ev.evaluated_at) : '—';
    return `${by} · ${when}`;
  }

  export { submissionChips, submissionContent, evaluationContent };
</script>

{#snippet submissionChips(sub: ThreadSubmissionBase)}
  {#if sub.is_resubmission}<span class="sc-chip">resubmission</span>{/if}
  {#if sub.is_late}<span class="sc-chip sc-late">late</span>{/if}
{/snippet}

{#snippet submissionContent(sub: ThreadSubmissionBase)}
  <dl class="sc-rows" data-test="submission-content">
    <dt class="sc-k">Submitted</dt>
    <dd class="sc-v">{sub.submitted_at ? formatLocalWithTz(sub.submitted_at) : '—'}</dd>
    <dt class="sc-k">By</dt>
    <dd class="sc-v">{sub.submitted_by?.full_name ?? sub.submitted_by?.user_id ?? '—'}</dd>
    <dt class="sc-k">Number</dt>
    <dd class="sc-v sc-mono">{sub.submission_number}</dd>
  </dl>
  <!-- D26: no file name is stored, so the card names the submission. -->
  <div class="sc-file">
    <span class="sc-tile" aria-hidden="true">PDF</span>
    <span class="sc-file-text">
      <span class="sc-file-name">Submission {sub.submission_number}</span>
      <span class="sc-file-meta">PDF · {formatFileSize(sub.file_size)}</span>
    </span>
    <IconButton
      glyph="download"
      size="sm"
      title="Download submission {sub.submission_number}"
      href="/api/submissions/{sub.id}/file"
      download
    />
  </div>
{/snippet}

{#snippet evaluationContent(ev: EvaluationView, evaluated: string)}
  <dl class="sc-rows" data-test="evaluation-content">
    <dt class="sc-k">Result</dt>
    <dd class="sc-v"><StatusBadge status={resultToStatus(ev.result)} label={resultLabel(ev.result)} /></dd>
    <dt class="sc-k">Score</dt>
    <dd class="sc-v sc-mono">{ev.score ?? '—'}</dd>
    <dt class="sc-k">Feedback</dt>
    <dd class="sc-v sc-pre">{ev.feedback_text || '—'}</dd>
    <dt class="sc-k">Evaluated</dt>
    <dd class="sc-v">{evaluated}</dd>
  </dl>
  {#if ev.has_feedback_file}
    <div class="sc-file">
      <span class="sc-tile" aria-hidden="true">PDF</span>
      <span class="sc-file-text">
        <span class="sc-file-name">Feedback file</span>
        <span class="sc-file-meta">PDF</span>
      </span>
      <IconButton
        glyph="download"
        size="sm"
        title="Download feedback file"
        href="/api/evaluations/{ev.id}/feedback-file"
        download
      />
    </div>
  {/if}
{/snippet}

<style>
  .sc-rows {
    display: grid;
    grid-template-columns: 104px 1fr;
    gap: 6px 12px;
    margin: 0;
    font-size: 12.5px;
  }
  .sc-k { margin: 0; color: var(--muted); }
  .sc-v { margin: 0; min-width: 0; color: var(--text); overflow-wrap: anywhere; }
  .sc-mono { font-family: var(--font-mono); }
  .sc-pre { white-space: pre-wrap; }
  .sc-chip {
    padding: 3px 8px;
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    color: var(--text-3);
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }
  .sc-late {
    background: var(--status-needs-revision-bg);
    color: var(--status-needs-revision-fg);
  }
  .sc-file {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-3);
  }
  .sc-tile {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 32px;
    height: 28px;
    border-radius: 4px;
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 600;
    color: var(--muted);
  }
  .sc-file-text { display: flex; flex-direction: column; gap: 1px; flex: 1 1 auto; min-width: 0; }
  .sc-file-name { font-size: 12.5px; color: var(--text); }
  .sc-file-meta { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); }
</style>
