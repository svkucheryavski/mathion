<script lang="ts">
  import { api, ApiError } from '../../lib/api';
  import { getRun, listVersions } from '../../lib/runs';
  import { listRunTeachers } from '../../lib/runTeachers';
  import { listGroups } from '../../lib/runGroups';
  import { listRunStudents } from '../../lib/runRoster';
  import { navigate } from '../../lib/router.svelte';
  import LoadingPlaceholder from '../../components/ui/LoadingPlaceholder.svelte';
  import type { Course, Version, RunResponse, RunTeacherResponse, GroupResponse, RunStudentResponse } from '../../lib/types';

  type ActiveTab = 'overview' | 'teachers' | 'groups' | 'roster';

  let { courseSlug, runId }: { courseSlug: string; runId: string } = $props();

  const runIdInt = $derived.by(() => {
    const n = Number(runId);
    return Number.isInteger(n) && n > 0 ? n : null;
  });

  let course = $state<Course | null>(null);
  let run = $state<RunResponse | null>(null);
  let versions = $state<Version[] | null>(null);
  let teachers = $state<RunTeacherResponse[] | null>(null);
  let groups = $state<GroupResponse[] | null>(null);
  let students = $state<RunStudentResponse[] | null>(null);
  let loadError = $state<ApiError | null>(null);

  let activeTab = $state<ActiveTab>('overview');
  let rosterPrefilter = $state<'unassigned' | null>(null);

  let loadToken = 0;

  async function loadAll(slug: string, rid: number) {
    const myToken = ++loadToken;
    course = null; run = null; versions = null; teachers = null;
    groups = null; students = null; loadError = null;
    try {
      const c = await api.get<Course>(`/api/courses/by-slug/${slug}`);
      if (myToken !== loadToken) return;
      const [r, vs, ts, gs, ss] = await Promise.all([
        getRun(rid),
        listVersions(c.id),
        listRunTeachers(rid),
        listGroups(rid),
        listRunStudents(rid),
      ]);
      if (myToken !== loadToken) return;
      course = c; run = r; versions = vs; teachers = ts; groups = gs; students = ss;
    } catch (e) {
      if (myToken !== loadToken) return;
      if (e instanceof ApiError && e.status === 401) return;
      loadError = (e instanceof ApiError) ? e : new ApiError(500, 'Failed to load run.');
    }
  }

  async function refetchRosterData(): Promise<{ students: RunStudentResponse[]; groups: GroupResponse[] }> {
    if (runIdInt === null) return { students: [], groups: [] };
    const [ss, gs] = await Promise.all([listRunStudents(runIdInt), listGroups(runIdInt)]);
    students = ss;
    groups = gs;
    return { students: ss, groups: gs };
  }

  // Reference refetchRosterData to satisfy the unused-variable check; it's
  // exported via callback prop wiring in downstream tasks (T12, T17).
  void refetchRosterData;

  $effect(() => {
    void courseSlug;
    if (runIdInt === null) return;
    loadAll(courseSlug, runIdInt);
  });

  $effect(() => {
    void runIdInt;
    activeTab = 'overview';
    rosterPrefilter = null;
  });

  const pinned = $derived(versions?.find((v) => v.id === run?.version_id));
  const showDisabledBanner = $derived(pinned?.is_disabled === true);
</script>

{#if runIdInt === null}
  <div class="error">Invalid run.</div>
{:else if loadError}
  <div class="error">{loadError.displayMessage}</div>
{:else if course === null || run === null || versions === null || teachers === null || groups === null || students === null}
  <LoadingPlaceholder label="Loading run…" />
{:else}
  <header class="run-header">
    <nav class="breadcrumb">
      <a href="/courses" onclick={(e) => { e.preventDefault(); navigate('/courses'); }}>Courses</a> ›
      <a href={`/courses/${course.slug}`} onclick={(e) => { e.preventDefault(); navigate(`/courses/${course!.slug}`); }}>{course.name}</a> ›
      <a href={`/courses/${course.slug}/runs`} onclick={(e) => { e.preventDefault(); navigate(`/courses/${course!.slug}/runs`); }}>Runs</a> ›
      {run.title}
    </nav>
  </header>

  {#if showDisabledBanner}
    <div class="banner-warning">
      This run's course version is disabled. Re-enable it under Course Editor before publishing.
    </div>
  {/if}

  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={activeTab === 'overview'} onclick={() => (activeTab = 'overview')}>Overview</button>
    <button role="tab" aria-selected={activeTab === 'teachers'} onclick={() => (activeTab = 'teachers')}>Teachers</button>
    <button role="tab" aria-selected={activeTab === 'groups'} onclick={() => (activeTab = 'groups')}>Groups</button>
    <button role="tab" aria-selected={activeTab === 'roster'} onclick={() => (activeTab = 'roster')}>Roster</button>
  </div>

  <section class="tab-body">
    {#if activeTab === 'overview'}
      <p>Overview tab (T9 + T10 implementation pending).</p>
    {:else if activeTab === 'teachers'}
      <p>Teachers tab (T11 pending).</p>
    {:else if activeTab === 'groups'}
      <p>Groups tab (T11 pending).</p>
    {:else if activeTab === 'roster'}
      <p>Roster tab (T12+ pending).{rosterPrefilter ? '' : ''}</p>
    {/if}
  </section>
{/if}

<style>
  .run-header { padding-bottom: var(--space-3, 16px); border-bottom: 1px solid var(--border, #eee); }
  .breadcrumb { color: var(--muted, #666); font-size: 0.9em; }
  .breadcrumb a { color: var(--link, #335); text-decoration: none; }
  .breadcrumb a:hover { text-decoration: underline; }
  .banner-warning { background: #fff8e1; color: #8a6d00; padding: 12px; border-radius: 4px; margin: 12px 0; border: 1px solid #f0c850; }
  div.tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border, #eee); margin-top: var(--space-3, 16px); }
  div.tabs button { background: transparent; border: 0; padding: 12px 16px; cursor: pointer; color: var(--muted, #666); border-bottom: 2px solid transparent; }
  div.tabs button[aria-selected="true"] { color: var(--primary, #335); border-bottom-color: var(--primary, #335); }
  .tab-body { padding: var(--space-3, 16px) 0; }
  .error { padding: 16px; color: var(--danger, #c00); }
</style>
