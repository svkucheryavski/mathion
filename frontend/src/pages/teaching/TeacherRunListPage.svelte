<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { listTeachingRuns, type TeachingRunRow } from '../../lib/teaching';
  import { runStatus, RUN_STATUS_LABEL } from '../../lib/runStatus';
  import { formatShortDate } from '../../lib/datetime';
  import { navigate } from '../../lib/router.svelte';
  import LoadingPlaceholder from '../../components/ui/LoadingPlaceholder.svelte';
  import EmptyState from '../../components/ui/EmptyState.svelte';
  import ErrorState from '../../components/ui/ErrorState.svelte';
  import FilterPills from '../../components/ui/FilterPills.svelte';
  import RunStatusChip from '../../components/runs/RunStatusChip.svelte';

  type Status = 'active' | 'upcoming' | 'ended' | 'draft';

  let rows = $state<TeachingRunRow[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let pill = $state<Status | 'all'>('active');

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

  const PILLS = ['active', 'upcoming', 'ended', 'draft', 'all'] as const;
  const pillLabel = (p: Status | 'all') => (p === 'all' ? 'all' : RUN_STATUS_LABEL[p]);
  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
  const pillOptions = $derived(PILLS.map((p) => ({ key: p, label: cap(pillLabel(p)), count: counts[p] })));
  const runUrl = (slug: string, id: number) => `/teaching/${slug}/runs/${id}`;
  const courseUrl = (slug: string) => `/teaching/${slug}`;
  function go(e: MouseEvent, href: string) {
    e.preventDefault();
    void navigate(href);
  }
</script>

<div class="teach-page">
  <h1>Teaching</h1>

  {#if loading}
    <LoadingPlaceholder label="Loading runs…" />
  {:else if error}
    <ErrorState title="Could not load runs." message={error} onretry={load} retryLabel="Try again" />
  {:else if rows.length === 0}
    <EmptyState title="No runs yet. Runs you teach or administer appear here." />
  {:else}
    <FilterPills label="Filter by status" options={pillOptions} value={pill} onchange={(k) => (pill = k as Status | 'all')} />

    {#if visible.length === 0}
      <p class="empty">No {pillLabel(pill)} runs.</p>
    {:else}
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
              <td><a href={runUrl(row.course_slug, row.run.id)} onclick={(e) => go(e, runUrl(row.course_slug, row.run.id))}>{row.run.title}</a></td>
              <td><a class="course-link" href={courseUrl(row.course_slug)} onclick={(e) => go(e, courseUrl(row.course_slug))}>{row.course_name}</a></td>
              <td><RunStatusChip {status} /></td>
              <td class="num">{row.student_count}</td>
              <td class="num">{formatShortDate(row.run.start_date)}</td>
              <td class="num">{formatShortDate(row.run.end_date)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
</div>

<style>
  .teach-page { max-width: var(--page-max); margin: 0 auto; padding: var(--space-3) var(--space-3) var(--space-4); }
  h1 { margin: 0 0 14px; font-size: 22px; font-weight: 600; color: var(--text); }
  .empty { margin: 14px 0 0; color: var(--muted); font-size: 13px; }
  .teach-table { width: 100%; border-collapse: collapse; margin-top: 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
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
