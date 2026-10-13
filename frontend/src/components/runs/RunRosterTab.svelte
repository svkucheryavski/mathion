<script lang="ts">
  import { tick } from 'svelte';
  import { SvelteSet, SvelteMap } from 'svelte/reactivity';
  import { ApiError } from '../../lib/api';
  import {
    addRunStudent,
    removeRunStudent,
    updateRunStudent,
    bulkMoveRunStudents,
    bulkDeleteRunStudents,
  } from '../../lib/runRoster';
  import { pushToast } from '../../stores/toasts.svelte';
  import Button from '../ui/Button.svelte';
  import EmptyState from '../ui/EmptyState.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { GroupResponse, RunStudentResponse, BulkRosterErrorCode } from '../../lib/types';
  import type { ActiveTab } from '../../lib/runTabs';

  type BulkOpKind = 'move' | 'delete';
  type BulkRowErrorMeta = { error_code?: BulkRosterErrorCode | null; detail?: string | null };
  type BulkOpResult = {
    kind: 'idle' | 'in-flight' | 'success' | 'partial' | 'cancelled';
    succeededIds: number[];
    chunkErrorRowIds: number[];
    cancelledIds: number[];
    lastOp: BulkOpKind;
    // Records the move target for the last op. Reserved by the spec's §10 T14
    // contract for future "Repeat move" / "Retry to same group" UX; not consumed
    // by T15's current banner code (T15 retries on a different group, since the
    // chunk-level cancellation usually implies the original target was bad).
    lastTargetGroupId?: number | null;
    error?: ApiError;
  };

  let {
    runId,
    runIsPublished,
    isAdmin,
    courseSlug: _courseSlug,
    onNavigateToTab,
    students,
    groups,
    groupsEnabled,
    rosterPrefilter,
    onPrefilterClear,
    onRefetchRosterData,
    onRefetchGroupsOnly,
    onOpenImport,
  }: {
    runId: number;
    runIsPublished: boolean;
    isAdmin: boolean;
    courseSlug: string;
    onNavigateToTab: (tab: ActiveTab) => void;
    students: RunStudentResponse[];
    groups: GroupResponse[];
    groupsEnabled: boolean;
    rosterPrefilter: 'unassigned' | null;
    onPrefilterClear: () => void;
    onRefetchRosterData: () => Promise<{ students: RunStudentResponse[]; groups: GroupResponse[] }>;
    onRefetchGroupsOnly: () => Promise<void>;
    onOpenImport: () => void;
  } = $props();

  const uid = $props.id();
  // The draft banner's id: a test hook, and the description of every add
  // control a draft disables.
  const DRAFT_HINT_ID = 'roster-draft-publish-hint';
  const draftTitle = $derived(
    isAdmin ? 'Publish this run before adding students' : 'A course admin must publish this run first',
  );
  const enabledGroups = $derived(groups.filter((g) => !g.is_disabled));
  const unassignedCount = $derived(students.filter((s) => s.group_id === null).length);

  // R38: every roster group select reads "Group A · 7/10" (a native option
  // cannot set the count in mono).
  function groupLabel(g: GroupResponse): string {
    return `${g.name} · ${g.student_count}/10`;
  }

  let searchEl = $state<HTMLInputElement>();
  let toggleEl = $state<HTMLButtonElement>();
  let emailEl = $state<HTMLInputElement>();

  // The empty-roster link unmounts once an import fills the roster, so the
  // modal could not return focus to it. Hand focus to the toolbar's Import
  // roster first: that is the opener the modal returns to after Done.
  let importBtnEl = $state<HTMLButtonElement>();
  function openImportFromLink() {
    importBtnEl?.focus({ preventScroll: true });
    onOpenImport();
  }

  let search = $state('');
  let newEmail = $state('');
  let newGroupId = $state<number | '__unassigned'>('__unassigned');
  let addError: string | null = $state(null);
  let pendingDelete = $state<number | null>(null);

  // D25: + opens the add row under the toolbar. `adding` spans the POST and
  // its refetch: Add stays focusable but inert, the field read-only (6b R20).
  let addOpen = $state(false);
  let adding = $state(false);
  const addShown = $derived(addOpen && runIsPublished);

  const pendingGroupId = new SvelteMap<number, number | null>();
  const selected = new SvelteSet<number>();

  // Bulk-op state (T14). Exposed by-reference to T15's banner via component scope.
  // `rowErrorBorders` flags per-row red border; `rowErrorMeta` drives the tooltip.
  // We reassign new instances (not `.clear()`) on each dispatch so Svelte's
  // reactivity tracker treats the change as a fresh reference, even though
  // SvelteSet/SvelteMap mutations would also notify.
  // `bulkOpResult` is mutated by `dispatchBulkOp` and consumed by T15's banner.
  // Already used here to disable the action-strip buttons during in-flight ops,
  // preventing the user from queueing a second bulk-op before the first refetch.
  let bulkOpResult = $state<BulkOpResult>({
    kind: 'idle',
    succeededIds: [],
    chunkErrorRowIds: [],
    cancelledIds: [],
    lastOp: 'move',
  });
  const bulkInFlight = $derived(bulkOpResult.kind === 'in-flight');
  let rowErrorBorders = $state(new SvelteSet<number>());
  let rowErrorMeta = $state(new SvelteMap<number, BulkRowErrorMeta>());
  let bulkDeleteConfirm = $state(false);
  // Bind-value for the bulk-move select. Resetting to '' inside `bulkMoveSelected`
  // lets the user pick the same group twice in a row (sticky-select UX defect
  // avoidance — see deviation #7 in the T14 brief).
  let bulkMoveSelectValue = $state('');
  // Same sticky-select defect avoidance for the T15 retry <select>s. Plan uses
  // a literal `value=""` attribute on the retry-move and retry-cancelled selects;
  // jsdom's `<select>` does not reset to "" after onchange just because the
  // attribute says so, so we bind to a state variable and reset to '' inside
  // the change handler — identical pattern to `bulkMoveSelectValue`.
  let retryMoveSelectValue = $state('');
  let retryCancelledSelectValue = $state('');

  // Banner auto-dismiss state. Re-set to false at the start of each new
  // success run (so a previously-dismissed banner reappears for a fresh op);
  // flipped to true 5s after `bulkOpResult.kind` lands on 'success'. The
  // $effect's cleanup clears the timer when kind transitions away from
  // 'success' before the 5s elapses, preventing a stale dismiss.
  let bannerDismissed = $state(false);

  $effect(() => {
    if (bulkOpResult.kind === 'success') {
      bannerDismissed = false;
      const t = setTimeout(() => (bannerDismissed = true), 5000);
      return () => clearTimeout(t);
    }
  });

  function summaryText(): string {
    const r = bulkOpResult;
    const total = r.succeededIds.length + r.chunkErrorRowIds.length + r.cancelledIds.length;
    const verb = r.lastOp === 'move' ? 'Moved' : 'Deleted';
    if (r.kind === 'success') return `${verb} ${r.succeededIds.length} of ${total} — 0 failed.`;
    if (r.kind === 'partial') return `${verb} ${r.succeededIds.length} of ${total} — ${r.chunkErrorRowIds.length} failed.`;
    if (r.kind === 'cancelled') {
      return `${verb} ${r.succeededIds.length} of ${total} — ${r.chunkErrorRowIds.length} failed, ${r.cancelledIds.length} cancelled (connection issue).`;
    }
    return '';
  }

  function retryMove(event: Event) {
    const raw = (event.currentTarget as HTMLSelectElement).value;
    if (raw === '') return;
    const target: number | null = raw === '__unassigned' ? null : Number(raw);
    const ids = bulkOpResult.chunkErrorRowIds;
    retryMoveSelectValue = '';
    dispatchBulkOp('move', ids, target);
  }

  function retryDelete() {
    dispatchBulkOp('delete', bulkOpResult.chunkErrorRowIds);
  }

  function retryCancelledMove(event: Event) {
    const raw = (event.currentTarget as HTMLSelectElement).value;
    if (raw === '') return;
    const target: number | null = raw === '__unassigned' ? null : Number(raw);
    const ids = [...bulkOpResult.cancelledIds, ...bulkOpResult.chunkErrorRowIds];
    retryCancelledSelectValue = '';
    dispatchBulkOp('move', ids, target);
  }

  function retryCancelledDelete() {
    // Only the chunk-level-cancelled bulk-DELETE branch uses this helper. The
    // move branch re-enters dispatchBulkOp via `retryCancelledMove` (a separate
    // helper so the select can reset its bind-value before dispatching).
    const ids = [...bulkOpResult.cancelledIds, ...bulkOpResult.chunkErrorRowIds];
    dispatchBulkOp('delete', ids);
  }

  function bulkErrorTooltip(meta: BulkRowErrorMeta | undefined): string {
    if (!meta) return '';
    const code = meta.error_code;
    if (code === 'not_in_run') return 'Student is no longer enrolled in this run.';
    if (code === 'capacity_reached') return 'Target group is full (10 students).';
    if (code === 'internal_error') return 'Server error — please retry.';
    // code is null/undefined: fall back to backend-supplied detail, else generic.
    return meta.detail ? meta.detail : 'Unknown error.';
  }

  async function dispatchBulkOp(
    kind: BulkOpKind,
    userIds: number[],
    groupId: number | null = null,
  ) {
    // Step 1: clear borders/meta for this op (new instances → guaranteed reactivity).
    rowErrorBorders = new SvelteSet<number>();
    rowErrorMeta = new SvelteMap<number, BulkRowErrorMeta>();
    bulkOpResult = {
      kind: 'in-flight',
      succeededIds: [],
      chunkErrorRowIds: [],
      cancelledIds: [],
      lastOp: kind,
      lastTargetGroupId: groupId,
    };

    const chunks: number[][] = [];
    for (let i = 0; i < userIds.length; i += 200) chunks.push(userIds.slice(i, i + 200));

    const succeededIds: number[] = [];
    const chunkErrorRowIds: number[] = [];
    let cancelledIds: number[] = [];
    let chunkLevelError: ApiError | undefined;

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      try {
        const response = kind === 'move'
          ? await bulkMoveRunStudents(runId, chunk, groupId)
          : await bulkDeleteRunStudents(runId, chunk);
        for (const row of response.results) {
          if (row.status === 'ok') {
            succeededIds.push(row.user_id);
          } else {
            chunkErrorRowIds.push(row.user_id);
            rowErrorMeta.set(row.user_id, { error_code: row.error_code, detail: row.detail });
          }
        }
      } catch (e) {
        // Whole-chunk failure (network or non-207 like 400/409). All
        // unprocessed user_ids from this and later chunks become cancelled.
        const remainingFromThisChunk = chunk;
        const remainingFromLaterChunks = chunks.slice(ci + 1).flat();
        cancelledIds = [...remainingFromThisChunk, ...remainingFromLaterChunks];
        chunkLevelError = e instanceof ApiError ? e : new ApiError(500, 'Network error');
        break;
      }
    }

    // Refetch roster + groups so capacity badges and group_id reflect the server.
    await onRefetchRosterData();

    // Selection book-keeping: remove succeeded, keep errored/cancelled selected.
    for (const id of succeededIds) selected.delete(id);
    for (const id of chunkErrorRowIds) {
      selected.add(id);
      rowErrorBorders.add(id);
    }
    for (const id of cancelledIds) selected.add(id);

    let finalKind: BulkOpResult['kind'];
    if (chunkLevelError) finalKind = 'cancelled';
    else if (chunkErrorRowIds.length > 0) finalKind = 'partial';
    else finalKind = 'success';

    bulkOpResult = {
      kind: finalKind,
      succeededIds,
      chunkErrorRowIds,
      cancelledIds,
      lastOp: kind,
      lastTargetGroupId: groupId,
      error: chunkLevelError,
    };
  }

  function bulkMoveSelected(event: Event) {
    const raw = (event.currentTarget as HTMLSelectElement).value;
    if (raw === '') return; // disabled placeholder; ignore.
    const target: number | null = raw === '__unassigned' ? null : Number(raw);
    // Reset the select immediately so the same group can be chosen again later.
    bulkMoveSelectValue = '';
    dispatchBulkOp('move', Array.from(selected), target);
  }

  function bulkDeleteSelected() {
    dispatchBulkOp('delete', Array.from(selected));
    bulkDeleteConfirm = false;
  }

  function selectValueFor(s: RunStudentResponse): number | '__unassigned' {
    const effective = pendingGroupId.has(s.user_id) ? pendingGroupId.get(s.user_id)! : s.group_id;
    return effective === null ? '__unassigned' : effective;
  }

  const visible = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (rosterPrefilter === 'unassigned' && s.group_id !== null) return false;
      if (!q) return true;
      const email = s.user_email.toLowerCase();
      const name = (s.user_full_name ?? '').toLowerCase();
      return email.includes(q) || name.includes(q);
    });
  });

  const selectedVisibleCount = $derived(visible.filter((s) => selected.has(s.user_id)).length);
  const headerChecked = $derived(visible.length > 0 && selectedVisibleCount === visible.length);
  const headerIndeterminate = $derived(selectedVisibleCount > 0 && selectedVisibleCount < visible.length);

  function onHeaderClick(event: Event) {
    event.preventDefault();
    if (headerChecked) {
      for (const s of visible) selected.delete(s.user_id);
    } else {
      for (const s of visible) selected.add(s.user_id);
    }
  }

  function onSearchInput(event: Event) {
    search = (event.currentTarget as HTMLInputElement).value;
    if (search && rosterPrefilter !== null) onPrefilterClear();
  }

  // §Focus: chip ×, Clear filter and Clear search → the search field.
  async function clearPrefilter() {
    onPrefilterClear();
    await tick();
    searchEl?.focus();
  }

  async function clearSearch() {
    search = '';
    await tick();
    searchEl?.focus();
  }

  async function openAdd() {
    if (!runIsPublished) return;
    addOpen = true;
    await tick();
    emailEl?.focus();
  }

  // Closing keeps the typed e-mail; it is ignored while an add runs.
  async function closeAdd() {
    if (adding) return;
    addOpen = false;
    addError = null;
    await tick();
    toggleEl?.focus();
  }

  function toggleAdd() {
    if (addShown) void closeAdd();
    else void openAdd();
  }

  function onAddKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    void closeAdd();
  }

  async function submitAdd(event: SubmitEvent) {
    event.preventDefault();
    if (adding || !runIsPublished) return;
    addError = null;
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    const dup = students.some((s) => s.user_email.toLowerCase() === email);
    if (dup) {
      addError = `${newEmail} is already enrolled. Edit their group in the table.`;
      return;
    }
    adding = true;
    try {
      const groupId: number | null = newGroupId === '__unassigned' ? null : newGroupId;
      await addRunStudent(runId, newEmail.trim(), groupId);
      newEmail = '';
      newGroupId = '__unassigned';
      await onRefetchRosterData();
    } catch (e) {
      // Surface every ApiError (4xx/5xx) inline via the backend-supplied
      // displayMessage — covers run_unpublished, student_already_active_in_course,
      // capacity_reached, group_disabled, and any future error_code without
      // per-branch wiring. Non-ApiError exceptions (e.g., TypeError from a
      // fetch network failure) are silently dropped, matching confirmDelete
      // and onGroupChange below.
      if (e instanceof ApiError) {
        addError = e.displayMessage;
      }
    } finally {
      adding = false;
    }
    // Success: ready for the next student. Failure: the field the error is about.
    await tick();
    emailEl?.focus();
  }

  async function confirmDelete(userId: number) {
    try {
      await removeRunStudent(runId, userId);
      pendingDelete = null;
      await onRefetchRosterData();
    } catch (e) {
      pendingDelete = null;
      if (e instanceof ApiError) pushToast(e.displayMessage, 'error');
    }
  }

  async function onGroupChange(s: RunStudentResponse, raw: string) {
    const targetGroupId: number | null = raw === '__unassigned' ? null : Number(raw);
    pendingGroupId.set(s.user_id, targetGroupId);
    try {
      const updated = await updateRunStudent(runId, s.user_id, targetGroupId);
      // Mutate the local student row in place. Spec §4.4: inline-edit success
      // branch refetches groups only (for capacity badges), NOT students; this
      // keeps the row's group_id in sync until the next full roster refetch.
      s.group_id = updated.group_id;
      pendingGroupId.delete(s.user_id);
      await onRefetchGroupsOnly();
    } catch (e) {
      // Delete from pendingGroupId on EVERY error path (incl. network failures),
      // otherwise a TypeError thrown by fetch would leave the row permanently disabled.
      pendingGroupId.delete(s.user_id);
      if (e instanceof ApiError) {
        // Per-errorCode branches kept for future divergence (e.g. distinct toast
        // kinds or copy). For now all 409 paths display the backend-supplied
        // detail string via ApiError.displayMessage.
        if (e.status === 409 && e.errorCode === 'capacity_reached') {
          pushToast(e.displayMessage, 'error');
        } else if (e.status === 409 && e.errorCode === 'group_disabled') {
          pushToast(e.displayMessage, 'error');
        } else {
          pushToast(e.displayMessage, 'error');
        }
      }
    }
  }

  // prunePendingGroups: fires on every reassignment of the parent's `students`
  // prop. Removes pending-overlay entries for user_ids no longer in the roster.
  // Covers all 5 refetch paths from spec §4.4 without parent-side setter wrapping.
  $effect(() => {
    // Dependency declaration trick: reading `students` here registers the
    // effect's dependency on the array reference for fine-grained reactivity.
    void students;
    const liveIds = new Set(students.map((s) => s.user_id));
    for (const uid of Array.from(pendingGroupId.keys())) {
      if (!liveIds.has(uid)) pendingGroupId.delete(uid);
    }
  });
