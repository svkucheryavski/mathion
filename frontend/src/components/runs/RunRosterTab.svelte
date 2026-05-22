<script lang="ts">
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
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { GroupResponse, RunStudentResponse, BulkRosterErrorCode } from '../../lib/types';

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
    students: RunStudentResponse[];
    groups: GroupResponse[];
    groupsEnabled: boolean;
    rosterPrefilter: 'unassigned' | null;
    onPrefilterClear: () => void;
    onRefetchRosterData: () => Promise<{ students: RunStudentResponse[]; groups: GroupResponse[] }>;
    onRefetchGroupsOnly: () => Promise<void>;
    onOpenImport: () => void;
  } = $props();

  let search = $state('');
  let newEmail = $state('');
  let newGroupId = $state<number | '__unassigned'>('__unassigned');
  let addError: string | null = $state(null);
  let pendingDelete = $state<number | null>(null);

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

  async function submitAdd(event: SubmitEvent) {
    event.preventDefault();
    addError = null;
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    const dup = students.some((s) => s.user_email.toLowerCase() === email);
    if (dup) {
      addError = `${newEmail} is already enrolled. Edit their group in the table.`;
      return;
    }
    try {
      const groupId: number | null = newGroupId === '__unassigned' ? null : newGroupId;
      await addRunStudent(runId, newEmail.trim(), groupId);
      newEmail = '';
      newGroupId = '__unassigned';
      await onRefetchRosterData();
    } catch (e) {
      if (e instanceof ApiError) addError = e.displayMessage;
    }
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

<section class="roster-tab">
  <header class="roster-toolbar">
    <input
      name="roster-search"
      placeholder="Search by name or email…"
      value={search}
      oninput={onSearchInput}
    />
    {#if rosterPrefilter === 'unassigned'}
      {@const n = students.filter((s) => s.group_id === null).length}
      <span class="prefilter-pill">
        Showing: Unassigned ({n})
        <button data-action="clear-prefilter" aria-label="Clear filter" onclick={onPrefilterClear}>×</button>
      </span>
    {/if}
    <button data-action="open-import" onclick={onOpenImport}>Import roster</button>
  </header>

  {#if students.length === 0}
    <p class="empty">
      No students yet. Add one below or
      <button data-action="open-import-link" onclick={onOpenImport}>Import roster from CSV</button>.
    </p>
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

  {#if visible.length === 0 && students.length > 0}
    <p class="empty">
      {#if rosterPrefilter === 'unassigned'}
        No students are unassigned.
        <button data-action="clear-prefilter-link" onclick={onPrefilterClear}>Clear filter</button>.
      {:else}
        No students match '{search}'.
        <button data-action="clear-search-link" onclick={() => (search = '')}>Clear search</button>.
      {/if}
    </p>
  {/if}

  <form class="add-row" onsubmit={submitAdd}>
    <input name="new-email" type="email" maxlength="254" bind:value={newEmail} placeholder="student@example.com" />
    {#if groupsEnabled}
      <select bind:value={newGroupId}>
        <option value="__unassigned">Unassigned</option>
        {#each groups.filter((g) => !g.is_disabled) as g (g.id)}
          <option value={g.id}>{g.name} ({g.student_count}/10)</option>
        {/each}
      </select>
    {:else}
      —
    {/if}
    <button data-action="add-student" type="submit" disabled={!newEmail.trim()}>Add</button>
  </form>
  {#if addError}<p class="error">{addError}</p>{/if}
</section>

<style>
  .roster-tab { display: flex; flex-direction: column; gap: 12px; }
  .roster-toolbar { display: flex; gap: 8px; align-items: center; }
  .prefilter-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: var(--surface-muted, #f5f5f5);
    border-radius: 999px;
    font-size: 0.85em;
  }
  .prefilter-pill button { background: transparent; border: 0; cursor: pointer; padding: 0 4px; font-size: 1em; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; border-bottom: 1px solid var(--border, #eee); text-align: left; }
  thead th { position: sticky; top: 0; background: var(--surface, #fff); }
  .add-row { display: flex; gap: 8px; align-items: center; }
  .empty { color: var(--muted, #666); }
  .error { color: var(--danger, #c00); }
  .bulk-strip {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 6px 8px;
    background: var(--surface-muted, #f5f5f5);
    border-radius: 4px;
  }
  .row-error {
    box-shadow: inset 4px 0 0 0 var(--danger, #c00);
  }
</style>
