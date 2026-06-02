<script lang="ts">
  import { getMiniProjectsDashboard, STATUS_LABEL, STATUS_ICON, STATUS_PRIORITY,
           type DashboardMiniProjectsResponse, type DashboardMpRow, type DashboardMpGroupEntry }
    from '../../lib/dashboards';
  import { toCSV, downloadCSV, sanitizeTitle } from '../../lib/csvWrite';
  import LoadingPlaceholder from '../ui/LoadingPlaceholder.svelte';
  import StatusBadge from '../ui/StatusBadge.svelte';
  import DashboardSidePanel from './DashboardSidePanel.svelte';

  // STATUS_ICON kept to satisfy import; used indirectly via StatusBadge
  void STATUS_ICON;

  let { runId }: { runId: number } = $props();

  let data = $state<DashboardMiniProjectsResponse | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  type SortKey = 'group' | `mp:${number}`;
  type SortDir = 'asc' | 'desc';
  let sortKey = $state<SortKey>('group');
  let sortDir = $state<SortDir>('asc');

  let groupFilter = $state<number | 'all'>('all');

  let panelOpen = $state(false);
  let panelTarget = $state<{ mp: DashboardMpRow; entry: DashboardMpGroupEntry } | null>(null);

  let abortCtl: AbortController | null = null;

  // runId-tracking $effect
  $effect(() => {
    abortCtl?.abort();
    const ctl = new AbortController();
    abortCtl = ctl;
    // Reset on runId change — same rationale as §6.3 (a stale groupFilter from the
    // previous run can silently empty the new run's grid).
    groupFilter = 'all';
    panelOpen = false;
    panelTarget = null;
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
    panelTarget = { mp, entry };
    panelOpen = true;
  }

  function closePanel(): void {
    panelOpen = false;
    panelTarget = null;
  }

  function formatCountsLine(counts: DashboardMpRow['counts']): string {
    const parts: string[] = [`${counts.total_groups} groups`];
    if (counts.awaiting_eval) parts.push(`${counts.awaiting_eval} awaiting`);
    if (counts.needs_revision) parts.push(`${counts.needs_revision} revision`);
    if (counts.rejected) parts.push(`${counts.rejected} rejected`);
    return parts.join(' · ');
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

<div class="tab-container">
  {#if error}
    <div class="banner banner-error" role="alert">
      {error} <button onclick={refresh}>Retry</button>
    </div>
  {/if}

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
        <div class="controls">
          <label>
            Group:
            <select bind:value={groupFilter}>
              <option value="all">All groups</option>
              {#each uniqueGroups as g (g.group_id)}
                <option value={g.group_id}>{g.group_name}{g.group_is_disabled ? ' (disabled)' : ''}</option>
              {/each}
            </select>
          </label>
          <button class="refresh-button" onclick={refresh} aria-label="Refresh">Refresh</button>
          <button class="csv-button" onclick={handleDownloadCSV} data-action="download-csv">Download CSV</button>
        </div>

        <div class="table-scroll">
          <table class="submission-grid">
            <thead>
              <tr class="mp-counts-row">
                <th class="sticky-group" scope="col"></th>
                {#each data.mini_projects as mp (mp.id)}
                  <th class="mp-counts" scope="col">
                    <small>{formatCountsLine(mp.counts)}</small>
                  </th>
                {/each}
              </tr>
              <tr class="mp-titles-row">
                <th class="sticky-group" scope="col"
                    aria-sort={sortKey === 'group' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button onclick={() => toggleSort('group')}>Group {#if sortKey === 'group'}{sortDir === 'asc' ? '▲' : '▼'}{/if}</button>
                </th>
                {#each data.mini_projects as mp (mp.id)}
                  <th class="mp-title-header"
                      scope="col"
                      aria-sort={sortKey === `mp:${mp.id}` ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button onclick={() => toggleSort(`mp:${mp.id}`)}>
                      {mp.title}{#if sortKey === `mp:${mp.id}`} {sortDir === 'asc' ? '▲' : '▼'}{/if}
                    </button>
                    <small class="block-subtitle">{mp.block_title}</small>
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each visibleGroups as g (g.group_id)}
                <tr class:disabled-row={g.group_is_disabled}>
                  <th scope="row" class="sticky-group">
                    {g.group_name}
                    {#if g.group_is_disabled}<span class="badge-muted">disabled</span>{/if}
                  </th>
                  {#each data.mini_projects as mp (mp.id)}
                    {@const cell = mp.groups.find((x) => x.group_id === g.group_id)}
                    <td class="status-cell">
                      {#if cell}
                        <button class="status-cell-btn"
                                onclick={() => openPanel(mp, cell)}
                                aria-label={`${g.group_name}, ${mp.title}: ${STATUS_LABEL[cell.status]}`}>
                          <StatusBadge status={cell.status} />
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

        {#if panelOpen && panelTarget}
          <DashboardSidePanel
            target={{ kind: 'submission', ...panelTarget }}
            onClose={closePanel}
          />
        {/if}
      {/if}
    {/if}
  {/if}
</div>

<style>
  .submission-grid { border-collapse: separate; border-spacing: 0; }

  .sticky-group {
    position: sticky;
    left: 0;
    width: 14rem;
    background: var(--bg, #fff);
    z-index: 2;
  }

  .mp-counts-row .mp-counts {
    font-size: 0.8em;
    color: var(--muted, #6b7280);
    padding: 0.2rem 0.5rem;
    text-align: center;
  }

  .mp-titles-row .mp-title-header {
    position: sticky;
    top: 0;
    background: var(--bg, #fff);
    z-index: 1;
    padding: 0.3rem 0.5rem;
    text-align: center;
  }

  .block-subtitle {
    display: block;
    font-size: 0.75em;
    font-weight: normal;
    color: var(--muted, #6b7280);
  }

  .status-cell {
    padding: 0;
    text-align: center;
    vertical-align: middle;
  }

  .status-cell-btn {
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    text-align: center;
    width: 100%;
    height: 100%;
  }

  .empty-cell {
    color: var(--muted, #6b7280);
  }

  .disabled-row { opacity: 0.55; font-style: italic; }

  .badge-muted {
    display: inline-block;
    margin-left: 0.4em;
    padding: 0.05em 0.4em;
    font-size: 0.75em;
    font-style: normal;
    font-weight: 500;
    line-height: 1.3;
    color: var(--muted, #6b7280);
    background: var(--surface-muted, #f3f4f6);
    border-radius: 0.25em;
    vertical-align: middle;
  }

  .banner-error { background: var(--status-rejected-bg); color: var(--status-rejected-fg); padding: 0.5rem 1rem; border-radius: 4px; }

  .empty {
    color: var(--muted, #6b7280);
    padding: 1rem;
    text-align: center;
  }

  .empty-state {
    color: var(--muted, #6b7280);
    padding: 1rem;
  }


</style>