</script>

<section class="ro-tab">
  {#if !runIsPublished}
    <div id={DRAFT_HINT_ID} class="ro-info" role="status" data-action="draft-publish-hint">
      {#if isAdmin}
        Publish this run before adding students. You can still move or remove students already on the roster.
        <button
          type="button"
          class="ro-link"
          data-action="nav-overview-publish-roster"
          onclick={() => onNavigateToTab('overview')}
        >Publish on Overview</button>
      {:else}
        This run is not published yet. A course admin publishes it; then students can be added. You can still move or remove students already on the roster.
      {/if}
    </div>
  {/if}

  <div class="ro-toolbar">
    <label class="vh" for="{uid}-search">Search students</label>
    <input
      id="{uid}-search"
      class="ro-input ro-search"
      name="roster-search"
      placeholder="Search name or email…"
      autocomplete="off"
      value={search}
      oninput={onSearchInput}
      bind:this={searchEl}
    />
    {#if rosterPrefilter === 'unassigned'}
      <span class="ro-chip">
        Unassigned ({unassignedCount})
        <button
          type="button"
          class="ro-chip-x"
          data-action="clear-prefilter"
          aria-label="Clear filter"
          title="Clear filter"
          onclick={clearPrefilter}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4.4" y1="4.4" x2="11.6" y2="11.6" /><line x1="11.6" y1="4.4" x2="4.4" y2="11.6" /></svg>
        </button>
      </span>
    {/if}
    <div class="ro-tools-right">
      <Button
        variant="secondary"
        data-action="open-import"
        disabled={!runIsPublished}
        title={runIsPublished ? undefined : draftTitle}
        aria-describedby={runIsPublished ? undefined : DRAFT_HINT_ID}
        bind:element={importBtnEl}
        onclick={onOpenImport}
      >Import roster</Button>
      <IconButton
        glyph={addShown ? 'close' : 'plus'}
        primary={!addShown}
        size="sm"
        title={!runIsPublished ? draftTitle : addShown ? 'Close add row' : 'Add student'}
        aria-label={addShown ? 'Close add row' : 'Add student'}
        disabled={!runIsPublished}
        describedby={runIsPublished ? undefined : DRAFT_HINT_ID}
        aria-expanded={addShown}
        aria-controls={addShown ? `${uid}-add` : undefined}
        data-action="toggle-add-student"
        bind:element={toggleEl}
        onclick={toggleAdd}
      />
    </div>
  </div>

  {#if addShown}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <form id="{uid}-add" class="ro-add" onsubmit={submitAdd} onkeydown={onAddKeydown}>
      <label class="vh" for="{uid}-email">Student email</label>
      <input
        id="{uid}-email"
        class="ro-input ro-email"
        name="new-email"
        type="email"
        maxlength="254"
        placeholder="student@example.com"
        autocomplete="off"
        readonly={adding}
        aria-invalid={addError ? 'true' : undefined}
        aria-describedby={addError ? `${uid}-add-err` : undefined}
        bind:value={newEmail}
        bind:this={emailEl}
      />
      {#if groupsEnabled}
        <label class="vh" for="{uid}-group">Group</label>
        <select id="{uid}-group" class="ro-select" bind:value={newGroupId}>
          <option value="__unassigned">Unassigned</option>
          {#each enabledGroups as g (g.id)}
            <option value={g.id}>{groupLabel(g)}</option>
          {/each}
        </select>
      {/if}
      <Button
        type="submit"
        variant="primary"
        data-action="add-student"
        loading={adding}
        aria-disabled={adding}
        disabled={!adding && !newEmail.trim()}
        title={adding ? 'Wait for the current change to finish' : newEmail.trim() ? undefined : 'Enter an email address'}
      >Add</Button>
      <Button variant="secondary" data-action="cancel-add-student" onclick={closeAdd}>Cancel</Button>
    </form>
    {#if addError}<p id="{uid}-add-err" class="ro-err error" role="alert">{addError}</p>{/if}
  {/if}

  {#if bulkOpResult.kind !== 'idle' && !(bulkOpResult.kind === 'success' && bannerDismissed)}
    <div class="bulk-banner bulk-banner-{bulkOpResult.kind}">
      <span>{summaryText()}</span>

      {#if bulkOpResult.kind === 'partial' && bulkOpResult.lastOp === 'move'}
        <select
          data-action="retry-move-select"
          bind:value={retryMoveSelectValue}
          onchange={retryMove}
          disabled={bulkInFlight}
        >
          <option value="" disabled>Retry {bulkOpResult.chunkErrorRowIds.length} → group…</option>
          <option value="__unassigned">Unassign</option>
          {#each groups.filter((g) => !g.is_disabled) as g (g.id)}
            <option value={g.id}>{g.name} ({g.student_count}/10)</option>
          {/each}
        </select>
      {:else if bulkOpResult.kind === 'partial' && bulkOpResult.lastOp === 'delete'}
        <button data-action="retry-delete" onclick={retryDelete} disabled={bulkInFlight}>
          Retry {bulkOpResult.chunkErrorRowIds.length} delete
        </button>
      {:else if bulkOpResult.kind === 'cancelled'}
        {#if bulkOpResult.lastOp === 'move'}
          <select
            data-action="retry-cancelled"
            bind:value={retryCancelledSelectValue}
            onchange={retryCancelledMove}
            disabled={bulkInFlight}
          >
            <option value="" disabled>Retry cancelled → group…</option>
            <option value="__unassigned">Unassign</option>
            {#each groups.filter((g) => !g.is_disabled) as g (g.id)}
              <option value={g.id}>{g.name} ({g.student_count}/10)</option>
            {/each}
          </select>
        {:else}
          <button data-action="retry-cancelled" onclick={retryCancelledDelete} disabled={bulkInFlight}>
            Retry cancelled
          </button>
        {/if}
      {/if}

      {#if bulkOpResult.kind !== 'in-flight'}
        <button
          data-action="dismiss-banner"
          onclick={() => (bulkOpResult = { ...bulkOpResult, kind: 'idle' })}
        >
          Dismiss
        </button>
      {/if}
    </div>
  {/if}

  {#if selected.size > 0}
    <div data-strip="bulk" class="bulk-strip">
      <span>
        {selected.size} selected{visible.length < students.length
          ? ` (${visible.filter((s) => selected.has(s.user_id)).length} visible)`
          : ''}
      </span>
      {#if groupsEnabled}
        <select
          data-action="bulk-move-select"
          bind:value={bulkMoveSelectValue}
          onchange={bulkMoveSelected}
          disabled={bulkInFlight}
        >
          <option value="" disabled>Move to group…</option>
          <option value="__unassigned">Unassign</option>
          {#each groups.filter((g) => !g.is_disabled) as g (g.id)}
            <option value={g.id}>{g.name} ({g.student_count}/10)</option>
          {/each}
        </select>
      {/if}
      {#if bulkDeleteConfirm}
        <InlineConfirm
          confirmLabel={`Confirm Delete — ${selected.size} students will be removed.`}
          confirmDataAction="confirm-bulk-delete"
          onConfirm={bulkDeleteSelected}
          onCancel={() => (bulkDeleteConfirm = false)}
        />
      {:else}
        <button
          data-action="bulk-delete"
          disabled={bulkInFlight}
          onclick={() => (bulkDeleteConfirm = true)}
        >
          Delete selected
        </button>
      {/if}
      <button data-action="clear-selection" onclick={() => selected.clear()}>× clear</button>
    </div>
  {/if}

  {#if visible.length > 0}
    <table>
      <thead>
        <tr>
          <th>
            <input
              type="checkbox"
              data-header-checkbox
              checked={headerChecked}
              onclick={onHeaderClick}
              bind:indeterminate={() => headerIndeterminate, () => {}}
            />
          </th>
          <th>Email</th>
          <th>Full name</th>
          <th>Group</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each visible as s (s.user_id)}
          <tr
            data-row="student"
            data-user-id={s.user_id}
            class:row-error={rowErrorBorders.has(s.user_id)}
            title={bulkErrorTooltip(rowErrorMeta.get(s.user_id))}
          >
            <td>
              <input
                type="checkbox"
                data-row-checkbox
                checked={selected.has(s.user_id)}
                onchange={(e) => {
                  if ((e.currentTarget as HTMLInputElement).checked) selected.add(s.user_id);
                  else selected.delete(s.user_id);
                }}
              />
            </td>
            <td>{s.user_email}</td>
            <td>{s.user_full_name || '—'}</td>
            <td>
              {#if groupsEnabled}
                <select
                  value={selectValueFor(s)}
                  disabled={pendingGroupId.has(s.user_id)}
                  onchange={(e) => onGroupChange(s, (e.currentTarget as HTMLSelectElement).value)}
                >
                  <option value="__unassigned">Unassigned</option>
                  {#each groups as g (g.id)}
                    <option value={g.id}>{g.name} ({g.student_count}/10){g.is_disabled ? ' (disabled)' : ''}</option>
                  {/each}
                </select>
              {:else}
                —
              {/if}
            </td>
            <td>
              {#if pendingDelete === s.user_id}
                <InlineConfirm
                  confirmLabel="Confirm Delete"
                  confirmDataAction="confirm-delete-student"
                  onConfirm={() => confirmDelete(s.user_id)}
                  onCancel={() => (pendingDelete = null)}
                />
              {:else}
                <button data-action="delete-student" onclick={() => (pendingDelete = s.user_id)}>Delete</button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  {#if students.length === 0}
    <EmptyState title="No students yet.">
      {#snippet action()}
        <span class="ro-empty-links">
          <button
            type="button"
            class="ro-link"
            data-action="open-import-link"
            disabled={!runIsPublished}
            title={runIsPublished ? undefined : draftTitle}
            aria-describedby={runIsPublished ? undefined : DRAFT_HINT_ID}
            onclick={openImportFromLink}
          >Import roster</button>
          <button
            type="button"
            class="ro-link"
            data-action="open-add-link"
            disabled={!runIsPublished}
            title={runIsPublished ? undefined : draftTitle}
            aria-describedby={runIsPublished ? undefined : DRAFT_HINT_ID}
            onclick={openAdd}
          >Add student</button>
        </span>
      {/snippet}
    </EmptyState>
  {:else if visible.length === 0}
    <p class="ro-nomatch">
      {#if rosterPrefilter === 'unassigned'}
        No students are unassigned.
        <button type="button" class="ro-link" data-action="clear-prefilter-link" onclick={clearPrefilter}>Clear filter</button>.
      {:else}
        No students match '{search}'.
        <button type="button" class="ro-link" data-action="clear-search-link" onclick={clearSearch}>Clear search</button>.
      {/if}
    </p>
  {/if}
</section>

<style>
  .ro-tab { display: flex; flex-direction: column; gap: 10px; }

  /* The 6a info precondition banner. */
  .ro-info {
    padding: 8px 12px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    border-radius: 0 var(--radius) var(--radius) 0;
    font-size: 13px;
    color: var(--text-2);
  }
  .ro-link {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: var(--primary);
    text-decoration: underline;
    cursor: pointer;
  }
  .ro-link:disabled { color: var(--faint); text-decoration: none; cursor: not-allowed; }

  .ro-toolbar { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .ro-tools-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  /* R40: native fields in the 6a field style (RunTeachersTab's .t-input). */
  .ro-input {
    box-sizing: border-box;
    height: var(--control-h-sm);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--control-font);
  }
  .ro-input[aria-invalid='true'] { border-color: var(--danger); }
  .ro-search { width: 230px; max-width: 100%; }
  .ro-email { flex: 1 1 240px; min-width: 0; max-width: 360px; }
  .ro-select {
    box-sizing: border-box;
    height: 26px;
    max-width: 100%;
    padding: 0 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
  }
  .ro-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 4px 0 10px;
    border-radius: 13px;
    background: var(--surface-2);
    font-size: 12px;
    color: var(--text-3);
  }
  .ro-chip-x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .ro-chip-x:hover { background: var(--border); color: var(--text); }

  /* D25: the 6a add-row look. */
  .ro-add {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .ro-err { margin: 0; font-size: 12px; color: var(--danger); }
  .ro-nomatch { margin: 0; font-size: 13px; color: var(--muted); }
  .ro-empty-links { display: inline-flex; gap: 16px; }
  .vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; border-bottom: 1px solid var(--border, #eee); text-align: left; }
  thead th { position: sticky; top: 0; background: var(--surface, #fff); }
  .bulk-strip {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 6px 8px;
    background: var(--surface-muted, #f5f5f5);
    border-radius: 4px;
  }
  .bulk-banner {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--surface-muted, #f5f5f5);
  }
  .bulk-banner-success { background: var(--success-soft, #e6f6ea); }
  .bulk-banner-partial { background: var(--warn-soft, #fff4e0); }
  .bulk-banner-cancelled { background: var(--danger-soft, #fdecea); }
  .row-error {
    box-shadow: inset 4px 0 0 0 var(--danger, #c00);
  }
</style>
