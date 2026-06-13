<script lang="ts">
  import { api, ApiError } from '../../lib/api';
  import { deleteRun, getRun, listVersions, publishRun, unpublishRun } from '../../lib/runs';
  import { listRunTeachers } from '../../lib/runTeachers';
  import { listGroups } from '../../lib/runGroups';
  import { listRunStudents } from '../../lib/runRoster';
  import { runStatus } from '../../lib/runStatus';
  import { navigate } from '../../lib/router.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import { session } from '../../stores/session.svelte';
  import LoadingPlaceholder from '../../components/ui/LoadingPlaceholder.svelte';
  import InlineConfirm from '../../components/ui/InlineConfirm.svelte';
  import RunOverviewTab from '../../components/runs/RunOverviewTab.svelte';
  import RunTeachersTab from '../../components/runs/RunTeachersTab.svelte';
  import RunGroupsTab from '../../components/runs/RunGroupsTab.svelte';
  import RunRosterTab from '../../components/runs/RunRosterTab.svelte';
  import RosterImportModal from '../../components/runs/RosterImportModal.svelte';
  import RunMiniProjectsTab from '../../components/runs/RunMiniProjectsTab.svelte';
  import RunAssetsTab from '../../components/runs/RunAssetsTab.svelte';
  import RunProgressTab from '../../components/runs/RunProgressTab.svelte';
  import RunSubmissionTab from '../../components/runs/RunSubmissionTab.svelte';
  import { listBlocks } from '../../lib/blocks';
  import { listMiniProjects } from '../../lib/miniProjects';
  import { listRunAssets } from '../../lib/runAssets';
  import type {
    Course, Version, RunResponse, RunTeacherResponse, GroupResponse, RunStudentResponse,
    BlockResponse, MiniProjectResponse, RunAssetResponse,
  } from '../../lib/types';

  export type ActiveTab = 'overview' | 'teachers' | 'groups' | 'roster' | 'mini-projects' | 'assets' | 'progress' | 'submission';

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
  let blocks = $state<BlockResponse[] | null>(null);
  let miniProjects = $state<MiniProjectResponse[] | null>(null);
  let assets = $state<RunAssetResponse[] | null>(null);
  let pendingEditTarget = $state<MiniProjectResponse | null>(null);
  let loadError = $state<ApiError | null>(null);

  let activeTab = $state<ActiveTab>('overview');
  const isAdmin = $derived(course?.is_admin === true);
  const isThisRunTeacher = $derived(
    session.user != null && (teachers ?? []).some((t) => t.user_id === session.user!.id),
  );
  let rosterPrefilter = $state<'unassigned' | null>(null);
  let showImportModal = $state(false);

  function onPrefilterClear() {
    rosterPrefilter = null;
  }

  let loadToken = 0;

  async function loadAll(slug: string, rid: number) {
    const myToken = ++loadToken;
    course = null; run = null; versions = null; teachers = null;
    groups = null; students = null; blocks = null; miniProjects = null;
    assets = null; pendingEditTarget = null;
    loadError = null;
    try {
      const c = await api.get<Course>(`/api/courses/by-slug/${slug}`);
      if (myToken !== loadToken) return;
      const [r, vs, ts, gs, ss, as] = await Promise.all([
        getRun(rid),
        listVersions(c.id),
        listRunTeachers(rid),
        listGroups(rid),
        listRunStudents(rid),
        listRunAssets(rid),
      ]);
      if (myToken !== loadToken) return;
      // Compute pinned from LOCAL destructured values, NOT the `pinned` $derived
      // (which reads `versions`/`run` $state, still null at this point).
      const pinnedVersion = vs.find((v) => v.id === r.version_id) ?? null;
      let blocksResult: BlockResponse[] = [];
      let mpsResult: MiniProjectResponse[] = [];
      if (pinnedVersion != null) {
        [blocksResult, mpsResult] = await Promise.all([
          listBlocks(pinnedVersion.id),
          listMiniProjects(rid),
        ]);
        if (myToken !== loadToken) return;
      }
      course = c; run = r; versions = vs; teachers = ts; groups = gs; students = ss;
      blocks = blocksResult;
      miniProjects = mpsResult;
      assets = as;
    } catch (e) {
      if (myToken !== loadToken) return;
      if (e instanceof ApiError && e.status === 401) return;
      loadError = (e instanceof ApiError) ? e : new ApiError(500, 'Failed to load run.');
    }
  }

  async function refetchMiniProjects(): Promise<void> {
    if (runIdInt === null || !pinnedAvailable) return;
    const rid = runIdInt;
    const myToken = loadToken;
    const fetched = await listMiniProjects(rid);
    // Drop if a runId change or loadAll fired while we were in flight:
    // writing here would overwrite the new run's miniProjects with stale data.
    if (myToken !== loadToken || rid !== runIdInt || !pinnedAvailable) return;
    miniProjects = fetched;
  }

  // Run-scoped (no pinnedAvailable gate). Token + rid guards mirror
  // refetchMiniProjects so a runId change mid-fetch drops the stale write.
  async function refetchAssets(): Promise<void> {
    if (runIdInt === null) return;
    const rid = runIdInt;
    const myToken = loadToken;
    const fetched = await listRunAssets(rid);
    if (myToken !== loadToken || rid !== runIdInt) return;
    assets = fetched;
  }

  async function reloadRun(): Promise<void> {
    if (runIdInt === null) return;
    await loadAll(courseSlug, runIdInt);
  }

  async function refetchRosterData(): Promise<{ students: RunStudentResponse[]; groups: GroupResponse[] }> {
    if (runIdInt === null) return { students: [], groups: [] };
    const [ss, gs] = await Promise.all([listRunStudents(runIdInt), listGroups(runIdInt)]);
    students = ss;
    groups = gs;
    return { students: ss, groups: gs };
  }

  async function refetchTeachers(): Promise<void> {
    if (runIdInt === null) return;
    teachers = await listRunTeachers(runIdInt);
  }

  async function refetchGroups(): Promise<void> {
    if (runIdInt === null) return;
    groups = await listGroups(runIdInt);
  }

  async function refetchGroupsAndStudents(): Promise<void> {
    if (runIdInt === null) return;
    const [gs, ss] = await Promise.all([listGroups(runIdInt), listRunStudents(runIdInt)]);
    groups = gs;
    students = ss;
  }

  $effect(() => {
    void courseSlug;
    if (runIdInt === null) return;
    loadAll(courseSlug, runIdInt);
  });

  $effect(() => {
    void runIdInt;
    activeTab = 'overview';
    rosterPrefilter = null;
    showImportModal = false;
  });

  function gotoTab(tab: ActiveTab, prefilter?: 'unassigned' | null) {
    activeTab = tab;
    rosterPrefilter = prefilter ?? null;
  }

  const pinned = $derived(versions?.find((v) => v.id === run?.version_id));
  const showDisabledBanner = $derived(pinned?.is_disabled === true);
  const pinnedAvailable = $derived(versions == null || pinned != null);

  const runStatusBadge = $derived(run ? runStatus(run) : null);

  // Rank-by-created_at to match RunListPage's `v{N} ({date})` format.
  const versionLabel = $derived.by(() => {
    if (!versions || !pinned) return null;
    const sorted = [...versions].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const idx = sorted.findIndex((v) => v.id === pinned.id);
    if (idx < 0) return null;
    return `v${idx + 1} (${pinned.created_at.slice(0, 10)})`;
  });

  type ChecklistState = 'ok' | 'violated' | 'na';
  type ChecklistRow = { id: string; label: string; state: ChecklistState; hint?: string };

  const readiness = $derived.by((): { checks: ChecklistRow[]; firstViolation: string | null } => {
    const checks: ChecklistRow[] = [];
    if (!run || teachers === null || groups === null || students === null) {
      return { checks: [], firstViolation: null };
    }
    // Teacher
    const teacherOk = teachers.length >= 1;
    checks.push({
      id: 'teacher',
      label: 'At least one teacher',
      state: teacherOk ? 'ok' : 'violated',
      hint: teacherOk ? undefined : 'Add at least one teacher.',
    });
    // Students assigned
    if (!run.groups_enabled) {
      checks.push({ id: 'assigned', label: 'All students assigned to a group', state: 'na' });
    } else {
      const unassigned = students.filter((s: RunStudentResponse) => s.group_id === null).length;
      checks.push({
        id: 'assigned',
        label: 'All students assigned to a group',
        state: unassigned === 0 ? 'ok' : 'violated',
        hint: unassigned === 0 ? undefined : `${unassigned} students unassigned.`,
      });
    }
    // Group sizes
    if (!run.groups_enabled) {
      checks.push({ id: 'sizes', label: 'All groups have 1–10 students', state: 'na' });
    } else if (groups.length === 0) {
      checks.push({ id: 'sizes', label: 'All groups have 1–10 students', state: 'violated', hint: 'No groups defined.' });
    } else {
      const bad = groups.filter((g: GroupResponse) => g.student_count < 1 || g.student_count > 10);
      checks.push({
        id: 'sizes',
        label: 'All groups have 1–10 students',
        state: bad.length === 0 ? 'ok' : 'violated',
        hint: bad.length === 0 ? undefined : bad.map((g: GroupResponse) => `${g.name} (${g.student_count})`).join(', '),
      });
    }
    const violated = checks.find((c) => c.state === 'violated');
    return { checks, firstViolation: violated?.hint ?? null };
  });

  const publishBlocked = $derived(readiness.firstViolation !== null || showDisabledBanner);
  const publishTooltip = $derived(showDisabledBanner
    ? "This run's course version is disabled. Re-enable it under Course Editor before publishing."
    : (readiness.firstViolation ?? ''));

  let unpublishConfirmOpen = $state(false);

  async function doPublish() {
    if (runIdInt === null) return;
    const myToken = loadToken;
    try {
      const r = await publishRun(runIdInt);
      if (myToken !== loadToken) return;
      run = r;
    } catch (e) {
      if (myToken !== loadToken) return;
      if (e instanceof ApiError) pushToast(e.displayMessage, 'error');
    }
  }

  async function onDeleteRun() {
    if (runIdInt === null || !run) return;
    try {
      await deleteRun(runIdInt);
      navigate(`/courses/${courseSlug}/runs`);
    } catch (e) {
      if (e instanceof ApiError) {
        const msg = typeof e.detail === 'string' ? e.detail : '';
        if (e.status === 409 && /students/i.test(msg)) {
          pushToast('Clear roster before deleting.', 'error');
        } else {
          pushToast(e.displayMessage, 'error');
        }
      }
    }
  }

  async function doUnpublish() {
    if (runIdInt === null) return;
    const myToken = loadToken;
    const rid = runIdInt;
    try {
      const r = await unpublishRun(rid);
      if (myToken !== loadToken) return;
      run = r;
      unpublishConfirmOpen = false;
    } catch (e) {
      if (myToken !== loadToken) return;
      if (e instanceof ApiError) {
        pushToast(e.displayMessage, 'error');
        // Spec §6: 409 "Run is not published" — another tab unpublished first.
        // Refetch run so the UI flips back to Publish.
        if (e.status === 409) {
          try {
            const r = await getRun(rid);
            if (myToken !== loadToken) return;
            run = r;
          } catch { /* refetch failed; toast already shown */ }
        }
      }
      if (myToken !== loadToken) return;
      unpublishConfirmOpen = false;
    }
  }
