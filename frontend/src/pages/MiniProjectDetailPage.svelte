<script lang="ts">
  // MiniProjectDetailPage — student-facing detail page (Tasks D5 + D6).
  //
  // D5 owns: page-mount sequencing (parallel loadCourse + fetchDetail),
  // header (breadcrumb + H1 + StatusPill + deadline summary), assignment
  // {@html} block with rewriteExternalLinks effect (L1/M1/M7), group context
  // (3 branches per spec §6 step 3 — D4 + F10), submission history block
  // (DESC, D15 Late-pill sibling-of-h3), and fetch-error full-page banner
  // (spec §6 step 7 — 403 / 404 / generic).
  //
  // D6 owns: submit / resubmit section, the 4-state submit machine (C15),
  // client-side guard rails (.pdf + MAX_FILE_SIZE), error mapping per status
  // (400 / 401 / 403 / 409 / 503 / network), visibilitychange refetch with
  // single-flight gate (spec §6 step 6), write-back into
  // currentCourse.miniProjectsByBlockId guarded by the slug snapshot (F6),
  // and the sr-only aria-live status announcer rendered OUTSIDE the
  // {#if isLoading}/{#if data} branching for stable DOM identity (C16).
  //
  // Spec: docs/superpowers/specs/2026-06-15-mp-in-blocks-design.md §6.

  import { ApiError } from '../lib/api';
  import {
    fetchDetail,
    rewriteExternalLinks,
    submit,
    LATEST_STATUS_META,
    REASON_LABELS,
    MAX_FILE_SIZE,
  } from '../lib/studentMiniProjects';
  import type { StudentMiniProjectDetail } from '../lib/types';
  import StatusPill from '../components/course/StatusPill.svelte';
  import { currentCourse, loadCourse } from '../stores/currentCourse.svelte';
  import { pushToast } from '../stores/toasts.svelte';
  import { navigate } from '../lib/router.svelte';
  import { formatLocalWithTz } from '../lib/datetime';
  import { formatFileSize } from '../lib/format';

  let { courseSlug, blockSlug }: { courseSlug: string; blockSlug: string } = $props();

  let data: StudentMiniProjectDetail | null = $state(null);
  // N4 — `$state()` with no arg per RunTeachersTab.svelte:20 precedent.
  let assignmentEl: HTMLDivElement | undefined = $state();
  let fetchError: ApiError | null = $state(null);
  let isLoading = $state(true);

  // D6 — submit-flow state machine (decision C15). 4 explicit states:
  // 'idle' (default), 'submitting' (POST in flight; controls disabled),
  // 'error' (banner shown; file kept for retry-without-re-pick),
  // 'success' (no banner; next file pick → 'idle').
  type SubmitState = 'idle' | 'submitting' | 'error' | 'success';
  let submitState: SubmitState = $state('idle');
  let selectedFile: File | null = $state(null);
  let submitErrorMessage: string | null = $state(null);
  // Drives the Retry button on network/503 banners.
  let submitErrorIsNetwork = $state(false);

  // Single-flight guard shared by initial load + visibility-driven refetches.
  // The spec mandates "skip if already fetching" (line 805) — using one flag
  // means an in-flight visibility refetch can't race the initial mount fetch,
  // and a focus burst can't fan out to multiple requests.
  let refetchInFlight = false;

  // Shared refetch helper — used by the initial-load $effect AND by the
  // submit handler's success/409 paths AND by the visibilitychange listener.
  // Stale-write guarded against slug changes and the AbortController. Sets
  // the shared `refetchInFlight` single-flight gate so a second visibility
  // event mid-fetch is a no-op.
  function refetchDetail(
    startedCourseSlug: string,
    startedBlockSlug: string,
    controller: AbortController,
    options: { onLoadingDone?: boolean } = {},
  ): Promise<void> {
    refetchInFlight = true;
    return fetchDetail(startedCourseSlug, startedBlockSlug)
      .then((res) => {
        if (startedCourseSlug !== courseSlug || startedBlockSlug !== blockSlug) return;
        if (controller.signal.aborted) return;
        data = res;
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (startedCourseSlug !== courseSlug || startedBlockSlug !== blockSlug) return;
        if (e instanceof DOMException && e.name === 'AbortError') return;
        if (e instanceof ApiError) {
          if (e.status === 401) return; // emitUnauthorized handled by api.ts
          fetchError = e;
          return;
        }
        // Network / unexpected — surface as a synthetic 0 so the banner falls
        // through to the generic copy.
        fetchError = new ApiError(0, 'Network error');
      })
      .finally(() => {
        refetchInFlight = false;
        if (!options.onLoadingDone) return;
        if (controller.signal.aborted) return;
        if (startedCourseSlug !== courseSlug || startedBlockSlug !== blockSlug) return;
        isLoading = false;
      });
  }

  // Prop-reactive load: `$effect` re-runs whenever `courseSlug` or `blockSlug`
  // changes (router preserves the component instance across same-page route
  // changes — onMount would only fire once and miss the new slugs). Plan
  // line 1541 mandates `$effect` for this initial-load wiring.
  $effect(() => {
    // Snapshot BOTH slugs at effect start — stale-write guard for any
    // in-flight response that lands after a navigation. Mirrors
    // stores/currentCourse.svelte.ts:53.
    const startedCourseSlug = courseSlug;
    const startedBlockSlug = blockSlug;
    const controller = new AbortController();

    // Reset loading flag on every run so a navigation between MP pages
    // shows the loading state again.
    isLoading = true;
    data = null;
    fetchError = null;

    // Fire both fetches in parallel; they're independent.
    // - loadCourse: breadcrumb context only. Non-fatal — toast on hard errors,
    //   silent on AbortError, let auth-bounce propagate via emitUnauthorized.
    // - fetchDetail: page body. Hard error → fetchError full-page banner.
    void loadCourse(startedCourseSlug).catch((e: unknown) => {
      // Drop stale toast: navigation past this fetch (slug change or unmount).
      // Without this guard, same-course block navigation attaches a second
      // .catch to the shared in-flight promise → duplicate toasts on failure.
      if (controller.signal.aborted) return;
      if (startedCourseSlug !== courseSlug || startedBlockSlug !== blockSlug) return;
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (e instanceof ApiError && e.status === 401) return; // auth bounce
      pushToast("Couldn't load course details.", 'error');
    });

    void refetchDetail(startedCourseSlug, startedBlockSlug, controller, { onLoadingDone: true });

    // D6 — visibilitychange refetch (spec §6 step 6). When the tab is
    // brought back into focus, re-pull the detail so a stale page doesn't
    // miss a teacher's just-pushed evaluation. Single-flight via
    // `refetchInFlight` (the shared gate the initial fetch above already
    // toggled).
    const onVisChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (refetchInFlight) return;
      if (startedCourseSlug !== courseSlug || startedBlockSlug !== blockSlug) return;
      void refetchDetail(startedCourseSlug, startedBlockSlug, controller);
    };
    document.addEventListener('visibilitychange', onVisChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisChange);
      controller.abort();
    };
  });

  // L1/M7 — link rewriter effect. `void data.assignment_html;` tracks the
  // assignment_html dep without using the value (M7 idiom — precedent at
  // ItemEditPage.svelte:238). assignmentEl is bound on the SAME div as
  // {@html}, so by the time this effect fires the anchors exist in the DOM.
  $effect(() => {
    if (!assignmentEl || !data) return;
    void data.assignment_html;
    rewriteExternalLinks(assignmentEl);
  });

  // D16 — empty/whitespace block_title falls back to "Untitled block".
  const titleForHeading = $derived.by(() => {
    if (!data) return '';
    return data.block_title.trim() || 'Untitled block';
  });

  // Deadline summary text. Resubmission deadline takes prominence when the
  // student is in a revision state. Hard deadline shows relative-days
  // (forward/passed). Soft deadline appears inline in parentheses.
  //
  // IMPORTANT: branch on the RAW millisecond diff sign BEFORE rounding —
  // `Math.round(-1h / 24h)` is `-0` which compares `>= 0` and would
  // mislabel a deadline 1 hour ago as "0 days remaining" instead of
  // "passed 0 days ago".
  function formatRelativeDeadline(iso: string): string {
    const formatted = formatLocalWithTz(iso);
    const diffMs = new Date(iso).getTime() - Date.now();
    const dayMs = 86_400_000;
    if (diffMs >= 0) {
      const days = Math.round(diffMs / dayMs);
      return `${formatted} — ${days} day${days === 1 ? '' : 's'} remaining`;
    }
    const passed = Math.round(-diffMs / dayMs);
    return `${formatted} — passed ${passed} day${passed === 1 ? '' : 's'} ago`;
  }

  // Fetch-error banner copy — spec §6 step 7.
  const fetchErrorMessage = $derived.by(() => {
    if (!fetchError) return null;
    if (fetchError.status === 403) {
      return 'This mini-project is no longer accessible. The run may have been closed.';
    }
    if (fetchError.status === 404) {
      return "This mini-project doesn't exist or has been unpublished.";
    }
    return "Couldn't load mini-project.";
  });

  // Group member ordering: current user always first, labelled "(you)".
  const orderedMembers = $derived.by(() => {
    if (!data?.group) return [];
    const members = data.group.members;
    const me = members.find((m) => m.is_me);
    const others = members.filter((m) => !m.is_me);
    return me ? [me, ...others] : [...members];
  });

  // Maps the 4-value evaluation `result` literal to its student-facing
  // label. LATEST_STATUS_META is the single source of truth for status copy
  // (rejected / major_revision / minor_revision / accepted keys all exist
  // in the meta map).
  type EvalResult = 'rejected' | 'major_revision' | 'minor_revision' | 'accepted';
  function evaluationResultLabel(result: EvalResult): string {
    return LATEST_STATUS_META[result].label;
  }

  // ---- D6 — submit flow ----

  // Heading copy switches when the student is in a revision state — the
  // existing submissions are still in history, so "Submit revision" reads
  // more honestly than "Submit".
  const submitHeading = $derived.by(() => {
    if (!data) return 'Submit';
    if (data.latest_status === 'major_revision' || data.latest_status === 'minor_revision') {
      return 'Submit revision';
    }
    return 'Submit';
  });

  const canSubmitClick = $derived.by(() => {
    return selectedFile !== null && submitState !== 'submitting';
  });

  function handleFileChange(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files && input.files.length > 0 ? input.files[0] : null;
    selectedFile = f;
    // Spec line 781: picking a new file in 'error' does NOT clear the banner
    // or change state — the student may want to retry with the same file
    // after seeing the error. Only the transition out of 'success' is here.
    if (submitState === 'success') submitState = 'idle';
  }

  async function handleSubmit(): Promise<void> {
    if (!data) return;
    if (selectedFile === null) return;

    // Client-side guard rails. Backend is the source of truth; these checks
    // simply avoid a round-trip for the obvious cases.
    const file = selectedFile;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      submitErrorMessage = 'Only PDF files are accepted.';
      submitErrorIsNetwork = false;
      submitState = 'error';
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      submitErrorMessage = 'File too large — 20 MB maximum.';
      submitErrorIsNetwork = false;
      submitState = 'error';
      return;
    }

    submitState = 'submitting';
    submitErrorMessage = null;
    submitErrorIsNetwork = false;

    const startedCourseSlug = courseSlug;
    const startedBlockSlug = blockSlug;
    const mpId = data.mp_id;

    try {
      await submit(mpId, file);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.status === 401) {
          // Auth bounce already emitted by the wire layer; no banner.
          return;
        }
        if (e.status === 409) {
          // Spec line 794 — race: refetch detail, transition to idle so the
          // freshly-loaded state drives the next decision.
          submitErrorMessage = 'Submission state changed — refreshing.';
          submitErrorIsNetwork = false;
          submitState = 'error';
          // Kick a refetch; on success, drop back to idle so the banner clears.
          const controller = new AbortController();
          void refetchDetail(startedCourseSlug, startedBlockSlug, controller).then(() => {
            if (startedCourseSlug !== courseSlug || startedBlockSlug !== blockSlug) return;
            submitErrorMessage = null;
            submitState = 'idle';
          });
          return;
        }
        if (e.status === 403) {
          submitErrorMessage = 'Permission lost — refresh.';
          submitErrorIsNetwork = false;
          submitState = 'error';
          return;
        }
        if (e.status === 400) {
          submitErrorMessage = typeof e.detail === 'string' ? e.detail : e.displayMessage;
          submitErrorIsNetwork = false;
          submitState = 'error';
          return;
        }
        if (e.status === 503) {
          submitErrorMessage = "Couldn't submit — retry?";
          submitErrorIsNetwork = true;
          submitState = 'error';
          return;
        }
        // Other 4xx/5xx — backend copy.
        submitErrorMessage = e.displayMessage;
        submitErrorIsNetwork = false;
        submitState = 'error';
        return;
      }
      // Non-ApiError (network / AbortError / unexpected).
      if (e instanceof DOMException && e.name === 'AbortError') {
        // Page tearing down — leave state alone, the unmount cleanup handles it.
        return;
      }
      submitErrorMessage = "Couldn't submit — retry?";
      submitErrorIsNetwork = true;
      submitState = 'error';
      return;
    }

    // 201 — success. Refetch the detail, then write back into the course
    // snapshot for the block-link cache (F6 slug guard).
    submitState = 'success';
    const controller = new AbortController();
    await refetchDetail(startedCourseSlug, startedBlockSlug, controller);
    if (startedCourseSlug !== courseSlug || startedBlockSlug !== blockSlug) return;
    const fresh = data;
    if (fresh !== null) {
      // F6: only write back when the visible store still matches the course
      // the page was mounted on; the user may have switched courses mid-flight.
      if (currentCourse.value !== null && currentCourse.value.slug === startedCourseSlug) {
        const item = currentCourse.value.miniProjectsByBlockId[String(fresh.block_id)];
        if (item) item.latest_status = fresh.latest_status;
      }
    }
    // Clear the selected file from state so the disabled "Submit" button
    // doesn't snap back to enabled if can_submit re-opens later. The
    // submit-section is hidden by data.can_submit=false in the common case
    // (refetched state typically transitions to awaiting_evaluation).
    selectedFile = null;
  }

  // Status label used by the sr-only aria-live region. Reads from
  // LATEST_STATUS_META so the single source of truth is shared with the
  // visible StatusPill. When data is null (loading), report a stable
  // placeholder so the live region's text changes only on real state changes.
  const statusLiveLabel = $derived.by(() => {
    if (!data) return 'Loading';
    return LATEST_STATUS_META[data.latest_status].label;
  });
