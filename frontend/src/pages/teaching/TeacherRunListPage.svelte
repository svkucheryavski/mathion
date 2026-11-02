<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { listTeachingRuns, type TeachingRunRow } from '../../lib/teaching';
  import { runStatus, RUN_STATUS_LABEL } from '../../lib/runStatus';
  import { formatShortDate } from '../../lib/datetime';
  import { routeClick } from '../../lib/routeClick';
  import { currentRoute, navigate } from '../../lib/router.svelte';
  import Skeleton from '../../components/ui/Skeleton.svelte';
  import EmptyState from '../../components/ui/EmptyState.svelte';
  import ErrorState from '../../components/ui/ErrorState.svelte';
  import FilterPills from '../../components/ui/FilterPills.svelte';
  import RunStatusChip from '../../components/runs/RunStatusChip.svelte';

  type Status = 'active' | 'upcoming' | 'ended' | 'draft';

  let rows = $state<TeachingRunRow[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  // C18: the pill lives in the address (?status=, none for the default), so
  // Back from a run restores it. A click sets it at once (a writable derived);
  // the address follows, replaced, as the run page's ?tab= does.
  const PILLS = ['active', 'upcoming', 'ended', 'draft', 'all'] as const;
  type Pill = (typeof PILLS)[number];
  function statusFrom(search: string): Pill {
    const v = new URLSearchParams(search).get('status');
    return (PILLS as readonly string[]).includes(v ?? '') ? (v as Pill) : 'active';
  }
  let pill = $derived<Pill>(statusFrom(currentRoute.search));
  function setPill(k: Pill) {
    pill = k;
    const p = new URLSearchParams(currentRoute.search);
    if (k === 'active') p.delete('status');
    else p.set('status', k);
    const q = p.toString();
    void navigate(currentRoute.path + (q ? `?${q}` : '') + currentRoute.hash, { replace: true });
  }

  async function load() {
    loading = true; error = null;
    try {
      rows = await listTeachingRuns();
    } catch (e: unknown) {
      // ApiError exposes a stable user-facing string via displayMessage; for
      // generic Errors fall back to .message, then to a default. We coalesce
      // empty strings to the default so the {:else if error} branch fires.
      if (e instanceof ApiError) {
        error = e.displayMessage || 'unknown error';
      } else if (e instanceof Error) {
        error = e.message || 'unknown error';
      } else {
        error = 'unknown error';
      }
    } finally {
      loading = false;
    }
  }
  onMount(load);

  const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

  function withStatus() {
    return rows.map(r => ({ row: r, status: runStatus(r.run) as Status }));
  }

  const byStatus = $derived.by(() => {
    const buckets: Record<Status, ReturnType<typeof withStatus>> = {
      active: [], upcoming: [], ended: [], draft: [],
    };
    for (const x of withStatus()) buckets[x.status].push(x);
    buckets.active.sort((a, b) =>
      cmp(a.row.run.end_date, b.row.run.end_date) || a.row.run.id - b.row.run.id);
    buckets.upcoming.sort((a, b) =>
      cmp(a.row.run.start_date, b.row.run.start_date) || a.row.run.id - b.row.run.id);
    buckets.ended.sort((a, b) =>
      cmp(b.row.run.end_date, a.row.run.end_date) || a.row.run.id - b.row.run.id);
    buckets.draft.sort((a, b) =>
      cmp(b.row.run.created_at, a.row.run.created_at) || a.row.run.id - b.row.run.id);
    return buckets;
  });

  const counts = $derived({
    active:   byStatus.active.length,
    upcoming: byStatus.upcoming.length,
    ended:    byStatus.ended.length,
    draft:    byStatus.draft.length,
    all:      rows.length,
  });

  const visible = $derived.by(() => {
    if (pill === 'all') {
      return [
        ...byStatus.active, ...byStatus.upcoming,
        ...byStatus.ended,  ...byStatus.draft,
      ];
    }
    return byStatus[pill];
  });

  const pillLabel = (p: Status | 'all') => (p === 'all' ? 'all' : RUN_STATUS_LABEL[p]);
  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
  const pillOptions = $derived(PILLS.map((p) => ({ key: p, label: cap(pillLabel(p)), count: counts[p] })));
  const runUrl = (slug: string, id: number) => `/teaching/${slug}/runs/${id}`;
  const courseUrl = (slug: string) => `/teaching/${slug}`;
</script>

<div class="teach-page">
  <h1>Teaching</h1>

  {#if loading}
    <Skeleton rows={3} label="Loading runs…" />
  {:else if error}
    <ErrorState title="Could not load runs." message={error} onretry={load} retryLabel="Try again" />
  {:else if rows.length === 0}
    <EmptyState title="No runs yet. Runs you teach or administer appear here." />
  {:else}
    <FilterPills label="Filter by status" options={pillOptions} value={pill} onchange={(k) => setPill(k as Pill)} />

    {#if visible.length === 0}
      <p class="empty">No {pillLabel(pill)} runs.</p>
    {:else}
      <div class="table-scroll">
        <table class="teach-table">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Course</th>
              <th scope="col">Status</th>
              <th scope="col">Students</th>
              <th scope="col">Start</th>
              <th scope="col">End</th>
            </tr>
          </thead>
          <tbody>
            {#each visible as { row, status } (row.run.id)}
              <tr>
                <td><a href={runUrl(row.course_slug, row.run.id)} onclick={(e) => routeClick(e, runUrl(row.course_slug, row.run.id))}>{row.run.title}</a></td>
                <td><a class="course-link" href={courseUrl(row.course_slug)} onclick={(e) => routeClick(e, courseUrl(row.course_slug))}>{row.course_name}</a></td>
                <td><RunStatusChip {status} /></td>
                <td class="num">{row.student_count}</td>
                <td class="num">{formatShortDate(row.run.start_date)}</td>
                <td class="num">{formatShortDate(row.run.end_date)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

<style>
  .teach-page { max-width: var(--page-max); margin: 0 auto; padding: var(--space-3) var(--space-3) var(--space-4); }
  h1 { margin: 0 0 14px; font-size: 22px; font-weight: 600; color: var(--text); }
  .empty { margin: 14px 0 0; color: var(--muted); font-size: 13px; }
  /* Polish 3 (table corners): the outer border and radius sit on a scroll wrapper,
     as on Progress and Submissions. It clips the grey header corners, which a
     table's own radius does not, and scrolls a table wider than its container. */
  .table-scroll { overflow-x: auto; margin-top: 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .teach-table { width: 100%; border-collapse: separate; border-spacing: 0; }
  .teach-table th {
    text-align: left;
    padding: 8px 12px;
    background: var(--surface-2);
    color: var(--text-3);
    font-size: 12px;
    font-weight: 600;
  }
  .teach-table td { padding: 8px 12px; border-top: 1px solid var(--border-soft); font-size: 13px; color: var(--text-2); }
  .teach-table td a { color: var(--primary); text-decoration: none; }
  .teach-table td a.course-link { color: var(--text-2); font-weight: 400; }
  .teach-table td a:hover { text-decoration: underline; }
  .num { font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
</style>
