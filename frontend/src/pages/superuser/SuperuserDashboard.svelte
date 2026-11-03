<script lang="ts">
  import { ApiError } from '../../lib/api';
  import { getSuperuserStats, type SuperuserStats } from '../../lib/superuser';
  import { formatFileSize } from '../../lib/format';
  import { navigate, currentRoute } from '../../lib/router.svelte';

  let { token }: { token: string } = $props();

  let stats = $state<SuperuserStats | null>(null);
  let loading = $state(true);
  let notFound = $state(false);
  let error = $state('');

  async function load(): Promise<void> {
    const t = token; // track the prop so this effect re-runs if the token changes
    loading = true;
    error = '';
    notFound = false;
    try {
      stats = await getSuperuserStats(t);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 404) {
        notFound = true;
      } else if (err instanceof ApiError && err.status === 401) {
        sessionStorage.setItem('superuser_return_path', currentRoute.path);
        void navigate('/login', { replace: true, force: true });
      } else {
        error = err instanceof ApiError ? err.displayMessage : 'Could not load stats.';
      }
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="dashboard">
  {#if loading}
    <p>Loading…</p>
  {:else if notFound}
    <p class="panel-error">This panel link is not valid or has expired — re-run <code>activate</code> to mint a new one.</p>
  {:else if error}
    <p class="panel-error">{error}</p>
  {:else if stats}
    <div class="cards">
      <div class="card"><span class="label">Users</span><span class="value">{stats.total_users}</span></div>
      <div class="card"><span class="label">Courses</span><span class="value">{stats.total_courses}</span></div>
      <div class="card"><span class="label">Storage</span><span class="value">{formatFileSize(stats.storage_bytes)}</span></div>
      <div class="card"><span class="label">Active 24h</span><span class="value">{stats.active_users_24h}</span></div>
      <div class="card"><span class="label">Active 7d</span><span class="value">{stats.active_users_7d}</span></div>
    </div>
  {/if}
</div>

<style>
  .cards { display: flex; flex-wrap: wrap; gap: var(--space-3); }
  /* The course page's side cards (CourseDeadlines .cdl): small white cards on
     the grey ground. */
  .card {
    box-sizing: border-box;
    display: flex; flex-direction: column; gap: var(--space-1);
    min-width: 140px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  /* The side cards' label. */
  .label { font-size: 11.5px; color: var(--muted); }
  .value { font-size: 22px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
  .panel-error { color: var(--muted); }
</style>
