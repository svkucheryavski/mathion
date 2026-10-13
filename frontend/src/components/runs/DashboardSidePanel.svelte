<!-- frontend/src/components/runs/DashboardSidePanel.svelte -->
<!--
  The grading / progress side panel (9b): a 520px drawer on ui/Modal at the
  right edge (6c D27, R30). × and Esc close it; a click on the dimmed page
  does not (D29).
-->
<script lang="ts">
  import {
    getSequenceItemState,
    getSubmissionThread,
    resultToStatus,
    STATUS_SHORT_LABEL,
    type MpGroupStatus,
    type SequenceItemStateResponse,
    type DashboardMpRow,
    type DashboardMpGroupEntry,
    type ThreadSubmission,
  } from '../../lib/dashboards';
  import SubmissionThreadEntry from './SubmissionThreadEntry.svelte';
  import ProgressBreakdown from './ProgressBreakdown.svelte';
  import Modal from '../ui/Modal.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import DirtyGuard from '../editor/DirtyGuard.svelte';
  import StatusBadge from '../ui/StatusBadge.svelte';
  import { formatLocalWithTz } from '../../lib/datetime';
  import { formatFileSize } from '../../lib/format';
  import { focusFirst } from '../../lib/focusFirst';
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
    runId: number;
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

  const uid = $props.id();
  const titleId = `${uid}-title`;
  let titleEl = $state<HTMLElement>();
  let discardEl = $state<HTMLElement>();
  // Modal owns the panel and ×; the panel finds them from its title.
  const panelEl = () => titleEl?.closest<HTMLElement>('.modal-panel') ?? null;
  const closeX = () => panelEl()?.querySelector<HTMLButtonElement>('.modal-head button[aria-label="Close"]') ?? null;
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

  // --- Submission thread (Slice B) ---
  let threadState = $state<ThreadSubmission[] | null>(null);
  let threadLoading = $state(false);
  let threadError = $state(false);
  let threadCtl: AbortController | null = null;
  let expandedById = $state<Record<number, boolean>>({});

  // Gated primitive ids — the fetch effect reads ONLY primitive $derived (these three
  // plus the sub/eval-id primitives declared below), never `target` inline, so it fires
  // once per (cell + cell sub/eval-id state): the ids recompute to strict-equal values
  // across an onRefetch()-driven `target` object swap, so a no-op refresh propagates
  // nothing. null when not a submission target or nothing submitted yet.
  const submissionRunId = $derived(
    target.kind === 'submission' && target.entry.latest_submission != null ? target.runId : null,
  );
  const submissionMpId = $derived(
    target.kind === 'submission' && target.entry.latest_submission != null ? target.mp.id : null,
  );
  const submissionGroupId = $derived(
    target.kind === 'submission' && target.entry.latest_submission != null ? target.entry.group_id : null,
  );
  // Also key the fetch effect on the cell's latest submission/evaluation ids so an
  // EXTERNAL grid refresh (onRefetch reassigns `data` → a new cell entry with a
  // changed submission or evaluation) re-fetches the thread — spec §8: "surfaced on
  // the next thread refetch / manual grid refresh". Primitive values → no refire when
  // the ids are unchanged (a no-op grid refresh does not refetch). After a create
  // write the cell's evaluation id changes null→N via onRefetch, so the effect DOES
  // refire and fetches once more on top of Step 11's manual refetch; this is benign
  // (loadThread aborts the prior in-flight request, so the two serialize) and is the
  // same mechanism that surfaces a concurrent external evaluation.
  const submissionLatestSubId = $derived(
    target.kind === 'submission' ? (target.entry.latest_submission?.id ?? null) : null,
  );
  const submissionLatestEvalId = $derived(
    target.kind === 'submission' ? (target.entry.latest_evaluation?.id ?? null) : null,
  );

  // The authoritative newest entry. Once the thread resolves, thread[0] wins
  // (may differ from the cell entry if the group resubmitted). Before that (or
  // defensively if the thread resolves empty) fall back to the cell entry.
  const newest = $derived.by<ThreadSubmission | null>(() => {
    if (target.kind !== 'submission' || target.entry.latest_submission == null) return null;
    if (threadState != null && threadState.length > 0) return threadState[0];
    return { ...target.entry.latest_submission, evaluation: target.entry.latest_evaluation };
  });

  const effectiveEvaluation = $derived.by(() => {
    if (target.kind !== 'submission') return null;
    // The post-write bridge only applies to the submission it was created for.
    // If the thread's newest is now a DIFFERENT submission (the group resubmitted
    // between the write and the refetch), fall through to the thread's own newest
    // evaluation so we never render/PATCH the previous submission's evaluation
    // against a newer one.
    if (stateLatestEvaluation != null && stateLatestEvaluation.submission_id === newest?.id) {
      return stateLatestEvaluation;
    }
    return newest?.evaluation ?? null;
  });

  const panelStatus = $derived.by<MpGroupStatus>(() => {
    // Badge only renders for submission targets; this fallback is dead code that
    // must still typecheck (ProgressTarget has no `entry`), so return a valid status.
    if (target.kind !== 'submission') return 'not_submitted';
    if (newest == null) return 'not_submitted';
    return resultToStatus(effectiveEvaluation?.result ?? null);
  });

  function loadThread(runId: number, mpId: number, groupId: number) {
    threadCtl?.abort();
    const ctl = new AbortController();
    threadCtl = ctl;
    threadLoading = true; threadError = false; threadState = null;
    getSubmissionThread(runId, mpId, groupId, { signal: ctl.signal })
      .then((res) => {
        if (ctl.signal.aborted) return;
        threadState = res.submissions;
        threadLoading = false;
        // Drop the post-write bridge once the refetch supersedes it: the newest
        // submission now carries its own evaluation, OR the newest is a DIFFERENT
        // submission than the bridge was created for (a concurrent resubmission
        // landed). Never on an empty thread (keeps the create-then-edit flat eval)
        // and never mid-edit (would reset the in-progress form).
        const newestAfter = res.submissions.length > 0 ? res.submissions[0] : null;
        if (
          !editing &&
          stateLatestEvaluation != null &&
          newestAfter != null &&
          (newestAfter.evaluation != null || newestAfter.id !== stateLatestEvaluation.submission_id)
        ) {
          stateLatestEvaluation = null;
        }
      })
      .catch((err: unknown) => {
        if (ctl.signal.aborted || (err as { name?: string })?.name === 'AbortError') return;
        threadError = true; threadLoading = false;
      });
  }

  function retryThread() {
    if (submissionRunId != null && submissionMpId != null && submissionGroupId != null) {
      loadThread(submissionRunId, submissionMpId, submissionGroupId);
    }
  }

  function toggleThreadEntry(id: number) {
    expandedById = { ...expandedById, [id]: !expandedById[id] };
  }

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

  // The discard confirm in Modal's footer. R36: Discard after the form's
  // Cancel ends the edit; after × or Esc it closes the panel. Cancel returns
  // focus to where it was when the confirm opened.
  let confirmDiscard = $state(false);
  let discardSource: 'cancel' | 'close' = 'close';
  let discardReturnEl: HTMLElement | null = null;

  function askDiscard(source: 'cancel' | 'close') {
    discardSource = source;
    discardReturnEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmDiscard = true;
  }

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
        if (target.kind !== 'submission' || newest == null) throw new Error('handleSave called with no submission');
        result = await createEvaluation({
          submission_id: newest.id,
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
      // Reset form/dirty state so a subsequent × Close / Escape doesn't trip the
      // dirty-guard against stale post-save form values. Re-opening [Edit] will
      // re-prefill from stateLatestEvaluation via T6's $effect.
      formResult = '';
      formScore = null;
      formFeedbackText = '';
      formFeedbackFile = null;
      fileError = null;
      prefillSnapshot = null;
      formSubmitAttempted = false;
      pushToast('Evaluation saved; group notified', 'success');
      onRefetch();
      if (submissionRunId != null && submissionMpId != null && submissionGroupId != null) {
        loadThread(submissionRunId, submissionMpId, submissionGroupId);
      }
      await tick();
      const editBtn = document.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement | null;
      editBtn?.focus();
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 409) {
        raceTransition = true;
        editing = false;
        onRefetch();
        if (submissionRunId != null && submissionMpId != null && submissionGroupId != null) {
          loadThread(submissionRunId, submissionMpId, submissionGroupId);
        }
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
      askDiscard('cancel');
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
    // × (or Esc on ×) while the confirm asks: go to its Cancel, don't ask twice.
    if (confirmDiscard) {
      discardEl?.querySelector<HTMLButtonElement>('button.cancel')?.focus();
      return;
    }
    if (isDirty) {
      askDiscard('close');
      return;
    }
    onClose();
  }

  function discard() {
    confirmDiscard = false;
    if (discardSource === 'close') {
      onClose();
      return;
    }
    editing = false;
    formResult = '';
    formScore = null;
    formFeedbackText = '';
    formFeedbackFile = null;
    fileError = null;
    prefillSnapshot = null;
    formSubmitAttempted = false;
    tick().then(() => {
      focusFirst([panelEl()?.querySelector<HTMLElement>('button[data-test="edit-evaluation"]')]);
    });
  }

  async function cancelDiscard() {
    confirmDiscard = false;
    await tick();
    focusFirst([
      discardReturnEl,
      panelEl()?.querySelector<HTMLElement>('select[name="evaluation-result"]'),
      closeX(),
    ]);
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
        // One message for every fetch error, 404 included.
        error = 'Item details unavailable. The dashboard may be out of date — close this panel and refresh the table.';
        loading = false;
      });
    return () => ctl.abort();
  });

  // Thread fetch — keyed on the gated primitive ids only (see their comment).
  // Fires once per (cell + cell-submission/eval-id state): on a genuine cell switch
  // AND when an external grid refresh lands a new submission/evaluation for the same
  // cell. `loadThread` nulls `threadState` on every fire, so a cell switch shows the
  // new cell's own optimistic newest rather than the previous cell's thread[0].
  //
  // NOTE: it deliberately does NOT reset `expandedById`. That map is keyed by
  // globally-unique submission id, so a switched-away cell's keys are inert (no other
  // cell can carry the same submission id) — while NOT clearing it is exactly what
  // makes a write survive the post-write refire without collapsing expanded history
  // (spec §6.2). Clearing it here would collapse an expanded older entry every time a
  // create write's onRefetch changes the cell's evaluation id.
  $effect(() => {
    const runId = submissionRunId;
    const mpId = submissionMpId;
    const groupId = submissionGroupId;
    // Track the cell's submission/eval ids too, so an external grid refresh that
    // changes either re-fetches the thread (see their declaration comment). `void`
    // reads register the reactive dependency without using the values.
    void submissionLatestSubId;
    void submissionLatestEvalId;
    threadCtl?.abort();
    if (runId == null || mpId == null || groupId == null) {
      threadState = null; threadLoading = false; threadError = false;
      return;
    }
    loadThread(runId, mpId, groupId);
    return () => threadCtl?.abort();
  });

  // Unmount-only cleanup for any in-flight panel fetch (mirrors the tab pattern).
  $effect(() => () => abortCtl?.abort());

  // The header: the block title (6a D6) and the group for a submission; the
  // student and "{Block} — {Sequence}" for progress, "Item details" until
  // they load, so the dialog is always named.
  const title = $derived(
    target.kind === 'submission'
      ? target.mp.block_title
      : data
        ? (data.student.full_name ?? data.student.email)
        : 'Item details',
  );
  const subtitle = $derived(
    target.kind === 'submission'
      ? target.entry.group_name
      : data
        ? `${data.sequence.block_title} — ${data.sequence.sequence_title}`
        : '',
  );
