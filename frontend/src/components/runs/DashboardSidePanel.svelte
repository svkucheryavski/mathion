<!-- frontend/src/components/runs/DashboardSidePanel.svelte -->
<!--
  Slide-in side drawer (NOT centered modal). Width: min(640px, 90vw).
  Pattern: peek-and-back-to-list, not focused-edit. Deliberate divergence
  from the existing modal pattern; see spec §6.5 line 1304.
-->
<script lang="ts">
  import {
    getSequenceItemState,
    type SequenceItemStateResponse,
    type DashboardMpRow,
    type DashboardMpGroupEntry,
  } from '../../lib/dashboards';
  import FocusTrap from '../ui/FocusTrap.svelte';
  import StatusBadge from '../ui/StatusBadge.svelte';
  import { formatLocalWithTz } from '../../lib/datetime';
  import { formatFileSize } from '../../lib/format';

  type ProgressTarget = {
    kind: 'progress';
    runId: number;
    user_id: number;
    sequence_id: number;
  };
  type SubmissionTarget = {
    kind: 'submission';
    mp: DashboardMpRow;
    entry: DashboardMpGroupEntry;
  };
  export type PanelTarget = ProgressTarget | SubmissionTarget;

  let { target, onClose }: { target: PanelTarget; onClose: () => void } = $props();

  // Progress fetch state — only relevant when target.kind === 'progress'.
  let data = $state<SequenceItemStateResponse | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let abortCtl: AbortController | null = null;

  $effect(() => {
    abortCtl?.abort();
    if (target.kind !== 'progress') {
      data = null; loading = false; error = null;
      return;
    }
    const ctl = new AbortController();
    abortCtl = ctl;
    loading = true; error = null; data = null;
    getSequenceItemState(target.runId, target.user_id, target.sequence_id, { signal: ctl.signal })
      .then((res) => { data = res; loading = false; })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        // Spec §6.5 line 1322: "Fetch error (incl. 404)" → uniform message
        // for ALL fetch errors (404 not split from other errors).
        error = 'Item details unavailable. The dashboard may be out of date — Refresh.';
        loading = false;
      });
    return () => ctl.abort();
  });

  // Unmount-only cleanup for any in-flight panel fetch (mirrors the tab pattern).
  $effect(() => () => abortCtl?.abort());

  // Escape handled via svelte:window per spec §6.5 line 1300 (matches the
  // RosterImportModal.svelte:111-116 pattern). FocusTrap handles Tab/Shift+Tab
  // cycling + previousFocus restore on unmount.
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="panel-backdrop" onclick={onClose} role="presentation"></div>
<FocusTrap>
  <div
    class="dashboard-side-panel"
    role="dialog"
    aria-modal="true"
    aria-label={target.kind === 'progress' ? 'Item-level breakdown' : 'Submission details'}
  >
    <button class="panel-close" onclick={onClose} aria-label="Close panel">
      <span aria-hidden="true">✕</span>
      Close
    </button>

    {#if target.kind === 'progress'}
      {#if loading}
        <p>Loading…</p>
      {:else if error}
        <p class="banner-error" role="alert">{error}</p>
      {:else if data}
        <header>
          <p class="student-line">{data.student.full_name ?? data.student.email}</p>
          <h3>{data.sequence.block_title} — {data.sequence.sequence_title}</h3>
        </header>
        {#if data.items.length === 0}
          <p>No items in this sequence.</p>
        {:else}
          <ol class="item-list">
            {#each data.items as it (it.item_id)}
              <li>
                <span class="item-covered">{it.is_covered ? '✓' : '○'}</span>
                <span class="item-title">{it.item_title}</span>
                <span class="item-type">{it.item_type}</span>
                {#if it.last_score}
                  <span class="item-score">{it.last_score.correct}/{it.last_score.total}</span>
                {/if}
              </li>
            {/each}
          </ol>
        {/if}
      {/if}
    {:else}
      <!-- submission variant: no fetch, render from passed-in target.entry -->
      <header>
        <h3>{target.mp.title}</h3>
        <p class="block-subtitle">{target.mp.block_title}</p>
        <p class="group-line">{target.entry.group_name}</p>
      </header>

      <StatusBadge status={target.entry.status} />

      {#if target.entry.status === 'not_submitted'}
        <!-- Spec §6.5 line 1352: replaces Submission + Evaluation blocks entirely. -->
        <p>Not submitted yet.</p>
      {:else}
        <!-- Submission block — spec §6.5 lines 1335-1342 -->
        {#if target.entry.latest_submission}
          {@const sub = target.entry.latest_submission}
          <section class="submission-block">
            <h4>Submission</h4>
            <p>Number: {sub.submission_number}</p>
            <p>Submitted at: {sub.submitted_at ? formatLocalWithTz(sub.submitted_at) : '—'}</p>
            <p>Submitted by: {sub.submitted_by?.full_name ?? sub.submitted_by?.user_id ?? '—'}</p>
            <p>Late: {sub.is_late ? 'Yes' : 'No'}</p>
            <p>Resubmission: {sub.is_resubmission ? 'Yes' : 'No'}</p>
            <p>File size: {formatFileSize(sub.file_size)}</p>
            <a class="download-link" href={`/api/submissions/${sub.id}/file`} download>Download submission</a>
          </section>
        {/if}

        <!-- Spec §6.5 line 1353: omit Evaluation block when awaiting_eval. -->
        {#if target.entry.status !== 'awaiting_eval' && target.entry.latest_evaluation}
          {@const evalu = target.entry.latest_evaluation}
          <section class="evaluation-block">
            <h4>Evaluation</h4>
            <p>Evaluated at: {evalu.evaluated_at ? formatLocalWithTz(evalu.evaluated_at) : '—'}</p>
            <p>Evaluated by: {evalu.evaluated_by?.full_name ?? evalu.evaluated_by?.user_id ?? '—'}</p>
            <p>Result: {evalu.result}</p>
            <p>Score: {evalu.score ?? '—'}</p>
            <p>Feedback: {evalu.feedback_text ?? '—'}</p>
            {#if evalu.has_feedback_file}
              <a class="download-link" href={`/api/evaluations/${evalu.id}/feedback-file`} download>Download feedback file</a>
            {/if}
          </section>
        {/if}
      {/if}
    {/if}
  </div>
</FocusTrap>

<style>
  .panel-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 100;
  }
  .dashboard-side-panel {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: min(640px, 90vw);
    background: var(--bg, #fff); padding: 1.5rem;
    overflow-y: auto; z-index: 101;
    box-shadow: -2px 0 8px rgba(0,0,0,0.15);
  }
  .panel-close { float: right; font-size: 1.5em; background: none; border: none; cursor: pointer; }
</style>
