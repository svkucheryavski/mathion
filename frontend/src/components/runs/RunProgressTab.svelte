<script lang="ts">
  import { getProgressDashboard, heatToken,
           type DashboardProgressResponse } from '../../lib/dashboards';
  import { toCSV, downloadCSV, sanitizeTitle } from '../../lib/csvWrite';
  import { blockPositions } from '../../lib/blockNumbers';
  import type { BlockResponse } from '../../lib/types';
  import LoadingPlaceholder from '../ui/LoadingPlaceholder.svelte';
  import ErrorState from '../ui/ErrorState.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Button from '../ui/Button.svelte';
  import SortMark from '../ui/SortMark.svelte';
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

  // R13: B{n} is the block's position in the pinned version's `blocks`; S{n}
  // the sequence's position within its block in this payload.
  const blockPos = $derived(blockPositions(blocks));
  const seqPos = $derived.by(() => {
    const m = new Map<number, number>();
    for (const bg of blockGroupedSequences) bg.sequences.forEach((s, i) => m.set(s.sequence_id, i + 1));
    return m;
  });
  function blockLabel(blockId: number, title: string): string {
    const n = blockPos.get(blockId);
    return n === undefined ? title : `B${n} · ${title}`;
  }
  const legendName = $derived(`${mode === 'coverage' ? 'Coverage' : 'Score'} scale, 0 to 100 percent`);

  // --- Cell helpers ---

  // Five steps (heatToken); no data gives no style, so the cell has no fill.
  function cellInlineStyle(
    s: DashboardProgressResponse['students'][number],
    i: number,
    m: Mode,
  ): string | undefined {
    const cell = m === 'coverage' ? s.coverage[i] : s.quizzes[i];
    if (!cell) return undefined;
    const token = heatToken(computeRatio(cell, m));
    return token === null ? undefined : `--cell-bg: var(${token})`;
  }

  function sortAria(key: SortKey): 'ascending' | 'descending' | 'none' {
    return sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
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

  function pct(numerator: number | null | undefined, denominator: number | null | undefined): string {
    if (numerator == null || denominator == null || denominator === 0) return '';
    return ((numerator / denominator) * 100).toFixed(1);
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
          { header: `${prefix}: coverage_pct`, value: (r: Row) => pct(r.student.coverage[i]?.covered, r.student.coverage[i]?.total) },
          { header: `${prefix}: quiz_pct`, value: (r: Row) => pct(r.student.quizzes[i]?.correct, r.student.quizzes[i]?.total) },
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
    <ErrorState title="Could not load progress." message={error} onretry={refresh} />
  {/if}

  {#if data}
    {#if data.run.version_is_disabled}
      <p class="pg-note">Coverage data reflects last-known state.</p>
    {/if}

    <div class="pg-toolbar">
      <div class="seg" role="group" aria-label="Heatmap mode">
        <button type="button" class="seg-btn" aria-pressed={mode === 'coverage'} onclick={() => (mode = 'coverage')}>Coverage</button>
        <button type="button" class="seg-btn" aria-pressed={mode === 'quiz'} onclick={() => (mode = 'quiz')}>Quiz</button>
      </div>

      <select class="pg-control" bind:value={groupFilter} aria-label="Filter by group">
        <option value="all">All groups</option>
        {#if hasUngroupedStudents}
          <option value="ungrouped">(Ungrouped)</option>
        {/if}
        {#each uniqueGroups as g (g.group_id)}
          <option value={g.group_id}>{g.group_name}{g.group_is_disabled ? ' (disabled)' : ''}</option>
        {/each}
      </select>

      <input class="pg-control pg-search" type="search" bind:value={nameQuery} placeholder="Search student" aria-label="Search student" />

      <div class="pg-right">
        <span class="heat-legend" role="img" aria-label={legendName}>
          <span class="hl-end">0%</span>
          <span class="hl-bar">
            <span class="hl-sw s0"></span><span class="hl-sw s1"></span><span class="hl-sw s2"></span><span class="hl-sw s3"></span><span class="hl-sw s4"></span>
          </span>
          <span class="hl-end">100%</span>
        </span>
        <IconButton glyph="refresh" title="Refresh" onclick={refresh} />
        <Button variant="secondary" data-action="download-csv" onclick={handleDownloadCSV}>Download CSV</Button>
      </div>
    </div>

    {#if data.sequences.length === 0}
      <div class="empty">No sequences in this run.</div>
    {:else}
    <div class="table-scroll">
      <table class="progress-grid">
        <thead>
          <tr class="block-row">
            <th class="sticky-name" scope="col" rowspan="2" aria-sort={sortAria('name')}>
              <button type="button" onclick={() => toggleSort('name')}>Student{#if sortKey === 'name'}<SortMark dir={sortDir} />{/if}</button>
            </th>
            <th class="sticky-group" scope="col" rowspan="2" aria-sort={sortAria('group')}>
              <button type="button" onclick={() => toggleSort('group')}>Group{#if sortKey === 'group'}<SortMark dir={sortDir} />{/if}</button>
            </th>
            {#each blockGroupedSequences as bg (bg.block_id)}
              <th class="block-header" scope="colgroup" colspan={bg.sequences.length}>{blockLabel(bg.block_id, bg.block_title)}</th>
            {/each}
          </tr>
          <tr class="seq-row">
            {#each data.sequences as seq (seq.sequence_id)}
              <th class="seq-header" scope="col" aria-sort={sortAria(`seq:${seq.sequence_id}`)}>
                <button type="button" onclick={() => toggleSort(`seq:${seq.sequence_id}`)}>
                  <span class="seq-n">S{seqPos.get(seq.sequence_id)}</span> {seq.sequence_title}{#if sortKey === `seq:${seq.sequence_id}`}<SortMark dir={sortDir} />{/if}
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each visibleStudents as s (s.user_id)}
            {@const off = s.user_is_disabled || s.group_is_disabled}
            <tr>
              <th scope="row" class="sticky-name">
                <div class="name-box">
                  <span class="pg-name" class:off>{s.full_name ?? s.email}</span>
                  {#if s.user_is_disabled}<span class="chip-disabled">disabled</span>{/if}
                </div>
              </th>
              <td class="sticky-group">
                {s.group_name ?? '—'}
                {#if s.group_is_disabled}<span class="chip-disabled">disabled</span>{/if}
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
        {isAdmin}
        {isTeacher}
        onRefetch={() => {}}
      />
    {/if}
  {/if}
</div>

<style>
  .pg-note { margin: 0 0 10px; font-size: 12.5px; color: var(--muted); }
  .pg-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
  .pg-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }

  .seg { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--radius); overflow: hidden; }
  .seg-btn {
    height: var(--control-h-sm);
    padding: 0 12px;
    background: var(--surface);
    color: var(--text-2);
    border: 0;
    font: inherit;
    font-size: var(--control-font);
    cursor: pointer;
  }
  .seg-btn + .seg-btn { border-left: 1px solid var(--border-strong); }
  .seg-btn[aria-pressed='true'] { background: var(--primary-soft); color: var(--primary); font-weight: 600; }
  .seg-btn:focus-visible { outline-offset: -2px; }

  .pg-control {
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
  .pg-search { width: 220px; }

  .heat-legend { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
  .hl-bar { display: inline-flex; border: 1px solid var(--border); border-radius: 3px; overflow: hidden; }
  .hl-sw { width: 18px; height: 12px; }
  .hl-sw.s0 { background: var(--surface-muted); }
  .hl-sw.s1 { background: var(--heat-1); }
  .hl-sw.s2 { background: var(--heat-2); }
  .hl-sw.s3 { background: var(--heat-3); }
  .hl-sw.s4 { background: var(--heat-4); }

  /* D73: keyboard focus scrolls a cell into view beside the pinned Student + Group
     columns (14rem + 6rem), not under them. */
  .table-scroll { overflow-x: auto; scroll-padding-left: 20rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .progress-grid { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; }
  .progress-grid th, .progress-grid td { padding: 0; border-bottom: 1px solid var(--border-soft); text-align: left; }
  .progress-grid thead th { background: var(--surface-2); color: var(--text-3); font-size: 12px; font-weight: 600; }
  .progress-grid th button { padding: 8px 12px; }
  .sticky-name {
    position: sticky;
    left: 0;
    width: 14rem;
    background: var(--surface);
    border-right: 1px solid var(--border-soft);
    z-index: 2;
  }
  .sticky-group {
    position: sticky;
    left: 14rem;
    width: 6rem;
    background: var(--surface);
    border-right: 1px solid var(--border-soft);
    z-index: 2;
  }
  tbody .sticky-name, tbody .sticky-group { padding: 6px 12px; font-size: 13px; font-weight: 400; color: var(--text); }
  .block-header, .seq-header { position: sticky; top: 0; z-index: 1; }
  .block-row .sticky-name, .block-row .sticky-group { top: 0; z-index: 3; }
  /* Qualified by .progress-grid so these outrank `.progress-grid thead th`
     and `.progress-grid th` (padding 0) above. */
  .progress-grid .block-header {
    padding: 6px 12px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    white-space: nowrap;
  }
  /* One line per header (2d): a wide run scrolls sideways inside .table-scroll
     with Student and Group pinned, instead of squeezing every title. */
  .progress-grid .seq-header { font-weight: 500; white-space: nowrap; }
  .seq-n { font-family: var(--font-mono); }

  /* Holds the Student column at exactly 14rem (the sticky Group's left offset)
     under the table's max-content width: a long name or email wraps here
     instead of widening the column under the Group cell. 25px = the cell's
     12px side paddings + its 1px right border. */
  .name-box { width: calc(14rem - 25px); white-space: normal; overflow-wrap: anywhere; }
  .pg-name.off { font-style: italic; color: var(--muted); }
  .chip-disabled {
    display: inline-block;
    margin-left: 6px;
    padding: 0 6px;
    border-radius: var(--radius-pill);
    background: var(--state-disabled-bg);
    color: var(--state-disabled-fg);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-style: normal;
    vertical-align: middle;
  }

  .cell-btn, .progress-grid th button {
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-align: inherit;
    width: 100%;
    height: 100%;
  }
  /* D61: the ring sits on the heat fill, where --primary is 2.38:1 on --heat-4; the cell text colour is 6:1 or more. */
  .cell-btn { padding: 6px 12px; font-family: var(--font-mono); font-size: 11.5px; --ring: var(--heat-fg); }
  /* Flush in `padding: 0` cells inside .table-scroll: inset, or the clip eats the ring. */
  .cell-btn:focus-visible { outline-offset: -2px; }
  .progress-grid th button:focus-visible { outline-offset: -2px; }
  .cell { background: var(--cell-bg, none); color: var(--heat-fg); }
  .empty { color: var(--muted); padding: 1rem; text-align: center; }
</style>
