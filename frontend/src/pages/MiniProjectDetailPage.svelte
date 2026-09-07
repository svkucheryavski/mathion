<script lang="ts">
  // MiniProjectDetailPage — student-facing detail page (Tasks D5 + D6).
  //
  // D5 owns: page-mount sequencing (parallel loadCourse + fetchDetail),
  // header (breadcrumb + H1 + StatusPill + deadline summary), assignment
  // {@html} block with rewriteExternalLinks effect (L1/M1/M7), group context
  // (3 branches per spec §6 step 3 — D4 + F10), submission history block
  // (DESC, D15 Late-pill sibling-of-h3), and fetch-error full-page banner
  // (spec §6 step 7 — 403 / 404 / generic); Slice-4 (2026-09-06) restyled
  // every D5 block to artboard 9c.
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
  import Skeleton from '../components/ui/Skeleton.svelte';
  import ErrorState from '../components/ui/ErrorState.svelte';
  import Button from '../components/ui/Button.svelte';
  import { currentCourse, loadCourse } from '../stores/currentCourse.svelte';
  import { pushToast } from '../stores/toasts.svelte';
  import { navigate } from '../lib/router.svelte';
  import { formatLocalWithTz } from '../lib/datetime';
  import { formatFileSize } from '../lib/format';

  let { courseSlug, blockSlug }: { courseSlug: string; blockSlug: string } = $props();

  let data: StudentMiniProjectDetail | null = $state(null);
  // N4 — `$state()` with no arg per RunTeachersTab.svelte:20 precedent.
  let assignmentEl: HTMLDivElement | undefined = $state();
  // Bound to the native <input type="file"> so the success path can reset
  // its value — browsers ignore re-picking an identical filename when the
  // input's stored value isn't cleared.
  let fileInputEl: HTMLInputElement | undefined = $state();
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

  // Monotonic sequence number — guards the data / fetchError writes inside
  // refetchDetail so an older response can't overwrite a newer one when
  // post-submit + visibility refetches interleave. Plain `let` (not $state):
  // pure internal bookkeeping, never read from reactive scope.
  let lastRefetchId = 0;

  // Shared refetch helper — used by the initial-load $effect AND by the
  // submit handler's success/409 paths AND by the visibilitychange listener.
  // Stale-write guarded against slug changes and the AbortController. Sets
  // the shared `refetchInFlight` single-flight gate so a second visibility
  // event mid-fetch is a no-op. Writes are gated by `lastRefetchId` so an
  // older overlapping refetch can never clobber a newer one's result.
  function refetchDetail(
    startedCourseSlug: string,
    startedBlockSlug: string,
    controller: AbortController,
    options: { onLoadingDone?: boolean } = {},
  ): Promise<void> {
    refetchInFlight = true;
    const id = ++lastRefetchId;
    return fetchDetail(startedCourseSlug, startedBlockSlug)
      .then((res) => {
        if (id !== lastRefetchId) return;
        if (startedCourseSlug !== courseSlug || startedBlockSlug !== blockSlug) return;
        if (controller.signal.aborted) return;
        data = res;
      })
      .catch((e: unknown) => {
        if (id !== lastRefetchId) return;
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
        // Only the LATEST refetch may reopen the single-flight gate. If a
        // newer refetch has started, leave `refetchInFlight=true` — that
        // newer call will clear it in its own `.finally`.
        if (id === lastRefetchId) refetchInFlight = false;
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

  // Deadline row (Slice-4 §3.2): the resubmission line takes prominence in a
  // revision state (the former :429 predicate); the row itself renders only
  // when it would have content.
  //
  // `$derived.by` and not a bare `$derived(expr)`: `data` is declared
  // `let data: StudentMiniProjectDetail | null = $state(null)`, so TS narrows it
  // to `null` at the declaration site and every later assignment happens inside
  // a closure it does not follow — a top-level `data !== null && data.x` then
  // narrows to `never` (3 svelte-check errors). Reading `data` inside a closure
  // restores the annotation, which is why every other derived in this file uses
  // `.by` (`titleForHeading`, `fetchErrorMessage`, `orderedMembers`).
  const showResub = $derived.by(() => {
    if (data === null) return false;
    return (
      data.resubmission_deadline !== null &&
      (data.latest_status === 'major_revision' || data.latest_status === 'minor_revision')
    );
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

  // Click-eligibility: only enable in {idle, error}. Excluding 'success'
  // blocks the double-submit window between state-set and the next user
  // file pick (which transitions back to 'idle' via handleFileChange).
  const canSubmitClick = $derived.by(() => {
    return selectedFile !== null && (submitState === 'idle' || submitState === 'error');
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

    // 201 — success. Order matters here:
    //  1. Refetch the detail FIRST (state stays 'submitting' → button stays
    //     disabled while the network call is in flight).
    //  2. Write-back into the course snapshot for the block-link cache.
    //  3. Clear selectedFile + native input value so the same file can be
    //     re-picked after success.
    //  4. Flip submitState → 'success' LAST — only after everything has
    //     quiesced. canSubmitClick keeps the button disabled in 'success',
    //     so the user can't double-submit during the window before they
    //     pick a new file (which transitions back to 'idle').
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
    // Clear the selected file from state AND clear the native input's stored
    // value. Without the native reset, the browser refuses to re-fire `change`
    // when the user re-picks an identical filename.
    selectedFile = null;
    if (fileInputEl) fileInputEl.value = '';
    submitState = 'success';
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
    <Skeleton rows={4} />
  {:else if fetchErrorMessage !== null}
    <div data-testid="fetch-error-banner">
      <ErrorState variant="page" title="Mini-project unavailable" message={fetchErrorMessage}>
        {#snippet action()}
          <Button variant="secondary" onclick={() => navigate(`/courses/${courseSlug}`)}>Back to course</Button>
        {/snippet}
      </ErrorState>
    </div>
  {:else if data}
    <header>
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/courses">Courses</a>
        <span class="sep" aria-hidden="true">/</span>
        <a href="/courses/{courseSlug}">{currentCourse.value?.course.name ?? '<Course Name>'}</a>
        <span class="sep" aria-hidden="true">/</span>
        <span class="current" aria-current="page">{titleForHeading}</span>
      </nav>
      <div class="title-row">
        <h1>Mini-project — {titleForHeading}</h1>
        <StatusPill status={data.latest_status} />
      </div>
      {#if showResub || data.hard_deadline !== null || data.soft_deadline !== null}
        <div class="deadlines">
          <!-- `&& data.resubmission_deadline !== null` narrows for TS; showResub already implies it. -->
          {#if showResub && data.resubmission_deadline !== null}
            <p class="deadline deadline-resub"><strong>Resubmission deadline</strong> · {formatRelativeDeadline(data.resubmission_deadline)}</p>
          {:else if data.hard_deadline !== null}
            <p class="deadline deadline-hard"><strong>Hard deadline</strong> · {formatRelativeDeadline(data.hard_deadline)}</p>
          {/if}
          {#if data.soft_deadline !== null}
            <p class="deadline-soft mono">soft deadline · {formatLocalWithTz(data.soft_deadline)}</p>
          {/if}
        </div>
      {/if}
    </header>

    <section class="assignment">
      <h2>Assignment</h2>
      <!-- L1 + M1: bind:this and {@html} on the SAME div; data-testid is the test seam. -->
      <div class="assignment-html" data-testid="assignment-html" bind:this={assignmentEl}>
        {@html data.assignment_html}
      </div>
    </section>

    <div class="grid2">
      <section class="group-block">
        <h2>Your group</h2>
        {#if data.group === null}
          <!-- D4 friendly banner. -->
          <p class="members">You're not yet assigned to a group. Once your teacher assigns you, you'll be able to submit.</p>
        {:else if data.group.members.length === 1}
          {@const me = data.group.members[0]}
          <p class="members">Group {data.group.name} — <strong>{me.full_name} (you)</strong> — you're the only member so far.</p>
        {:else}
          <p class="members">
            Group {data.group.name} —
            {#each orderedMembers as m, i (m.user_id)}{#if i > 0}{', '}{/if}{#if m.is_me}<strong>{m.full_name} (you)</strong>{:else}{m.full_name}{/if}{/each}
          </p>
        {/if}
        {#if data.group?.is_disabled}
          <!-- The disabled meaning is carried by this line alone (Constraint 2: no opacity dim). -->
          <p class="group-notice">This group is disabled — contact your teacher.</p>
        {/if}
      </section>

      <!-- D6 — submit / resubmit section. Renders ONLY when the group is
           assigned AND can_submit has been resolved (true OR false with a
           reason). When can_submit=false, render the reason banner only —
           no file picker, no submit button. -->
      {#if data.group !== null && data.can_submit !== null}
        <section class="submit-block" class:can={data.can_submit === true} data-testid="mp-submit-section">
          {#if data.can_submit === true}
            <h2>{submitHeading}</h2>
            <input
              type="file"
              accept="application/pdf"
              data-testid="mp-file-input"
              disabled={submitState === 'submitting'}
              onchange={handleFileChange}
              bind:this={fileInputEl}
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
    </div>

    {#if data.submission_history.length > 0}
      <section class="history">
        <h2>Submission history</h2>
        {#each data.submission_history as entry (entry.submission_id)}
          <section class="history-entry">
            <!-- D15 (restated in Slice-4 enumerated 19): the Late pill is never inside <h3>;
                 its parent is .pills, the h3's sibling. -->
            <div class="history-entry-header">
              <h3>Submission <span class="mono">{entry.submission_number}</span></h3>
              <span class="entry-meta mono">{formatLocalWithTz(entry.submitted_at)} · {entry.submitted_by_full_name}{entry.submitter_is_me ? ' (you)' : ''}</span>
              <span class="pills">
                {#if entry.is_late}
                  <span
                    class="pill pill-late"
                    title={data.soft_deadline
                      ? `Submitted past the soft deadline (${formatLocalWithTz(data.soft_deadline)})`
                      : 'Submitted past the soft deadline'}
                  >Late</span>
                {/if}
                {#if entry.evaluation}
                  <StatusPill status={entry.evaluation.result} />
                {/if}
              </span>
            </div>
            <div class="history-entry-body">
              <div class="file">
                <span class="file-kind mono" aria-hidden="true">PDF</span>
                <span class="file-name">
                  <span class="name">{entry.filename}</span>
                  <span class="size mono">{formatFileSize(entry.file_size)}</span>
                </span>
                <a class="dl" href="/api/submissions/{entry.submission_id}/file" download title="Download" aria-label="Download {entry.filename}">
                  <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="3" x2="8" y2="10.6"/><polyline points="4.8,7.6 8,10.8 11.2,7.6"/><line x1="3.4" y1="13" x2="12.6" y2="13"/></svg>
                </a>
              </div>
              {#if entry.evaluation}
                {@const ev = entry.evaluation}
                <div class="feedback {ev.result === 'rejected' ? 'rejected' : ev.result === 'accepted' ? 'accepted' : 'needs-revision'}">
                  <!-- Separators as string expressions: Svelte trims whitespace at block edges, and a
                       bare " · score " as the first node of the {#if} would lose its leading space. -->
                  <p class="feedback-meta">{evaluationResultLabel(ev.result)}{#if ev.score !== null}{' · score '}<span class="mono">{ev.score}/100</span>{/if}{' · '}{ev.evaluated_by_full_name}, <span class="mono">{formatLocalWithTz(ev.evaluated_at)}</span></p>
                  <p class="feedback-text">{ev.feedback_text || 'No written feedback'}</p>
                  {#if ev.has_feedback_file}
                    <a class="feedback-file" href="/api/evaluations/{ev.eval_id}/feedback-file" download>Download feedback</a>
                  {/if}
                </div>
              {/if}
            </div>
          </section>
        {/each}
      </section>
    {/if}
  {/if}
</div>

<style>
  .page { max-width: 800px; /* ref 1265-1266: 760px content column + 20px padding each side; reset.css:1 is border-box, so the outer max is 800 for the inner to be 760 */ margin: 0 auto; padding: 18px 20px 24px; /* ref 1265 */ }
  header { display: flex; flex-direction: column; }
  /* Breadcrumb — ref 1267. base.css paints links --primary; the crumbs read as chrome. */
  .breadcrumb { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); margin-bottom: 10px; /* ref 1267 */ flex-wrap: wrap; }
  .breadcrumb a { color: var(--muted); }
  .breadcrumb .sep { color: var(--faint); /* ref 1267 — separators are the token's documented role */ }
  .breadcrumb .current { color: var(--text); }
  .title-row { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; /* ref 1268 */ flex-wrap: wrap; /* 320px viewports: a long block title + the nowrap pill need it */ }
  .title-row h1 { flex: 1; min-width: 0; overflow-wrap: anywhere; /* 5(c): a long unbreakable title shrinks instead of pushing the pill out (PageItem.svelte:80 precedent) */ }
  .deadlines { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; /* ref 1272 */ flex-wrap: wrap; /* 5(b): the mono aside drops under the sentence at narrow widths */ }
  .deadline { font-size: 12.5px; color: var(--muted); margin: 0; /* ref 1273 */ }
  .deadline strong { font-weight: 600; }
  .deadline-resub { color: var(--status-needs-revision-fg); /* ref 1273 — the one amber: names the revision the student must act on */ }
  .deadline-soft { font-size: 11.5px; color: var(--muted); margin: 0; /* ref 1274 */ }
  /* Assignment card — ref 1277-1280. Content typography is the assignment SUBSET of
     PageItem's block (paragraphs, list, link, code); headings/pre/img are not copied. */
  .assignment { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: 16px 18px; margin-bottom: 14px; /* ref 1277 */ }
  .assignment h2 { font-size: 14px; margin: 0 0 8px; /* ref 1278 */ }
  .assignment-html { overflow-wrap: anywhere; /* PageItem.svelte:80 precedent */ }
  .assignment-html :global(p) { font-size: 14px; line-height: 1.65; color: var(--text-2); margin: 0 0 10px; /* ref 1279 */ }
  .assignment-html :global(p:last-child) { margin-bottom: 0; /* ref 1280 */ }
  .assignment-html :global(a) { color: var(--primary); }
  .assignment-html :global(ul), .assignment-html :global(ol) { padding-left: var(--space-4); margin: 0 0 10px; }
  .assignment-html :global(ul > li) { list-style: disc; /* reset.css:16 strips markers (PageItem.svelte:99-100 split form) */ }
  .assignment-html :global(ol > li) { list-style: decimal; }
  .assignment-html :global(code) { font-family: var(--font-mono); }
  /* Group + submit grid — ref 1283-1285. auto-fit collapses to one column under ~600px (5(b)). */
  .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 14px; margin-bottom: 14px; /* ref 1283; 5(c): min(280px, 100%) so the track never exceeds the container — at the spec's 320px test width the content box is exactly 280px, the bare floor, and any pixel shaved off it (a classic scrollbar) would overflow the page */ }
  .group-block, .submit-block { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: 14px 16px; /* ref 1284 */ }
  .group-block h2, .submit-block h2 { font-size: 13px; margin: 0 0 8px; /* ref 1285 */ }
  .members { font-size: 13px; line-height: 1.7; color: var(--text-2); margin: 0; /* ref 1286 */ }
  .group-notice { font-size: 12.5px; color: var(--text-3); margin: 6px 0 0; /* 5(b): the hint scale; `.notice` is scoped in InteractiveAppItem, hence the name */ }
  /* Submission history — ref 1297-1332, D6 uniform card per entry. */
  .history h2 { font-size: 14px; margin: 0 0 10px; /* ref 1297 */ }
  .history-entry { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; margin-bottom: 10px; /* ref 1298 */ }
  .history-entry:last-child { margin-bottom: 0; }
  .history-entry-header { display: flex; align-items: center; gap: 9px; padding: 9px 12px; /* ref 1299 */ background: var(--surface-2); border-bottom: 1px solid var(--border-soft); /* #E9EBEF → --border-soft (spec substitution table: the exact-hex token is a state token) */ flex-wrap: wrap; }
  .history-entry-header h3 { font-size: 13px; margin: 0; /* ref 1300 */ }
  .entry-meta { font-size: 11.5px; color: var(--muted); /* ref 1301; `.meta` is scoped in CourseCard/QuizItem, hence the name */ }
  .pills { margin-left: auto; display: flex; align-items: center; gap: 6px; /* ref 1302 */ }
  /* Late pill — ref 1320 geometry (StatusPill's ref-1112 scale); GREY per D3, not the artboard's amber:
     "needs revision" is the only amber in the product (mathion-visual-spec.md:132-133). */
  .pill-late { padding: 3px 8px; border-radius: var(--radius-pill); font-size: 11px; font-weight: 500; white-space: nowrap; background: var(--status-not-submitted-bg); color: var(--status-not-submitted-fg); }
  .history-entry-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; /* ref 1304 */ }
  .file { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-3); /* ref 1305 — #FCFCFD exact */ }
  .file-kind { display: flex; align-items: center; justify-content: center; width: 32px; height: 28px; border-radius: 4px; /* ref 1306 */ background: var(--surface-2); /* #F0F1F4 → --surface-2 (substitution table: a background wants a surface token) */ font-size: 9.5px; font-weight: 600; color: var(--muted); flex: 0 0 auto; }
  .file-name { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; /* ref 1307 */ }
  .file-name .name { font-size: 12.5px; color: var(--text); overflow-wrap: anywhere; }
  .file-name .size { font-size: 11.5px; color: var(--muted); }
  .dl { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: var(--radius); border: 1px solid var(--border-strong); background: var(--surface); color: var(--text-3); flex: 0 0 auto; /* ref 1308 */ }
  .dl:hover { text-decoration: none; color: var(--text); }
  /* Feedback block — ref 1310-1312. The rule colour is the result's pill BACKGROUND token
     (the artboard's #FDECC8 is the pill background, not its text); the --border default is
     unreachable (every result maps to one of the three) and exists so the rule is never colourless. */
  .feedback { border-left: 3px solid var(--border); padding: 2px 0 2px 11px; display: flex; flex-direction: column; gap: 5px; /* ref 1310 */ }
  .feedback.needs-revision { border-color: var(--status-needs-revision-bg); }
  .feedback.rejected { border-color: var(--status-rejected-bg); }
  .feedback.accepted { border-color: var(--status-accepted-bg); }
  .feedback-meta { font-size: 12.5px; color: var(--muted); margin: 0; /* ref 1311 */ }
  .feedback-text { font-size: 13px; line-height: 1.6; color: var(--text-2); text-wrap: pretty; margin: 0; /* ref 1312 */ }
  .feedback-file { font-size: 12.5px; /* 5(b): a text link at the meta scale — no artboard counterpart */ }
  /* T4 replaces the two rules below together with the submit section's inner markup (spec §3.9);
     kept here so the relocated section renders correctly between the T3 and T4 commits. */
  .banner-error { padding: var(--space-3); border: 1px solid var(--danger, #c33); border-radius: 4px; background: var(--danger-bg, #fee); }
  .banner-info { padding: var(--space-2); border: 1px solid var(--info, #ccd); border-radius: 4px; background: var(--info-bg, #eef); margin-top: var(--space-2); }
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
