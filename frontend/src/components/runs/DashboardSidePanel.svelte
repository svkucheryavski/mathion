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
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import DirtyGuard from '../editor/DirtyGuard.svelte';
  import StatusBadge from '../ui/StatusBadge.svelte';
  import { formatLocalWithTz } from '../../lib/datetime';
  import { formatFileSize } from '../../lib/format';
  import { MAX_FEEDBACK_FILE_SIZE_BYTES, type EvaluationResult, createEvaluation, patchEvaluation, type Evaluation } from '../../lib/evaluations';
  import { ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { tick } from 'svelte';

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

  let {
    target,
    onClose,
    isAdmin = false,
    isTeacher = false,
    onRefetch = () => {},
  }: {
    target: PanelTarget;
    onClose: () => void;
    isAdmin?: boolean;
    isTeacher?: boolean;
    onRefetch?: () => void;
  } = $props();

  const canWrite = $derived(isAdmin || isTeacher);
  let editing = $state(false);

  let formResult = $state<EvaluationResult | ''>('');
  let formScore = $state<number | null>(null);
  let formFeedbackText = $state('');
  let formFeedbackFile = $state<File | null>(null);
  let fileError = $state<string | null>(null);
  // Set true on first submit attempt; controls whether `errors.result` surfaces
  // the "Result is required." inline error vs. just relying on native `disabled`.
  let formSubmitAttempted = $state(false);

  const SUBMIT_TIMEOUT_MS = 60_000;

  let stateLatestEvaluation = $state<Evaluation | null>(null);
  let submitting = $state(false);
  let serverError = $state<string | null>(null);
  let submitController: AbortController | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let raceTransition = $state(false);

  // Captured when Edit is clicked (T6 wires the $effect). Used by T7's dirty-guard
  // to compare current form values against the pre-fill baseline so a clean
  // just-opened edit is NOT dirty. `null` means create-mode (no pre-fill).
  let prefillSnapshot = $state<{ result: EvaluationResult | ''; score: number | null; feedback_text: string } | null>(null);

  const effectiveEvaluation = $derived.by(() => {
    if (target.kind !== 'submission') return null;
    return stateLatestEvaluation ?? target.entry.latest_evaluation;
  });

  const existingHasFeedbackFile = $derived(effectiveEvaluation?.has_feedback_file ?? false);
  const resultLocked = $derived(editing && effectiveEvaluation != null && !effectiveEvaluation.has_feedback_file);

  $effect(() => {
    if (effectiveEvaluation != null) raceTransition = false;
  });

  $effect(() => {
    if (editing && effectiveEvaluation) {
      formResult = effectiveEvaluation.result as EvaluationResult;
      formScore = effectiveEvaluation.score;
      formFeedbackText = effectiveEvaluation.feedback_text ?? '';
      formFeedbackFile = null;
      fileError = null;
      prefillSnapshot = {
        result: effectiveEvaluation.result as EvaluationResult,
        score: effectiveEvaluation.score,
        feedback_text: effectiveEvaluation.feedback_text ?? '',
      };
      tick().then(() => {
        const sel = document.querySelector('select[name="evaluation-result"]') as HTMLSelectElement | null;
        sel?.focus();
      });
    }
  });

  const isDirty = $derived.by(() => {
    if (prefillSnapshot) {
      return (
        formResult !== prefillSnapshot.result ||
        formScore !== prefillSnapshot.score ||
        formFeedbackText !== prefillSnapshot.feedback_text ||
        formFeedbackFile !== null
      );
    }
    return (
      formResult !== '' ||
      formScore !== null ||
      formFeedbackText !== '' ||
      formFeedbackFile !== null
    );
  });

  let confirmDiscard = $state(false);

  $effect(() => {
    if (confirmDiscard) {
      tick().then(() => {
        const btn = document.querySelector('.inline-confirm button') as HTMLButtonElement | null;
        btn?.focus();
      });
    }
  });

  const feedbackCharCount = $derived(formFeedbackText.length);
  const counterApproaching = $derived(feedbackCharCount >= 900);

  // aria-live region emits a CONSTANT string when over threshold so SRs announce
  // ONCE (on the empty→constant transition at 900), NOT on every keystroke after.
  // Going below 900 makes the live region empty again (no announcement on empty).
  const announcedCounter = $derived(counterApproaching ? 'Approaching limit' : '');

  const errors = $derived.by(() => {
    const e: { result?: string; score?: string; feedbackText?: string; feedbackFile?: string } = {};
    if (formResult === '' && formSubmitAttempted) {
      e.result = 'Result is required.';
    }
    if (formScore !== null && !Number.isNaN(formScore)) {
      if (!Number.isInteger(formScore) || formScore < 0 || formScore > 100) {
        e.score = 'Score must be a whole number between 0 and 100.';
      }
    }
    const requiresFeedback = formResult !== '' && formResult !== 'accepted';
    if (requiresFeedback) {
      if (formFeedbackText.trim() === '') {
        e.feedbackText = 'Feedback is required when the result is not Accepted.';
      }
      if (!formFeedbackFile && !existingHasFeedbackFile) {
        e.feedbackFile = 'PDF file required for non-accepted results.';
      }
    }
    if (fileError) e.feedbackFile = fileError;
    return e;
  });

  // `valid` deliberately ignores `errors.result` (which only surfaces post-attempt
  // for UX) — the native `disabled` covers it pre-attempt.
  const valid = $derived(formResult !== '' && !errors.score && !errors.feedbackText && !errors.feedbackFile);

  async function handleSave() {
    formSubmitAttempted = true; // surfaces errors.result = 'Result is required.' if blank
    if (!valid || submitting) return;
    submitting = true;
    serverError = null;
    submitController = new AbortController();
    timeoutHandle = setTimeout(() => submitController?.abort('timeout'), SUBMIT_TIMEOUT_MS);
    try {
      let result: Evaluation;
      if (effectiveEvaluation == null) {
        if (target.kind !== 'submission') throw new Error('handleSave called on non-submission kind');
        result = await createEvaluation({
          submission_id: target.entry.latest_submission!.id,
          result: formResult as EvaluationResult,
          score: formScore,
          feedback_text: formFeedbackText || null,
          feedback_file: formFeedbackFile,
        }, { signal: submitController.signal });
      } else {
        result = await patchEvaluation(effectiveEvaluation.id, {
          result: formResult as EvaluationResult,
          score: formScore,
          feedback_text: formFeedbackText || null,
        }, { signal: submitController.signal });
      }
      stateLatestEvaluation = result;
      editing = false;
      pushToast('Evaluation saved; group notified', 'success');
      onRefetch();
      await tick();
      const editBtn = document.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement | null;
      editBtn?.focus();
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 409) {
        raceTransition = true;
        editing = false;
        onRefetch();
        return;
      }
      if ((e as { name?: string })?.name === 'AbortError') {
        const reason = (submitController?.signal as AbortSignal & { reason?: unknown })?.reason;
        if (reason === 'timeout') {
          serverError = 'Upload timed out. Try again.';
          return;
        }
        // user-cancel: silent revert
        return;
      }
      if (e instanceof ApiError) {
        serverError = e.displayMessage;
      } else {
        serverError = 'Unexpected error';
      }
    } finally {
      submitting = false;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      timeoutHandle = null;
      submitController = null;
    }
  }

  function handleCancel() {
    if (submitting) {
      submitController?.abort('user-cancel');
      return;
    }
    if (isDirty) {
      confirmDiscard = true;
      return;
    }
    editing = false;
    tick().then(() => {
      const editBtn = document.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement | null;
      editBtn?.focus();
    });
  }

  function tryClose() {
    if (submitting) return;
    if (isDirty) {
      confirmDiscard = true;
      return;
    }
    onClose();
  }

  function discardAndClose() {
    confirmDiscard = false;
    if (editing) {
      editing = false;
      formResult = '';
      formScore = null;
      formFeedbackText = '';
      formFeedbackFile = null;
      fileError = null;
      prefillSnapshot = null;
      formSubmitAttempted = false;
    } else {
      onClose();
    }
  }

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    fileError = null;
    if (!file) { formFeedbackFile = null; return; }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      fileError = 'Only PDF files accepted.';
      formFeedbackFile = null; return;
    }
    if (file.type !== '' && file.type !== 'application/pdf') {
      fileError = 'Only PDF files accepted.';
      formFeedbackFile = null; return;
    }
    if (file.size === 0) {
      fileError = 'File appears empty.';
      formFeedbackFile = null; return;
    }
    if (file.size > MAX_FEEDBACK_FILE_SIZE_BYTES) {
      fileError = 'File exceeds 20 MB limit.';
      formFeedbackFile = null; return;
    }
    formFeedbackFile = file;
  }

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
      tryClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="panel-backdrop" onclick={tryClose} role="presentation"></div>
