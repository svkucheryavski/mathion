<script lang="ts">
  import { getMiniProjectsDashboard, STATUS_LABEL, STATUS_SHORT_LABEL, STATUS_PRIORITY,
           type DashboardMiniProjectsResponse, type DashboardMpRow, type DashboardMpGroupEntry }
    from '../../lib/dashboards';
  import { toCSV, downloadCSV, sanitizeTitle } from '../../lib/csvWrite';
  import { blockPositions } from '../../lib/blockNumbers';
  import type { BlockResponse } from '../../lib/types';
  import LoadingPlaceholder from '../ui/LoadingPlaceholder.svelte';
  import ErrorState from '../ui/ErrorState.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Button from '../ui/Button.svelte';
  import SortMark from '../ui/SortMark.svelte';
  import StatusBadge from '../ui/StatusBadge.svelte';
  import DashboardSidePanel from './DashboardSidePanel.svelte';

  let {
    runId,
    isAdmin = false,
    isTeacher = false,
    blocks = [],
  }: {
    runId: number;
    isAdmin?: boolean;
    isTeacher?: boolean;
    blocks?: BlockResponse[];
  } = $props();

  const canWrite = $derived(isAdmin || isTeacher);

  let data = $state<DashboardMiniProjectsResponse | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  type SortKey = 'group' | `mp:${number}`;
  type SortDir = 'asc' | 'desc';
  let sortKey = $state<SortKey>('group');
  let sortDir = $state<SortDir>('asc');

  let groupFilter = $state<number | 'all'>('all');

  let selectedIds = $state<{ mpId: number; groupId: number } | null>(null);

  const panelTarget = $derived.by(() => {
    if (selectedIds == null || data == null) return null;
    const mp = data.mini_projects.find((m) => m.id === selectedIds!.mpId);
    const entry = mp?.groups.find((g) => g.group_id === selectedIds!.groupId);
    return mp && entry ? { kind: 'submission' as const, runId, mp, entry } : null;
  });

  let abortCtl: AbortController | null = null;

  // runId-tracking $effect
  $effect(() => {
    abortCtl?.abort();
    const ctl = new AbortController();
    abortCtl = ctl;
    // Reset on runId change — same rationale as §6.3 (a stale groupFilter from the
    // previous run can silently empty the new run's grid).
    groupFilter = 'all';
    selectedIds = null;
    loading = true;
    error = null;
    getMiniProjectsDashboard(runId, { signal: ctl.signal })
      .then((res) => { data = res; loading = false; })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        error = String(err?.message ?? err);
        loading = false;
      });
    return () => ctl.abort();
  });

  // Unmount-only cleanup: terminates latest refresh()-created abortCtl on teardown
  $effect(() => {
    return () => abortCtl?.abort();
  });

  function refresh() {
    abortCtl?.abort();
    abortCtl = new AbortController();
    loading = true;
    error = null;
    getMiniProjectsDashboard(runId, { signal: abortCtl.signal })
      .then((res) => { data = res; loading = false; })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        error = String(err?.message ?? err);
        loading = false;
      });
  }

  // --- Helpers ---

  type GroupRow = { group_id: number; group_name: string; group_is_disabled: boolean };

  function tiebreakByGroupName(a: GroupRow, b: GroupRow): number {
    return a.group_name.localeCompare(b.group_name);
  }

  function compareGroups(a: GroupRow, b: GroupRow): number {
    if (sortKey === 'group') {
      const cmp = a.group_name.localeCompare(b.group_name);
      return cmp !== 0 ? (sortDir === 'asc' ? cmp : -cmp) : tiebreakByGroupName(a, b);
    }
    // mp:<id>
    const mpId = parseInt((sortKey as string).slice(3), 10);
    const mp = data?.mini_projects.find((m) => m.id === mpId);
    if (!mp) return 0;  // STALE: MP absent → no-op until user re-clicks (spec §6.4 line 1082)

    const aEntry = mp.groups.find((g) => g.group_id === a.group_id);
    const bEntry = mp.groups.find((g) => g.group_id === b.group_id);

    const aPriority = aEntry !== undefined ? STATUS_PRIORITY[aEntry.status] : null;
    const bPriority = bEntry !== undefined ? STATUS_PRIORITY[bEntry.status] : null;

    // null-sink: missing entries go to bottom regardless of direction
    if (aPriority === null && bPriority === null) return tiebreakByGroupName(a, b);
    if (aPriority === null) return 1;
    if (bPriority === null) return -1;

    const diff = sortDir === 'asc' ? (aPriority - bPriority) : (bPriority - aPriority);
    return diff !== 0 ? diff : tiebreakByGroupName(a, b);
  }

  function toggleSort(key: SortKey): void {
    if (key === sortKey) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
  }

  function openPanel(mp: DashboardMpRow, entry: DashboardMpGroupEntry): void {
    selectedIds = { mpId: mp.id, groupId: entry.group_id };
  }

  function closePanel(): void {
    selectedIds = null;
  }

  // R8 + R13: "B2 · 3 awaiting · 1 revision · 1 rejected", zero parts omitted;
  // "B2 · no submissions" when every in-scope group is not submitted; bare
  // "B2" when nothing is left to count. No B{n} when the block is not in `blocks`.
  const blockPos = $derived(blockPositions(blocks));
  function line2(mp: DashboardMpRow): string {
    const n = blockPos.get(mp.block_id);
    const parts: string[] = n === undefined ? [] : [`B${n}`];
    const c = mp.counts;
    if (c.total_groups > 0 && c.not_submitted === c.total_groups) {
      parts.push('no submissions');
    } else {
      if (c.awaiting_eval) parts.push(`${c.awaiting_eval} awaiting`);
      if (c.needs_revision) parts.push(`${c.needs_revision} revision`);
      if (c.rejected) parts.push(`${c.rejected} rejected`);
    }
    return parts.join(' · ');
  }

  // R35: the side panel's "B2", from the same positions as line 2.
  function blockLabelOf(mp: DashboardMpRow): string | undefined {
    const n = blockPos.get(mp.block_id);
    return n === undefined ? undefined : `B${n}`;
  }
  function sortAria(key: SortKey): 'ascending' | 'descending' | 'none' {
    return sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  }

  function handleDownloadCSV(): void {
    if (!data) return;
    type Row = { group: GroupRow; mp: DashboardMpRow; entry: DashboardMpGroupEntry | undefined };
    const rows: Row[] = [];
    for (const g of visibleGroups) {
      for (const mp of data.mini_projects) {
        const entry = mp.groups.find((x) => x.group_id === g.group_id);
        rows.push({ group: g, mp, entry });
      }
    }
    const columns = [
      { header: 'group_name', value: (r: Row) => r.group.group_name },
      { header: 'mp_title', value: (r: Row) => r.mp.title },
      { header: 'mp_block_title', value: (r: Row) => r.mp.block_title },
      { header: 'status', value: (r: Row) => r.entry?.status ?? '' },
      { header: 'latest_submission_number', value: (r: Row) => r.entry?.latest_submission?.submission_number ?? '' },
      { header: 'latest_submission_at', value: (r: Row) => r.entry?.latest_submission?.submitted_at ?? '' },
      { header: 'latest_submission_by', value: (r: Row) => r.entry?.latest_submission?.submitted_by?.full_name ?? '' },
      { header: 'is_late', value: (r: Row) => r.entry?.latest_submission?.is_late ?? '' },
      { header: 'is_resubmission', value: (r: Row) => r.entry?.latest_submission?.is_resubmission ?? '' },
      { header: 'file_size', value: (r: Row) => r.entry?.latest_submission?.file_size ?? '' },
      { header: 'latest_evaluation_at', value: (r: Row) => r.entry?.latest_evaluation?.evaluated_at ?? '' },
      { header: 'latest_evaluation_by', value: (r: Row) => r.entry?.latest_evaluation?.evaluated_by?.full_name ?? '' },
      { header: 'evaluation_result', value: (r: Row) => r.entry?.latest_evaluation?.result ?? '' },
      { header: 'evaluation_score', value: (r: Row) => r.entry?.latest_evaluation?.score ?? '' },
      { header: 'has_feedback_file', value: (r: Row) => r.entry?.latest_evaluation?.has_feedback_file ?? '' },
    ];
    const date = new Date().toISOString().slice(0, 10);
    const title = sanitizeTitle(data.run.title, `run-${data.run.id}`);
    const filename = `submissions-${title}-${date}.csv`;
    downloadCSV(toCSV(rows, columns), filename);
  }

  // --- Derived rows ---

  const uniqueGroups = $derived.by(() => {
    const map = new Map<number, GroupRow>();
    for (const mp of data?.mini_projects ?? []) {
      for (const g of mp.groups) {
        if (!map.has(g.group_id)) {
          map.set(g.group_id, {
            group_id: g.group_id,
            group_name: g.group_name,
            group_is_disabled: g.group_is_disabled,
          });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.group_id - b.group_id);
  });

  const visibleGroups = $derived.by(() => {
    let groups = uniqueGroups;
    if (groupFilter !== 'all') {
      groups = groups.filter((g) => g.group_id === groupFilter);
    }
    return [...groups].sort((a, b) => compareGroups(a, b));
  });
</script>

<div class="tab-container" data-test="run-submission-tab" data-can-write={canWrite ? 'true' : 'false'}>
  {#if error}<ErrorState title="Could not load submissions." message={error} onretry={refresh} />{/if}

  {#if loading}
    <LoadingPlaceholder />
  {/if}

  {#if data}
    {#if data.run.groups_enabled === false}
      <p class="empty-state">This run has groups disabled. Mini-project status by group is not applicable.</p>
    {:else}
      {#if data.mini_projects.length === 0}
        <div class="empty">No mini-projects in this run.</div>
      {:else}
        <div class="sub-toolbar">
          <select class="sub-control" bind:value={groupFilter} aria-label="Filter by group">
            <option value="all">All groups</option>
            {#each uniqueGroups as g (g.group_id)}
              <option value={g.group_id}>{g.group_name}{g.group_is_disabled ? ' (disabled)' : ''}</option>
            {/each}
          </select>
          <div class="sub-right">
            <IconButton glyph="refresh" title="Refresh" onclick={refresh} />
            <!-- A text button, as on Progress (Safari pass: one look for one action). -->
            <Button variant="secondary" data-action="download-csv" onclick={handleDownloadCSV}>Download CSV</Button>
          </div>
        </div>

        <div class="table-scroll">
          <table class="submission-grid">
            <thead>
              <tr>
                <th class="sticky-group" scope="col" aria-sort={sortAria('group')}>
                  <button type="button" onclick={() => toggleSort('group')}>Group{#if sortKey === 'group'}<SortMark dir={sortDir} />{/if}</button>
                </th>
                {#each data.mini_projects as mp (mp.id)}
                  <th class="mp-head" scope="col" aria-sort={sortAria(`mp:${mp.id}`)}>
                    <button type="button" onclick={() => toggleSort(`mp:${mp.id}`)}>{mp.block_title}{#if sortKey === `mp:${mp.id}`}<SortMark dir={sortDir} />{/if}</button>
                    <span class="mp-line2">{line2(mp)}</span>
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each visibleGroups as g (g.group_id)}
                <tr>
                  <th scope="row" class="sticky-group">
                    <span class="g-name" class:off={g.group_is_disabled}>{g.group_name}</span>
                    {#if g.group_is_disabled}<span class="chip-disabled">disabled</span>{/if}
                  </th>
                  {#each data.mini_projects as mp (mp.id)}
                    {@const cell = mp.groups.find((x) => x.group_id === g.group_id)}
                    <td class="status-cell">
                      {#if cell}
                        <button class="status-cell-btn"
                                onclick={() => openPanel(mp, cell)}
                                aria-label={`${g.group_name}, ${mp.block_title}: ${STATUS_LABEL[cell.status]}`}>
                          <StatusBadge status={cell.status} label={STATUS_SHORT_LABEL[cell.status]} />
                        </button>
                      {:else}
                        <span aria-label="No data" class="empty-cell">—</span>
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        {#if panelTarget}
          <DashboardSidePanel
            target={panelTarget}
            onClose={closePanel}
            {isAdmin}
            {isTeacher}
            onRefetch={refresh}
            blockLabel={blockLabelOf(panelTarget.mp)}
          />
        {/if}
      {/if}
    {/if}
  {/if}
</div>

<style>
  .sub-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .sub-right { margin-left: auto; display: flex; gap: 6px; }
  .sub-control {
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

  .table-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  /* Natural width (Group 12rem, one-line headers): a run with many mini-projects
     scrolls sideways inside .table-scroll instead of squeezing the columns. */
  .submission-grid { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; }
  .submission-grid th, .submission-grid td { border-bottom: 1px solid var(--border-soft); text-align: left; }
  .submission-grid thead th { background: var(--surface-2); color: var(--text-3); font-size: 12px; font-weight: 600; padding: 8px 12px; vertical-align: top; }
  .submission-grid th button {
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }
  .sticky-group {
    position: sticky;
    left: 0;
    width: 12rem;
    background: var(--surface);
    border-right: 1px solid var(--border-soft);
    z-index: 2;
  }
  tbody .sticky-group { padding: 8px 12px; font-size: 13px; font-weight: 400; color: var(--text); }
  .mp-head { position: sticky; top: 0; z-index: 1; min-width: 11rem; }
  .mp-line2 { display: block; margin-top: 2px; font-family: var(--font-mono); font-size: 11px; font-weight: 400; color: var(--muted); white-space: nowrap; }

  .g-name.off { color: var(--muted); }
  .chip-disabled {
    display: inline-block;
    margin-left: 6px;
    padding: 0 6px;
    border-radius: var(--radius-pill);
    background: var(--state-disabled-bg);
    color: var(--state-disabled-fg);
    font-family: var(--font-mono);
    font-size: 10.5px;
    vertical-align: middle;
  }

  .status-cell { padding: 6px 12px; vertical-align: middle; }
  .status-cell-btn { background: none; border: none; padding: 0; cursor: pointer; }
  /* 9a centres the mini-project columns (the Group column stays left);
     qualified to outrank `.submission-grid th, .submission-grid td` above. */
  .submission-grid .mp-head { text-align: center; }
  .submission-grid .status-cell { text-align: center; }
  .empty-cell { color: var(--muted); }
  .empty { color: var(--muted); padding: 1rem; text-align: center; }
  .empty-state { color: var(--muted); padding: 1rem; }
</style>