</script>

{#if runIdInt === null}
  <div class="error">Invalid run.</div>
{:else if loadError}
  <div class="error">{loadError.displayMessage}</div>
{:else if course === null || run === null || versions === null || teachers === null || groups === null || students === null || blocks === null || miniProjects === null || assets === null}
  <LoadingPlaceholder label="Loading run…" />
{:else}
  <header class="run-header">
    <nav aria-label="Breadcrumb" class="breadcrumb">
      {#if course.is_admin}
        <a href="/courses" onclick={(e) => { e.preventDefault(); navigate('/courses'); }}>Courses</a> ›
        <a href={`/courses/${course.slug}`} onclick={(e) => { e.preventDefault(); navigate(`/courses/${course!.slug}`); }}>{course.name}</a> ›
        <a href={`/courses/${course.slug}/runs`} onclick={(e) => { e.preventDefault(); navigate(`/courses/${course!.slug}/runs`); }}>Runs</a> ›
        {run.title}
      {:else}
        <a href="/teaching" onclick={(e) => { e.preventDefault(); navigate('/teaching'); }}>Teaching</a> ›
        {course.name} ›
        {run.title}
      {/if}
    </nav>
    <div class="run-meta">
      {#if runStatusBadge}
        <span class="badge badge-{runStatusBadge}" data-testid="status-badge">{runStatusBadge[0].toUpperCase() + runStatusBadge.slice(1)}</span>
      {/if}
      {#if versionLabel}
        <span class="version-label" data-testid="version-label">{versionLabel}</span>
      {/if}
    </div>
    {#if course.is_admin}
      <div class="publish-bar">
        {#if !run.is_published}
          <button
            data-action="publish"
            disabled={publishBlocked}
            title={publishTooltip}
            onclick={doPublish}
          >
            Publish
          </button>
        {:else if unpublishConfirmOpen}
          <InlineConfirm
            confirmLabel="Confirm Unpublish"
            warning="Students will lose access immediately. Their progress data is preserved."
            onConfirm={doUnpublish}
            onCancel={() => (unpublishConfirmOpen = false)}
          />
        {:else}
          <button data-action="unpublish" onclick={() => (unpublishConfirmOpen = true)}>Unpublish</button>
        {/if}
      </div>
    {/if}
  </header>

  {#if showDisabledBanner}
    <div class="banner-warning">
      {#if course.is_admin}
        This run's course version is disabled. Re-enable it under Course Editor before publishing.
      {:else}
        This run's course version is disabled. Some editing actions are locked until a course admin re-enables it.
      {/if}
    </div>
  {/if}

  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={activeTab === 'overview'} onclick={() => (activeTab = 'overview')}>Overview</button>
    <button role="tab" aria-selected={activeTab === 'teachers'} onclick={() => (activeTab = 'teachers')}>Teachers</button>
    <button role="tab" aria-selected={activeTab === 'groups'} onclick={() => (activeTab = 'groups')}>Groups</button>
    <button role="tab" aria-selected={activeTab === 'roster'} onclick={() => (activeTab = 'roster')}>Roster</button>
    <button role="tab" aria-selected={activeTab === 'mini-projects'} onclick={() => (activeTab = 'mini-projects')}>Mini-projects</button>
    <button role="tab" aria-selected={activeTab === 'assets'} onclick={() => (activeTab = 'assets')}>Assets</button>
    <button role="tab" aria-selected={activeTab === 'progress'} onclick={() => (activeTab = 'progress')}>Progress</button>
    <button role="tab" aria-selected={activeTab === 'submission'} onclick={() => (activeTab = 'submission')}>Submission</button>
  </div>

  <section class="tab-body">
    {#if activeTab === 'overview'}
      <RunOverviewTab
        {run}
        setRun={(r) => (run = r)}
        {teachers}
        {groups}
        {students}
        {readiness}
        onNavigateTab={gotoTab}
        {onDeleteRun}
        course={course!}
      />
    {:else if activeTab === 'teachers'}
      <RunTeachersTab runId={runIdInt!} {teachers} onRefetch={refetchTeachers} course={course!} />
    {:else if activeTab === 'groups'}
      <RunGroupsTab
        runId={runIdInt!}
        {groups}
        groupsEnabled={run.groups_enabled}
        onRefetchGroups={refetchGroups}
        onRefetchGroupsAndStudents={refetchGroupsAndStudents}
        course={course!}
        runIsPublished={run.is_published}
      />
    {:else if activeTab === 'roster'}
      <RunRosterTab
        runId={runIdInt!}
        runIsPublished={run.is_published}
        {courseSlug}
        onNavigateToTab={(t) => (activeTab = t)}
        {students}
        {groups}
        groupsEnabled={run.groups_enabled}
        {rosterPrefilter}
        {onPrefilterClear}
        onRefetchRosterData={refetchRosterData}
        onRefetchGroupsOnly={refetchGroups}
        onOpenImport={() => (showImportModal = true)}
      />
      {#if showImportModal}
        <RosterImportModal
          runId={runIdInt!}
          existingRoster={students}
          existingGroups={groups}
          onRefetchBeforeSubmit={refetchRosterData}
          onClose={() => (showImportModal = false)}
        />
      {/if}
    {:else if activeTab === 'mini-projects'}
      <RunMiniProjectsTab
        runId={runIdInt!}
        runIsPublished={run.is_published}
        runGroupsEnabled={run.groups_enabled}
        runEndDate={run.end_date}
        versionIsDisabled={showDisabledBanner}
        {pinnedAvailable}
        blocks={blocks ?? []}
        miniProjects={miniProjects ?? []}
        onRefetchMiniProjects={refetchMiniProjects}
        onRefetchAssets={refetchAssets}
        onNavigateToTab={(t) => (activeTab = t)}
        pendingEditTarget={pendingEditTarget}
        onPendingEditConsumed={() => (pendingEditTarget = null)}
        course={course!}
      />
    {:else if activeTab === 'assets'}
      <RunAssetsTab
        runId={runIdInt!}
        assets={assets ?? []}
        miniProjects={miniProjects ?? []}
        course={course!}
        versionIsDisabled={showDisabledBanner}
        onRefetchAssets={refetchAssets}
        onRefetchMiniProjects={refetchMiniProjects}
        onEditMiniProject={(mp) => { pendingEditTarget = mp; activeTab = 'mini-projects'; }}
        onReloadRun={reloadRun}
      />
    {:else if activeTab === 'progress'}
      <RunProgressTab runId={run.id} {isAdmin} isTeacher={isThisRunTeacher} />
    {:else if activeTab === 'submission'}
      <RunSubmissionTab runId={run.id} {isAdmin} isTeacher={isThisRunTeacher} />
    {/if}
  </section>
{/if}

<style>
  .run-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3, 16px); padding-bottom: var(--space-3, 16px); border-bottom: 1px solid var(--border, #eee); }
  .publish-bar, .run-meta { display: flex; align-items: center; gap: 8px; }
  .version-label { font-size: 0.875rem; color: var(--text-muted, #666); font-variant-numeric: tabular-nums; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 500; line-height: 1.4; }
  .badge-draft { background: #e5e7eb; color: #374151; }
  .badge-upcoming { background: #dbeafe; color: #1e40af; }
  .badge-active { background: #d1fae5; color: #065f46; }
  .badge-ended { background: #f3f4f6; color: #6b7280; }
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