</script>

{#snippet head()}
  <div class="sp-titles">
    <h2 class="sp-title" id={titleId} tabindex="-1" bind:this={titleEl}>{title}</h2>
    {#if subtitle}<p class="sp-sub">{subtitle}</p>{/if}
  </div>
  {#if target.kind === 'submission'}
    <StatusBadge status={panelStatus} label={STATUS_SHORT_LABEL[panelStatus]} />
  {/if}
{/snippet}

{#snippet discardFooter()}
  <div class="sp-discard" bind:this={discardEl}>
    <InlineConfirm
      row
      takeFocus
      warning="Discard unsaved changes?"
      confirmLabel="Discard"
      confirmDataAction="confirm-discard"
      onConfirm={discard}
      onCancel={cancelDiscard}
    />
  </div>
{/snippet}

<Modal
  placement="right"
  width={520}
  labelledby={titleId}
  closeDisabled={submitting}
  closeTitle="Wait for the save to finish"
  bodyInert={confirmDiscard}
  autofocusSelector={'select[name="evaluation-result"], .modal-head button[aria-label="Close"]'}
  onRequestClose={tryClose}
  header={head}
  footer={confirmDiscard ? discardFooter : undefined}
>
    {#if target.kind === 'progress'}
      {#if loading}
        <p class="sp-muted">Loading…</p>
      {:else if error}
        <p class="sp-error" role="alert">{error}</p>
      {:else if data}
        {#if data.items.length === 0}
          <p class="sp-muted">No items in this sequence.</p>
        {:else}
          <ProgressBreakdown items={data.items} />
        {/if}
      {/if}
    {:else}
      {#if newest == null}
        <p>Not submitted yet.</p>
      {:else}
        {@const sub = newest}
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
          {#if sub.evaluation}
            {@const evalu = sub.evaluation}
            <!-- Occurrence (a): auto-accept eval block, now backed by newest.evaluation. -->
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
            <p>Evaluated at: {sub.evaluation ? (sub.evaluation.evaluated_at ? formatLocalWithTz(sub.evaluation.evaluated_at) : '—') : 'Just now'}</p>
            <p>Evaluated by: {sub.evaluation ? (sub.evaluation.evaluated_by?.full_name ?? sub.evaluation.evaluated_by?.user_id ?? '—') : 'You'}</p>
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

        {#if threadLoading}
          <p data-test="thread-loading">Loading previous submissions…</p>
        {:else if threadError}
          <p class="banner-error" role="alert" data-test="thread-error">
            Couldn't load submission history.
            <button type="button" data-test="thread-retry" onclick={retryThread}>Retry</button>
          </p>
        {:else if threadState && threadState.length > 1}
          <h4>Previous submissions</h4>
          <div data-test="thread-history">
            {#each threadState.slice(1) as histSub (histSub.id)}
              <SubmissionThreadEntry
                submission={histSub}
                expanded={!!expandedById[histSub.id]}
                onToggle={() => toggleThreadEntry(histSub.id)}
              />
            {/each}
          </div>
        {/if}
      {/if}
    {/if}
    <DirtyGuard isDirty={() => isDirty && !submitting} />
</Modal>

<style>
  .sp-titles { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
  .sp-title {
    margin: 0;
    font-size: 14.5px;
    font-weight: 600;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .sp-sub {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .sp-muted { margin: 0; font-size: 13px; color: var(--muted); }
  /* The 6a error banner. */
  .sp-error {
    margin: 0;
    padding: 8px 12px;
    background: var(--status-rejected-bg);
    border-left: 3px solid var(--danger);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--status-rejected-fg);
  }
  .sp-discard { flex: 1 1 auto; font-size: 13px; color: var(--text-2); }
  .banner-info {
    padding: 0.75rem 1rem;
    border-radius: 4px;
    background: #e0f2f8;
    color: #044d6c;
    border-left: 4px solid #0a7ea4;
    margin-bottom: 1rem;
  }
  .banner-error {
    padding: 0.75rem 1rem;
    border-radius: 4px;
    background: #fdecea;
    color: #611a15;
    border-left: 4px solid #c53030;
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
