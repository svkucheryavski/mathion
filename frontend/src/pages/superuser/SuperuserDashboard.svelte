<script lang="ts">
  import { getSuperuserStats, panelError, type PanelOnAuth, type SuperuserStats } from '../../lib/superuser';
  import { formatFileSize } from '../../lib/format';
  import PanelHead from '../../components/superuser/PanelHead.svelte';

  // The shell handles the guard's 401 and 404 for every panel page (D25).
  let { token, onAuth }: { token: string; onAuth: PanelOnAuth } = $props();

  let stats = $state<SuperuserStats | null>(null);
  let loading = $state(true);
  let error = $state('');

  async function load(): Promise<void> {
    const t = token; // track the prop so this effect re-runs if the token changes
    loading = true;
    error = '';
    try {
      stats = await getSuperuserStats(t);
    } catch (err: unknown) {
      error = panelError(err, onAuth) ?? '';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PanelHead title="Dashboard" />
<div class="dashboard">
  {#if loading}
    <p>Loading…</p>
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