<FocusTrap autofocusSelector='select[name="evaluation-result"], [data-side-panel-close]' autofocusPriorityOrder>
  <div
    class="dashboard-side-panel"
    role="dialog"
    aria-modal="true"
    aria-label={target.kind === 'progress' ? 'Item-level breakdown' : 'Submission details'}
    data-can-write={target.kind === 'submission' && canWrite ? 'true' : undefined}
  >
    <button class="panel-close" onclick={tryClose} aria-label="Close panel" data-side-panel-close>
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

      {#if target.entry.latest_submission == null}
        <p>Not submitted yet.</p>
      {:else}
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

        {#if sub.is_resubmission}
          <div role="status" class="banner-info">
            Auto-accepted on resubmission. No manual evaluation needed.
          </div>
          {#if target.entry.latest_evaluation}
            {@const evalu = target.entry.latest_evaluation}
            <!-- Occurrence (a): auto-accept eval block. NEVER replaced — always reads dashboard shape. -->
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
        {:else if effectiveEvaluation}
          {@const evalu = effectiveEvaluation}
          <!-- Occurrence (b): Branch B. -->
          <section class="evaluation-block">
            <h4>Evaluation</h4>
            <p>Evaluated at: {target.entry.latest_evaluation ? (target.entry.latest_evaluation.evaluated_at ? formatLocalWithTz(target.entry.latest_evaluation.evaluated_at) : '—') : 'Just now'}</p>
            <p>Evaluated by: {target.entry.latest_evaluation ? (target.entry.latest_evaluation.evaluated_by?.full_name ?? target.entry.latest_evaluation.evaluated_by?.user_id ?? '—') : 'You'}</p>
            <p>Result: {evalu.result}</p>
            <p>Score: {evalu.score ?? '—'}</p>
            <p>Feedback: {evalu.feedback_text ?? '—'}</p>
            {#if evalu.has_feedback_file}
              <a class="download-link" href={`/api/evaluations/${evalu.id}/feedback-file`} download>Download feedback file</a>
            {/if}
          </section>
          {#if canWrite && !editing}
            <button type="button" data-test="edit-evaluation" onclick={() => (editing = true)}>Edit evaluation</button>
          {/if}
          {#if canWrite && editing}
            <h4>Edit evaluation</h4>
            {#if serverError}<div role="alert" class="form-error">{serverError}</div>{/if}
            <form aria-label="Write evaluation" onsubmit={(e) => { e.preventDefault(); formSubmitAttempted = true; handleSave(); }}>
              <label for="evaluation-result">Result <span aria-hidden="true">*</span> <span id="evaluation-result-helper" class="helper-text">(required)</span></label>
              <select id="evaluation-result" name="evaluation-result"
                      aria-required="true"
                      aria-describedby={[
                        'evaluation-result-helper',
                        errors.result ? 'evaluation-result-error' : null,
                        resultLocked ? 'evaluation-result-lock' : null,
                      ].filter(Boolean).join(' ')}
                      bind:value={formResult}>
                <option value="">Select…</option>
                <option value="rejected" disabled={resultLocked}>Rejected</option>
                <option value="major_revision" disabled={resultLocked}>Major revision</option>
                <option value="minor_revision" disabled={resultLocked}>Minor revision</option>
                <option value="accepted">Accepted</option>
              </select>
              {#if errors.result}<span id="evaluation-result-error" role="alert">{errors.result}</span>{/if}
              {#if resultLocked}<span id="evaluation-result-lock" class="helper-text">Cannot change to a non-accepted result without a feedback file. Create a new evaluation instead.</span>{/if}

              <label for="evaluation-score">Score <span class="helper-text">(optional, 0–100)</span></label>
              <input id="evaluation-score" name="evaluation-score" type="number" min="0" max="100" step="1"
                     value={formScore ?? ''}
                     oninput={(e) => {
                       const v = (e.currentTarget as HTMLInputElement).value;
                       formScore = v === '' ? null : Number(v);
                     }}
                     aria-describedby={errors.score ? 'evaluation-score-error' : undefined} />
              {#if errors.score}<span id="evaluation-score-error" role="alert">{errors.score}</span>{/if}

              <label for="evaluation-feedback">
                Feedback text
                {#if formResult !== 'accepted' && formResult !== ''}
                  <span aria-hidden="true">*</span> <span class="helper-text">(required)</span>
                {:else}
                  <span class="helper-text">(optional)</span>
                {/if}
              </label>
              <textarea id="evaluation-feedback" name="evaluation-feedback" maxlength="1000"
                        bind:value={formFeedbackText}
                        aria-describedby={errors.feedbackText ? 'evaluation-feedback-count evaluation-feedback-error' : 'evaluation-feedback-count'}></textarea>
              <span id="evaluation-feedback-count" data-test="feedback-counter-visible">
                {feedbackCharCount} / 1000{#if counterApproaching}<strong> — approaching limit</strong>{/if}
              </span>
              <span class="sr-only" data-test="feedback-counter-live" aria-live="polite">{announcedCounter}</span>
              {#if errors.feedbackText}<span id="evaluation-feedback-error" role="alert">{errors.feedbackText}</span>{/if}

              {#if !editing}
                <label for="evaluation-file">
                  Feedback PDF
                  {#if formResult !== 'accepted' && formResult !== ''}
                    <span aria-hidden="true">*</span> <span class="helper-text">(required)</span>
                  {/if}
                </label>
                <input id="evaluation-file" name="evaluation-file" type="file" accept=".pdf,application/pdf" onchange={handleFileChange} />
                <span class="helper-text">PDF only, max 20 MB.</span>
                {#if errors.feedbackFile}<span role="alert">{errors.feedbackFile}</span>{/if}
              {:else if existingHasFeedbackFile}
                <p class="helper-text">Existing feedback file uploaded — replace not supported (Phase 9)</p>
              {/if}

              <button type="submit" disabled={!valid || submitting} aria-busy={submitting}>Save</button>
              {#if editing || submitting}
                <button type="button" data-test="cancel-button" onclick={handleCancel}>{submitting ? 'Cancel upload' : 'Cancel'}</button>
              {/if}
            </form>
          {/if}
        {:else if canWrite && !raceTransition}
          <h4>New evaluation</h4>
          {#if serverError}<div role="alert" class="form-error">{serverError}</div>{/if}
          <form aria-label="Write evaluation" onsubmit={(e) => { e.preventDefault(); formSubmitAttempted = true; handleSave(); }}>
              <label for="evaluation-result">Result <span aria-hidden="true">*</span> <span id="evaluation-result-helper" class="helper-text">(required)</span></label>
              <select id="evaluation-result" name="evaluation-result"
                      aria-required="true"
                      aria-describedby={[
                        'evaluation-result-helper',
                        errors.result ? 'evaluation-result-error' : null,
                        resultLocked ? 'evaluation-result-lock' : null,
                      ].filter(Boolean).join(' ')}
                      bind:value={formResult}>
                <option value="">Select…</option>
                <option value="rejected" disabled={resultLocked}>Rejected</option>
                <option value="major_revision" disabled={resultLocked}>Major revision</option>
                <option value="minor_revision" disabled={resultLocked}>Minor revision</option>
                <option value="accepted">Accepted</option>
              </select>
              {#if errors.result}<span id="evaluation-result-error" role="alert">{errors.result}</span>{/if}
              {#if resultLocked}<span id="evaluation-result-lock" class="helper-text">Cannot change to a non-accepted result without a feedback file. Create a new evaluation instead.</span>{/if}

              <label for="evaluation-score">Score <span class="helper-text">(optional, 0–100)</span></label>
              <input id="evaluation-score" name="evaluation-score" type="number" min="0" max="100" step="1"
                     value={formScore ?? ''}
                     oninput={(e) => {
                       const v = (e.currentTarget as HTMLInputElement).value;
                       formScore = v === '' ? null : Number(v);
                     }}
                     aria-describedby={errors.score ? 'evaluation-score-error' : undefined} />
              {#if errors.score}<span id="evaluation-score-error" role="alert">{errors.score}</span>{/if}

              <label for="evaluation-feedback">
                Feedback text
                {#if formResult !== 'accepted' && formResult !== ''}
                  <span aria-hidden="true">*</span> <span class="helper-text">(required)</span>
                {:else}
                  <span class="helper-text">(optional)</span>
                {/if}
              </label>
              <textarea id="evaluation-feedback" name="evaluation-feedback" maxlength="1000"
                        bind:value={formFeedbackText}
                        aria-describedby={errors.feedbackText ? 'evaluation-feedback-count evaluation-feedback-error' : 'evaluation-feedback-count'}></textarea>
              <span id="evaluation-feedback-count" data-test="feedback-counter-visible">
                {feedbackCharCount} / 1000{#if counterApproaching}<strong> — approaching limit</strong>{/if}
              </span>
              <span class="sr-only" data-test="feedback-counter-live" aria-live="polite">{announcedCounter}</span>
              {#if errors.feedbackText}<span id="evaluation-feedback-error" role="alert">{errors.feedbackText}</span>{/if}

              {#if !editing}
                <label for="evaluation-file">
                  Feedback PDF
                  {#if formResult !== 'accepted' && formResult !== ''}
                    <span aria-hidden="true">*</span> <span class="helper-text">(required)</span>
                  {/if}
                </label>
                <input id="evaluation-file" name="evaluation-file" type="file" accept=".pdf,application/pdf" onchange={handleFileChange} />
                <span class="helper-text">PDF only, max 20 MB.</span>
                {#if errors.feedbackFile}<span role="alert">{errors.feedbackFile}</span>{/if}
              {:else if existingHasFeedbackFile}
                <p class="helper-text">Existing feedback file uploaded — replace not supported (Phase 9)</p>
              {/if}

              <button type="submit" disabled={!valid || submitting} aria-busy={submitting}>Save</button>
              {#if editing || submitting}
                <button type="button" data-test="cancel-button" onclick={handleCancel}>{submitting ? 'Cancel upload' : 'Cancel'}</button>
              {/if}
          </form>
        {:else}
          <p>Awaiting evaluation</p>
        {/if}
      {/if}
    {/if}
    {#if confirmDiscard}
      <div class="discard-confirm">
        <InlineConfirm
          confirmLabel="Discard"
          warning="Discard unsaved changes?"
          onConfirm={discardAndClose}
          onCancel={() => (confirmDiscard = false)}
        />
      </div>
    {/if}
    <DirtyGuard isDirty={() => isDirty && !submitting} />
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
  .banner-info {
    padding: 0.75rem 1rem;
    border-radius: 4px;
    background: #e0f2f8;
    color: #044d6c;
    border-left: 4px solid #0a7ea4;
    margin-bottom: 1rem;
  }
  .form-error {
    background: #fdecea;
    color: #611a15;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    border-left: 4px solid #c53030;
    margin-bottom: 1rem;
  }
  .helper-text {
    color: var(--text-muted, #666);
    font-size: 0.85em;
  }
  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0,0,0,0);
    white-space: nowrap; border: 0;
  }
</style>
