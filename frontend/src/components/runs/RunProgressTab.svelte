<script lang="ts">
  import { getProgressDashboard,
           type DashboardProgressResponse } from '../../lib/dashboards';
  import { toCSV, downloadCSV, sanitizeTitle } from '../../lib/csvWrite';
  import LoadingPlaceholder from '../ui/LoadingPlaceholder.svelte';
  import DashboardSidePanel from './DashboardSidePanel.svelte';

  let { runId }: { runId: number } = $props();

  let data = $state<DashboardProgressResponse | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  type Mode = 'coverage' | 'quiz';
  let mode = $state<Mode>('coverage');

  type SortKey = 'name' | 'group' | `seq:${number}`;
  type SortDir = 'asc' | 'desc';
  let sortKey = $state<SortKey>('name');
  let sortDir = $state<SortDir>('asc');

  let groupFilter = $state<number | 'all' | 'ungrouped'>('all');
  let nameQuery = $state('');

  let panelOpen = $state(false);
  let panelTarget = $state<{ user_id: number; sequence_id: number } | null>(null);

  let abortCtl: AbortController | null = null;     // for in-flight fetch cancellation

  // runId-tracking $effect
  $effect(() => {
    abortCtl?.abort();
    const ctl = new AbortController();    // local snapshot
    abortCtl = ctl;
    // Reset filter-and-panel state on runId change
    groupFilter = 'all';
    nameQuery = '';
    panelOpen = false;
    panelTarget = null;
    loading = true;
    error = null;
    getProgressDashboard(runId, { signal: ctl.signal })
      .then((res) => { data = res; loading = false; })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        error = String(err?.message ?? err);
        loading = false;
      });
    return () => ctl.abort();             // closes over THIS controller, not the latest one
  });

  // Unmount-only cleanup: ensures any pending refresh request is aborted on teardown
  $effect(() => {
    return () => abortCtl?.abort();
  });

  function refresh() {
    abortCtl?.abort();
    abortCtl = new AbortController();
    loading = true;
    error = null;
    getProgressDashboard(runId, { signal: abortCtl.signal })
      .then((res) => { data = res; loading = false; })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        error = String(err?.message ?? err);
        loading = false;
      });
  }

  // --- Helpers ---

  function computeRatio(
    cell: { covered?: number; total?: number | null; correct?: number | null },
    m: Mode,
  ): number | null {
    if (m === 'coverage') {
      if (!cell.total || cell.total === 0) return null;
      return (cell.covered ?? 0) / cell.total;
    }
    // quiz mode
    if (cell.total == null || cell.total === 0) return null;
    return (cell.correct ?? 0) / cell.total;
  }

  function tiebreakByName(
    a: { full_name: string | null; email: string },
    b: { full_name: string | null; email: string },
  ): number {
    return (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email);
  }

  function compareStudents(
    a: DashboardProgressResponse['students'][number],
    b: DashboardProgressResponse['students'][number],
    key: SortKey,
    dir: SortDir,
    m: Mode,
  ): number {
    if (key === 'name') {
      const cmp = (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email);
      return dir === 'asc' ? cmp : -cmp;
    }
    if (key === 'group') {
      const cmp = (a.group_name ?? '').localeCompare(b.group_name ?? '');
      const primary = dir === 'asc' ? cmp : -cmp;
      return primary !== 0 ? primary : tiebreakByName(a, b);
    }
    // seq:<id>
    const seqId = parseInt(key.slice(4), 10);
    // Find the index of this sequence in the sequences array (we use data directly)
    const seqIndex = data?.sequences.findIndex((s) => s.sequence_id === seqId) ?? -1;
    const aCell = seqIndex >= 0 ? (m === 'coverage' ? a.coverage[seqIndex] : a.quizzes[seqIndex]) : undefined;
    const bCell = seqIndex >= 0 ? (m === 'coverage' ? b.coverage[seqIndex] : b.quizzes[seqIndex]) : undefined;
    const aRatio = aCell ? computeRatio(aCell, m) : null;
    const bRatio = bCell ? computeRatio(bCell, m) : null;
    if (aRatio === null && bRatio === null) return tiebreakByName(a, b);
    if (aRatio === null) return 1;     // a sinks
    if (bRatio === null) return -1;    // b sinks
    const diff = dir === 'asc' ? (aRatio - bRatio) : (bRatio - aRatio);
    return diff !== 0 ? diff : tiebreakByName(a, b);
  }

  // --- Derived rows ---

  const visibleStudents = $derived.by(() => {
    if (!data) return [];
    let students = data.students;

    // Filter: group
    if (groupFilter === 'ungrouped') {
      students = students.filter((s) => s.group_id === null);
    } else if (typeof groupFilter === 'number') {
      students = students.filter((s) => s.group_id === groupFilter);
    }
    // Filter: search by name
    if (nameQuery.trim()) {
      const q = nameQuery.trim().toLowerCase();
      students = students.filter((s) =>
        (s.full_name ?? '').toLowerCase().includes(q) || s.email.toLowerCase().includes(q),
      );
    }

    // Sort (always with a stable name-tiebreak)
    students = [...students].sort((a, b) => compareStudents(a, b, sortKey, sortDir, mode));
    return students;
  });

  // --- Derived helpers ---

  const uniqueGroups = $derived.by(() => {
    const map = new Map<number, { group_id: number; group_name: string; group_is_disabled: boolean }>();
    for (const s of data?.students ?? []) {
      if (s.group_id == null) continue;
      if (!map.has(s.group_id)) {
        map.set(s.group_id, {
          group_id: s.group_id,
          group_name: s.group_name ?? '',
          group_is_disabled: s.group_is_disabled ?? false,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.group_id - b.group_id);
  });

  const hasUngroupedStudents = $derived(data?.students.some((s) => s.group_id == null) ?? false);

  const blockGroupedSequences = $derived.by(() => {
    if (!data) return [];
    const blocks = new Map<number, { block_id: number; block_title: string; sequences: typeof data.sequences }>();
    for (const seq of data.sequences) {
      if (!blocks.has(seq.block_id)) {
        blocks.set(seq.block_id, { block_id: seq.block_id, block_title: seq.block_title, sequences: [] });
      }
      blocks.get(seq.block_id)!.sequences.push(seq);
    }
    return Array.from(blocks.values());
  });

  // --- Cell helpers ---

  function cellInlineStyle(
    s: DashboardProgressResponse['students'][number],
    i: number,
    m: Mode,
  ): string {
    const cell = m === 'coverage' ? s.coverage[i] : s.quizzes[i];
    if (!cell) return '';
    const ratio = computeRatio(cell, m);
    if (ratio === null) return '';
    const hue = 120 * ratio;
    return `--cell-bg: hsl(${hue} 70% 80%);`;
  }

  function cellText(
    s: DashboardProgressResponse['students'][number],
    i: number,
    m: Mode,
  ): string {
    if (m === 'coverage') {
      const cell = s.coverage[i];
      if (!cell || cell.total === 0) return '—';
      return `${cell.covered}/${cell.total}`;
    }
    // quiz mode
    const cell = s.quizzes[i];
    if (!cell || cell.total == null) return '—';
    return `${cell.correct ?? 0}/${cell.total}`;
  }

  function cellAriaLabel(
    s: DashboardProgressResponse['students'][number],
    seq: DashboardProgressResponse['sequences'][number],
    i: number,
    m: Mode,
  ): string {
    const name = s.full_name ?? s.email;
    const text = cellText(s, i, m);
    if (text === '—') return `${name}, ${seq.sequence_title}: no data`;
    return `${name}, ${seq.sequence_title}: ${text}`;
  }

  function toggleSort(key: SortKey): void {
    if (key === sortKey) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
  }

  function openPanel(user_id: number, sequence_id: number): void {
    panelTarget = { user_id, sequence_id };
    panelOpen = true;
  }

  function closePanel(): void {
    panelOpen = false;
    panelTarget = null;
  }

  function handleDownloadCSV(): void {
    if (!data) return;
    type Row = { student: DashboardProgressResponse['students'][number] };
    const rows: Row[] = visibleStudents.map((s) => ({ student: s }));
    const columns = [
      { header: 'student_email', value: (r: Row) => r.student.email },
      { header: 'student_name', value: (r: Row) => r.student.full_name ?? '' },
      { header: 'group_name', value: (r: Row) => r.student.group_name ?? '' },
      ...data.sequences.flatMap((seq, i) => {
        const prefix = `${seq.block_title} — ${seq.sequence_title}`;
        return [
          { header: `${prefix}: coverage_covered`, value: (r: Row) => r.student.coverage[i]?.covered ?? '' },
          { header: `${prefix}: coverage_total`, value: (r: Row) => r.student.coverage[i]?.total ?? '' },
          { header: `${prefix}: quiz_correct`, value: (r: Row) => r.student.quizzes[i]?.correct ?? '' },
          { header: `${prefix}: quiz_total`, value: (r: Row) => r.student.quizzes[i]?.total ?? '' },
        ];
      }),
    ];
    const date = new Date().toISOString().slice(0, 10);
    const title = sanitizeTitle(data.run.title, `run-${data.run.id}`);
    const filename = `progress-${title}-${date}.csv`;
    downloadCSV(toCSV(rows, columns), filename);
  }
</script>

<div class="tab-container">
  {#if loading}<LoadingPlaceholder />{/if}
  {#if error}
    <div class="banner banner-error" role="alert">
      {error} <button onclick={refresh}>Retry</button>
    </div>
  {/if}

  {#if data}
    {#if data.run.version_is_disabled}
      <div class="banner banner-warning" role="status">
        This run's course version is disabled. Coverage data reflects last-known state.
      </div>
    {/if}

    <div class="controls">
      <fieldset class="mode-switch" aria-label="Heatmap mode">
        <button type="button"
                aria-pressed={mode === 'coverage'}
                onclick={() => mode = 'coverage'}>Coverage</button>
        <button type="button"
                aria-pressed={mode === 'quiz'}
                onclick={() => mode = 'quiz'}>Quiz</button>
      </fieldset>

      <select bind:value={groupFilter} aria-label="Filter by group">
        <option value="all">All groups</option>
        {#if hasUngroupedStudents}
          <option value="ungrouped">(Ungrouped)</option>
        {/if}
        {#each uniqueGroups as g (g.group_id)}
          <option value={g.group_id}>{g.group_name}{g.group_is_disabled ? ' (disabled)' : ''}</option>
        {/each}
      </select>

      <input type="search" bind:value={nameQuery} placeholder="Search student" aria-label="Search student" />

      <button class="refresh-button" onclick={refresh} aria-label="Refresh">Refresh</button>
      <button class="csv-button" onclick={handleDownloadCSV} data-action="download-csv">Download CSV</button>
    </div>

    {#if data.sequences.length === 0}
      <div class="empty">No sequences in this run.</div>
    {:else}
    <div class="table-scroll">
      <table class="progress-grid">
        <thead>
          <tr class="block-row">
            <th class="sticky-name" scope="col" rowspan="2"
                aria-sort={sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
              <button onclick={() => toggleSort('name')}>Student {#if sortKey === 'name'}{sortDir === 'asc' ? '▲' : '▼'}{/if}</button>
            </th>
            <th class="sticky-group" scope="col" rowspan="2"
                aria-sort={sortKey === 'group' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
              <button onclick={() => toggleSort('group')}>Group {#if sortKey === 'group'}{sortDir === 'asc' ? '▲' : '▼'}{/if}</button>
            </th>
            {#each blockGroupedSequences as bg (bg.block_id)}
              <th class="block-header" scope="colgroup" colspan={bg.sequences.length}>{bg.block_title}</th>
            {/each}
          </tr>
          <tr class="seq-row">
            {#each data.sequences as seq (seq.sequence_id)}
              <th class="seq-header"
                  scope="col"
                  aria-sort={sortKey === `seq:${seq.sequence_id}` ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button onclick={() => toggleSort(`seq:${seq.sequence_id}`)}>
                  {seq.sequence_title}
                  {#if sortKey === `seq:${seq.sequence_id}`}{sortDir === 'asc' ? '▲' : '▼'}{/if}
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each visibleStudents as s (s.user_id)}
            <tr class:disabled-row={s.user_is_disabled || s.group_is_disabled}>
              <th scope="row" class="sticky-name">
                {s.full_name ?? s.email}
                {#if s.user_is_disabled}<span class="badge-muted">disabled</span>{/if}
              </th>
              <td class="sticky-group">
                {s.group_name ?? '—'}
                {#if s.group_is_disabled}<span class="badge-muted">disabled</span>{/if}
              </td>
              {#each data.sequences as seq, i (seq.sequence_id)}
                <td class="cell" style={cellInlineStyle(s, i, mode)}>
                  <button class="cell-btn"
                          onclick={() => openPanel(s.user_id, seq.sequence_id)}
                          aria-label={cellAriaLabel(s, seq, i, mode)}>
                    {cellText(s, i, mode)}
                  </button>
                </td>
              {/each}
            </tr>
          {/each}
          {#if visibleStudents.length === 0}
            <tr><td colspan={data.sequences.length + 2} class="empty">
              {data.students.length === 0
                ? 'No students enrolled in this run.'
                : 'No matches for current filters.'}
            </td></tr>
          {/if}
        </tbody>
      </table>
    </div>
    {/if}

    {#if panelOpen && panelTarget}
      <DashboardSidePanel
        target={{ kind: 'progress', runId, ...panelTarget }}
        onClose={closePanel}
      />
    {/if}
  {/if}
</div>

<style>
  .progress-grid { border-collapse: separate; border-spacing: 0; }
  .sticky-name {
    position: sticky;
    left: 0;
    width: 14rem;
    background: var(--bg, #fff);
    z-index: 2;
  }
  .sticky-group {
    position: sticky;
    left: 14rem;
    width: 10rem;
    background: var(--bg, #fff);
    z-index: 2;
  }
  .block-header, .seq-header {
    position: sticky;
    top: 0;
    background: var(--bg, #fff);
    z-index: 1;
  }
  .block-row .sticky-name, .block-row .sticky-group { top: 0; z-index: 3; }

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

  .cell-btn, .progress-grid th button {
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    padding: 0;
    cursor: pointer;
    text-align: inherit;
    width: 100%;
    height: 100%;
  }

  .cell { background-color: var(--cell-bg, var(--surface-muted, #f3f4f6)); color: var(--text, #1f2937); }
  .empty { color: var(--muted, #6b7280); padding: 1rem; text-align: center; }
  .banner-error { background: var(--status-rejected-bg); color: var(--status-rejected-fg); padding: 0.5rem 1rem; border-radius: 4px; }
  .banner-warning { background: var(--status-needs-revision-bg); color: var(--status-needs-revision-fg); padding: 0.5rem 1rem; border-radius: 4px; }
</style>
