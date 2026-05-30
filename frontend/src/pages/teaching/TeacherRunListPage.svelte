<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { listTeachingRuns, type TeachingRunRow } from '../../lib/teaching';
  import { runStatus } from '../../lib/runStatus';
  import { navigate } from '../../lib/router.svelte';
  import LoadingPlaceholder from '../../components/ui/LoadingPlaceholder.svelte';

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
        error = e.displayMessage || 'Could not load runs.';
      } else if (e instanceof Error) {
        error = e.message || 'Could not load runs.';
      } else {
        error = 'Could not load runs.';
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

  const displayLabel = (s: string) => s[0].toUpperCase() + s.slice(1);
  const runUrl = (slug: string, id: number) => `/courses/${slug}/runs/${id}`;
  function onCellClick(e: MouseEvent, slug: string, id: number) {
    e.preventDefault();
    navigate(runUrl(slug, id));
  }
</script>

<h1>Teaching</h1>

{#if loading}
  <LoadingPlaceholder label="Loading runs…" />
{:else if error}
  <div class="error-banner">
    <p>Could not load runs: {error}</p>
    <button type="button" onclick={load}>Try again</button>
  </div>
{:else if rows.length === 0}
  <p class="empty">You're not assigned to any runs yet. When a course admin
    adds you as a teacher, the run will appear here.</p>
{:else}
  <div class="pills">
    {#each (['active','upcoming','ended','draft','all'] as const) as p}
      <button type="button"
              aria-pressed={pill === p}
              onclick={() => pill = p}>
        {displayLabel(p)} ({counts[p]})
      </button>
    {/each}
  </div>

  {#if visible.length === 0}
    <p class="empty">No {displayLabel(pill)} runs. You have
      {counts.active} active, {counts.upcoming} upcoming,
      {counts.ended} ended, and {counts.draft} draft.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th scope="col">Course</th>
          <th scope="col">Run title</th>
          <th scope="col">Status</th>
          <th scope="col">Start–End</th>
          <th scope="col">Students</th>
        </tr>
      </thead>
      <tbody>
        {#each visible as { row, status } (row.run.id)}
          {@const href = runUrl(row.course_slug, row.run.id)}
          <tr>
            <td><a {href} onclick={(e) => onCellClick(e, row.course_slug, row.run.id)}>{row.course_name}</a></td>
            <td><a {href} onclick={(e) => onCellClick(e, row.course_slug, row.run.id)}>{row.run.title}</a></td>
            <td><a {href} onclick={(e) => onCellClick(e, row.course_slug, row.run.id)}>
              <span class="badge badge-{status}">{displayLabel(status)}</span>
            </a></td>
            <td><a {href} onclick={(e) => onCellClick(e, row.course_slug, row.run.id)}>
              {row.run.start_date} → {row.run.end_date}
            </a></td>
            <td><a {href} onclick={(e) => onCellClick(e, row.course_slug, row.run.id)}>{row.student_count}</a></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
{/if}

<style>
  .pills { display: flex; gap: var(--space-2); margin-bottom: var(--space-3); }
  .pills button[aria-pressed="true"] {
    background: var(--accent-soft, var(--bg));
    border-color: var(--accent, var(--primary));
  }
  .error-banner {
    padding: var(--space-3);
    background: var(--danger-soft, #fee);
    border: 1px solid var(--danger);
    border-radius: var(--radius);
  }
  .empty { color: var(--muted); padding: var(--space-3); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: var(--space-2); border-bottom: 1px solid var(--border); }
  td a { color: inherit; text-decoration: none; display: block; }
  .badge { padding: 2px 8px; border-radius: 999px; font-size: 0.85em; }
  .badge-active   { background: #d1fae5; color: #065f46; }
  .badge-upcoming { background: #e0e7ff; color: #3730a3; }
  .badge-ended    { background: #e5e7eb; color: #374151; }
  .badge-draft    { background: #fef3c7; color: #92400e; }
</style>
