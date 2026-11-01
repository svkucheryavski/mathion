<!-- frontend/src/components/runs/DashboardSidePanel.svelte -->
<!--
  The grading / progress side panel (9b): a 520px drawer on ui/Modal at the
  right edge (6c D27, R30). × and Esc close it; a click on the dimmed page
  does not (D29). The read-only cards come from SubmissionCards; one
  evaluationForm snippet serves create and edit (R43).
-->
<script lang="ts">
  import {
    getSequenceItemState,
    getSubmissionThread,
    resultToStatus,
    RESULT_LABEL,
    STATUS_SHORT_LABEL,
    type MpGroupStatus,
    type SequenceItemStateResponse,
    type DashboardMpRow,
    type DashboardMpGroupEntry,
    type ThreadSubmission,
  } from '../../lib/dashboards';
  import SubmissionThreadEntry from './SubmissionThreadEntry.svelte';
  import {
    submissionChips,
    submissionContent,
    evaluationContent,
    evaluatedLine,
    type EvaluationView,
  } from './SubmissionCards.svelte';
  import ProgressBreakdown from './ProgressBreakdown.svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import DirtyGuard from '../editor/DirtyGuard.svelte';
  import { DISCARD, DISCARD_CONTINUE } from '../../lib/editorReasons';
  import { refused, repairFocus, type GuardAsk } from '../../lib/askInPlace.svelte';
  import StatusBadge from '../ui/StatusBadge.svelte';
  import { formatFileSize } from '../../lib/format';
  import { focusFirst } from '../../lib/focusFirst';
  import { MAX_FEEDBACK_FILE_SIZE_BYTES, type EvaluationResult, createEvaluation, patchEvaluation, type Evaluation } from '../../lib/evaluations';
  import { ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { tick, untrack } from 'svelte';

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
    blockLabel = undefined,
  }: {
    target: PanelTarget;
    onClose: () => void;
    isAdmin?: boolean;
    isTeacher?: boolean;
    onRefetch?: () => void;
    // R35: the block's "B2" from the Submissions tab; none when the block is
    // not in the run's pinned version.
    blockLabel?: string;
  } = $props();

  const canWrite = $derived(isAdmin || isTeacher);
  let editing = $state(false);

  // R37: the drawn order. No result is checked until the teacher picks one.
  const RESULT_ORDER: EvaluationResult[] = ['accepted', 'minor_revision', 'major_revision', 'rejected'];
  const LOCK_TEXT = 'Without a feedback file the result can only be Accepted.';
  const SAVE_WAIT = 'Wait for the save to finish';
  // §Focus: open → the checked Result radio, else the first radio when the
  // form shows, else Modal's ×.
  const AUTOFOCUS =
    'input[name="evaluation-result"]:checked, input[name="evaluation-result"]:not(:disabled), .modal-head button[aria-label="Close"]';

  const uid = $props.id();
  const titleId = `${uid}-title`;
  let titleEl = $state<HTMLElement>();
  let discardEl = $state<HTMLElement>();
  let saveEl = $state<HTMLButtonElement>();
  let fileInputEl = $state<HTMLInputElement>();
  // P49: Modal owns the panel and ×; the panel finds them from its title.
  const panelEl = () => titleEl?.closest<HTMLElement>('.modal-panel') ?? null;
  const find = <T extends HTMLElement>(sel: string) => panelEl()?.querySelector<T>(sel) ?? null;
  const closeX = () => find<HTMLButtonElement>('.modal-head button[aria-label="Close"]');
  const editBtn = () => find<HTMLButtonElement>('button[data-test="edit-evaluation"]');
  const evalHead = () => document.getElementById(`${uid}-eval`);
  const checkedRadio = () => find<HTMLInputElement>('input[name="evaluation-result"]:checked');
  const acceptedRadio = () => find<HTMLInputElement>('input[name="evaluation-result"][value="accepted"]');

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
  // P52: set by a 409; the winning evaluation's <h3> takes focus when it renders.
  let raceFocusPending = false;

  // Captured when Edit is clicked. The dirty check compares the form against
  // it, so a clean just-opened edit is NOT dirty. `null` means create mode.
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
  // refire and fetches once more on top of the manual refetch; this is benign
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
        const wasForm = formShown;
        threadState = res.submissions;
        threadLoading = false;
        // F9: the thread can swap a focused create form for the evaluation card.
        void tick().then(() => { if (wasForm && !formShown) void repairFocus(evalHead(), closeX()); });
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

  async function retryThread() {
    if (submissionRunId != null && submissionMpId != null && submissionGroupId != null) {
      loadThread(submissionRunId, submissionMpId, submissionGroupId);
    }
    // §Focus: Retry leaves with the error line; the panel title takes focus.
    await tick();
    focusFirst([titleEl]);
  }

  function toggleThreadEntry(id: number) {
    expandedById = { ...expandedById, [id]: !expandedById[id] };
  }

  const existingHasFeedbackFile = $derived(effectiveEvaluation?.has_feedback_file ?? false);
  const resultLocked = $derived(editing && effectiveEvaluation != null && !effectiveEvaluation.has_feedback_file);

  $effect(() => {
    if (effectiveEvaluation == null) return;
    raceTransition = false;
    if (!raceFocusPending) return;
    raceFocusPending = false;
    // P52: move to the winning card unless the teacher has moved on from ×.
    tick().then(() => {
      const active = document.activeElement;
      if (active === document.body || active === closeX()) focusFirst([evalHead()]);
    });
  });

  // The evaluation the edit form was filled from; null when not editing.
  let filledId: number | null = null;
  // C18: `effectiveEvaluation` changes identity on every grid Refresh. The form
  // re-fills only when editing starts, the evaluation's id changes, or it is
  // clean — read untracked, so typing does not re-run this effect.
  $effect(() => {
    const ev = effectiveEvaluation;
    if (!editing || !ev) { if (!editing) filledId = null; return; }
    const starting = filledId === null;
    if (!starting && ev.id === filledId && untrack(() => isDirty)) return;
    filledId = ev.id;
    formResult = ev.result as EvaluationResult;
    formScore = ev.score;
    formFeedbackText = ev.feedback_text ?? '';
    formFeedbackFile = null;
    fileError = null;
    prefillSnapshot = {
      result: ev.result as EvaluationResult,
      score: ev.score,
      feedback_text: ev.feedback_text ?? '',
    };
    // §Focus: Edit → the checked Result radio (Accepted when locked); never on a re-fill.
    if (starting) tick().then(() => focusFirst([checkedRadio(), acceptedRadio()]));
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

  // The form is on screen exactly when the template renders `evaluationForm`.
  // Edits left in state after the form went away (a 409 race, a stale cell)
  // are not on screen, so closing must not ask about them: the confirm lives
  // in the form and would never show (rev 8).
  const formShown = $derived(
    target.kind === 'submission' &&
      newest != null &&
      !newest.is_resubmission &&
      canWrite &&
      (effectiveEvaluation ? editing : !raceTransition),
  );
  const dirtyOnScreen = $derived(formShown && isDirty);

  // The discard confirm replaces the form's button row (user, 6c Safari pass:
  // the drawer's footer sat at the screen's bottom edge, far from the form).
  // R36: Discard after the form's Cancel ends the edit; after × or Esc it
  // closes the panel. Cancel returns focus to where it was when the confirm
  // opened. While it asks, the rest of the drawer body is inert (`freeze`).
  let confirmDiscard = $state(false);
  // Polish 1 (D37): a navigation asks here too ('nav') and waits on the answer.
  let navAnswer: ((ok: boolean) => void) | null = null;
  function answerNav(ok: boolean) {
    const r = navAnswer;
    navAnswer = null;
    r?.(ok);
  }
  // The confirm lives in the form: when the form goes (a thread load brings an
  // evaluation), the question goes with it and the body thaws. A waiting
  // navigation is cancelled (R55).
  $effect(() => {
    if (!formShown && confirmDiscard) {
      confirmDiscard = false;
      answerNav(false);
    }
  });
  let discardSource = $state<'cancel' | 'close' | 'nav'>('close');
  let discardReturnEl: HTMLElement | null = null;

  function focusDiscardCancel() {
    const c = discardEl?.querySelector<HTMLButtonElement>('button.cancel');
    c?.closest('.inline-confirm')?.scrollIntoView?.({ block: 'nearest' });
    c?.focus();
  }

  // DirtyGuard's `ask`. While the form's Cancel or × question is open, a
  // navigation is refused and focus goes back to that question (R53).
  function askNav(): GuardAsk {
    if (confirmDiscard) {
      focusDiscardCancel();
      return refused();
    }
    askDiscard('nav');
    const promise = new Promise<boolean>((r) => { navAnswer = r; });
    return {
      promise,
      dismiss: () => {
        if (!navAnswer) return;
        confirmDiscard = false;
        answerNav(false);
      },
      focusCancel: focusDiscardCancel,
    };
  }

  function askDiscard(source: 'cancel' | 'close' | 'nav') {
    discardSource = source;
    // Safari does not focus a clicked button or radio: focus stays on <body> or
    // moves to the drawer's own panel (tabindex -1). Neither is a return target.
    const active = document.activeElement;
    const container = active === document.body || active?.matches('section.modal-panel');
    discardReturnEl = active instanceof HTMLElement && !container ? active : null;
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

  // Save's reason while it is disabled; the first match wins.
  const saveTitle = $derived(
    formResult === ''
      ? 'Choose a result'
      : errors.score
        ? 'Score must be a whole number between 0 and 100'
        : errors.feedbackText
          ? 'Write feedback for a non-accepted result'
          : errors.feedbackFile
            ? 'Attach the feedback PDF'
            : undefined,
  );

  const resultDescribedby = $derived(
    [errors.result ? 'evaluation-result-error' : null, resultLocked ? 'evaluation-result-lock' : null]
      .filter(Boolean)
      .join(' ') || undefined,
  );

  function resetForm() {
    formResult = '';
    formScore = null;
    formFeedbackText = '';
    formFeedbackFile = null;
    fileError = null;
    prefillSnapshot = null;
    formSubmitAttempted = false;
  }

  // §Focus: after a save, an edit's Cancel or a Discard from Cancel.
  async function focusAfterEdit() {
    await tick();
    focusFirst([editBtn(), evalHead()]);
  }

  function firstErroredField(): HTMLElement | null {
    if (errors.result) return find('input[name="evaluation-result"]:not(:disabled)');
    if (errors.score) return find('#evaluation-score');
    if (errors.feedbackText) return find('#evaluation-feedback');
    if (errors.feedbackFile) return find('[data-action="attach-feedback-file"]');
    return null;
  }

  async function handleSave() {
    formSubmitAttempted = true; // surfaces errors.result = 'Result is required.' if blank
    // R44: a second submit while saving does nothing.
    if (!valid || submitting) return;
    submitting = true;
    serverError = null;
    submitController = new AbortController();
    timeoutHandle = setTimeout(() => submitController?.abort('timeout'), SUBMIT_TIMEOUT_MS);
    let outcome: 'saved' | 'race' | 'failed' = 'failed';
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
      // Reset form/dirty state so a later × or Esc doesn't trip the dirty
      // check against stale post-save values. Edit re-prefills from the bridge.
      resetForm();
      pushToast('Evaluation saved; group notified', 'success');
      onRefetch();
      if (submissionRunId != null && submissionMpId != null && submissionGroupId != null) {
        loadThread(submissionRunId, submissionMpId, submissionGroupId);
      }
      outcome = 'saved';
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 409) {
        raceTransition = true;
        editing = false;
        // The lost edits go too: a later resubmission's create form starts empty.
        resetForm();
        raceFocusPending = true;
        onRefetch();
        if (submissionRunId != null && submissionMpId != null && submissionGroupId != null) {
          loadThread(submissionRunId, submissionMpId, submissionGroupId);
        }
        outcome = 'race';
      } else if ((e as { name?: string })?.name === 'AbortError') {
        const reason = (submitController?.signal as AbortSignal & { reason?: unknown })?.reason;
        // A user cancel reverts silently; a timeout says so.
        if (reason === 'timeout') serverError = 'Upload timed out. Try again.';
      } else if (e instanceof ApiError) {
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
    // §Focus, after the un-freeze: Edit (else the Evaluation <h3>) after a
    // save; the <h3> (else ×) after a 409; the first errored field (else Save
    // evaluation) after a failure or a cancelled upload.
    await tick();
    if (outcome === 'saved') focusFirst([editBtn(), evalHead()]);
    else if (outcome === 'race') focusFirst([evalHead(), closeX()]);
    else focusFirst([firstErroredField(), saveEl]);
  }

  function startEdit() {
    raceFocusPending = false;
    editing = true;
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
    resetForm();
    void focusAfterEdit();
  }

  function tryClose() {
    if (submitting) return;
    // × (or Esc on ×) while the confirm asks: go to its Cancel, don't ask twice.
    if (confirmDiscard) {
      focusDiscardCancel();
      return;
    }
    if (dirtyOnScreen) {
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
    resetForm();
    // A navigation goes ahead; its target takes focus.
    if (discardSource === 'nav') {
      answerNav(true);
      return;
    }
    void focusAfterEdit();
  }

  async function cancelDiscard() {
    confirmDiscard = false;
    answerNav(false);
    await tick();
    focusFirst([discardReturnEl, find<HTMLButtonElement>('button[data-test="cancel-button"]'), checkedRadio(), closeX()]);
  }

  // The attribute, not the property: jsdom lacks `inert`.
  const freeze = (el: HTMLElement) => { el.toggleAttribute('inert', confirmDiscard); };

  async function handleFileChange(e: Event) {
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
    // §Focus: a chosen file → its remove ×.
    await tick();
    focusFirst([find('[data-action="remove-feedback-file"]')]);
  }

  async function removeFile() {
    formFeedbackFile = null;
    fileError = null;
    if (fileInputEl) fileInputEl.value = '';
    // §Focus: remove → "attach PDF".
    await tick();
    focusFirst([find('[data-action="attach-feedback-file"]')]);
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

  // The header: the block title (6a D6) and "{Group} · B2" for a submission;
  // the student and "{Block} — {Sequence}" for progress, "Item details" until
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
      ? (blockLabel ? `${target.entry.group_name} · ${blockLabel}` : target.entry.group_name)
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

{#snippet discardRow()}
  <div class="sp-discard" bind:this={discardEl}>
    <InlineConfirm
      row
      takeFocus
      warning={discardSource === 'nav' ? DISCARD_CONTINUE : DISCARD}
      confirmLabel="Discard"
      confirmDataAction="confirm-discard"
      onConfirm={discard}
      onCancel={cancelDiscard}
    />
  </div>
{/snippet}

{#snippet evaluationCard(ev: EvaluationView, evaluated: string, withEdit: boolean)}
  <section class="sp-card" aria-labelledby="{uid}-eval" data-test="evaluation-card">
    <div class="sp-card-head">
      <h3 class="sp-h" id="{uid}-eval" tabindex="-1">Evaluation</h3>
      {#if withEdit}
        <Button variant="secondary" data-test="edit-evaluation" onclick={startEdit}>Edit</Button>
      {/if}
    </div>
    <div class="sp-card-body">{@render evaluationContent(ev, evaluated)}</div>
  </section>
{/snippet}

{#snippet evaluationForm(mode: 'create' | 'edit')}
  {@const requiredHint = formResult === 'accepted' ? '(optional)' : '(required)'}
  <section class="sp-card sp-evaluate" aria-labelledby="{uid}-form">
    <div class="sp-card-head sp-evaluate-head">
      <h3 class="sp-h" id="{uid}-form">Evaluate</h3>
    </div>
    <form class="sp-form" aria-label="Write evaluation" onsubmit={(e) => { e.preventDefault(); void handleSave(); }}>
      <fieldset
        id="evaluation-result"
        class="sp-result"
        role="radiogroup"
        aria-required="true"
        aria-describedby={resultDescribedby}
        disabled={submitting}
        {@attach freeze}
      >
        <legend class="sp-legend">Result <span class="sp-hint">(required)</span></legend>
        <div class="sp-seg">
          {#each RESULT_ORDER as r (r)}
            {@const locked = resultLocked && r !== 'accepted'}
            <label class="sp-seg-opt" class:checked={formResult === r} class:locked title={locked ? LOCK_TEXT : undefined}>
              <input
                class="sp-radio"
                type="radio"
                name="evaluation-result"
                value={r}
                bind:group={formResult}
                disabled={locked}
                title={locked ? LOCK_TEXT : undefined}
              />
              <span>{RESULT_LABEL[r]}</span>
            </label>
          {/each}
        </div>
        {#if errors.result}<p class="sp-field-err" id="evaluation-result-error" role="alert">{errors.result}</p>{/if}
        {#if resultLocked}<p class="sp-lock" id="evaluation-result-lock">{LOCK_TEXT}</p>{/if}
      </fieldset>

      <div class="sp-fields" {@attach freeze}>
        <div class="sp-field">
          <label class="sp-label" for="evaluation-feedback">Feedback <span class="sp-hint">{requiredHint}</span></label>
          <textarea
            id="evaluation-feedback"
            name="evaluation-feedback"
            class="sp-textarea"
            maxlength="1000"
            readonly={submitting}
            bind:value={formFeedbackText}
            aria-invalid={errors.feedbackText ? 'true' : undefined}
            aria-describedby={errors.feedbackText ? 'evaluation-feedback-count evaluation-feedback-error' : 'evaluation-feedback-count'}
          ></textarea>
          <span id="evaluation-feedback-count" class="sp-count" data-test="feedback-counter-visible">
            {feedbackCharCount} / 1000{#if counterApproaching}<strong> — approaching limit</strong>{/if}
          </span>
          <span class="sp-sr" data-test="feedback-counter-live" aria-live="polite">{announcedCounter}</span>
          {#if errors.feedbackText}<p class="sp-field-err" id="evaluation-feedback-error" role="alert">{errors.feedbackText}</p>{/if}
        </div>
        <div class="sp-field">
          <label class="sp-label" for="evaluation-score">Score <span class="sp-hint">(optional, 0–100)</span></label>
          <input
            id="evaluation-score"
            name="evaluation-score"
            class="sp-input"
            type="number"
            min="0"
            max="100"
            step="1"
            readonly={submitting}
            value={formScore ?? ''}
            oninput={(e) => {
              const v = e.currentTarget.value;
              formScore = v === '' ? null : Number(v);
            }}
            aria-invalid={errors.score ? 'true' : undefined}
            aria-describedby={errors.score ? 'evaluation-score-error' : undefined}
          />
          {#if errors.score}<p class="sp-field-err" id="evaluation-score-error" role="alert">{errors.score}</p>{/if}
        </div>
      </div>

      {#if serverError}<p class="sp-error form-error" role="alert">{serverError}</p>{/if}

      <div class="sp-bottom" {@attach freeze}>
        <!-- The file control is inert while a save runs (the attribute, not the
             property: jsdom lacks `inert`). -->
        <div class="sp-file-ctl" {@attach (el) => { el.toggleAttribute('inert', submitting); }}>
          {#if mode === 'create'}
            <span class="sp-file-line">
              <span id="{uid}-file-label">Feedback file <span class="sp-hint">{requiredHint}</span></span>
              {#if formFeedbackFile}
                <span class="sp-chosen">
                  <span class="sp-chosen-name">{formFeedbackFile.name}</span>
                  <span class="sp-chosen-size">· {formatFileSize(formFeedbackFile.size)}</span>
                  <IconButton
                    glyph="close"
                    size="sm"
                    borderless
                    title="Remove {formFeedbackFile.name}"
                    data-action="remove-feedback-file"
                    onclick={removeFile}
                  />
                </span>
              {:else}
                <span aria-hidden="true">—</span>
                <button
                  type="button"
                  class="sp-link"
                  data-action="attach-feedback-file"
                  aria-describedby="{uid}-file-label {uid}-file-help"
                  onclick={() => fileInputEl?.click()}
                >attach PDF</button>
              {/if}
            </span>
            <input
              bind:this={fileInputEl}
              id="evaluation-file"
              name="evaluation-file"
              type="file"
              accept=".pdf,application/pdf"
              hidden
              onchange={handleFileChange}
            />
            <span class="sp-help" id="{uid}-file-help">PDF only, max 20 MB.</span>
            {#if errors.feedbackFile}<p class="sp-field-err" role="alert">{errors.feedbackFile}</p>{/if}
          {:else if existingHasFeedbackFile}
            <p class="sp-muted">The feedback file cannot be replaced.</p>
          {/if}
        </div>
        {#if !confirmDiscard}
        <div class="sp-actions">
          {#if editing || submitting}
            <Button variant="secondary" data-test="cancel-button" onclick={handleCancel}>{submitting ? 'Cancel upload' : 'Cancel'}</Button>
          {/if}
          <Button
            type="submit"
            bind:element={saveEl}
            loading={submitting}
            aria-disabled={submitting}
            disabled={!valid && !submitting}
            title={submitting ? SAVE_WAIT : saveTitle}
          >{submitting ? 'Saving…' : 'Save'}</Button>
        </div>
        {/if}
      </div>
      {#if confirmDiscard}{@render discardRow()}{/if}
    </form>
  </section>
{/snippet}

<Modal
  placement="right"
  width={520}
  labelledby={titleId}
  closeDisabled={submitting}
  closeTitle={SAVE_WAIT}
  autofocusSelector={AUTOFOCUS}
  onRequestClose={tryClose}
  header={head}
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
  {:else if newest == null}
    <p class="sp-muted">Not submitted yet.</p>
  {:else}
    {@const sub = newest}
    <section class="sp-card" aria-labelledby="{uid}-latest" {@attach freeze}>
      <div class="sp-card-head">
        <h3 class="sp-h" id="{uid}-latest">Latest submission</h3>
        {@render submissionChips(sub)}
      </div>
      <div class="sp-card-body">{@render submissionContent(sub)}</div>
    </section>

    {#if sub.is_resubmission}
      <p class="sp-info banner-info" role="status">Auto-accepted on resubmission. No manual evaluation needed.</p>
      {#if sub.evaluation}
        {@render evaluationCard(sub.evaluation, evaluatedLine(sub.evaluation), false)}
      {/if}
    {:else if effectiveEvaluation && !editing}
      {@render evaluationCard(
        effectiveEvaluation,
        sub.evaluation ? evaluatedLine(sub.evaluation) : 'You · Just now',
        canWrite,
      )}
    {:else if effectiveEvaluation && canWrite}
      {@render evaluationForm('edit')}
    {:else if !effectiveEvaluation && canWrite && !raceTransition}
      {@render evaluationForm('create')}
    {:else}
      <p class="sp-muted" data-test="awaiting-evaluation-placeholder">Awaiting evaluation</p>
    {/if}

    {#if threadLoading}
      <p class="sp-muted" data-test="thread-loading">Loading earlier submissions…</p>
    {:else if threadError}
      <p class="sp-error" role="alert" data-test="thread-error" {@attach freeze}>
        Couldn't load submission history.
        <button type="button" class="sp-link" data-test="thread-retry" onclick={retryThread}>Retry</button>
      </p>
    {:else if threadState && threadState.length > 1}
      <section class="sp-card" aria-labelledby="{uid}-earlier" {@attach freeze}>
        <div class="sp-card-head">
          <h3 class="sp-h" id="{uid}-earlier">Earlier submissions</h3>
          <span class="sp-count-n">{threadState.length - 1}</span>
        </div>
        <div data-test="thread-history">
          {#each threadState.slice(1) as histSub (histSub.id)}
            <SubmissionThreadEntry
              submission={histSub}
              expanded={!!expandedById[histSub.id]}
              onToggle={() => toggleThreadEntry(histSub.id)}
            />
          {/each}
        </div>
      </section>
    {/if}
  {/if}
  <DirtyGuard isDirty={() => dirtyOnScreen && !submitting} ask={askNav} />
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
  /* The 6a error and info banners. */
  .sp-error {
    margin: 0;
    padding: 8px 12px;
    background: var(--danger-panel-bg);
    border-left: 3px solid var(--danger);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--danger-panel-fg);
  }
  .sp-info {
    margin: 0;
    padding: 8px 12px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--text-2);
  }
  .sp-link {
    padding: 0;
    border: 0;
    background: transparent;
    font: inherit;
    color: var(--primary);
    text-decoration: underline;
    cursor: pointer;
  }
  .sp-discard { padding-top: 10px; border-top: 1px solid var(--border); font-size: 13px; color: var(--text-2); }

  /* Cards (9b): a --surface-2 head strip holding an <h3>. */
  .sp-card {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface);
  }
  .sp-card-head {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 12px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .sp-h {
    flex: 1 1 auto;
    margin: 0;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
  }
  .sp-card-body { display: flex; flex-direction: column; gap: 8px; padding: 12px; }
  .sp-count-n { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); }

  /* The Evaluate card: a --primary border with a --primary-soft halo and head. */
  .sp-evaluate {
    border: 1.5px solid var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft);
  }
  .sp-evaluate-head { background: var(--primary-soft); }
  .sp-form { display: flex; flex-direction: column; gap: 10px; padding: 12px; }

  /* R37: four native radios drawn as a segmented control. */
  .sp-result { min-width: 0; margin: 0; padding: 0; border: 0; }
  .sp-legend { margin: 0 0 6px; padding: 0; font-size: 12.5px; font-weight: 500; color: var(--text-3); }
  .sp-hint { font-weight: 400; color: var(--muted); }
  .sp-seg {
    display: flex;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .sp-seg-opt {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3px 0;
    font-size: 12.5px;
    color: var(--muted);
    background: var(--surface);
    border-left: 1px solid var(--border);
    cursor: pointer;
  }
  .sp-seg-opt:first-child { border-left: 0; }
  .sp-seg-opt.checked {
    color: var(--text);
    font-weight: 500;
    background: var(--primary-soft);
  }
  .sp-seg-opt.locked { color: var(--faint); cursor: not-allowed; }
  .sp-seg-opt:has(.sp-radio:focus-visible) { box-shadow: inset 0 0 0 2px var(--primary); }
  /* The radio is hidden with clip(), which clips its outline too. */
  @media (forced-colors: active) {
    .sp-seg-opt:has(.sp-radio:focus-visible) { outline: 2px solid Highlight; outline-offset: -2px; }
  }
  .sp-radio {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  .sp-lock { margin: 6px 0 0; font-size: 12px; color: var(--muted); }

  /* P53: top-aligned, so an error or the counter under Feedback leaves Score in place. */
  .sp-fields {
    display: grid;
    grid-template-columns: 1fr 96px;
    gap: 12px;
    align-items: start;
  }
  @media (max-width: 480px) {
    .sp-fields { grid-template-columns: 1fr; }
  }
  .sp-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .sp-label { font-size: 12.5px; font-weight: 500; color: var(--text-3); }
  .sp-textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 54px;
    padding: var(--control-pad-textarea);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--text-2);
    resize: vertical;
  }
  .sp-textarea[aria-invalid='true'] { border-color: var(--danger); }
  .sp-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    font-family: var(--font-mono);
    font-size: var(--control-font);
    color: var(--text);
  }
  .sp-input[aria-invalid='true'] { border-color: var(--danger); }
  .sp-count { font-size: 11.5px; color: var(--muted); }
  .sp-field-err { margin: 0; font-size: 12px; color: var(--danger); }
  .sp-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  /* The bottom row: the feedback-file control left, Save right. */
  .sp-bottom { display: flex; align-items: center; gap: 9px; }
  .sp-file-ctl {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
    font-size: 12.5px;
    color: var(--muted);
  }
  .sp-file-line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .sp-chosen { display: inline-flex; align-items: center; gap: 4px; min-width: 0; color: var(--text); }
  .sp-chosen-name { overflow-wrap: anywhere; }
  .sp-chosen-size { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); }
  .sp-help { font-size: 11.5px; color: var(--muted); }
  .sp-actions { display: flex; align-items: center; gap: 9px; margin-left: auto; }
</style>