</script>

<div class="page">
  <!--
    C16 — sr-only aria-live status announcer. MUST live OUTSIDE the
    {#if isLoading}/{#if data} branching so its DOM node identity stays
    stable across state transitions (the AT shouldn't re-read the whole
    region just because data flipped from loading→loaded). The text reads
    from `statusLiveLabel`, which is a pure derived view of data.latest_status.
  -->
  <div class="sr-only" aria-live="polite" data-testid="sr-live">Status: {statusLiveLabel}</div>

  {#if isLoading}
    <p>Loading…</p>
  {:else if fetchErrorMessage !== null}
    <div class="banner banner-error" data-testid="fetch-error-banner">
      <h1>Mini-project unavailable</h1>
      <p>{fetchErrorMessage}</p>
      <button type="button" onclick={() => navigate(`/courses/${courseSlug}`)}>
        Back to course
      </button>
    </div>
  {:else if data}
    <header>
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/courses">&lt; Courses</a>
        <span class="sep"> › </span>
        <a href="/courses/{courseSlug}">{currentCourse.value?.course.name ?? '<Course Name>'}</a>
      </nav>
      <div class="title-row">
        <h1>{titleForHeading} — Mini-project</h1>
        <StatusPill status={data.latest_status} />
      </div>

      <div class="deadlines">
        {#if data.resubmission_deadline && (data.latest_status === 'major_revision' || data.latest_status === 'minor_revision')}
          <p class="deadline deadline-resub">
            <strong>Resubmission deadline:</strong>
            {formatRelativeDeadline(data.resubmission_deadline)}
          </p>
        {:else if data.hard_deadline}
          <p class="deadline deadline-hard">
            <strong>Hard deadline:</strong>
            {formatRelativeDeadline(data.hard_deadline)}
          </p>
        {/if}
        {#if data.soft_deadline}
          <p class="deadline deadline-soft">(Soft deadline: {formatLocalWithTz(data.soft_deadline)})</p>
        {/if}
      </div>
    </header>

    <!-- L1 + M1: bind:this and {@html} on the SAME div; data-testid is the test seam. -->
    <div class="assignment-html" data-testid="assignment-html" bind:this={assignmentEl}>
      {@html data.assignment_html}
    </div>

    <!-- F10: `.group-disabled` class wraps when is_disabled is true. -->
    <section class="group-block" class:group-disabled={data.group?.is_disabled}>
      <h2>Group</h2>
      {#if data.group === null}
        <!-- D4 friendly banner. -->
        <p class="group-pending">
          You're not yet assigned to a group. Once your teacher assigns you, you'll be able to submit.
        </p>
      {:else if data.group.members.length === 1}
        {@const me = data.group.members[0]}
        <p>Group {data.group.name}: You ({me.full_name}) — you're the only member so far.</p>
      {:else}
        <p>
          Group {data.group.name}:
          {#each orderedMembers as m, i (m.user_id)}{#if i > 0}, {/if}{m.full_name}{m.is_me ? ' (you)' : ''}{/each}
        </p>
      {/if}
      {#if data.group?.is_disabled}
        <p class="group-disabled-notice">This group is disabled — contact your teacher.</p>
      {/if}
    </section>

    <!-- D6 — submit / resubmit section. Renders ONLY when the group is
         assigned AND can_submit has been resolved (true OR false with a
         reason). When can_submit=false, render the reason banner only —
         no file picker, no submit button. -->
    {#if data.group !== null && data.can_submit !== null}
      <section class="submit-block" data-testid="mp-submit-section">
        {#if data.can_submit === true}
          <h2>{submitHeading}</h2>
          <input
            type="file"
            accept="application/pdf"
            data-testid="mp-file-input"
            disabled={submitState === 'submitting'}
            onchange={handleFileChange}
          />
          <button
            type="button"
            data-testid="mp-submit-btn"
            disabled={!canSubmitClick}
            onclick={handleSubmit}
          >
            {submitState === 'submitting' ? 'Submitting…' : 'Submit'}
          </button>
          {#if submitState === 'error' && submitErrorMessage !== null}
            <div class="banner banner-error" data-testid="mp-submit-error">
              <p>{submitErrorMessage}</p>
              {#if submitErrorIsNetwork}
                <button
                  type="button"
                  data-testid="mp-retry-btn"
                  onclick={handleSubmit}
                >Retry</button>
              {/if}
            </div>
          {/if}
        {:else if data.can_submit_reason_if_not !== null}
          <div class="banner banner-info" data-testid="mp-cannot-submit">
            {REASON_LABELS[data.can_submit_reason_if_not]}
          </div>
        {/if}
      </section>
    {/if}

    {#if data.submission_history.length > 0}
      <section class="history">
        <h2>Submission history</h2>
        {#each data.submission_history as entry (entry.submission_id)}
          <section class="history-entry">
            <!-- D15: the Late pill is a SIBLING of <h3>, not nested. -->
            <div class="history-entry-header">
              <h3>Submission #{entry.submission_number}</h3>
              {#if entry.is_late}
                <span
                  class="pill pill-warning"
                  title={data.soft_deadline
                    ? `Submitted past the soft deadline (${formatLocalWithTz(data.soft_deadline)})`
                    : 'Submitted past the soft deadline'}
                >Late</span>
              {/if}
            </div>
            <p>
              By {entry.submitted_by_full_name}{entry.submitter_is_me ? ' (you)' : ''}
              on {formatLocalWithTz(entry.submitted_at)}
            </p>
            <p>
              File: {entry.filename} ({formatFileSize(entry.file_size)})
              <a href="/api/submissions/{entry.submission_id}/file" download>Download</a>
            </p>
            {#if entry.evaluation}
              {@const ev = entry.evaluation}
              <p>
                Evaluated: {evaluationResultLabel(ev.result)}{ev.score !== null ? ` — score ${ev.score}/100` : ''}
              </p>
              <p>By {ev.evaluated_by_full_name} on {formatLocalWithTz(ev.evaluated_at)}</p>
              <p>Feedback: {ev.feedback_text || 'No written feedback'}</p>
              {#if ev.has_feedback_file}
                <a href="/api/evaluations/{ev.eval_id}/feedback-file" download>Download feedback</a>
              {/if}
            {/if}
          </section>
        {/each}
      </section>
    {/if}
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  header { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-3); }
  .breadcrumb a { color: var(--muted); }
  .breadcrumb .sep { color: var(--muted); }
  .title-row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
  .deadlines { color: var(--muted); }
  .deadline { margin: 0; }
  .deadline-resub strong { color: var(--warning, inherit); }
  .assignment-html { margin: var(--space-3) 0; }
  .group-block { margin: var(--space-3) 0; padding: var(--space-2); border: 1px solid var(--border, #ddd); border-radius: 4px; }
  .group-disabled { opacity: 0.7; }
  .group-disabled-notice { color: var(--warning, #b85c00); margin: var(--space-1) 0 0 0; }
  .history { margin-top: var(--space-3); }
  .history-entry { margin: var(--space-2) 0; padding: var(--space-2); border: 1px solid var(--border, #ddd); border-radius: 4px; }
  .history-entry-header { display: flex; align-items: center; gap: var(--space-2); }
  .history-entry-header h3 { margin: 0; }
  .banner-error { padding: var(--space-3); border: 1px solid var(--danger, #c33); border-radius: 4px; background: var(--danger-bg, #fee); }
  .banner-info { padding: var(--space-2); border: 1px solid var(--info, #ccd); border-radius: 4px; background: var(--info-bg, #eef); margin-top: var(--space-2); }
  .submit-block { margin: var(--space-3) 0; padding: var(--space-2); border: 1px solid var(--border, #ddd); border-radius: 4px; }
  /* C16 — visually-hidden but reachable by screen readers. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
